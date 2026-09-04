/**
 * 站点适配器打样：Readability 表现差的站点定向提取。
 * v1 只打样 arXiv abs 页；返回 null 走默认管线。
 */
import type { PageContent } from '@ai-page-dive/shared'

type Adapter = (url: URL, doc: Document) => PageContent | null

const arxiv: Adapter = (url, doc) => {
  if (!/^(www\.)?arxiv\.org$/.test(url.hostname)) return null
  if (!/\/abs\//.test(url.pathname)) return null
  const q = (s: string) => doc.querySelector<HTMLElement>(s)?.innerText.trim() ?? ''
  const abstract = q('blockquote.abstract') || q('.abstract')
  const title = q('h1.title') || doc.title
  const authors = q('.authors')
  if (!abstract) return null
  const md = `# ${title}\n\n${authors}\n\n## Abstract\n\n${abstract}`
  return {
    url: url.href,
    title,
    byline: authors.replace(/^Authors:/i, '').trim() || undefined,
    siteName: 'arxiv.org',
    lang: 'en',
    extractor: 'adapter:arxiv',
    contentMarkdown: md,
    approxTokens: Math.ceil(md.length / 4),
  }
}

const ADAPTERS: Adapter[] = [arxiv]

export function applySiteAdapter(href: string, doc: Document): PageContent | null {
  const url = new URL(href)
  for (const a of ADAPTERS) {
    try {
      const r = a(url, doc)
      if (r) return r
    } catch { /* fallthrough */ }
  }
  return null
}
