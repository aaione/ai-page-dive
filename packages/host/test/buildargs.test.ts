import { describe, expect, it } from 'vitest'
import { claudeDef } from '../src/agents/claude.js'
import { codexDef } from '../src/agents/codex.js'

describe('buildArgs 快照', () => {
  it('claude：-p stream-json verbose + partial 增量 + resume 位', () => {
    expect(claudeDef.buildArgs({ contentFile: '/tmp/x.md' })).toEqual([
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ])
    expect(claudeDef.buildArgs({ contentFile: '/tmp/x.md', resumeSessionId: 'abc' })).toEqual([
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
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
})
