import { useEffect, useRef, useState } from 'react'
import type { HistoryFileMsg, HistoryItem, HistoryListResultMsg, HostToExt } from '@ai-page-dive/shared'
import { StreamMarkdown } from './StreamMarkdown.js'

/** URL → 站点名（favicon 不可用时的来源提示） */
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

export function HistoryView({ onClose, onResume }: { onClose: () => void; onResume: (item: HistoryItem, body: string) => void }) {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [query, setQuery] = useState('')
  // listener 在 [] effect 里注册、捕获首渲染的 refresh（其默认参数 query 恒为 ''）：
  // 搜索态下删除会 stale-refresh 成全量列表，搜索框却仍显示关键词（UI 自相矛盾）。
  // query 入 ref，refresh 读 ref.current 保住过滤上下文
  const queryRef = useRef('')
  queryRef.current = query
  const [viewing, setViewing] = useState<HistoryFileMsg | null>(null)
  // 当前查看项对应的列表元数据（含 sessionId）
  const [viewingItem, setViewingItem] = useState<HistoryItem | null>(null)
  // 在途读取的 path（F10）：回帧 path 不符即丢——「返回后点下一条」时旧帧迟到
  // 会把详情页拽回旧文（正文与 viewingItem 元数据/继续对话错配）
  const pendingPathRef = useRef<string | null>(null)

  // 是否收到过 history-list 回帧（= host 已连接）。首帧到达前 3s 视为加载中；
  // 3s 后仍无回帧 → host 未连接，显示连接提示而非误导性的「暂无历史」
  const [replied, setReplied] = useState(false)
  const [waited, setWaited] = useState(false)
  // 条目读取失败提示（文件被外部删除/权限变化——r3-ux R3-m2：零反馈会让用户
  // 以为「按钮坏了」）：4s 自清
  const [readError, setReadError] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 3000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const listener = (m: HostToExt) => {
      if (m.t === 'history-list') { setItems((m as HistoryListResultMsg).items); setReplied(true) }
      if (m.t === 'history-file') {
        // 只收在途那条的回帧（同 Settings workflow-file 守卫）：迟到旧帧丢掉
        if (pendingPathRef.current && (m as HistoryFileMsg).path !== pendingPathRef.current) return
        setViewing(m as HistoryFileMsg)
      }
      // 读取失败（文件被外部删除/权限变化）：清在途 path + 一次性提示，
      // 不再停留在「点了没反应」（r3-ux R3-m2）
      if (m.t === 'error' && m.code === 'read-fail') {
        pendingPathRef.current = null
        setReadError(true)
        setTimeout(() => setReadError(false), 4000)
      }
      // 删除结果对账：删除是乐观更新（先移出列表），失败必须回滚——
      // host 是事实源，重拉列表即恢复；成功帧也重拉对齐（host 落盘后列表序可能变）
      if (m.t === 'deleted' || (m.t === 'error' && m.code === 'delete-fail')) refresh()
    }
    chrome.runtime.onMessage.addListener(listener)
    refresh()
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  function refresh(q = queryRef.current) {
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-list', query: q || undefined } })
  }

  // 搜索防抖 250ms：host 侧每次查询全量扫盘，每键击触发会让 IO 随历史量线性恶化
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const debouncedRefresh = (q: string) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => refresh(q), 250)
  }

  if (viewing) {
    const body = viewing.content.replace(/^---\n[\s\S]*?\n---\n/, '')
    return (
      <div className="pd-history-detail">
        <button onClick={() => { setViewing(null); pendingPathRef.current = null }} className="pd-history-back">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3 5 8l5 5" />
          </svg>
          返回列表
        </button>
        {viewingItem?.url && (
          <a
            href={viewingItem.url}
            target="_blank"
            rel="noreferrer"
            className="pd-history-source"
            title={viewingItem.url}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="6" />
              <path d="M2 8h12M8 2c2 2.2 2 9.8 0 12M8 2C6 4.2 6 11.8 8 14" />
            </svg>
            <span className="pd-history-source-title">{viewingItem.title || hostOf(viewingItem.url)}</span>
            <span className="pd-history-source-host">{hostOf(viewingItem.url)}</span>
          </a>
        )}
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
        <div className="pd-history-search">
          <svg viewBox="0 0 16 16" className="pd-history-search-icon" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              debouncedRefresh(e.target.value)
            }}
            onKeyDown={(e) => e.key === 'Enter' && refresh()}
            placeholder="搜索标题 / 网址…"
            className="pd-history-input"
            autoFocus
          />
          {query && (
            <button onClick={() => { setQuery(''); refresh('') }} className="pd-history-clear" aria-label="清空搜索">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </button>
          )}
        </div>
        <button onClick={onClose} className="pd-icon-btn" title="关闭历史" aria-label="关闭历史">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      {readError && (
        <p className="pd-history-empty" role="alert" style={{ color: 'var(--color-pd-danger, #c0392b)' }}>
          该记录读取失败（文件可能已被移动或删除）
        </p>
      )}
      <ul className="pd-history-list">
        {items.map((it) => (
          <li key={it.path} className="pd-history-item">
            <button
              onClick={() => {
                setViewingItem(it)
                pendingPathRef.current = it.path
                chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-read', path: it.path } })
              }}
              className="pd-history-item-main"
            >
              <p className="pd-history-item-title">{it.title}</p>
              {it.url && (
                <p className="pd-history-item-url" title={it.url}>
                  {hostOf(it.url)}
                </p>
              )}
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
        {!items.length && (
          // r7-ux：搜索语境区分——「暂无历史」会把有历史但无匹配的用户引向重装排查
          replied ? (
            <p className="pd-history-empty">
              {query.trim() ? `无匹配「${query.trim()}」的历史——换个关键词试试` : '暂无历史'}
            </p>
          )
          : waited ? <p className="pd-history-empty">本机组件未连接，历史暂不可读</p>
          : <p className="pd-history-empty">加载中…</p>
        )}
      </ul>
    </div>
  )
}