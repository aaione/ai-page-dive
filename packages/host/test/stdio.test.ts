import { describe, expect, it } from 'vitest'
import type { ExtToHost } from '@pagedive/shared'
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
    expect(sent).toEqual([{ t: 'pong', hostVersion: '0.1.0' }])
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
    handle({ t: 'history-read', path: '/Users/x/.pagedive/history-evil/x.md' })
    await new Promise(r => setTimeout(r, 50))
    expect(sent[0]).toMatchObject({ t: 'error', code: 'read-fail' })
  })

  it('list-agents 异步回 agents 帧', async () => {
    const { handle, sent } = makeSession()
    handle({ t: 'list-agents' })
    await new Promise(r => setTimeout(r, 2000))
    const agentsMsg = sent.find(m => m.t === 'agents')
    expect(agentsMsg.agents.map((a: any) => a.id)).toEqual(['claude', 'codex', 'opencode'])
  }, 15_000)
})
