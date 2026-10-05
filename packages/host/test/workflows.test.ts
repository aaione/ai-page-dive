import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertValidWorkflowName, buildWorkflowMd, parseWorkflow, saveWorkflow } from '../src/workflows.js'
import { parseSkillMd } from '../src/skills.js'

// workflows USER_DIR / skills DIR 均为模块级 homedir() 常量、不可 monkeypatch
// （history.test.ts 有先例注释），故本组以纯函数为主；saveWorkflow 的落盘行为在
// 真实 USER_DIR 下以唯一 pid 命名验证（穿链测试同法，测后即删）。

describe('workflow 纯函数', () => {
  it('buildWorkflowMd → parseWorkflow 往返', () => {
    const md = buildWorkflowMd({
      name: 'my-flow',
      description: '自定义流程',
      category: '研究',
      body: '请输出结构化报告。',
    })
    const wf = parseWorkflow(md, 'my-flow', false)
    expect(wf).toBeDefined()
    expect(wf!.name).toBe('my-flow')
    expect(wf!.description).toBe('自定义流程')
    expect(wf!.category).toBe('研究')
    expect(wf!.builtin).toBe(false)
    expect(wf!.body).toBe('请输出结构化报告。')
  })

  it('无 category 时 frontmatter 不出现 category 行', () => {
    const md = buildWorkflowMd({ name: 'x', description: 'd', body: 'b' })
    expect(md).not.toContain('category')
    expect(parseWorkflow(md, 'x', true)!.category).toBeUndefined()
  })

  it('description 换行被压平（frontmatter 单行防线）', () => {
    const md = buildWorkflowMd({ name: 'x', description: 'a\nb: c', body: 'b' })
    expect(md).toContain('description: a b: c')
  })

  it('parseWorkflow：无 frontmatter / 空正文返回 undefined', () => {
    expect(parseWorkflow('no frontmatter', 'x', false)).toBeUndefined()
    expect(parseWorkflow('---\ndescription: d\n---\n', 'x', false)).toBeUndefined()
  })
})

describe('内置 workflow 数据回归', () => {
  // r9-review：坏 frontmatter 会被 listWorkflows 的 catch 静默吞掉——workflow 直接
  // 从面板消失且无痕；此测试守住 builtins/ 数据完整性（humanize 此前仅手工验证）
  it('builtins/ 每个 WORKFLOW.md 均可解析且 description/body 非空', async () => {
    const dir = fileURLToPath(new URL('../builtins', import.meta.url))
    const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory())
    expect(entries.length).toBeGreaterThanOrEqual(4)
    for (const e of entries) {
      const raw = await readFile(`${dir}/${e.name}/WORKFLOW.md`, 'utf8')
      const wf = parseWorkflow(raw, e.name, true)
      expect(wf, e.name).toBeDefined()
      expect(wf!.description.length, e.name).toBeGreaterThan(0)
      expect(wf!.body.length, e.name).toBeGreaterThan(0)
    }
  })

  it('内置档位集合 = 五档（r53 #18：README/扩展 UI 同谱，增删档位须三处同步）', async () => {
    const dir = fileURLToPath(new URL('../builtins', import.meta.url))
    const names = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    expect(names).toEqual(['deep', 'humanize', 'paper', 'product-audit', 'quick'])
  })
})

