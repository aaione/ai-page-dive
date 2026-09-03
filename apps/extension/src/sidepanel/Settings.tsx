import type { AgentStatus } from '@pagedive/shared'

export function Settings({ agents, onClose }: { agents: AgentStatus[]; onClose: () => void }) {
  return (
    <div className="pd-settings">
      <button onClick={onClose} className="pd-settings-close" title="关闭设置" aria-label="关闭设置">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>

      <section className="pd-settings-section">
        <h2 className="pd-settings-title">本机 CLI</h2>
        {agents.length ? (
          <ul className="pd-settings-list">
            {agents.map((a) => (
              <li key={a.id} className="pd-settings-list-item">
                <span className="pd-settings-cli-name">{a.id}</span>
                <span className={`pd-settings-cli-status ${a.available ? 'available' : 'unavailable'}`}>
                  <span className={`pd-settings-cli-dot ${a.available ? 'available' : 'unavailable'}`} />
                  {a.available ? a.version ?? '已安装' : '未安装'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pd-settings-empty">尚未探测</p>
        )}
      </section>

      <section className="pd-settings-section">
        <h2 className="pd-settings-title">说明</h2>
        <div className="pd-settings-description">
          <p>
            PageDive 只在本机调用你自己登录的官方 CLI（claude / codex / opencode），
            <strong>不接触任何凭证、不代理流量、不额外收费</strong>；总结用量计入你的 CLI 订阅。
          </p>
          <p>
            付费墙站点会尽力提取当前已渲染内容（等价于你手动复制），不会绕过访问控制。
          </p>
          <p>
            历史记录保存在 <code>~/.pagedive/history/</code>。
          </p>
        </div>
      </section>
    </div>
  )
}