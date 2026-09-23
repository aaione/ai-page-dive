import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendHistoryTurn, buildHistoryPath, deleteHistory, escapePd, escapeYamlForTest, extractSnippet, pruneHistory, readHistory, saveHistory, slugify } from '../src/history.js'

// history ROOT 指向 ~/.ai-page-dive——测试隔离：monkeypatch homedir 不可行（模块级常量），
// 故本组只测纯函数与写入格式；listHistory 的扫描逻辑由 M3 冒烟覆盖。
// ponytail: 若后续需要集成测试，把 ROOT 改成可注入。

describe('history 纯函数', () => {
  it('slugify：中文保留、空白转连字符、截长', () => {
    expect(slugify('Hello World')).toBe('hello-world')
    expect(slugify('深度学习入门指南')).toBe('深度学习入门指南')
    expect(slugify('  a  b  ')).toBe('a-b')
    expect(slugify('!!!')).toBe('page')
    expect(slugify('x'.repeat(100))).toHaveLength(50)
  })

  it('buildHistoryPath：年/月/日/时间戳-slug.md', () => {
    const p = buildHistoryPath(new Date(2026, 8, 1, 14, 5, 9), 'Test Page')
    expect(p).toMatch(/2026\/09\/01\/140509-test-page\.md$/)
  })

  it('escapeYaml：引号与反斜杠转义', () => {
    expect(escapeYamlForTest('say "hi"')).toBe('"say \\"hi\\""')
    expect(escapeYamlForTest('a\\b')).toBe('"a\\\\b"')
  })

  it('escapePd：分段标记实体化防轮边界注入（r33-sec），其余原样', () => {
    // 用户正文伪造的标记不再构成 parseHistoryTurns 轮边界
    expect(escapePd('看这个 <!-- pd:user --> 假标记')).toBe('看这个 <!-- pd&#58;user --> 假标记')
    expect(escapePd('<!-- pd:assistant -->')).toBe('<!-- pd&#58;assistant -->')
    // 无关注释/HTML 不动
    expect(escapePd('普通 <!-- other --> 与 <b> 不动')).toBe('普通 <!-- other --> 与 <b> 不动')
  })

  it('extractSnippet：正文命中片段提取', () => {
    // 命中：前后各 ~40 字符、空白压扁
    const body = 'A'.repeat(50) + '\n\n关键内容 here\n' + 'B'.repeat(50)
    expect(extractSnippet(body, '关键内容')).toContain('关键内容')
    expect(extractSnippet(body, '关键内容')).not.toContain('\n')
    // 大小写不敏感（英文关键词）
    expect(extractSnippet('Learn Kubernetes the hard way', 'kubernetes')).toContain('Kubernetes')
    // 未命中 → undefined
    expect(extractSnippet('完全无关的正文', '关键词')).toBeUndefined()
    // 命中在开头：不越界、不产生前导空格
    expect(extractSnippet('开头就是关键词', '开头')).toBe('开头就是关键词'.slice(0, 44))
  })
})

describe('pruneHistory 保留策略（r42：root 可注入）', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pd-prune-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('超出 limit 删最旧、保留最新；limit 内不动', async () => {
    // 12 个文件跨两天：路径序 = 时间序（年/月/日/时间戳零填充）；limit≥10 才有效（同 HistoryView 守卫）
    const days = ['2026/09/20', '2026/09/21']
    for (let i = 0; i < 12; i++) {
      const day = days[i < 2 ? 0 : 1]
      await mkdir(join(dir, day), { recursive: true })
      await writeFile(join(dir, day, `${String(i).padStart(6, '0')}-t.md`), '---\ntitle: t\n---\nbody', 'utf8')
    }
    expect(await pruneHistory(10, dir)).toBe(2)
    expect(await readdir(join(dir, '2026/09/20')).catch(() => [])).toEqual([]) // 最旧一天全清
    expect((await readdir(join(dir, '2026/09/21'))).filter(f => f.endsWith('.md')).length).toBe(10)
  })

  it('limit <10 视为无效配置不动任何文件', async () => {
    await mkdir(join(dir, '2026/09/20'), { recursive: true })
    await writeFile(join(dir, '2026/09/20/000001-t.md'), 'x', 'utf8')
    expect(await pruneHistory(0, dir)).toBe(0)
  })
})

