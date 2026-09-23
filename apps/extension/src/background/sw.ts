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

/** 面板 → SW → host 的附件载荷（r12：图片走 b64——host 落盘持久化，文本走 text） */
type AttachMsg = { name: string; text?: string; b64?: string; mime?: string; kind?: 'text' | 'image' }

function versionLt(a: string, b: string): boolean {
  // parseInt || 0：预发布号（0.1.0-beta）的 Number() 是 NaN，比较恒 false 会
  // 静默丢失 outdated 提示——NaN 归 0 让比较始终有定义
  const n = (s: string) => parseInt(s, 10) || 0
  const [a1, a2, a3] = a.split('.').map(n)
  const [b1, b2, b3] = b.split('.').map(n)
  return a1 !== b1 ? a1 < b1 : a2 !== b2 ? a2 < b2 : a3 < b3
}

// ponytail: 单任务状态（SW 可能重启丢内存态，重启后靠 panel 重新 ping 恢复 UI）
let currentTask: {
  taskId: string
  /** 任务源页签（r12）：会话归档 + 任务帧路由都按它——面板换锚到别的页签后，
   * 旧任务的流不得漏进新面板（用户看到的 loading 必属当前页签） */
  tabId: number
  page: Omit<PageContent, 'contentMarkdown'>
  /** 正文发送完成后即清空——SW 常驻数 MB 死重只会抬高被回收概率 */
  content: string
  /** 发送侧总字符数（done 片 total）：content-received 对账用 */
  expectedChars?: number
  /** 任务起跑时刻（task-alive 的 elapsedMs 计算，给 panel 进度感） */
  startedAt: number
} | null = null

// 各页签最近完成的会话（追问用）：agent + CLI 会话 id + 首轮历史文件路径。
// r12 按页签归档：会话跟「总结目标页签」走——A 页签的会话绝不串进 B 页签的
// 新对话（B 独立开新总结），切回 A 追问仍接原会话。tab 关闭即清理。
// historyPath：追问轮 append 进同一文件——历史详情还原完整多轮对话。
// 同步持久化到 chrome.storage.session：MV3 SW 30s 空闲即回收，纯内存态在
// 「看完总结 → 隔一分钟追问」场景下必丢（session-lost）。storage.session 随
// 浏览器会话存活，SW 冷启动时恢复（restoreSession）。
type Session = { agentId: string; sessionId: string; historyPath?: string }
const sessions = new Map<number, Session>()
// 当前任务用的 agent（task-meta 到达时此刻的 agent 即会话归属）
let currentAgentId = 'claude'
// 会话态是否已被本 SW 生命周期内的显式动作（summarize/resume-history/new-session）触碰。
// restoreSession 是异步微任务，冷启动同 tick 若已被消息设置/清空，不得用旧持久化态覆盖
// （尤其 new-session 显式清空 lastSession=null，无条件恢复会把旧会话「复活」）
let sessionTouched = false

/** lastSession/currentAgentId/lastModels 的 session 级持久化（SW 回收后恢复）。
 * 防御式访问：storage 权限缺失/老 Chrome 时优雅退化为纯内存（旧行为），
 * 绝不让持久化异常打断 host 帧转发链 */
