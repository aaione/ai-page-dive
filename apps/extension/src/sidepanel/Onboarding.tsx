import { useEffect, useRef, useState } from 'react'

/** 自愈命令：动态带当前扩展 ID——install 幂等 + origins 追加不覆盖 */
const extId = chrome.runtime.id
/** not-installed：一条命令通吃（脚本内 Node 探测 + brew 兜底 + npm 安装 + NM 注册） */
const installCmd = `curl -fsSL https://raw.githubusercontent.com/aaione/ai-page-dive/main/install.sh | sh -s -- ${extId}`
/** forbidden：host 已装但本扩展 ID 不在白名单（只差补登记，无需再装） */
const registerCmd = `ai-page-dive install --ext-id ${extId}`

export function Onboarding() {
  const [copied, setCopied] = useState(false)
  // forbidden = host 已装但本扩展 ID 不在白名单（只差补登记）；其余按未安装引导
  const [forbidden, setForbidden] = useState(false)
  // 探测轮询：3s 起步指数退避封顶 15s（每次 probe 都 spawn 冷 node，固定 3s 白烧进程）；
  // 面板隐藏时暂停（side panel 切走即 hidden），重新可见立即探测
  const delayRef = useRef(3000)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // 卡装检测从「用户复制命令」起算 90s（挂载起算会把「用户还没去终端执行」误判为
  // 卡住）。最高频卡点是「装好了但 Chrome 没完全重启」（macOS 关窗口 ≠ 退出）——
  // 把 ⌘Q 指引从小字提权为主提示。
  // 用 Date.now 差值而非累计 delay（快速反复切 tab 会让计划延迟累计虚增，提前误触发）
  const [stuck, setStuck] = useState(false)
  const copiedAtRef = useRef(0)

  useEffect(() => {
    let alive = true
    const probe = () => {
      if (document.visibilityState === 'hidden') return // 可见性恢复时由 visibilitychange 立即触发
      chrome.runtime.sendMessage({ t: 'panel-ready' }, (resp) => {
        void chrome.runtime.lastError
        if (!alive) return
        if (resp?.ok) location.reload()
        else setForbidden(/forbidden/i.test(String(resp?.nmError ?? '')))
        if (copiedAtRef.current && Date.now() - copiedAtRef.current > 90_000) setStuck(true)
        timerRef.current = setTimeout(probe, delayRef.current)
        delayRef.current = Math.min(delayRef.current * 1.6, 15000)
      })
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timerRef.current)
        delayRef.current = 3000
        probe()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    probe() // 立即探测一次，尽早区分失败类型
    return () => {
      alive = false
      clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const copy = () => {
    navigator.clipboard.writeText(forbidden ? registerCmd : installCmd).then(() => {
      copiedAtRef.current = Date.now() // 每次复制刷新计时（重复复制 = 用户还在折腾，stuck 重新起算）
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="pd-onboarding">
      <div className="pd-onboarding-card">
        <h1 className="pd-onboarding-title">
          {forbidden ? '本扩展还未登记到本机组件' : '还差一步（仅此一次；已有 Node 约 1 分钟，需装 Node 约 5-15 分钟）'}
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
          {forbidden ? '复制这一行到终端执行：' : '复制这一行到终端执行（无 Node 也会自动引导安装）：'}
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
            <code>curl</code> 走不了代理/被墙 → 用 npm 方式手动安装：
            <code>npm i -g @aaione/ai-page-dive && ai-page-dive install --ext-id {extId}</code>。
          </p>
          <p>
            <code>EACCES</code> / 权限错误 → 改用 nvm/Homebrew 的 Node 重装（免 sudo；
            <strong>勿用 sudo npm</strong>——root 属主会写坏本机组件注册，后续重装会反复失败）。
          </p>
          <p>
            用 <code>pnpm</code>？全局安装默认不执行安装钩子——装完直接执行面板当前显示的 <code>ai-page-dive install</code> 命令即可。
          </p>
        </details>
        {stuck ? (
          <div className="pd-onboarding-stuck" role="alert">
            <p>
              {forbidden
                ? '复制命令已超过 1 分半仍未生效。登记通常立即生效，多半是 '
                : '复制命令已超过 1 分半仍未检测到安装完成。若终端已显示 🎉 安装完成 但本页未进入，多半是 '}
              <strong>Chrome 未完全重启</strong>（macOS 关闭窗口 ≠ 退出）：
              <br />
              请 <strong>⌘Q 完全退出 Chrome</strong> 再重新打开，然后点下方按钮。
            </p>
          </div>
        ) : (
          <p className="pd-onboarding-note">
            终端看到 <code>🎉 安装完成</code> 后回本页，通常会自动进入；若超过 1 分半未进入，
            多半需完全重启 Chrome（⌘Q，见下方提示）。
            <br />
            <strong>内容只在本机处理，不经过任何服务器。</strong>
          </p>
        )}
        <p className="pd-onboarding-note">本页自动检测（间隔渐放缓至 15 秒），装好后自动进入。</p>
        <button
          onClick={() => {
            // 重置卡装计时：用户主动复检 = 新一轮等待开始（F8）
            setStuck(false)
            copiedAtRef.current = Date.now()
            location.reload()
          }}
          className="pd-onboarding-check"
        >
          已安装 / 已重启？立即检测
        </button>
      </div>
    </div>
  )
}
