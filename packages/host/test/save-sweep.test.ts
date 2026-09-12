import { mkdir, mkdtemp, readdir, rm, unlink, utimes, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// saveWorkflow 落盘测试的隔离（install.test.ts 先例）：USER_DIR 是模块级 homedir()
// 常量——先设 HOME 再动态 import（静态 import 链会在 env 设置前求值模块）
const SANDBOX = await mkdtemp(join(tmpdir(), 'pd-wf-'))
process.env.HOME = SANDBOX
const { saveWorkflow } = await import('../src/workflows.js')
const { writeContentFile } = await import('../src/tmpfile.js')

afterAll(async () => {
  await rm(SANDBOX, { recursive: true, force: true })
})

describe('saveWorkflow 撞名守卫（r4：新建路径此前 host 侧静默覆盖用户原创）', () => {
  it('新建撞已有用户模式名 → 拒绝且原正文不被动过', async () => {
    await saveWorkflow({ name: 'mymode', description: 'd', body: '正文 v1' })
    await expect(saveWorkflow({ name: 'mymode', description: 'd', body: '正文 v2' })).rejects.toThrow(/同名/)
    expect(await readFile(join(SANDBOX, '.ai-page-dive/workflows/mymode/WORKFLOW.md'), 'utf8')).toContain('v1')
  })

  it('原地覆盖自己（originalName===name）→ 放行', async () => {
    await saveWorkflow({ name: 'selfmode', description: 'd', body: 'v1' })
    await saveWorkflow({ name: 'selfmode', description: 'd', body: 'v2', originalName: 'selfmode' })
    expect(await readFile(join(SANDBOX, '.ai-page-dive/workflows/selfmode/WORKFLOW.md'), 'utf8')).toContain('v2')
  })

  it('改名撞他人 → 拒绝；改名到全新名 → 放行', async () => {
    await saveWorkflow({ name: 'modea', description: 'd', body: 'A' })
    await saveWorkflow({ name: 'modeb', description: 'd', body: 'B' })
    await expect(
      saveWorkflow({ name: 'modeb', description: 'd', body: 'A2', originalName: 'modea' }),
    ).rejects.toThrow(/同名/)
    await saveWorkflow({ name: 'modenew', description: 'd', body: 'A3', originalName: 'modea' })
    expect(await readFile(join(SANDBOX, '.ai-page-dive/workflows/modenew/WORKFLOW.md'), 'utf8')).toContain('A3')
  })
})

describe('临时文件启动清扫（r4：unref timer 随 host 退出蒸发，正文无限累积）', () => {
  it('首次写入清扫 >1h 旧文件，新近文件与刚写文件保留', async () => {
    const DIR = join(tmpdir(), 'pagedive')
    await mkdir(DIR, { recursive: true })
    const oldP = join(DIR, 'r4sweep-old.md')
    const newP = join(DIR, 'r4sweep-new.md')
    await writeFile(oldP, 'x')
    await writeFile(newP, 'x')
    const past = new Date(Date.now() - 2 * 3600_000)
    await utimes(oldP, past, past)
    const written = await writeContentFile('r4sweep-task', '内容')
    const names = await readdir(DIR)
    expect(names.some((n) => n.startsWith('r4sweep-old'))).toBe(false)
    expect(names.some((n) => n.startsWith('r4sweep-new'))).toBe(true)
    // 清理现场（sweep 单例已置位，不影响其他用例）
    await Promise.allSettled([unlink(written), unlink(newP)])
  })
})
