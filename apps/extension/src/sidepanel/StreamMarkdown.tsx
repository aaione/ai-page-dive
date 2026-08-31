import { memo, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * 流式 markdown：chunk 只入 buffer，100ms 节流合并重渲染。
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

  bufRef.current = text

  useEffect(() => {
    if (done) {
      if (timerRef.current) clearTimeout(timerRef.current)
      setRendered(text)
      return
    }
    if (timerRef.current) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      // snap 到最后一个完整段落/行，避免半截语法树抖动
      const t = bufRef.current
      const cut = Math.max(t.lastIndexOf('\n\n'), t.lastIndexOf('\n'))
      setRendered(cut > 0 ? t.slice(0, cut) : t)
    }, 100)
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [text, done])

  // 流式期间吸底
  useEffect(() => {
    const el = scrollerRef.current?.parentElement
    if (el && !done) el.scrollTop = el.scrollHeight
  })

  if (!done && rendered.length > 64 * 1024) {
    return (
      <div ref={scrollerRef}>
        <p className="mb-2 text-[11px] text-neutral-400">（内容较长，完成后完整渲染）</p>
        <pre className="whitespace-pre-wrap break-all text-xs text-neutral-600">
          {rendered.slice(-8000)}
        </pre>
      </div>
    )
  }
  return (
    <div ref={scrollerRef} className="prose-sm max-w-none text-sm leading-relaxed [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-neutral-100 [&_pre]:p-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{rendered}</ReactMarkdown>
    </div>
  )
})
