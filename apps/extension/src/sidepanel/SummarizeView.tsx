import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentStatus, WorkflowItem } from '@ai-page-dive/shared'
import type { ChatMessage, PageMeta, TaskStreamState } from './App.js'
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
  pageMeta: PageMeta | null
}

/** 读 localStorage 的 JSON string[]（容错：坏数据/非数组一律回退默认） */
function readList(key: string, fallback: string[] = []): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : fallback
  } catch {
    return fallback
  }
}

/** 被禁用 CLI 集合：mount 读一次 + Settings 保存后派发 pd-settings-changed 时再读 */
export function useDisabledClis(): Set<string> {
  const [disabled, setDisabled] = useState<Set<string>>(() => new Set(readList('pd-disabled-clis')))
  useEffect(() => {
    const sync = () => setDisabled(new Set(readList('pd-disabled-clis')))
    window.addEventListener('pd-settings-changed', sync)
    return () => window.removeEventListener('pd-settings-changed', sync)
  }, [])
  return disabled
}

/** 已启用 skills：mount 读一次 + 设置变更事件同步（发送 summarize 时取即时值） */
function useEnabledSkills(): () => string[] {
  const ref = useRef<string[]>(readList('pd-enabled-skills'))
  useEffect(() => {
    const sync = () => { ref.current = readList('pd-enabled-skills') }
    window.addEventListener('pd-settings-changed', sync)
    return () => window.removeEventListener('pd-settings-changed', sync)
  }, [])
  return useCallback(() => ref.current, [])
}

export function SummarizeView({ agents, workflows, stream, agentId, onAgentChange, onStartResult, beginTurn, beginSession, pageMeta }: Props) {
  const disabledClis = useDisabledClis()
  const getEnabledSkills = useEnabledSkills()
  const usable = agents.filter((a) => a.available && !disabledClis.has(a.id))
  const messages = stream.messages
  const [workflow, setWorkflow] = useState('default')
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // 打开面板/新对话后自动聚焦输入框（点击下拉不抢焦点：仅在消息从有到无时）
  const prevMsgCount = useRef(0)
  useEffect(() => {
    if (prevMsgCount.current > 0 && messages.length === 0) inputRef.current?.focus()
    prevMsgCount.current = messages.length
  }, [messages.length])
  /** 追问轮实际执行会话的 CLI（SW 回带；头部展示与真实执行一致） */
  const [followAgent, setFollowAgent] = useState<string | null>(null)
  const effectiveAgent = agentId || usable[0]?.id || 'claude'
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
    const skills = getEnabledSkills()
    if (hasSession) {
      // 追问轮：agentId 由 SW 按会话归属决定，响应回带实际值——头部展示同步
      chrome.runtime.sendMessage(
        { t: 'summarize', agentId: effectiveAgent, instruction: text, followUp: true, skills },
        (resp) => {
          if (!chrome.runtime.lastError && resp) {
            if (resp.agentId) setFollowAgent(resp.agentId)
            onStartResult(resp)
          }
        },
      )
    } else {
      const wf = workflow === 'default' ? 'quick' : workflow
      chrome.runtime.sendMessage(
        { t: 'summarize', agentId: effectiveAgent, workflow: wf, instruction: text, skills },
        (resp) => { if (!chrome.runtime.lastError && resp) onStartResult(resp) },
      )
    }
  }

  function cancel() {
    chrome.runtime.sendMessage({ t: 'cancel' })
  }

  /** 新会话：清 UI + 通知 SW（SW 侧对进行中任务执行取消） */
  function newChat() {
    beginSession()
    setInput('')
    chrome.runtime.sendMessage({ t: 'new-session' }).catch(() => {})
  }

  return (
    <div className="pd-view">
      {/* 顶栏：新会话 / CLI 下拉 / 模式下拉（右上角浮层工具条让位） */}
      <div className="pd-topbar">
        <button onClick={newChat} className="pd-new-chat-btn" title="开始新会话" aria-label="开始新会话">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11.3 2.6a1.6 1.6 0 0 1 2.3 2.3L5.6 12.9l-3 .7.7-3 8-8Z" />
          </svg>
          <span>新会话</span>
        </button>
        <ModelDropdown
          value={hasSession ? (followAgent ?? effectiveAgent) : effectiveAgent}
          onChange={onAgentChange}
          items={usable.map((a) => ({ key: a.id, label: a.id, version: a.version, model: a.model }))}
          fallback="无可用 CLI"
          ariaLabel="选择 AI CLI"
        />
        <WorkflowDropdown
          workflow={workflow}
          onWorkflowChange={setWorkflow}
          workflows={wfs}
          hasSession={hasSession}
        />
      </div>

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
              agentId={followAgent && m.streaming !== true ? followAgent : effectiveAgent}
            />
          ),
        )}
      </div>

      <div className="pd-action-bar">
        {pageMeta && <PageTips meta={pageMeta} />}
        <ActionBar
          input={input}
          onInputChange={setInput}
          inputRef={inputRef}
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

