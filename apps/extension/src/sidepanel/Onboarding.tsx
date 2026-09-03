import { useEffect } from 'react'

const cmd = 'npm i -g pagedive && pagedive install'

export function Onboarding() {
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
    <div className="pd-onboarding">
      <div className="pd-onboarding-card">
        <h1 className="pd-onboarding-title">还差一步（约 30 秒，仅一次）</h1>
        <p className="pd-onboarding-text">
          浏览器沙箱不允许扩展直接启动本机程序——这是 Chrome 的安全模型，<br />
          所有需要调用本机 CLI 的扩展（如 1Password）都有这一步。<br />
          装一个官方本地组件即可解锁，装完就不用再管。
        </p>
        <p className="pd-onboarding-label">复制这一行到终端执行（需已装 Node.js）：</p>
        <button
          onClick={() => navigator.clipboard.writeText(cmd)}
          className="pd-onboarding-cmd"
          title="点击复制"
        >
          <span className="pd-onboarding-cmd-text">{cmd}</span>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
            <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
          </svg>
        </button>
        <p className="pd-onboarding-note">
          装好后 ⌘Q 完全退出 Chrome 再打开（Chrome 只在启动时加载本机组件）。
          <br />
          <strong>内容只在本机处理，不经过任何服务器。</strong>
        </p>
        <p className="pd-onboarding-note">
          本页每 3 秒自动检测，装好后自动进入。
        </p>
        <button onClick={() => location.reload()} className="pd-onboarding-check">
          已安装？立即检测
        </button>
      </div>
    </div>
  )
}