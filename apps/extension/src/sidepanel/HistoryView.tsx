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
          className="border-b bg-white px-3 py-1.5 text-left text-xs text-neutral-500 hover:bg-neutral-50"
        >
          ← 返回列表
        </button>
        <div className="flex-1 overflow-y-auto p-3">
          <StreamMarkdown text={body} done />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b bg-white p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && refresh()}
          placeholder="搜索标题 / URL…"
          className="flex-1 rounded border border-neutral-200 px-2 py-1 text-xs outline-none focus:border-neutral-400"
        />
        <button onClick={() => refresh()} className="rounded bg-neutral-900 px-2 py-1 text-xs text-white">
          搜
        </button>
      </div>
      <ul className="flex-1 divide-y divide-neutral-100 overflow-y-auto">
        {items.map((it) => (
          <li key={it.path} className="group flex items-center gap-1 px-3 py-2 hover:bg-neutral-50">
            <button
              onClick={() => chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-read', path: it.path } })}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-xs font-medium">{it.title}</p>
              <p className="truncate text-[11px] text-neutral-400">
                {it.agent} · {new Date(it.ts).toLocaleString('zh-CN')}
              </p>
            </button>
            <button
              onClick={() => chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-reveal', path: it.path } })}
              className="hidden rounded p-1 text-xs text-neutral-400 hover:bg-neutral-200 group-hover:block"
              title="在 Finder 中显示"
            >
              ⌘
            </button>
            <button
              onClick={() => {
                if (confirm('删除这条历史？')) {
                  chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-delete', path: it.path } })
                  setItems((xs) => xs.filter((x) => x.path !== it.path))
                }
              }}
              className="hidden rounded p-1 text-xs text-red-400 hover:bg-red-100 group-hover:block"
              title="删除"
            >
              ✕
            </button>
          </li>
        ))}
        {!items.length && <p className="p-6 text-center text-xs text-neutral-400">暂无历史</p>}
      </ul>
    </div>
  )
}
