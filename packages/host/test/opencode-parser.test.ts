import { describe, expect, it } from 'vitest'
import { createOpencodeParser } from '../src/agents/opencode.js'

// fixture 采自 opencode 1.18.23 真实输出（2026-09-02）
describe('opencode jsonl parser', () => {
  it('step_start → status', () => {
    const p = createOpencodeParser()
    expect(
      p(JSON.stringify({ type: 'step_start', part: { id: 'p1', type: 'step-start' } })),
    ).toEqual([{ type: 'status', phase: 'thinking' }])
  })

  it('text part → text-delta', () => {
    const p = createOpencodeParser()
    const evs = p(
      JSON.stringify({ type: 'text', part: { id: 'p2', type: 'text', text: '好的' } }),
    )
    expect(evs).toEqual([{ type: 'text-delta', text: '好的' }])
  })

  it('step_finish(reason:stop) → 仅 usage，不封口（多 step 流）', () => {
    const p = createOpencodeParser()
    const evs = p(
      JSON.stringify({
        type: 'step_finish',
        part: { id: 'p3', type: 'step-finish', reason: 'stop', tokens: { input: 21239, output: 0 } },
      }),
    )
    expect(evs).toEqual([{ type: 'usage', inputTokens: 21239, outputTokens: 0 }])
  })

  it('step_finish 后 text 仍被解析（读文件→作答的多 step）', () => {
    const p = createOpencodeParser()
    p(JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop', tokens: { input: 1, output: 0 } } }))
    expect(p(JSON.stringify({ type: 'text', part: { type: 'text', text: '后续答案' } }))).toEqual([
      { type: 'text-delta', text: '后续答案' },
    ])
  })

  it('step_finish reason:error → result(isError=true)', () => {
    const p = createOpencodeParser()
    const evs = p(
      JSON.stringify({
        type: 'step_finish',
        part: { id: 'p4', type: 'step-finish', reason: 'error' },
      }),
    )
    expect(evs).toEqual([{ type: 'result', isError: true, text: '' }])
  })

  it('errored 置位后每行不再重复 push result（result 恰发一次）', () => {
    const p = createOpencodeParser()
    // 首个 error step_finish → 发一次 result
    expect(
      p(JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'error' } })),
    ).toEqual([{ type: 'result', isError: true, text: '' }])
    // 之后任意行（text/step_start/再一个 step_finish）都不得再 push result
    expect(p(JSON.stringify({ type: 'text', part: { type: 'text', text: 'x' } }))).toEqual([
      { type: 'text-delta', text: 'x' },
    ])
    expect(p(JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }))).toEqual([
      { type: 'status', phase: 'thinking' },
    ])
    expect(p(JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'error' } }))).toEqual([])
  })

  it('非 JSON 行丢弃', () => {
    const p = createOpencodeParser()
    expect(p('some plain noise')).toEqual([])
  })
})
