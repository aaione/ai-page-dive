import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentStatus, HistoryItem, HostToExt, PanelMsg, PanelReadyResp, PanelToSw, TerminalCode, WorkflowItem } from '@ai-page-dive/shared'
import { useDialogFocus } from './a11y.js'
import { parseHistoryTurns } from './historyTurns.js'
import { useExitValue } from './motion.js'
import { Onboarding } from './Onboarding.js'
import { SummarizeView, useDisabledClis } from './SummarizeView.js'
import { HistoryView } from './HistoryView.js'
import { Settings } from './Settings.js'
import { ERROR_LABEL, stampTerminal, terminalLabel } from './terminal.js'

type Overlay = null | 'history' | 'settings'

/** r32-a11y：模态 overlay 壳——焦点陷阱 + 打开入容器 + 关闭还原触发元素
 *  （useDialogFocus 随本组件的条件渲染对齐生命周期） */
function DialogLayer({ label, onClose, exiting, children }: { label: string; onClose: () => void; exiting?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref)
  return (
    <div
      ref={ref}
      className={`pd-overlay pd-fade-in-fast${exiting ? ' pd-exiting' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      {children}
    </div>
  )
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** 本轮用户消息携带的附件（r12：气泡上方 chip 展示——显示与执行一致，附件不再「看不见」） */
  attachments?: { name: string; kind?: 'text' | 'image' }[]
  /** 本轮注入 prompt 的技能名（r37-ux：技能开启此前零反馈——气泡下徽标行让每轮生效可见） */
  skills?: string[]
  /** r47-audit M1：本轮为一键总结（空输入 CTA）时的执行档位（deep/quick）——失败回填
   * 据此恢复档位，不把气泡标签（如「深度总结本页」）字面塞回输入框当 instruction 重发 */
  wf?: string
  streaming?: boolean
  model?: string
  usage?: { inputTokens?: number; outputTokens?: number }
  /** 本轮耗时（r8-ux：气泡头与 usage 一起透出——订阅用量可见性） */
  durationMs?: number
  error?: string | null
  isError?: boolean
  /** 用户主动停止等非故障终局：红样式保留但不带「CLI 报告运行失败」前缀（r5-ux） */
  cancelled?: boolean
  /** 真 CLI 运行失败（task-error / task-done is_error）才带「CLI 报告运行失败」前缀——
   *  提取授权失效/输入校验/NM 断连等启动前失败 CLI 根本没跑，不得错怪（r46：
   *  no-permission 曾显示「CLI 报告运行失败」自相矛盾） */
  cliFault?: boolean
  /** r71（r70 product C9/L3）：终局时页面正文未送达 CLI（提取/注入/通道未起）——
   *  tips 常驻条据此分流「分享未成功」；timeout/is_error/断连等正文已过 stdin 的
   *  生成阶段失败不带（说「分享未成功」会误导用户去查授权/提取） */
  undelivered?: boolean
  /** no-permission 气泡专属：内嵌「始终允许读取网页」授权按钮（r47：设置页入口
   *  删除后唯一授予出口，情境化到出错现场——点击即手势满足 request 约束） */
  grantHost?: boolean
  /** 本次回答观测到 chunk 丢片（host seq 跳变）：终局后提示「内容可能不完整」（r6-ux） */
  incomplete?: boolean
  agentId?: string
}

export interface TaskStreamState {
  /** 当前绑定任务；null = 无任务。过期帧拒绝：null 只接受「首帧绑定」，
   * 已绑定后不同 taskId 一律丢弃——防取消后旧任务尾随帧劫持新一轮 */
  taskId: string | null
  messages: ChatMessage[]
  /** 正在生成的 assistant 消息 id */
  activeId: string | null
  /** 发出后未收到任何任务帧（SW 提取/路由往返窗口）：双发门在首帧到达前靠它兜住 */
  pending: boolean
  /** 已终局（done/error）的 taskId 近期记录：同 taskId 迟到 chunk/status 一律拒收——
   * 否则收割尾巴帧会新开一个永无终局的 streaming 气泡，锁死输入 */
  finished: string[]
  phase: string
  done: boolean
  /** 本会话是否可追问（CLI 回带过 sessionId）：codex 不产 sessionId，据此关掉
   * 「继续追问…」假入口，避免追问必得 session-lost */
  resumable: boolean
  /** 末次收到的 chunk seq（host 每 chunk 递增，任务切换自然重置）：跳变 = 传输丢片 */
  lastChunkSeq?: number
  /** 最后一次收到 host 存活信号（任一任务帧或 task-alive 心跳）的时刻——看门狗据此判死 */
  aliveAt: number
  /** 面板重开且 SW 侧仍有活会话（r7-ux）：React 态已丢但 CLI 会话健在——提示
   * 「此前对话已清空」并解锁追问（接续原会话上下文）；beginTurn 展 BLANK 自然清除 */
  reopened?: boolean
  /** 终局异常（看门狗/断连）时回填输入框的文本 + 递增序号（r8-ux：发送时输入框
   * 已清空，无回填则重试只能对着气泡手抄；n 递增使同文本两次终局也触发 effect）。
   * r47-audit M1：wf = 失败轮为一键总结（空输入 CTA）时的执行档位——SummarizeView
   * 据此恢复发送档位而非回填标签文本（text 置空） */
  refill?: { n: number; text: string; wf?: string }
}

const BLANK: TaskStreamState = {
  taskId: null, messages: [], activeId: null, pending: false, finished: [], phase: '', done: false, resumable: false, aliveAt: 0,
}

/** r47-audit M1：失败终局回填统一构造——wf 轮（空输入 CTA）text 置空并携带档位：
 * 曾把气泡标签「深度总结本页」字面回填输入框，重发时 instruction=标签文本、
 * host 侧 deep 模板被整体绕过（r44 同族漏网路径）。看门狗/is_error/task-error/
 * 断连 4 处终局共用，防单点漏改复发 */
function refillFor(s: TaskStreamState, lu?: ChatMessage): { n: number; text: string; wf?: string } | undefined {
  if (!lu || !(lu.text || lu.attachments?.length)) return undefined
  return { n: (s.refill?.n ?? 0) + 1, text: lu.wf ? '' : lu.text, ...(lu.wf ? { wf: lu.wf } : {}) }
}

export interface PageMeta {
  title: string
  url: string
  favIconUrl?: string
  /** 提取质量提示（截断/低置信），PageTips 条展示；无则不渲染 */
  notice?: string
  /** 正文体量估算（用量透明化）；0/缺省不渲染 */
  approxTokens?: number
  /** r77（实时读取）：本 meta 出自追问轮重抓（快照已随任务附件下发）——PageTips
   *  resume 态据此分流「已附快照 / 未同步」；缺省 = 非追问来源或重抓降级 */
  resynced?: boolean
  /** r77b（指纹复用）：重抓成功但与上轮快照全文一致——零附件零 token 膨胀，
   *  CLI 基于会话已有正文作答；与 resynced 互斥 */
  unchanged?: boolean
}

export function App() {
  const [overlay, setOverlay] = useState<Overlay>(null)
  /** r47-ux：从历史底栏跳进设置时落到「数据」tab；工具栏入口仍默认 CLI */
  const [settingsTab, setSettingsTab] = useState<'modes' | 'clis' | 'skills' | 'look' | 'data' | 'about' | undefined>()
  const ov = useExitValue(overlay, 160)
  const [hostOk, setHostOk] = useState<boolean | null>(null)
  /** r33-ux：panel-ready 探活持续失败（SW 唤不醒/通道异常 >30s）——loading 态给手动出口 */
  const [pingStuck, setPingStuck] = useState(false)
  const [outdated, setOutdated] = useState('')
  const [cmdCopied, setCmdCopied] = useState(false) // r56（#14）：升级横幅一键复制命令的反馈态
  const [cmdFail, setCmdFail] = useState(false) // r58（#20）：复制失败态（r57 #15 双态口径——catch 静默吞 = 谎报已复制）
  const [agents, setAgents] = useState<AgentStatus[]>([])
  /** host 探测结果是否已到（r14 首旅程）：区分「在途」与「真空」——空列表不该
   * 被渲染成「未检测到本机 AI CLI」假告示 */
  const [agentsLoaded, setAgentsLoaded] = useState(false)
  // r72（r71 product P2）：agents 帧丢失（host spawn 二连失败/NM 断连于探测窗口）时
  // 「正在检测」零按钮零出口，唯一恢复是关重开侧栏——10s 兜底置 loaded 落「未检测
  // 到」空态，重试按钮随之出现（10s 远宽于正常冷启动几秒，慢活 host 会被误落空态
  // 但重试按钮即再探测，可自愈）
  useEffect(() => {
    if (agentsLoaded) return
    const t = setTimeout(() => setAgentsLoaded(true), 10_000)
    return () => clearTimeout(t)
  }, [agentsLoaded])
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [stream, setStream] = useState<TaskStreamState>(BLANK)
  const [agentId, setAgentId] = useState('')
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null)
  /** r57（#19）：SW 会话来源页（panel-ready 带回，随 sessions 持久化）——
   *  ctxAnchor 优先快照它，页签内导航后重开不错标新页标题 */
  const [sessionPage, setSessionPage] = useState<{ url: string; title: string } | null>(null)
  /** r57（#24）：prune 首次触顶的单次提示（历史超限实删旧档）——静默永久删除
   *  会让重度用户回查三周前总结时发现「不存在且不知可调」，侵蚀历史回查信任 */
  const [pruneNotice, setPruneNotice] = useState<{ removed: number; limit: number } | null>(null)
  // r8-ux：当前锚定页不可提取（chrome:// 等）——placeholder 直接说明，失败前移
  const [pageUnsupported, setPageUnsupported] = useState(false)
  /** SW 侧活会话归属的 CLI（panel-ready 回带）：面板重开后头部下拉的初始显示——
   * 与追问实际执行的 CLI 一致（r7-review：曾错标为默认链结果，错标窗口=重开后首问） */
  const [sessionAgent, setSessionAgent] = useState('')
  // 看门狗 judge 回调需读最新 aliveAt（睡眠唤醒场景，闭包快照会滞后）
  const streamRef = useRef(stream)
  streamRef.current = stream
  // r14-ux：panel-ready 触发的在途 history-read 路径（还原重开前的对话）——
  // listener 的 history-file 分支只收它匹配的那条，HistoryView 自己的读取互不干扰
  const restorePathRef = useRef<string | null>(null)
  /** r47-ux：还原帧落地时的 resumable——codex 无 sessionId 只还原 UI 不可追问；
   *  不得把 history-file 分支硬写成 resumable:true（否则追问必得 session-lost） */
  const restoreResumableRef = useRef(true)
  /** r53（#5）：面板收起期间错过的任务终局（panel-ready 的 missedTerminal）——还原
   *  在途时暂存，待 history-file/兜底出口落地后并入消息尾（直接补会被还原的
   *  BLANK 整体替换吞掉，正是核心场景：错误终局 + 重开还原） */
  const missedErrRef = useRef<{ taskId: string; code?: string; message?: string } | null>(null)
  // r16：本面板锚定页签（get-state 初值 + panel-anchor 帧刷新）——任务帧「未绑定
  // 收养」瞬间的邮戳核验基准：别的页签任务的流不得在本面板凭空开场（串台根修）
  const anchorTabIdRef = useRef<number | null>(null)
  /** r16 收养守卫：未绑定（含 pending 等首帧窗口）时只收养本锚页签的任务帧；
   * 已绑定照收——折叠续流/双窗口恒广播语义不变。无邮戳的旧帧放行（向后兼容）。
   * r71（r70 code L15）：m 收窄到消费面（仅 tabId 邮戳）——as any 残留清零 */
  const foreignAdopt = (m: { tabId?: number }, s: typeof stream) =>
    s.taskId === null && s.activeId === null && typeof m.tabId === 'number' && m.tabId !== anchorTabIdRef.current

  // r65（r64 code#2）：本面板所在窗口——panel-anchor 帧的窗口界定（双窗双面板
  // 各只认自己窗的换锚，防全局广播共享锚架空 foreignAdopt）。dev mock/老 Chrome
  // 无 windows 时保持 null：界定退化为全收（旧行为）
  const myWindowIdRef = useRef<number | null>(null)
  useEffect(() => {
    try {
      chrome.windows?.getCurrent?.((w: chrome.windows.Window | undefined) => {
        if (typeof w?.id === 'number') myWindowIdRef.current = w.id
      })
    } catch { /* 无窗口语义环境：锚广播退化为全收 */ }
  }, [])

  useEffect(() => {
    // Esc 关 overlay（输入框/下拉自身的 Esc 处理在前，事件冒泡到此处才关面板）
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 看门狗：SW 被 Chrome 回收（OOM/更新/崩溃）时 NM port 随之消亡，host 也随之被终止，
  // 「心跳线」断——不再有任何 task-alive 帧。看门狗盯的是**host 存活**（心跳），不是
  // 「UI 有无内容帧」：host 活着就每 HEARTBEAT_MS 一次 task-alive（SW 由 heartbeat 转译），
  // codex 深度思考期整段静默无 chunk 但心跳照常 → 不误判（修复 R2-B1 的关键）。
  // 依赖仅 running（r8-ext：曾依赖 aliveAt——每个 task-chunk 都写 aliveAt，恰使
  // timer 每 chunk 重建，与 R2-m6 注释宣称的相反；judge 经 streamRef 读最新 aliveAt
  // 自行重订，语义不变且高频 chunk 下零冗余重建）
  const running = stream.activeId !== null || stream.pending
  useEffect(() => {
    if (!running) return
    // WATCHDOG_MS = 6 × host 心跳间隔（stdio.ts HEARTBEAT 20s）：连丢 6 次心跳才判死，
    // 容忍偶发丢帧/SW 短暂繁忙。三常量（此处 / heartbeat / 任务超时）关联见各处注释
    let timer: ReturnType<typeof setTimeout>
    const judge = () => {
      // 睡眠唤醒保护（r7-review）：timer 在睡眠中冻结、唤醒即派发，此刻 host 的
      // 首个 post-wake 心跳（最长 20s）可能未到——重读最新 aliveAt，未真超时则
      // 重订而非判死（误杀存活任务）。心跳到达时 effect 会因 aliveAt 变化重建
      const sinceAlive = Date.now() - streamRef.current.aliveAt
      if (sinceAlive < WATCHDOG_MS) {
        timer = setTimeout(judge, Math.max(WATCHDOG_MS - sinceAlive, 5_000))
        return
      }
      // 判死即取消（r7-ux，对齐 sw.ts「不白烧订阅额度」收敛原则）：SW 活/host 卡死
      // 场景收割在跑任务；SW 已死场景消息会唤醒 SW（currentTask 内存已空，带 taskId
      // 的取消被 SW 拒收、无操作），host 早随 port 消亡被 Chrome 收割，无害。带
      // taskId：双窗口场景 SW 只对号收割本面板绑定的任务，绝不错杀别窗口新任务
      chrome.runtime.sendMessage({ t: 'cancel', taskId: streamRef.current.taskId ?? undefined } satisfies PanelToSw).catch(() => {})
      setStream((s) => {
        if (s.activeId === null && !s.pending) return s
        // r8-ux：把本轮问题放回输入框（发送时已清空）——重发不必对着气泡手抄
        const lastUser = [...s.messages].reverse().find((m) => m.role === 'user')
        // r47-audit M1：refill 构造收敛 refillFor（wf 轮 text 置空 + 携带档位）
        const rf = refillFor(s, lastUser)
        return {
          ...s,
          taskId: null,
          pending: false,
          done: true,
          activeId: null,
          // r46（review P2）：条件扩到附件-only 轮（空 text + 有附件也回填，附件由
          // SummarizeView 的 lastAttsRef 快照还原）
          ...(rf ? { refill: rf } : {}),
          // 记 finished：真 host 若稍后复活，迟到 chunk 不得重开矛盾气泡（R2-m3 兜底）
          finished: s.taskId ? [...s.finished, s.taskId].slice(-8) : s.finished,
          messages: [
            ...s.messages.map((msg) => (msg.streaming ? { ...msg, streaming: false } : msg)),
            // 中性文案：不预设死因（可能是 SW 死，也可能是极端慢），普通用户可懂（R2-m4）。
            // r52（review #9）：wf 轮（一键总结）回填为空串——「已放回输入框」是假承诺，
            // 改指真实重试路径（与 retryNote 的 Enter 重发同机制）
            { id: `w${Date.now()}`, role: 'assistant', text: '', error: rf?.wf ? '一键总结超时未完成——直接按 Enter 以原模式重试' : '响应超时——你的问题已放回输入框，可直接重发', isError: true, undelivered: s.pending },
          ],
        }
      })
    }
    timer = setTimeout(judge, Math.max(WATCHDOG_MS - (Date.now() - stream.aliveAt), 25_000))
    // r16（3-agent P1）：真实睡眠 >120s 后唤醒——sinceAlive 必超限，judge 派发即
    // 冤杀仍在跑的任务（上方 r7 保护只盖 <WATCHDOG_MS 的冻结）。唤醒（面板可见性
    // 恢复）即重置存活计时并重开完整窗口：host 真死则连丢 6 次心跳后仍被新窗口
    // 判死；活着则首个 post-wake 心跳（≤20s）照常续命
    const onWake = () => {
      if (document.visibilityState !== 'visible') return
      clearTimeout(timer)
      setStream((s) => (s.activeId === null && !s.pending ? s : { ...s, aliveAt: Date.now() }))
      timer = setTimeout(judge, WATCHDOG_MS)
    }
    document.addEventListener('visibilitychange', onWake)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, [running])

  useEffect(() => {
    // SW 唤醒失败/通道异常：lastError 非空且 resp undefined——不等于「host 未装」，
    // 退避重试 2 次（500ms/1s）后仍失败保持 null（loading 态），不误导用户进安装引导
    let tries = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    const ping = () => {
      // r69（r68 code#1）：带己窗标识——SW 按窗界定回包锚（双窗重开不串台）。
      // myWindowId 未落定时缺省发送 = SW 沿用单例口径（旧面板兼容行为）
      const myW = myWindowIdRef.current
      chrome.runtime.sendMessage({ t: 'panel-ready', ...(myW != null ? { myWindowId: myW } : {}) } satisfies PanelToSw, (respRaw) => {
        const resp = respRaw as PanelReadyResp | undefined
        if (chrome.runtime.lastError && !resp) {
          // 前 2 次 500ms/1s 退避，之后降频 5s 持续轮询（r4-ux F4：耗尽即停会让
          // loading 成为全产品唯一无自愈出口的状态，对照 Onboarding 的自动轮询）。
          // r33-ux：>30s 仍失联（tries>7 ≈ 0.5+1+5×6s）置 stuck——loading 给「重新加载」出口
          tries += 1
          if (tries > 7) setPingStuck(true)
          retry = setTimeout(ping, tries <= 2 ? 500 * tries : 5_000)
          return
        }
        setHostOk(!!resp?.ok)
        if (typeof resp?.panelTabId === 'number') anchorTabIdRef.current = resp.panelTabId
        if (resp?.outdated) setOutdated(String(resp.outdated))
        // r57（#8）：升级软提示复用同一条横幅位（过旧阻断优先，二者互斥）
        else if (resp?.upgrade) setOutdated(String(resp.upgrade))
        if (resp?.ok) requestLists()
        if (resp?.page) setPageMeta(resp.page)
        setSessionPage(resp?.sessionPage ?? null)
        setPageUnsupported(!!resp?.pageUnsupported)
        // SW 侧态对齐（r4-ux）：面板切 tab 被收起后重开，React 态已丢——活会话 →
        // 恢复 resumable（追问不再静默降级为全量重总结+抹掉 SW 会话）；在跑任务 →
        // 重建 taskId 绑定 + 占位气泡（迟到 chunk 续流，不再孤儿流；任务已死则
        // 看门狗 120s 收尾）
        if (resp?.hasSession) {
          if (typeof resp.sessionAgentId === 'string') setSessionAgent(resp.sessionAgentId)
          // r47-ux：canResume=false（codex 等无 sessionId）只还原历史 UI，不开放追问
          const canResume = resp.canResume !== false
          restoreResumableRef.current = canResume
          // r14-ux：带 historyPath 时优先还原完整对话（history-file 回帧在 listener
          // 处理）；拿不到路径/读失败再退回 reopened 提示（「此前对话已清空」）
          const hp = typeof resp.historyPath === 'string' ? resp.historyPath : ''
          if (hp && !resp?.activeTask) {
            restorePathRef.current = hp
            chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-read', path: hp } } satisfies PanelToSw).catch(() => {})
            // 还原失败兜底（文件被删 / host 无回帧）：12s 后仍无 history-file 则退回
            // reopened 提示语义——绝不让追问入口锁死在中间态。
            // r46（review P6）：原 5s < host 冷启动可达 8s（nmport 自注释）——慢 spawn
            // 时迟到的还原帧被丢弃且误报「对话已清空」，兜底必须宽于重 spawn 窗口
            setTimeout(() => {
              if (restorePathRef.current === hp) {
                restorePathRef.current = null
                const mt = missedErrRef.current
                missedErrRef.current = null
                setStream((s) => ({
                  ...s,
                  resumable: canResume,
                  ...(canResume ? { reopened: true } : {}),
                  ...(mt ? { messages: [...s.messages, missedErrBubble(mt)] } : {}),
                }))
              }
            }, 12_000)
          } else {
            setStream((s) => ({
              ...s,
              resumable: canResume,
              // 无在跑任务时才提示（activeTask 在跑 = 迟到 chunk 会续流，不算丢失）
              // 可追问才标 reopened（否则文案「继续追问」与事实不符）
              ...(resp?.activeTask || !canResume ? {} : { reopened: true }),
            }))
          }
        }
        if (resp?.activeTask) {
          const at = resp.activeTask as { taskId: string; startedAt: number }
          setStream((s) => {
            if (s.finished.includes(at.taskId)) return s // 已终局任务（窄竞态）：不重建绑定
            if (s.taskId !== null || s.activeId !== null || s.pending) return s
            const id = `a${at.taskId}`
            return {
              ...s,
              taskId: at.taskId,
              activeId: id,
              // incomplete 预置（r9-backlog）：面板关闭期间 chunk 无接收端全部丢弃，
              // 重开只续尾巴且 gap 检测（依赖本会话 lastChunkSeq）必不触发——预置
              // 标记让终局后弱提示「完整版见历史」
              messages: [...s.messages, { id, role: 'assistant' as const, text: '', streaming: true, incomplete: true }],
              aliveAt: Date.now(),
              phase: `处理中（已 ${Math.max(1, Math.round((Date.now() - at.startedAt) / 1000))}s）…`,
            }
          })
        }
        // r53（#5）：面板收起期间错过的错误终局——SW 收件箱一次性补发。还原在途时
        // 暂存（history-file 的 BLANK 会吞掉此刻补的气泡），否则立即补错误气泡：
        // 重开面板零痕迹停在「看起来没事」是最差结局
        const mt = resp?.missedTerminal as { taskId: string; code?: string; message?: string } | undefined
        if (mt) {
          if (restorePathRef.current) {
            missedErrRef.current = mt
          } else {
            setStream((s) =>
              s.finished.includes(mt.taskId) ? s : {
                ...s,
                done: true,
                finished: [...s.finished, mt.taskId].slice(-8),
                messages: [...s.messages, missedErrBubble(mt)],
              },
            )
          }
        }
      })
    }
    // r69（r68 code#1）：首 ping 前先落定己窗（getCurrent 异步回调）——panel-ready
    // 的按窗锚界定依赖它，早发会把异窗重开面板的锚播种成 SW 单例（别窗的 tab）。
    // dev mock/老 Chrome 无 windows 语义时立即发（缺省 = 单例口径，行为不变）
    try {
      if (chrome.windows?.getCurrent) {
        chrome.windows.getCurrent((w: chrome.windows.Window | undefined) => {
          if (typeof w?.id === 'number') myWindowIdRef.current = w.id
          ping()
        })
      } else ping()
    } catch { ping() }
    const listener = (mRaw: unknown) => {
      const m = mRaw as PanelMsg
      switch (m.t) {
        case 'panel-toggle':
          // r30-2：SW 每次 onClicked 恒 open（已开时 no-op）+ 本广播。只有「点击的
          // 是我锚的 tab 且我当前可见」才是用户在同 tab 再按 = 要收起——换锚开/
          // 收起中恢复等其余场景不动作。sidePanel 无 SW 侧 close API，收起只能
          // 面板自 window.close()；会话态在 SW/storage.session，重开走 panel-ready
          // r46 豁免：终局是错误气泡时，图标点击是在照 no-permission 文案指引
          // 「点图标重新授权」——此刻收起面板等于打断自救（还得再点一次开面板），
          // 手势已完成重新授权，面板保持打开让用户直接重试
          if (typeof m.tabId === 'number' && m.tabId === anchorTabIdRef.current && !document.hidden) {
            const s = streamRef.current
            const last = [...s.messages].reverse().find((x) => x.role === 'assistant')
            const lastErrored = !s.taskId && !!last?.isError && !last?.cancelled
            if (!lastErrored) window.close()
          }
          break
        case 'panel-anchor':
          // r16：换锚不重载面板——收养邮戳的核验基准跟着锚走。
          // r65（r64 code#2）：帧带 windowId 时只认自己窗口的换锚（双窗双面板
          // 防串台）；帧无 windowId 或本面板未知己窗 → 全收（旧行为）
          if (
            typeof m.tabId === 'number' &&
            (m.windowId == null || myWindowIdRef.current == null || m.windowId === myWindowIdRef.current)
          ) anchorTabIdRef.current = m.tabId
          break
        case 'page-meta':
          setPageMeta(m.page)
          // r8-review：pageUnsupported 只在 panel-ready 同步过一次——tab 导航/切换后
          // placeholder 会与当前页事实不符，随 page-meta 广播一起更新
          setPageUnsupported(!!m.pageUnsupported)
          break
        case 'agents':
          // 单一事实源：SW 下发前已 merge 最近模型（agentsCache），panel 只渲染
          setAgents(m.agents as AgentStatus[])
          setAgentsLoaded(true)
          break
        case 'workflows': setWorkflows(m.items); break
        case 'history-file':
          // r14-ux：面板重开的对话还原（只收 restorePathRef 在途那条——HistoryView
          // 的详情读取由它自己的 listener 消费）。空正文退回 reopened 提示语义
          if (m.path !== restorePathRef.current) break
          restorePathRef.current = null
          {
            const msgs = parseHistoryTurns(m.content ?? '')
            // r53（#5）：还原落地时并入错过的错误终局（在途暂存的 missedTerminal）
            const mt = missedErrRef.current
            missedErrRef.current = null
            const missedMsg = mt ? missedErrBubble(mt) : null
            if (msgs.length) {
              setStream((s) => {
                // r46（review C4）：还原窗口内用户已抢先发出新轮（pending/已绑定任务）
                // ——整体 BLANK 会抹掉刚插入的用户气泡与任务绑定，迟到 chunk 只能靠
                // 收养逻辑凭空重建。还原让位：丢弃还原帧，保住用户主动开的新轮
                if (s.pending || s.taskId !== null) return s
                return {
                ...BLANK,
                done: true,
                // r47-ux：按 panel-ready 带出的 canResume 落 resumable（codex 只还原 UI）
                resumable: restoreResumableRef.current,
                finished: s.taskId ? [...s.finished, s.taskId].slice(-8) : s.finished,
                messages: missedMsg ? [...msgs, missedMsg] : msgs,
                }
              })
            } else {
              setStream((s) => ({
                ...s,
                resumable: restoreResumableRef.current,
                ...(restoreResumableRef.current ? { reopened: true } : {}),
                ...(missedMsg ? { messages: [...s.messages, missedMsg] } : {}),
              }))
            }
          }
          break
        case 'task-meta':
          setStream((s) => {
            // 台账/绑定双守卫（r5：曾是 6 个帧 handler 中唯一缺席者——取消 A 后起 B，
            // A 的迟到 meta 把 model 写上 B 的气泡并虚刷 B 的看门狗）
            if (s.finished.includes(m.taskId)) return s
            if (foreignAdopt(m, s)) return s
            if (s.taskId !== null && s.taskId !== m.taskId) return s
            return ({
            ...s,
            // 存活信号：重置看门狗（F4——重页提取+首心跳延迟叠加窗口）
            aliveAt: Date.now(),
            // sessionId 到达 = 可 CLI 级续接（claude 回带；codex 走 thread 续接不经此字段，r60 审计口径）
            resumable: s.resumable || !!m.sessionId,
            messages: s.messages.map((msg) =>
              msg.id === s.activeId || (msg.streaming && msg.id !== s.activeId)
                ? { ...msg, model: m.model ?? msg.model, agentId: m.agentId ?? msg.agentId }
                : msg,
            ),
          })
          })
          // 模型名收敛到下拉：帧自带 agentId，panel 直接 merge（不依赖 SW 内存态，
          // SW 长任务期间重启也不丢）
          if (m.model && m.agentId) {
            setAgents((as) => as.map((a) => (a.id === m.agentId ? { ...a, model: m.model } : a)))
          }
          break
        case 'task-chunk': {
          setStream((s) => {
            // 已终局任务的迟到 chunk（进程收割尾巴）：拒收——放行会新开永终局气泡
            if (s.finished.includes(m.taskId)) return s
            // r16：未绑定时只收养本锚页签的流（别的页签任务不得在本面板凭空开场）
            if (foreignAdopt(m, s)) return s
            // 首帧绑定或已绑定同任务；绑定后不同 taskId = 过期帧（取消后尾随），丢弃
            if (s.taskId !== null && s.taskId !== m.taskId) return s
            // r6-ux seq 跳变检测：host 每 chunk 递增 seq，SW 重放/断连窗口丢片时跳变
            // ——静默缺头比失败更误导，标记气泡，终局后提示重试（host 零改动）。
            // r59（审计 T6）：重复帧（seq ≤ 已收——重试/重放路径）整帧丢弃，防正文拼二遍
            // r60（代码审）：水位不跨任务——taskId 未绑定/切换时旧 lastChunkSeq 作废
            //（四终局不清水位的残留，否则新流 seq 从 0 起被旧水位整流吞成静默缺头）
            const prevSeq = s.taskId === m.taskId ? s.lastChunkSeq : undefined
            if (typeof prevSeq === 'number' && typeof m.seq === 'number' && m.seq <= prevSeq) return s
            const gap =
              typeof prevSeq === 'number' && typeof m.seq === 'number' && m.seq > prevSeq + 1
            const activeId = s.activeId ?? `a${m.taskId}`
            const messages = [...s.messages]
            const idx = messages.findIndex((x) => x.id === activeId)
            if (idx >= 0)
              messages[idx] = { ...messages[idx], text: messages[idx].text + m.text, ...(gap ? { incomplete: true } : {}) }
            else messages.push({ id: activeId, role: 'assistant', text: m.text, streaming: true })
            return { ...s, taskId: m.taskId, activeId, pending: false, messages, aliveAt: Date.now(), lastChunkSeq: m.seq }
          })
          break
        }
        case 'task-alive':
          // host 存活信号（heartbeat 转译）：为看门狗续命 + 给静默期进度感。
          // 不新建/改动气泡文本，只更新 aliveAt（看门狗依赖）+ phase 时长提示
          setStream((s) => {
            if (s.finished.includes(m.taskId)) return s
            if (foreignAdopt(m, s)) return s
            if (s.taskId !== null && s.taskId !== m.taskId) return s
            const secs = m.elapsedMs ? Math.round(m.elapsedMs / 1000) : 0
            const phase = secs > 30 ? `处理中（已 ${secs}s）…` : s.phase
            return { ...s, phase, aliveAt: Date.now() }
          })
          break
        case 'task-status':
          // status 先于首 chunk 到达（SW 的 reading 占位帧/host 的 thinking 帧）：
          // 也置 activeId + 占位消息，否则 running=false → 环形 loading / 停止钮 /
          // 光标都不出现
          setStream((s) => {
            if (s.finished.includes(m.taskId)) return s
            if (foreignAdopt(m, s)) return s
            if (s.taskId !== null && s.taskId !== m.taskId) return s
            const activeId = s.activeId ?? `a${m.taskId}`
            const messages = s.messages.some((x) => x.id === activeId)
              ? s.messages
              : [...s.messages, { id: activeId, role: 'assistant' as const, text: '', streaming: true, agentId: m.agentId }]
            // 已有气泡顺手快照 agentId（reading 占位帧先建气泡、meta 后到的次序）
            const patched = m.agentId
              ? messages.map((x) => (x.id === activeId ? { ...x, agentId: m.agentId as string | undefined } : x))
              : messages
            return { ...s, taskId: m.taskId, activeId, pending: false, messages: patched, aliveAt: Date.now(), phase: PHASE_LABEL[m.phase] ?? m.phase }
          })
          break
        case 'history-pruned':
          // r57（#24）：prune 实删通知（done 帧后异步到）——localStorage 标记只提示
          // 首次触顶，之后静默（不随每次总结重复打扰）
          if (!localStorage.getItem('pd-prune-noticed')) {
            try { localStorage.setItem('pd-prune-noticed', '1') } catch { /* quota */ }
            setPruneNotice({ removed: m.removed, limit: m.limit })
          }
          break
        case 'task-done':
          // r51 A2③：漂移感知排障信号——CLI 版本高于适配器实测时流中会出现未知事件。
          // 维护者指引放这里（console 本就是开发向通道），用户气泡只保留用户向文案
          if (m.unrecognized) console.debug(`[pagedive] 本轮流含 ${m.unrecognized} 个未识别事件（CLI 版本可能高于适配器实测），如遇异常请携此信息反馈；维护者：node scripts/record-fixtures.mjs 重采样适配`)
          setStream((s) => {
            // 已终局任务的迟到 done（r4-ux F2）：拒收——mismatch 分支会顺手收掉
            // 新任务还在 streaming 的气泡，与其他四个 handler 的台账守卫对齐
            if (s.finished.includes(m.taskId)) return s
            // r54（#3）：未绑定 + 他页签邮戳的迟到终局——本面板与该任务素不相识，
            // 不得定稿空闲态（六 handler 唯一缺口；SW tabOf 补盖邮戳后此守卫才有据可核）
            if (foreignAdopt(m, s)) return s
            // 过期帧（取消后旧任务迟到 done）：只收尾 streaming 气泡，不把新一轮定稿
            if (s.taskId !== null && s.taskId !== m.taskId) {
              return {
                ...s,
                messages: s.messages.map((msg) => (msg.streaming ? { ...msg, streaming: false } : msg)),
              }
            }
            return {
              ...s,
              // 终局即解绑 + 记入 finished：收割前的迟到帧不得重开气泡/劫持新一轮
              taskId: null,
              pending: false,
              // done 帧带 sessionId = 可 CLI 级续接（claude）；codex 走 thread 续接不经此字段
              resumable: s.resumable || !!m.sessionId,
              finished: [...s.finished, m.taskId].slice(-8),
              done: true,
              activeId: null,
              // r46（review P3）：is_error 终局回填本轮问题——claude 运行内失败打在
              // done 帧（硬约束 4 不能只看退出码），此前该路径不回填，重试需对气泡
              // 手抄；与 task-error/断连/看门狗同式（text 由 refill 携带、附件由
              // SummarizeView 的快照 ref 还原，见 lastAttsRef）
              ...(m.isError
                ? (() => {
                    // r47-audit M1：refill 构造收敛 refillFor（wf 轮 text 置空 + 携带档位）
                    const rf = refillFor(s, [...s.messages].reverse().find((x) => x.role === 'user'))
                    return rf ? { refill: rf } : {}
                  })()
                : {}),
              messages: s.messages.map((msg) =>
                msg.streaming
                  ? {
                      ...msg,
                      streaming: false,
                      isError: m.isError,
                      cliFault: m.isError,
                      error: m.isError ? authHint(m.errorText ?? 'CLI 运行内失败') : null,
                      usage: m.usage,
                      durationMs: m.durationMs,
                      model: m.model ?? msg.model,
                    }
                  : msg,
              ),
            }
          })
          // 兜底 merge（task-meta 未带 model 时）
          if (m.model && m.agentId) {
            setAgents((as) => as.map((a) => (a.id === m.agentId && a.model !== m.model ? { ...a, model: m.model } : a)))
          }
          break
        case 'task-error':
          setStream((s) => {
            // 已终局任务的迟到 error（如 content-mismatch 已收尾后 host 侧 cancelled 帧
            // 迟到）：拒收——否则同一事故叠出第二个错误气泡（与 chunk/status 对齐）
            if (s.finished.includes(m.taskId)) return s
            // r16：未绑定 + 他页签任务的取消帧（本页签起新总结连坐收割）——本面板
            // 与该任务素不相识，不得把空闲态误标成错误
            if (foreignAdopt(m, s)) return s
            // 过期帧（绑定的是别的任务）：不劫持新一轮状态，仅收尾还在 streaming 的气泡
            if (s.taskId !== null && s.taskId !== m.taskId) {
              // r74（r73 code low#8）：三戳单一事实源——此处只取 cancelled/undelivered，
              // 不引入 cliFault 新字段（过期帧收尾气泡此前无此前缀，保持）
              const st = stampTerminal(m.code)
              return {
                ...s,
                messages: s.messages.map((msg) =>
                  // r69（r68 code low#10）：cancelled 标记随码——sr-only 终局分流靠它
                  // 播「本轮已取消」，漏设会把取消播成「本轮已结束」。
                  // r71（r70 product L4）：error 不再硬编码「已取消」——过期帧可能是
                  // timeout 等非取消终局，照码分流；undelivered 同步（tips 分流依据）
                  msg.streaming ? { ...msg, streaming: false, error: m.code === 'cancelled' ? '已取消' : ERROR_LABEL[m.code ?? ''] ?? '本轮已结束', isError: true, cancelled: st.cancelled, undelivered: st.undelivered } : msg,
                ),
              }
            }
            // r33-ux：失败终局回填本轮问题（与看门狗/断连同式）——parse/timeout 等
            // 可重试失败不必对着气泡手抄重敲。cancelled 不回填（用户主动放弃）。
            // r46：条件扩到附件-only 轮（text 空串 + 有附件也回填）。
            // r52（review #9/#16）：构造提前到 error 文案之前——文案按「本轮是否一键
            // 总结」分流；timeout 不再拼裸英文原文（维护者通道走 console.debug）
            const lastUser = [...s.messages].reverse().find((msg) => msg.role === 'user')
            // r47-audit M1：refill 构造收敛 refillFor（wf 轮 text 置空 + 携带档位）；
            // cancelled 不回填（用户主动放弃）保持原语义
            const rf = m.code !== 'cancelled' ? refillFor(s, lastUser) : undefined
            if (m.code === 'timeout') console.debug('[pd] host timeout detail:', m.message)
            const messages = s.messages.map((msg) =>
              msg.streaming
                ? {
                    ...msg,
                    streaming: false,
                    // 用户主动停止：文案只「已取消」不拼英文 message、不标故障（r5-ux：
                    // 曾显示「CLI 报告运行失败：已取消: task cancelled」错怪 CLI）。
                    // r16 例外：连坐收割（他页签起新任务砍本任务）时 SW 下发的
                    // message 自带来源页说明——照抄，被折叠的面板切回时看得到解释
                    error:
                      m.code === 'cancelled'
                        ? m.message && m.message !== '已取消'
                          ? m.message
                          : '已取消'
                        // r52（review #16）：timeout 用完整用户向文案；wf 轮不给
                        // 「已放回输入框」假承诺（review #9）
                        : m.code === 'timeout'
                          ? rf?.wf
                            ? '一键总结超时未完成——直接按 Enter 以原模式重试'
                            : ERROR_LABEL.timeout
                        // r46（activetab-analysis P3）：content-mismatch 是 NM 传输
                        // 丢片非 CLI 故障——SW 下发的 message 已是完整文案，再拼
                        // ERROR_LABEL 会「正文传输不完整」重复两遍；单用 message
                        : m.code === 'content-mismatch' && m.message
                          ? m.message
                          // r76：启动前失败族帧通道优先 START_FAIL_LABEL（SW message 是
                          // 原始英文不拼进气泡）——不再落「未知错误（码 no-permission）」。
                          // r81（C12）：改走 terminalLabel 统一链（START_FAIL→ERROR_LABEL），
                          // 与 missedErrBubble 同源——两链分裂是 r72/r80/r81 缺键债温床
                          : terminalLabel(m.code) ?? `未知错误（码 ${m.code}）: ${authHint(m.message)}`,
                    isError: true,
                    // r74（r73 code low#8）：三戳收敛 stampTerminal——统一 missed 版
                    // 三排除（多排 ext-restarted，实时不可达：SW 冷启动孤儿指针折算
                    // 必走 missed 路径），零行为变化
                    ...stampTerminal(m.code),
                  }
                : msg,
            )
            return {
              ...s,
              taskId: null,
              pending: false,
              finished: [...s.finished, m.taskId].slice(-8),
              done: true,
              activeId: null,
              // r80(A)：CLI 侧 resume 目标丢失——置 false 后下一条自动走全新总结
              //（对齐下方启动前 session-lost 自愈写法，SW 侧同步清会话句柄）
              ...(m.code === 'session-lost' ? { resumable: false } : {}),
              ...(rf ? { refill: rf } : {}),
              messages,
            }
          })
          break
        case '__host-disconnected':
          // host 崩溃/被杀（能断连 = 曾连上过 ≠ 未安装）：不闪跳安装引导——卸载面板
          // 丢对话态且「还差一步」文案误导重装（r4-ux）。收尾气泡即可：nmPort.send
          // 断线自动重 spawn，重试发送即自愈；真死透时重试走 host-not-found → Onboarding。
          // pending 也必须终局（r4-ux F1）：spawn 窗口断连时 pending=true 且无任何气泡，
          // 不清则输入锁死至看门狗 120s 且零提示
          setStream((s) => {
            // 双守卫（r6-sec，与其余 6 个帧 handler 对齐）：带 taskId 的断连帧——
            // ① 该任务已终局（finished 台账）→ 拒收；② 面板绑定的是别的任务
            // （SW 已重 spawn、新一轮健在）→ 整体拒收，不得把新一轮标「连接中断」。
            // 无 taskId（断连时无在跑任务）保持原语义（spawn 窗口 pending 兜底）
            if (m.taskId != null) {
              if (s.finished.includes(m.taskId)) return s
              if (s.taskId !== null && s.taskId !== m.taskId) return s
            }
            // r53（#6）：空闲态（无 pending 且无绑定任务）断连直接忽略——NM 空闲断连/
            // host 崩溃后 SW 自动重 spawn 是常态，上一轮已终局的问题不得凭空回到
            // 输入框（refillFor 无条件构造会把用户已发出且成功的问题再回填一遍）
            if (!s.pending && s.taskId == null) return s
            // r8-ux：断连终局同样回填本轮问题（与看门狗判死同式）。
            // r52（review #9）：refill 提前——wf 轮（一键总结）回填为空串，「已放回
            // 输入框」是假承诺，改指真实重试路径
            const lastUser = [...s.messages].reverse().find((msg) => msg.role === 'user')
            // r47-audit M1：refill 构造收敛 refillFor（wf 轮 text 置空 + 携带档位）
            const rf = refillFor(s, lastUser)
            const TEXT = rf?.wf
              ? '一键总结未完成——直接按 Enter 以原模式重试'
              // r53（#10）：回填对已有草稿是静默跳过（SummarizeView 守卫）——文案如实
              : '本机组件连接中断——你的问题已放回输入框（未覆盖已有草稿），可直接重发'
            // r76（r75 code medium#4）：断连三戳统一经 stampTerminal——断连=正文已过
            // stdin 的已送达失败（undelivered:false，同 missed 路径），此前收尾气泡零三戳、
            // 新气泡硬编码 undelivered:true，同一事故的 tips 分流取决于面板当时开没开
            const DISC = stampTerminal('host-disconnected')
            const messages = s.messages.map((msg) =>
              msg.streaming ? { ...msg, streaming: false, error: TEXT, isError: true, ...DISC } : msg,
            )
            // pending ⟺ 本轮尚无任何 assistant 帧——必然零气泡，断连即补（r5 修正：
            // 曾用 !messages.some(isError) 判定，上一轮遗留的错误气泡会吞掉本轮反馈）
            const needBubble = s.pending
            return {
              ...s,
              taskId: null,
              pending: false,
              done: true,
              activeId: null,
              // r46（review P2）：条件扩到附件-only 轮（空 text + 有附件也回填，附件由
          // SummarizeView 的 lastAttsRef 快照还原）
          ...(rf ? { refill: rf } : {}),
              finished: s.taskId ? [...s.finished, s.taskId].slice(-8) : s.finished,
              messages: needBubble
                ? [...messages, { id: `e${Date.now()}`, role: 'assistant' as const, text: '', error: TEXT, isError: true, ...DISC }]
                : messages,
            }
          })
          break
        case 'error':
          // r53（#9）：还原读取失败（文件被外部移动/删除，host 回 read-fail）——此前
          // 无消费端，干等 12s 兜底才降级。error 帧到达即走同一退回（reopened 语义）
          if (m.code === 'read-fail' && m.ref === restorePathRef.current) {
            restorePathRef.current = null
            const mt = missedErrRef.current
            missedErrRef.current = null
            setStream((s) => ({
              ...s,
              resumable: restoreResumableRef.current,
              ...(restoreResumableRef.current ? { reopened: true } : {}),
              ...(mt ? { messages: [...s.messages, missedErrBubble(mt)] } : {}),
            }))
          }
          break
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => {
      clearTimeout(retry)
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [])

  function requestLists() {
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'list-agents' } } satisfies PanelToSw)
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'list-workflows' } } satisfies PanelToSw)
  }

  function onStartResult(resp: { error?: string; agentId?: string; taskId?: string; [k: string]: unknown }) {
    // r11：send 回调只对本轮生效（无迟到帧问题）——对齐实际执行 CLI，
    // 防跨 CLI 换会话后下拉错标（beginSession 已清，这里回填正确值）
    if (typeof resp.agentId === 'string') setSessionAgent(resp.agentId)
    if (resp?.error === 'host-not-found') {
      // r10-review：'host-not-found' 几乎只对应 NM 瞬断（host 刚死、onDisconnect
      // 未达，nmport catch 清 port 后下次调用即重 spawn 自愈）——立即切 Onboarding
      // 会让已装用户看到假安装引导，且 probe 成功后 location.reload() 丢整段对话
      // 态（与 __host-disconnected 分支「不闪跳」的 r4-ux 决策矛盾）。先走错误
      // 气泡，异步 probe 复核：真连不上才落安装引导。
      // r58（#23）：复核退避——SW 重 spawn 有竞态窗，零退避一次判死会在 host 恢复
      // 途中就闪跳安装引导丢对话态；0ms/1.5s/4s 三探皆死才落
      void (async () => {
        const ok = async () => {
          try { return !!((await chrome.runtime.sendMessage({ t: 'panel-ready' } satisfies PanelToSw)) as { ok?: boolean } | null)?.ok }
          catch { return false }
        }
        let dead = !(await ok())
        for (const ms of [1500, 4000]) {
          if (!dead) break
          await new Promise((r) => setTimeout(r, ms))
          dead = !(await ok())
        }
        if (dead) setHostOk(false)
      })()
      resp = { ...resp, error: 'host-not-found-retry' }
    }
    if (resp?.error) {
      // r76（r75 product high#3）：14 键文案表并入 terminal.ts START_FAIL_LABEL——
      // 帧通道（task-error 同码）同查一张表，双通道一副面孔；detail 原始英文由
      // 回调通道句尾拼接（截断上限沿 r46 口径）
      const code = String(resp.error)
      const DETAIL_MAX: Record<string, number> = { 'inject-failed': 120, 'extract-crash': 80, 'no-permission': 120 }
      // r81（M3/C12）：terminalLabel 统一链（START_FAIL→ERROR_LABEL）——SW 四处
      // return { error: 'host-not-found' } 此前落英文裸码（仅 START_FAIL 一层查不到）
      const base = terminalLabel(code) ?? code
      const msg = resp.detail && DETAIL_MAX[code] ? `${base}（原始信息：${String(resp.detail).slice(0, DETAIL_MAX[code])}）` : base
      setStream((s) => {
        // 旧轮 send 的迟到取消回调（新对话后重发，SW 提取窗口秒级）：resp.taskId 已
        // 在终局台账——静默丢弃，勿清掉新一轮 pending/滤掉其占位气泡（r4-regression）
        if (typeof resp.taskId === 'string' && s.finished.includes(resp.taskId)) return s
        // 同类窄漏（r4-impl）：cancelled 在 SW reading 占位帧发出前被顶替——taskId 从
        // 未进台账，台账守卫拦不住；与当前绑定不符即无事故可报，静默丢弃
        if (resp.error === 'cancelled' && resp.taskId !== s.taskId) return s
        // 已被 newChat/新会话清场的空 stream = 旧轮 send 的迟到回调——错误气泡注入
        // 全新空会话是新用户首屏最常见的脏态（r3-ux R3-m1），静默丢弃
        if (s.pending === false && s.taskId === null && s.activeId === null && s.messages.length === 0) return s
        return {
          ...s,
          // 终局（含 SW reading 占位帧已绑定 taskId 的失败路径）：解绑 + 收尾——
          // 滤掉空的占位气泡（streaming 且无正文），错误以独立气泡呈现
          taskId: null,
          pending: false,
          done: true,
          activeId: null,
          // session-lost 自愈（r7-review）：SW 会话已丢，保持 resumable 会让重发
          // 再次 followUp → 再次 session-lost 死循环——置 false 后下一条自动走
          // 全新总结，与上方「直接重新发送即可」文案闭环
          ...(resp.error === 'session-lost' ? { resumable: false } : {}),
          messages: [
            ...s.messages.filter((x) => !(x.streaming && !x.text)),
            { id: `e${Date.now()}`, role: 'assistant', text: '', error: msg, isError: true,
              // r74（r73 code low#8）：三戳收敛 stampTerminal（此处只取两戳——启动前
              // 失败无 cliFault 语义；原前置 !== 'cancelled' 冗余，cancelled 不在集）
              cancelled: stampTerminal(resp.error).cancelled,
              undelivered: stampTerminal(resp.error).undelivered,
              ...(resp.error === 'no-permission' ? { grantHost: true } : {}) },
          ],
        }
      })
    }
  }

  /** 发送前插入用户消息气泡 + 重置任务态（新一轮开始）。
   * pending=true：send 后到首个任务帧前的窗口里 running 判定靠它兜住（防双发）。
   * resumable 是会话级字段：追问轮间保留（F1——曾随 BLANK 清零，失败窗口后
   * 下一句追问静默降级全新总结 + 下拉解锁闪变） */
  const beginTurn = useCallback((text: string, attachments?: { name: string; kind?: 'text' | 'image' }[], skills?: string[], wf?: string) => {
    setStream((s) => ({
      ...BLANK,
      pending: true,
      resumable: s.resumable,
      // finished 台账保留（r4-regression）：展开 BLANK 曾清空台账，旧轮带 taskId 的
      // 迟到 cancelled 回调无从对账而击穿 pending 态；台账只拒同 taskId，新 id 不撞
      finished: s.taskId ? [...s.finished, s.taskId].slice(-8) : s.finished,
      aliveAt: Date.now(), // 看门狗起点：发送即计时，首个 host 帧/心跳到达前靠它兜住
      // r47-audit M1：wf = 一键总结（空输入 CTA）轮的执行档位——失败回填据此恢复
      messages: [...s.messages, { id: `u${Date.now()}`, role: 'user', text, ...(attachments?.length ? { attachments } : {}), ...(skills?.length ? { skills } : {}), ...(wf ? { wf } : {}) }],
    }))
  }, [])

  /** 新任务开始（总结首轮）：清空消息重新开聊天。
   * 在跑任务（被 newChat 取消）的尾巴 chunk 不得落入空会话——把在跑 taskId
   * 记入 finished（F9：在跑任务从未终局、不在台账，仅保留旧台账无效） */
  const beginSession = useCallback(
    () => {
      setSessionAgent('') // r11：新会话清陈旧值——否则 codex 会话后开 claude 首轮，下拉错标 codex 到首个追问帧到达
      setStream((s) => ({ ...BLANK, finished: s.taskId ? [...s.finished, s.taskId].slice(-8) : s.finished }))
    },
    [],
  )

  // 设置页开关 CLI 后（pd-settings-changed）联动：手动选中被禁用时回退到默认 CLI，再到首个可用
  const disabledClis = useDisabledClis()

  /** 历史详情「继续对话」：解析 pd:user/pd:assistant 分段还原多轮气泡 + 通知 SW 恢复会话 */
  const resumeHistory = useCallback((item: HistoryItem, body: string) => {
    setOverlay(null)
    // r54（#4）：作废在途还原——12s 窗口内点「继续对话」后，迟到的 history-file
    // 若仍被 restorePathRef 放行，会把刚装载的会话整体 BLANK 成旧记录内容
    restorePathRef.current = null
    // 记录的 CLI 已停用/卸载（r7-ux）：显示与执行必须一致——effectiveAgent 会回退到
    // 其他 CLI，若 SW 仍装载旧会话，追问实际执行的是历史 agent（必然失败）。改走
    // 「只恢复正文、不装载会话」。agents 未加载完（空列表）按可用处理（首屏窗口极短）。
    // r8-review：只查 available 漏了停用——SW 无停用概念，装载后追问照样执行被停用
    // CLI 而下拉显示回退 CLI，「关闭仅从主界面下拉隐藏」的设置文案也被打破
    const rec = agents.find((a) => a.id === item.agent)
    const agentOk = !agents.length || (!!rec?.available && !disabledClis.has(item.agent))
    if (agentOk) setAgentId(item.agent)
    // 首条 id 带 item.ts 前缀：parseHistoryTurns 固定用 h0/h1…，连续恢复两条不同 agent
    // 的历史时 firstMsgId 都是 h0 不变 → SummarizeView 的 followAgent 指纹不触发重置
    // （头部 CLI 显示与真实执行不符，R2-M1）。带 ts 使跨条目唯一。
    // agentId 快照（r7-review）：历史气泡不带快照会在 CLI 停用时被错标成回退 CLI
    const msgs: ChatMessage[] = parseHistoryTurns(body).map((m) => ({ ...m, id: `t${item.ts}-${m.id}`, agentId: item.agent }))
    setStream((s) => ({
      ...BLANK,
      done: true,
      // 历史带 sessionId 才可续（HistoryView 也仅在有 sessionId 时显示「继续对话」）
      resumable: agentOk && !!item.sessionId,
      // 在跑任务尾巴同 F9：记入 finished 防首帧绑定落入恢复的会话
      finished: s.taskId ? [...s.finished, s.taskId].slice(-8) : s.finished,
      messages: [
        ...(msgs.length
          ? msgs
          // 空正文（error 历史）：给出占位说明，避免空白气泡 + 误判 hasSession
          : [{ id: `h${item.ts}`, role: 'assistant' as const, text: '（该记录无正文——发送消息将开始全新总结）', error: '该历史记录状态为失败，无对话上下文可续', isError: true }]),
        ...(agentOk ? [] : [{ id: `w${item.ts}`, role: 'assistant' as const, text: `> ⚠️ 该记录的 CLI（${item.agent}）当前不可用或已在设置中停用——继续发送将总结**当前打开的页面**（非本条历史）` }]),
      ],
    }))
    // tips 条同步为该历史条目的来源页——仅可续会话时（r7-review：CLI 不可用走全新
    // 总结，SW 提取的是当前 tab，显示历史来源页会与执行相矛盾）。
    // r33-ux：agentOk 但条目无 title/url（罕见）时清空而非残留上一页的 meta
    if (agentOk) setPageMeta(item.title || item.url ? { title: item.title ?? '', url: item.url ?? '' } : null)
    if (agentOk) {
      // r67（r66 code#1）：帧携带发起面板锚——SW 收割判定/sessions 键按它对号，
      // panelTabId 单例被双窗后开面板覆盖时不再误杀/漏杀
      chrome.runtime.sendMessage({ t: 'resume-history', agentId: item.agent, sessionId: item.sessionId, historyPath: item.path, anchorTabId: anchorTabIdRef.current ?? undefined } satisfies PanelToSw).catch(() => {})
    } else if (streamRef.current.taskId) {
      // 只收割本面板绑定的任务（不装载会话前清场，对齐 SW 侧 resume-history 的
      // 顺带收割语义）——裸 cancel 无条件杀全局 currentTask，双窗口下连坐别窗在
      // 跑任务（r63 审计 M1）；未绑定则无事可清不发帧，别窗尾随 chunk 由 r16
      // foreignAdopt 锚页签拒收，不会污染本面板
      chrome.runtime.sendMessage({ t: 'cancel', taskId: streamRef.current.taskId } satisfies PanelToSw).catch(() => {})
    }
  }, [agents, disabledClis])

  const [defaultCli, setDefaultCli] = useState('')
  useEffect(() => {
    const sync = () => { try { setDefaultCli(localStorage.getItem('pd-default-cli') ?? '') } catch { /* */ } }
    sync()
    window.addEventListener('pd-settings-changed', sync)
    return () => window.removeEventListener('pd-settings-changed', sync)
  }, [])
  // r32-a11y：焦点还原——打开 overlay 时记触发按钮（effect 里抓 activeElement 会
  // 晚于容器 autoFocus，抓到的是容器内元素），关闭时还焦
  const overlayTriggerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!overlay && overlayTriggerRef.current) {
      overlayTriggerRef.current.focus()
      overlayTriggerRef.current = null
    }
  }, [overlay])
  const toggleOverlay = (o: 'history' | 'settings') => {
    if (overlay === o) {
      setOverlay(null)
      setSettingsTab(undefined)
    } else {
      overlayTriggerRef.current = document.activeElement as HTMLElement | null
      if (o === 'settings') setSettingsTab(undefined) // 工具栏入口默认 CLI tab
      setOverlay(o)
    }
  }
  /** r47-ux：历史底栏 → 设置·数据（关历史、开设置并落到 data tab） */
  const openSettingsData = () => {
    overlayTriggerRef.current = document.activeElement as HTMLElement | null
    setSettingsTab('data')
    setOverlay('settings')
  }

  const effectiveAgent =
    (agentId && !disabledClis.has(agentId) ? agentId : '')
    || (defaultCli && !disabledClis.has(defaultCli) && agents.some((a) => a.id === defaultCli && a.available) ? defaultCli : '')
    || agents.find((a) => a.available && !disabledClis.has(a.id))?.id
    || 'claude'

  // 早退必须在所有 hooks 之后：hostOk 从 null 翻 false 会减少 hook 数量，React 直接崩树白屏
  // 探测期（node 冷启动 probe 最长 8s）：中性 loading——主视图 agents=[] 会命中
  // 「未检测到本机 AI CLI」假告示（r4-ux），误导已装用户
  if (hostOk === null) {
    return (
      <div className="pd-app">
        <main className="pd-history-empty" style={{ padding: 24 }}>
          正在连接本机组件…
          {/* r33-ux：持续失联 >30s 时的手动出口——loading 不再是无出口的死态 */}
          {pingStuck && (
            <button
              onClick={() => location.reload()}
              style={{ display: 'block', margin: '12px auto 0', fontSize: 12, padding: '5px 14px', cursor: 'pointer' }}
            >
              重新加载面板
            </button>
          )}
        </main>
      </div>
    )
  }
  if (hostOk === false) return <Onboarding />

  return (
    <div className="pd-app">
      {/* 浮动工具条（右上角，避开系统 header）：历史 / 设置 */}
      <div className="pd-float-tools">
        <button
          onClick={() => toggleOverlay('history')}
          className={`pd-icon-btn ${overlay === 'history' ? 'active' : ''}`}
          title="总结历史"
          aria-label="总结历史"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 4.8V8l2.2 1.6" />
          </svg>
        </button>
        <button
          onClick={() => toggleOverlay('settings')}
          className={`pd-icon-btn ${overlay === 'settings' ? 'active' : ''}`}
          title="设置"
          aria-label="设置"
        >
          {/* 标准齿轮：外圈齿 + 中孔 */}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.8 1.8h2.4l.4 1.8c.5.2 1 .4 1.4.7l1.7-.7 1.2 2.1-1.3 1.3a5.6 5.6 0 0 1 0 1.6l1.3 1.3-1.2 2.1-1.7-.7c-.4.3-.9.5-1.4.7l-.4 1.8H6.8l-.4-1.8a5.6 5.6 0 0 1-1.4-.7l-1.7.7-1.2-2.1 1.3-1.3a5.6 5.6 0 0 1 0-1.6L2.1 5.7l1.2-2.1 1.7.7c.4-.3.9-.5 1.4-.7l.4-1.8Z" />
            <circle cx="8" cy="8" r="2.2" />
          </svg>
        </button>
      </div>

      <main className="pd-main">
        {outdated && (
          <div className="pd-error" role="alert" style={{ margin: '8px 12px 0' }}>
            <span>{outdated}</span>
            {/* r56（#14）：横幅文案含两段式升级命令——手抄必错（版本号/ext-id 各 20+ 字符），
                命令在末段（「请在终端执行：」之后），按钮只复制命令本身 */}
            <button
              type="button"
              style={{ flex: 'none', fontSize: 12, cursor: 'pointer' }}
              onClick={() => {
                navigator.clipboard
                  .writeText(outdated.slice(outdated.lastIndexOf('：') + 1))
                  .then(() => {
                    setCmdCopied(true)
                    setTimeout(() => setCmdCopied(false), 1500)
                  })
                  .catch(() => {
                    // r58（#20）：面板失焦时 writeText reject——显式失败态，不静默谎报
                    setCmdFail(true)
                    setTimeout(() => setCmdFail(false), 2500)
                  })
              }}
            >
              {cmdCopied ? '已复制 ✓' : cmdFail ? '复制失败——请手动选中复制' : '复制命令'}
            </button>
          </div>
        )}
        <SummarizeView agents={agents} workflows={workflows} stream={stream} agentId={effectiveAgent} onAgentChange={setAgentId} onStartResult={onStartResult} beginTurn={beginTurn} beginSession={beginSession} pageMeta={pageMeta} sessionPage={sessionPage} resumable={stream.resumable} sessionAgentId={sessionAgent} pageUnsupported={pageUnsupported} agentsLoaded={agentsLoaded} getAnchorTabId={() => anchorTabIdRef.current} pruneNotice={pruneNotice} onDismissPruneNotice={() => setPruneNotice(null)} onOpenSettings={openSettingsData} />
      </main>

      {/* r35-motion：overlay 关闭先播 160ms 退场再卸载（useExitValue 期间保持旧值渲染） */}
      {ov.shown === 'history' && (
        <DialogLayer label="总结历史" onClose={() => setOverlay(null)} exiting={ov.exiting}>
          <HistoryView onClose={() => setOverlay(null)} onResume={resumeHistory} onOpenSettings={openSettingsData} />
        </DialogLayer>
      )}
      {ov.shown === 'settings' && (
        <DialogLayer label="设置" onClose={() => { setOverlay(null); setSettingsTab(undefined) }} exiting={ov.exiting}>
          <Settings agents={agents} onClose={() => { setOverlay(null); setSettingsTab(undefined) }} initialTab={settingsTab} />
        </DialogLayer>
      )}
    </div>
  )
}

// 看门狗判死阈值 = 6 × host 心跳间隔（packages/host/src/stdio.ts 的 20s heartbeat）。
// host 活着就有心跳（SW 转译成 task-alive 喂 panel），连丢 6 次才判「host/SW 死」——
// 远小于 host 侧任务超时 10min（task.ts TASK_TIMEOUT_MS），二者互补：host 活着靠心跳续命，
// host 死了靠此看门狗解锁。改此值需同步核对 stdio.ts 心跳间隔。
const WATCHDOG_MS = 120_000

const PHASE_LABEL: Record<string, string> = {
  spawned: '已启动 CLI',
  reading: '正在读取正文',
  thinking: '思考中…',
}

/** r56（#13）：missedTerminal 错误气泡组装（4 个还原入口共用）——按 code 分流，
 *  对齐实时 task-error 分支（:611/:613）：ext-restarted 是扩展自身重启、cancelled/
 *  content-mismatch 非 CLI 故障，不挂「CLI 报告运行失败」前缀；timeout 用中文标签，
 *  不把 host 原始英文 message 拼进气泡 */
function missedErrBubble(mt: { taskId: string; code?: string; message?: string }) {
  return {
    id: `m${mt.taskId}`,
    role: 'assistant' as const,
    text: '',
    error: mt.code === 'timeout'
      ? '任务超时——请重新发起'
      // r58（#22）：cancelled/content-mismatch 单用已定文案——host 的 message
      //（"task cancelled" 等）与 label 同义，拼接成「已取消: task cancelled」双重前缀
      : mt.code === 'cancelled' ? '已取消'
      : mt.code === 'content-mismatch' ? (mt.message || '正文传输不完整，已取消——请重试')
      // r81（C12）：改走 terminalLabel 统一链（START_FAIL→ERROR_LABEL）——此前只查
      // ERROR_LABEL，仅 START_FAIL 有键的可达码（host-not-found）落「未知错误」。
      // r74：missedTerminal.code 跨进程即 string——闭集外新码仍落 ?? 兜底
      : `${terminalLabel(mt.code) ?? `未知错误（码 ${mt.code ?? 'error'}）`}${mt.message ? `: ${authHint(mt.message)}` : ''}`,
    isError: true,
    // r72（r71 code C2）：收件箱补发的取消终局同样带 cancelled——tips 五态在 missed
    // 落点此前误落「已分享」（stopped 判据读 cancelled，与实时分支 :675 不同步）。
    // r74（r73 code low#8）：三戳收敛 stampTerminal（本函数即统一版语义的原型）
    ...stampTerminal(mt.code),
  }
}

/** CLI 鉴权/额度类错误归一化（r7-ux）：install 探测不含登录态（--version 无需登录），
 * 未登录用户首次总结才见 CLI 原始英文鉴权报错——前置中文指引；非鉴权文本原样返回。
 * r59（审计 T8）：额度耗尽同置顶——「复用已有订阅」卖点下的高频真实失败。
 * r60（产品审）：限流/过载与网络档——重度用户连发追问的高频第二失败面。
 * r61（产品审）：限流档前置——「Rate limit reached」此前被额度档 limit reached 先截胡，
 * 误导「升级套餐」；429/529 加词边界防 ETIMEDOUT after 4290ms 误判；网络档补全形态 */
function authHint(text: string): string {
  if (/rate[ _-]?limit|too many requests|\b429\b|\b529\b|overloaded|capacity/i.test(text))
    return `请求过于频繁或服务暂时过载——稍等片刻后重试；若持续出现，检查 CLI 服务状态。原始信息：${text}`
  if (/usage ?limit|limit reached|quota|insufficient credits|额度/i.test(text))
    return `订阅额度已用尽——等待额度重置、升级套餐或切换账号后重试。原始信息：${text}`
  if (/network|fetch failed|connection (error|reset|closed)|ECONNRESET|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|timed out/i.test(text))
    return `网络连接失败——检查本机网络（含代理）后重试。原始信息：${text}`
  return /log ?in|sign ?in|authenticat|unauthorized|api[ _-]?key|credential|401/i.test(text)
    ? `该 CLI 尚未登录或凭证已失效——请在终端运行一次该 CLI 完成登录后重试。原始信息：${text}`
    : text
}