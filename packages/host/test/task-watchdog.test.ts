// r80(B)：一次性 10min 总闸改双闸——idle 闸每过程帧重挂（长产出任务不再被中途
// 误杀）+ 硬上限 3× 不重置（配额保护）。
// r81（C7）：去真时钟窄裕量——帧距 1000/800ms 对 idle 1500ms 裕量仅 500/700ms，
// 负载下假红实证（审前自查首轮 2 红）；对齐同仓 r63 纪律（task-timeout.test.ts
// 1300ms 判不可靠抬到 5000ms）：env 抬窗 idle=3000/hard=9000、帧距降载放大裕量
// 至 2000/2500ms，断言全部改行为锚（帧表/chunk 计数），不再断言墙上时钟。
// TASK_TIMEOUT_MS 是模块常量，import 前设 env 才拿得到短窗版本（task-timeout.test.ts 同式）
process.env.PAGEDIVE_TASK_TIMEOUT_MS = '3000'

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PAGE = { url: 'https://a.com/x', title: 'T', extractor: 'test', approxTokens: 10 }
const BODY = '# 正文\n\n内容'
const delta = (t: string) =>
  `console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'${t}'}}}))`

describe('双闸看门狗（r80 B）', () => {
  it('idle 闸帧重挂：CLI 每 1s 吐 delta、5.2s 才收 result——总时长超旧 3s 总闸仍自然终局', async () => {
    const { Task } = await import('../src/task.js')
    const { AGENTS } = await import('../src/agents/registry.js')
    const dir = await mkdtemp(join(tmpdir(), 'pd-wd1-'))
    const script = join(dir, 'cli.mjs')
    // 帧间隔 1000ms < idle 窗 3000ms（每帧重挂，裕量 2000ms）；总时长 5200ms > 3000ms
    //（旧一次性总闸在此刻必杀）。活过旧总闸的证明不靠墙上时钟断言——第 4 帧
    // 脚本时刻 4000ms（> 3000）被 host 收到且零误杀（errors 空 + done 正常）即是
    await writeFile(
      script,
      `${delta('段1')}
setTimeout(()=>{${delta('段2')}},1000)
setTimeout(()=>{${delta('段3')}},2000)
setTimeout(()=>{${delta('段4')}},3000)
setTimeout(()=>{${delta('段5')};console.log(JSON.stringify({type:'result',is_error:false,result:'完成',usage:{input_tokens:1,output_tokens:2}}));process.exit(0)},5200)
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
    let chunks = ''
    try {
      const task = new Task('t-wd-idle', {
        onStatus: () => {}, onMeta: () => {},
        onChunk: (text: string) => { chunks += text },
        onDone: (info) => done.push(info),
        onError: (code, message) => errors.push([code, message]),
      })
      task.start({ taskId: 't-wd-idle', agentId: 'claude', workflow: 'quick', page: PAGE as any })
      task.appendContent(BODY, true)
      await task.run()
      expect(errors).toEqual([])
      expect(done[0]?.isError).toBe(false)
      // 行为锚：4000ms 处的第 5 帧 + 5200ms 处的 result 全收到——帧表即「活过旧总闸」证据
      expect(chunks).toContain('段5')
    } finally {
      process.env.HOME = origHome
      AGENTS[0].buildArgs = orig
      await rm(fakeHome, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('硬上限：CLI 每 500ms 持续吐 delta 永不终局——9s（3× 窗）强收走 timeout', async () => {
    const { Task } = await import('../src/task.js')
    const { AGENTS } = await import('../src/agents/registry.js')
    const dir = await mkdtemp(join(tmpdir(), 'pd-wd2-'))
    const script = join(dir, 'cli.mjs')
    // 帧间隔 500ms 恒小于 idle 窗 3000ms（裕量 2500ms）——idle 闸永不触发
    await writeFile(
      script,
      `const say=(o)=>console.log(JSON.stringify(o))
const tick=()=>{say({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'滴'}}});setTimeout(tick,500)}
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
    let chunkCount = 0
    try {
      const task = new Task('t-wd-hard', {
        onStatus: () => {}, onMeta: () => {},
        onChunk: () => { chunkCount += 1 },
        onDone: (info) => done.push(info),
        onError: (code, message) => errors.push([code, message]),
      })
      task.start({ taskId: 't-wd-hard', agentId: 'claude', workflow: 'quick', page: PAGE as any })
      task.appendContent(BODY, true)
      await task.run()
      // 行为锚替墙上时钟：≥14 帧（≥7000ms 持续续命，两倍余量超 idle 窗 3000）之后
      // 的 timeout 终局只可能来自硬上限 9000——idle 误杀撑不到这个帧数
      expect(errors.map((e) => e[0])).toEqual(['timeout'])
      expect(done).toEqual([])
      expect(chunkCount).toBeGreaterThanOrEqual(14)
    } finally {
      process.env.HOME = origHome
      AGENTS[0].buildArgs = orig
      await rm(fakeHome, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
