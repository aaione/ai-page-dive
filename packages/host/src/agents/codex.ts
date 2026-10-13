import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
/** r51 A2③：已知但无需处理的 type（turn/item 的 started 结构帧）——不进 unrecognized 防误报 */
const CODEX_IGNORED = new Set(['turn.started', 'item.started'])

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
        // r62 审计（code #1）：typeof 闸——非字符串 text（版本漂移）会污染 accText/escape 链
        if (d.item?.type === 'agent_message' && typeof d.item.text === 'string' && d.item.text) {
          out.push({ type: 'text-delta', text: d.item.text })
        }
        // r54（review #9）：item.error 此前被完全吞掉——codex「ignoring N unrecognized
        // configuration settings」类警告走这里，sandbox_mode 若被上游改名将零信号。
        // 透传进 unrecognized 计数链（task.ts 计数 → onDone.unrecognized 透出）
        if (d.item?.type === 'error' && d.item.message) {
          out.push({ type: 'unrecognized', kind: `item.error:${String(d.item.message).slice(0, 80)}` })
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
      case 'turn.failed': {
        done = true
        const emsg = d.error?.message // r62 审计（code #1）：同款出口收敛，对象 message JSON 化外直接归兜底文案
        out.push({ type: 'result', isError: true, text: typeof emsg === 'string' ? emsg : 'turn failed' })
        break
      }
      default:
        // r51 A2③：未知 type 上报（版本漂移感知），task.ts 计数进 task-done
        if (typeof d.type === 'string' && !CODEX_IGNORED.has(d.type)) {
          out.push({ type: 'unrecognized', kind: d.type })
        }
    }
    return out
  }
}

export const codexDef: AgentDef = {
  id: 'codex',
  bin: 'codex',
  versionArgs: ['--version'],
  streamFormat: 'codex-jsonl',
  // 探测时读 config.toml 的 model 行（best-effort）
  probeModel: () => {
    try {
      return (readFileSync(join(homedir(), '.codex/config.toml'), 'utf8').match(/^model\s*=\s*['"](.+?)['"]$/m))?.[1]
    } catch {
      return undefined
    }
  },
  // resume 轮（实测 codex 0.151）：exec resume <id> 无 --sandbox flag——read-only 围栏
  // 用 -c config 覆盖等价（value 按 TOML 解析需内层引号）。r54 live-fire（0.156.1）：
  // read-only 拦 touch / danger-full-access 放行，等价性闭环；大版本升级重跑三发实弹
  // r54 #2：mcp_servers={} 封死用户 config.toml 的 MCP——沙箱不约束 MCP 调用（codex
  // 作为客户端直连不经沙箱），与 claude --strict-mcp-config 对称（live-fire 实测真在连用户 MCP）
  buildArgs: (opts) =>
    opts.resumeSessionId
      ? ['exec', 'resume', opts.resumeSessionId, '--json', '-c', 'sandbox_mode="read-only"', '-c', 'mcp_servers={}', '--skip-git-repo-check']
      : ['exec', '--json', '--sandbox', 'read-only', '-c', 'mcp_servers={}', '--skip-git-repo-check'],
}
