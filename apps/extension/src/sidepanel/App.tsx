import { useCallback, useEffect, useState } from 'react'
import type { AgentStatus, HistoryItem, HostToExt, WorkflowItem } from '@ai-page-dive/shared'
import { Onboarding } from './Onboarding.js'
import { SummarizeView, useDisabledClis } from './SummarizeView.js'
import { HistoryView } from './HistoryView.js'
import { Settings } from './Settings.js'

type Overlay = null | 'history' | 'settings'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
  model?: string
  usage?: { inputTokens?: number; outputTokens?: number }
  error?: string | null
  isError?: boolean
  /** 用户主动停止等非故障终局：红样式保留但不带「CLI 报告运行失败」前缀（r5-ux） */
  cancelled?: boolean
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
}

const BLANK: TaskStreamState = {
  taskId: null, messages: [], activeId: null, pending: false, finished: [], phase: '', done: false, resumable: false, aliveAt: 0,
}

export interface PageMeta {
  title: string
  url: string
  favIconUrl?: string
  /** 提取质量提示（截断/低置信），PageTips 条展示；无则不渲染 */
  notice?: string
}

export function App() {
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [hostOk, setHostOk] = useState<boolean | null>(null)
  const [outdated, setOutdated] = useState('')
  const [agents, setAgents] = useState<AgentStatus[]>([])
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [stream, setStream] = useState<TaskStreamState>(BLANK)
  const [agentId, setAgentId] = useState('')
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null)

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
  // 依赖 aliveAt（任一存活信号刷新）而非整个 stream：避免每 chunk 重建 timer（R2-m6）。
  const running = stream.activeId !== null || stream.pending
  useEffect(() => {
    if (!running) return
    // WATCHDOG_MS = 6 × host 心跳间隔（stdio.ts HEARTBEAT 20s）：连丢 6 次心跳才判死，
    // 容忍偶发丢帧/SW 短暂繁忙。三常量（此处 / heartbeat / 任务超时）关联见各处注释
    const elapsed = Date.now() - stream.aliveAt
    const timer = setTimeout(() => {
      setStream((s) => {
        if (s.activeId === null && !s.pending) return s
        return {
          ...s,
          taskId: null,
          pending: false,
          done: true,
          activeId: null,
          // 记 finished：真 host 若稍后复活，迟到 chunk 不得重开矛盾气泡（R2-m3 兜底）
          finished: s.taskId ? [...s.finished, s.taskId].slice(-8) : s.finished,
          messages: [
            ...s.messages.map((msg) => (msg.streaming ? { ...msg, streaming: false } : msg)),
            // 中性文案：不预设死因（可能是 SW 死，也可能是极端慢），普通用户可懂（R2-m4）
            { id: `w${Date.now()}`, role: 'assistant', text: '', error: '响应超时——请点「新对话」或重试', isError: true },
          ],
        }
      })
    }, Math.max(WATCHDOG_MS - elapsed, 25_000))
    return () => clearTimeout(timer)
  }, [running, stream.aliveAt])

  useEffect(() => {
    // SW 唤醒失败/通道异常：lastError 非空且 resp undefined——不等于「host 未装」，
    // 退避重试 2 次（500ms/1s）后仍失败保持 null（loading 态），不误导用户进安装引导
    let tries = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    const ping = () => {
      chrome.runtime.sendMessage({ t: 'panel-ready' }, (resp) => {
        if (chrome.runtime.lastError && !resp) {
          // 前 2 次 500ms/1s 退避，之后降频 5s 持续轮询（r4-ux F4：耗尽即停会让
          // loading 成为全产品唯一无自愈出口的状态，对照 Onboarding 的自动轮询）
          tries += 1
          retry = setTimeout(ping, tries <= 2 ? 500 * tries : 5_000)
          return
        }
        setHostOk(!!resp?.ok)
        if (resp?.outdated) setOutdated(String(resp.outdated))
        if (resp?.ok) requestLists()
        if (resp?.page) setPageMeta(resp.page)
        // SW 侧态对齐（r4-ux）：面板切 tab 被收起后重开，React 态已丢——活会话 →
        // 恢复 resumable（追问不再静默降级为全量重总结+抹掉 SW 会话）；在跑任务 →
        // 重建 taskId 绑定 + 占位气泡（迟到 chunk 续流，不再孤儿流；任务已死则
        // 看门狗 120s 收尾）
        if (resp?.hasSession) setStream((s) => ({ ...s, resumable: true }))
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
              messages: [...s.messages, { id, role: 'assistant' as const, text: '', streaming: true }],
              aliveAt: Date.now(),
              phase: `处理中（已 ${Math.max(1, Math.round((Date.now() - at.startedAt) / 1000))}s）…`,
            }
          })
        }
      })
    }
    ping()
    const listener = (m: any) => {
      switch (m.t) {
        case 'page-meta':
          setPageMeta(m.page)
          break
        case 'agents':
          // 单一事实源：SW 下发前已 merge 最近模型（agentsCache），panel 只渲染
          setAgents(m.agents as AgentStatus[])
          break
        case 'workflows': setWorkflows(m.items); break
        case 'task-meta':
          setStream((s) => {
            // 台账/绑定双守卫（r5：曾是 6 个帧 handler 中唯一缺席者——取消 A 后起 B，
            // A 的迟到 meta 把 model 写上 B 的气泡并虚刷 B 的看门狗）
            if (s.finished.includes(m.taskId)) return s
            if (s.taskId !== null && s.taskId !== m.taskId) return s
            return ({
            ...s,
            // 存活信号：重置看门狗（F4——重页提取+首心跳延迟叠加窗口）
            aliveAt: Date.now(),
            // sessionId 到达 = 该 CLI 支持追问（claude 有、codex 无）
            resumable: s.resumable || !!m.sessionId,
            messages: s.messages.map((msg) =>
              msg.id === s.activeId || (msg.streaming && msg.id !== s.activeId)
                ? { ...msg, model: m.model ?? msg.model }
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
            // 首帧绑定或已绑定同任务；绑定后不同 taskId = 过期帧（取消后尾随），丢弃
            if (s.taskId !== null && s.taskId !== m.taskId) return s
            // r6-ux seq 跳变检测：host 每 chunk 递增 seq，SW 重放/断连窗口丢片时跳变
            // ——静默缺头比失败更误导，标记气泡，终局后提示重试（host 零改动）
            const gap =
              typeof s.lastChunkSeq === 'number' && typeof m.seq === 'number' && m.seq > s.lastChunkSeq + 1
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
            if (s.taskId !== null && s.taskId !== m.taskId) return s
            const activeId = s.activeId ?? `a${m.taskId}`
            const messages = s.messages.some((x) => x.id === activeId)
              ? s.messages
              : [...s.messages, { id: activeId, role: 'assistant' as const, text: '', streaming: true }]
            return { ...s, taskId: m.taskId, activeId, pending: false, messages, aliveAt: Date.now(), phase: PHASE_LABEL[m.phase] ?? m.phase }
          })
          break
        case 'task-done':
          setStream((s) => {
            // 已终局任务的迟到 done（r4-ux F2）：拒收——mismatch 分支会顺手收掉
            // 新任务还在 streaming 的气泡，与其他四个 handler 的台账守卫对齐
            if (s.finished.includes(m.taskId)) return s
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
              // done 帧带 sessionId = 可追问（claude）；codex 无 → resumable 保持 false
              resumable: s.resumable || !!m.sessionId,
              finished: [...s.finished, m.taskId].slice(-8),
              done: true,
              activeId: null,
              messages: s.messages.map((msg) =>
                msg.streaming
                  ? {
                      ...msg,
                      streaming: false,
                      isError: m.isError,
                      error: m.isError ? m.errorText ?? 'CLI 运行内失败' : null,
                      usage: m.usage,
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
            // 过期帧（绑定的是别的任务）：不劫持新一轮状态，仅收尾还在 streaming 的气泡
            if (s.taskId !== null && s.taskId !== m.taskId) {
              return {
                ...s,
                messages: s.messages.map((msg) =>
                  msg.streaming ? { ...msg, streaming: false, error: '已取消', isError: true } : msg,
                ),
              }
            }
            const messages = s.messages.map((msg) =>
              msg.streaming
                ? {
                    ...msg,
                    streaming: false,
                    // 用户主动停止：文案只「已取消」不拼英文 message、不标故障（r5-ux：
                    // 曾显示「CLI 报告运行失败：已取消: task cancelled」错怪 CLI）
                    error: m.code === 'cancelled' ? '已取消' : `${ERROR_LABEL[m.code] ?? m.code}: ${m.message}`,
                    isError: true,
                    cancelled: m.code === 'cancelled',
                  }
                : msg,
            )
            // 终局即解绑 + 记入 finished（同 task-done：拒迟到帧重开）
            return { ...s, taskId: null, pending: false, finished: [...s.finished, m.taskId].slice(-8), done: true, activeId: null, messages }
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
            const TEXT = '本机组件连接中断——请重试发送'
            const messages = s.messages.map((msg) =>
              msg.streaming ? { ...msg, streaming: false, error: TEXT, isError: true } : msg,
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
              finished: s.taskId ? [...s.finished, s.taskId].slice(-8) : s.finished,
              messages: needBubble
                ? [...messages, { id: `e${Date.now()}`, role: 'assistant' as const, text: '', error: TEXT, isError: true }]
                : messages,
            }
          })
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
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'list-agents' } })
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'list-workflows' } })
  }

  function onStartResult(resp: { error?: string; [k: string]: unknown }) {
    if (resp?.error === 'host-not-found') setHostOk(false)
    else if (resp?.error) {
      const msg =
        resp.error === 'no-tab' ? '没有可总结的页面（先在普通网页上点扩展图标）'
        : resp.error === 'unsupported-page' ? '浏览器内置页面无法提取（chrome:// 等）'
        : resp.error === 'no-permission' ? '无提取权限：浏览器要求换页后重新授权——点击工具栏上的 AI PageDive 图标后重试'
        : resp.error === 'empty-content' ? '页面没有可提取的正文'
        : resp.error === 'cancelled' ? '已取消'
        : resp.error === 'session-lost' ? '会话已失效（扩展服务重启）——请点「新对话」后重新发送本次问题'
        : String(resp.error)
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
          messages: [
            ...s.messages.filter((x) => !(x.streaming && !x.text)),
            { id: `e${Date.now()}`, role: 'assistant', text: '', error: msg, isError: true, cancelled: resp.error === 'cancelled' },
          ],
        }
      })
    }
  }

  /** 发送前插入用户消息气泡 + 重置任务态（新一轮开始）。
   * pending=true：send 后到首个任务帧前的窗口里 running 判定靠它兜住（防双发）。
   * resumable 是会话级字段：追问轮间保留（F1——曾随 BLANK 清零，失败窗口后
   * 下一句追问静默降级全新总结 + 下拉解锁闪变） */
  const beginTurn = useCallback((text: string) => {
    setStream((s) => ({
      ...BLANK,
      pending: true,
      resumable: s.resumable,
      // finished 台账保留（r4-regression）：展开 BLANK 曾清空台账，旧轮带 taskId 的
      // 迟到 cancelled 回调无从对账而击穿 pending 态；台账只拒同 taskId，新 id 不撞
      finished: s.taskId ? [...s.finished, s.taskId].slice(-8) : s.finished,
      aliveAt: Date.now(), // 看门狗起点：发送即计时，首个 host 帧/心跳到达前靠它兜住
      messages: [...s.messages, { id: `u${Date.now()}`, role: 'user', text }],
    }))
  }, [])

  /** 新任务开始（总结首轮）：清空消息重新开聊天。
   * 在跑任务（被 newChat 取消）的尾巴 chunk 不得落入空会话——把在跑 taskId
   * 记入 finished（F9：在跑任务从未终局、不在台账，仅保留旧台账无效） */
  const beginSession = useCallback(
    () => setStream((s) => ({ ...BLANK, finished: s.taskId ? [...s.finished, s.taskId].slice(-8) : s.finished })),
    [],
  )

  /** 历史详情「继续对话」：解析 pd:user/pd:assistant 分段还原多轮气泡 + 通知 SW 恢复会话 */
  const resumeHistory = useCallback((item: HistoryItem, body: string) => {
    setOverlay(null)
    setAgentId(item.agent)
    // 首条 id 带 item.ts 前缀：parseHistoryTurns 固定用 h0/h1…，连续恢复两条不同 agent
    // 的历史时 firstMsgId 都是 h0 不变 → SummarizeView 的 followAgent 指纹不触发重置
    // （头部 CLI 显示与真实执行不符，R2-M1）。带 ts 使跨条目唯一
    const msgs: ChatMessage[] = parseHistoryTurns(body).map((m) => ({ ...m, id: `t${item.ts}-${m.id}` }))
    setStream((s) => ({
      ...BLANK,
      done: true,
      // 历史带 sessionId 才可续（HistoryView 也仅在有 sessionId 时显示「继续对话」）
      resumable: !!item.sessionId,
      // 在跑任务尾巴同 F9：记入 finished 防首帧绑定落入恢复的会话
      finished: s.taskId ? [...s.finished, s.taskId].slice(-8) : s.finished,
      messages: msgs.length
        ? msgs
        // 空正文（error 历史）：给出占位说明，避免空白气泡 + 误判 hasSession
        : [{ id: `h${item.ts}`, role: 'assistant' as const, text: '（该记录无正文——发送消息将开始全新总结）', error: '该历史记录状态为失败，无对话上下文可续', isError: true }],
    }))
    // tips 条同步为该历史条目的来源页
    if (item.title || item.url) setPageMeta({ title: item.title ?? '', url: item.url ?? '' })
    chrome.runtime.sendMessage({ t: 'resume-history', agentId: item.agent, sessionId: item.sessionId, historyPath: item.path }).catch(() => {})
  }, [])

  // 设置页开关 CLI 后（pd-settings-changed）联动：手动选中被禁用时回退到默认 CLI，再到首个可用
  const disabledClis = useDisabledClis()
  const [defaultCli, setDefaultCli] = useState('')
  useEffect(() => {
    const sync = () => { try { setDefaultCli(localStorage.getItem('pd-default-cli') ?? '') } catch { /* */ } }
    sync()
    window.addEventListener('pd-settings-changed', sync)
    return () => window.removeEventListener('pd-settings-changed', sync)
  }, [])
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
        <main className="pd-history-empty" style={{ padding: 24 }}>正在连接本机组件…</main>
      </div>
    )
  }
  if (hostOk === false) return <Onboarding />

  return (
    <div className="pd-app">
      {/* 浮动工具条（右上角，避开系统 header）：历史 / 设置 */}
      <div className="pd-float-tools">
        <button
          onClick={() => setOverlay(overlay === 'history' ? null : 'history')}
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
          onClick={() => setOverlay(overlay === 'settings' ? null : 'settings')}
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
          </div>
        )}
        <SummarizeView agents={agents} workflows={workflows} stream={stream} agentId={effectiveAgent} onAgentChange={setAgentId} onStartResult={onStartResult} beginTurn={beginTurn} beginSession={beginSession} pageMeta={pageMeta} resumable={stream.resumable} />
      </main>

      {overlay === 'history' && (
        <div className="pd-overlay pd-fade-in-fast">
          <HistoryView onClose={() => setOverlay(null)} onResume={resumeHistory} />
        </div>
      )}
      {overlay === 'settings' && (
        <div className="pd-overlay pd-fade-in-fast">
          <Settings agents={agents} onClose={() => setOverlay(null)} />
        </div>
      )}
    </div>
  )
}

