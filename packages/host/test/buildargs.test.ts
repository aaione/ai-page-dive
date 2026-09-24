import { describe, expect, it } from 'vitest'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { claudeDef } from '../src/agents/claude.js'
import { codexDef } from '../src/agents/codex.js'

/** r48（M7）期望值辅助：读围栏白名单——根集合（原路径 + realpath 双份 + 附件目录）→ 逗号joined。
    realpath 在测试侧同样计算（Linux CI 上 /tmp 无软链，双份退化为一份，Set 语义对齐实现） */
const safeRealpath = (p: string) => { try { return realpathSync(p) } catch { return p } }
const fenceOf = (paths: string[]) => `--allowedTools=${[...new Set(paths.flatMap((p) => [p, safeRealpath(p)]))].map((p) => `Read(//${p.replace(/^\//, '')}/**)`).join(',')}`

describe('buildArgs 快照', () => {
  it('claude：-p stream-json verbose + partial 增量 + 空 MCP + Read 路径白名单围栏 + resume 位', () => {
    expect(claudeDef.buildArgs({ contentFile: '/tmp/x.md' })).toEqual([
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      // r47-perf：空 MCP 内联配置跳过连接用户 MCP server（Read 围栏下本就不可调）
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      // r48（M7）：钉 default——用户全局 bypassPermissions 会拆掉 --allowedTools 拒绝面
      '--permission-mode', 'default',
      // r48（M7）：Read 从任意路径收紧为白名单——/tmp 根 + realpath（macOS 软链
      // /private/tmp）+ 附件目录
      fenceOf(['/tmp', `${homedir()}/.ai-page-dive/attachments`]),
    ])
    expect(claudeDef.buildArgs({ contentFile: '/tmp/x.md', resumeSessionId: 'abc' })).toEqual([
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--permission-mode', 'default',
      fenceOf(['/tmp', `${homedir()}/.ai-page-dive/attachments`]),
      '--resume', 'abc',
    ])
  })

  it('claude：resume 轮 contentFile 空串——跳过正文根，agentCwd + 附件照在（r7-review 空串容忍）', () => {
    const args = claudeDef.buildArgs({ contentFile: '', agentCwd: '/tmp/pagedive-x', resumeSessionId: 's' })
    const allowed = args.find((a) => a.startsWith('--allowedTools='))
    expect(allowed).toContain('Read(//tmp/pagedive-x/**)')
    expect(allowed).toContain(`Read(/${homedir()}/.ai-page-dive/attachments/**)`)
    expect(allowed).not.toContain('Read(//**)') // 无空根（contentFile='' 未混入）
    expect(args).toContain('--resume')
    expect(args).toContain('s')
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
