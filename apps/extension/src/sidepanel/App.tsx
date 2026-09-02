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
    <div className="relative flex h-screen flex-col font-sans text-pd-ink">
      {/* 顶部：玻璃条 —— 品牌 + 右上角图标收纳（Gemini 范式） */}
      <header className="pd-glass z-10 flex h-11 shrink-0 items-center justify-between rounded-none border-x-0 border-t-0 px-4">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 16 16" className="h-4 w-4 text-pd-primary" fill="currentColor">
            <path d="M8 1.5 9.6 6.4 14.5 8 9.6 9.6 8 14.5 6.4 9.6 1.5 8 6.4 6.4Z" />
          </svg>
          <h1 className="text-[13px] font-semibold tracking-[0.02em]">
            Page<span className="text-pd-primary">Dive</span>
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOverlay(overlay === 'history' ? null : 'history')}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-pd-hover ${overlay === 'history' ? 'bg-pd-hover text-pd-ink' : 'text-pd-ink-2'}`}
            title="总结历史"
            aria-label="总结历史"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 4.8V8l2.2 1.6" />
            </svg>
          </button>
          <button
            onClick={() => setOverlay(overlay === 'settings' ? null : 'settings')}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-pd-hover ${overlay === 'settings' ? 'bg-pd-hover text-pd-ink' : 'text-pd-ink-2'}`}
            title="设置"
            aria-label="设置"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="2.2" />
              <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" />
            </svg>
          </button>
        </div>
      </header>

      {/* 主视图永不消失；历史/设置为玻璃覆盖层 */}
      <SummarizeView agents={agents} workflows={workflows} stream={stream} onStartResult={onStartResult} />

      {overlay === 'history' && (
        <div className="pd-fade-in-fast pointer-events-none absolute inset-0 z-20 pt-11 [&>*]:pointer-events-auto">
          <HistoryView onClose={() => setOverlay(null)} />
        </div>
      )}
      {overlay === 'settings' && (
        <div className="pd-fade-in-fast pointer-events-none absolute inset-0 z-20 pt-11 [&>*]:pointer-events-auto">
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
