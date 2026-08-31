import type { AgentDef, AgentEvent } from '@pagedive/shared'

/**
 * claude stream-json 解析器。
 * 实测形状（claude 2.1.162）：
 *   {type:'system', subtype:'init'|'hook_started'|...}     → 状态
 *   {type:'assistant', message:{content:[{type:'text'|'thinking', text}]}}
 *                                                          → text 块产出增量
 *   {type:'result', is_error, result, usage}               → 终局（硬约束：退出码 0 也可能 is_error）
 */
export function createClaudeParser() {
  let prevText = ''
  return (line: string): AgentEvent[] => {
    let d: any
    try {
      d = JSON.parse(line)
    } catch {
      return [] // plain 输出混入容错
    }
    const out: AgentEvent[] = []
    if (d.type === 'system' && d.subtype === 'init') {
      out.push({ type: 'status', phase: 'thinking' })
    } else if (d.type === 'assistant') {
      const blocks: any[] = d.message?.content ?? []
      let text = ''
      for (const b of blocks) if (b.type === 'text') text += b.text
      // stream-json 非流式时整段打出：与上次累积做 diff 取增量
      if (text.startsWith(prevText)) {
        const delta = text.slice(prevText.length)
        if (delta) out.push({ type: 'text-delta', text: delta })
      } else if (text) {
        out.push({ type: 'text-delta', text })
      }
      prevText = text
    } else if (d.type === 'result') {
      const u = d.usage ?? {}
      out.push({
        type: 'usage',
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
      })
      out.push({ type: 'result', isError: d.is_error === true, text: d.result ?? '' })
    }
    return out
  }
}

export const claudeDef: AgentDef = {
  id: 'claude',
  bin: 'claude',
  versionArgs: ['--version'],
  streamFormat: 'claude-stream-json',
  buildArgs: () => [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
  ],
}
