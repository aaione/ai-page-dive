// r57 盲区6：dev harness 漂移守卫。panel 新用 chrome.* API 而 chrome-mock 未跟进时，
// tsc 零感知（mock 是 window as any 挂载）、只有 harness 浏览器里才 TypeError——
// 把爆炸提前到 CI。同款先例：host 侧 task.test.ts 读 protocol.ts 源码锚 MAX_CHUNK。
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

it('chrome-mock 暴露面 ⊇ sidepanel 使用面（r57 盲区6：harness 与 panel API 面不漂移）', () => {
  const used = new Set<string>()
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else for (const m of readFileSync(p, 'utf8').matchAll(/chrome\.(\w+)/g)) used.add(m[1])
    }
  }
  walk(join(here, '../sidepanel'))
  // 挂载对象体（「window as any).chrome」之后）顶层键 = 2 空格缩进行
  const mockSrc = readFileSync(join(here, 'chrome-mock.ts'), 'utf8')
  const mount = mockSrc.slice(mockSrc.indexOf('window as any).chrome'))
  const exposed = new Set([...mount.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]))
  for (const ns of used) {
    expect(exposed.has(ns), `sidepanel 用 chrome.${ns} 但 chrome-mock 未暴露——dev harness 会炸`).toBe(true)
  }
})
