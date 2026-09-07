/**
 * 提取管线：Readability → DOMPurify → Turndown(GFM)。
 * activeTab 用户手势触发时经 chrome.scripting.executeScript 注入。
 */
import { Readability } from '@mozilla/readability'
import DOMPurify from 'dompurify'
import TurndownService from 'turndown'
import type { PageContent } from '@ai-page-dive/shared'
import { applySiteAdapter } from './adapters.js'

/** 正文提取上限（字符）：与 innerText 兜底共用——readability 路径原先无上限，
 * 在线书籍/论坛长帖可产出数 MB 正文（NM 分片放大 + CLI 订阅一次烧穿） */
const MAX_CONTENT = 200_000

/** shadow DOM 文本收集：cloneNode/innerText 都进不去 shadow root，正文整体渲染
 * 在 shadow 里的站点会拿到壳。深度受限防深嵌套 DoS（采集器跑在页面进程里） */
function collectShadowText(root: Element, depth = 0): string {
  if (depth > 20) return ''
  let out = ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let el: Element | null
  while ((el = walker.nextNode() as Element | null)) {
    const sr = (el as HTMLElement).shadowRoot
    if (sr) out += `\n${collectShadowText(sr as unknown as Element, depth + 1)}`
  }
  return out.trim()
}

// SW 经 chrome.tabs.sendMessage 调用（content script 由 SW 动态 files 注入）
// guard：多次注入只挂一个监听器；同时挂到 globalThis 供 SW 的 executeScript(func)
// 直接调用（iframe 聚合提取路径，绕开 tabs.sendMessage 只达 top frame 的限制）
if (!(globalThis as any).__pagediveInjected) {
  ;(globalThis as any).__pagediveInjected = true
  ;(globalThis as any).__pagediveExtract = extractPage
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.t === 'extract') {
      sendResponse(extractPage())
    }
  })
}

/** HTML table → GFM markdown（turndown 核心不带表格规则） */
function turndownTable(table: HTMLTableElement): string {
  // closest 过滤：只取本表的行——querySelectorAll('tr') 是后代选择器，
  // 嵌套表格的内层行会被平铺进外层（列错位/语义污染）
  const rows = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table)
  if (!rows.length) return ''
  const cells = rows.map((tr) =>
    [...tr.querySelectorAll('th,td')]
      .filter((c) => c.closest('tr') === tr || c.closest('table') === table)
      .map((c) => (c.textContent ?? '').trim().replace(/\|/g, '\\|').replace(/\n/g, ' ')),
  )
  const line = (cs: string[]) => `| ${cs.join(' | ')} |`
  const [head, ...body] = cells
  if (!head?.length) return ''
  // 列数对齐到 max（colspan/列数不齐的表直接渲染会破 GFM 结构）
  const width = Math.max(...cells.map((r) => r.length))
  const pad = (cs: string[]) => { while (cs.length < width) cs.push(''); return cs }
  const out = [line(pad([...head])), `| ${head.map(() => '---').join(' | ')} |`]
  for (const r of body) out.push(line(pad([...r])))
  return out.join('\n') + '\n'
}

export function extractPage(): PageContent | { error: string } {
  try {
    const adapted = applySiteAdapter(location.href, document)
    if (adapted) return adapted

    const docClone = document.cloneNode(true) as Document
    const article = new Readability(docClone).parse()
    const html = DOMPurify.sanitize(article?.content || '', {
      FORBID_TAGS: ['script', 'style', 'noscript'],
    })
    let markdown = ''
    if (html) {
      const td = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
      })
      // ponytail: 表格是 GFM 最重要的块，自写规则（不引 turndown-plugin-gfm 全家桶）
      td.addRule('table', {
        filter: ['table'],
        replacement: (_content, node) => turndownTable(node as HTMLTableElement),
      })
      td.remove(['thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col'])
      markdown = td.turndown(html)
    }
    // Readability 失败/空壳（cloneNode 不克隆 shadow DOM——正文在 shadow root 里的
    // 站点 Readability 拿到的是壳）→ 正文全文逐字兜底，截断防数 MB 正文烧穿订阅
    if (!markdown.trim()) {
      const shadowText = collectShadowText(document.body)
      const source = article?.textContent || shadowText || document.body.innerText
      markdown = source.slice(0, MAX_CONTENT)
    } else if (markdown.length > MAX_CONTENT) {
      markdown = markdown.slice(0, MAX_CONTENT)
    }
    if (!markdown.trim()) return { error: 'empty-content' }

    return {
      url: location.href,
      title: article?.title || document.title,
      byline: article?.byline || undefined,
      publishedTime: article?.publishedTime || undefined,
      siteName: article?.siteName || undefined,
      lang: document.documentElement.lang || undefined,
      extractor: article?.content ? 'readability' : 'innertext',
      contentMarkdown: markdown,
      approxTokens: Math.ceil(markdown.length / 4),
    }
  } catch (e: any) {
    return { error: String(e?.message ?? e) }
  }
}
