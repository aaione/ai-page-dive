// r80(B)：一次性 10min 总闸改双闸——idle 闸每过程帧重挂（长产出任务不再被中途
// 误杀）+ 硬上限 3× 不重置（配额保护）。env 缩窗：idle=1500ms、hard=4500ms。
// TASK_TIMEOUT_MS 是模块常量，import 前设 env 才拿得到短窗版本（task-timeout.test.ts 同式）
process.env.PAGEDIVE_TASK_TIMEOUT_MS = '1500'

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PAGE = { url: 'https://a.com/x', title: 'T', extractor: 'test', approxTokens: 10 }
const BODY = '# 正文\n\n内容'
const delta = (t: string) =>
  `console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'${t}'}}}))`

describe('双闸看门狗（r80 B）', () => {
  it('idle 闸帧重挂：CLI 每 1s 吐 delta、3.2s 才收 result——总时长超旧 1.5s 总闸仍自然终局', async () => {
    const { Task } = await import('../src/task.js')
    const { AGENTS } = await import('../src/agents/registry.js')
    const dir = await mkdtemp(join(tmpdir(), 'pd-wd1-'))
    const script = join(dir, 'cli.mjs')
    // 帧间隔 1000ms < idle 窗 1500ms（每帧重挂）；总时长 3200ms > 1500ms（旧一次性
    // 总闸在此刻必杀——本用例钉住 idle 语义：有产出即续命）
    await writeFile(
      script,
      `${delta('段1')}
setTimeout(()=>{${delta('段2')}},1000)
setTimeout(()=>{${delta('段3')}},2000)
setTimeout(()=>{${delta('段4')};console.log(JSON.stringify({type:'result',is_error:false,result:'完成',usage:{input_tokens:1,output_tokens:2}}));process.exit(0)},3200)
`,
      'utf8',
    )
    AGENTS[0].bin = 'node'
    const orig = AGENTS[0].buildArgs
    AGENTS[0].buildArgs = () => [script]
    const fakeHome = await mkdtemp(join(tmpdir(), 'pd-home-'))
    const origHome = process.env.HOME
    process.env.HOME = fakeHome
    const done: any[] = []
    const errors: [string, string][] = []
    try {
      const task = new Task('t-wd-idle', {
        onStatus: () => {}, onMeta: () => {}, onChunk: () => {},
        onDone: (info) => done.push(info),
        onError: (code, message) => errors.push([code, message]),
      })
      task.start({ taskId: 't-wd-idle', agentId: 'claude', workflow: 'quick', page: PAGE as any })
      task.appendContent(BODY, true)
      await task.run()
      expect(errors).toEqual([])
      expect(done[0]?.isError).toBe(false)
      expect(done[0]?.durationMs).toBeGreaterThan(2500) // 活过旧总闸刻度（抗噪降额）
    } finally {
      process.env.HOME = origHome
      AGENTS[0].buildArgs = orig
      await rm(fakeHome, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('硬上限：CLI 每 800ms 持续吐 delta 永不终局——4.5s（3× 窗）强收走 timeout', async () => {
    const { Task } = await import('../src/task.js')
    const { AGENTS } = await import('../src/agents/registry.js')
    const dir = await mkdtemp(join(tmpdir(), 'pd-wd2-'))
    const script = join(dir, 'cli.mjs')
    await writeFile(
      script,
      `const say=(o)=>console.log(JSON.stringify(o))
const tick=()=>{say({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'滴'}}});setTimeout(tick,800)}
tick();setTimeout(()=>{},60000)
`,
      'utf8',
    )
    AGENTS[0].bin = 'node'
    const orig = AGENTS[0].buildArgs
    AGENTS[0].buildArgs = () => [script]
    const fakeHome = await mkdtemp(join(tmpdir(), 'pd-home-'))
    const origHome = process.env.HOME
    process.env.HOME = fakeHome
    const done: any[] = []
    const errors: [string, string][] = []
    const t0 = Date.now()
    try {
      const task = new Task('t-wd-hard', {
        onStatus: () => {}, onMeta: () => {}, onChunk: () => {},
        onDone: (info) => done.push(info),
        onError: (code, message) => errors.push([code, message]),
      })
      task.start({ taskId: 't-wd-hard', agentId: 'claude', workflow: 'quick', page: PAGE as any })
      task.appendContent(BODY, true)
      await task.run()
      // 帧间隔 800ms 恒小于 idle 窗——idle 闸永不触发，终局只能来自硬上限
      expect(errors.map((e) => e[0])).toEqual(['timeout'])
      expect(done).toEqual([])
      expect(Date.now() - t0).toBeGreaterThan(4000) // 活过 2× 窗（硬上限而非提前误杀）
    } finally {
      process.env.HOME = origHome
      AGENTS[0].buildArgs = orig
      await rm(fakeHome, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
