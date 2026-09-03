import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentStatus, WorkflowItem } from '@pagedive/shared'
import type { TaskStreamState } from './App.js'
import { StreamMarkdown } from './StreamMarkdown.js'

interface Props {
  agents: AgentStatus[]
  workflows: WorkflowItem[]
  stream: TaskStreamState
  onStartResult: (resp: { error?: string; [k: string]: unknown }) => void
  probed?: boolean
}

export function SummarizeView({ agents, workflows, stream, onStartResult, probed }: Props) {
  const usable = agents.filter((a) => a.available)
  const [agentId, setAgentId] = useState('')
  const [workflow, setWorkflow] = useState('default')
  const [input, setInput] = useState('')
  const effectiveAgent = agentId || usable[0]?.id || 'claude'
  const running = !stream.done && stream.taskId !== null

  const wfs = useMemo(() => {
    const order: Record<string, number> = { quick: 0, deep: 1, paper: 2 }
    const rest = [...(workflows.length ? workflows : [{ name: 'quick', description: '快速摘要', builtin: true }])]
      .sort((a, b) => (order[a.name] ?? 9 + a.name.localeCompare(b.name)) - (order[b.name] ?? 9 + b.name.localeCompare(a.name)))
    return [{ name: 'default', description: '按输入框内容执行；留空则快速摘要', builtin: true }, ...rest]
  }, [workflows])

  function start() {
    const text = input.trim()
    const wf = workflow === 'default' && !text ? 'quick' : workflow
    chrome.runtime.sendMessage(
      { t: 'summarize', agentId: effectiveAgent, workflow: wf, instruction: text || undefined },
      (resp) => {
        if (!chrome.runtime.lastError && resp) onStartResult(resp)
      },
    )
  }
  function cancel() {
    chrome.runtime.sendMessage({ t: 'cancel' })
  }

  return (
    <div className="pd-view">
      <SilentProgress text={stream.text} done={stream.done} running={running} />

      <div className="pd-model-selector">
        <ModelDropdown
          value={effectiveAgent}
          onChange={setAgentId}
          items={usable.map((a) => ({
            key: a.id,
            label: a.id,
            hint: a.version,
          }))}
          fallback="未检测到 CLI"
          loading={!probed}
          ariaLabel="选择 CLI 模型"
        />
      </div>

      <div className="pd-content" role="region" aria-live="polite">
        {stream.phase && !stream.done && (
          <div className="pd-status-bar">
            <span className="pd-dot" aria-hidden="true" />
            <span>{stream.phase}</span>
            <Elapsed key={stream.taskId ?? 'idle'} running={running} />
          </div>
        )}
        {stream.text ? (
          <StreamMarkdown text={stream.text} done={stream.done} />
        ) : (
          !stream.error && <Placeholder />
        )}
        {stream.done && stream.usage && (
          <div className="pd-usage">
            <span className="pd-mono">tokens: ↓{stream.usage.inputTokens ?? '—'} ↑{stream.usage.outputTokens ?? '—'}</span>
          </div>
        )}
        {stream.error && (
          <div className="pd-error" role="alert">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M8 1.5 14.5 13H1.5L8 1.5Z" />
              <path d="M8 6v3.2" />
              <path d="M8 11.2v.1" />
            </svg>
            <span>
              {stream.isError ? 'CLI 报告运行失败：' : ''}
              {stream.error}
            </span>
          </div>
        )}
      </div>

      <div className="pd-action-bar">
        <ActionBar
          workflow={workflow}
          onWorkflowChange={setWorkflow}
          workflows={wfs}
          input={input}
          onInputChange={setInput}
          running={running}
          usableCount={usable.length}
          onStart={start}
          onCancel={cancel}
        />
      </div>
    </div>
  )
}

