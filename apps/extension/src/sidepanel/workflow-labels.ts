/**
 * 内置 workflow 目录名 → 展示雅名（r48/M3：从 SummarizeView 抽出——Settings 模式
 * 列表也要用，两处各写一份必漂移）。自定义 workflow 无映射，回退目录名。
 * default 语义（r46-user）：不套预设 prompt 纯调 CLI（空输入仍转 deep 保一键总结）。
 */
export const WF_LABEL: Record<string, string> = {
  default: '默认模式',
  quick: '快速摘要',
  deep: '深度总结',
  paper: '论文模式',
  humanize: '去 AI 味改写',
}

export const wfLabel = (name: string): string => WF_LABEL[name] ?? name