function persistSession() {
  try {
    chrome.storage?.session?.set({ sessions: [...sessions.entries()], currentAgentId, lastModels: [...lastModels], panelTabId, panelWindowId, disabledTabs: [...disabledTabs] } as any)?.catch?.(() => {})
  } catch { /* 无 storage 权限：退化纯内存 */ }
}
// SW 顶层不能 await（listener 注册必须同步）——恢复放微任务。handleMessage 的
// followUp 分支是异步的，微任务先于任何用户消息执行完，无竞态。
void restoreSession()
async function restoreSession() {
  try {
    const s = (await chrome.storage?.session?.get?.(['sessions', 'currentAgentId', 'lastModels', 'panelTabId', 'panelWindowId', 'disabledTabs'])) as Record<string, any> | undefined
    // 已被显式动作触碰（含 new-session 清空）则不恢复会话/agent——旧持久化态不得复活。
    // lastModels 是纯展示缓存，逐 key 补全无害，不受 touched 约束
    if (!sessionTouched) {
      if (Array.isArray(s?.sessions)) for (const [k, v] of s.sessions) if (typeof k === 'number' && v?.sessionId) sessions.set(k, v)
      if (s?.currentAgentId) currentAgentId = s.currentAgentId
    }
    // 锚定态恢复（r9-backlog：SW 回收后 onActivated 不知该 unanchor 谁，切 tab 面板
    // 不再收起——锚定承诺失效直到重点图标）。锚定非会话语义，不受 touched 约束；
    // tab 已关的场景由 setOptions 的 catch 兜底，无害
    if (typeof s?.panelTabId === 'number') panelTabId = s.panelTabId
    if (typeof s?.panelWindowId === 'number') panelWindowId = s.panelWindowId
    if (Array.isArray(s?.disabledTabs)) for (const id of s.disabledTabs) if (typeof id === 'number') disabledTabs.add(id)
    if (Array.isArray(s?.lastModels)) for (const [k, v] of s.lastModels) if (!lastModels.has(k)) lastModels.set(k, v)
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
// r8-ext：缓存写入时刻——60s TTL。r6 的「有 CLI 可用即命中」在部分可用（只有
// claude）时把缓存冻死整个浏览器会话（NM port 保活 SW 不回收），后装的第二个
// CLI 永不出现，唯一恢复途径是重启浏览器
let agentsCacheAt = 0
const AGENTS_CACHE_TTL_MS = 60_000

// 钉住（默认关）：openPanelOnActionClick 模式下 action.onClicked 不触发，
// activeTab 授权链断裂（点总结 → executeScript 被拒 → no-permission，playwright 实证）。
// 默认走 onClicked → sidePanel.open() 路径：点图标即开面板且手势刷新授权。
// r8-ext：删除 set-pinned 消息 handler（无 UI 调用方的死路径）；openPanelOnActionClick
// 恒 false（面板由 action 点击经 chrome.sidePanel.open 打开，见 action onClick）
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch((e: unknown) => {
  console.warn('[pd] setPanelBehavior failed:', e)
})

// 面板作用域 = tab 维度（锚定页签）：action 点击的 tab 记为 panelTabId 并
// setOptions(enabled:true)（含 path），全局默认 enabled:false，非锚 tab per-tab
// disable——Chrome 147 真机实证（r15 probe）：只有「全局 false + 锚 per-tab true」
// 才能让已开面板在切到非锚 tab 时收起、切回锚 tab 时恢复；只做 per-tab disable
// 时已开面板穿行所有 tab 不收起（用户实锤的「切页签不隐藏」）。
//
// r15 修订（推翻 r8「全局关死废 open 前置」）：全局 false 下 open({tabId}) 的
// 前置是「目标 tab 的面板已激活」——锚定路径恒先 anchorPanel（per-tab true）
// 再 open，前置成立（真机热键实证面板正常打开）。r8 踩的坑是全局 false 而
// 未先设 per-tab true 就 open。

// 面板归属的 tab（点开面板的那次 action 点击所在页）。总结目标 = 该 tab，
// 不随用户切换 tab 而跟随变化。panelWindowId：锚所在窗口（跨窗口不拆台判断）。
// 两者随锚定变更持久化到 storage.session（SW 回收后恢复，见 restoreSession）
let panelTabId: number | null = null
let panelWindowId: number | null = null
// 已 disable 的 tab 记账（r13）：幂等键——避免每次 onActivated 都对整窗口重发
// setOptions。随 panelTabId 一起持久化 storage.session（浏览器关闭与 Chrome 侧
// per-tab options 同步清空，不跨会话残留）
const disabledTabs = new Set<number>()

/** 锚定/解除锚定：enable 面板所在 tab、disable 其他 tab（锚定语义的落地开关）。
 * 锚定同时压全局默认 enabled:false（r15）：已开面板的收起/恢复只在全局 false
 * 下生效（Chrome 147 真机实证）。幂等——重复 setOptions 同值无副作用。
 * setOptions 被拒是真异常（tab 已关/老 Chrome），静默会让面板收起行为失效无痕 */
function anchorPanel(tabId: number) {
  disabledTabs.delete(tabId)
  chrome.sidePanel.setOptions({ enabled: false }).catch((e: unknown) => {
    console.warn('[pd] anchorPanel global setOptions failed:', e)
  })
  chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true }).catch((e: unknown) => {
    console.warn('[pd] anchorPanel setOptions failed:', e)
  })
  // r16：锚变更广播——存活面板（换锚不重载 React）据此刷新收养邮戳的核验基准；
  // 新开面板靠 panel-ready/get-state 兜底（listener 未就绪时本帧丢失无害）
  sendToPanel({ t: 'panel-anchor', tabId })
}
function unanchorPanel(tabId: number) {
  disabledTabs.add(tabId)
  chrome.sidePanel.setOptions({ tabId, enabled: false }).catch((e: unknown) => {
    console.warn('[pd] unanchorPanel setOptions failed:', e)
  })
}

/** 预 disable（r13 根治「切 tab 面板首次不收起」）：Chrome 在切换瞬间读目标 tab
 *  的 per-tab options 决定面板显隐——此前靠 onActivated 事后 disable，而 setOptions
 *  落定时面板已按默认（enabled）显示，Chrome 不追溯收起，于是每个 tab 首次切到
 *  必不收起、第二次才收起。改为锚定存续期把（锚窗口）所有非锚 tab 提前 disable，
 *  切换决策时刻 tab 已是 disabled，首次即收起。切回锚定 tab 面板恢复显示是
 *  Chrome 的 per-tab 面板状态原生行为。⚠️ 只 per-tab，绝不动全局默认 setOptions
 *  （全局关死会废掉 sidePanel.open 的前置，r8 真机实证） */
async function ensureTabsDisabled() {
  if (panelTabId === null) return
  const tabs = await chrome.tabs.query(panelWindowId == null ? {} : { windowId: panelWindowId }).catch(() => [] as chrome.tabs.Tab[])
  for (const t of tabs) {
    if (t.id == null || t.id === panelTabId || disabledTabs.has(t.id)) continue
    unanchorPanel(t.id)
  }
}

