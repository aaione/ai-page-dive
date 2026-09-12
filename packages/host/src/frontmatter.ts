/** frontmatter 拆分（history/workflows/skills 三处同构手写的合并）。
 * 纯拆分：字段提取与各调用方的兜底分支（4KB 头读回退/无 fm 回退全文）留原处 */
export function splitFrontmatter(raw: string): { fm: string; body: string } | undefined {
  if (!raw.startsWith('---')) return undefined
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return undefined
  return { fm: raw.slice(4, end), body: raw.slice(end + 4).trim() }
}