/**
 * 历史正文 → 多轮消息。host 落盘格式：首轮 assistant 全文在前，
 * 追问轮以 <!-- pd:user --> / <!-- pd:assistant --> 注释分段。
 * 旧格式（无标记）整体作为一条 assistant 消息。
 */
function parseHistoryTurns(body: string): ChatMessage[] {
  const raw = body.trim()
  if (!raw) return []
  const msgs: ChatMessage[] = []
  // 首段（到第一个 pd:user 标记前）= 首轮 assistant 回答
  const parts = raw.split(/<!-- pd:(user|assistant) -->/)
  if (parts[0].trim()) {
    msgs.push({ id: 'h0', role: 'assistant', text: parts[0].trim() })
  }
  // split 产物交替：[text, tag, text, tag, text…]，tag 后的 text 属于该角色
  for (let i = 1; i < parts.length; i += 2) {
    const role = parts[i] === 'user' ? 'user' : 'assistant'
    const text = (parts[i + 1] ?? '').trim()
    if (text) msgs.push({ id: `h${i}`, role, text })
  }
  return msgs
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
const ERROR_LABEL: Record<string, string> = {
  'spawn-fail': 'CLI 启动失败（未安装或不在 PATH）',
  timeout: '任务超时',
  cancelled: '已取消',
  parse: 'CLI 输出异常',
  'no-agent': '未知 CLI',
  'bad-request': '请求参数不完整',
  'content-mismatch': '正文传输不完整，已取消——请重试',
}