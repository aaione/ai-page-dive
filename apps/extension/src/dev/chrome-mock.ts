/**
 * dev harness 专用 chrome API mock（r44：UI 自行可视化验证——chrome-extension://
 * 页面无法被自动化浏览器导航，dev server + shim 是唯一自验路径）。
 * 仅由 dev.html / main-dev.tsx 引用，不进 rollupOptions.input → 生产构建零包含。
 *
 * 场景参数（URL query）：
 *   ?unsupported=1  受限页（F4 验证：输入区置灰）
 *   ?noskills=1     忽略 localStorage 技能预置（F1 对照组）
 *   ?noextract=1    启动前失败（r46 验证：no-permission 气泡不得带「CLI 报告运行失败」前缀）
 *   ?swcycle=codex  SW 回收后重开（r47：codex 无 sessionId）——hasSession +
 *                  historyPath 还原对话 UI，canResume=false 不得出现追问入口
 *   ?swcycle=claude 同上但 canResume=true——还原后「继续追问」可用（followUp 续流）
 *   ?swcycle=lost   会话彻底丢——追问发得出去，回 session-lost 气泡 + 自愈降级
 *                  （resumable 置 false，重发自动走全新总结）
 *   ?resync=0       追问轮重抓降级（r77 成分③：授权失效/受限页等）——page-meta
 *                  不带 resynced，PageTips 显「本轮未同步页面」分支
 *   ?taskfail=<code> mock 流第 2 段 chunk 后以 task-error(code) 终局替代 done
 *                  （r78 审计 harness 空洞#3：错误族终局 + App 自动 refill 回填——
 *                  code 直传分流，如 timeout / is_error / spawn-fail）
 *   ?hostdown=1     流中途广播 __host-disconnected + task-error(host-disconnected)
 *                  双帧（镜像 sw.ts:947-953；r78 审计 harness 空洞#2）
 * 任务流：点「深度总结本页」后 mock 广播 reading→thinking→4 段流式 chunk→done，
 * 全程 ~2.4s，可验证 running 态（I3 两步确认/I1 禁用视觉/enterHint）与完成态；
 * 点「停止」→ nm task-cancel → 清假任务 timers + 回 task-error(cancelled)（r50）。
 */

const q = new URLSearchParams(location.search)
const listeners = new Set<(m: unknown) => void>()
const cast = (m: unknown) => listeners.forEach((l) => l(m))

const PAGE = {
  title: '2026年9月，前端圈发生的那些事',
  url: 'https://example Weekly.dev/weekly/2026-09',
  approxTokens: 12345,
  notice: '正文超长，已截断至前 8 万字',
}

// r51-review：版本对齐实测基线之上（SummarizeView MIN_VERSIONS：claude 2.1.162 /
// codex 0.156.1）——harness 默认态=健康环境，低版本提示样式验证时临时调低即可
const AGENTS = [
  { id: 'claude', available: true, version: '2.1.170', model: 'GLM-4.6' },
  { id: 'codex', available: true, version: '0.157.0' },
]
const WORKFLOWS = [
  { name: 'deep', description: '结构化研读报告，多步通读全文', builtin: true },
  { name: 'quick', description: '抓要点，十几秒出稿', builtin: true },
  { name: 'paper', description: '论文精读：方法/实验/局限', builtin: true },
  { name: 'humanize', description: '去 AI 味改写', builtin: true },
  { name: 'product-audit', description: '产品四维严苛审计', builtin: true },
]
// ?noskills=1（F1 对照组，头注释 :8 承诺但此前零实现——r53 #19）：技能列表回空
const SKILLS = q.get('noskills') ? [] : [{ name: 'tech-audit', description: '技术审计增强指令', builtin: false }]
const HISTORY = [1, 2, 3].map((i) => ({
  ts: Date.now() - i * 86400_000,
  title: `示例总结 ${i}——某个很长很长的网页标题占位`,
  url: `https://example.com/article-${i}`,
  agent: i % 2 ? 'claude' : 'codex',
  sessionId: `s-${i}`,
  path: `/mock/history/2026/09/2${i}/12000${i}-slug.md`,
}))

