import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtToHost } from '@ai-page-dive/shared'
import { NM_MAX } from '../src/nm.js'
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

  it('未知消息类型 → unknown-message 回帧而非静默吞（r54 #10：协议演进时新 ext + 旧 host 可排障）', () => {
    const { handle, sent } = makeSession()
    handle({ t: 'from-the-future' } as any)
    expect(sent[0]).toMatchObject({ t: 'error', code: 'unknown-message', ref: 'from-the-future' })
    // 回帧后 session 仍活
    handle({ t: 'ping' })
    expect(sent[1]?.t).toBe('pong')
  })

  it('history-read：≤900KB 高转义原文（全引号）编码后击穿 1MB → 收缩进帧上限（r54 #10）', async () => {
    // 900KB 阈值只看原文字节——引号 JSON 膨胀 2 倍，899KB 原文编码 ~1.8MB 击穿 NM 1MB。
    // 旧实现仅 >900KB 分支做编码后校验，此形状直发 → writeFrame 抛错、面板静默收不到帧。
    // readHistory 有 assertInRoot（ROOT 模块级常量、改 HOME 无效）——真实 ROOT 下唯一命名，测后即删
    const root = join(homedir(), '.ai-page-dive', 'history')
    const p = join(root, `pd-quotebomb-${process.pid}.md`)
    await mkdir(root, { recursive: true })
    await writeFile(p, '"'.repeat(899_000), 'utf8')
    try {
      const { handle, sent } = makeSession()
      handle({ t: 'history-read', path: p })
      const deadline = Date.now() + 8000
      while (!sent.some(m => m.t === 'history-file' || m.t === 'error') && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 50))
      }
      const f = sent.find(m => m.t === 'history-file')
      expect(f).toBeTruthy()
      expect(f.content).toContain('[... 已截断，全文见本地文件')
      expect(Buffer.byteLength(JSON.stringify(f.content), 'utf8')).toBeLessThanOrEqual(NM_MAX - 1024)
    } finally {
      await rm(p, { force: true })
    }
  }, 15_000)

  it('workflow-read：>1MB 的 WORKFLOW.md 收缩进帧上限而非 writeFrame throw（r56 #9）', async () => {
    // USER_DIR 是模块级常量（改 HOME 无效）——真实目录下唯一命名，测后即删（quotebomb 同款）。
    // 旧实现直发 1.1MB → writeFrame throw → 帧被吞、面板错标 not-found
    const wfDir = join(homedir(), '.ai-page-dive', 'workflows', `pd-bigwf-${process.pid}`)
    const p = join(wfDir, 'WORKFLOW.md')
    await mkdir(wfDir, { recursive: true })
    await writeFile(p, 'x'.repeat(1_100_000), 'utf8')
    try {
      const { handle, sent } = makeSession()
      handle({ t: 'workflow-read', name: `pd-bigwf-${process.pid}` })
      const deadline = Date.now() + 8000
      while (!sent.some(m => m.t === 'workflow-file' || m.t === 'error') && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 50))
      }
      const f = sent.find(m => m.t === 'workflow-file')
      expect(f).toBeTruthy()
      expect(f.content).toContain('[... 已截断]')
      // r57（#9）：结构化截断标志——Settings 据此警示「保存将丢失未显示部分」
      expect(f.truncated).toBe(true)
      expect(Buffer.byteLength(JSON.stringify(f.content), 'utf8')).toBeLessThanOrEqual(NM_MAX - 1024)
      // 小文件无截断：标志不落键（undefined 不序列化进帧）
      const wf2 = join(homedir(), '.ai-page-dive', 'workflows', `pd-smallwf-${process.pid}`)
      await mkdir(wf2, { recursive: true })
      await writeFile(join(wf2, 'WORKFLOW.md'), 'ok', 'utf8')
      try {
        handle({ t: 'workflow-read', name: `pd-smallwf-${process.pid}` })
        while (!sent.some(m => m.t === 'workflow-file' && m.name === `pd-smallwf-${process.pid}`) && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 50))
        }
        const f2 = sent.find(m => m.t === 'workflow-file' && m.name === `pd-smallwf-${process.pid}`)
        expect(f2?.truncated).toBeUndefined()
        expect(f2?.content).toBe('ok')
      } finally {
        await rm(wf2, { recursive: true, force: true })
      }
    } finally {
      await rm(wfDir, { recursive: true, force: true })
    }
  }, 15_000)

  it('list-agents 异步回 agents 帧', async () => {
    const { handle, sent } = makeSession()
    handle({ t: 'list-agents' })
    // r10-review：固定 sleep 2s 在 CLI 冷启动 >2s 时挂——轮询 8s 上限，快机器快退
    const deadline = Date.now() + 8000
    while (!sent.some(m => m.t === 'agents') && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100))
    }
    const agentsMsg = sent.find(m => m.t === 'agents')
    // r40 下架 → r55 删除（D5 修订）：agents 恒为双引擎
    expect(agentsMsg.agents.map((a: any) => a.id)).toEqual(['claude', 'codex'])
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

  // r52（review #3）：r51 的 unrecognized 集成测试只锚到 Task 回调层——恰在 stdio
  // 发帧层断点前一侧（复刻了它自称补齐的缺口）。此处锚帧组装：假 CLI 混注未知
  // type×2，断言发出的 task-done 帧带 unrecognized:2（panel 消费端才收得到）
  it('task-done 帧携带 unrecognized（帧组装层）', async () => {
    const { AGENTS } = await import('../src/agents/registry.js')
    const dir = await mkdtemp(join(tmpdir(), 'pd-unk-'))
    const script = join(dir, 'cli.mjs')
    await writeFile(script, `console.log(JSON.stringify({type:'future_event',x:1}))
console.log(JSON.stringify({type:'future_event',x:2}))
console.log(JSON.stringify({type:'result',is_error:false,result:'完成',usage:{input_tokens:1,output_tokens:2}}))`, 'utf8')
    AGENTS[0].bin = 'node'
    const orig = AGENTS[0].buildArgs
    AGENTS[0].buildArgs = () => [script]
    const fakeHome = await mkdtemp(join(tmpdir(), 'pd-home-'))
    const origHome = process.env.HOME
    process.env.HOME = fakeHome
    try {
      const { handle, sent } = makeSession()
      handle({ t: 'task-start', task: { taskId: 'unk', agentId: 'claude', page: PAGE as any } })
      handle({ t: 'task-content', taskId: 'unk', seq: 0, text: 'x', done: true })
      const deadline = Date.now() + 10_000
      while (!sent.some(m => m.t === 'task-done') && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 100))
      }
      expect(sent.find(m => m.t === 'task-done')?.unrecognized).toBe(2)
    } finally {
      process.env.HOME = origHome
      AGENTS[0].buildArgs = orig
      await rm(dir, { recursive: true, force: true })
      await rm(fakeHome, { recursive: true, force: true })
    }
  }, 15_000)

  // r58（#30）：SW 侧任务指针丢失（扩展 reload 折叠）而 host 侧还在跑时，无 taskId
  // 的 task-cancel 是唯一收割通道——修复前 get(undefined) 恒 no-op，CLI 空跑烧额度
  it('无 taskId 的 task-cancel 收割本连接最近任务（r58 #30）', async () => {
    const { AGENTS } = await import('../src/agents/registry.js')
    const dir = await mkdtemp(join(tmpdir(), 'pd-nc-'))
    const script = join(dir, 'cli.mjs')
    await writeFile(script, `setTimeout(() => console.log(JSON.stringify({type:'result',is_error:false,result:'ok'})), 60000)`, 'utf8')
    AGENTS[0].bin = 'node'
    const orig = AGENTS[0].buildArgs
    AGENTS[0].buildArgs = () => [script]
    try {
      const { handle, tasks } = makeSession()
      handle({ t: 'task-start', task: { taskId: 'orphan', agentId: 'claude', page: PAGE as any } })
      await new Promise(r => setTimeout(r, 400)) // spawn 起跑
      handle({ t: 'task-cancel' }) // 无 taskId
      await new Promise(r => setTimeout(r, 800)) // SIGTERM → 终局自删
      expect(tasks.has('orphan')).toBe(false)
    } finally {
      AGENTS[0].buildArgs = orig
      await rm(dir, { recursive: true, force: true })
    }
  }, 15_000)
})
