import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Task } from '../src/task.js'

// 部分 mock（r7-review 回归）：saveHistory 永远失败（模拟磁盘满/EACCES），
// 其余导出（buildHistoryPath/appendHistoryTurn）保持真实实现
vi.mock('../src/history.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/history.js')>()
  return { ...orig, saveHistory: async () => { throw new Error('ENOSPC: disk full') } }
})

describe('persist 失败终局（r7-review：不回传虚构 historyPath）', () => {
  it('saveHistory 失败 → onDone 仍按成功终局，但 historyPath 为空串', async () => {
    const { AGENTS } = await import('../src/agents/registry.js')
    const dir = await mkdtemp(join(tmpdir(), 'pd-pf-'))
    const script = join(dir, 'cli.mjs')
    await writeFile(
      script,
      `console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'回答'}]}}))
console.log(JSON.stringify({type:'result',is_error:false,result:'回答',usage:{}}))`,
      'utf8',
    )
    AGENTS[0].bin = 'node'
    const orig = AGENTS[0].buildArgs
    AGENTS[0].buildArgs = () => [script]
    const fakeHome = await mkdtemp(join(tmpdir(), 'pd-home-'))
    const origHome = process.env.HOME
    process.env.HOME = fakeHome
    try {
      const done = { info: null as any }
      const errors: [string, string][] = []
      const task = new Task('t-pf', {
        onStatus: () => {},
        onMeta: () => {},
        onChunk: () => {},
        onDone: (info) => (done.info = info),
        onError: (c, m) => errors.push([c, m]),
      })
      task.start({
        taskId: 't-pf',
        agentId: 'claude',
        workflow: 'quick',
        page: { url: 'https://a.com/x', title: 'T', extractor: 'test', approxTokens: 10 } as any,
      })
      task.appendContent('# 正文\n\n内容', true)
      await task.run()
      await new Promise((r) => setTimeout(r, 300))
      // persist 失败不改变任务终局语义（回答完整即成功），但不得回传虚构路径——
      // SW 会把它记进 lastSession，追问轮 append 出无 frontmatter 的孤儿文件
      expect(done.info?.isError).toBe(false)
      expect(done.info?.historyPath).toBe('')
      expect(errors).toEqual([])
    } finally {
      process.env.HOME = origHome
      AGENTS[0].buildArgs = orig
      await rm(fakeHome, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
