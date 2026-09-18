import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtToHost } from '@ai-page-dive/shared'
import { runStdio } from '../src/stdio.js'

function makeSession() {
  const sent: any[] = []
  const { handle, tasks } = runStdio((o) => sent.push(o))
  return { handle, tasks, sent }
}

const PAGE = { url: 'https://a.com', title: 'T', extractor: 'test', approxTokens: 1 }

describe('stdio 路由', () => {
  it('ping → pong', () => {
    const { handle, sent } = makeSession()
    handle({ t: 'ping' })
    // 版本断言放宽为结构（HOST_VERSION 跟随 package.json 走，硬编码会每次 bump 挂测试）
    expect(sent[0]?.t).toBe('pong')
    expect(sent[0]?.hostVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('task-content 先于 task-start → no-task 错误', () => {
    const { handle, sent } = makeSession()
    handle({ t: 'task-content', taskId: 'ghost', seq: 0, text: 'x', done: true })
    expect(sent[0]).toMatchObject({ t: 'error', code: 'no-task' })
  })

  it('task-start 注册任务后 task-content 不再报 no-task', () => {
    const { handle, sent, tasks } = makeSession()
    handle({ t: 'task-start', task: { taskId: 'a', agentId: 'claude', page: PAGE as any } })
    handle({ t: 'task-content', taskId: 'a', seq: 0, text: 'x', done: false })
    expect(tasks.has('a')).toBe(true)
    expect(sent.filter(m => m.t === 'error')).toEqual([])
  })

  it('history-read 路径逃逸被拒', async () => {
    const { handle, sent } = makeSession()
    handle({ t: 'history-read', path: '/Users/x/.ai-page-dive/history-evil/x.md' })
    await new Promise(r => setTimeout(r, 50))
    expect(sent[0]).toMatchObject({ t: 'error', code: 'read-fail' })
  })

  it('skill-reveal 非法名 → reveal-fail 后 session 仍活（async rejection 回归）', async () => {
    const { handle, sent } = makeSession()
    handle({ t: 'skill-reveal', name: '../escape' })
    await new Promise(r => setTimeout(r, 100))
    expect(sent[0]).toMatchObject({ t: 'error', code: 'reveal-fail' })
    // rejection 未捕获会杀 session——后续消息必须仍被处理
    handle({ t: 'ping' })
    await new Promise(r => setTimeout(r, 50))
    expect(sent[1]?.t).toBe('pong')
  })

  it('list-agents 异步回 agents 帧', async () => {
    const { handle, sent } = makeSession()
    handle({ t: 'list-agents' })
    // r10-review：固定 sleep 2s 在 CLI 冷启动 >2s 时挂——轮询 8s 上限，快机器快退
    const deadline = Date.now() + 8000
    while (!sent.some(m => m.t === 'agents') && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100))
    }
    const agentsMsg = sent.find(m => m.t === 'agents')
    expect(agentsMsg.agents.map((a: any) => a.id)).toEqual(['claude', 'codex', 'opencode'])
  }, 15_000)

  it('同 taskId 重入：旧任务 superseded 静默终局，tasks 只剩新实例（r8 修复回归）', async () => {
    const { AGENTS } = await import('../src/agents/registry.js')
    const dir = await mkdtemp(join(tmpdir(), 'pd-sup-'))
    const script = join(dir, 'cli.mjs')
    await writeFile(script, `setTimeout(() => console.log(JSON.stringify({type:'result',is_error:false,result:'ok'})), 60000)`, 'utf8')
    AGENTS[0].bin = 'node'
    const orig = AGENTS[0].buildArgs
    AGENTS[0].buildArgs = () => [script]
    try {
      const { handle, sent, tasks } = makeSession()
      handle({ t: 'task-start', task: { taskId: 'dup', agentId: 'claude', page: PAGE as any } })
      await new Promise(r => setTimeout(r, 400)) // 旧实例 spawn 起跑
      handle({ t: 'task-start', task: { taskId: 'dup', agentId: 'claude', page: PAGE as any } })
      await new Promise(r => setTimeout(r, 800)) // 旧实例被 cancel → SIGTERM → exit → finish(cancelled)
      expect(tasks.size).toBe(1)
      // 旧实例的 cancelled 终局被 superseded 守卫静默——不发 task-error
      expect(sent.filter(m => m.t === 'error')).toEqual([])
      // 收尾：取消新实例防 60s 挂尾测试进程
      handle({ t: 'task-cancel', taskId: 'dup' })
      await new Promise(r => setTimeout(r, 300))
    } finally {
      AGENTS[0].buildArgs = orig
      await rm(dir, { recursive: true, force: true })
    }
  }, 15_000)
})
