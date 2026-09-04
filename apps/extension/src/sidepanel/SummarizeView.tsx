import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkflowItem } from '@pagedive/shared'
import type { ChatMessage, TaskStreamState } from './App.js'
import { StreamMarkdown } from './StreamMarkdown.js'

interface Props {
  agents: AgentStatus[]
  workflows: WorkflowItem[]
  stream: TaskStreamState
  agentId: string
  onAgentChange: (id: string) => void
  onStartResult: (resp: { error?: string; [k: string]: unknown }) => void
  beginTurn: (text: string) => void
  beginSession: () => void
}

export function SummarizeView({ agents, workflows, stream, agentId, onAgentChange, onStartResult, beginTurn, beginSession }: Props) {
  const usable = agents.filter((a) => a.available)
  const [workflow, setWorkflow] = useState('default')
  const [input, setInput] = useState('')
  const effectiveAgent = agentId || usable[0]?.id || 'claude'
  const messages = stream.messages
  const running = stream.activeId !== null
  const canFollowUp = messages.some((m) => m.role === 'assistant' && !m.streaming && !m.error && m.text)
  const hasSession = canFollowUp

  const wfs = useMemo(() => {
    const order: Record<string, number> = { quick: 0, deep: 1, paper: 2 }
    const rest = [...(workflows.length ? workflows : [{ name: 'quick', description: '快速摘要', builtin: true }])]
      .sort((a, b) => (order[a.name] ?? 9 + a.name.localeCompare(b.name)) - (order[b.name] ?? 9 + b.name.localeCompare(b.name)))
    return [{ name: 'default', description: '按输入框内容执行；留空则快速摘要', builtin: true }, ...rest]
  }, [workflows])

  function send() {
    const text = input.trim()
    if (!text || running || !usable.length) return
    beginTurn(text)
    setInput('')
    if (hasSession) {
      chrome.runtime.sendMessage(
        { t: 'summarize', agentId: effectiveAgent, instruction: text, followUp: true },
        (resp) => { if (!chrome.runtime.lastError && resp) onStartResult(resp) },
      )
    } else {
      const wf = workflow === 'default' ? 'quick' : workflow
      chrome.runtime.sendMessage(
        { t: 'summarize', agentId: effectiveAgent, workflow: wf, instruction: text },
        (resp) => { if (!chrome.runtime.lastError && resp) onStartResult(resp) },
      )
    }
  }

  function cancel() {
    chrome.runtime.sendMessage({ t: 'cancel' })
  }

  function newChat() {
    beginSession()
    setInput('')
  }

  return (
    <div className="pd-view">
      <div className="pd-content" role="region" aria-live="polite">
        {messages.length === 0 && <Placeholder />}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="pd-chat-user">
              <p>{m.text}</p>
            </div>
          ) : (
            <AssistantMessage
              key={m.id}
              msg={m}
              phase={stream.phase}
              running={running && !!m.streaming}
              onNewChat={newChat}
              agentId={effectiveAgent}
            />
          ),
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
          hasSession={hasSession}
          onStart={send}
          onCancel={cancel}
        />
      </div>
    </div>
  )
}

function AssistantMessage({
  msg, phase, running, agentId, onNewChat,
}: {
  msg: ChatMessage
  phase: string
  running: boolean
  agentId: string
  onNewChat: () => void
}) {
  return (
    <div className="pd-chat-assistant">
      <div className="pd-chat-assistant-head">
        <span className="pd-chat-model pd-mono">{agentId}</span>
        {running && (
          <span className="pd-chat-thinking">
            <span className="pd-dot" aria-hidden="true" />
            {phase || '思考中…'}
          </span>
        )}
      </div>
      {msg.text ? (
        <StreamMarkdown text={msg.text} done={!running} />
      ) : running ? (
        <div className="pd-chat-cursor" aria-hidden="true" />
      ) : null}
      {msg.usage && !running && (
        <div className="pd-usage">
          <span className="pd-mono">tokens: ↓{msg.usage.inputTokens ?? '—'} ↑{msg.usage.outputTokens ?? '—'}</span>
        </div>
      )}
      {!running && msg.error && (
        <div className="pd-error" role="alert">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M8 1.5 14.5 13H1.5L8 1.5Z" />
            <path d="M8 6v3.2" />
            <path d="M8 11.2v.1" />
          </svg>
          <span>
            {msg.isError ? 'CLI 报告运行失败：' : ''}
            {msg.error}
          </span>
        </div>
      )}
      {!running && msg.text && (
        <MessageActions text={msg.text} onNewChat={onNewChat} />
      )}
    </div>
  )
}

function MessageActions({ text, onNewChat }: { text: string; onNewChat: () => void }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* 剪贴板不可用（罕见） */ }
  }
  function download() {
    const blob = new Blob([text], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pagedive-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="pd-chat-actions">
      <button onClick={copy} className="pd-chat-action-btn" title={copied ? '已复制' : '复制'} aria-label="复制">
        {copied ? (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 8.5 3.2 3L13 4.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
          </svg>
        )}
      </button>
      <button onClick={download} className="pd-chat-action-btn" title="下载 markdown" aria-label="下载 markdown">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v8M8 10l-3-3M8 10l3-3M2.5 13.5h11" />
        </svg>
      </button>
      <button onClick={onNewChat} className="pd-chat-action-btn" title="新对话" aria-label="新对话">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2.5 5 5H3v6h2l3 2.5v-11Z" />
          <path d="M11 6a3.5 3.5 0 0 1 0 4" />
        </svg>
      </button>
    </div>
  )
}

export function ModelDropdown({
  value, onChange, items, fallback, ariaLabel,
}: {
  value: string
  onChange: (key: string) =>  void
  items: { key: string; label: string; version?: string; model?: string }[]
  fallback?: string
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
        className={`pd-dropdown-trigger ${items.length ? '' : 'disabled'}`}
      >
        <span className="pd-dropdown-label">
          {items.length ? (selected?.label ?? value) : (fallback ?? value)}
        </span>
        {items.length > 0 && (
          <svg viewBox="0 0 16 16" className="pd-dropdown-arrow" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4 6.5 4 4 4-4" />
          </svg>
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
                {it.version && <span className="pd-dropdown-item-hint pd-mono">{it.version}</span>}
                {it.model && <span className="pd-dropdown-item-hint pd-mono pd-dropdown-item-model">{it.model}</span>}
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
  running, usableCount, hasSession,
  onStart, onCancel,
}: {
  workflow: string
  onWorkflowChange: (name: string) => void
  workflows: { name: string; description: string; builtin: boolean }[]
  input: string
  onInputChange: (v: string) => void
  running: boolean
  usableCount: number
  hasSession: boolean
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
          <svg viewBox="0 0 15 16" className={`pd-workflow-arrow ${workflowOpen ? 'open' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
        placeholder={hasSession ? '继续追问…' : '想了解这个网页什么？'}
        aria-label="自定义指令"
        className="pd-input"
      />

      <button
        onClick={running ? onCancel : onStart}
        disabled={!running && (!usableCount || !input.trim())}
        aria-label={running ? '停止' : '发送'}
        title={running ? '停止' : '发送'}
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

const WF_LABEL: Record<string, string> = {
  default: '默认模式',
  quick: '快速摘要',
  deep: '深度研读',
  paper: '论文模式',
}