const MD = [
  '# 摘要\n\n本页讨论了 ',
  '**三个要点**：其一，\n\n- 要点甲占位文本\n- 要点乙占位文本\n\n',
  '## 细节\n\n这里是一段较长的正文占位，用于观察流式渲染与 markdown 排版。\n\n',
  '## 结论\n\n以上为 mock 流式输出的最后一帧。',
]

let seq = 0
// r50：fake 任务可取消——SW 收 {t:'cancel'} 后转 nm task-cancel 给 host，host 收割
// 进程回 task-error(code=cancelled) 终局帧（App 渲染「已取消」气泡、不回填输入框）。
// 此前 mock 的 setTimeout 序列无法中止，harness 点「停止」后假任务照常流到 done
let fakeTimers: ReturnType<typeof setTimeout>[] = []
let fakeTaskId: string | null = null
function cancelFake() {
  fakeTimers.forEach(clearTimeout)
  fakeTimers = []
  if (fakeTaskId) setTimeout(() => cast({ t: 'task-error', taskId: fakeTaskId!, code: 'cancelled', message: 'task cancelled' }), 50)
}
function runFakeTask() {
  const taskId = `mock-${++seq}`
  fakeTaskId = taskId
  const at = (ms: number, fn: () => void) => fakeTimers.push(setTimeout(fn, ms))
  // r78（审计 harness 空洞#2/#3）：错误终局两场景——流到第 2 段 chunk 后掐掉
  // 后续时间线，按场景发对应终局帧；refill 回填是 App 收 task-error 的自动行为
  const fail = q.get('taskfail') ?? (q.get('hostdown') ? 'host-disconnected' : null)
  if (fail) {
    // 1500ms = 第 2 段 chunk（1100ms）已落地、第 3 段（1500ms）前——同刻 timer
    // 按创建序先触发（本 at 先 push），clearTimeout 掐掉第 3 段起的时间线
    at(1500, () => {
      fakeTimers.forEach(clearTimeout)
      fakeTimers = []
      if (fail === 'host-disconnected') cast({ t: '__host-disconnected', taskId })
      setTimeout(
        () =>
          cast({
            t: 'task-error',
            taskId,
            code: fail,
            message: fail === 'host-disconnected' ? '本机组件连接中断，任务已终止——请重试' : `mock 错误终局（${fail}）`,
          }),
        50,
      )
    })
  }
  at(0, () => cast({ t: 'task-status', taskId, phase: 'reading', agentId: 'claude', tabId: 1 }))
  at(300, () => cast({ t: 'task-status', taskId, phase: 'thinking', agentId: 'claude' }))
  at(500, () => cast({ t: 'task-meta', taskId, agentId: 'claude', model: 'GLM-4.6', sessionId: `sess-${taskId}` }))
  MD.forEach((text, i) => at(700 + i * 400, () => cast({ t: 'task-chunk', taskId, seq: i, text })))
  at(700 + MD.length * 400 + 200, () => cast({ t: 'task-done', taskId, agentId: 'claude', historyPath: `/mock/h-${taskId}.md`, usage: { input: 15234, output: 1893 }, durationMs: 8200 }))
  return taskId
}

