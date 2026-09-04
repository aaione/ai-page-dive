import { describe, expect, it } from 'vitest'
import { assertValidWorkflowName, buildWorkflowMd, parseWorkflow } from '../src/workflows.js'
import { parseSkillMd } from '../src/skills.js'

// workflows USER_DIR / skills DIR 均为模块级 homedir() 常量、不可 monkeypatch
// （history.test.ts 有先例注释），故本组只测纯函数；saveWorkflows 的扫描/落盘由集成验证覆盖。

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
