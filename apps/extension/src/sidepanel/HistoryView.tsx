import { useEffect, useState } from 'react'
import type { HistoryFileMsg, HistoryItem, HistoryListResultMsg, HostToExt } from '@pagedive/shared'
import { StreamMarkdown } from './StreamMarkdown.js'

export function HistoryView() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [query, setQuery] = useState('')
  const [viewing, setViewing] = useState<HistoryFileMsg | null>(null)

  useEffect(() => {
    const listener = (m: HostToExt) => {
      if (m.t === 'history-list') setItems((m as HistoryListResultMsg).items)
      if (m.t === 'history-file') setViewing(m as HistoryFileMsg)
    }
    chrome.runtime.onMessage.addListener(listener)
    refresh()
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  function refresh(q = query) {
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-list', query: q || undefined } })
  }

  if (viewing) {
    const body = viewing.content.replace(/^---\n[\s\S]*?\n---\n/, '')
    return (
      <div className="flex h-full flex-col">
        <button
          onClick={() => setViewing(null)}
          className="flex h-9 shrink-0 items-center gap-1.5 border-b border-pd-line bg-pd-bg px-[18px] text-left text-xs text-pd-ink-2 hover:text-pd-ink"
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3 5 8l5 5" />
          </svg>
          ← 返回列表
        </button>
        <div className="flex-1 overflow-y-auto bg-pd-bg px-[18px] py-5">
          <StreamMarkdown text={body} done />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-pd-line bg-pd-bg px-[18px]">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-pd-ink-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3 3" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && refresh()}
          placeholder="搜索标题 / URL…"
          className="h-6 flex-1 border-b border-pd-line bg-transparent pb-1 text-xs text-pd-ink outline-none transition-colors placeholder:text-pd-ink-2 focus:border-pd-primary focus:border-b-2"
        />
        <button
          onClick={() => refresh()}
          className="h-6 shrink-0 rounded-[4px] bg-pd-primary px-2 text-xs font-medium text-white hover:bg-pd-primary-hover"
        >
          搜
        </button>
      </div>
      <ul className="flex-1 divide-y divide-pd-line overflow-y-auto">
        {items.map((it) => (
          <li key={it.path} className="group flex items-center gap-1 px-[18px] py-3 hover:bg-pd-hover">
            <button
              onClick={() => chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-read', path: it.path } })}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-[12.5px] font-medium text-pd-ink">{it.title}</p>
              <p className="pd-mono mt-0.5 truncate text-[10.5px] leading-[1.6] text-pd-ink-2">
                {it.agent} · {new Date(it.ts).toLocaleString('zh-CN')}
              </p>
            </button>
            <button
              onClick={() => chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-reveal', path: it.path } })}
              className="hidden rounded p-1.5 text-pd-ink-2 hover:bg-pd-line group-hover:block"
              title="在 Finder 中显示"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h2.6l1.2 1.6H13a1.5 1.5 0 0 1 1.5 1.5v5.4A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4.5Z" />
              </svg>
            </button>
            <button
              onClick={() => {
                if (confirm('删除这条历史？')) {
                  chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-delete', path: it.path } })
                  setItems((xs) => xs.filter((x) => x.path !== it.path))
                }
              }}
              className="hidden rounded p-1.5 text-pd-ink-2 hover:bg-pd-danger-bg hover:text-pd-danger group-hover:block"
              title="删除"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.7 8.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8l.7-8.2M6.7 7v4M9.3 7v4" />
              </svg>
            </button>
          </li>
        ))}
        {!items.length && <p className="p-6 text-center text-[11.5px] leading-[1.9] text-pd-ink-2">暂无历史</p>}
      </ul>
    </div>
  )
}
