/**
 * SW 编排中枢：action 点击开 Side Panel → 提取 → task-start/content → 转发流。
 * 消息面（与 Side Panel 的 runtime 通信）刻意最小：
 *   panel → SW: {t:'summarize', agentId, workflow, skills?} / {t:'cancel'} / {t:'new-session'} / {t:'panel-ready'} / {t:'nm', msg}
 *   SW → panel: 直接转发 host 的 HostToExt 帧
 */
import { nmPort } from '../lib/nmport.js'
import type { AgentStatus, ExtToHost, HostToExt, PageContent } from '@ai-page-dive/shared'

// host 最低兼容版本：协议新增依赖消息时（如 heartbeat）才抬高。旧 host 对新消息
// 静默无响应，症状是「按钮无反应」——在 panel-ready 时一次说清而不是让用户猜
const MIN_HOST_VERSION = '0.1.0'

function versionLt(a: string, b: string): boolean {
  const [a1, a2, a3] = a.split('.').map(Number)
  const [b1, b2, b3] = b.split('.').map(Number)
  return a1 !== b1 ? a1 < b1 : a2 !== b2 ? a2 < b2 : a3 < b3
}

// ponytail: 单任务状态（SW 可能重启丢内存态，重启后靠 panel 重新 ping 恢复 UI）
let currentTask: {
  taskId: string
  page: Omit<PageContent, 'contentMarkdown'>
  /** 正文发送完成后即清空——SW 常驻数 MB 死重只会抬高被回收概率 */
  content: string
  /** 发送侧总字符数（done 片 total）：content-received 对账用 */
  expectedChars?: number
} | null = null

// 上一轮完成的会话（追问用）：agent + CLI 会话 id + 首轮历史文件路径。
// historyPath：追问轮 append 进同一文件——历史详情还原完整多轮对话。
// 同步持久化到 chrome.storage.session：MV3 SW 30s 空闲即回收，纯内存态在
// 「看完总结 → 隔一分钟追问」场景下必丢（session-lost）。storage.session 随
// 浏览器会话存活，SW 冷启动时恢复（restoreState）。
let lastSession: { agentId: string; sessionId: string; historyPath?: string } | null = null
// 当前任务用的 agent（task-meta 到达时此刻的 agent 即会话归属）
let currentAgentId = 'claude'

/** lastSession/currentAgentId/lastModels 的 session 级持久化（SW 回收后恢复）。
 * 防御式访问：storage 权限缺失/老 Chrome 时优雅退化为纯内存（旧行为），
 * 绝不让持久化异常打断 host 帧转发链 */
function persistSession() {
  try {
    chrome.storage?.session?.set({ lastSession, currentAgentId, lastModels: [...lastModels] } as any)?.catch?.(() => {})
  } catch { /* 无 storage 权限：退化纯内存 */ }
}
// SW 顶层不能 await（listener 注册必须同步）——恢复放微任务。handleMessage 的
// followUp 分支是异步的，微任务先于任何用户消息执行完，无竞态。
void restoreSession()
async function restoreSession() {
  try {
    const s = (await chrome.storage?.session?.get?.(['lastSession', 'currentAgentId', 'lastModels'])) as Record<string, any> | undefined
    if (s?.lastSession) lastSession = s.lastSession
    if (s?.currentAgentId) currentAgentId = s.currentAgentId
    if (Array.isArray(s?.lastModels)) for (const [k, v] of s.lastModels) lastModels.set(k, v)
  } catch { /* 无 storage 权限：退化纯内存 */ }
}
// 每个 CLI 最近使用的模型（下拉展示用）：agentId → model。
// 独立于 agentsCache 存活——host 的 agents 帧可能在 task-meta 之后才到（探测慢），
// 若不独立 merge 会被无 model 的 fresh 列表覆盖。
const lastModels = new Map<string, string>()

// 总结目标：action 点击的 tab（activeTab 授权随手势生效，其他 tab 无授权）
let target: chrome.tabs.Tab | null = null

