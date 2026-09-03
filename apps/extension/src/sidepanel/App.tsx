import { useEffect, useState } from 'react'
import type { AgentStatus, HostToExt, WorkflowItem } from '@pagedive/shared'
import { Onboarding } from './Onboarding.js'
import { SummarizeView } from './SummarizeView.js'
import { HistoryView } from './HistoryView.js'
import { Settings } from './Settings.js'

type Overlay = null | 'history' | 'settings'

export interface TaskStreamState {
  taskId: string | null
  text: string
  phase: string
  error: string | null
  isError: boolean
  done: boolean
  usage?: { inputTokens?: number; outputTokens?: number }
}

const BLANK: TaskStreamState = {
  taskId: null, text: '', phase: '', error: null, isError: false, done: false,
}

export function App() {
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [hostOk, setHostOk] = useState<boolean | null>(null)
  const [agents, setAgents] = useState<AgentStatus[]>([])
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [probed, setProbed] = useState(false)
  const [stream, setStream] = useState<TaskStreamState>(BLANK)

  useEffect(() => {
    chrome.runtime.sendMessage({ t: 'panel-ready' }, (resp) => {
      setHostOk(!!resp?.ok)
      if (resp?.ok) requestLists()
    })
    const listener = (m: HostToExt) => {
      switch (m.t) {
        case 'agents': setAgents(m.agents); setProbed(true); break
        case 'workflows': setWorkflows(m.items); break
        case 'task-chunk':
          setStream((s) =>
            s.taskId === m.taskId
              ? { ...s, text: s.text + m.text }
              : { ...BLANK, taskId: m.taskId, text: m.text },
          )
          break
        case 'task-status':
          setStream((s) =>
            s.taskId === m.taskId || s.taskId === null
              ? { ...s, taskId: m.taskId, phase: PHASE_LABEL[m.phase] ?? m.phase }
              : s,
          )
          break
        case 'task-done':
          setStream((s) =>
            s.taskId === m.taskId
              ? {
                  ...s, done: true, isError: m.isError,
                  error: m.isError ? m.errorText ?? 'CLI 运行内失败' : null,
                  usage: m.usage,
                }
              : s,
          )
          break
        case 'task-error':
          setStream((s) =>
            s.taskId === m.taskId || s.taskId === null
              ? { ...s, taskId: m.taskId, done: true, error: `${ERROR_LABEL[m.code] ?? m.code}: ${m.message}` }
              : s,
          )
          break
        case '__host-disconnected':
          setHostOk(false)
          setStream((s) => (s.taskId && !s.done ? { ...s, done: true, error: '本机 host 连接中断' } : s))
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
      setStream((s) => ({ ...s, done: true, error: msg }))
    }
  }

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
        </div>
      </header>

      <main className="pd-main">
        <SummarizeView agents={agents} workflows={workflows} stream={stream} onStartResult={onStartResult} probed={probed} />
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