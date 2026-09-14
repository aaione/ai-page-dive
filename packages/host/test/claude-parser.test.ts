import { describe, expect, it } from 'vitest'
import { createClaudeParser } from '../src/agents/claude.js'

// fixture 采自 claude 2.1.162 真实输出（2026-09-01）
describe('claude stream-json parser', () => {
  it('system init → meta（model/sessionId）+ status', () => {
    const p = createClaudeParser()
    const evs = p(
      JSON.stringify({ type: 'system', subtype: 'init', model: 'GLM-5.2', session_id: 's1' }),
    )
    expect(evs).toEqual([
      { type: 'meta', model: 'GLM-5.2', sessionId: 's1' },
      { type: 'status', phase: 'thinking' },
    ])
  })

  it('thinking 块不产出，text 块产出 delta', () => {
    const p = createClaudeParser()
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: '你好' }] },
    })
    expect(p(line)).toEqual([{ type: 'text-delta', text: '你好' }])
  })

  it('工具流多消息：msg2 的 assistant 镜像不重推终答（r5-impl 回归）', () => {
    // buildPrompt 指示 CLI 读文件 → Read 工具流产生多条 assistant 消息：
    // prevText 跨消息累积含 msg1 前缀，msg2 镜像的 startsWith 必然失配——
    // 曾把终答全文再次作为 delta 推出（panel 与历史落盘重复两份）
    const p = createClaudeParser()
    const delta = (t: string) => JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } })
    const mirror = (t: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } })
    const out: string[] = []
    for (const line of [delta('先读文件'), mirror('先读文件'), delta('这是终答'), mirror('这是终答')]) {
      for (const ev of p(line)) if (ev.type === 'text-delta') out.push(ev.text)
    }
    expect(out.join('')).toBe('先读文件这是终答') // 修复前 = '先读文件这是终答这是终答'
  })

  it('多轮 assistant 文本累积 diff（partial 不可用时的兜底路径）', () => {
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
