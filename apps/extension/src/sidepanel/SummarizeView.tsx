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
    <div className="flex h-full flex-col">
      {/* 静默进度条：CLI >5s 无输出淡入（纯样式 hook） */}
      <SilentProgress text={stream.text} done={stream.done} running={running} />

      <div className="space-y-2 border-b border-pd-line bg-pd-bg px-[18px] py-3">
        <div className="flex gap-4">
          {usable.map((a) => (
            <button
              key={a.id}
              onClick={() => setAgentId(a.id)}
              className={`pd-mono border-b-2 pb-[3px] text-xs ${
                effectiveAgent === a.id
                  ? 'border-pd-primary font-semibold text-pd-ink'
                  : 'border-transparent text-pd-ink-2 hover:text-pd-ink'
              }`}
              title={a.version}
            >
              {a.id}
            </button>
          ))}
          {!usable.length && (
            <p className="text-[11.5px] leading-[1.9] text-pd-ink-2">未检测到 CLI（装好后在设置里重试）</p>
          )}
        </div>
        <div className="flex gap-4 pt-1">
          {wfs.map((w) => (
            <button
              key={w.name}
              onClick={() => setWorkflow(w.name)}
              className={`border-b-2 pb-[3px] text-xs font-medium ${
                workflow === w.name
                  ? 'border-pd-primary font-semibold text-pd-ink'
                  : 'border-transparent text-pd-ink-2 hover:text-pd-ink'
              }`}
              title={w.description}
            >
              {WF_LABEL[w.name] ?? w.name}
            </button>
          ))}
        </div>
        {running ? (
          <button
            onClick={cancel}
            className="mt-3 h-[38px] w-full rounded-[4px] border border-pd-danger bg-transparent text-[13px] font-medium tracking-[0.05em] text-pd-danger hover:border-pd-danger hover:bg-pd-danger hover:text-white"
          >
            停止
          </button>
        ) : (
          <button
            onClick={start}
            disabled={!usable.length}
            className="mt-3 h-[38px] w-full rounded-[4px] bg-pd-primary text-[13px] font-medium tracking-[0.05em] text-white hover:bg-pd-primary-hover disabled:opacity-[0.38]"
          >
            深度总结当前页
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto bg-pd-bg px-[18px] py-5">
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
          <div className="pd-fade-in mt-4 border-t border-pd-line pt-4 text-center">
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
      点击上方按钮，调用本机 {''}
      <span className="pd-mono">claude</span> / <span className="pd-mono">codex</span>
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
