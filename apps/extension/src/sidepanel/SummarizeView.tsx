import { useMemo, useState } from 'react'
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
      <div className="space-y-2 border-b bg-white p-3">
        <div className="flex gap-1">
          {usable.map((a) => (
            <button
              key={a.id}
              onClick={() => setAgentId(a.id)}
              className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${
                effectiveAgent === a.id
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
              title={a.version}
            >
              {a.id}
            </button>
          ))}
          {!usable.length && (
            <p className="text-xs text-neutral-400">未检测到 CLI（装好后在设置里重试）</p>
          )}
        </div>
        <div className="flex gap-1">
          {wfs.map((w) => (
            <button
              key={w.name}
              onClick={() => setWorkflow(w.name)}
              className={`flex-1 rounded-md px-2 py-1 text-xs ${
                workflow === w.name
                  ? 'bg-neutral-200 text-neutral-900'
                  : 'text-neutral-500 hover:bg-neutral-100'
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
            className="w-full rounded-md bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            停止
          </button>
        ) : (
          <button
            onClick={start}
            disabled={!usable.length}
            className="w-full rounded-md bg-neutral-900 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            深度总结当前页
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {stream.phase && !stream.done && (
          <p className="mb-2 animate-pulse text-xs text-neutral-400">{stream.phase}</p>
        )}
        {stream.text ? (
          <StreamMarkdown text={stream.text} done={stream.done} />
        ) : (
          !stream.error && <Placeholder />
        )}
        {stream.done && stream.usage && (
          <p className="mt-3 border-t pt-2 text-[11px] text-neutral-400">
            tokens: ↓{stream.usage.inputTokens ?? '—'} ↑{stream.usage.outputTokens ?? '—'}
          </p>
        )}
        {stream.error && (
          <div className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">
            {stream.isError ? 'CLI 报告运行失败：' : ''}
            {stream.error}
          </div>
        )}
      </div>
    </div>
  )
}

function Placeholder() {
  return (
    <div className="mt-8 text-center text-xs leading-6 text-neutral-400">
      点击上方按钮，调用本机 {''}
      <span className="font-mono">claude</span> / <span className="font-mono">codex</span>
      <br />
      深度总结当前网页。内容只在本机处理。
    </div>
  )
}

const WF_LABEL: Record<string, string> = {
  quick: '快速摘要',
  deep: '深度研读',
  paper: '论文模式',
}
