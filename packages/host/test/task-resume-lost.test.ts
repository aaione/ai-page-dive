// r80(A)：claude resume 目标丢失识别——CLI 本地失败（is_error 且零轮次零 API
// 时间，不耗订阅）走 onError('session-lost') 专属终局接面板自愈链（resumable:false
// 重发即全新总结）；同形状非 resume 轮仍走 is_error onDone（无会话可丢，不误伤）。
// 形状实抄真机 `claude -p --output-format stream-json --verbose --resume <不存在UUID>`
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PAGE = { url: 'https://a.com/x', title: 'T', extractor: 'test', approxTokens: 10 }
const LOST_FRAME = JSON.stringify({
  type: 'result', subtype: 'error_during_execution', duration_ms: 0, duration_api_ms: 0,
  is_error: true, num_turns: 0, session_id: '00000000-0000-4000-8000-000000000000',
  errors: ['No conversation found with session ID: 00000000-0000-4000-8000-000000000000'],
})

describe('resume 目标丢失终局（r80 A）', () => {
  it('resume 轮收到丢失形状 → onError(session-lost)，不落 is_error done', async () => {
    const { Task } = await import('../src/task.js')
    const { AGENTS } = await import('../src/agents/registry.js')
    const dir = await mkdtemp(join(tmpdir(), 'pd-a-'))
    const script = join(dir, 'cli.mjs')
    await writeFile(script, `console.log('${LOST_FRAME}')\nprocess.exit(0)`, 'utf8')
    AGENTS[0].bin = 'node'
    const orig = AGENTS[0].buildArgs
    AGENTS[0].buildArgs = () => [script]
    const fakeHome = await mkdtemp(join(tmpdir(), 'pd-home-'))
    const origHome = process.env.HOME
    process.env.HOME = fakeHome
    const done: any[] = []
    const errors: [string, string][] = []
    try {
      const task = new Task('t-resume-lost', {
        onStatus: () => {}, onMeta: () => {}, onChunk: () => {},
        onDone: (info) => done.push(info),
        onError: (code, message) => errors.push([code, message]),
      })
      task.start({ taskId: 't-resume-lost', agentId: 'claude', resumeSessionId: '00000000-0000-4000-8000-000000000000', historyPath: '', page: PAGE as any })
      await task.run()
      expect(errors.map((e) => e[0])).toEqual(['session-lost'])
      expect(done).toEqual([]) // 专属码走 task-error 通道（面板/SW 有自愈接线）
    } finally {
      process.env.HOME = origHome
      AGENTS[0].buildArgs = orig
      await rm(fakeHome, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('同形状非 resume 轮 → 仍走 is_error onDone（首总结轮无会话可丢）', async () => {
    const { Task } = await import('../src/task.js')
    const { AGENTS } = await import('../src/agents/registry.js')
    const dir = await mkdtemp(join(tmpdir(), 'pd-b-'))
    const script = join(dir, 'cli.mjs')
    await writeFile(script, `console.log('${LOST_FRAME}')\nprocess.exit(0)`, 'utf8')
    AGENTS[0].bin = 'node'
    const orig = AGENTS[0].buildArgs
    AGENTS[0].buildArgs = () => [script]
    const fakeHome = await mkdtemp(join(tmpdir(), 'pd-home-'))
    const origHome = process.env.HOME
    process.env.HOME = fakeHome
    const done: any[] = []
    const errors: [string, string][] = []
    try {
      const task = new Task('t-nolost', {
        onStatus: () => {}, onMeta: () => {}, onChunk: () => {},
        onDone: (info) => done.push(info),
        onError: (code, message) => errors.push([code, message]),
      })
      task.start({ taskId: 't-nolost', agentId: 'claude', workflow: 'quick', page: PAGE as any })
      task.appendContent('# 正文', true)
      await task.run()
      expect(done.length).toBe(1)
      expect(done[0].isError).toBe(true)
      expect(errors).toEqual([])
    } finally {
      process.env.HOME = origHome
      AGENTS[0].buildArgs = orig
      await rm(fakeHome, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  })

  // r80(A)续：codex resume 目标丢失真机形状（0.162 实测）——stdout 零帧、exit 1、
  // stderr prose「no rollout found for thread id」。非 UUID 假 id codex 静默开新
  // thread 正常跑（真机实测），无丢失形状，不需用例
  it('codex resume 目标丢失（stdout 空 + stderr prose + exit 1）→ onError(session-lost)', async () => {
    const { Task } = await import('../src/task.js')
    const { AGENTS } = await import('../src/agents/registry.js')
    const codex = AGENTS.find((a) => a.id === 'codex')!
    const dir = await mkdtemp(join(tmpdir(), 'pd-c-'))
    const script = join(dir, 'cli.mjs')
    await writeFile(
      script,
      `process.stderr.write('Error: thread/resume: thread/resume failed: no rollout found for thread id 00000000-0000-4000-8000-000000000000 (code -32600)\\n');process.exit(1)`,
      'utf8',
    )
    codex.bin = 'node'
    const orig = codex.buildArgs
    codex.buildArgs = () => [script]
    const fakeHome = await mkdtemp(join(tmpdir(), 'pd-home-'))
    const origHome = process.env.HOME
    process.env.HOME = fakeHome
    const done: any[] = []
    const errors: [string, string][] = []
    try {
      const task = new Task('t-codex-lost', {
        onStatus: () => {}, onMeta: () => {}, onChunk: () => {},
        onDone: (info) => done.push(info),
        onError: (code, message) => errors.push([code, message]),
      })
      task.start({ taskId: 't-codex-lost', agentId: 'codex', resumeSessionId: '00000000-0000-4000-8000-000000000000', historyPath: '', page: PAGE as any })
      await task.run()
      expect(errors.map((e) => e[0])).toEqual(['session-lost'])
      expect(errors[0][1]).toContain('no rollout found')
      expect(done).toEqual([])
    } finally {
      process.env.HOME = origHome
      codex.bin = 'codex'
      codex.buildArgs = orig
      await rm(fakeHome, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  })
})