/** 顶栏模式（工作流）下拉：从 ActionBar 上移，追问轮禁用沿用首轮 */
function WorkflowDropdown({
  workflow, onWorkflowChange, workflows, hasSession,
}: {
  workflow: string
  onWorkflowChange: (name: string) => void
  workflows: { name: string; description: string; builtin: boolean }[]
  hasSession: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={`pd-workflow-dropdown ${hasSession ? 'inactive' : ''}`}>
      <button
        onClick={() => setWorkflowOpenGuarded()}
        disabled={hasSession}
        aria-label="选择总结模式"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={hasSession ? '追问沿用首轮模式' : undefined}
        className="pd-workflow-trigger"
      >
        <span className="pd-workflow-label">{WF_LABEL[workflow] ?? workflow}</span>
        <svg viewBox="0 0 15 16" className={`pd-workflow-arrow ${open ? 'open' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 6.5 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <ul role="listbox" className="pd-dropdown-menu pd-workflow-menu pd-fade-in-fast">
          {workflows.map((w) => (
            <li key={w.name} role="option" aria-selected={w.name === workflow}>
              <button
                onClick={() => { onWorkflowChange(w.name); setOpen(false) }}
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
  )

  function setWorkflowOpenGuarded() {
    if (!hasSession) setOpen((o) => !o)
  }
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
        {/* chat 气泡 + 加号（原喇叭造型被误认成语音） */}
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.5 7.5a5.5 5.5 0 0 1-8.2 4.8L2.5 13.5l1.2-2.8A5.5 5.5 0 1 1 13.5 7.5Z" />
          <path d="M8 5.4v4.2M5.9 7.5h4.2" />
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
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
  input, onInputChange, inputRef,
  running, usableCount, hasSession,
  onStart, onCancel,
}: {
  input: string
  onInputChange: (v: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  running: boolean
  usableCount: number
  hasSession: boolean
  onStart: () => void
  onCancel: () => void
}) {
  return (
    <div className="pd-action-bar-inner">
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          // keyCode 229：部分 IME（韩文等）compositionend 先于 keydown，isComposing 已 false
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229 && !running && usableCount) onStart()
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

/** 输入框上方 tips 条：「正在分享 "页面标题"」（参考 Gemini 插件，上下文透明化） */
function PageTips({ meta }: { meta: PageMeta }) {
  const host = (() => {
    try {
      return new URL(meta.url).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  })()
  return (
    <div className="pd-page-tips" role="status">
      {meta.favIconUrl ? (
        <img
          src={meta.favIconUrl}
          alt=""
          className="pd-page-tips-favicon"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      ) : (
        <svg viewBox="0 0 16 16" className="pd-page-tips-favicon" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <path d="M2 8h12M8 2c2 2.2 2 9.8 0 12M8 2C6 4.2 6 11.8 8 14" />
        </svg>
      )}
      <span className="pd-page-tips-text">
        正在分享 “{meta.title || host || meta.url}”{host ? ` · ${host}` : ''}
      </span>
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
