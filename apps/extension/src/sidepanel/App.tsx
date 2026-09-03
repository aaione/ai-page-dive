import { useCallback, useEffect, useState } from 'react'
import type { AgentStatus, HostToExt, WorkflowItem } from '@pagedive/shared'
import { Onboarding } from './Onboarding.js'
import { SummarizeView } from './SummarizeView.js'
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

  useEffect(() => {
    chrome.runtime.sendMessage({ t: 'panel-ready' }, (resp) => {
      setHostOk(!!resp?.ok)
      if (resp?.ok) requestLists()
    })
    const listener = (m: HostToExt) => {
      switch (m.t) {
        case 'agents': setAgents(m.agents); break
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
        : resp.error === 'no-permission' ? '无提取权限：请先点击工具栏上的 PageDive 图标'
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

  return (
    <div className="pd-app">
      <header className="pd-header">
        <div className="pd-header-brand">
          <svg viewBox="0 0 16 16" className="pd-icon" fill="currentColor">
            <path d="M8 1.5 9.6 6.4 14.5 8 9.6 9.6 8 14.5 6.4 9.6 1.5 8 6.4 6.4Z" />
          </svg>
          <h1 className="pd-title">Page<span className="pd-accent-text">Dive</span></h1>
        </div>
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
        <SummarizeView agents={agents} workflows={workflows} stream={stream} onStartResult={onStartResult} beginTurn={beginTurn} beginSession={beginSession} />
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