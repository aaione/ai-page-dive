import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AgentStatus, WorkflowItem } from '@ai-page-dive/shared'
import type { ChatMessage, PageMeta, TaskStreamState } from './App.js'
import { useListboxMenu, useRovingNav } from './a11y.js'
import { useExitValue } from './motion.js'
import { StreamMarkdown } from './StreamMarkdown.js'
import { WF_LABEL } from './workflow-labels.js'

interface Props {
  agents: AgentStatus[]
  workflows: WorkflowItem[]
  stream: TaskStreamState
  agentId: string
  onAgentChange: (id: string) => void
  onStartResult: (resp: { error?: string; [k: string]: unknown }) => void
  beginTurn: (text: string, attachments?: { name: string; kind?: 'text' | 'image' }[], skills?: string[], wf?: string) => void
  beginSession: () => void
  pageMeta: PageMeta | null
  /** 会话是否可追问（CLI 回带过 sessionId）：codex 无 sessionId → false，关掉假追问入口 */
  resumable: boolean
  /** SW 侧活会话归属的 CLI（panel-ready 回带）：面板重开后头部下拉初始显示与
   * 追问实际执行的 CLI 一致（r7-review） */
  sessionAgentId?: string
  /** 当前锚定页不可提取（chrome:// 等）：placeholder 前置说明（r8-ux） */
  pageUnsupported?: boolean
  /** host 的 agents 探测是否已回帧（r14 首旅程）：未回前 agents=[] 是在途不是空——
   * placeholder 不得抢跑「未检测到本机 AI CLI」假告示 */
  agentsLoaded?: boolean
}

/** 待发送附件（r12：文本走 text、图片走 b64——host 落盘 ~/.ai-page-dive/attachments 持久化） */
type Att = { name: string; kind: 'text' | 'image'; text?: string; b64?: string; mime?: string }

/** 读 localStorage 的 JSON string[]（容错：坏数据/非数组一律回退默认） */
function readList(key: string, fallback: string[] = []): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : fallback
  } catch {
    return fallback
  }
}

/** 被禁用 CLI 集合：mount 读一次 + Settings 保存后派发 pd-settings-changed 时再读 */
export function useDisabledClis(): Set<string> {
  const [disabled, setDisabled] = useState<Set<string>>(() => new Set(readList('pd-disabled-clis')))
  useEffect(() => {
    const sync = () => setDisabled(new Set(readList('pd-disabled-clis')))
    window.addEventListener('pd-settings-changed', sync)
    return () => window.removeEventListener('pd-settings-changed', sync)
  }, [])
  return disabled
}

/** 已启用 skills：mount 读一次 + 设置变更事件同步（发送 summarize 时取即时值） */
function useEnabledSkills(): () => string[] {
  const ref = useRef<string[]>(readList('pd-enabled-skills'))
  useEffect(() => {
    const sync = () => { ref.current = readList('pd-enabled-skills') }
    window.addEventListener('pd-settings-changed', sync)
    return () => window.removeEventListener('pd-settings-changed', sync)
  }, [])
  return useCallback(() => ref.current, [])
}

/** r42：历史保留条数（发送时取即时值；首轮带上，host 落盘后清理超限旧文件）——与 HistoryView 同谱 */
const historyKeep = (): number => {
  const v = Number(localStorage.getItem('pd-history-limit'))
  return v >= 10 ? v : 200
}

/** 设置项 hook：localStorage 单值 + pd-settings-changed 事件同步 */
export function useSetting(key: string): [string, (v: string) => void] {
  const [v, setV] = useState(() => {
    try { return localStorage.getItem(key) ?? '' } catch { return '' }
  })
  useEffect(() => {
    const sync = () => {
      try { setV(localStorage.getItem(key) ?? '') } catch { /* quota 等 */ }
    }
    window.addEventListener('pd-settings-changed', sync)
    return () => window.removeEventListener('pd-settings-changed', sync)
  }, [key])
  const set = useCallback((nv: string) => {
    try {
      if (nv) localStorage.setItem(key, nv)
      else localStorage.removeItem(key)
    } catch { /* ignore */ }
    window.dispatchEvent(new Event('pd-settings-changed'))
  }, [key])
  return [v, set]
}

