import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Task, buildPrompt } from '../src/task.js'

// 集成式状态机测试：用假 CLI（node 脚本）代替真 claude/codex
const FAKE_CLI = async (mode: string) => {
  const dir = await mkdtemp(join(tmpdir(), 'pd-fake-'))
  const script = join(dir, 'cli.mjs')
  const code = {
    ok: `console.log(JSON.stringify({type:'system',subtype:'init'}))
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'第一段'}]}}))
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'第一段第二段'}]}}))
console.log(JSON.stringify({type:'result',is_error:false,result:'完成',usage:{input_tokens:1,output_tokens:2}}))`,
    is_error: `console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'部分'}]}}))
console.log(JSON.stringify({type:'result',is_error:true,result:'认证失败'}))`,
    slow: `setTimeout(() => console.log(JSON.stringify({type:'result',is_error:false,result:'完成'})), 60_000)`,
    noagent: '',
  }[mode]
  await writeFile(script, code ?? '', 'utf8')
  return script
}

function makeCbs() {
  const cbs = {
    status: [] as string[],
    meta: null as any,
    chunks: [] as [string, number][],
    done: null as any,
    errors: [] as [string, string][],
  }
  return {
    cbs,
    task: (id = 't1') =>
      new Task(id, {
        onStatus: (p) => cbs.status.push(p),
        onMeta: (info) => (cbs.meta = info),
        onChunk: (text, seq) => cbs.chunks.push([text, seq]),
        onDone: (info) => (cbs.done = info),
        onError: (code, message) => cbs.errors.push([code, message]),
      }),
  }
}

const PAGE = { url: 'https://a.com/x', title: 'T', extractor: 'test', approxTokens: 10 }
const BODY = '# 正文\n\n内容'

