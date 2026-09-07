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
  // arXiv 的 h1.title/.authors/blockquote 内含 <span class="descriptor"> 前缀
  // （"Title:" / "Authors:" / "Abstract:"），innerText 会带出——剥掉再拼
  const strip = (s: string, label: string) => s.replace(new RegExp(`^${label}:\\s*`, 'i'), '')
  const abstract = strip(q('blockquote.abstract') || q('.abstract'), 'Abstract')
  const title = strip(q('h1.title') || doc.title, 'Title')
  const authorsRaw = strip(q('.authors'), 'Authors')
  if (!abstract) return null
  const md = [`# ${title}`, authorsRaw && `_${authorsRaw}_`, `## Abstract`, '', abstract]
    .filter((l) => l !== '')
    .join('\n\n')
  return {
    url: url.href,
    title,
    byline: authorsRaw || undefined,
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
