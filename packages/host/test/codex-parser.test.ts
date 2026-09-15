import { describe, expect, it } from 'vitest'
import { createCodexParser } from '../src/agents/codex.js'

// fixture 采自 codex-cli 0.151.0 真实输出（2026-09-01）
describe('codex jsonl parser', () => {
  it('thread.started → meta(thread_id 作 sessionId，追问锚点) + status', () => {
    const p = createCodexParser()
    expect(p(JSON.stringify({ type: 'thread.started', thread_id: 't1' }))).toEqual([
      { type: 'meta', sessionId: 't1' },
      { type: 'status', phase: 'thinking' },
    ])
    // 无 thread_id 的畸形帧：只发 status，不造空 meta
    expect(p(JSON.stringify({ type: 'thread.started' }))).toEqual([
      { type: 'status', phase: 'thinking' },
    ])
  })

  it('agent_message → text-delta', () => {
    const p = createCodexParser()
    const evs = p(
      JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: '答案' } }),
    )
    expect(evs).toEqual([{ type: 'text-delta', text: '答案' }])
  })

  it('error item 静默（可能非致命）', () => {
    const p = createCodexParser()
    expect(
      p(JSON.stringify({ type: 'item.completed', item: { id: 'i0', type: 'error', message: 'warn' } })),
    ).toEqual([])
  })

  it('turn.completed → usage + result(isError=false)', () => {
    const p = createCodexParser()
    const evs = p(
      JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    )
    expect(evs).toEqual([
      { type: 'usage', inputTokens: 100, outputTokens: 20 },
      { type: 'result', isError: false, text: '' },
    ])
  })

  it('turn.failed → result(isError=true)', () => {
    const p = createCodexParser()
    const evs = p(JSON.stringify({ type: 'turn.failed', error: { message: 'boom' } }))
    expect(evs).toEqual([{ type: 'result', isError: true, text: 'boom' }])
  })

  it('终局后忽略后续行', () => {
    const p = createCodexParser()
    p(JSON.stringify({ type: 'turn.completed', usage: {} }))
    expect(p(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'x' } }))).toEqual([])
  })

  it('非 JSON 行丢弃', () => {
    const p = createCodexParser()
    expect(p('Reading prompt from stdin...')).toEqual([])
  })
})
