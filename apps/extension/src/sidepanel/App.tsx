import { useEffect, useState } from 'react'
import type { AgentStatus, HostToExt, WorkflowItem } from '@pagedive/shared'
import { Onboarding } from './Onboarding.js'
import { SummarizeView } from './SummarizeView.js'
import { HistoryView } from './HistoryView.js'
import { Settings } from './Settings.js'

type View = 'main' | 'history' | 'settings'

export interface TaskStreamState {
  taskId: string | null
  text: string
  phase: string
  error: string | null
  isError: boolean
  done: boolean
  usage?: { inputTokens?: number; outputTokens?: number }
}

export function App() {
  const [view, setView] = useState<View>('main')
  const [hostOk, setHostOk] = useState<boolean | null>(null)
  const [agents, setAgents] = useState<AgentStatus[]>([])
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [stream, setStream] = useState<TaskStreamState>({
    taskId: null, text: '', phase: '', error: null, isError: false, done: false,
  })

  useEffect(() => {
    // 面板就绪：探测 host
    chrome.runtime.sendMessage({ t: 'panel-ready' }, (resp) => {
      setHostOk(!!resp?.connected)
      if (resp?.connected) requestLists()
    })
    // host 帧直通
    const listener = (m: HostToExt) => {
      switch (m.t) {
        case 'agents': setAgents(m.agents); break
        case 'workflows': setWorkflows(m.items); break
        case 'task-chunk':
          setStream((s) => ({ ...s, text: s.text + m.text }))
          break
        case 'task-status':
          setStream((s) => ({ ...s, phase: PHASE_LABEL[m.phase] ?? m.phase, taskId: m.taskId }))
          break
        case 'task-done':
          setStream((s) => ({
            ...s, done: true, isError: m.isError,
            error: m.isError ? m.errorText ?? 'CLI 运行内失败' : null,
            usage: m.usage,
          }))
          break
        case 'task-error':
          setStream((s) => ({ ...s, done: true, error: `${m.code}: ${m.message}` }))
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

  if (hostOk === false) return <Onboarding />

  return (
    <div className="flex h-screen flex-col bg-neutral-50 text-neutral-900">
      <header className="flex items-center justify-between border-b bg-white px-3 py-2">
        <h1 className="text-sm font-semibold">PageDive</h1>
        <nav className="flex gap-1 text-xs">
          {(['main', 'history', 'settings'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded px-2 py-1 ${view === v ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100'}`}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </nav>
      </header>
      <main className="flex-1 overflow-hidden">
        {view === 'main' && (
          <SummarizeView agents={agents} workflows={workflows} stream={stream} />
        )}
        {view === 'history' && <HistoryView />}
        {view === 'settings' && <Settings agents={agents} />}
      </main>
    </div>
  )
}

const VIEW_LABEL: Record<View, string> = { main: '总结', history: '历史', settings: '设置' }
const PHASE_LABEL: Record<string, string> = {
  spawned: '已启动 CLI',
  reading: '正在读取正文',
  thinking: '思考中…',
}
