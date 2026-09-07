import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Task, attachSection, buildOutline, buildPrompt, expandWorkflowPlaceholders } from '../src/task.js'

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

  it('CJK 大 delta 按 UTF-8 字节切片：单片不超 NM 上限', async () => {
    // 40 万汉字单条 text-delta：按字符切（旧实现）单片 512K 字符 = ~1.5MB 超 NM 1MB；
    // 按字节切应分 3 片且每片 UTF-8 ≤512KB。直接驱动（不 spawn）：append 后调私有路径
    // 太绕——用 result 兜底路径（codex 风格）等价覆盖 sendChunk
    const { AGENTS } = await import('../src/agents/registry.js')
    const bigText = '深'.repeat(400_000)
    const dir = await mkdtemp(join(tmpdir(), 'pd-fake-'))
    const script = join(dir, 'cli.mjs')
    await writeFile(script, `console.log(JSON.stringify({type:'result',is_error:false,result:${JSON.stringify(bigText)}}))`, 'utf8')
    AGENTS[0].bin = 'node'
    const orig = AGENTS[0].buildArgs
    AGENTS[0].buildArgs = () => [script]
    const { task: mk, cbs } = makeCbs(); const task = mk()
    task.start({ taskId: 't-cjk', agentId: 'claude', workflow: 'quick', page: PAGE as any })
    task.appendContent(BODY, true)
    await task.run()
    await new Promise(r => setTimeout(r, 200))

    expect(cbs.chunks.length).toBeGreaterThanOrEqual(2)
    for (const [text] of cbs.chunks) {
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(512 * 1024)
    }
    expect(cbs.chunks.map(c => c[0]).join('')).toBe(bigText)
    AGENTS[0].buildArgs = orig
    if (cbs.done?.historyPath) await rm(cbs.done.historyPath, { force: true }).catch(() => {})
    await rm(dir, { recursive: true, force: true })
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

  it('expandWorkflowPlaceholders：四占位符展开，未知/大小写变体原样保留', () => {
    const out = expandWorkflowPlaceholders(
      '看 {url} 和 {title}，正文在 {file}，元数据 {meta}；未知 {foo} 与 {URL} 不动',
      PAGE as any,
      '/tmp/f.md',
    )
    expect(out).toContain('https://a.com/x')
    expect(out).toContain('T') // title
    expect(out).toContain('/tmp/f.md')
    expect(out).toContain('标题: T')
    expect(out).toContain('{foo}')
    expect(out).toContain('{URL}')
    expect(out).not.toContain('{url}')
    expect(out).not.toContain('{file}')
  })

  it('buildOutline：H1-H3 层级缩进，60 条/2000 字符截断，无标题返回空串', () => {
    const md = ['# 一级', '正文', '## 二级', '### 三级', '#### 四级不收', '普通 # 行内不匹配'].join('\n')
    const outline = buildOutline(md)
    expect(outline).toBe('- 一级\n  - 二级\n    - 三级')
    expect(buildOutline('没有标题的正文')).toBe('')
    // 截断：65 个 H1 条目只收 60 条
    const many = Array.from({ length: 70 }, (_, i) => `# 标题${i}`).join('\n')
    expect(buildOutline(many).split('\n')).toHaveLength(60)
    // 代码围栏内的 # 注释不算标题；围栏外的正常收
    const fenced = ['# 引言', '```bash', '# 这是 bash 注释不是标题', 'npm i -g ai-page-dive', '```', '## 方法'].join('\n')
    expect(buildOutline(fenced)).toBe('- 引言\n  - 方法')
    // 长文不因行数上限截断（400 行上限已移除，靠 60 条/2000 字符硬截断）
    const longBody = Array.from({ length: 500 }, () => '正文段落').join('\n')
    expect(buildOutline(longBody + '\n# 深处标题')).toBe('- 深处标题')
  })

  it('buildPrompt：outline 非空注入「正文导航」段，空/缺省不注入', () => {
    const withOutline = buildPrompt(PAGE as any, '/tmp/f.md', 'quick', undefined, undefined, undefined, '- 引言\n  - 方法')
    expect(withOutline).toContain('## 正文导航')
    expect(withOutline).toContain('- 引言')
    const without = buildPrompt(PAGE as any, '/tmp/f.md', 'quick')
    expect(without).not.toContain('## 正文导航')
    expect(buildPrompt(PAGE as any, '/tmp/f.md', 'quick', undefined, undefined, undefined, '')).not.toContain('## 正文导航')
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

  it('附件段落盘路径 + 追问轮前缀拼装', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pd-att-'))
    const echo = join(dir, 'echo.mjs')
    const capFile = join(dir, 'prompt.txt')
    await writeFile(echo, `let d='';process.stdin.on('data',c=>d+=c).on('end',async()=>{
const fs=await import('node:fs');fs.writeFileSync(${JSON.stringify(capFile)},d)
console.log(JSON.stringify({type:'result',is_error:false,result:'ok',usage:{}}))})`)
    const { AGENTS } = await import('../src/agents/registry.js')
    const orig = AGENTS[0].buildArgs
    AGENTS[0].bin = 'node'
    AGENTS[0].buildArgs = () => [echo]
    // 追问轮：instruction 前拼附件段
    const { task: mk } = makeCbs(); const task = mk('t-att')
    task.start({
      taskId: 't-att', agentId: 'claude', resumeSessionId: 's1', instruction: '结合附件回答',
      attachments: [{ name: '数据.md', text: '销售额：100 万' }],
      page: PAGE as any,
    })
    task.appendContent('', true)
    await task.run().catch(() => {})
    AGENTS[0].buildArgs = orig
    const prompt = await readFile(capFile, 'utf8')
    expect(prompt).toContain('## 附件')
    expect(prompt).toContain('数据.md')
    expect(prompt.endsWith('结合附件回答')).toBe(true)
    // 纯函数：空附件返回空串
    expect(attachSection([])).toBe('')
    expect(attachSection(undefined)).toBe('')
    await rm(dir, { recursive: true, force: true })
  }, 30_000)
})

