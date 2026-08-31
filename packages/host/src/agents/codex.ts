import type { AgentDef, AgentEvent } from '@pagedive/shared'

/**
 * codex exec JSONL 解析器。
 * 实测形状（codex-cli 0.151.0）：
 *   {type:'thread.started', thread_id}
 *   {type:'turn.started'}
 *   {type:'item.completed', item:{type:'agent_message', text}}   → 增量文本
 *   {type:'item.completed', item:{type:'error', message}}        → 记录（可能是非致命警告）
 *   {type:'turn.completed', usage:{input_tokens, output_tokens}} → 终局
 *   {type:'turn.failed', error}
 */
export function createCodexParser() {
  let done = false
  return (line: string): AgentEvent[] => {
    if (done) return []
    let d: any
    try {
      d = JSON.parse(line)
    } catch {
      return []
    }
    const out: AgentEvent[] = []
    switch (d.type) {
      case 'thread.started':
        out.push({ type: 'status', phase: 'thinking' })
        break
      case 'item.completed':
        if (d.item?.type === 'agent_message' && d.item.text) {
          out.push({ type: 'text-delta', text: d.item.text })
        }
        break
      case 'turn.completed': {
        done = true
        const u = d.usage ?? {}
        out.push({ type: 'usage', inputTokens: u.input_tokens, outputTokens: u.output_tokens })
        // codex 无 is_error：turn.failed 才是失败；最终文本取最后一条 agent_message（上层累积）
        out.push({ type: 'result', isError: false, text: '' })
        break
      }
      case 'turn.failed':
        done = true
        out.push({ type: 'result', isError: true, text: d.error?.message ?? 'turn failed' })
        break
    }
    return out
  }
}

export const codexDef: AgentDef = {
  id: 'codex',
  bin: 'codex',
  versionArgs: ['--version'],
  streamFormat: 'codex-jsonl',
  buildArgs: (opts) => [
    'exec',
    '--json',
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    ...(opts.lastMsgFile ? ['-o', opts.lastMsgFile] : []),
  ],
}
