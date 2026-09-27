/**
 * 内置 workflow 目录名 → 展示雅名（r48/M3：从 SummarizeView 抽出——Settings 模式
 * 列表也要用，两处各写一份必漂移）。自定义 workflow 无映射，回退目录名。
 * default 语义（r46-user）：不套预设 prompt 纯调 CLI（空输入仍转 deep 保一键总结）。
 * r51 深审：verLt 自 SummarizeView 迁入（抽出才可单测——版本比较语义此前零锚定）。
 */
export const WF_LABEL: Record<string, string> = {
  default: '默认模式',
  quick: '快速摘要',
  deep: '深度总结',
  paper: '论文模式',
  humanize: '去 AI 味改写',
  // r51-review：product-audit 加档时漏补此键——下拉/Settings/CTA（「产品审计本页」）
  // 查表回退裸目录名。雅名对齐 WORKFLOW.md description 首词，与其余四档四字风格一致
  'product-audit': '产品审计',
}

export const wfLabel = (name: string): string => WF_LABEL[name] ?? name

/** 点分版本比较：a < b 为真。a 侧净化非数字字符——真机 --version 形如
 * "codex-cli 0.156.1" / "2.1.162 (Claude Code)"；b 侧是内置基线字面量不做净化 */
export const verLt = (a: string, b: string): boolean => {
  const pa = a.replace(/[^\d.]/g, '').split('.').map((s) => parseInt(s, 10) || 0)
  const pb = b.split('.').map((s) => parseInt(s, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0)
  }
  return false
}
