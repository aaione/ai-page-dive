import type { AgentStatus } from '@pagedive/shared'

export function Settings({ agents }: { agents: AgentStatus[] }) {
  return (
    <div className="space-y-4 p-3 text-xs leading-5">
      <section>
        <h2 className="mb-1 font-semibold">本机 CLI</h2>
        {agents.length ? (
          <ul className="space-y-1">
            {agents.map((a) => (
              <li key={a.id} className="flex justify-between text-neutral-600">
                <span className="font-mono">{a.id}</span>
                <span className={a.available ? 'text-green-600' : 'text-neutral-400'}>
                  {a.available ? a.version ?? '已安装' : '未安装'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-neutral-400">尚未探测</p>
        )}
      </section>
      <section className="text-neutral-500">
        <h2 className="mb-1 font-semibold text-neutral-900">说明</h2>
        <p>
          PageDive 只在本机调用你自己登录的官方 CLI（claude / codex），
          不接触任何凭证、不代理流量、不额外收费；总结用量计入你的 CLI 订阅。
        </p>
        <p className="mt-2">
          付费墙站点会尽力提取当前已渲染内容（等价于你手动复制），不会绕过访问控制。
        </p>
        <p className="mt-2">
          历史记录保存在 <span className="font-mono">~/.pagedive/history/</span>。
        </p>
      </section>
    </div>
  )
}