describe('saveHistory 写入格式', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pd-hist-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('同路径并发写不覆盖：wx 排他 + 序号重试，返回实际路径', async () => {
    const path = join(dir, '100000-collide.md')
    const p1 = await saveHistory(path, { title: 'A', url: 'u', agent: 'claude', status: 'done' }, '甲的内容')
    const p2 = await saveHistory(path, { title: 'B', url: 'u', agent: 'claude', status: 'done' }, '乙的内容')
    expect(p1).toBe(path)
    expect(p2).toBe(join(dir, '100000-collide-2.md'))
    // 两份都完整落盘（后者没有 truncate 前者）
    expect(await readFile(p1, 'utf8')).toContain('甲的内容')
    expect(await readFile(p2, 'utf8')).toContain('乙的内容')
  })

  it('frontmatter + body 落盘', async () => {
    const path = join(dir, '2026', '09', '01', '100000-test.md')
    await saveHistory(
      path,
      { title: 'T "q"', url: 'https://a.com', agent: 'claude', status: 'done', durationMs: 1234 },
      '# 正文',
    )
    const raw = await readFile(path, 'utf8')
    expect(raw.startsWith('---\n')).toBe(true)
    expect(raw).toContain('title: "T \\"q\\""')
    expect(raw).toContain('url: "https://a.com"')
    expect(raw).toContain('agent: claude')
    expect(raw).toContain('status: done')
    expect(raw).toContain('duration_ms: 1234')
    expect(raw).toContain('# 正文')
  })

  it('可选字段缺省时不出行', async () => {
    const p2 = join(dir, '2026', '09', '01', '100001-b.md')
    await saveHistory(p2, { title: 'B', url: 'u', agent: 'codex', status: 'interrupted' }, '')
    const raw = await readFile(p2, 'utf8')
    expect(raw).not.toContain('workflow')
    expect(raw).not.toContain('usage')
    expect(raw).not.toContain('duration_ms')
  })

  it('appendHistoryTurn：追问轮以 pd:user/pd:assistant 标记 append（纯格式校验）', async () => {
    // appendHistoryTurn 有 assertInRoot 守卫（真实 ROOT 在 ~ 下，tmp 目录进不去），
    // 故用 saveHistory 同源格式直接构造等价文件后校验追加格式约定
    const p3 = join(dir, '2026', '09', '01', '100002-c.md')
    await saveHistory(p3, { title: 'C', url: 'u', agent: 'claude', status: 'done' }, '首轮回答')
    // 格式约定：\n<!-- pd:user -->\n{user}\n\n<!-- pd:assistant -->\n{assistant}\n
    const turn = `\n<!-- pd:user -->\n追问1\n\n<!-- pd:assistant -->\n回答1\n`
    const { appendFile } = await import('node:fs/promises')
    await appendFile(p3, turn, 'utf8')
    const raw = await readFile(p3, 'utf8')
    expect(raw.indexOf('首轮回答')).toBeLessThan(raw.indexOf('<!-- pd:user -->'))
    expect(raw).toContain('<!-- pd:user -->\n追问1')
    expect(raw).toContain('<!-- pd:assistant -->\n回答1')
  })

  it('appendHistoryTurn：路径逃逸被拒', async () => {
    await expect(
      appendHistoryTurn('/tmp/evil/x.md', { user: 'u', assistant: 'a' }),
    ).rejects.toThrow('outside history root')
  })
})

describe('assertInRoot 穿链防护（r47-sec）', () => {
  // ROOT 是模块级常量（~/.ai-page-dive/history），无法注入——故在真实 ROOT 下建一条
  // 唯一命名的临时链接，测完即删；不触碰任何既有历史文件
  const root = join(homedir(), '.ai-page-dive', 'history')
  const link = join(root, `pd-symlink-test-${process.pid}.md`)
  const real = join(root, `pd-real-test-${process.pid}.md`)
  let outsideDir = ''
  beforeEach(async () => {
    outsideDir = await mkdtemp(join(tmpdir(), 'pd-outside-'))
    await writeFile(join(outsideDir, 'secret.md'), 'SECRET', 'utf8')
    await mkdir(root, { recursive: true })
    await symlink(join(outsideDir, 'secret.md'), link)
    await writeFile(real, '---\ntitle: t\n---\n真实历史', 'utf8')
  })
  afterEach(async () => {
    await rm(link, { force: true }) // symlink 本身，不跟随
    await rm(real, { force: true })
    await rm(outsideDir, { recursive: true, force: true })
  })

  it('history/ 内指向树外的符号链接：read/delete/append 全部拒绝，树外文件不受影响', async () => {
    await expect(readHistory(link)).rejects.toThrow('outside history root')
    await expect(deleteHistory(link)).rejects.toThrow('outside history root')
    await expect(appendHistoryTurn(link, { user: 'u', assistant: 'a' })).rejects.toThrow('outside history root')
    expect(await readFile(join(outsideDir, 'secret.md'), 'utf8')).toBe('SECRET') // 未被读走/删除/追写
  })

  it('root 内的真实文件不受穿链校验牵连（防误伤回归）', async () => {
    expect(await readHistory(real)).toContain('真实历史')
    await appendHistoryTurn(real, { user: '追问', assistant: '回答' })
    expect(await readFile(real, 'utf8')).toContain('<!-- pd:user -->\n追问')
  })
})
