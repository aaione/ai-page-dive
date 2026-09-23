import { describe, expect, it } from 'vitest'
import { claudeDef } from '../src/agents/claude.js'
import { codexDef } from '../src/agents/codex.js'

describe('buildArgs 快照', () => {
  it('claude：-p stream-json verbose + partial 增量 + 空 MCP + Read 围栏 + resume 位', () => {
    expect(claudeDef.buildArgs({ contentFile: '/tmp/x.md' })).toEqual([
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      // r47-perf：空 MCP 内联配置跳过连接用户 MCP server（Read 围栏下本就不可调）
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      // 进程级工具围栏（r6-sec）：与 codex --sandbox read-only 对称；等号形式防
      // variadic 吞参（实测空格形式会吃掉后续 argv）
      '--allowedTools=Read',
    ])
    expect(claudeDef.buildArgs({ contentFile: '/tmp/x.md', resumeSessionId: 'abc' })).toEqual([
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--allowedTools=Read',
      '--resume', 'abc',
    ])
  })

  it('codex：exec json read-only skip-git-repo-check（r8 删 -o 死机制：最终文本取自流事件）', () => {
    expect(
      codexDef.buildArgs({ contentFile: '/tmp/x.md' }),
    ).toEqual([
      'exec',
      '--json',
      '--sandbox', 'read-only',
      '--skip-git-repo-check',
    ])
  })

  it('codex：无 -o 参数（lastMsgFile 机制已删）', () => {
    const args = codexDef.buildArgs({ contentFile: '/tmp/x.md' })
    expect(args).not.toContain('-o')
  })

  it('codex：resume 轮走 exec resume + -c sandbox 围栏（resume 子命令无 --sandbox flag，实测 0.151）', () => {
    expect(codexDef.buildArgs({ contentFile: '', resumeSessionId: 'th-1' })).toEqual([
      'exec',
      'resume', 'th-1',
      '--json',
      '-c', 'sandbox_mode="read-only"',
      '--skip-git-repo-check',
    ])
  })
})
