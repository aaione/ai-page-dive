export function Onboarding() {
  const cmd = 'npm i -g pagedive && pagedive install'
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-base font-semibold">连接本机 host</h1>
      <p className="text-xs leading-5 text-neutral-500">
        PageDive 需要一个本地小程序连接你已安装的 AI CLI。
        <br />
        复制这一行到终端执行：
      </p>
      <button
        onClick={() => navigator.clipboard.writeText(cmd)}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 font-mono text-xs text-white hover:bg-neutral-700"
      >
        {cmd}
      </button>
      <p className="text-[11px] leading-4 text-neutral-400">
        安装后完全重启 Chrome，再点工具栏图标。
        <br />
        内容只在本机处理，不经过任何服务器。
      </p>
    </div>
  )
}
