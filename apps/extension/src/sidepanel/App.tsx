import { useCallback, useEffect, useState } from 'react'
import type { AgentStatus, HostToExt, WorkflowItem } from '@pagedive/shared'
import { Onboarding } from './Onboarding.js'
import { SummarizeView, ModelDropdown } from './SummarizeView.js'
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

export function App() {
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [hostOk, setHostOk] = useState<boolean | null>(null)
  const [agents, setAgents] = useState<AgentStatus[]>([])
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [stream, setStream] = useState<TaskStreamState>(BLANK)
  const [agentId, setAgentId] = useState('')
  const [pinned, setPinned] = useState(true)

  function togglePinned() {
    const next = !pinned
    setPinned(next)
    chrome.runtime.sendMessage({ t: 'set-pinned', value: next }).catch(() => {})
  }

  useEffect(() => {
    chrome.runtime.sendMessage({ t: 'panel-ready' }, (resp) => {
      setHostOk(!!resp?.ok)
      if (resp?.ok) requestLists()
    })
    const listener = (m: HostToExt) => {
      switch (m.t) {
        case 'agents':
          // host 探测结果可能晚于 task-meta：保留 panel 已捕获的 model 不被覆盖
          setAgents((prev) => {
            const known = new Map(prev.filter((a) => a.model).map((a) => [a.id, a.model!]))
            return m.agents.map((a) => (known.has(a.id) && !a.model ? { ...a, model: known.get(a.id) } : a))
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
            if (s.taskId !== null && s.taskId !== m.taskId) return s // 过期 chunk
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
            if (s.taskId !== m.taskId && s.taskId !== null) return s
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
            const messages = s.messages.map((msg) =>
              msg.streaming
                ? { ...msg, streaming: false, error: `${ERROR_LABEL[m.code] ?? m.code}: ${m.message}`, isError: true }
                : msg,
            )
            if (s.taskId === m.taskId || s.taskId === null) {
              return { ...s, taskId: m.taskId, done: true, activeId: null, messages }
            }
            return { ...s, messages }
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
        : resp.error === 'no-permission' ? '无提取权限：浏览器要求换页后重新授权——点击工具栏上的 PageDive 图标后重试'
        : resp.error === 'empty-content' ? '页面没有可提取的正文'
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

  if (hostOk === false) return <Onboarding />

  const usable = agents.filter((a) => a.available)
  const effectiveAgent = agentId || usable[0]?.id || 'claude'

  return (
    <div className="pd-app">
      <header className="pd-header">
        <ModelDropdown
          value={effectiveAgent}
          onChange={setAgentId}
          items={usable.map((a) => ({
            key: a.id,
            label: a.id,
            hint: a.model ?? (a.version || undefined),
          }))}
          fallback="未检测到 CLI"
          ariaLabel="选择 CLI 模型"
        />
        <div className="pd-header-actions">
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
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="2.2" />
              <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" />
            </svg>
          </button>
          <button
            onClick={togglePinned}
            className={`pd-icon-btn ${pinned ? 'active' : ''}`}
            title={pinned ? '已钉住：点击图标直接打开面板' : '未钉住：点击图标打开面板需先点击'}
            aria-label={pinned ? '取消钉住' : '钉住'}
            aria-pressed={pinned}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 1.5 14.5 6.5 12.6 8.4 11.9 7.7 8.2 11.4 8.5 13.2 8 13.7 2.3 8 2.8 7.5 4.6 7.8 8.3 4.1 7.6 3.4 9.5 1.5Z" />
            </svg>
          </button>
          <button
            onClick={() => window.close()}
            className="pd-icon-btn"
            title="关闭"
            aria-label="关闭"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </header>

      <main className="pd-main">
        <SummarizeView agents={agents} workflows={workflows} stream={stream} agentId={effectiveAgent} onAgentChange={setAgentId} onStartResult={onStartResult} beginTurn={beginTurn} beginSession={beginSession} />
      </main>

      {overlay === 'history' && (
        <div className="pd-overlay pd-fade-in-fast">
          <HistoryView onClose={() => setOverlay(null)} />
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