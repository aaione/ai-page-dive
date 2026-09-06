import { useEffect, useState } from 'react'

/** 自愈命令：动态带当前扩展 ID——install 幂等 + origins 追加不覆盖 */
const extId = chrome.runtime.id
/** not-installed：host 未装，一条命令通吃「未装 / ID 未登记 / 双缺」（postinstall 被跳过时的兜底） */
const installCmd = `npm i -g ai-page-dive && ai-page-dive install --ext-id ${extId}`
/** forbidden：postinstall 已自动注册 host（origins 为空），只差补登记 */
const registerCmd = `ai-page-dive install --ext-id ${extId}`

export function Onboarding() {
  const [copied, setCopied] = useState(false)
  // forbidden = host 已装但本扩展 ID 不在白名单（只差补登记）；其余按未安装引导
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    const t = setInterval(() => {
      chrome.runtime.sendMessage({ t: 'panel-ready' }, (resp) => {
        void chrome.runtime.lastError
        if (resp?.ok) location.reload()
        else setForbidden(/forbidden/i.test(String(resp?.nmError ?? '')))
      })
    }, 3000)
    // 立即探测一次（不等首个 3s 周期），尽早区分失败类型
    chrome.runtime.sendMessage({ t: 'panel-ready' }, (resp) => {
      void chrome.runtime.lastError
      if (!resp?.ok) setForbidden(/forbidden/i.test(String(resp?.nmError ?? '')))
    })
    return () => clearInterval(t)
  }, [])

  const copy = () => {
    navigator.clipboard.writeText(forbidden ? registerCmd : installCmd).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="pd-onboarding">
      <div className="pd-onboarding-card">
        <h1 className="pd-onboarding-title">
          {forbidden ? '本扩展还未登记到本机组件' : '还差一步（约 30 秒，仅一次）'}
        </h1>
        <p className="pd-onboarding-text">
          {forbidden ? (
            <>
              本机组件已在，但当前扩展的身份（ID）不在它的许可名单里。<br />
              复制下面这行到终端补登记即可（不影响已有数据）。
            </>
          ) : (
            <>
              浏览器沙箱不允许扩展直接启动本机程序——这是 Chrome 的安全模型，<br />
              所有需要调用本机 CLI 的扩展（如 1Password）都有这一步。<br />
              装一个官方本地组件即可解锁，装完就不用再管。
            </>
          )}
        </p>
        <p className="pd-onboarding-label">
          {forbidden ? '复制这一行到终端执行：' : '复制这一行到终端执行（需已装 Node.js）：'}
        </p>
        <button onClick={copy} className="pd-onboarding-cmd" title="点击复制">
          <span className="pd-onboarding-cmd-text">{forbidden ? registerCmd : installCmd}</span>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
            <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
          </svg>
        </button>
        {copied && <p className="pd-onboarding-copied">已复制 ✓</p>}
        <details className="pd-onboarding-faq">
          <summary>命令报错了？</summary>
          <p>
            <code>npm: command not found</code> → 先装 Node.js（
            <a href="https://nodejs.org" target="_blank" rel="noreferrer">nodejs.org</a> 或 <code>brew install node</code>）再重试。
          </p>
          <p>
            <code>EACCES</code> / 权限错误 → 改用 nvm/Homebrew 的 Node 重装（无需 sudo，推荐）；
            或 <code>sudo npm i -g ai-page-dive</code> 后，再以普通用户执行面板上的第二条登记命令。
          </p>
          <p>
            用 <code>pnpm</code>？全局安装默认不执行安装钩子——装完直接执行上面的 <code>ai-page-dive install</code> 部分即可。
          </p>
        </details>
        <p className="pd-onboarding-note">
          终端看到 <code>✅</code> 即回本页，会自动进入（无需重启浏览器）；
          超过 1 分钟未进入，再 ⌘Q 完全退出 Chrome 重开。
          <br />
          <strong>内容只在本机处理，不经过任何服务器。</strong>
        </p>
        <p className="pd-onboarding-note">本页每 3 秒自动检测，装好后自动进入。</p>
        <button onClick={() => location.reload()} className="pd-onboarding-check">
          已安装？立即检测
        </button>
      </div>
    </div>
  )
}
