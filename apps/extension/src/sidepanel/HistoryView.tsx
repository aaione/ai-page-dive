import { useEffect, useRef, useState } from 'react'
import type { HistoryFileMsg, HistoryItem, HistoryListResultMsg, HostToExt } from '@ai-page-dive/shared'
import { useExitValue } from './motion.js'
import { StreamMarkdown } from './StreamMarkdown.js'

/** URL → 站点名（favicon 不可用时的来源提示） */
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

/** r42-ux：历史保留条数（默认 200；保存语义）——设置页「数据」可调，host 落盘后
 *  清理超限旧文件 + listHistory(limit) 透传列表上限，两处同谱 */
const historyLimit = () => {
  const v = Number(localStorage.getItem('pd-history-limit'))
  return v >= 10 ? v : 200
}

export function HistoryView({
  onClose,
  onResume,
  onOpenSettings,
}: {
  onClose: () => void
  onResume: (item: HistoryItem, body: string) => void
  /** r47-ux：底栏「设置·数据」入口——跳到保留条数调节，不再等满额才看见提示 */
  onOpenSettings?: () => void
}) {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [query, setQuery] = useState('')
  // listener 在 [] effect 里注册、捕获首渲染的 refresh（其默认参数 query 恒为 ''）：
  // 搜索态下删除会 stale-refresh 成全量列表，搜索框却仍显示关键词（UI 自相矛盾）。
  // query 入 ref，refresh 读 ref.current 保住过滤上下文
  const queryRef = useRef('')
  queryRef.current = query
  const [viewing, setViewing] = useState<HistoryFileMsg | null>(null)
  // r35-motion：返回列表先播 150ms 下沉退场再卸载（期间 shown 保持旧值渲染）
  const detail = useExitValue(viewing, 150)
  // 当前查看项对应的列表元数据（含 sessionId）
  const [viewingItem, setViewingItem] = useState<HistoryItem | null>(null)
  // 在途读取的 path（F10）：回帧 path 不符即丢——「返回后点下一条」时旧帧迟到
  // 会把详情页拽回旧文（正文与 viewingItem 元数据/继续对话错配）
  const pendingPathRef = useRef<string | null>(null)
  // r50：列表滚动位保存/恢复——详情态 early return 卸载整个 ul，重挂载 scrollTop
  // 归零，200 条深处浏览每次返回都得重滚（退场 150ms 后列表挂载时回填）
  const listRef = useRef<HTMLUListElement>(null)
  const listScrollRef = useRef(0)

  // 是否收到过 history-list 回帧（= host 已连接）。首帧到达前 3s 视为加载中；
  // 3s 后仍无回帧 → host 未连接，显示连接提示而非误导性的「暂无历史」
  const [replied, setReplied] = useState(false)
  const [waited, setWaited] = useState(false)
  const [slowed, setSlowed] = useState(false)
  // 条目读取失败提示（文件被外部删除/权限变化——r3-ux R3-m2：零反馈会让用户
  // 以为「按钮坏了」）：4s 自清
  const [readError, setReadError] = useState(false)
  // r31-ux：详情在途读取可见（loading 行 + 5s 超时兜底）
  const [reading, setReading] = useState(false)
  // r8-ux：两步删除确认。side panel 的 WebContents 不挂模态对话框宿主，
  // window.confirm 恒返 false 且零反馈——删除按钮等于静默失效。改为面板内
  // 两步：第一次点变「确认删除」，3s 未确认自动还原
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const confirmDelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(confirmDelTimer.current), [])
  const askDelete = (path: string) => {
    if (confirmDel !== path) {
      setConfirmDel(path)
      clearTimeout(confirmDelTimer.current)
      confirmDelTimer.current = setTimeout(() => setConfirmDel(null), 3000)
      return
    }
    clearTimeout(confirmDelTimer.current)
    setConfirmDel(null)
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-delete', path } })
    setItems((xs) => xs.filter((x) => x.path !== path))
  }
  // r31-a11y：Esc 取消删除确认（capture 阶段拦截——先于 overlay 的 Esc 关闭，
  // 有确认态时 Esc 只取消确认、不连历史页一起关）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && confirmDel) {
        e.stopPropagation()
        e.preventDefault()
        clearTimeout(confirmDelTimer.current)
        setConfirmDel(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirmDel])
  // r31-ux：详情在途读取可见 + 超时兜底——host 断连无回帧时不再是「点了没反应」
  // （同 Settings readTimeout 的面板侧防线；错误提示复用 readError 通道）
  const readTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(readTimer.current), [])
  const failRead = () => {
    pendingPathRef.current = null
    setReading(false)
    setReadError(true)
    setTimeout(() => setReadError(false), 4000)
  }
  useEffect(() => {
    // r50：两级反馈——host 冷启动 spawn + 扫盘在历史较多时可超 3s，3s 即报
    // 「未连接」是终态措辞误报（用户被引去排查安装，随后列表又突然刷出）；
    // 3s 先中性「正在连接」，8s 仍无回帧才定性未连接
    const t1 = setTimeout(() => setWaited(true), 3000)
    const t2 = setTimeout(() => setSlowed(true), 8000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])
  // 详情返回（detail 退场 150ms 结束、列表 ul 挂载）恢复滚动位
  useEffect(() => {
    if (!detail.shown && listRef.current) listRef.current.scrollTop = listScrollRef.current
  }, [detail.shown])

  useEffect(() => {
    const listener = (m: HostToExt) => {
      if (m.t === 'history-list') {
        const r = m as HistoryListResultMsg
        // r50：帧回带 query 对账——host 每个请求独立 promise 并发（无队列），正文
        // 全量扫盘的慢查询迟到会覆盖新状态（清空搜索后列表仍是被过滤子集且无自愈）。
        // 旧 host 回帧无 query 字段 → 归一成空串比较，退化为盲收（协议向前修复）
        if ((r.query ?? '') !== queryRef.current) return
        setItems(r.items); setReplied(true)
      }
      if (m.t === 'history-file') {
        // 只收在途那条的回帧（同 Settings workflow-file 守卫）：迟到旧帧丢掉。
        // 严格等值：pendingPath 为 null（已返回列表/切走）时同样拒收——否则迟到
        // 帧会把用户「拽回」详情页（r9-review，原 && 短路使 null 分支放行）
        if ((m as HistoryFileMsg).path !== pendingPathRef.current) return
        clearTimeout(readTimer.current)
        setReading(false)
        setViewing(m as HistoryFileMsg)
      }
      // 读取失败（文件被外部删除/权限变化）：清在途 path + 一次性提示，
      // 不再停留在「点了没反应」（r3-ux R3-m2）。r33：ref 匹配在途 path 才收
      // （旧 host 无 ref 时按旧语义放行——迟到的别条失败不误伤当前等待）
      if (m.t === 'error' && m.code === 'read-fail') {
        if (m.ref === undefined || m.ref === pendingPathRef.current) failRead()
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
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-list', query: q || undefined, limit: historyLimit() } })
  }

  // 搜索防抖 250ms：host 侧每次查询全量扫盘，每键击触发会让 IO 随历史量线性恶化
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const debouncedRefresh = (q: string) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => refresh(q), 250)
  }

  if (detail.shown) {
    const body = detail.shown.content.replace(/^---\n[\s\S]*?\n---\n/, '')
    return (
      <div className={`pd-history-detail${detail.exiting ? ' pd-exiting' : ''}`}>
        <button onClick={() => { setViewing(null); pendingPathRef.current = null }} className="pd-history-back">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3 5 8l5 5" />
          </svg>
          返回列表
        </button>
        {viewingItem?.url && /^https?:/i.test(viewingItem.url) && (
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
            placeholder="搜索标题 / 网址 / 正文…"
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
      {reading && <p className="pd-history-empty">正在读取…</p>}
      {readError && (
        <p className="pd-history-empty" role="alert" style={{ color: 'var(--color-pd-danger)' }}>
          该记录读取失败（文件可能已被移动或删除，或本机组件未响应）
        </p>
      )}
      <ul className="pd-history-list" ref={listRef}>
        {items.map((it, i) => (
          // r34-motion：条目交错浮现——delay 40ms 递进、8 条封顶（长列表尾部不再叠加等待）
          <li key={it.path} className="pd-history-item" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
            <button
              onClick={() => {
                listScrollRef.current = listRef.current?.scrollTop ?? 0
                setViewingItem(it)
                pendingPathRef.current = it.path
                setReading(true)
                clearTimeout(readTimer.current)
                readTimer.current = setTimeout(() => {
                  if (pendingPathRef.current === it.path) failRead()
                }, 5000)
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
              {it.snippet && <p className="pd-history-item-snippet">…{it.snippet}…</p>}
              <p className="pd-history-item-meta">
                {it.agent} · {new Date(it.ts).toLocaleString('zh-CN')}
              </p>
            </button>
            <button
              onClick={() => chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-reveal', path: it.path } })}
              className="pd-history-item-action"
              title="在 Finder 中显示"
              aria-label="在 Finder 中显示"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h2.6l1.2 1.6H13a1.5 1.5 0 0 1 1.5 1.5v5.4A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4.5Z" />
              </svg>
            </button>
            <button
              onClick={() => askDelete(it.path)}
              className={`pd-history-item-action danger${confirmDel === it.path ? ' confirming' : ''}`}
              title={confirmDel === it.path ? '再次点击确认删除' : '删除'}
              aria-label={confirmDel === it.path ? '再次点击确认删除' : '删除'}
            >
              {confirmDel === it.path ? (
                '确认删除'
              ) : (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.7 8.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8l.7-8.2M6.7 7v4M9.3 7v4" />
                </svg>
              )}
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
          : slowed ? <p className="pd-history-empty">本机组件未连接，历史暂不可读</p>
          : waited ? <p className="pd-history-empty">正在连接本机组件…首次打开或历史较多时可能需要数秒</p>
          : <p className="pd-history-empty">加载中…</p>
        )}
      </ul>
      {/* r47-ux：常驻底栏——r42 起默认上限 200，满额才提示等于「几乎永不出现」；
          数量统计 + 设置入口应始终可见（发现性），满额时再加重清理警示 */}
      {replied && items.length > 0 && (
        <p className={`pd-history-truncated${items.length >= historyLimit() && !query.trim() ? ' at-cap' : ''}`}>
          {query.trim()
            ? `匹配 ${items.length} 条`
            : items.length >= historyLimit()
              ? `已达保留上限 ${historyLimit()} 条——更早的已自动清理`
              : `共 ${items.length} 条 · 保留上限 ${historyLimit()}`}
          {onOpenSettings ? (
            <>
              {' · '}
              <button type="button" className="pd-history-truncated-link" onClick={onOpenSettings}>
                设置·数据
              </button>
              {items.length >= historyLimit() && !query.trim() ? '可调大' : '可调'}
            </>
          ) : (
            ' · 设置·数据可调'
          )}
        </p>
      )}
    </div>
  )
}