// agents 列表缓存（合并最近模型后驻留 SW；SW 重启后首次 list-agents 仍走 host）
let agentsCache: AgentStatus[] | null = null

// 钉住（默认关）：openPanelOnActionClick 模式下 action.onClicked 不触发，
// activeTab 授权链断裂（点总结 → executeScript 被拒 → no-permission，playwright 实证）。
// 默认走 onClicked → sidePanel.open() 路径：点图标即开面板且手势刷新授权。
let pinned = false
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: pinned }).catch(() => {})

// 面板作用域 = tab 维度（锚定页签）：action 点击的 tab 记为 panelTabId 并
// setOptions(enabled:true)（含 path），同窗口其他 tab 在 onActivated 时逐个
// setOptions(enabled:false)——官方 site-scoped 机制：切到 disabled tab 时
// Chrome 自动收起已开面板（"it will close"，官方文档），切回/重点图标即恢复。
//
// ⚠️ 只做 per-tab 开关，绝不动全局默认（无 tabId 的 setOptions 必须保持
// enabled:true）：全局关死会使 sidePanel.open({tabId}) 永远不满足「该 tab
// 面板已激活」前置（真机 probe 实证报 "No active side panel for tabId"）。
// 恢复代价：切回锚定 tab 面板不会自动弹出（open 需用户手势），重点一次图标。

// 面板归属的 tab（点开面板的那次 action 点击所在页）。总结目标 = 该 tab，
// 不随用户切换 tab 而跟随变化。
let panelTabId: number | null = null

/** 锚定/解除锚定：enable 面板所在 tab、disable 其他 tab（锚定语义的落地开关） */
function anchorPanel(tabId: number) {
  chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true }).catch(() => {})
}
function unanchorPanel(tabId: number) {
  chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {})
}

chrome.action.onClicked.addListener((tab) => {
  // 换 tab 开面板 = 换锚：旧锚定 tab 解除 disable
  if (panelTabId !== null && panelTabId !== tab.id) unanchorPanel(panelTabId)
  target = tab
  panelTabId = tab.id ?? null
  if (tab.id != null) anchorPanel(tab.id)
  // 直接 open：不夹 setOptions / 不吞错。open 要求 user gesture（onClicked 自带）
  chrome.sidePanel.open({ tabId: tab.id! }).catch((e: unknown) => {
    console.warn('[pd] sidePanel.open failed:', e)
  })
})

const isNormalPage = (u?: string) => !!u && !/^(chrome|edge|about|chrome-extension|devtools|view-source|file|data|blob):/.test(u)

