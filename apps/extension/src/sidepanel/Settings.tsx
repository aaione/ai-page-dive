import type { AgentStatus } from '@pagedive/shared'

export function Settings({ agents, onClose }: { agents: AgentStatus[]; onClose: () => void }) {
  return (
    <div className="pd-glass-overlay h-full overflow-y-auto rounded-none px-[18px] py-4 text-xs">
      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-full text-pd-ink-2 hover:bg-pd-hover hover:text-pd-ink"
          title="关闭设置"
          aria-label="关闭设置"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <section>
        <h2 className="border-b border-white/10 pb-1.5 text-xs font-semibold text-pd-ink">本机 CLI</h2>
        {agents.length ? (
          <ul className="mt-2.5 space-y-2">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center justify-between">
                <span className="pd-mono text-xs text-pd-ink">{a.id}</span>
                <span
                  className={`flex items-center gap-1.5 text-xs ${
                    a.available ? 'text-pd-ok' : 'text-pd-ink-2'
                  }`}
                >
                  <span
                    className={`inline-block h-[6px] w-[6px] rounded-full ${
                      a.available ? 'bg-pd-ok' : 'bg-pd-off'
                    }`}
                  />
                  {a.available ? a.version ?? '已安装' : '未安装'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11.5px] leading-[1.9] text-pd-ink-2">尚未探测</p>
        )}
      </section>
      <section className="mt-6">
        <h2 className="border-b border-white/10 pb-1.5 text-xs font-semibold text-pd-ink">说明</h2>
        <div className="mt-2.5 space-y-2 text-xs leading-[1.9] text-pd-ink-2">
          <p>
            PageDive 只在本机调用你自己登录的官方 CLI（claude / codex / opencode），
            <span className="font-semibold text-pd-ink">不接触任何凭证、不代理流量、不额外收费</span>；总结用量计入你的 CLI 订阅。
          </p>
          <p>
            付费墙站点会尽力提取当前已渲染内容（等价于你手动复制），不会绕过访问控制。
          </p>
          <p>
            历史记录保存在 <span className="pd-mono">~/.pagedive/history/</span>。
          </p>
        </div>
      </section>
    </div>
  )
}
