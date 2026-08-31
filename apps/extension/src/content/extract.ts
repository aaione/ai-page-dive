/**
 * 提取管线：Readability → DOMPurify → Turndown(GFM)。
 * activeTab 用户手势触发时经 chrome.scripting.executeScript 注入。
 */
import { Readability } from '@mozilla/readability'
import DOMPurify from 'dompurify'
import TurndownService from 'turndown'
import type { PageContent } from '@pagedive/shared'
import { applySiteAdapter } from './adapters.js'

// SW 经 chrome.tabs.sendMessage 调用（content script 由 SW 动态 files 注入）
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.t === 'extract') {
    sendResponse(extractPage())
  }
})

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
      markdown = td.turndown(html)
    }
    // Readability 失败 → innerText 兜底
    if (!markdown.trim()) {
      markdown = (article?.textContent || document.body.innerText).slice(0, 200_000)
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
