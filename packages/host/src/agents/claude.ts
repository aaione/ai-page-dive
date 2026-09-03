import type { AgentDef, AgentEvent } from '@pagedive/shared'

/**
 * claude stream-json 解析器（--include-partial-messages）。
 * 实测形状（claude 2.1.162）：
 *   {type:'system', subtype:'init', session_id, model}   → meta（模型名 + 追问用会话 id）
 *   {type:'stream_event', event:{type:'content_block_delta',
 *    delta:{type:'text_delta', text}}}                    → 真流式增量
 *   {type:'stream_event', event.delta.type:'thinking_delta'} → 思考中状态
 *   {type:'assistant', message.content:[{type:'text'}]}   → 全量消息（已发过增量则跳过）
 *   {type:'result', is_error, result, usage}              → 终局（硬约束：退出码 0 也可能 is_error）
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
      out.push({ type: 'meta', model: d.model, sessionId: d.session_id })
      out.push({ type: 'status', phase: 'thinking' })
    } else if (d.type === 'stream_event') {
      const delta = d.event?.delta
      if (delta?.type === 'text_delta' && delta.text) {
        out.push({ type: 'text-delta', text: delta.text })
        prevText += delta.text
      } else if (delta?.type === 'thinking_delta') {
        out.push({ type: 'status', phase: 'thinking' })
      }
    } else if (d.type === 'assistant') {
      const blocks: any[] = d.message?.content ?? []
      let text = ''
      for (const b of blocks) if (b.type === 'text') text += b.text
      // partial 增量已发过时这里是镜像（diff 出空增量，自然跳过）；
      // 旧版 CLI 无 partial 时这里是累积全量，diff 正好取增量——统一走 startsWith diff
      if (text.startsWith(prevText)) {
        const delta = text.slice(prevText.length)
        if (delta) out.push({ type: 'text-delta', text: delta })
      } else if (text) {
        out.push({ type: 'text-delta', text })
      }
      prevText = text
    } else if (d.type === 'result') {
      const u = d.usage ?? {}
      if (u.input_tokens != null || u.output_tokens != null) {
        out.push({
          type: 'usage',
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
        })
      }
      out.push({ type: 'result', isError: isError(d), text: d.result ?? '' })
    }
    return out
  }
}

/** result 硬判定：显式 is_error 字段优先；无字段时按 message 兜底（退出码不可信） */
function isError(d: any): boolean {
  if (typeof d.is_error === 'boolean') return d.is_error
  if (typeof d.subtype === 'string' && d.subtype !== 'success') return true
  return false
}

export const claudeDef: AgentDef = {
  id: 'claude',
  bin: 'claude',
  versionArgs: ['--version'],
  streamFormat: 'claude-stream-json',
  buildArgs: (opts) => [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...(opts.resumeSessionId ? ['--resume', opts.resumeSessionId] : []),
  ],
}
