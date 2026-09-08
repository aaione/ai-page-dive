import { memo, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** 大文本降级阈值（字符）：超过后不再全量 remark parse（主线程会被秒级卡死） */
const HEAVY = 128 * 1024

/** 完成段落的 memo 化渲染：props（段落文本）不变即跳过 remark parse。
 * 流式更新只重 parse 尾部活跃段，前文 N 段零开销——长输出的全量重 parse 卡顿消除 */
const Block = memo(function Block({ block }: { block: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{block}</ReactMarkdown>
})

/**
 * 流式 markdown：chunk 只入 buffer，trailing 节流合并重渲染（文本越长间隔越大）。
 * 渲染按双换行切分为「已完成段落块」：每块独立 memo 化，流式期间只有尾部活跃块
 * 重 parse。超阈值降级为尾部纯文本预览；done 且仍超阈值时保持降级 + 提示。
 */
export const StreamMarkdown = memo(function StreamMarkdown({
  text,
  done,
}: {
  text: string
  done: boolean
}) {
  const [rendered, setRendered] = useState('')
  const bufRef = useRef(text)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  // 吸底开关：用户上滚即停，滚回底部恢复（不打断回看前文）
  const stickyRef = useRef(true)

  bufRef.current = text

  useEffect(() => {
    if (done) {
      if (timerRef.current) clearTimeout(timerRef.current)
      setRendered(text)
      return
    }
    // trailing throttle：timer 已排定就不重排，到期自然 flush（高频 chunk 不饿死渲染）
    if (timerRef.current) return
    // 动态间隔：只有尾部活跃块会重 parse，长文本间隔不再需要激进拉大
    const interval = text.length > 96 * 1024 ? 300 : text.length > 48 * 1024 ? 200 : 100
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      // snap 到最后一个完整段落/行，避免半截语法树抖动
      const t = bufRef.current
      const cut = Math.max(t.lastIndexOf('\n\n'), t.lastIndexOf('\n'))
      setRendered(cut > 0 ? t.slice(0, cut) : t)
    }, interval)
  }, [text, done])

  // 卸载时清理（不能在主 effect cleanup 里 clearTimeout——那会退化成每次重排）
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  // 用户上滚暂停吸底、滚回底部附近恢复。用 wheel/keydown 等用户意图事件判定方向，
  // 不用 scroll 事件——程序化 snap 自己触发的 scroll 无法与用户滚动区分，
  // 会把吸底重新点燃并掐断触控板惯性滚动
  useEffect(() => {
    if (done) return
    const userUp = () => { stickyRef.current = false }
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) stickyRef.current = false
      if (['ArrowDown', 'PageDown', 'End'].includes(e.key)) stickyRef.current = true
    }
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) userUp()
      else stickyRef.current = true
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('keydown', onKey)
    // 触控板轻扫不走 wheel？macOS Chrome 走；触摸屏兜底 touchstart 方向判定
    let touchY = 0
    const onTouchStart = (e: TouchEvent) => { touchY = e.touches[0]?.clientY ?? 0 }
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0
      if (y > touchY + 4) stickyRef.current = false // 手指下移 = 内容上滚（看前文）
      else if (y < touchY - 4) stickyRef.current = true
      touchY = y
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
    }
  }, [done])

  // 流式期间吸底（仅当 sticky）：向上找最近的可滚动祖先（.pd-content 才是滚动
  // 容器，直接 parentElement 是 .pd-chat-assistant——写 scrollTop 是 no-op）
  useEffect(() => {
    if (done || !stickyRef.current) return
    let el: HTMLElement | null = scrollerRef.current
    while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement
    if (el) el.scrollTop = el.scrollHeight
  })

  // 大文本降级：流式期间与 done 后同标准（done 全量 parse 数百 KB 会冻结面板数秒）
  if (rendered.length > HEAVY) {
    return (
      <div ref={scrollerRef}>
        <p className="mb-2 text-[11.5px] leading-[1.9] text-pd-ink-2">
          {done ? '（内容较长，已切换为纯文本显示——完整 markdown 可用下方「下载」保存）' : '（内容较长，完成后纯文本显示）'}
        </p>
        <pre className="pd-mono whitespace-pre-wrap break-all rounded-[4px] bg-pd-code-bg p-2.5 text-[11.5px] leading-[1.6] text-pd-ink">
          {rendered.slice(-40_000)}
        </pre>
      </div>
    )
  }

  // 分块：按双换行切，每块以 \n\n 结尾（保留块间空行语义）。rendered snap 到
  // 完整行后，前缀块集合随文本增长只增不改——memo 命中率随长度趋于 100%
  const blocks = useMemo(() => {
    const parts = rendered.split(/(?<=\n\n)/)
    return parts.filter((p) => p !== '')
  }, [rendered])

  return (
    <div ref={scrollerRef} data-done={done ? 'true' : 'false'} className="pd-md">
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  )
})
