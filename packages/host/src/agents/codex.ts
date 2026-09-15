import type { AgentDef, AgentEvent } from '@ai-page-dive/shared'

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
        // thread_id 即会话锚点（r7-impl）：与 claude init 帧对称发 meta，panel 才能
        // 解锁追问；resume 轮（exec resume）会再发新 thread.started，meta 天然更新
        if (d.thread_id) out.push({ type: 'meta', sessionId: d.thread_id })
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
  // resume 轮（r7-impl，实测 codex 0.151）：exec resume <id>，prompt 省略参数即读
  // stdin。resume 子命令无 --sandbox flag——read-only 围栏用 -c config 覆盖等价
  // 保持（sandbox_mode 的 value 按 TOML 解析，字符串需内层引号）
  buildArgs: (opts) =>
    opts.resumeSessionId
      ? ['exec', 'resume', opts.resumeSessionId, '--json', '-c', 'sandbox_mode="read-only"', '--skip-git-repo-check']
      : [
          'exec',
          '--json',
          '--sandbox', 'read-only',
          '--skip-git-repo-check',
          ...(opts.lastMsgFile ? ['-o', opts.lastMsgFile] : []),
        ],
}
