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
  agentId?: string
}

export interface TaskStreamState {
  /** 当前绑定任务；null = 无任务。过期帧拒绝：null 只接受「首帧绑定」，
   * 已绑定后不同 taskId 一律丢弃——防取消后旧任务尾随帧劫持新一轮 */
  taskId: string | null
  messages: ChatMessage[]
  /** 正在生成的 assistant 消息 id */
  activeId: string | null
  phase: string
  done: boolean
}

const BLANK: TaskStreamState = {
  taskId: null, messages: [], activeId: null, phase: '', done: false,
}

export interface PageMeta {
  title: string
  url: string
  favIconUrl?: string
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

  useEffect(() => {
    chrome.runtime.sendMessage({ t: 'panel-ready' }, (resp) => {
      // SW 唤醒失败/通道异常：lastError 非空且 resp undefined——不等于「host 未装」，
      // 保持 null（loading 态）等下一轮探测，不误导用户进安装引导
      if (chrome.runtime.lastError) return
      setHostOk(!!resp?.ok)
      if (resp?.outdated) setOutdated(String(resp.outdated))
      if (resp?.ok) requestLists()
      if (resp?.page) setPageMeta(resp.page)
    })
    const listener = (m: any) => {
      switch (m.t) {
        case 'page-meta':
          setPageMeta(m.page)
          break
        case 'agents':
          // host 探测结果可能晚于 task-meta：保留 panel 已捕获的 model 不被覆盖
          setAgents((prev) => {
            const known = new Map(prev.filter((a) => a.model).map((a) => [a.id, a.model!]))
            return (m.agents as AgentStatus[]).map((a) => (known.has(a.id) && !a.model ? { ...a, model: known.get(a.id) } : a))
          })
          break
        case 'workflows': setWorkflows(m.items); break
        case 'task-meta':
          setStream((s) => ({
            ...s,
            messages: s.messages.map((msg) =>
              msg.id === s.activeId || (msg.streaming && msg.id !== s.activeId)
                ? { ...msg, model: m.model ?? msg.model }
                : msg,
            ),
          }))
          // 模型名收敛到下拉：帧自带 agentId，panel 直接 merge（不依赖 SW 内存态，
          // SW 长任务期间重启也不丢）
          if (m.model && m.agentId) {
            setAgents((as) => as.map((a) => (a.id === m.agentId ? { ...a, model: m.model } : a)))
          }
          break
        case 'task-chunk': {
          setStream((s) => {
            // 首帧绑定或已绑定同任务；绑定后不同 taskId = 过期帧（取消后尾随），丢弃
            if (s.taskId !== null && s.taskId !== m.taskId) return s
            const activeId = s.activeId ?? `a${m.taskId}`
            const messages = [...s.messages]
            const idx = messages.findIndex((x) => x.id === activeId)
            if (idx >= 0) messages[idx] = { ...messages[idx], text: messages[idx].text + m.text }
            else messages.push({ id: activeId, role: 'assistant', text: m.text, streaming: true })
            return { ...s, taskId: m.taskId, activeId, messages }
          })
          break
        }
        case 'task-status':
          // status 先于首 chunk 到达（thinking 期数秒）：也置 activeId + 占位消息，
          // 否则 running=false → 环形 loading / 停止钮 / 光标都不出现
          setStream((s) => {
            if (s.taskId !== null && s.taskId !== m.taskId) return s
            const activeId = s.activeId ?? `a${m.taskId}`
            const messages = s.messages.some((x) => x.id === activeId)
              ? s.messages
              : [...s.messages, { id: activeId, role: 'assistant' as const, text: '', streaming: true }]
            return { ...s, taskId: m.taskId, activeId, messages, phase: PHASE_LABEL[m.phase] ?? m.phase }
          })
          break
        case 'task-done':
          setStream((s) => ({
            ...s,
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
          }))
          // 兜底 merge（task-meta 未带 model 时）
          if (m.model && m.agentId) {
            setAgents((as) => as.map((a) => (a.id === m.agentId && a.model !== m.model ? { ...a, model: m.model } : a)))
          }
          break
        case 'task-error':
          setStream((s) => {
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
                ? { ...msg, streaming: false, error: `${ERROR_LABEL[m.code] ?? m.code}: ${m.message}`, isError: true }
                : msg,
            )
            return { ...s, taskId: m.taskId, done: true, activeId: null, messages }
          })
          break
        case '__host-disconnected':
          setHostOk(false)
          setStream((s) => ({
            ...s,
            done: true,
            activeId: null,
            messages: s.messages.map((msg) =>
              msg.streaming ? { ...msg, streaming: false, error: '本机 host 连接中断' } : msg,
            ),
          }))
          break
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
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
        : resp.error === 'session-lost' ? '会话已失效（扩展服务重启）——本次将开始全新总结'
        : String(resp.error)
      setStream((s) => ({
        ...s,
        done: true,
        activeId: null,
        messages: [...s.messages, { id: `e${Date.now()}`, role: 'assistant', text: '', error: msg, isError: true }],
      }))
    }
  }

  /** 发送前插入用户消息气泡 + 重置任务态（新一轮开始） */
  const beginTurn = useCallback((text: string) => {
    setStream((s) => ({
      ...BLANK,
      messages: [...s.messages, { id: `u${Date.now()}`, role: 'user', text }],
    }))
  }, [])

  /** 新任务开始（总结首轮）：清空消息重新开聊天 */
  const beginSession = useCallback(() => setStream(BLANK), [])

  /** 历史详情「继续对话」：解析 pd:user/pd:assistant 分段还原多轮气泡 + 通知 SW 恢复会话 */
  const resumeHistory = useCallback((item: HistoryItem, body: string) => {
    setOverlay(null)
    setAgentId(item.agent)
    const msgs: ChatMessage[] = parseHistoryTurns(body)
    setStream({
      taskId: null,
      messages: msgs.length
        ? msgs
        // 空正文（error 历史）：给出占位说明，避免空白气泡 + 误判 hasSession
        : [{ id: `h${item.ts}`, role: 'assistant' as const, text: '（该记录无正文——发送消息将开始全新总结）', error: '该历史记录状态为失败，无对话上下文可续', isError: true }],
      activeId: null,
      phase: '',
      done: true,
    })
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
        <SummarizeView agents={agents} workflows={workflows} stream={stream} agentId={effectiveAgent} onAgentChange={setAgentId} onStartResult={onStartResult} beginTurn={beginTurn} beginSession={beginSession} pageMeta={pageMeta} />
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
}