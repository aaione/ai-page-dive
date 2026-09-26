import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
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
/** r51 A2③：已知但无需处理的 type（user=工具结果回执；system 非 init 子类型=hook
 * 等生命周期帧）——不进 unrecognized 防误报 */
const CLAUDE_IGNORED = new Set(['user', 'system'])

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
      // partial 增量已发过时这里是镜像（diff 出空增量，自然跳过）；旧版 CLI 无 partial 时这里是累积全量，
      // diff 正好取增量——统一走 startsWith diff。工具流多消息（r5-impl）：prevText 跨消息累积含前序消息前缀，
      // 本条消息的全文是它的后缀——startsWith 必然失配曾把终答整段重推。endsWith = 本条已全部经增量推出（镜像），跳过
      if (text.startsWith(prevText)) {
        const delta = text.slice(prevText.length)
        if (delta) out.push({ type: 'text-delta', text: delta })
        prevText = text
      } else if (text && prevText.endsWith(text)) {
        // 跨消息镜像：本条消息文本已作为流式增量推出，跳过且不回写 prevText
        // （r8-host：回写会把累积全文缩窄成本条文本，连续两条相同消息时
        // 第二条的 startsWith 差分因此误命中、正文被吞）
      } else if (text) {
        out.push({ type: 'text-delta', text })
        prevText = text
      }
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
    } else if (typeof d.type === 'string' && !CLAUDE_IGNORED.has(d.type)) {
      // r51 A2③：未知 type 上报（版本漂移感知），task.ts 计数进 task-done
      out.push({ type: 'unrecognized', kind: d.type })
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
  // 探测时读 settings.json 的 model 字段（用户显式设定）；best-effort。
  // r43：补 env.ANTHROPIC_MODEL——代理/自定义端点用户（如 GLM）模型配在 env 段而非
  // 顶层 model，只读顶层会 undefined，下拉模型行就只能等任务流的 lastModels 补——
  // 两个源一有一无即「glm/opus 摆动」；两处同读后探测即稳定
  probeModel: () => {
    try {
      const s = JSON.parse(readFileSync(join(homedir(), '.claude/settings.json'), 'utf8'))
      return s.model || s.env?.ANTHROPIC_MODEL || undefined
    } catch {
      return undefined
    }
  },
  buildArgs: (opts) => {
    // r48（M7）：读围栏从「任意 Read」收紧为路径白名单——Read(//path/**)，规则里
    // // 表绝对路径（claude 权限语法）。macOS tmpdir(/var/folders/…) 实为
    // /private/var/… 的软链，CLI 解析真实路径后才做规则匹配——每个根给原路径 +
    // realpath 双份覆盖两种形态。resume 轮 contentFile 为空串：跳过该根（r7-review）
    const roots = new Set<string>()
    const add = (p?: string) => {
      if (!p) return
      roots.add(p)
      try { roots.add(realpathSync(p)) } catch { /* 尚不存在则只给原路径 */ }
    }
    add(opts.contentFile && dirname(opts.contentFile))
    add(opts.agentCwd)
    add(join(homedir(), '.ai-page-dive', 'attachments')) // 附件持久化目录，resume 轮同样要可读
    return [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      // r47-perf：-p 默认连用户环境全部 MCP server（本机 10 个实测 5-15s CPU 纯浪费——
      // Read 围栏下 MCP 工具本就不可调，连接零语义收益）。内联空配置
      // （--mcp-config 收 JSON 串）+ strict 屏蔽其余来源，CLI 冷启段 ~10s+ → ~1s
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      // r48（M7 实测补钉）：用户全局 settings.json 若配了 bypassPermissions，
      // --allowedTools 白名单不构成拒绝面（白名单外 Read 实测照样放行）——显式钉
      // default 让围栏不随用户个人偏好漂移。白名单内 Read 在 default 下免批准直读
      // （实测 denials 空），白名单外 Read/Bash 逃逸均被拦；headless -p 无人值守，
      // 一切「需批准」操作被拒正是产品语义
      '--permission-mode', 'default',
      // 进程级工具围栏（r6-sec，与 codex --sandbox read-only 对称）：任务语义只需读
      // 白名单路径下的正文/附件——白名单外的 Read 与一切其他工具（Bash/Write/网络等）
      // 在 CLI 层一律拒绝，prompt 注入的越权指令到此被拦。等号形式 + 逗号分隔：
      // --allowedTools 是 variadic 参数，空格形式会吞掉后续 argv（claude --help 实测
      // 收 comma or space-separated list）
      `--allowedTools=${[...roots].map((p) => `Read(//${p.replace(/^\//, '')}/**)`).join(',')}`,
      ...(opts.resumeSessionId ? ['--resume', opts.resumeSessionId] : []),
    ]
  },
}
