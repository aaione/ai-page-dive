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

const BLANK: TaskStreamState = {
  taskId: null, text: '', phase: '', error: null, isError: false, done: false,
}

export function App() {
  const [view, setView] = useState<View>('main')
  const [hostOk, setHostOk] = useState<boolean | null>(null)
  const [agents, setAgents] = useState<AgentStatus[]>([])
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [stream, setStream] = useState<TaskStreamState>(BLANK)

  useEffect(() => {
    // 面板就绪：ping→pong 真实探测 host（SW 侧 8s 超时，node 冷启动可慢）
    chrome.runtime.sendMessage({ t: 'panel-ready' }, (resp) => {
      setHostOk(!!resp?.ok)
      if (resp?.ok) requestLists()
    })
    // host 帧直通
    const listener = (m: HostToExt) => {
      switch (m.t) {
        case 'agents': setAgents(m.agents); break
        case 'workflows': setWorkflows(m.items); break
        case 'task-chunk':
          // 换任务即重置（防旧任务文本拼接）
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
          <SummarizeView agents={agents} workflows={workflows} stream={stream} onStartResult={onStartResult} />
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
const ERROR_LABEL: Record<string, string> = {
  'spawn-fail': 'CLI 启动失败（未安装或不在 PATH）',
  timeout: '任务超时',
  cancelled: '已取消',
  parse: 'CLI 输出异常',
  'no-agent': '未知 CLI',
}
