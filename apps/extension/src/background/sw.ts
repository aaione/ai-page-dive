/**
 * SW 编排中枢：action 点击开 Side Panel → 提取 → task-start/content → 转发流。
 * 消息面（与 Side Panel 的 runtime 通信）刻意最小：
 *   panel → SW: {t:'summarize', agentId, workflow} / {t:'cancel'} / {t:'panel-ready'} / {t:'nm', msg}
 *   SW → panel: 直接转发 host 的 HostToExt 帧
 */
import { nmPort } from '../lib/nmport.js'
import type { ExtToHost, HostToExt, PageContent } from '@pagedive/shared'

// ponytail: 单任务状态（SW 可能重启丢内存态，重启后靠 panel 重新 ping 恢复 UI）
let currentTask: {
  taskId: string
  page: Omit<PageContent, 'contentMarkdown'>
  content: string
} | null = null

// 总结目标：action 点击的 tab（activeTab 授权随手势生效，其他 tab 无授权）
let target: chrome.tabs.Tab | null = null

chrome.action.onClicked.addListener(async (tab) => {
  target = tab
  await chrome.sidePanel.open({ tabId: tab.id! }).catch(() => {})
})

// 注意：MV3 中 async listener 的返回值会被较新 Chrome 直接当响应回传（Promise 化），
// 绕过 sendResponse——必须用同步壳 return true 保持 channel。
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then((r) => {
      if (r !== undefined) sendResponse(r)
    })
    .catch((e) => sendResponse({ error: String(e?.message ?? e) }))
  return true
})

async function handleMessage(msg: any): Promise<unknown> {
  switch (msg?.t) {
    case 'panel-ready': {
      // 面板打开时对齐：target = 当前活跃普通页（panel dock 的页 = 打开面板时
      // action 手势授权过的那个 tab）。panel 自身/浏览器内页不算。
      const [active] = await chrome.tabs
        .query({ active: true, lastFocusedWindow: true })
        .catch(() => [])
      if (active?.id && active.url && !/^(chrome|edge|about|chrome-extension):/.test(active.url)) {
        target = active
      }
      return nmPort.probe()
    }
    case 'summarize':
      return startSummarize(msg.agentId as string, msg.workflow as string)
    case 'cancel':
      if (currentTask) {
        nmPort.send({ t: 'task-cancel', taskId: currentTask.taskId })
        return { ok: true }
      }
      return undefined
    case 'nm':
      // panel → host 的通用转发（list-agents / list-workflows / history 等）
      return { ok: nmPort.send(msg.msg as ExtToHost) }
  }
  return undefined
}

// host → panel 直通
nmPort.onMessage((m) => {
  chrome.runtime.sendMessage(m).catch(() => {})
})
nmPort.onDisconnect(() => {
  chrome.runtime
    .sendMessage({ t: '__host-disconnected' } as HostToExt)
    .catch(() => {})
})

async function startSummarize(agentId: string, workflow: string) {
  // target：action 点击的 tab（activeTab 授权随手势生效）。SW 重启丢态或 panel
  // 直接点按钮时 fallback 到当前活跃 tab——无授权的 tab 注入会失败并提示，
  // 不会造成越权（executeScript 直接被 Chrome 拒绝）。
  let tab = target?.id ? await chrome.tabs.get(target.id).catch(() => null) : null
  if (!tab) {
    tab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] ?? null
  }
  if (!tab?.id) return { error: 'no-tab' }
  // chrome:// 等受限页面无法注入
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url ?? '')) {
    return { error: 'unsupported-page', url: tab.url }
  }

  // content script 需 modules → 动态 files 注入（activeTab 授权下用户手势有效）
  await chrome.scripting
    .executeScript({
      target: { tabId: tab.id! },
      files: ['content.js'],
    })
    .catch(() => {})
  const page = (await chrome.tabs
    .sendMessage(tab.id!, { t: 'extract' })
    .catch(() => undefined)) as PageContent | { error: string } | undefined
  if (!page || 'error' in page) {
    return { error: page?.error === 'empty-content' ? 'empty-content' : 'no-permission' }
  }

  const { contentMarkdown, ...meta } = page
  const taskId = `t${Date.now().toString(36)}`
  currentTask = { taskId, page: meta, content: contentMarkdown }

  const ok = nmPort.send({
    t: 'task-start',
    task: { taskId, agentId, workflow, page: meta },
  })
  if (!ok) return { error: 'host-not-found', lastError: nmPort.lastError }

  // 正文分片 ≤512KB
  const CH = 512 * 1024
  for (let i = 0, seq = 0; i < contentMarkdown.length; i += CH, seq++) {
    nmPort.send({
      t: 'task-content',
      taskId,
      seq,
      text: contentMarkdown.slice(i, i + CH),
      done: i + CH >= contentMarkdown.length,
    })
  }
  return { ok: true, taskId }
}