describe('Task 状态机', () => {
  it('正常路径：delta 流 → onDone + 历史落盘 + seq 递增', async () => {
    // monkeypatch getAgent 的 bin 指向假 CLI
    const { AGENTS } = await import('../src/agents/registry.js')
    const script = await FAKE_CLI('ok')
    AGENTS[0].bin = `node` // 借 claude def，但 bin 改 node
    const orig = AGENTS[0].buildArgs
    AGENTS[0].buildArgs = () => [script]

    const { task: mk, cbs } = makeCbs(); const task = mk()
    task.start({ taskId: 't1', agentId: 'claude', workflow: 'quick', page: PAGE as any })
    task.appendContent(BODY, true)
    await task.run()

    expect(cbs.chunks.map(c => c[0])).toEqual(['第一段', '第二段'])
    expect(cbs.chunks.map(c => c[1])).toEqual([0, 1])
    expect(cbs.done?.isError).toBe(false)
    expect(cbs.done?.historyPath).toMatch(/\.ai-page-dive\/history\/\d{4}\/\d{2}\/\d{2}\/.*\.md$/)
    const raw = await readFile(cbs.done.historyPath, 'utf8')
    expect(raw).toContain('status: done')
    expect(raw).toContain('第一段第二段')

    AGENTS[0].buildArgs = orig
    await rm(cbs.done.historyPath, { force: true }).catch(() => {})  // 单测不污染真实历史
    await rm(join(script, '..'), { recursive: true, force: true })
  }, 30_000)

  it('is_error 路径：onDone(isError=true) 只发一次，errorText 传导', async () => {
    const { AGENTS } = await import('../src/agents/registry.js')
    const script = await FAKE_CLI('is_error')
    AGENTS[0].buildArgs = () => [script]
    const { task: mk, cbs } = makeCbs(); const task = mk()
    task.start({ taskId: 't2', agentId: 'claude', workflow: 'quick', page: PAGE as any })
    task.appendContent(BODY, true)
    await task.run()
    // 等 exit 事件处理完
    await new Promise(r => setTimeout(r, 300))
    expect(cbs.done?.isError).toBe(true)
    expect(cbs.done?.errorText).toBe('认证失败')
    expect(cbs.errors).toEqual([])
    await rm(cbs.done.historyPath, { force: true }).catch(() => {})
    await rm(join(script, '..'), { recursive: true, force: true })
  }, 30_000)

  it('未知 agent → no-agent，不 spawn', async () => {
    const { task: mk, cbs } = makeCbs(); const task = mk()
    task.start({ taskId: 't3', agentId: 'nope', workflow: 'quick', page: PAGE as any })
    await task.run()
    expect(cbs.errors[0][0]).toBe('no-agent')
  })

  it('重复 run() 幂等（双 done:true 只 spawn 一次）', async () => {
    const { AGENTS } = await import('../src/agents/registry.js')
    const script = await FAKE_CLI('ok')
    const calls: string[] = []
    const orig = AGENTS[0].buildArgs
    AGENTS[0].buildArgs = () => (calls.push('spawn'), [script])
    const { task: mk, cbs } = makeCbs(); const task = mk()
    task.start({ taskId: 't4', agentId: 'claude', workflow: 'quick', page: PAGE as any })
    task.appendContent(BODY, true)
    await Promise.all([task.run(), task.run()])
    expect(calls).toEqual(['spawn'])
    AGENTS[0].buildArgs = orig
    await rm(cbs.done.historyPath, { force: true }).catch(() => {})  // 单测不污染真实历史
    await rm(join(script, '..'), { recursive: true, force: true })
  }, 30_000)

  it('buildPrompt：workflow body 优先于内置默认', () => {
    const p1 = buildPrompt(PAGE as any, '/tmp/f.md', 'mywf', '自定义任务 {url}')
    expect(p1).toContain('自定义任务')
    const p2 = buildPrompt(PAGE as any, '/tmp/f.md', 'quick')
    expect(p2).toContain('5-8 条要点')
    expect(p2).toContain('/tmp/f.md')
  })

  it('buildPrompt：lang 拼尾部指令，缺省自动无指令', () => {
    const zh = buildPrompt(PAGE as any, '/tmp/f.md', 'quick', undefined, undefined, 'zh')
    expect(zh).toContain('始终使用中文回答')
    const en = buildPrompt(PAGE as any, '/tmp/f.md', 'quick', undefined, undefined, 'en')
    expect(en).toContain('Always respond in English')
    const auto = buildPrompt(PAGE as any, '/tmp/f.md', 'quick')
    expect(auto).not.toContain('始终使用中文回答')
    expect(auto).not.toContain('Always respond in English')
  })

  it('instruction 优先于 workflow 正文（默认模式）', async () => {
    // ESM 模块 namespace 只读，不能桩 spawnCli——改为让假 CLI 把收到的 stdin
    // 写到临时文件，跑完读回断言 prompt 内容
    const { AGENTS } = await import('../src/agents/registry.js')
    const dir = await mkdtemp(join(tmpdir(), 'pd-ins-'))
    const echo = join(dir, 'echo.mjs')
    const capFile = join(dir, 'prompt.txt')
    await writeFile(echo, `let d='';process.stdin.on('data',c=>d+=c).on('end',async()=>{
const fs=await import('node:fs');fs.writeFileSync(${JSON.stringify(capFile)},d)
console.log(JSON.stringify({type:'result',is_error:false,result:'ok',usage:{}}))})`)
    const orig = AGENTS[0].buildArgs
    AGENTS[0].bin = 'node'
    AGENTS[0].buildArgs = () => [echo]
    const { task: mk } = makeCbs(); const task = mk('t-ins')
    task.start({ taskId: 't-ins', agentId: 'claude', workflow: 'default', instruction: '列出正文中的公司名', page: PAGE as any })
    task.appendContent(BODY, true)
    await task.run().catch(() => {})
    AGENTS[0].buildArgs = orig
    const prompt = await readFile(capFile, 'utf8')
    expect(prompt).toContain('列出正文中的公司名')
    expect(prompt).not.toContain('5-8 条要点')
    await rm(dir, { recursive: true, force: true })
  }, 30_000)
})
