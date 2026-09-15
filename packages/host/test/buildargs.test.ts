import { describe, expect, it } from 'vitest'
import { claudeDef } from '../src/agents/claude.js'
import { codexDef } from '../src/agents/codex.js'

describe('buildArgs 快照', () => {
  it('claude：-p stream-json verbose + partial 增量 + Read 围栏 + resume 位', () => {
    expect(claudeDef.buildArgs({ contentFile: '/tmp/x.md' })).toEqual([
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      // 进程级工具围栏（r6-sec）：与 codex --sandbox read-only 对称；等号形式防
      // variadic 吞参（实测空格形式会吃掉后续 argv）
      '--allowedTools=Read',
    ])
    expect(claudeDef.buildArgs({ contentFile: '/tmp/x.md', resumeSessionId: 'abc' })).toEqual([
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--allowedTools=Read',
      '--resume', 'abc',
    ])
  })

  it('codex：exec json read-only skip-git-repo-check -o', () => {
    expect(
      codexDef.buildArgs({ contentFile: '/tmp/x.md', lastMsgFile: '/tmp/x.md.last' }),
    ).toEqual([
      'exec',
      '--json',
      '--sandbox', 'read-only',
      '--skip-git-repo-check',
      '-o', '/tmp/x.md.last',
    ])
  })

  it('codex：无 lastMsgFile 则省略 -o', () => {
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
    // resume 轮无 -o（lastMsgFile 为空，上层 isResume 不落临时文件）
    expect(codexDef.buildArgs({ contentFile: '', resumeSessionId: 'th-1' })).not.toContain('-o')
  })
})
