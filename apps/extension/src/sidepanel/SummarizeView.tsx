import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentStatus, WorkflowItem } from '@pagedive/shared'
import type { TaskStreamState } from './App.js'
import { StreamMarkdown } from './StreamMarkdown.js'

interface Props {
  agents: AgentStatus[]
  workflows: WorkflowItem[]
  stream: TaskStreamState
  onStartResult: (resp: { error?: string; [k: string]: unknown }) => void
}

export function SummarizeView({ agents, workflows, stream, onStartResult }: Props) {
  const usable = agents.filter((a) => a.available)
  const [agentId, setAgentId] = useState('')
  const [workflow, setWorkflow] = useState('quick')
  const effectiveAgent = agentId || usable[0]?.id || 'claude'
  const running = !stream.done && stream.taskId !== null

  const wfs = useMemo(
    () => (workflows.length ? workflows : [{ name: 'quick', description: '快速摘要', builtin: true }]),
    [workflows],
  )

  function start() {
    chrome.runtime.sendMessage(
      { t: 'summarize', agentId: effectiveAgent, workflow },
      (resp) => {
        if (!chrome.runtime.lastError && resp) onStartResult(resp)
      },
    )
  }
  function cancel() {
    chrome.runtime.sendMessage({ t: 'cancel' })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 静默进度条：CLI >5s 无输出淡入（纯样式 hook） */}
      <SilentProgress text={stream.text} done={stream.done} running={running} />

      {/* CLI 下拉 pill（Gemini 模型选择器位置） */}
      <div className="shrink-0 px-4 pt-3">
        <Dropdown
          value={effectiveAgent}
          onChange={setAgentId}
          items={usable.map((a) => ({ key: a.id, label: a.id, hint: a.version }))}
          fallback="未检测到 CLI"
          mono
          ariaLabel="选择 CLI"
        />
      </div>

      {/* 输出流：中间纯阅读区 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
        {stream.phase && !stream.done && (
          <p className="mb-2 flex items-center gap-2 text-[11.5px] leading-[1.9] text-pd-ink-2">
            <span className="pd-dot inline-block h-[6px] w-[6px] shrink-0 rounded-full bg-pd-primary" />
            {stream.phase}
            <Elapsed key={stream.taskId ?? 'idle'} running={running} />
          </p>
        )}
        {stream.text ? (
          <StreamMarkdown text={stream.text} done={stream.done} />
        ) : (
          !stream.error && <Placeholder />
        )}
        {stream.done && stream.usage && (
          <div className="pd-fade-in mt-4 border-t border-white/10 pt-4 text-center">
            <p className="pd-mono text-[10.5px] leading-[1.6] text-pd-ink-2">
              tokens: ↓{stream.usage.inputTokens ?? '—'} ↑{stream.usage.outputTokens ?? '—'}
            </p>
          </div>
        )}
        {stream.error && (
          <div className="pd-fade-in-fast mt-4 rounded-[2px] border-l-2 border-pd-danger bg-pd-danger-bg px-3 py-2.5">
            <p className="flex items-start gap-2 text-xs leading-[1.7] text-pd-danger-text">
              <svg viewBox="0 0 16 16" className="mt-[3px] h-[14px] w-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M8 1.5 14.5 13H1.5L8 1.5Z" />
                <path d="M8 6v3.2" />
                <path d="M8 11.2v.1" />
              </svg>
              <span>
                {stream.isError ? 'CLI 报告运行失败：' : ''}
                {stream.error}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* 底部动作栏：Gemini 式玻璃框——左 workflow 下拉 / 右圆形主按钮 */}
      <div className="shrink-0 px-4 pb-4 pt-3">
        <div className="pd-glass-raised flex items-center gap-2 rounded-[12px] px-2.5 py-2">
          <Dropdown
            value={WF_LABEL[workflow] ?? workflow}
            onChange={(name) => setWorkflow(name)}
            items={wfs.map((w) => ({ key: w.name, label: WF_LABEL[w.name] ?? w.name, hint: w.description }))}
            align="left"
            up
            ariaLabel="选择 workflow"
          />
          <p className="min-w-0 flex-1 truncate text-center text-[11px] leading-[1.6] text-pd-ink-2">
            {running ? '正在总结当前页…' : '总结当前网页'}
          </p>
          <button
            onClick={running ? cancel : start}
            disabled={!running && !usable.length}
            aria-label={running ? '停止' : '深度总结当前页'}
            title={running ? '停止' : '深度总结当前页'}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-all active:scale-95 ${
              running
                ? 'bg-pd-danger text-pd-bg hover:brightness-110'
                : 'pd-accent shadow-[0_0_8px_rgba(124,58,237,0.30)] hover:shadow-[0_0_16px_rgba(124,58,237,0.50)] disabled:opacity-[0.38] disabled:shadow-none'
            }`}
          >
            {running ? (
              /* 停止：方形停止符 */
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
                <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
              </svg>
            ) : (
              /* 启动：上箭头（总结 = 跑一遍） */
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 13V3M8 3 4.6 6.4M8 3l3.4 3.4" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 下拉 pill：点开选项浮层，点外部关闭。value 只显示，key 传回 onChange。 */
function Dropdown({
  value, onChange, items, fallback, mono, up, align = 'left', ariaLabel,
}: {
  value: string
  onChange: (key: string) => void
  items: { key: string; label: string; hint?: string }[]
  fallback?: string
  mono?: boolean
  up?: boolean
  align?: 'left' | 'right'
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

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex max-w-[130px] items-center gap-1 rounded-full border border-transparent px-2 py-1 text-xs hover:border-white/60 hover:bg-pd-hover ${
          mono ? 'pd-mono' : 'font-medium'
        } ${items.length ? 'text-pd-ink' : 'cursor-default text-pd-ink-2'}`}
      >
        <span className="truncate">{items.length ? value : (fallback ?? value)}</span>
        {items.length > 0 && (
          <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-pd-ink-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4 6.5 4 4 4-4" />
          </svg>
        )}
      </button>
      {open && items.length > 0 && (
        <ul
          role="listbox"
          className={`pd-glass-overlay pd-fade-in-fast absolute z-30 w-44 rounded-[8px] py-1 ${
            up ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
          } ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {items.map((it) => (
            <li key={it.key} role="option" aria-selected={it.key === value}>
              <button
                onClick={() => { onChange(it.key); setOpen(false) }}
                className={`flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-pd-hover ${
                  it.key === value ? 'bg-pd-hover' : ''
                }`}
              >
                <span className={`${mono ? 'pd-mono' : ''} text-xs text-pd-ink`}>{it.label}</span>
                {it.hint && <span className="pd-mono truncate text-[10px] text-pd-ink-2">{it.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 静默进度条：距最后 chunk >5s 加 .on；首 chunk 或 done 撤掉。只读 stream.text，不动流逻辑。 */
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
  return <div className={`pd-progress shrink-0 ${silent ? 'on' : ''}`} />
}

function Placeholder() {
  return (
    <div className="pd-serif mt-8 text-center text-[13px] leading-[2.0] text-pd-ink-2">
      点击下方按钮，调用本机 {''}
      <span className="pd-mono text-pd-primary">claude</span> / <span className="pd-mono text-pd-primary">codex</span> / <span className="pd-mono text-pd-primary">opencode</span>
      <br />
      深度总结当前网页。内容只在本机处理。
    </div>
  )
}

/** 运行中计时器：CLI 长时间静默思考时让用户知道任务活着 */
function Elapsed({ running }: { running: boolean }) {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setSec((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [running])
  if (!running || sec < 3) return null
  return <span className="pd-mono ml-0.5 no-underline">· {sec}s</span>
}

const WF_LABEL: Record<string, string> = {
  quick: '快速摘要',
  deep: '深度研读',
  paper: '论文模式',
}