/** 任务/页面帧发面板。r12 曾按锚定/任务源 tab 用 tabs.sendMessage 定向——
 * sidePanel 不是 tab 帧（不含 content script），任务帧 100% 送不到（真机实证：
 * CLI 跑完落盘、面板永 loading）。sidePanel 唯一可靠通路是 runtime 广播；
 * panel 侧 finished/taskId 台账已把迟到/跨任务帧的拒收兜住。真正的定向
 * （换锚后旧任务流不漏进新面板、跨窗口双面板互不劫持）需 port 架构，v2 再做 */
function sendToPanel(m: unknown): void {
  chrome.runtime.sendMessage(m).catch(() => {})
}

/** 锚定 + 开面板（onClicked 原路径，toggle 分流后复用） */
function anchorAndOpen(tab: chrome.tabs.Tab) {
  // 换 tab 开面板 = 换锚：旧锚定 tab 解除 disable。跨窗口例外（r9-backlog）：
  // 双窗口各自开面板是合法形态，另一窗口的锚不拆台（面板不强制收起）
  if (panelTabId !== null && panelTabId !== tab.id && panelWindowId === tab.windowId) unanchorPanel(panelTabId)
  target = tab
  panelTabId = tab.id ?? null
  panelWindowId = tab.windowId ?? null
  persistSession()
  if (tab.id != null) anchorPanel(tab.id)
  // 面板开张即把本窗口其余 tab 预 disable（r13）：之后每次切 tab 首次即收起
  void ensureTabsDisabled()
  // 直接 open：不夹 setOptions / 不吞错。open 要求 user gesture（onClicked 自带）
  chrome.sidePanel.open({ tabId: tab.id! }).catch((e: unknown) => {
    console.warn('[pd] sidePanel.open failed:', e)
  })
}

chrome.action.onClicked.addListener((tab) => {
  // r30-2 toggle：恒走同步锚定+open（open 只认 onClicked 的同步 user gesture，
  // r30 v1 在 await/回调里调 open 直接抛错——面板连开都开不开，本回归实证）。
  // 收起仲裁在 panel 侧：open 对已开面板是无害 no-op，同时广播 panel-toggle，
  // panel 比对「点击 tab === 自己的锚 && 自身可见」才 window.close()（sidePanel
  // 无 SW 侧 close API）。面板未开时广播无接收端，静默丢弃。SW 冷启动无需
  // 任何状态——panel 自己记得锚，不依赖 panelTabId 恢复
  // ⚠️ toggle 广播必须先于 anchorAndOpen：panel-anchor 帧会把 panel 的锚更新成
  // 本次点击 tab，若 toggle 后到，换锚场景（B tab 按快捷键、锚原是 A）会误匹配
  // 新锚把自己关掉。先发的 toggle 比对的是旧锚——只有「同 tab 再按」才匹配
  chrome.runtime.sendMessage({ t: 'panel-toggle', tabId: tab.id ?? undefined }).catch(() => {})
  anchorAndOpen(tab)
})

const isNormalPage = (u?: string) => !!u && !/^(chrome|edge|about|chrome-extension|devtools|view-source|file|data|blob):/.test(u)

// 切 tab：离开锚定 tab → 非 anchor tab 面板 disabled，Chrome 自动收起面板；
// 切回锚定 tab → 刷新 page-meta（tips 条同步，导航后 meta 可能已变）。
// r12：先 await restoreSession——SW 冷启动竞态下 panelTabId 尚为 null，早退分支
// 会吞掉 unanchor，切 tab 面板不收起（A 页签的 loading 流继续显示在 B 页签）
// r13：单点 unanchor 收敛为 ensureTabsDisabled——它涵盖「本次激活的 tab」并补齐
// 历史遗漏（预 disable 语义），windowId 过滤同理只在锚窗口/无窗口态时收
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await restoreSession()
  if (panelTabId === null || panelTabId === tabId) {
    if (panelTabId === tabId) {
      // 面板未开时无接收端是常态（用户收起了面板），静默即可——勿改成 warn 刷屏
      // r8-review：附 pageUnsupported——切 tab 后 placeholder 与当前页事实一致
      sendToPanel({ t: 'page-meta', page: pageMeta(), pageUnsupported: !pageMeta() })
    }
    return
  }
  // 只收锚所在窗口的 tab：其他窗口的 tab 不 disable（跨窗口不拆台，r9-backlog）。
  // panelWindowId 缺失（旧持久化态）时宁可收起——页签独立是硬诉求，收起是安全方向
  if (panelWindowId === null || windowId === panelWindowId) {
    if (!disabledTabs.has(tabId)) unanchorPanel(tabId)
    void ensureTabsDisabled()
  }
})
// 锚定存续期新建的 tab 预 disable（r13）：Ctrl+T 新建即切过去，onActivated 时
// setOptions 已落定，首次即收起。同窗口过滤——他窗口新 tab 不拆台（r9-backlog）。
// await restoreSession（r13-review）：SW 被 onCreated 冷唤醒的窗口内 panelTabId
// 尚为 null（与 onActivated 的 r12 竞态同源，曾漏防——新 tab 首显面板一次）
chrome.tabs.onCreated.addListener(async (tab) => {
  await restoreSession()
  if (panelTabId !== null && tab.id != null && tab.id !== panelTabId && tab.windowId === panelWindowId) {
    unanchorPanel(tab.id)
  }
})
// ⚠️ 已知边界（设计内）：锚定 tab 内导航（tabId 不变）不触发 onActivated，
// 面板保持可见——锚定语义是「页签」而非「URL」，与 Gemini 内置面板一致。
// 目标 tab 内导航：activeTab 授权随导航失效（url 变不可见），保持 target 由
// 注入兜底；url 仍可见（同源导航）则刷新 meta。
// r8-review：导航到 chrome:// 也推送（带 pageUnsupported）——此前只在 normal 时
// 推送，反向场景提示缺失，用户输入后才吃到 unsupported-page 错误
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (target?.id === tabId && info.status === 'complete' && tab.url) {
    // r11：导航后旧页的用量估算不再算数（tips 条「≈N tokens」不得跨页沿用——用量透明是产品卖点）
    if (isNormalPage(tab.url)) { target = tab; lastApproxTokens = 0 }
    sendToPanel({ t: 'page-meta', page: isNormalPage(tab.url) ? pageMeta() : null, pageUnsupported: !isNormalPage(tab.url) })
  }
})
// 面板 tab 被关闭：重置作用域（运行中任务交给既有 cancel 语义，不强杀）
chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.delete(tabId) // r12：页签没了，其会话归档一并清理
  disabledTabs.delete(tabId) // r13：账随 tab 消亡，防 Set 无界增长
  if (panelTabId === tabId) {
    // 反向清扫（r13-review）：锚已失，per-tab disable 失去语义——残余 disabled
    // tab 经 Chrome 原生侧边栏 UI 打不开面板且无自愈路径（仅图标点击才 anchor
    // 单个 tab）。恢复「无锚状态 = 无 per-tab 痕迹」：记账正好是完整残留清单。
    // 与 onClicked 换锚互斥（本分支执行时 panelTabId 仍是旧锚）
    // r15：全局默认一并还原——anchorPanel 压过全局 false，锚死不留全局痕迹
    chrome.sidePanel.setOptions({ enabled: true }).catch(() => {})
    for (const id of [...disabledTabs]) {
      chrome.sidePanel.setOptions({ tabId: id, path: 'sidepanel.html', enabled: true }).catch(() => {})
    }
    disabledTabs.clear()
    panelTabId = null
    panelWindowId = null
    target = null
    persistSession()
  }
})

