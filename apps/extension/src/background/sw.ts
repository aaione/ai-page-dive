/**
 * SW 编排中枢：action 点击开 Side Panel → 提取 → task-start/content → 转发流。
 * 消息面（与 Side Panel 的 runtime 通信）刻意最小：
 *   panel → SW: {t:'summarize', agentId, workflow} / {t:'cancel'} / {t:'panel-ready'} / {t:'nm', msg}
 *   SW → panel: 直接转发 host 的 HostToExt 帧
 */
import { nmPort } from '../lib/nmport.js'
import type { AgentStatus, ExtToHost, HostToExt, PageContent } from '@pagedive/shared'

// ponytail: 单任务状态（SW 可能重启丢内存态，重启后靠 panel 重新 ping 恢复 UI）
let currentTask: {
  taskId: string
  page: Omit<PageContent, 'contentMarkdown'>
  content: string
} | null = null

// 上一轮完成的会话（追问用）：agent + CLI 会话 id
let lastSession: { agentId: string; sessionId: string } | null = null
// 当前任务用的 agent（task-meta 到达时此刻的 agent 即会话归属）
let currentAgentId = 'claude'
// 每个 CLI 最近使用的模型（下拉展示用）：agentId → model。
// 独立于 agentsCache 存活——host 的 agents 帧可能在 task-meta 之后才到（探测慢），
// 若不独立 merge 会被无 model 的 fresh 列表覆盖。
const lastModels = new Map<string, string>()

// 总结目标：action 点击的 tab（activeTab 授权随手势生效，其他 tab 无授权）
let target: chrome.tabs.Tab | null = null

// agents 列表缓存（合并最近模型后驻留 SW；SW 重启后首次 list-agents 仍走 host）
let agentsCache: AgentStatus[] | null = null

// 钉住（默认开）：点扩展图标直达 Side Panel。SW 内存态（无 storage 权限，
// 重启回默认开——v1 语义即默认钉住）；panel 内可切换。
let pinned = true
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: pinned }).catch(() => {})

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
    case 'summarize': {
      const instruction = msg.instruction as string | undefined
      // 追问轮：复用上一轮 CLI 会话（claude --resume），不重新提取页面
      if (msg.followUp === true && lastSession) {
        return startFollowUp(lastSession.agentId, lastSession.sessionId, instruction ?? '')
      }
      return startSummarize(msg.agentId as string, msg.workflow as string, instruction)
    }
    case 'cancel':
      if (currentTask) {
        nmPort.send({ t: 'task-cancel', taskId: currentTask.taskId })
        return { ok: true }
      }
      return undefined
    case 'set-pinned':
      pinned = !!msg.value
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: pinned }).catch(() => {})
      return { ok: true }
    case 'nm':
      // panel → host 的通用转发（list-agents / list-workflows / history 等）
      if ((msg.msg as any)?.t === 'list-agents' && agentsCache) {
        // SW 内存缓存优先（含最近模型），直接回 panel；host 探测兜底
        chrome.runtime.sendMessage({ t: 'agents', agents: agentsCache }).catch(() => {})
        return { ok: true }
      }
      return { ok: nmPort.send(msg.msg as ExtToHost) }
  }
  return undefined
}

// host → panel 直通
nmPort.onMessage((m) => {
  const msg = m as any
  if (msg?.t === 'agents') {
    // host 探测结果可能晚于 task-meta（无 model）：merge lastModels 后缓存下发，
    // 并取代原帧（原样转发会把 panel 已 merge 的状态覆盖回无 model 版）
    agentsCache = (msg.agents as AgentStatus[]).map((a) =>
      lastModels.has(a.id) ? { ...a, model: lastModels.get(a.id) } : a,
    )
    chrome.runtime.sendMessage({ t: 'agents', agents: agentsCache }).catch(() => {})
    return
  }
  // 捕获会话 id 供追问（claude init 事件捕获，task-done 兜底）
  if (msg?.t === 'task-meta' || msg?.t === 'task-done') {
    if (msg.sessionId) lastSession = { agentId: currentAgentId, sessionId: msg.sessionId }
    // 记住该 CLI 最近模型，merge 进 agents 缓存即刻下发（下拉展示 claude · GLM-5.2）
    if (msg.model) {
      lastModels.set(currentAgentId, msg.model)
      if (agentsCache) {
        agentsCache = agentsCache.map((a) => (a.id === currentAgentId ? { ...a, model: msg.model } : a))
        chrome.runtime.sendMessage({ t: 'agents', agents: agentsCache }).catch(() => {})
      }
    }
  }
  chrome.runtime.sendMessage(m).catch(() => {})
})
nmPort.onDisconnect(() => {
  chrome.runtime
    .sendMessage({ t: '__host-disconnected' } as HostToExt)
    .catch(() => {})
})

/** 追问轮：上下文在 CLI 会话里，host 直接 resume，无提取/无正文 */
function startFollowUp(agentId: string, sessionId: string, instruction: string) {
  if (!instruction.trim()) return { error: 'empty-instruction' }
  const taskId = `t${Date.now().toString(36)}`
  currentTask = null // 追问轮不占任务位（panel 侧 streaming 状态由 chunk 驱动）
  const ok = nmPort.send({
    t: 'task-start',
    task: {
      taskId, agentId, resumeSessionId: sessionId, instruction,
      page: { url: '', title: '追问', extractor: 'follow-up', approxTokens: 0 },
    },
  })
  if (!ok) return { error: 'host-not-found', lastError: nmPort.lastError }
  // host 的 Task 等 contentReady 才 run——补发空正文分片（done:true）
  nmPort.send({ t: 'task-content', taskId, seq: 0, text: '', done: true })
  return { ok: true, taskId }
}

async function startSummarize(agentId: string, workflow: string, instruction?: string) {
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
  currentAgentId = agentId
  currentTask = { taskId, page: meta, content: contentMarkdown }

  const ok = nmPort.send({
    t: 'task-start',
    task: { taskId, agentId, workflow, instruction, page: meta },
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
