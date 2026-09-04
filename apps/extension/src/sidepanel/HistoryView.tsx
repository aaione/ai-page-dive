import { useEffect, useState } from 'react'
import type { HistoryFileMsg, HistoryItem, HistoryListResultMsg, HostToExt } from '@pagedive/shared'
import { StreamMarkdown } from './StreamMarkdown.js'

export function HistoryView({ onClose, onResume }: { onClose: () => void; onResume: (item: HistoryItem, body: string) => void }) {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [query, setQuery] = useState('')
  const [viewing, setViewing] = useState<HistoryFileMsg | null>(null)
  // 当前查看项对应的列表元数据（含 sessionId）
  const [viewingItem, setViewingItem] = useState<HistoryItem | null>(null)

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
      <div className="pd-history-detail">
        <button onClick={() => setViewing(null)} className="pd-history-back">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3 5 8l5 5" />
          </svg>
          返回列表
        </button>
        <div className="pd-history-detail-content">
          <StreamMarkdown text={body} done />
        </div>
        {viewingItem?.sessionId && (
          <button
            onClick={() => onResume(viewingItem, body)}
            className="pd-history-resume"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.8L14 6M14 2.5V6h-3.5M13.5 8a5.5 5.5 0 0 1-9.5 3.8L2 10M2 13.5V10h3.5" />
            </svg>
            继续对话
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="pd-history">
      <div className="pd-history-header">
        <button onClick={onClose} className="pd-icon-btn" title="关闭历史" aria-label="关闭历史">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
        <svg viewBox="0 0 16 16" className="pd-history-search-icon" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3 3" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && refresh()}
          placeholder="搜索标题 / URL…"
          className="pd-history-input"
        />
        <button onClick={() => refresh()} className="pd-history-search-btn">
          搜
        </button>
      </div>
      <ul className="pd-history-list">
        {items.map((it) => (
          <li key={it.path} className="pd-history-item">
            <button
              onClick={() => {
                setViewingItem(it)
                chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-read', path: it.path } })
              }}
              className="pd-history-item-main"
            >
              <p className="pd-history-item-title">{it.title}</p>
              <p className="pd-history-item-meta pd-mono">
                {it.agent} · {new Date(it.ts).toLocaleString('zh-CN')}
              </p>
            </button>
            <button
              onClick={() => chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-reveal', path: it.path } })}
              className="pd-history-item-action"
              title="在 Finder 中显示"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
              className="pd-history-item-action danger"
              title="删除"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.7 8.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8l.7-8.2M6.7 7v4M9.3 7v4" />
              </svg>
            </button>
          </li>
        ))}
        {!items.length && <p className="pd-history-empty">暂无历史</p>}
      </ul>
    </div>
  )
}