export function SummarizeView({ agents, workflows, stream, agentId, onAgentChange, onStartResult, beginTurn, beginSession, pageMeta, resumable, sessionAgentId, pageUnsupported, agentsLoaded }: Props) {
  const disabledClis = useDisabledClis()
  const getEnabledSkills = useEnabledSkills()
  const [sumLang] = useSetting('pd-sum-lang')
  const usable = agents.filter((a) => a.available && !disabledClis.has(a.id))
  const messages = stream.messages
  // r35-motion：发送后 hero 下沉淡出让位聊天（退场 180ms 再卸载）
  const hero = useExitValue(messages.length === 0, 180)
  // r16（3-agent P1）：workflow 落 localStorage——面板收起即文档重载（锚定模型），
  // 组件态每次切页签回来都重置 default→deep：快捷用户的「快速」误发成最贵档。
  // 与 pd-default-cli 同款模式：mount 读回 + 选中即写
  const [workflow, setWorkflowState] = useState(() => {
    try { return localStorage.getItem('pd-workflow') || 'default' } catch { return 'default' }
  })
  // r47-audit M1：CTA 轮失败回填恢复的发送档位——send() 空输入重发时优先于 r44 的
  // 强制 deep（quick CTA 失败后 Enter 跑 deep = 同族档位漂移）；用户显式切档即失效
  const ctaRetryWf = useRef<string | null>(null)
  const setWorkflow = (wf: string) => {
    ctaRetryWf.current = null // 用户显式选档优先于回填恢复的档位
    setWorkflowState(wf)
    try { localStorage.setItem('pd-workflow', wf) } catch { /* quota 等 */ }
  }
  // 持久值失效自愈（自定义 workflow 被删/换机残留）：列表到手后校验，不在则回 default。
  // workflows 初始为 []（App 异步拉取）——空表=未加载而非「全没了」，跳过校验，
  // 否则 mount 竞态会把持久值当场复位清库（localStorage 白写）
  useEffect(() => {
    if (!workflows.length) return
    if (workflow !== 'default' && !workflows.some((w) => w.name === workflow)) {
      setWorkflowState('default')
      try { localStorage.removeItem('pd-workflow') } catch { /* quota 等 */ }
    }
  }, [workflows])
  const [input, setInput] = useState('')
  /** 待发送附件（文本 ≤512KB/个、图片 ≤500KB/个，总量见 pickAttachments 预算）：随下一次 send 走 task-start，发完即清 */
  const [attachments, setAttachments] = useState<Att[]>([])
  // r38-motion：chips 退场——发送清空后旧列表下沉淡出 180ms 再卸载（空数组是 truthy，
  // 需归一成 null 才能触发 useExitValue 的退场分支）
  const chips = useExitValue(attachments.length ? attachments : null, 180)
  /** 附件跳过提示（超限/读失败）：下一条 notice 类消息展示后清除 */
  const [attachNotice, setAttachNotice] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  // r8-ux：input → textarea（Shift+Enter 换行，多行提问/粘贴大纲不再被压扁）
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // 打开面板/新对话后自动聚焦输入框（点击下拉不抢焦点：仅在消息从有到无时）
  const prevMsgCount = useRef(0)
  useEffect(() => {
    if (prevMsgCount.current > 0 && messages.length === 0) inputRef.current?.focus()
    // r16（3-agent P2）：历史还原/重开恢复的多轮对话末条是 assistant，不触发
    // 「末条为 user 才吸底」的常规逻辑——开场会停在第 1 轮而非最新结论。
    // 0→N（还原）一次性跳底；rAF 等 React 把长文真正铺进 DOM 再滚
    if (prevMsgCount.current === 0 && messages.length > 1) {
      requestAnimationFrame(() => {
        if (contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight
      })
    }
    prevMsgCount.current = messages.length
  }, [messages.length])
  // 终局异常（看门狗/断连）回填：refill.n 递增保证同文本也触发。
  // r8-review：输入框已有新草稿时不覆写——同一事故的错误回调与断连帧先后到达，
  // 用户已开始重敲时第二次 refill 会把改到一半的草稿整体冲掉
  // r46（review P2）：附件一并回填——内容（text/b64）只在视图层内存，气泡上只有
  // 名字，故以最近一次发送的完整快照还原（与 lastUser 气泡同轮）；用户已挂新
  // 附件时不覆写（同草稿语义）
  const lastAttsRef = useRef<Att[]>([])
  const lastRefill = useRef(0)
  // r47-audit M1：CTA 轮（refill.wf 有值、text 为空）的回填指引——「已放回输入框」
  // 对空回填是空承诺，note 指明等效重发路径（hero CTA 已随首条气泡卸载）
  const [retryNote, setRetryNote] = useState('')
  const armCtaRetry = (wf: string) => {
    setWorkflow(wf) // 选择器同步显示重试将跑的档（setWorkflow 会清 ctaRetryWf，随后再置）
    ctaRetryWf.current = wf
    setRetryNote(`「${WF_LABEL[wf] ?? wf}」未完成——直接按 Enter 以原档位重试`)
  }
  useEffect(() => {
    if (stream.refill && stream.refill.n !== lastRefill.current) {
      lastRefill.current = stream.refill.n
      const r = stream.refill
      // r47-audit M1：带 wf = 失败轮为一键总结（空输入 CTA）——不回填标签文本（曾把
      // 「深度总结本页」字面当 instruction 重发，deep 模板被整体绕过），恢复发送档位
      if (r.wf) armCtaRetry(r.wf)
      setInput((cur) => cur.trim() ? cur : r.text)
      setAttachments((cur) => (cur.length ? cur : lastAttsRef.current))
      if (!input.trim()) inputRef.current?.focus()
    }
  }, [stream.refill])
  // textarea 自适应高度：内容行数增长到 5 行封顶，删除/清空回落
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`
  }, [input])
  /** 追问轮实际执行会话的 CLI（SW 回带；头部展示与真实执行一致） */
  const [followAgent, setFollowAgent] = useState<string | null>(null)
  /** 重试检测按钮的 loading 态（r7-ux：host 探测最长 8s，零反馈会被当成没反应） */
  const [probing, setProbing] = useState(false)
  // send 回调判定「错误是否属于本轮」用最新 stream（闭包快照会滞后）
  const streamRef = useRef(stream)
  streamRef.current = stream
  // 会话切换（新对话/历史恢复：首条消息 id 变）时重置 followAgent——否则历史恢复后
  // 完成任一轮，头部显示的是上一会话遗留的 followAgent（显示与真实执行不符）。
  // 历史恢复的 agent 已由 App 写入 agentId（effectiveAgent），无需在此额外取值
  const firstMsgId = stream.messages[0]?.id ?? ''
  const prevFirstId = useRef(firstMsgId)
  useEffect(() => {
    if (prevFirstId.current !== firstMsgId) {
      prevFirstId.current = firstMsgId
      setFollowAgent(null)
    }
  }, [firstMsgId])
  // effectiveAgent 已由 App 完成整条回退链（本轮手选 > 默认 CLI > 首个可用 > claude）
  const effectiveAgent = agentId
  // running：首帧已到（activeId）或 send 后等首帧（pending——SW 提取往返窗口，
  // 该窗口曾无反馈且双发门失效，重页秒级）
  const running = stream.activeId !== null || stream.pending

  // 流式跟随滚动（聊天产品基线）：用户在底部（距底 <48px）时每个 chunk 自动
  // 跟滚；一旦上滚回看即停跟随——不打断阅读，也不强迫用户每帧手动拖。
  // useLayoutEffect（r13-review）：paint 前同步写 scrollTop，消除 useEffect
  // 「先长后跳」的一帧闪跳；末条为 user 气泡（=新轮刚发出）时恢复跟随——
  // 兑现「新消息发出时永远从底部开始」（曾漏重置：上轮回看后发追问不跳底，
  // 新回答流在视口外生长，用户以为没反应）
  const contentRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  useLayoutEffect(() => {
    const el = contentRef.current
    const last = messages[messages.length - 1]
    if (last?.role === 'user') stickRef.current = true
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages])
  const onContentScroll = useCallback(() => {
    const el = contentRef.current
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }, [])
  // hasSession 需 CLI 可追问（resumable：回带过 sessionId）——codex 无 sessionId 时
  // 有完整回答但不可 resume，显示「继续追问…」会让追问必得 session-lost（误导）。
  // reopened（r7-ux）：面板重开但 SW 侧活会话健在——React 态丢不代表 CLI 会话丢，
  // 直接放开追问（上下文在 CLI 会话里）
  const canFollowUp =
    resumable && (stream.reopened || messages.some((m) => m.role === 'assistant' && !m.streaming && !m.error && m.text))
  const hasSession = canFollowUp

  const wfs = useMemo(() => {
    const order: Record<string, number> = { quick: 0, deep: 1, paper: 2 }
    // 已知名单按预设序，未知的垫底 9 附近按名称字典序微调（?? 优先级低于 +，括号显式化）
    const rest = [...(workflows.length ? workflows : [{ name: 'quick', description: '快速摘要', builtin: true }])]
      .sort((a, b) => {
        // r47-ux：曾写 b.name.localeCompare(b.name) 恒为 0——未知 workflow 排序碰巧才对
        const ao = order[a.name] ?? 9
        const bo = order[b.name] ?? 9
        return ao - bo || a.name.localeCompare(b.name)
      })
    // 「留空则深度总结」与发送侧对齐（空输入首轮 → 'deep'）：曾写
    // 「留空则快速摘要」，用户按文案留空预期快速档，实际跑最慢最贵的 deep
    // r46-user：default 文案随语义恢复——不套预设提示词，输入即指令
    return [{ name: 'default', description: '不套预设提示词，输入即指令；留空则深度总结', builtin: true }, ...rest]
  }, [workflows])

  /** 发送失败回填（r7-ux）：错误属于本轮时把输入/附件回填输入框（可改后重发），
   * 不回填则用户得凭记忆重敲。判据与 App 的迟到回调守卫同向（r7-review）：
   * 带 taskId 的错误与当前绑定比对（旧轮 taskId≠当前 → 新一轮运行中，旧文本
   * 不得覆写用户预输入）；无 taskId（SW 提取期即失败）要求本轮仍 pending */
  function refillOnFailure(resp: { error?: string; taskId?: string }, text: string, atts: Att[], wf?: string) {
    return () => {
      const s = streamRef.current
      const mine = typeof resp.taskId === 'string' ? resp.taskId === s.taskId : s.pending
      if (!mine) return
      setInput(text)
      if (atts.length) setAttachments(atts)
      // r47-audit M1：CTA 轮此路径 text 本就为空串（无标签泄漏），但档位恢复不能漏——
      // 与 App 侧 4 处 refill 终局同语义（SW 提取期即失败也走这里）
      if (wf) armCtaRetry(wf)
    }
  }

  function send(forceWf?: string) {
    const text = input.trim()
    // 空文本 + 空附件 + 无正文才拦：有正文时空输入 = 一键总结当前页（P0，修复
    // 「一键总结」承诺断裂）；有输入/附件 = 追问轮（正文可能已不可用，不拦）。
    // r46（review P1/C5/P4）：受限页与零可用 CLI 前置拦截——此前按钮 disabled 但
    // 键盘路径照发必败请求，靠 SW 异步报错兜底；send 为全部入口的末道守卫
    // r47：pageUnsupported 只拦首轮——追问轮走 SW 的 startFollowUp，不提取页面
    // （上下文在 CLI 会话里）。r46 统一守卫时漏了这层语义：锚定页导航到 chrome://
    // 后，已有对话的追问被连带禁掉且提示「此页面无法提取」，与事实不符
    if ((pageUnsupported && !hasSession) || !usable.length || (!text && !attachments.length && !usable.length) || running) return
    // r12：附件以 chip 展示在用户气泡上方（对齐用户期望形态），气泡文本只放用户
    // 输入；附件-only 轮 instruction 仍发占位文本（r8-review：显示与执行一致，
    // host 侧追问轮空 user 段会凭空消失）
    // r16：空文首轮（CTA/一键总结）气泡放实际档位文案——空壳气泡既无反馈又占版面；
    // instruction 不受影响（首轮 host 侧 `instruction || wfBody` 落默认摘要指令）。
    // r33-ux：档名查 WF_LABEL——自定义 workflow（用户自建）也标对，不一律「深度总结」
    // r44-audit F2：空输入+无附件+无会话 = 一键总结路径——与 hero CTA 同语义强制
    // deep，不吃 localStorage 记忆档（CTA 写「深度总结本页」而 Enter 跑论文档 = 名实分裂；
    // 有自定义输入 = 用户主动表达，按所选档执行）
    // r46-user：default 不再硬映射 deep——「默认模式」= 不套预设 prompt、用户输入
    // 即任务段（host `instruction || wfBody` 优先级保证）；附件轮 instruction 有
    // 占位文本、追问轮走 followUp 不带 workflow，均无「default 未命中兜底」路径
    // r47-audit M1：isCta = 空输入+无附件+无会话的一键总结轮（气泡文本是档位标签
    // 而非用户输入）——在用户消息上记 wf，失败回填据此恢复档位而非回填标签文本
    const isCta = !text && !attachments.length && !hasSession
    // r47-audit M1：空输入重发优先用回填恢复的档位（ctaRetryWf，防 quick CTA 失败后
    // Enter 落回强制 deep 的档位漂移）；无恢复时保持 r44 F2 强制 deep 不变
    const wf = forceWf ?? (!text && !attachments.length && !hasSession ? (ctaRetryWf.current ?? 'deep') : workflow)
    // r47-audit：ctaRetryWf 消费即清（陈旧档位跨会话泄漏——重试成功后经「新对话」
    // 再空输入 Enter，会静默跑旧 quick 而非 r44 F2 强制 deep）；本轮若失败，
    // refill→armCtaRetry 会重臂，无失效风险
    if (!forceWf) ctaRetryWf.current = null
    const bubbleText =
      text || (hasSession || attachments.length ? '' : `${WF_LABEL[wf] ?? '深度总结'}本页`)
    const skills = getEnabledSkills()
    // r42：技能只随首轮 prompt 注入（host !isResume 才读技能正文）——追问轮不带，
    // 气泡徽标也只标实际注入的轮次（此前追问轮也亮徽标 = 虚假标注）
    beginTurn(bubbleText, attachments.map((a) => ({ name: a.name, kind: a.kind })), hasSession ? undefined : skills, isCta ? wf : undefined)
    setAttachNotice('') // 提示已在输入区即时展示（r4-ux F3），发送即消费
    setRetryNote('') // r47-audit M1：重试指引随发送消费
    setInput('')
    const atts = attachments
    lastAttsRef.current = atts // r46（review P2）：终局回填附件用的完整快照（与本轮气泡一致，空轮即空）
    setAttachments([])
    // 追问轮无 workflow 兜底：附件-only 时 instruction 用占位文本；首轮保持空串——
    // host 侧 `instruction || wfBody` 落默认摘要指令，比占位文本更有用
    const instruction = text || (atts.length ? `（附件：${atts.map((a) => a.name).join('、')}）` : '')
    if (hasSession) {
      // 追问轮：agentId 由 SW 按会话归属决定，响应回带实际值——头部展示同步
      chrome.runtime.sendMessage(
        { t: 'summarize', agentId: effectiveAgent, instruction, followUp: true, attachments: atts },
        (resp) => {
          if (!chrome.runtime.lastError && resp) {
            if (resp.agentId) setFollowAgent(resp.agentId)
            onStartResult(resp)
            if (resp.error && resp.error !== 'cancelled') refillOnFailure(resp, text, atts, isCta ? wf : undefined)()
          } else {
            // r47-audit M2：SW 唤不醒（lastError 非空/resp undefined）——beginTurn 已置
            // pending+清输入，静默只能等 120s 看门狗；立即走 host-not-found-retry 错误链
            // （App 文案 + refillOnFailure 回填，resp 无 taskId 时守卫看 s.pending 仍过）
            const fake = { error: 'host-not-found-retry' }
            onStartResult(fake)
            refillOnFailure(fake, text, atts, isCta ? wf : undefined)()
          }
        },
      )
    } else {
      // 未显式选模式时默认 deep（DECISIONS D1「深度总结质量最优先」）；quick 留作显式
      // 选择。forceWf：空态 CTA 直传（r15 3-agent P0-1）——「深度总结本页」按钮把
      // default→deep 的静默映射显式化，用户看到的按钮名 = 实际跑的档（wf 已在
      // beginTurn 前算好，r16）
      chrome.runtime.sendMessage(
        { t: 'summarize', agentId: effectiveAgent, workflow: wf, instruction: text, skills, lang: sumLang || undefined, attachments: atts, historyLimit: historyKeep() },
        (resp) => {
          if (!chrome.runtime.lastError && resp) {
            onStartResult(resp)
            if (resp.error && resp.error !== 'cancelled') refillOnFailure(resp, text, atts, isCta ? wf : undefined)()
          } else {
            // r47-audit M2：同追问轮分支——SW 唤不醒时立即报错+回填，不等看门狗
            const fake = { error: 'host-not-found-retry' }
            onStartResult(fake)
            refillOnFailure(fake, text, atts, isCta ? wf : undefined)()
          }
        },
      )
    }
  }

  /** 附件选择（r12 支持图片；r31-sec 预算重校）：图片单张原图 ≤500KB；全部附件
   * 按帧内实际字节（图片 = b64 长度，文本 = JSON 编码后字节）共用 768KB 预算——
   * task-start 单帧内嵌 attachments，ext→host 同受 NM 1MB 帧限（host 侧超限即
   * 失步自杀收割全部任务；旧「5MB/12MB + ext→host 宽松」假设是错的，r31 审计
   * 实证）。超限/读失败标红提示并跳过（r4-ux）：静默丢弃 = 用户不知道附件没带上 */
  async function pickAttachments(files: FileList | null) {
    if (!files?.length) return
    const all = Array.from(files)
    const next: Att[] = []
    const skipped: string[] = []
    const IMG_MAX = 500 * 1024
    const readB64 = (f: File) =>
      new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
        r.onerror = () => reject(r.error)
        r.readAsDataURL(f)
      })
    for (const f of all.slice(0, 5)) {
      const isImage = f.type.startsWith('image/')
      if (isImage ? f.size > IMG_MAX : f.size > 512 * 1024) {
        skipped.push(`${f.name}（超过 ${isImage ? '500KB' : '512KB'}）`)
        continue
      }
      try {
        next.push(isImage ? { name: f.name, kind: 'image', b64: await readB64(f), mime: f.type } : { name: f.name, kind: 'text', text: await f.text() })
      } catch { skipped.push(`${f.name}（读取失败）`) }
    }
    // 单批第 6+ 与合并累计超限都不静默（handler 闭包的 attachments 即当前快照）
    for (const f of all.slice(5)) skipped.push(`${f.name}（单批最多 5 个）`)
    let merged = [...attachments, ...next]
    for (const f of merged.slice(5)) skipped.push(`${f.name}（附件已达 5 个上限）`)
    merged = merged.slice(0, 5)
    // 附件总字节预算（r5-sec / r31-sec 收紧）：图片 b64 与文本 JSON 字节同池——
    // task-start 帧内嵌全量附件，超 1MB 即击穿 NM 帧限（host 失步自杀）。文本按
    // JSON.stringify 后计量（\ " 控制字符最坏 6x/字符），与 host 侧 sendChunk 同口径；
    // b64 字符集无需 JSON 转义，b64.length 即帧内字节数
    const BUDGET = 768 * 1024
    const utf8Len = (s: string) => new TextEncoder().encode(JSON.stringify(s)).length
    let used = 0
    const withinBudget: Att[] = []
    for (const a of merged) {
      const bytes = a.kind === 'image' ? (a.b64?.length ?? 0) : utf8Len(a.text ?? '')
      if (used + bytes > BUDGET) { skipped.push(`${a.name}（附件总量超 768KB 上限）`); continue }
      used += bytes
      withinBudget.push(a)
    }
    setAttachments(withinBudget)
    if (skipped.length) {
      setAttachNotice(`已跳过：${skipped.join('、')}——请精简后重试`)
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  function cancel() {
    chrome.runtime.sendMessage({ t: 'cancel' })
  }

  /** 新对话：清 UI + 通知 SW（SW 侧对进行中任务执行取消）。
   * useCallback：AssistantMessage memo 化后 onNewChat 引用须稳定，否则每轮
   * 渲染新函数引用击穿全部 memo（r13-review） */
  const newChat = useCallback(() => {
    beginSession()
    setInput('')
    // followAgent 不重置会让新会话头部/下拉显示上一会话遗留的 CLI（claude 追问过后
    // 切 codex 首轮，头部仍显示 claude——显示与真实执行不符）
    setFollowAgent(null)
    // r47-audit：新对话清 CTA 重试档与指引——跨会话残留会让全新空输入总结静默跑
    // 上一会话失败 CTA 的旧档位（r44 F2 同族防御）
    ctaRetryWf.current = null
    setRetryNote('')
    chrome.runtime.sendMessage({ t: 'new-session' }).catch(() => {})
  }, [beginSession])

  // r44-audit I3：running 中一键「新对话」静默取消烧 token 的任务 + 清空全部对话——
  // 破坏面大于历史删除（后者有两步确认）却零确认；running 态改两步，3.5s 窗口同删除谱
  const [confirmNew, setConfirmNew] = useState(false)
  useEffect(() => {
    if (!confirmNew) return
    const t = setTimeout(() => setConfirmNew(false), 3500)
    return () => clearTimeout(t)
  }, [confirmNew])
  const handleNewChat = useCallback(() => {
    if (running && !confirmNew) {
      setConfirmNew(true)
      return
    }
    setConfirmNew(false)
    newChat()
  }, [running, confirmNew, newChat])

  return (
    <div className="pd-view">
      {/* 顶栏：新对话 / CLI 下拉 / 模式下拉（右上角浮层工具条让位） */}
      <div className="pd-topbar">
        <button
          onClick={handleNewChat}
          className={`pd-new-chat-btn${confirmNew ? ' confirming' : ''}`}
          title={confirmNew ? '再次点击确认：结束进行中的总结并清空对话' : '开始新对话'}
          aria-label={confirmNew ? '确认结束当前对话' : '开始新对话'}
        >
          {/* chat 气泡 + 加号：与消息底部「新对话」icon 同造型 */}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13.5 7.5a5.5 5.5 0 0 1-8.2 4.8L2.5 13.5l1.2-2.8A5.5 5.5 0 1 1 13.5 7.5Z" />
            <path d="M8 5.4v4.2M5.9 7.5h4.2" />
          </svg>
          <span>{confirmNew ? '确认结束？' : '新对话'}</span>
        </button>
        {/* r46（review C6）：读屏器不自动播报已聚焦按钮的 name 变化——两步确认
            首击零反馈，3.5s 窗口内 SR 用户会误以为按钮失效。sr-only status 与
            「本轮已完成」播报同谱（r31-a11y） */}
        {confirmNew && (
          <span className="pd-sr-only" role="status">再次点击以确认结束当前对话</span>
        )}
        <ModelDropdown
          // sessionAgentId 兜底（r7-review）：重开面板后首问尚未发生（followAgent
          // 未回带），显示 SW 活会话真实归属的 CLI——显示与执行一致
          value={hasSession ? (followAgent ?? sessionAgentId ?? effectiveAgent) : effectiveAgent}
          onChange={onAgentChange}
          items={usable.map((a) => ({
            key: a.id,
            // r7-sec：opencode 无进程级工具围栏（claude 有 --allowedTools、codex 有
            // --sandbox，opencode CLI 无等效 flag）——标注实验性管理预期
            label: a.id === 'opencode' ? 'opencode·实验' : a.id,
            version: a.version,
            model: a.model,
          }))}
          fallback="无可用 CLI"
          ariaLabel="选择 AI CLI"
          disabled={hasSession}
          disabledTitle="追问沿用首轮 CLI"
        />
        {usable.length === 0 && (
          // r6-ux 空态自愈入口：SW 对零可用结果永不缓存命中（穿透重探测），
          // 用户装好 CLI 后点此按钮即见——无需重装本机组件/重开面板。
          // r7-ux：点击即 loading（host 探测最长 8s，零反馈会被当成没反应连点）
          <button
            onClick={() => {
              setProbing(true)
              chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'list-agents' } })
              setTimeout(() => setProbing(false), 8_000)
            }}
            disabled={probing}
            className="pd-new-chat-btn"
            title="装好 CLI 后点此重新检测（无需重装本机组件）"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4" />
              <path d="M13.6 2.6v2.4h-2.4" />
            </svg>
            <span>{probing ? '检测中…' : '重试检测'}</span>
          </button>
        )}
        <WorkflowDropdown
          workflow={workflow}
          onWorkflowChange={setWorkflow}
          workflows={wfs}
          hasSession={hasSession}
        />
      </div>

      {/* r31-a11y：容器不再 aria-live——流式 chunk 逐帧变更会让读屏器整区重读（洪泛）；
          改由下方视觉隐藏 status 区只播报关键节点（完成；错误仍由气泡内 role=alert 播） */}
      <div className="pd-content" role="region" aria-label="对话内容" ref={contentRef} onScroll={onContentScroll}>
        <span className="pd-sr-only" role="status">{!running && messages.length > 0 && stream.done ? '本轮已完成' : ''}</span>
        {stream.reopened && !running && (
          // r7-ux：切 tab 面板收起后重开，React 态已丢但 SW 侧活会话健在——明示
          // 此前对话去哪了（不静默空白），且追问可接续原会话上下文（canFollowUp 已放开）
          <div className="pd-error pd-warn" role="status" style={{ margin: '8px 12px 0' }}>
            <span>面板重开：此前对话已清空——完整内容可在「总结历史」中查看；继续提问将接续原会话。</span>
          </div>
        )}
        {hero.shown && (
          <Placeholder
            clis={usable.map((a) => a.id)}
            anyInstalled={agents.some((a) => a.available)}
            pageUnsupported={pageUnsupported}
            agentsLoaded={agentsLoaded}
            exiting={hero.exiting}
            /* r16（3-agent P1）：活会话（重开兜底/追问中）不给一键 CTA——CTA 走首轮
               总结分支会拆会话，走追问分支又必吃 empty-instruction；空态请用户输入 */
            onSummarize={hasSession ? undefined : (wf) => send(wf)}
          />
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="pd-chat-user">
              {/* r12：附件 chip 嵌在用户消息上方（对齐 Gemini 侧栏形态）——发送前
                  输入区有 chip、发送后气泡里有 chip，附件全程可见不再「凭空消失」 */}
              {!!m.attachments?.length && (
                <div className="pd-msg-attaches">
                  {m.attachments.map((a, i) => (
                    <span key={a.name + i} className="pd-msg-attach" title={a.name}>
                      {a.kind === 'image' ? (
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
                          <circle cx="5.8" cy="6.2" r="1.1" />
                          <path d="m2.5 12 3.4-3.4 2.4 2.4 2.3-2.3 2.9 2.9" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M13.5 6.5v5a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h5L6.5 6 11 10.5 14 7.5l.5-1Z" />
                          <path d="M9 2.5 13.5 7l-2.5 2.5L6.5 5 9 2.5Z" />
                        </svg>
                      )}
                      <span className="pd-msg-attach-name">{a.name}</span>
                      <span className="pd-msg-attach-kind">{a.kind === 'image' ? '图片' : '文件'}</span>
                    </span>
                  ))}
                </div>
              )}
              {!!m.text && <p>{m.text}</p>}
            </div>
          ) : (
            <AssistantMessage
              key={m.id}
              msg={m}
              phase={stream.phase}
              running={running && !!m.streaming}
              onNewChat={newChat}
              pageTitle={pageMeta?.title}
              // 气泡创建时快照的归属 CLI（r7-ux）：流式中切下拉不错标；
              // 旧气泡无快照时回退 effectiveAgent/followAgent
              agentId={m.agentId ?? (followAgent && m.streaming !== true ? followAgent : effectiveAgent)}
            />
          ),
        )}
      </div>

      <div className="pd-action-bar">
        {/* r38-motion：key=锚定页——切页时重挂载重播入场动画（此前恒挂载，标题/tokens 瞬跳是「不丝滑」主源） */}
        {/* r49（#64-①）：dimmed 语义 = 本轮不注入技能——追问轮（会话延续）或 quick 档
            （host 侧跳过注入，与 task.ts 过滤同语义） */}
        {pageMeta && <PageTips key={pageMeta.url} meta={pageMeta} idle={!messages.length} dimmed={hasSession ? 'resume' : workflow === 'quick' ? 'quick' : false} />}
        {chips.shown && chips.shown.length > 0 && (
          <div className={`pd-attach-chips${chips.exiting ? ' pd-exiting' : ''}`}>
            {chips.shown.map((a, i) => (
              <span key={a.name + i} className="pd-attach-chip" title={a.name}>
                {a.kind === 'image' ? (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
                    <circle cx="5.8" cy="6.2" r="1.1" />
                    <path d="m2.5 12 3.4-3.4 2.4 2.4 2.3-2.3 2.9 2.9" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M13.5 6.5v5a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h5L6.5 6 11 10.5 14 7.5l.5-1Z" />
                    <path d="M9 2.5 13.5 7l-2.5 2.5L6.5 5 9 2.5Z" />
                  </svg>
                )}
                {a.name}
                <button aria-label={`移除附件 ${a.name}`} onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
        )}
        {attachNotice && (
          // 附件跳过即时提示（r4-ux F3）：此前只在下次发送时以伪用户气泡出现——
          // 挑选当下零反馈，被丢的附件无从归因
          // r44-audit I4：第四条 notice 归队 .pd-bar-note（danger 变体）——原 inline
          // style / 12px 缩进 / rise-in 旧谱 / danger 背景色四重破格
          <p role="note" className="pd-bar-note danger">
            {attachNotice}
          </p>
        )}
        {retryNote && (
          // r47-audit M1：CTA 轮失败回填不落标签文本（防重发成字面 instruction），
          // 错误气泡的「已放回输入框」对空回填是空承诺——note 指明等效重发路径
          <p role="note" className="pd-bar-note">
            {retryNote}
          </p>
        )}
        <ActionBar
          input={input}
          workflowNotice={
            // r5-ux：host 语义是 instruction 优先（既定设计），但顶栏仍显示模式已
            // 选中——不告知则用户以为模式生效，实际执行等价默认。
            // r11：追问轮不走路由 workflow（上下文在 CLI 会话），提示不适用
            input.trim() && !hasSession && workflow !== 'default' && workflow !== 'quick'
              ? `自定义问题将替代「${WF_LABEL[workflow] ?? workflow}」模式指令`
              : undefined
          }
          noFollowUpHint={
            // r9-backlog：codex 等无 sessionId 的 CLI 定稿后，输入框仍暗示可续问——
            // 不提示则追问预期落空。!resumable && 有完成答案精确区分 claude 首轮
            !running && !resumable && messages.some((m) => m.role === 'assistant' && !m.streaming && !m.error && m.text)
          }
          onInputChange={setInput}
          inputRef={inputRef}
          running={running}
          usableCount={usable.length}
          hasSession={hasSession}
          pageUnsupported={pageUnsupported}
          onStart={send}
          onCancel={cancel}
          onAttach={() => fileRef.current?.click()}
          attachCount={attachments.length}
          attachRef={fileRef}
          onPickFiles={pickAttachments}
        />
      </div>
    </div>
  )
}

/** 顶栏模式（工作流）下拉：从 ActionBar 上移，追问轮禁用沿用首轮 */
function WorkflowDropdown({
  workflow, onWorkflowChange, workflows, hasSession,
}: {
  workflow: string
  onWorkflowChange: (name: string) => void
  workflows: { name: string; description: string; builtin: boolean }[]
  hasSession: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  // r32-a11y：listbox 键盘可达——上下/四向游走（只移焦点不选，Enter/click 选中）
  useRovingNav(ref, '.pd-dropdown-item')
  // r33-refactor：开态/即入菜单/外点/Esc 还焦收敛进共用 hook（原与 ModelDropdown 重复 ~30 行）
  const { open, setOpen, close: closeMenu } = useListboxMenu(ref)
  // r35-motion：关闭播 130ms 收回动画再卸载
  const menu = useExitValue(open || null, 130)

  return (
    <div ref={ref} className={`pd-workflow-dropdown ${hasSession ? 'inactive' : ''}`}>
      <button
        onClick={() => setWorkflowOpenGuarded()}
        disabled={hasSession}
        aria-label="选择模式"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={hasSession ? '追问沿用首轮模式' : undefined}
        className="pd-workflow-trigger"
      >
        <span className="pd-workflow-label">{WF_LABEL[workflow] ?? workflow}</span>
        <svg viewBox="0 0 15 16" className={`pd-workflow-arrow ${open ? 'open' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 6.5 4 4 4-4" />
        </svg>
      </button>
      {menu.shown && (
        <ul
          role="listbox"
          className={`pd-dropdown-menu pd-workflow-menu pd-fade-in-fast${menu.exiting ? ' pd-exiting' : ''}`}
          onKeyDown={(e) => {
            // r32-a11y：菜单内 Esc 只关菜单——stopPropagation 防冒泡连设置 overlay 一起关
            if (e.key === 'Escape') { e.stopPropagation(); closeMenu() }
          }}
        >
          {workflows.map((w) => (
            <li key={w.name} role="option" aria-selected={w.name === workflow}>
              <button
                onClick={() => { onWorkflowChange(w.name); closeMenu() }} // r47-audit M12：close() 还焦 trigger（setOpen(false) 焦点丢 body）
                tabIndex={w.name === workflow ? 0 : -1}
                className={`pd-dropdown-item ${w.name === workflow ? 'selected' : ''}`}
              >
                {w.name === workflow && <span className="pd-dropdown-check" aria-hidden="true" />}
                <span className="pd-dropdown-item-label">{WF_LABEL[w.name] ?? w.name}</span>
                {w.description && <span className="pd-dropdown-item-hint">{w.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  function setWorkflowOpenGuarded() {
    if (!hasSession) setOpen((o) => !o)
  }
}

/** token 数短格式：1234 → 1.2k（气泡头一行放下） */
function fmtK(n?: number): string {
  return n == null ? '' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

// memo（r13-review）：流式期间每 chunk 重渲染整棵消息树——历史气泡 props 全程
// 不变（msg 引用稳定、running=自己 streaming、onNewChat 已 useCallback），
// memo 后旧气泡零重渲，只重绘正在流的那条
const AssistantMessage = memo(function AssistantMessage({
  msg, phase, running, agentId, onNewChat, pageTitle,
}: {
  msg: ChatMessage
  phase: string
  running: boolean
  agentId: string
  onNewChat: () => void
  pageTitle?: string
}) {
  return (
    <div className="pd-chat-assistant">
      <div className="pd-chat-assistant-head">
        {/* CLI 名是产品名非技术标识——sans 500（r13 字体统一：mono 只留给
            version/model/token 数等机器量；曾用 pd-mono 与模式下拉/触发器不协调） */}
        <span className="pd-chat-model">{agentId}</span>
        {/* r8-ux：订阅用量可见性——产品核心卖点是「复用你自己的 CLI 订阅」，每轮烧多少 token 应有出口 */}
        {!running && (msg.usage || msg.durationMs != null) && (
          <span className="pd-chat-usage">
            {/* r47-ux：无 token 只有耗时时常出现悬空「· 8.2s」——前置片段为空时不加分隔符 */}
            {(() => {
              const bits: string[] = []
              if (msg.usage?.inputTokens != null) bits.push(`${fmtK(msg.usage.inputTokens)}↑`)
              if (msg.usage?.outputTokens != null) bits.push(`${fmtK(msg.usage.outputTokens)}↓`)
              if (msg.durationMs != null) bits.push(`${(msg.durationMs / 1000).toFixed(1)}s`)
              return bits.join(' · ')
            })()}
          </span>
        )}
        {running && (
          <span className="pd-chat-thinking">
            <span className="pd-dot" aria-hidden="true" />
            {phase || '思考中…'}
          </span>
        )}
      </div>
      {msg.text ? (
        <StreamMarkdown text={msg.text} done={!running} />
      ) : running ? (
        <div className="pd-chat-cursor" aria-hidden="true" />
      ) : null}
      {!running && msg.error && (
        <div className="pd-error" role="alert">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M8 1.5 14.5 13H1.5L8 1.5Z" />
            <path d="M8 6v3.2" />
            <path d="M8 11.2v.1" />
          </svg>
          <span>
            {msg.cliFault ? 'CLI 报告运行失败：' : ''}
            {msg.error}
          </span>
        </div>
      )}
      {!running && msg.grantHost && <GrantHostRow />}
      {!running && msg.incomplete && (
        // r6-ux：chunk seq 跳变（传输丢片）——任务本身成功，但正文可能缺头，
        // 弱于 error 的提示（pd-warn 黄），不阻断复制/下载
        <div className="pd-error pd-warn" role="status">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="6.2" />
            <path d="M8 7.4v3" />
            <path d="M8 4.9v.1" />
          </svg>
          <span>内容可能不完整（面板重开或传输丢片）——完整版已存入历史</span>
        </div>
      )}
      {!running && msg.text && (
        <MessageActions text={msg.text} onNewChat={onNewChat} pageTitle={pageTitle} />
      )}
    </div>
  )
})

/** no-permission 气泡内嵌授权行（r47：设置页入口删除后的唯一授予出口——
 *  出错现场情境化，点击即手势满足 permissions.request 约束） */
function GrantHostRow() {
  const [granted, setGranted] = useState(false)
  if (granted) return <p className="pd-grant-ok">已开启——直接重发即可，无需点图标</p>
  return (
    <div className="pd-grant-row">
      <button
        className="pd-grant-btn"
        onClick={() => {
          chrome.permissions
            ?.request({ origins: ['<all_urls>'] })
            .then((g) => { if (g) setGranted(true) })
            .catch(() => {})
        }}
      >
        始终允许读取网页
      </button>
      <span className="pd-grant-scope">范围：所有网站（含敏感站点），仅本机 CLI 处理</span>
    </div>
  )
}

function MessageActions({ text, onNewChat, pageTitle }: { text: string; onNewChat: () => void; pageTitle?: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* 剪贴板不可用（罕见） */ }
  }
  function download() {
    const blob = new Blob([text], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // r16（3-agent P2）：文件名带页面 slug（host buildHistoryPath 同款逻辑）——
    // 高频归档者能从文件名认出内容，纯时间戳全是谜语
    const slug = (pageTitle || '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
    a.download = `pagedive-${slug ? slug + '-' : ''}${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="pd-chat-actions">
      {/* r12 回退：复制回 icon 形态（r11 曾升文字主按钮，用户反馈突兀——三 icon
          工具栏与竞品基线一致）；已复制态 icon 换 ✓ + tooltip 反馈 */}
      <button onClick={copy} className="pd-chat-action-btn" title={copied ? '已复制 ✓' : '复制全文'} aria-label="复制全文">
        {copied ? (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 8.5 3.2 3.2L13 5" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
            <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
          </svg>
        )}
      </button>
      <button onClick={download} className="pd-chat-action-btn" title="下载 markdown" aria-label="下载 markdown">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v8M8 10l-3-3M8 10l3-3M2.5 13.5h11" />
        </svg>
      </button>
      <button onClick={onNewChat} className="pd-chat-action-btn" title="新对话" aria-label="新对话">
        {/* chat 气泡 + 加号（原喇叭造型被误认成语音） */}
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.5 7.5a5.5 5.5 0 0 1-8.2 4.8L2.5 13.5l1.2-2.8A5.5 5.5 0 1 1 13.5 7.5Z" />
          <path d="M8 5.4v4.2M5.9 7.5h4.2" />
        </svg>
      </button>
    </div>
  )
}

export function ModelDropdown({
  value, onChange, items, fallback, ariaLabel, disabled, disabledTitle,
}: {
  value: string
  onChange: (key: string) =>  void
  items: { key: string; label: string; version?: string; model?: string }[]
  fallback?: string
  ariaLabel?: string
  disabled?: boolean
  disabledTitle?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  // r32-a11y：listbox 键盘可达——四向游走（只移焦点不选，Enter/click 选中）
  useRovingNav(ref, '.pd-dropdown-item')
  // r33-refactor：开态/即入菜单/外点/Esc 还焦收敛进共用 hook（原与 WorkflowDropdown 重复 ~30 行）
  const { open, setOpen, close: closeMenu } = useListboxMenu(ref)
  // r35-motion：关闭播 130ms 收回动画再卸载
  const menu = useExitValue(open || null, 130)

  // 追问轮切禁用时若菜单开着必须收起（否则残留可点的过期菜单）
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  const selected = items.find((it) => it.key === value)

  return (
    <div ref={ref} className={`pd-dropdown ${disabled ? 'inactive' : ''}`}>
      <button
        onClick={() => { if (!disabled) setOpen((o) => !o) }}
        disabled={disabled}
        title={disabled ? disabledTitle : undefined}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`pd-dropdown-trigger ${items.length ? '' : 'disabled'}`}
      >
        <span className="pd-dropdown-label">
          {items.length ? (selected?.label ?? value) : (fallback ?? value)}
        </span>
        {items.length > 0 && (
          <svg viewBox="0 0 16 16" className="pd-dropdown-arrow" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4 6.5 4 4 4-4" />
          </svg>
        )}
      </button>
  {menu.shown && items.length > 0 && (
        <ul
          role="listbox"
          className={`pd-dropdown-menu pd-fade-in-fast${menu.exiting ? ' pd-exiting' : ''}`}
          onKeyDown={(e) => {
            // r32-a11y：菜单内 Esc 只关菜单——stopPropagation 防冒泡连设置 overlay 一起关
            if (e.key === 'Escape') { e.stopPropagation(); closeMenu() }
          }}
        >
          {items.map((it) => (
            <li key={it.key} role="option" aria-selected={it.key === value}>
              <button
                onClick={() => { onChange(it.key); closeMenu() }} // r47-audit M12：close() 还焦 trigger（setOpen(false) 焦点丢 body）
                tabIndex={it.key === value ? 0 : -1}
                className={`pd-dropdown-item ${it.key === value ? 'selected' : ''}`}
              >
                {it.key === value && <span className="pd-dropdown-check" aria-hidden="true" />}
                {/* r15 字体统一：version/model 去 mono——同一菜单内 mono/sans 混排是
                    「字体不统一」观感主源（用户实锤）；mono 只留给命令/代码/文件名 */}
                <span className="pd-dropdown-item-label">{it.label}</span>
                {it.version && <span className="pd-dropdown-item-hint">{it.version}</span>}
                {it.model && <span className="pd-dropdown-item-hint pd-dropdown-item-model">{it.model}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ActionBar({
  input, workflowNotice, noFollowUpHint, onInputChange, inputRef,
  running, usableCount, hasSession, pageUnsupported,
  onStart, onCancel, onAttach, attachCount, attachRef, onPickFiles,
}: {
  input: string
  /** 非空 = 输入自定义问题时提示所选模式将被替代（r5-ux） */
  workflowNotice?: string
  /** true = 当前 CLI 定稿后不可追问（codex 无 sessionId），输入框旁提示新提问独立成轮 */
  noFollowUpHint?: boolean
  onInputChange: (v: string) => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  running: boolean
  usableCount: number
  hasSession: boolean
  /** r44-audit F4：受限页（chrome:// 等）——输入区联动置灰，防御前移不只做内容区一半 */
  pageUnsupported?: boolean
  onStart: () => void
  onCancel: () => void
  onAttach: () => void
  attachCount: number
  attachRef: React.RefObject<HTMLInputElement | null>
  onPickFiles: (files: FileList | null) => void
}) {
  // r16（3-agent P1）：Enter 路径的轻提示（本地态自包含——草稿保干净 + 有反馈）。
  // r46（review P1/C5）：布尔→文案字符串——受限页/零 CLI 拦截也走同一提示位
  const [enterHint, setEnterHint] = useState('')
  const flashHint = (text: string) => {
    setEnterHint(text)
    setTimeout(() => setEnterHint(''), 3500)
  }
  return (
    <>
      {/* r44-audit I5：notice 移出输入胶囊 flex——原 flex:100% 换行使出现/消失时
          输入行内部撕裂跳位（光标视觉跳变）；独立层让胶囊整体平移。
          轻提示允许裸卸载无退场（r44 规范：瞬态 note 不值得 useExitValue 的复杂度） */}
      {workflowNotice && (
        <p role="note" className="pd-bar-note">
          ⚠ {workflowNotice}
        </p>
      )}
      {enterHint && (
        <p role="note" className="pd-bar-note">
          {enterHint}
        </p>
      )}
      {noFollowUpHint && (
        <p role="note" className="pd-bar-note">
          此 CLI 暂不支持追问：新提问将开始全新总结（不含以上对话）
        </p>
      )}
      <div className="pd-action-bar-inner">
      <button
        onClick={onAttach}
        // r7-review：与输入框同放开——附件仅暂存不触发任务，运行中预备下一问
        disabled={attachCount >= 5}
        aria-label="添加附件"
        title="添加附件（文本/图片，≤5 个）"
        className="pd-attach-btn"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.5 5.5 5 11a1.8 1.8 0 0 0 2.5 2.5l5.2-5.2a3 3 0 0 0-4.2-4.2L3.3 9.3a4.2 4.2 0 0 0 5.9 5.9l3.3-3.3" />
        </svg>
      </button>
      <input
        ref={attachRef}
        type="file"
        multiple
        accept=".txt,.md,.markdown,.json,.csv,.log,.xml,.yaml,.yml,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.c,.cpp,.h,.css,.html,text/*,image/*"
        className="pd-attach-file"
        onChange={(e) => onPickFiles(e.target.files)}
        tabIndex={-1}
        aria-hidden="true"
      />
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter 发送 / Shift+Enter 换行（r8-ux：多行输入是竞品基线体验）。
          // keyCode 229：部分 IME（韩文等）compositionend 先于 keydown，isComposing 已 false
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return
          // r16（3-agent P1）：运行中 Enter 曾漏成默认换行——预写的下一问被插空行
          // 且零反馈。拦截并轻提示，草稿保干净，跑完再 Enter 即发
          if (running) {
            e.preventDefault()
            if (input.trim() || attachCount) {
              flashHint('上一轮还在跑——内容已保留，完成后按 Enter 再发')
            }
            return
          }
          // r46（review P1/C5/P4）：与按钮 disabled 同条件的前置拦截——受限页/
          // 零 CLI 时不再发出必败请求（此前键盘路径绕过按钮禁用，SW 异步报错兜底）
          // r47：受限页只拦首轮，追问轮不提取页面（与 send() 守卫同条件）
          if ((pageUnsupported && !hasSession) || !usableCount) {
            e.preventDefault()
            flashHint(pageUnsupported ? '此页面无法提取——切换到普通网页后再总结' : '先安装或启用一个 CLI，再开始总结')
            return
          }
          if (usableCount || input.trim() || attachCount) {
            e.preventDefault()
            onStart()
          }
        }}
        // r7-ux：不再 disabled——运行中允许预输入下一问（Enter 已有 !running 守卫，
        // 发送按钮不受影响；锁死输入框只是防重发，守卫已覆盖）
        // r47：hasSession 优先——受限页仍可追问（不提取页面），placeholder 不得
        // 沿用「此页面无法提取」误导用户以为输入框失效
        placeholder={hasSession ? '继续追问…（Shift+Enter 换行）' : pageUnsupported ? '此页面无法提取——切换到普通网页后可用' : '想了解这个网页的什么？（Shift+Enter 换行）'}
        aria-label="自定义指令"
        className="pd-input"
        rows={1}
      />

      {/* r46（review C3）：pageUnsupported 只禁发送态——运行中导航到受限页时
          停止按钮被连带禁用，非破坏性取消入口全失，任务只能烧满看门狗。
          r47：且只禁首轮发送——追问轮不提取页面，受限页不该禁 */}
      <button
        onClick={running ? onCancel : onStart}
        disabled={!running && ((pageUnsupported && !hasSession) || (!usableCount && !input.trim() && !attachCount))}
        aria-label={running ? '停止' : '发送'}
        title={running ? '停止' : '发送'}
        className={`pd-primary-btn ${running ? 'running' : ''}`}
      >
        {running ? (
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 13V3M8 3 4.6 6.4M8 3l3.4 3.4" />
          </svg>
        )}
      </button>
      </div>
    </>
  )
}

/** 输入框上方 tips 条：「正在分享 "页面标题"」（参考 Gemini 插件，上下文透明化）。
 *  r43：启用中的技能以常驻微标在此展示——技能是「设置里开的全局状态」，归属输入区
 *  状态指示而非每条消息的属性（r37 气泡下独立徽标行形态退役：占版面且追问轮虚假标注） */
function PageTips({ meta, idle, dimmed }: { meta: PageMeta; idle?: boolean; dimmed?: false | 'resume' | 'quick' }) {
  const [skills, setSkills] = useState<string[]>(() => readList('pd-enabled-skills'))
  useEffect(() => {
    const sync = () => setSkills(readList('pd-enabled-skills'))
    window.addEventListener('pd-settings-changed', sync)
    return () => window.removeEventListener('pd-settings-changed', sync)
  }, [])
  const host = (() => {
    try {
      return new URL(meta.url).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  })()
  return (
    <div className="pd-page-tips" role="status">
      {meta.favIconUrl ? (
        <img
          src={meta.favIconUrl}
          alt=""
          className="pd-page-tips-favicon"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      ) : (
        <svg viewBox="0 0 16 16" className="pd-page-tips-favicon" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <path d="M2 8h12M8 2c2 2.2 2 9.8 0 12M8 2C6 4.2 6 11.8 8 14" />
        </svg>
      )}
      <span className="pd-page-tips-text">
        {/* r44-audit F3：hero 空闲态无分享行为——「正在分享」是进行时谎言 */}
        {idle ? '已就绪' : '正在分享'}「{meta.title || host || meta.url}」{host ? ` · ${host}` : ''}
      </span>
      {meta.notice && (
        <span className="pd-page-tips-notice" title={meta.notice}>
          ⚠ {meta.notice}
        </span>
      )}
      {!!meta.approxTokens && (
        <span className="pd-page-tips-notice" title="正文体量估算，用量计入你的 CLI 订阅">
          ≈{meta.approxTokens >= 10000 ? `${(meta.approxTokens / 10000).toFixed(1)}万` : meta.approxTokens} tokens
        </span>
      )}
      {!!skills.length && (
        // r44-audit F1：技能只随首轮注入——追问轮常驻照亮 = 虚假标注复发（r42 同款
        // 问题的形态转移）；降透明 + title 改口，把轮次语义显式接上。
        // r49（#64-①）：quick 档同谱降透明——host 跳过注入，徽标不得假装生效
        <span
          className="pd-page-tips-notice"
          style={dimmed ? { opacity: 0.45 } : undefined}
          title={`${dimmed === 'resume' ? '追问轮不注入技能（新对话后生效）' : dimmed === 'quick' ? '快速档不注入技能（追求十几秒出要点，切其他档生效）' : '已启用技能（总结时注入增强指令）'}：${skills.join('、')}——在 设置·技能 管理`}
        >
          ⚡ {skills.length > 1 ? `技能 ×${skills.length}` : skills[0]}
        </span>
      )}
    </div>
  )
}

function Placeholder({ clis, anyInstalled, pageUnsupported, agentsLoaded, onSummarize, exiting }: { clis: string[]; anyInstalled?: boolean; pageUnsupported?: boolean; agentsLoaded?: boolean; onSummarize?: (wf: 'deep' | 'quick') => void; exiting?: boolean }) {
  // r14 首旅程：探测在途（host spawn + 逐 CLI --version 秒级）——agents 未回帧前
  // 显示中性等待，抢跑「未检测到」假告示会误导已装用户去重装
  if (!clis.length && !agentsLoaded) {
    return (
      <div className={`pd-placeholder${exiting ? ' pd-exiting' : ''}`}>
        <p className="pd-placeholder-title">正在检测本机 CLI…</p>
        <p className="pd-placeholder-hint">首次检测需唤起本机组件，稍等片刻</p>
      </div>
    )
  }
  // 无可用 CLI：给出明确指引而非让用户对着灰按钮/无反应回车猜（F10）。
  // 区分「未安装」与「已装但全被停用」（r5-ux：文案曾把后者引向重装排查）
  if (!clis.length) {
    return (
      <div className={`pd-placeholder${exiting ? ' pd-exiting' : ''}`}>
        <p className="pd-placeholder-title">{anyInstalled ? '本机 CLI 已全部停用' : '未检测到本机 AI CLI'}</p>
        <p className="pd-placeholder-hint">
          {anyInstalled ? (
            <>
              在「设置 → 本机 CLI」中开启至少一个即可使用
              <br />
              无服务器 · 正文不经 PageDive 中转
            </>
          ) : (
            <>
              {/* r48（M11）：补 native installer 路线（claude 官方一键脚本，免 npm）
                  与 codex 的确切命令——「或 codex」让用户自己猜命令 */}
              终端安装并登录（任选其一）：
              <br />
              claude：<code>curl -fsSL https://claude.ai/install.sh | bash</code>
              <br />
              codex：<code>npm i -g @openai/codex</code>
              <br />
              安装后点上方「重试检测」 · 无服务器 · 正文不经 PageDive 中转
            </>
          )}
        </p>
      </div>
    )
  }
  // 动态渲染实际检测到的 CLI（不再硬编码 opencode，避免未装者误以为可用，F14）
  // r8-ux：chrome:// 等受限页无法提取正文——前置说明，别让用户输入后才发现发不出去
  if (pageUnsupported) {
    return (
      <div className={`pd-placeholder${exiting ? ' pd-exiting' : ''}`}>
        <p className="pd-placeholder-title">当前页面无法提取正文</p>
        <p className="pd-placeholder-hint">
          浏览器内置页（chrome:// 等）不允许扩展读取内容
          <br />
          切换到普通网页后即可使用
        </p>
      </div>
    )
  }
  return (
    <div className="pd-placeholder">
      <p className="pd-placeholder-title">想了解这个网页的什么？</p>
      {/* r15（3-agent P0-1）：一键总结可见入口——「深度总结本页」即空输入发送的
          default→deep 映射显式化（按钮名 = 实际跑的档），quick 给轻量选项 */}
      {onSummarize && (
        <div className="pd-placeholder-cta">
          <button className="pd-cta-primary" onClick={() => onSummarize('deep')}>
            深度总结本页
          </button>
          <button className="pd-cta-ghost" onClick={() => onSummarize('quick')}>
            快速摘要
          </button>
        </div>
      )}
      {/* r31 文案：删「或在下方输入任何问题」——placeholder 已在输入框内引导，三重冗余；
          「秒级出稿」是不可兑现的承诺，改约数 */}
      <p className="pd-placeholder-hint">深度：全篇精读约 1-3 分钟 · 快速：抓要点约十几秒</p>
    </div>
  )
}