// 注意：MV3 中 async listener 的返回值会被较新 Chrome 直接当响应回传（Promise 化），
// 绕过 sendResponse——必须用同步壳 return true 保持 channel。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // r33-sec：只收本扩展自家页面的消息——sender 带 tab（content script 场景）或
  // id 非本扩展时拒收。消息面含 summarize/nm 转发等特权操作，放行外来同形帧
  // 等于把 NM 通道暴露给任意注入脚本。本项目 content script 不发消息（提取走
  // executeScript func 直调），拒收无副作用
  if (sender.tab != null || sender.id !== chrome.runtime.id) return
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
      // r16：面板（重）唤起即清完成角标——用户已看到结果，✓ 完成使命
      chrome.action.setBadgeText({ text: '' }).catch(() => {})
      // 面板打开时对齐：面板 dock 在 panelTabId 上（= 打开面板时 action 手势
      // 授权过的那个 tab）。SW 重启丢 panelTabId 态时 fallback 当前活跃普通页。
      if (!panelTabId || !target) {
        const [active] = await chrome.tabs
          .query({ active: true, lastFocusedWindow: true })
          .catch(() => [])
        if (active?.id && isNormalPage(active.url)) {
          // r12-fix：panelWindowId 必须同步补——缺它时 onActivated 的
          // 「windowId === panelWindowId」恒 false，切 tab 永不 unanchor
          // （面板从侧边栏下拉打开/SW 冷启动后走本分支的都中招）
          panelTabId = active.id
          panelWindowId = active.windowId ?? null
          target = active
          anchorPanel(active.id)
          persistSession()
          // r14：非图标点击路径开的面板（侧边栏下拉 / SW 冷启动后重开）此前只锚定
          // 不预 disable——切 tab 时 Chrome 读的是切换瞬间的 per-tab options，事后
          // disable 不追溯收起（真机实验：面板在未用页签恒开，用户抱怨的正是这个）。
          // 补齐与 onClicked 路径相同的收起机器：锚定即预 disable 同窗口其余 tab
          void ensureTabsDisabled()
        }
      }
      // probe 失败时带上 NM 断连错误（forbidden=ID 未登记 vs not found=host 未装）
      const r = await nmPort.probe()
      // 版本握手：host 过旧时带提示（panel 一次性横幅），升级命令一条到底
      const outdated =
        r.ok && r.hostVersion && versionLt(r.hostVersion, MIN_HOST_VERSION)
          ? `本机组件版本过低（${r.hostVersion} < ${MIN_HOST_VERSION}），请在终端执行：npm i -g @aaione/ai-page-dive`
          : undefined
      // tips 条元数据无论 probe 成败都带回（panel 已开就有目标页）。
      // hasSession/activeTask（r4-ux）：面板切 tab 被收起后重开时 React 态已丢——
      // SW 侧活会话透出给 panel 恢复 resumable（追问不再静默降级为全量重总结），
      // 在跑任务透出 taskId 供 panel 重建绑定（迟到 chunk 不再呈现为孤儿流）。
      // r12：都按当前锚定页签过滤——别的页签的会话/任务不属于本面板
      const sess = panelTabId !== null ? sessions.get(panelTabId) : undefined
      return {
        ...r,
        ...(r.ok ? {} : { nmError: nmPort.lastError }),
        ...(outdated ? { outdated } : {}),
        page: pageMeta(),
        // r16：锚定页签透出——panel 未绑定收养任务帧时核邮戳用（防跨页签串台）
        panelTabId,
        // r8-ux：不可提取页（chrome:// 等）前置告知——placeholder 直接说明而非
        // 等用户输入发送后才报「浏览器内置页面无法提取」（预期管理前移）
        pageUnsupported: !!(target && !isNormalPage(target.url)),
        ...(sess
          ? {
              hasSession: true,
              sessionAgentId: sess.agentId,
              // r14-ux：带出历史文件路径——面板被收起后重开（React 态已丢）时，
              // panel 自动 history-read 还原完整多轮对话，而不是一句
              // 「此前对话已清空」（切页签回来内容消失感的另一半根因）
              ...(sess.historyPath ? { historyPath: sess.historyPath } : {}),
            }
          : {}),
        ...(currentTask && currentTask.tabId === panelTabId ? { activeTask: { taskId: currentTask.taskId, startedAt: currentTask.startedAt } } : {}),
      }
    }
    case 'summarize': {
      const instruction = msg.instruction as string | undefined
      const skills = msg.skills as string[] | undefined
      const lang = msg.lang as string | undefined
      const attachments = msg.attachments as AttachMsg[] | undefined
      // 追问轮：复用本页签上一轮 CLI 会话（claude --resume），不重新提取页面。
      // 会话丢失时明确报错——静默降级为新总结会让用户误以为在追问
      if (msg.followUp === true) {
        // SW 恰在恢复中（微任务竞态窗）时补一次同步恢复——storage.session 读取 <1ms
        if (panelTabId === null || !sessions.get(panelTabId)) await restoreSession()
        const sess = panelTabId !== null ? sessions.get(panelTabId) : undefined
        if (!sess) return { error: 'session-lost' }
        const r = startFollowUp(sess.agentId, sess.sessionId, instruction ?? '', sess.historyPath, attachments)
        return { ...r, agentId: sess.agentId }
      }
      return startSummarize(msg.agentId as string, msg.workflow as string, instruction, skills, lang, attachments, msg.historyLimit as number | undefined)
    }
    case 'resume-history': {
      // 历史详情「继续对话」：装载历史会话到当前页签（SW 记 sessions），后续 followUp 走 --resume。
      // 在途任务先取消——否则旧任务的尾随 chunk 污染恢复的对话（panel taskId 已重置 null 放行一切）
      const { agentId, sessionId, historyPath } = msg
      if (!agentId || !sessionId) return { error: 'bad-request' }
      if (currentTask) cancelCurrent()
      sessionTouched = true // 显式设置会话：restoreSession 微任务不得用旧态覆盖
      if (panelTabId !== null) sessions.set(panelTabId, { agentId, sessionId, historyPath })
      currentAgentId = agentId
      persistSession()
      return { ok: true }
    }
    case 'cancel':
      // 带 taskId 时只收割匹配任务：看门狗跨窗口场景——本面板判死的旧任务可能
      // 早已结清、另一窗口正跑新任务，无条件 cancelCurrent 会错杀新面板的任务
      if (msg.taskId && currentTask && msg.taskId !== currentTask.taskId) return { ok: false }
      return cancelCurrent()
    case 'new-session':
      // 面板「新对话」：在跑的任务走既有取消路径，本页签会话清空——
      // 下一轮总结全新开始（不再 resume 上一条 CLI 会话）
      if (currentTask) cancelCurrent()
      sessionTouched = true // 显式清空：restoreSession 微任务不得让旧会话「复活」
      if (panelTabId !== null) sessions.delete(panelTabId)
      persistSession()
      return { ok: true }
    case 'nm':
      // panel → host 的通用转发（list-agents / list-workflows / history 等）
      // r8-ext：命中加 60s TTL（见 agentsCacheAt 注释）——探测要 spawn CLI --version
      // 有秒级成本，60s 内的面板重开不重复探测；过期穿透让新装 CLI 一分钟内出现
      if (
        (msg.msg as any)?.t === 'list-agents' &&
        agentsCache &&
        agentsCache.some((a) => a.available) &&
        Date.now() - agentsCacheAt < AGENTS_CACHE_TTL_MS
      ) {
        // SW 内存缓存优先（含最近模型），直接回 panel；host 探测兜底。
        // r6-ux：仅在有 CLI 可用时缓存命中——零可用 = 用户可能刚装好 CLI，
        // 永远穿透重探测（否则面板永远空态且无自愈入口）
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
    // 终局帧补发：发起面板按 taskId 对号（finished 幂等，双收无害）；host 迟到的
    // 同义帧会被面板 finished 列表拒收——双窗口下也绝不错终局另一面板的新任务。
    // r16：被砍任务属别的页签时（本页签起新总结连坐）文案点名来源页——被折叠的
    // 旧锚面板切回时能看到「谁被取消了」，不再是无解释的凭空终止
    const cross = panelTabId !== null && currentTask.tabId !== panelTabId
    const title = (currentTask.page.title || '其他页签').slice(0, 24)
    chrome.runtime
      .sendMessage({
        t: 'task-error',
        taskId: currentTask.taskId,
        code: 'cancelled',
        message: cross ? `已取消「${title}」页签的在跑任务` : '已取消',
        tabId: currentTask.tabId,
      })
      .catch(() => {})
    currentTask = null
    return { ok: true }
  }
  return undefined
}

