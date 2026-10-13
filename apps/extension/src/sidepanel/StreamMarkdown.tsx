import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** 大文本降级阈值（字符）：超过后不再全量 remark parse（主线程会被秒级卡死） */
const HEAVY = 128 * 1024

/** r25 代码块复制按钮：读 pre 文本写剪贴板，1.5s 已复制态（SVG 图标，禁 emoji）。
 *  r57（#15）：剪贴板被拒时不再谎报 ✓——对齐 Onboarding/SummarizeView 的
 *  copied/copyFail 双态口径（aria-label + title 如实切换） */
function PreWithCopy({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const [copyFail, setCopyFail] = useState(false)
  return (
    <pre ref={ref}>
      {children}
      <button
        type="button"
        className="pd-md-copy"
        aria-label={copied ? '已复制' : copyFail ? '复制失败——请手动选中复制' : '复制代码'}
        title={copied ? '已复制' : copyFail ? '复制失败——请手动选中复制' : '复制代码'}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(ref.current?.textContent ?? '')
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch {
            /* 剪贴板权限被拒/面板失焦：显式失败态，不静默谎报 ✓（r57 #15） */
            setCopyFail(true)
            setTimeout(() => setCopyFail(false), 1500)
          }
        }}
      >
        {copied ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        ) : copyFail ? (
          // r58（#21）：失败态 ✗ icon（r57 #15 口径——title 单独换不够，静音图标让失败不可见）
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--color-pd-danger)' }} aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        )}
      </button>
    </pre>
  )
}

/** 完成段落的 memo 化渲染：props（段落文本）不变即跳过 remark parse。
 * 流式更新只重 parse 尾部活跃段，前文 N 段零开销——长输出的全量重 parse 卡顿消除 */
const Block = memo(function Block({ block }: { block: string }) {
  // 链接新标签页打开（对齐 HistoryView）：面板内导航会顶掉 sidepanel 页丢全部会话态；
  // pre 挂复制按钮、table 外裹横向滚动容器（r25：GFM 宽表在 360px 面板会挤压变形）
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        // r52（review #4）：远程图片是绕过 CLI 网络围栏的泄出通道——codex read-only
        // 沙箱无网络，但 ![](https://…) 会让 panel 替模型发起 GET（查询参数外带）。
        // 一律不渲染；v1 无本地图片场景，不做放行白名单
        img: () => null,
        pre: PreWithCopy,
        table: ({ node, ...props }) => <div className="pd-md-table-wrap"><table {...props} /></div>,
      }}
    >
      {block}
    </ReactMarkdown>
  )
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
    // r78（交互审计 high）：清理必须一并置 null——生产入口 main.tsx 的 StrictMode
    // 模拟卸载后重挂载，主 effect 首行守卫 if (timerRef.current) return 只认引用不认
    // 死活，残留已 clearTimeout 的引用让节流 flush 永久死锁：流式期间零渲染、done
    // 才一次性上屏（单测裸 createRoot 无 StrictMode，此前测不到该形状）
    timerRef.current = null
  }, [])

  // r58（#18）：吸底判定收敛单一来源——本组件曾自带 stickyRef（wheel/key/touch
  // 意图事件判定）+ 每帧拽底，与 SummarizeView 外层的 stickRef（scroll 事件距底
  // 判定）双轨冲突：拖滚动条不产生意图事件，内层停不下来，每个节流帧把 scrollTop
  // 拽回底部。跟随滚动完全由外层负责（HistoryView 恒 done，本就无跟随）

  // 分块：按双换行切，每块以 \n\n 结尾（保留块间空行语义）。rendered snap 到
  // 完整行后，前缀块集合随文本增长只增不改——memo 命中率随长度趋于 100%
  // r58（#36）：必须在 HEAVY early return 之前无条件调用——rendered 跨过阈值时
  // 降级分支提前 return 会让 hooks 数量变化（Rendered fewer hooks → 真机白屏）
  const blocks = useMemo(() => {
    const parts = rendered.split(/(?<=\n\n)/)
    return parts.filter((p) => p !== '')
  }, [rendered])

  // 大文本降级：流式期间与 done 后同标准（done 全量 parse 数百 KB 会冻结面板数秒）
  if (rendered.length > HEAVY) {
    return (
      <div>
        <p className="mb-2 text-[11.5px] leading-[1.9] text-pd-ink-2">
          {/* r57（#5）：下方 slice(-40_000) 实际只渲染末尾 4 万字符——「纯文本显示」
              不点名会让用户以为全文在场。r58（#19）：不再指路「下方下载」——本组件
              也用于 HistoryView（无该按钮），指路对两个使用方都成立的路 */}
          {done
            ? '（内容较长，已切换为纯文本显示——仅显示末尾约 4 万字符；完整内容可经工具栏「下载 markdown」导出，或在本地历史文件中查看）'
            : '（内容较长，完成后纯文本显示）'}
        </p>
        <pre className="pd-mono whitespace-pre-wrap wrap-anywhere rounded-[4px] bg-pd-code-bg p-2.5 text-[11.5px] leading-[1.6] text-pd-ink">
          {rendered.slice(-40_000)}
        </pre>
      </div>
    )
  }

  return (
    <div data-done={done ? 'true' : 'false'} className="pd-md">
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  )
})
