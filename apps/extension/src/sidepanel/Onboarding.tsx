import { useEffect } from 'react'

const cmd = 'npm i -g pagedive && pagedive install'

export function Onboarding() {
  // 自动轮询 host：装好后无需手点「重新检测」，面板自动就绪
  useEffect(() => {
    const t = setInterval(() => {
      chrome.runtime.sendMessage({ t: 'panel-ready' }, (resp) => {
        void chrome.runtime.lastError
        if (resp?.ok) location.reload()
      })
    }, 3000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center px-6 text-center">
      <div className="pd-glass flex w-full max-w-[300px] flex-col items-center rounded-[16px] p-6">
        <h1 className="pd-serif text-[17px] font-semibold leading-[1.6] text-pd-ink">还差一步（约 30 秒，仅一次）</h1>
        <p className="mt-3 text-xs leading-[2.0] text-pd-ink-2">
          浏览器沙箱不允许扩展直接启动本机程序——这是 Chrome 的安全模型，<br />
          所有需要调用本机 CLI 的扩展（如 1Password）都有这一步。<br />
          装一个官方本地组件即可解锁，装完就不用再管。
        </p>
        <p className="mt-4 text-xs text-pd-ink-2">复制这一行到终端执行（需已装 Node.js）：</p>
        <button
          onClick={() => navigator.clipboard.writeText(cmd)}
          className="mt-2 flex w-full items-center justify-between gap-2 rounded-[8px] bg-pd-primary px-3 py-2 text-left shadow-[0_4px_14px_rgba(47,91,196,0.35)] hover:bg-pd-primary-hover"
          title="点击复制"
        >
          <span className="pd-mono text-xs text-white">{cmd}</span>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
            <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
          </svg>
        </button>
        <p className="mt-4 text-[10.5px] leading-[1.8] text-pd-ink-2">
          装好后 ⌘Q 完全退出 Chrome 再打开（Chrome 只在启动时加载本机组件）。
          <br />
          <span className="font-semibold text-pd-ink">内容只在本机处理，不经过任何服务器。</span>
        </p>
        <p className="mt-3 text-[10.5px] leading-[1.8] text-pd-ink-2">
          本页每 3 秒自动检测，装好后自动进入。
        </p>
        <button
          onClick={() => location.reload()}
          className="mt-3 text-xs text-pd-primary underline hover:text-pd-primary-hover"
        >
          已安装？立即检测
        </button>
      </div>
    </div>
  )
}
