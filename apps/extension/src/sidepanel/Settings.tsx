import type { AgentStatus } from '@pagedive/shared'

export function Settings({ agents }: { agents: AgentStatus[] }) {
  return (
    <div className="h-full overflow-y-auto bg-pd-bg px-[18px] py-5 text-xs">
      <section>
        <h2 className="border-b border-pd-line pb-1.5 text-xs font-semibold text-pd-ink">本机 CLI</h2>
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
        <h2 className="border-b border-pd-line pb-1.5 text-xs font-semibold text-pd-ink">说明</h2>
        <div className="mt-2.5 space-y-2 text-xs leading-[1.9] text-pd-ink-2">
          <p>
            PageDive 只在本机调用你自己登录的官方 CLI（claude / codex），
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
