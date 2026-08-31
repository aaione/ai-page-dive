import { describe, expect, it } from 'vitest'
import { createClaudeParser } from '../src/agents/claude.js'

// fixture 采自 claude 2.1.162 真实输出（2026-09-01）
describe('claude stream-json parser', () => {
  it('system init → status', () => {
    const p = createClaudeParser()
    const evs = p(JSON.stringify({ type: 'system', subtype: 'init', model: 'x' }))
    expect(evs).toEqual([{ type: 'status', phase: 'thinking' }])
  })

  it('thinking 块不产出，text 块产出 delta', () => {
    const p = createClaudeParser()
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: '你好' }] },
    })
    expect(p(line)).toEqual([{ type: 'text-delta', text: '你好' }])
  })

  it('多轮 assistant 文本累积 diff', () => {
    const p = createClaudeParser()
    const mk = (t: string) =>
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } })
    expect(p(mk('前半'))).toEqual([{ type: 'text-delta', text: '前半' }])
    expect(p(mk('前半后半'))).toEqual([{ type: 'text-delta', text: '后半' }])
  })

  it('文本不连续（非累积流）→ 全量当 delta', () => {
    const p = createClaudeParser()
    const mk = (t: string) =>
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } })
    p(mk('第一段'))
    expect(p(mk('另一段'))).toEqual([{ type: 'text-delta', text: '另一段' }])
  })

  it('result：is_error 必须传导（退出码不可信）', () => {
    const p = createClaudeParser()
    const evs = p(
      JSON.stringify({
        type: 'result',
        is_error: true,
        result: 'No such file',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    )
    expect(evs).toContainEqual({ type: 'result', isError: true, text: 'No such file' })
    expect(evs).toContainEqual({ type: 'usage', inputTokens: 10, outputTokens: 5 })
  })

  it('result 正常路径', () => {
    const p = createClaudeParser()
    const evs = p(JSON.stringify({ type: 'result', is_error: false, result: '完成', usage: {} }))
    expect(evs.at(-1)).toEqual({ type: 'result', isError: false, text: '完成' })
  })

  it('非 JSON 行丢弃不崩', () => {
    const p = createClaudeParser()
    expect(p('plain text noise')).toEqual([])
  })

  it('hook 事件静默', () => {
    const p = createClaudeParser()
    expect(p(JSON.stringify({ type: 'system', subtype: 'hook_started' }))).toEqual([])
  })
})