function route(msg: any): unknown {
  if (msg?.t === 'panel-ready') {
    setTimeout(() => {
      cast({ t: 'agents', agents: AGENTS })
      cast({ t: 'workflows', items: WORKFLOWS })
    }, 50)
    // SW 回收后重开的还原透出（swcycle）：镜像 sw.ts panel-ready 的会话分支
    const cyc = q.get('swcycle')
    if (cyc === 'codex' || cyc === 'claude') {
      return {
        ok: true, panelTabId: 1, page: PAGE, pageUnsupported: false,
        hasSession: true, sessionAgentId: cyc,
        canResume: cyc === 'claude',
        historyPath: `/mock/history/2026/09/23/120000-${cyc}.md`,
      }
    }
    return q.get('unsupported')
      ? { ok: true, panelTabId: 1, pageUnsupported: true }
      : { ok: true, panelTabId: 1, page: PAGE, pageUnsupported: false }
  }
  const m = msg?.msg
  if (msg?.t === 'nm') {
    if (m?.t === 'list-agents') setTimeout(() => cast({ t: 'agents', agents: AGENTS }), 30)
    if (m?.t === 'list-workflows') setTimeout(() => cast({ t: 'workflows', items: WORKFLOWS }), 30)
    if (m?.t === 'list-skills') setTimeout(() => cast({ t: 'skills', items: SKILLS }), 30)
    if (m?.t === 'history-list') setTimeout(() => cast({ t: 'history-list', items: m.query ? HISTORY.filter((h) => (h.title + h.url).includes(m.query)) : HISTORY, query: m.query ?? '' }), 30)
    if (m?.t === 'task-cancel') cancelFake()
    if (m?.t === 'history-read') setTimeout(() => cast({ t: 'history-file', path: m.path, content: `---\ntitle: 示例总结\nurl: https://example.com\nagent: claude\nts: 2026-09-20\n---\n\n# 摘要\n\n历史详情正文占位。` }), 30)
    if (m?.t === 'workflow-read') setTimeout(() => cast({ t: 'workflow-file', name: m.name, content: WORKFLOWS.find((w) => w.name === m.name)?.description ?? '' }), 30)
    return undefined
  }
  // UI 停止按钮发 SW 层 {t:'cancel'}（真机 SW 再转 nm task-cancel 给 host）——
  // mock 无 SW，此处即取消入口
  if (msg?.t === 'cancel') { cancelFake(); return undefined }
  if (msg?.t === 'summarize') {
    if (q.get('noextract')) return { error: 'no-permission' }
    // swcycle=lost：会话已随 SW 回收湮灭——追问打空（App 自愈降级全量总结）
    if (q.get('swcycle') === 'lost' && msg.followUp) return { error: 'session-lost' }
    // r77（成分③）：追问轮 SW 会重抓页面并广播 resynced page-meta——mock 镜像；
    // ?resync=0 模拟重抓降级（不广播，PageTips 走「本轮未同步页面」分支）
    if (msg.followUp && q.get('resync') !== '0') setTimeout(() => cast({ t: 'page-meta', page: { ...PAGE, resynced: true } }), 30)
    return { agentId: 'claude', taskId: runFakeTask() }
  }
  return undefined
}

// ponytail: 只 mock UI 层实际触碰的面（runtime/tabs/action 不存在也不装），
// 漏掉的字段由消费端条件渲染兜底，发现缺再补
;(window as any).chrome = {
  runtime: {
    lastError: undefined,
    sendMessage(msg: unknown, cb?: (resp: unknown) => void) {
      const resp = route(msg)
      // r50：无 callback 分支返回 Promise（MV3 真身语义）——App 层多处
      // sendMessage(...).catch(...) 在 harness 里抛 TypeError 杀死后续语句
      if (cb) { setTimeout(() => cb(resp), 30); return }
      return new Promise((r) => setTimeout(() => r(resp), 30))
    },
    onMessage: {
      addListener: (l: (m: unknown) => void) => void listeners.add(l),
      removeListener: (l: (m: unknown) => void) => void listeners.delete(l),
    },
    getManifest: () => ({ version: '0.1.4' }),
  },
  tabs: { create: ({ url }: { url: string }) => void window.open(url, '_blank') },
  // r65（r64 code#2）：panel-anchor 窗口界定用（App myWindowIdRef 查己窗）——
  // 单窗 mock 恒 id 1，与 mock 页签的 windowId 语义一致
  windows: { getCurrent: (cb: (w: { id: number }) => void) => cb({ id: 1 }) },
  permissions: {
    contains: async () => false,
    request: async () => true,
    remove: async () => true,
  },
}
