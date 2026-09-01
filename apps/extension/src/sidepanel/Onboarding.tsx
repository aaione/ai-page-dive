const cmd = 'npm i -g pagedive && pagedive install'

export function Onboarding() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-base font-semibold">还差一步（约 30 秒，仅一次）</h1>
      <p className="text-xs leading-5 text-neutral-500">
        浏览器沙箱不允许扩展直接启动本机程序——这是 Chrome 的安全模型，<br />
        所有需要调用本机 CLI 的扩展（如 1Password）都有这一步。<br />
        装一个官方本地组件即可解锁，装完就不用再管。
      </p>
      <p className="text-xs text-neutral-600">复制这一行到终端执行（需已装 Node.js）：</p>
      <button
        onClick={() => navigator.clipboard.writeText(cmd)}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 font-mono text-xs text-white hover:bg-neutral-700"
        title="点击复制"
      >
        {cmd}
      </button>
      <p className="text-[11px] leading-4 text-neutral-400">
        安装后完全重启 Chrome，再点工具栏图标。
        <br />
        内容只在本机处理，不经过任何服务器。
      </p>
      <button
        onClick={() => location.reload()}
        className="text-xs text-neutral-500 underline hover:text-neutral-800"
      >
        已安装？重新检测
      </button>
    </div>
  )
}
