import type { AgentDef, AgentEvent } from '@ai-page-dive/shared'

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
      // 旧版 CLI 无 partial 时这里是累积全量，diff 正好取增量——统一走 startsWith diff。
      // 工具流多消息（r5-impl）：prevText 跨消息累积含前序消息前缀，本条消息的
      // 全文是它的后缀——startsWith 必然失配曾把终答整段重推。endsWith = 本条
      // 已全部经增量推出（镜像），跳过
      if (text.startsWith(prevText)) {
        const delta = text.slice(prevText.length)
        if (delta) out.push({ type: 'text-delta', text: delta })
      } else if (text && prevText.endsWith(text)) {
        // 跨消息镜像：本条消息文本已作为流式增量推出，跳过
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
    // 进程级工具围栏（r6-sec，与 codex --sandbox read-only 对称）：任务语义只需读
    // 临时正文/附件文件——白名单外工具（Bash/Write/网络等）在 CLI 层一律拒绝，
    // prompt 注入的越权指令到此被拦。等号形式：--allowedTools 是 variadic 参数，
    // 空格形式会吞掉后续 argv（本产品 prompt 走 stdin 不受影响，等号防御参数序
    // 变动）。实测（claude 2.x）：Read 围栏下读文件+总结链路 exit 0 / is_error false
    '--allowedTools=Read',
    ...(opts.resumeSessionId ? ['--resume', opts.resumeSessionId] : []),
  ],
}
