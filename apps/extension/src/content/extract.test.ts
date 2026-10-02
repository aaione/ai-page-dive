// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://example.com/article/1" }
// r54：extractPage 三种 DOM 形状 + 注入 guard 此前零单测（真机行为全靠 e2e 兜）——
// jsdom 下锚 readability 正常路径 / shadow DOM 兜底 / 超长截断三条主链
import { describe, expect, it } from 'vitest'
import { extractPage } from './extract.js'

/** 每测重置文档：lang/title 直设，body 经 template 解析后整体换树
 *  （document.write 的 reopen 语义在 jsdom 下跨用例不稳——首测后清不干净） */
function loadHtml(title: string, body: string) {
  document.documentElement.lang = 'zh'
  document.title = title
  const t = document.createElement('template')
  t.innerHTML = body
  document.body.replaceChildren(t.content)
}

describe('extractPage（jsdom 三形状）', () => {
  it('readability 正常路径：结构化 markdown + 元数据 + 脚本剥除', () => {
    loadHtml(
      '深度长文标题',
      `<article>
          <h1>深度长文标题</h1>
          <p>${'正文段落。'.repeat(40)}</p>
          <ul><li>要点一</li><li>要点二</li></ul>
          <p>${'更多正文内容继续填充以提高 readability 置信。'.repeat(40)}</p>
          <script>alert('evil')</script>
        </article>`,
    )
    const r = extractPage()
    expect(r).not.toHaveProperty('error')
    const page = r as Exclude<ReturnType<typeof extractPage>, { error: string }>
    // readability 命中：结构化路径而非 innerText 兜底
    expect(page.extractor).toBe('readability')
    expect(page.title).toBe('深度长文标题')
    expect(page.lang).toBe('zh')
    // markdown 化：标题/列表进入输出；DOMPurify FORBID 的 script 不进正文
    expect(page.contentMarkdown).toContain('# ')
    expect(page.contentMarkdown).toContain('要点一')
    expect(page.contentMarkdown).not.toContain('alert(')
    // token 估算口径：ceil(len/4)
    expect(page.approxTokens).toBe(Math.ceil(page.contentMarkdown.length / 4))
    expect(page.notice).toBeUndefined()
  })

  it('shadow DOM 正文：readability 拿壳 → collectShadowText 兜底 + 低置信提示', () => {
    // 光 DOM 纯壳（无任何候选块）——Readability 必须空手，正文只在 shadow root 里
    loadHtml('壳页标题', '<div id="host"></div>')
    const host = document.getElementById('host')!
    const sr = host.attachShadow({ mode: 'open' })
    sr.append(document.createElement('p'))
    sr.querySelector('p')!.textContent = '影子里的正文内容。'.repeat(10)
    const r = extractPage()
    const page = r as Exclude<ReturnType<typeof extractPage>, { error: string }>
    // cloneNode 不克隆 shadow root → Readability 空 → 逐字兜底链
    expect(page.extractor).toBe('innertext')
    expect(page.contentMarkdown).toContain('影子里的正文内容')
    expect(page.notice).toContain('结构解析失败')
  })

  it('超长正文：200k 字符上限截断 + 提示透出', () => {
    loadHtml(
      '长文',
      `<article><h1>长文</h1>${Array.from({ length: 900 }, (_, i) => `<p>第${i}段——${'字'.repeat(300)}</p>`).join('')}</article>`,
    )
    const r = extractPage()
    const page = r as Exclude<ReturnType<typeof extractPage>, { error: string }>
    expect(page.contentMarkdown.length).toBe(200_000)
    expect(page.notice).toMatch(/超上限，仅取前 200,000/)
    expect(page.approxTokens).toBe(50_000)
  })

  it('注入 guard：__pagediveExtract 挂载且指向同一实现（SW 重复注入幂等基座）', () => {
    expect((globalThis as { __pagediveExtract?: unknown }).__pagediveExtract).toBe(extractPage)
  })
})