function ModelDropdown({
  value, onChange, items, fallback, loading, ariaLabel,
}: {
  value: string
  onChange: (key: string) => void
  items: { key: string; label: string; hint?: string }[]
  fallback?: string
  loading?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selected = items.find((it) => it.key === value)

  return (
    <div ref={ref} className="pd-dropdown">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={loading}
        className={`pd-dropdown-trigger ${items.length ? '' : 'disabled'}`}
      >
        {loading ? (
          <span className="pd-model-loading">
            <span className="pd-model-loading-dot" aria-hidden="true" />
            <span className="pd-dropdown-label">正在检测本机 CLI…</span>
          </span>
        ) : (
          <>
            <span className="pd-dropdown-label">
              {items.length ? (selected?.label ?? value) : (fallback ?? value)}
            </span>
            {items.length > 0 && (
              <svg viewBox="0 0 16 16" className="pd-dropdown-arrow" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m4 6.5 4 4 4-4" />
              </svg>
            )}
          </>
        )}
      </button>
      {open && items.length > 0 && (
        <ul role="listbox" className="pd-dropdown-menu pd-fade-in-fast">
          {items.map((it) => (
            <li key={it.key} role="option" aria-selected={it.key === value}>
              <button
                onClick={() => { onChange(it.key); setOpen(false) }}
                className={`pd-dropdown-item ${it.key === value ? 'selected' : ''}`}
              >
                {it.key === value && <span className="pd-dropdown-check" aria-hidden="true" />}
                <span className="pd-dropdown-item-label pd-mono">{it.label}</span>
                {it.hint && <span className="pd-dropdown-item-hint pd-mono">{it.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ActionBar({
  workflow, onWorkflowChange, workflows,
  input, onInputChange,
  running, usableCount,
  onStart, onCancel,
}: {
  workflow: string
  onWorkflowChange: (name: string) => void
  workflows: { name: string; description: string; builtin: boolean }[]
  input: string
  onInputChange: (v: string) => void
  running: boolean
  usableCount: number
  onStart: () => void
  onCancel: () => void
}) {
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const workflowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!workflowOpen) return
    const onDoc = (e: MouseEvent) => {
      if (workflowRef.current && !workflowRef.current.contains(e.target as Node)) setWorkflowOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [workflowOpen])

  const selectedWorkflow = workflows.find((w) => w.name === workflow)

  return (
    <div ref={workflowRef} className="pd-action-bar-inner">
      <div className="pd-workflow-dropdown">
        <button
          onClick={() => setWorkflowOpen((o) => !o)}
          aria-label="选择总结模式"
          aria-haspopup="listbox"
          aria-expanded={workflowOpen}
          className="pd-workflow-trigger"
        >
          <span className="pd-workflow-label">{WF_LABEL[workflow] ?? workflow}</span>
          <svg viewBox="0 0 16 16" className={`pd-workflow-arrow ${workflowOpen ? 'open' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4 6.5 4 4 4-4" />
          </svg>
        </button>
        {workflowOpen && (
          <ul role="listbox" className="pd-dropdown-menu pd-workflow-menu pd-fade-in-fast">
            {workflows.map((w) => (
              <li key={w.name} role="option" aria-selected={w.name === workflow}>
                <button
                  onClick={() => { onWorkflowChange(w.name); setWorkflowOpen(false) }}
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

      <input
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && !running && usableCount) onStart()
        }}
        disabled={running}
        placeholder={running ? '正在总结当前页…' : '想了解这个网页什么？'}
        aria-label="自定义指令"
        className="pd-input"
      />

      <button
        onClick={running ? onCancel : onStart}
        disabled={!running && !usableCount}
        aria-label={running ? '停止' : '深度总结当前页'}
        title={running ? '停止' : '深度总结当前页'}
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
  )
}

function SilentProgress({ text, done, running }: { text: string; done: boolean; running: boolean }) {
  const [silent, setSilent] = useState(false)
  const lastChunkRef = useRef(Date.now())
  const lastLenRef = useRef(0)

  useEffect(() => {
    if (text.length !== lastLenRef.current) {
      lastLenRef.current = text.length
      lastChunkRef.current = Date.now()
      setSilent(false)
    }
  }, [text])

  useEffect(() => {
    if (!running || done) {
      setSilent(false)
      return
    }
    const t = setInterval(() => {
      setSilent(Date.now() - lastChunkRef.current > 5000)
    }, 1000)
    return () => clearInterval(t)
  }, [running, done])

  if (!running) return null
  return <div className={`pd-progress ${silent ? 'on' : ''}`} aria-hidden="true" />
}

function Placeholder() {
  return (
    <div className="pd-placeholder">
      <p className="pd-placeholder-title">想了解这个网页的什么？</p>
      <p className="pd-placeholder-hint">
        直接在下方输入问题，或选择一种总结模式
        <br />
        <span className="pd-mono">claude</span> / <span className="pd-mono">codex</span> / <span className="pd-mono">opencode</span> · 内容只在本机处理
      </p>
    </div>
  )
}

function Elapsed({ running }: { running: boolean }) {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setSec((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [running])
  if (!running || sec < 3) return null
  return <span className="pd-mono pd-elapsed">· {sec}s</span>
}

const WF_LABEL: Record<string, string> = {
  default: '默认模式',
  quick: '快速摘要',
  deep: '深度研读',
  paper: '论文模式',
}