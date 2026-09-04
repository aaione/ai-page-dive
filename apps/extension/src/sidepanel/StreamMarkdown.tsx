import { memo, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * 流式 markdown：chunk 只入 buffer，trailing 100ms 节流合并重渲染。
 * >64KB 累积文本降级为尾部纯文本预览，done 后一次性完整渲染。
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
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      // snap 到最后一个完整段落/行，避免半截语法树抖动
      const t = bufRef.current
      const cut = Math.max(t.lastIndexOf('\n\n'), t.lastIndexOf('\n'))
      setRendered(cut > 0 ? t.slice(0, cut) : t)
    }, 100)
  }, [text, done])

  // 卸载时清理（不能在主 effect cleanup 里 clearTimeout——那会退化成每次重排）
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  // 用户上滚暂停吸底、滚回底部附近恢复（滚动容器是 .pd-content；scroll 不冒泡，
  // capture 到 window 上监听）
  useEffect(() => {
    if (done) return
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null
      if (el?.classList?.contains('pd-content')) {
        stickyRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => window.removeEventListener('scroll', onScroll, { capture: true })
  }, [done])

  // 流式期间吸底（仅当 sticky）：向上找最近的可滚动祖先（.pd-content 才是滚动
  // 容器，直接 parentElement 是 .pd-chat-assistant——写 scrollTop 是 no-op）
  useEffect(() => {
    if (done || !stickyRef.current) return
    let el: HTMLElement | null = scrollerRef.current
    while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement
    if (el) el.scrollTop = el.scrollHeight
  })

  if (!done && rendered.length > 64 * 1024) {
    return (
      <div ref={scrollerRef}>
        <p className="mb-2 text-[11.5px] leading-[1.9] text-pd-ink-2">（内容较长，完成后完整渲染）</p>
        <pre className="pd-mono whitespace-pre-wrap break-all rounded-[4px] bg-pd-code-bg p-2.5 text-[11.5px] leading-[1.6] text-pd-ink">
          {rendered.slice(-8000)}
        </pre>
      </div>
    )
  }
  return (
    <div ref={scrollerRef} data-done={done ? 'true' : 'false'} className="pd-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{rendered}</ReactMarkdown>
    </div>
  )
})