// 切 tab：离开锚定 tab → 该 tab 面板 disabled，Chrome 自动收起面板；
// 切回锚定 tab → 刷新 page-meta（tips 条同步，导航后 meta 可能已变）。
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (panelTabId === null || panelTabId === tabId) {
    if (panelTabId === tabId) {
      chrome.runtime.sendMessage({ t: 'page-meta', page: pageMeta() }).catch(() => {})
    }
    return
  }
  unanchorPanel(tabId)
})
// ⚠️ 已知边界（设计内）：锚定 tab 内导航（tabId 不变）不触发 onActivated，
// 面板保持可见——锚定语义是「页签」而非「URL」，与 Gemini 内置面板一致。
// 目标 tab 内导航：activeTab 授权随导航失效（url 变不可见），保持 target 由
// 注入兜底；url 仍可见（同源导航）则刷新 meta
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (target?.id === tabId && info.status === 'complete' && isNormalPage(tab.url)) {
    target = tab
    chrome.runtime.sendMessage({ t: 'page-meta', page: pageMeta() }).catch(() => {})
  }
})
// 面板 tab 被关闭：重置作用域（运行中任务交给既有 cancel 语义，不强杀）
chrome.tabs.onRemoved.addListener((tabId) => {
  if (panelTabId === tabId) {
    panelTabId = null
    target = null
  }
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
      // 面板打开时对齐：面板 dock 在 panelTabId 上（= 打开面板时 action 手势
      // 授权过的那个 tab）。SW 重启丢 panelTabId 态时 fallback 当前活跃普通页。
      if (!panelTabId || !target) {
        const [active] = await chrome.tabs
          .query({ active: true, lastFocusedWindow: true })
          .catch(() => [])
        if (active?.id && isNormalPage(active.url)) {
          panelTabId = active.id
          target = active
          anchorPanel(active.id)
        }
      }
      // probe 失败时带上 NM 断连错误（forbidden=ID 未登记 vs not found=host 未装）
      const r = await nmPort.probe()
      // 版本握手：host 过旧时带提示（panel 一次性横幅），升级命令一条到底
      const outdated =
        r.ok && r.hostVersion && versionLt(r.hostVersion, MIN_HOST_VERSION)
          ? `本机组件版本过低（${r.hostVersion} < ${MIN_HOST_VERSION}），请在终端执行：npm i -g ai-page-dive`
          : undefined
      // tips 条元数据无论 probe 成败都带回（panel 已开就有目标页）
      return { ...r, ...(r.ok ? {} : { nmError: nmPort.lastError }), ...(outdated ? { outdated } : {}), page: pageMeta() }
    }
    case 'summarize': {
      const instruction = msg.instruction as string | undefined
      const skills = msg.skills as string[] | undefined
      const lang = msg.lang as string | undefined
      const attachments = msg.attachments as { name: string; text: string }[] | undefined
      // 追问轮：复用上一轮 CLI 会话（claude --resume），不重新提取页面。
      // SW 休眠丢 lastSession 时明确报错——静默降级为新总结会让用户误以为在追问
      if (msg.followUp === true) {
        // SW 恰在恢复中（微任务竞态窗）时补一次同步恢复——storage.session 读取 <1ms
        if (!lastSession) await restoreSession()
        if (!lastSession) return { error: 'session-lost' }
        const r = startFollowUp(lastSession.agentId, lastSession.sessionId, instruction ?? '', lastSession.historyPath, attachments)
        return { ...r, agentId: lastSession.agentId }
      }
      return startSummarize(msg.agentId as string, msg.workflow as string, instruction, skills, lang, attachments)
    }
    case 'resume-history': {
      // 历史详情「继续对话」：装载历史会话（SW 记 lastSession），后续 followUp 走 --resume。
      // 在途任务先取消——否则旧任务的尾随 chunk 污染恢复的对话（panel taskId 已重置 null 放行一切）
      const { agentId, sessionId, historyPath } = msg
      if (!agentId || !sessionId) return { error: 'bad-request' }
      if (currentTask) cancelCurrent()
      lastSession = { agentId, sessionId, historyPath }
      currentAgentId = agentId
      persistSession()
      return { ok: true }
    }
    case 'cancel':
      return cancelCurrent()
    case 'new-session':
      // 面板「新对话」：在跑的任务走既有取消路径，lastSession 清空——
      // 下一轮总结全新开始（不再 resume 上一条 CLI 会话）
      if (currentTask) cancelCurrent()
      lastSession = null
      persistSession()
      return { ok: true }
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

/** 取消进行中任务（new-session 复用）；返回 undefined 表示无任务在跑 */
function cancelCurrent() {
  if (currentTask) {
    nmPort.send({ t: 'task-cancel', taskId: currentTask.taskId })
    return { ok: true }
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
  // 任务终局：释放内存 + 防后续 cancel 发过期 taskId。严格按 taskId 匹配——
  // 旧任务晚到的 task-error 会清掉新任务的取消句柄（`|| msg.t === 'task-error''
  // 兜底无依据：task-error 帧协议上必带 taskId）
  if (
    (msg?.t === 'task-done' || msg?.t === 'task-error') &&
    currentTask &&
    msg.taskId === currentTask.taskId
  ) {
    currentTask = null
  }
  // host 心跳帧：仅保活（消息活动重置 SW idle 计时器），不转发给 panel
  if (msg?.t === 'heartbeat') return
  // 正文完整性回执：与发送侧 total 对账，不一致 = NM 途中丢片——取消任务。
  // 半截正文会被 CLI 总结得「有模有样」，比直接失败更误导
  if (msg?.t === 'content-received' && currentTask && msg.taskId === currentTask.taskId) {
    if (currentTask.expectedChars !== undefined && msg.chars !== currentTask.expectedChars) {
      console.warn(`[pd] content mismatch: sent ${currentTask.expectedChars}, host got ${msg.chars}`)
      nmPort.send({ t: 'task-cancel', taskId: msg.taskId })
      chrome.runtime
        .sendMessage({ t: 'task-error', taskId: msg.taskId, code: 'spawn-fail', message: '正文传输不完整（NM 丢片），已取消——请重试' })
        .catch(() => {})
      currentTask = null
    }
    return // 回执不转发（panel 不消费）
  }
  // 捕获会话 id 供追问（claude init 事件捕获，task-done 兜底）；historyPath 续存
  // （追问轮 task-done 带回首轮文件路径，覆盖亦无损——路径不变）
  if (msg?.t === 'task-meta' || msg?.t === 'task-done') {
    if (msg.sessionId) {
      lastSession = { agentId: currentAgentId, sessionId: msg.sessionId, historyPath: msg.historyPath ?? lastSession?.historyPath }
      persistSession()
    }
    // 记住该 CLI 最近模型，merge 进 agents 缓存即刻下发（下拉展示 claude · GLM-5.2）
    if (msg.model) {
      lastModels.set(currentAgentId, msg.model)
      persistSession()
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
function startFollowUp(agentId: string, sessionId: string, instruction: string, historyPath?: string, attachments?: { name: string; text: string }[]) {
  if (!instruction.trim() && !attachments?.length) return { error: 'empty-instruction' }
  const taskId = `t${Date.now().toString(36)}`
  // 追问轮也占任务位（taskId）：进行中可取消
  const ok = nmPort.send({
    t: 'task-start',
    task: {
      taskId, agentId, resumeSessionId: sessionId, historyPath, instruction, attachments,
      page: { url: '', title: '追问', extractor: 'follow-up', approxTokens: 0 },
    },
  })
  if (!ok) return { error: 'host-not-found', lastError: nmPort.lastError }
  currentTask = { taskId, page: { url: '', title: '追问', extractor: 'follow-up', approxTokens: 0 }, content: '' }
  // host 的 Task 等 contentReady 才 run——补发空正文分片（done:true）
  nmPort.send({ t: 'task-content', taskId, seq: 0, text: '', done: true })
  return { ok: true, taskId }
}

/** 逐 frame 提取，取正文最长者为该页内容（iframe SPA：top frame 往往只有壳） */
async function extractBest(tabId: number): Promise<PageContent | { error: string }> {
  const results = (await chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const l = (globalThis as any).__pagediveExtract
        return l ? l() : { error: 'no-extractor' }
      },
    })
    .catch(() => undefined)) as { result: PageContent | { error: string } }[] | undefined
  const pages = (results ?? []).map((r) => r.result).filter((p): p is PageContent => !!p && !('error' in p))
  if (!pages.length) {
    const errs = (results ?? []).map((r) => (r.result && 'error' in r.result ? r.result.error : '')).filter(Boolean)
    return { error: errs.includes('empty-content') ? 'empty-content' : 'no-permission' }
  }
  return pages.reduce((a, b) => (b.contentMarkdown.length > a.contentMarkdown.length ? b : a))
}

/** 当前总结目标页元数据（tips 条展示用）；target 无 url 时（无 tabs 权限）fallback tab query */
function pageMeta(): { title: string; url: string; favIconUrl?: string } | null {
  if (target?.url && isNormalPage(target.url)) {
    return { title: target.title ?? '', url: target.url, favIconUrl: target.favIconUrl }
  }
  return null
}

async function startSummarize(agentId: string, workflow: string, instruction?: string, skills?: string[], lang?: string, attachments?: { name: string; text: string }[]) {
  // target：action 点击的 tab（activeTab 授权随手势生效）。SW 重启丢态或 panel
  // 直接点按钮时 fallback 到当前活跃 tab——无授权的 tab 注入会失败并提示，
  // 不会造成越权（executeScript 直接被 Chrome 拒绝）。
  // fallback 只认普通网页：panel 自己常是 lastFocusedWindow 的 active「页」，
  // chrome-extension:// 的它绝不该被选为总结目标
  let tab = target?.id ? await chrome.tabs.get(target.id).catch(() => null) : null
  if (!tab) {
    const [active] = (await chrome.tabs.query({ active: true, lastFocusedWindow: true })) ?? []
    tab = active && isNormalPage(active.url) ? active : null
  }
  if (!tab?.id) return { error: 'no-tab' }
  // chrome:// 等受限页面无法注入（file/view-source/data 同样不可注入，
  // 归入 unsupported 而非误导用户的 no-permission）
  if (!isNormalPage(tab.url)) {
    return { error: 'unsupported-page', url: tab.url }
  }

  // content script 需 modules → 动态 files 注入（activeTab 授权下用户手势有效）。
  // allFrames：豆包文档等 SPA 正文渲染在 iframe，只注 top frame 会拿到空壳误报
  // 「无内容」——跨域 frame 的注入同样被 activeTab 覆盖（手势授予整个 tab）
  let injectErr: string | null = null
  await chrome.scripting
    .executeScript({
      target: { tabId: tab.id!, allFrames: true },
      files: ['content.js'],
    })
    .catch((e) => {
      injectErr = String(e?.message ?? e)
    })
  if (injectErr) {
    // 授权失效（无手势/已切页）：原样带回错误文本，panel 给重授权指引
    return { error: 'no-permission', detail: injectErr }
  }
  const page = await extractBest(tab.id!)
  if ('error' in page) return { error: page.error }

  const { contentMarkdown, ...meta } = page
  const taskId = `t${Date.now().toString(36)}`
  currentAgentId = agentId
  // 新一轮总结开始：旧会话失效（防切换 CLI 后追问串回旧 agent 的会话）
  lastSession = null
  persistSession()
  currentTask = { taskId, page: meta, content: contentMarkdown }

  // 提取成功 → 下发目标页元数据（panel tips 条「正在分享 …」；notice=截断/低置信提示）
  chrome.runtime.sendMessage({ t: 'page-meta', page: { title: tab.title ?? meta.title, url: tab.url ?? meta.url, favIconUrl: tab.favIconUrl, notice: meta.notice } }).catch(() => {})

  const ok = nmPort.send({
    t: 'task-start',
    // skills：panel 选中的技能名，host 读 ~/.ai-page-dive/skills 正文拼进 prompt
    task: { taskId, agentId, workflow, instruction, skills, lang, attachments, page: meta },
  })
  if (!ok) {
    currentTask = null
    return { error: 'host-not-found', lastError: nmPort.lastError }
  }

  // 正文分片 ≤512KB 字节维度（CJK 3 字节/字符，按字符切会击穿 NM 1MB——
  // 与 host 侧 sendChunk 同一标准：字符数起步、超字节就二分收缩）。
  // done 片带 total：host 回 content-received 对账，丢片即取消（宁可失败不可半截总结）
  const CH = 512 * 1024
  let i = 0
  let seq = 0
  let total = 0
  while (i < contentMarkdown.length) {
    let end = Math.min(i + CH, contentMarkdown.length)
    while (end > i && new Blob([contentMarkdown.slice(i, end)]).size > CH) {
      end = Math.floor((i + end) / 2)
    }
    const done = end >= contentMarkdown.length
    total += end - i
    nmPort.send({
      t: 'task-content',
      taskId,
      seq,
      text: contentMarkdown.slice(i, end),
      done,
      ...(done ? { total } : {}),
    })
    i = end
    seq++
  }
  // 正文已全量送达 host：SW 不再需要这份内存（保留 taskId/page 供取消与终局对账）。
  // 回执对账挂 currentTask.expectedChars：content-received 到达时校验
  currentTask.content = ''
  currentTask.expectedChars = total
  return { ok: true, taskId }
}