describe('saveWorkflow 落盘（真实 USER_DIR 唯一 pid 命名，测后即删）', () => {
  const userDir = join(homedir(), '.ai-page-dive', 'workflows')
  const A = `pd-save-a-${process.pid}`
  const B = `pd-save-b-${process.pid}`
  afterEach(async () => {
    for (const n of [A, B]) await rm(join(userDir, n), { recursive: true, force: true })
  })

  it('新建 wx 占位；不同 originalName 撞已存在名 → 拒且原内容不动（r54 #8 TOCTOU）', async () => {
    await saveWorkflow({ name: A, description: 'd', body: '原创正文' })
    // 模拟并发/另一面板：第二个写者以不同原名撞 A——wx 占位直接拒，第一个的内容完好
    await expect(
      saveWorkflow({ name: A, description: 'd', body: '覆盖者', originalName: B }),
    ).rejects.toThrow('已存在同名用户模式')
    const raw = await readFile(join(userDir, A, 'WORKFLOW.md'), 'utf8')
    expect(raw).toContain('原创正文')
  })

  it('原地覆盖（originalName===name）→ 原子替换，内容完整且无 .tmp 残留', async () => {
    await saveWorkflow({ name: A, description: 'd', body: 'v1' })
    await saveWorkflow({ name: A, description: 'd', body: 'v2 正文', originalName: A })
    const raw = await readFile(join(userDir, A, 'WORKFLOW.md'), 'utf8')
    expect(raw).toContain('v2 正文')
    expect((await readdir(join(userDir, A))).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('r58 #33：副本已删时 originalName===name 转新建 wx——守卫归位，编辑稿落盘不留 tmp', async () => {
    await saveWorkflow({ name: A, description: 'd', body: 'v1' })
    await rm(join(userDir, A, 'WORKFLOW.md')) // 副本被删（另一窗口/面板外）
    // 修复前无条件 tmp+rename：绕过 wx 撞名守卫（r54 #8 旁路）；现走 wx 创建路径
    await saveWorkflow({ name: A, description: 'd', body: '编辑稿', originalName: A })
    expect(await readFile(join(userDir, A, 'WORKFLOW.md'), 'utf8')).toContain('编辑稿')
    expect((await readdir(join(userDir, A))).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('改名保存：新名落盘 + 旧目录删除（防孤儿）', async () => {
    await saveWorkflow({ name: A, description: 'd', body: 'x' })
    await saveWorkflow({ name: B, description: 'd', body: 'x', originalName: A })
    expect(await readFile(join(userDir, B, 'WORKFLOW.md'), 'utf8')).toContain('x')
    await expect(readFile(join(userDir, A, 'WORKFLOW.md'), 'utf8')).rejects.toThrow()
  })
})

describe('listSkills 非法目录名防线（r53 #3）', () => {
  it('中文/非法目录名不进列表（对齐 getSkillBodies 同名校验）', async () => {
    const { listSkills } = await import('../src/skills.js')
    const dir = join(homedir(), '.ai-page-dive', 'skills')
    const bad = `中文技能-${process.pid}`
    await mkdir(join(dir, bad), { recursive: true })
    await writeFile(join(dir, bad, 'SKILL.md'), '---\ndescription: d\n---\n正文', 'utf8')
    try {
      const names = (await listSkills()).map((s) => s.name)
      expect(names).not.toContain(bad)
    } finally {
      await rm(join(dir, bad), { recursive: true, force: true })
    }
  })
})

describe('workflow name 校验', () => {
  it('合法 name 通过', () => {
    expect(() => assertValidWorkflowName('quick')).not.toThrow()
    expect(() => assertValidWorkflowName('my_flow-1')).not.toThrow()
    expect(() => assertValidWorkflowName('a'.repeat(64))).not.toThrow()
  })

  it('拒绝路径穿越与非法字符', () => {
    expect(() => assertValidWorkflowName('../evil')).toThrow()
    expect(() => assertValidWorkflowName('a/b')).toThrow()
    expect(() => assertValidWorkflowName('..')).toThrow()
    expect(() => assertValidWorkflowName('.')).toThrow()
    expect(() => assertValidWorkflowName('')).toThrow()
    expect(() => assertValidWorkflowName('名字')).toThrow()
    expect(() => assertValidWorkflowName('a'.repeat(65))).toThrow()
    expect(() => assertValidWorkflowName('name;rm')).toThrow()
  })
})

describe('skill 解析纯函数', () => {
  it('frontmatter description + 正文', () => {
    const raw = `---
name: style
description: 输出风格指南
---

使用简洁中文。
`
    const s = parseSkillMd(raw, 'style')
    expect(s.description).toBe('输出风格指南')
    expect(s.body).toBe('使用简洁中文。')
  })

  it('description 缺省用目录名；无 frontmatter 整体当正文', () => {
    expect(parseSkillMd('---\n---\n正文', 'my-skill').description).toBe('my-skill')
    const noFm = parseSkillMd('直接正文', 'my-skill')
    expect(noFm.description).toBe('my-skill')
    expect(noFm.body).toBe('直接正文')
  })
})

describe('r59 审计T2：USER_DIR 根存量 0755 收敛（真实 USER_DIR 唯一 pid 命名，测后即删）', () => {
  it('saveWorkflow 把 0755 的 USER_DIR 收敛到 0700', async () => {
    const name = `convroot${process.pid}`
    const userDir = join(homedir(), '.ai-page-dive', 'workflows')
    await mkdir(userDir, { recursive: true })
    await chmod(userDir, 0o755)
    try {
      await saveWorkflow({ name, description: 'd', body: 'x' })
      expect((await stat(userDir)).mode & 0o777, userDir).toBe(0o700)
    } finally {
      await rm(join(userDir, name), { recursive: true, force: true })
    }
  })
})
