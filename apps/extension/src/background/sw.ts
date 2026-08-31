/**
 * SW 编排中枢：action 点击开 Side Panel → 提取 → task-start/content → 转发流。
 * 消息面（与 Side Panel 的 runtime 通信）刻意最小：
 *   panel → SW: {t:'summarize', agentId, workflow} / {t:'cancel'} / {t:'panel-ready'}
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

let activeTab: chrome.tabs.Tab | null = null

chrome.action.onClicked.addListener(async (tab) => {
  activeTab = tab
  await chrome.sidePanel.open({ tabId: tab.id! }).catch(() => {})
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg?.t) {
    case 'panel-ready':
      nmPort.connect()
      sendResponse({ connected: nmPort.connected, lastError: nmPort.lastError })
      return
    case 'summarize':
      startSummarize(msg.agentId as string, msg.workflow as string)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ error: String(e?.message ?? e) }))
      return true // async
    case 'cancel':
      if (currentTask) {
        nmPort.send({ t: 'task-cancel', taskId: currentTask.taskId })
        sendResponse({ ok: true })
      }
      return
    case 'nm':
      // panel → host 的通用转发（list-agents / list-workflows / history 等）
      sendResponse({ ok: nmPort.send(msg.msg as ExtToHost) })
      return
  }
})

// host → panel 直通
nmPort.onMessage((m) => {
  chrome.runtime.sendMessage(m).catch(() => {})
})
nmPort.onDisconnect(() => {
  chrome.runtime.sendMessage({ t: '__host-disconnected' } as any).catch(() => {})
})

async function startSummarize(agentId: string, workflow: string) {
  const tab = activeTab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (!tab?.id) return { error: 'no-tab' }

  // content script 需 modules → 动态 files 注入（activeTab 授权下用户手势有效）
  await chrome.scripting
    .executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    })
    .catch(() => {})
  const page = (await chrome.tabs
    .sendMessage(tab.id, { t: 'extract' })
    .catch(() => undefined)) as PageContent | { error: string } | undefined
  if (!page || 'error' in page) return { error: page?.error ?? 'extract-failed' }

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
