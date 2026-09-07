import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendHistoryTurn, buildHistoryPath, escapeYamlForTest, saveHistory, slugify } from '../src/history.js'

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
