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
 * 任务流：点「深度总结本页」后 mock 广播 reading→thinking→4 段流式 chunk→done，
 * 全程 ~2.4s，可验证 running 态（I3 两步确认/I1 禁用视觉/enterHint）与完成态。
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

const AGENTS = [
  { id: 'claude', available: true, version: '2.0.62', model: 'GLM-4.6' },
  { id: 'codex', available: true, version: '0.46.0' },
]
const WORKFLOWS = [
  { name: 'deep', description: '结构化研读报告，多步通读全文', builtin: true },
  { name: 'quick', description: '抓要点，十几秒出稿', builtin: true },
  { name: 'paper', description: '论文精读：方法/实验/局限', builtin: true },
  { name: 'humanize', description: '去 AI 味改写', builtin: true },
  { name: 'product-audit', description: '产品四维严苛审计', builtin: true },
]
const SKILLS = [{ name: 'tech-audit', description: '技术审计增强指令', builtin: false }]
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
function runFakeTask() {
  const taskId = `mock-${++seq}`
  cast({ t: 'task-status', taskId, phase: 'reading', agentId: 'claude', tabId: 1 })
  setTimeout(() => cast({ t: 'task-status', taskId, phase: 'thinking', agentId: 'claude' }), 300)
  setTimeout(() => cast({ t: 'task-meta', taskId, agentId: 'claude', model: 'GLM-4.6', sessionId: `sess-${taskId}` }), 500)
  MD.forEach((text, i) => setTimeout(() => cast({ t: 'task-chunk', taskId, seq: i, text }), 700 + i * 400))
  setTimeout(
    () => cast({ t: 'task-done', taskId, agentId: 'claude', historyPath: `/mock/h-${taskId}.md`, usage: { input: 15234, output: 1893 }, durationMs: 8200 }),
    700 + MD.length * 400 + 200,
  )
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
    if (m?.t === 'history-list') setTimeout(() => cast({ t: 'history-list', items: HISTORY }), 30)
    if (m?.t === 'history-read') setTimeout(() => cast({ t: 'history-file', path: m.path, content: `---\ntitle: 示例总结\nurl: https://example.com\nagent: claude\nts: 2026-09-20\n---\n\n# 摘要\n\n历史详情正文占位。` }), 30)
    if (m?.t === 'workflow-read') setTimeout(() => cast({ t: 'workflow-file', name: m.name, content: WORKFLOWS.find((w) => w.name === m.name)?.description ?? '' }), 30)
    return undefined
  }
  if (msg?.t === 'summarize') {
    if (q.get('noextract')) return { error: 'no-permission' }
    // swcycle=lost：会话已随 SW 回收湮灭——追问打空（App 自愈降级全量总结）
    if (q.get('swcycle') === 'lost' && msg.followUp) return { error: 'session-lost' }
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
      if (cb) setTimeout(() => cb(resp), 30)
    },
    onMessage: {
      addListener: (l: (m: unknown) => void) => void listeners.add(l),
      removeListener: (l: (m: unknown) => void) => void listeners.delete(l),
    },
    getManifest: () => ({ version: '1.8.0' }),
  },
  tabs: { create: ({ url }: { url: string }) => void window.open(url, '_blank') },
  permissions: {
    contains: async () => false,
    request: async () => true,
    remove: async () => true,
  },
}