/** 新任务起跑前统一收割旧任务：不取消则旧取消句柄被覆盖丢失，
 * 旧 CLI 进程（pgid 树）空跑到 10 分钟超时，白烧用户订阅额度 */
function newTaskId(): string {
  // 毫秒时间戳 + 随机后缀：同毫秒连点/双 panel 有碰撞面
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** NM 单帧 1MB 是 Chrome 平台硬限（非包契约，本地常量）。task-start 帧内嵌
 *  instruction 与全量附件——panel 的 768KB 附件池不含 instruction，长输入 +
 * 满附件仍可击穿帧限（host 侧超限帧即失步自杀收割全部任务）。发送前按
 * JSON 序列化整帧口径兜底，留 64KB 给帧头/协议字段余量 */
const NM_FRAME_MAX = 1024 * 1024
const frameTooLarge = (frame: unknown) => new Blob([JSON.stringify(frame)]).size > NM_FRAME_MAX - 64 * 1024

// host → panel 直通
nmPort.onMessage((m) => {
  const msg = m as any
  if (msg?.t === 'agents') {
    // host 探测结果可能晚于 task-meta（无 model）：merge lastModels 后缓存下发，
    // 并取代原帧（原样转发会把 panel 已 merge 的状态覆盖回无 model 版）
    agentsCache = (msg.agents as AgentStatus[]).map((a) =>
      lastModels.has(a.id) ? { ...a, model: lastModels.get(a.id) } : a,
    )
    agentsCacheAt = Date.now()
    chrome.runtime.sendMessage({ t: 'agents', agents: agentsCache }).catch(() => {})
    return
  }
  // 任务终局清理移到本 handler 末尾（r12）：终局帧自身仍需 currentTask 路由到
  // 任务源页签 + 会话按源页签归档——先清会让终局帧漏到当前锚定页签的新面板
  // host 心跳帧：保活（消息活动重置 SW idle 计时器）+ 转译成 task-alive 喂 panel 看门狗。
  // 不原样转发 heartbeat（避免 UI 出现 heartbeat 字样）；host 活着就有 20s 心跳，panel
  // 看门狗据此续命——检测的是「host/SW 死」而非「UI 长时间无内容帧」（codex 思考期静默）
  if (msg?.t === 'heartbeat') {
    if (currentTask) {
      chrome.runtime
        .sendMessage({
          t: 'task-alive',
          taskId: currentTask.taskId,
          elapsedMs: Date.now() - currentTask.startedAt,
          tabId: currentTask.tabId,
        })
        .catch(() => {})
    }
    return
  }
  // 正文完整性回执：与发送侧 total 对账，不一致 = NM 途中丢片——取消任务。
  // 半截正文会被 CLI 总结得「有模有样」，比直接失败更误导
  if (msg?.t === 'content-received' && currentTask && msg.taskId === currentTask.taskId) {
    if (currentTask.expectedChars !== undefined && msg.chars !== currentTask.expectedChars) {
      console.warn(`[pd] content mismatch: sent ${currentTask.expectedChars}, host got ${msg.chars}`)
      nmPort.send({ t: 'task-cancel', taskId: msg.taskId })
      chrome.runtime
        .sendMessage({ t: 'task-error', taskId: msg.taskId, code: 'content-mismatch', message: '正文传输不完整（NM 丢片），已取消——请重试' })
        .catch(() => {})
      currentTask = null
    }
    return // 回执不转发（panel 不消费）
  }
  // 捕获会话 id 供追问（claude init 事件捕获，task-done 兜底）；historyPath 续存
  // （追问轮 task-done 带回首轮文件路径，覆盖亦无损——路径不变）。
  // 会话归属跟帧走（r4-arch）：帧自带 agentId，不用全局 currentAgentId——取消 A 后
  // 立即起 B 时，A 的迟到 meta 会把 A 的 sessionId 记到 B 名下（多引擎审校模式会把
  // 该窗口放大为必然）；无 agentId 的帧仅在 taskId 匹配 currentTask 时才归属当前 agent。
  // r12：归档到任务源页签（迟到帧无任务匹配时兜底当前锚）——别的页签绝不捡到会话
  if (msg?.t === 'task-meta' || msg?.t === 'task-done') {
    const owner =
      msg.agentId ??
      (currentTask && msg.taskId === currentTask.taskId ? currentAgentId : undefined)
    if (msg.sessionId && owner) {
      const tabId = currentTask && msg.taskId === currentTask.taskId ? currentTask.tabId : panelTabId
      // || 而非 ??：host 首轮 persist 失败时回传空串（不虚构路径），跳过且保留
      // 上一会话已有路径（r7-review）；合法路径永非空串
      if (tabId !== null) {
        sessions.set(tabId, { agentId: owner, sessionId: msg.sessionId, historyPath: msg.historyPath || sessions.get(tabId)?.historyPath })
        persistSession()
      }
    }
    // 记住该 CLI 最近模型，merge 进 agents 缓存即刻下发（下拉展示 claude · GLM-5.2）
    if (msg.model && owner) {
      lastModels.set(owner, msg.model)
      persistSession()
      if (agentsCache) {
        agentsCache = agentsCache.map((a) => (a.id === owner ? { ...a, model: msg.model } : a))
        chrome.runtime.sendMessage({ t: 'agents', agents: agentsCache }).catch(() => {})
      }
    }
  }
  // r12 修正：sendToPanel 恒广播（tabs.sendMessage 到不了 sidePanel，见函数注释）；
  // 终局清理仍在路由之后（见上方说明）。
  // r16：任务帧盖 tabId 邮戳（帧属任务源页签）——panel 只在「未绑定收养」瞬间核
  // 邮戳（绑定态照收：折叠续流/双窗口恒广播语义不回归），跨页签流不再串台
  sendToPanel(
    currentTask && (msg as { taskId?: string })?.taskId === currentTask.taskId
      ? { ...(msg as object), tabId: currentTask.tabId }
      : m,
  )
  // r16（3-agent P1）：任务完成打 ✓ 角标——面板被收起期间 done 广播无接收端，
  // 「deep 跑 2 分钟切走干别的」回不回看全靠记忆。SW 由任务期心跳保活必活着，
  // setBadgeText 免权限；面板重新唤起（panel-ready）或下一轮起跑时清除
  if (msg?.t === 'task-done') chrome.action.setBadgeText({ text: '✓' }).catch(() => {})
  if ((msg?.t === 'task-done' || msg?.t === 'task-error') && currentTask && msg.taskId === currentTask.taskId) {
    currentTask = null
  }
})
nmPort.onDisconnect(() => {
  // r6-sec：带断连时在跑任务的 taskId（panel 据此拒收迟到帧、不误伤重 spawn 后的
  // 新一轮）；同步清 currentTask——断连 = 该连接上的任务必死（Chrome 收割 NM host
  // 进程树），句柄残留会让后续 cancel 发向死连接、新任务误判「已有在跑」
  const tid = currentTask?.taskId
  currentTask = null
  chrome.runtime
    .sendMessage({ t: '__host-disconnected', ...(tid ? { taskId: tid } : {}) } as HostToExt)
    .catch(() => {})
})

/** 追问轮：上下文在 CLI 会话里，host 直接 resume，无提取/无正文 */
function startFollowUp(agentId: string, sessionId: string, instruction: string, historyPath?: string, attachments?: AttachMsg[]) {
  if (!instruction.trim() && !attachments?.length) return { error: 'empty-instruction' }
  if (currentTask) cancelCurrent() // 收割在跑任务（同 startSummarize：句柄丢失 = 进程泄漏）
  const taskId = newTaskId()
  // 追问轮也占任务位（taskId）：进行中可取消
  const frame = {
    t: 'task-start' as const,
    task: {
      taskId, agentId, resumeSessionId: sessionId, historyPath, instruction, attachments,
      page: { url: '', title: '追问', extractor: 'follow-up', approxTokens: 0 },
    },
  }
  if (frameTooLarge(frame)) return { error: 'frame-too-large' }
  const ok = nmPort.send(frame)
  if (!ok) return { error: 'host-not-found', lastError: nmPort.lastError }
  currentTask = { taskId, tabId: panelTabId ?? -1, page: { url: '', title: '追问', extractor: 'follow-up', approxTokens: 0 }, content: '', startedAt: Date.now() }
  // host 的 Task 等 contentReady 才 run——补发空正文分片（done:true）。
  // r8-review：失败同样终止——重连拉起的新 host 没收过 task-start，追问会静默丢失
  if (!nmPort.send({ t: 'task-content', taskId, seq: 0, text: '', done: true })) {
    currentTask = null
    return { error: 'host-not-found', lastError: nmPort.lastError }
  }
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

/** 最近一次成功提取的正文体量（tips 条「≈N tokens」——用量透明，r9-backlog） */
let lastApproxTokens = 0

/** 当前总结目标页元数据（tips 条展示用）；target 无 url 时（无 tabs 权限）fallback tab query */
function pageMeta(): { title: string; url: string; favIconUrl?: string; approxTokens?: number } | null {
  if (target?.url && isNormalPage(target.url)) {
    return { title: target.title ?? '', url: target.url, favIconUrl: target.favIconUrl, approxTokens: lastApproxTokens || undefined }
  }
  return null
}

async function startSummarize(agentId: string, workflow: string, instruction?: string, skills?: string[], lang?: string, attachments?: AttachMsg[], historyLimit?: number) {
  // 入口先收割在跑任务（提取/注入可能 await 数秒，期间旧任务继续烧额度）——
  // 对称于 resume-history/new-session 的既有守卫
  if (currentTask) cancelCurrent()
  chrome.action.setBadgeText({ text: '' }).catch(() => {}) // 新轮起跑清完成角标（r16）
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

  // U1：注入+提取可 await 数秒（重页面）——先把任务位占上（提取窗口内取消/
  // 换页兜底生效，防双发竞速的隐形重复任务）并下发 reading 占位帧（panel 立即
  // 出 loading/停止钮，不再秒级零反馈）。占位 page 会在提取成功后被真实 meta 覆盖
  const taskId = newTaskId()
  currentAgentId = agentId
  // 新一轮总结开始：本页签旧会话失效（防切换 CLI 后追问串回旧 agent 的会话）。
  // r12：只清发起页签——别的页签会话不受牵连（页签维度独立）
  sessionTouched = true // 显式起新总结：restoreSession 微任务不得复活旧会话
  if (panelTabId !== null) sessions.delete(panelTabId)
  persistSession()
  currentTask = {
    taskId,
    tabId: tab.id!,
    page: { url: tab.url ?? '', title: tab.title ?? '', extractor: 'pending', approxTokens: 0 },
    content: '',
    startedAt: Date.now(),
  }
  // 面板未开时无接收端是常态，静默。agentId（r7-ux）：气泡创建即快照归属 CLI，
  // 流式中切下拉不错标（host 侧 status 帧不带，meta 帧到时再补）
  sendToPanel({ t: 'task-status', taskId, phase: 'reading', agentId: currentAgentId, tabId: tab.id! })

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
    currentTask = null
    // r46：文件加载失败（dist 不完整/升级中，真机曾因单段构建误报授权失效）不是
    // 授权问题——单独归因，免得「点图标重授权」指引对缺文件场景空转
    if (/Could not load file/i.test(injectErr)) return { error: 'inject-failed', detail: injectErr }
    // 授权失效（无手势/已切页）：原样带回错误文本，panel 给重授权指引
    return { error: 'no-permission', detail: injectErr }
  }
  const page = await extractBest(tab.id!)
  if ('error' in page) {
    currentTask = null
    return { error: page.error }
  }
  // 提取窗口内被取消/被新任务顶替（currentTask 已易主）：终止，绝不再发 task-start。
  // 带 taskId 让 panel 对账（F9 台账）——「新对话后立刻重发」时此迟到回调若不带
  // 身份会击穿新一轮 pending 态（r4-regression）
  if (!currentTask || currentTask.taskId !== taskId) return { error: 'cancelled', taskId }

  const { contentMarkdown, ...meta } = page
  currentTask = { taskId, tabId: tab.id!, page: meta, content: contentMarkdown, startedAt: currentTask?.startedAt ?? Date.now() }
  lastApproxTokens = meta.approxTokens ?? 0

  // 提取成功 → 下发目标页元数据（panel tips 条「正在分享 …」；notice=截断/低置信提示）
  sendToPanel({ t: 'page-meta', page: { title: tab.title ?? meta.title, url: tab.url ?? meta.url, favIconUrl: tab.favIconUrl, notice: meta.notice, approxTokens: meta.approxTokens } })

  const frame = {
    t: 'task-start' as const,
    // skills：panel 选中的技能名，host 读 ~/.ai-page-dive/skills 正文拼进 prompt
    // historyLimit：保留策略（r42）——host 首轮落盘后清理超出部分的最旧历史
    task: { taskId, agentId, workflow, instruction, skills, lang, attachments, historyLimit, page: meta },
  }
  if (frameTooLarge(frame)) {
    currentTask = null
    return { error: 'frame-too-large' }
  }
  const ok = nmPort.send(frame)
  if (!ok) {
    currentTask = null
    return { error: 'host-not-found', lastError: nmPort.lastError }
  }

  // 正文分片 ≤512KB（JSON 序列化后字节维度，与 host 侧 sendChunk 同一标准）。
  // 用 JSON.stringify 而非裸 Blob.size：帧最终是 JSON，\ / " / 控制字符转义最坏 2x
  // 膨胀，只测原文字节会让转义密集页击穿 NM 1MB 帧限。
  // done 片带 total：host 回 content-received 对账，丢片即取消（宁可失败不可半截总结）
  const CH = 512 * 1024
  let i = 0
  let seq = 0
  let total = 0
  while (i < contentMarkdown.length) {
    let end = Math.min(i + CH, contentMarkdown.length)
    while (end > i && new Blob([JSON.stringify(contentMarkdown.slice(i, end))]).size > CH) {
      end = Math.floor((i + end) / 2)
    }
    const done = end >= contentMarkdown.length
    total += end - i
    // r8-review：send 失败必须终止——nmPort.send 失败后下一次调用会 connectNative
    // 重拉一个全新 host，后续分片全发给从未收到 task-start 的孤儿进程（它回的
    // no-task 错误帧两侧都不消费）：任务变僵尸挂到 120s 看门狗，还驻留一个零任务 host
    const sent = nmPort.send({
      t: 'task-content',
      taskId,
      seq,
      text: contentMarkdown.slice(i, end),
      done,
      ...(done ? { total } : {}),
    })
    if (!sent) {
      currentTask = null
      return { error: 'host-not-found', lastError: nmPort.lastError }
    }
    i = end
    seq++
  }
  // 正文已全量送达 host：SW 不再需要这份内存（保留 taskId/page 供取消与终局对账）。
  // 回执对账挂 currentTask.expectedChars：content-received 到达时校验
  currentTask.content = ''
  currentTask.expectedChars = total
  return { ok: true, taskId, agentId } // r11：panel 对齐实际执行 CLI（与追问轮返回形态一致）
}
