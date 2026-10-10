import type { ChatMessage } from './App'

/**
 * 历史正文 → 多轮消息。host 落盘格式：首轮 assistant 全文在前，
 * 追问轮以 <!-- pd:user --> / <!-- pd:assistant --> 注释分段。
 * 旧格式（无标记）整体作为一条 assistant 消息。
 * r33-sec：写侧（host escapePd）已把正文里伪造的标记实体化（&#58;）——
 * 此处不再误切轮边界，并在还原显示时转回字面冒号。
 */
export function parseHistoryTurns(body: string): ChatMessage[] {
  // r65（r64 产品#5）：host 落盘必带 frontmatter 头（history.ts 写侧）——入口统一
  // 剥离，SW 回收自动还原（App history-file 路径）不再把元数据渲染成对话标题。
  // r67（r66 code#2）：剥离唯一收口在此——调用方一律传原文（HistoryView 继续对话
  // 曾传已剥 body 被二剥，正文 --- 水平线开头即丢首段）；非贪婪只剥第一个闭合，
  // frontmatter 后正文自身的 --- 水平线不受影响
  const raw = body.replace(/^---\n[\s\S]*?\n---\n/, '').trim()
  if (!raw) return []
  const msgs: ChatMessage[] = []
  // 首段（到第一个 pd:user 标记前）= 首轮 assistant 回答
  const parts = raw.split(/<!-- pd:(user|assistant) -->/)
  const unescape = (s: string) => s.replaceAll('<!-- pd&#58;', '<!-- pd:')
  const first = unescape(parts[0].trim())
  if (first) msgs.push({ id: 'h0', role: 'assistant', text: first })
  // split 产物交替：[text, tag, text, tag, text…]，tag 后的 text 属于该角色
  for (let i = 1; i < parts.length; i += 2) {
    const role = parts[i] === 'user' ? 'user' : 'assistant'
    const text = unescape((parts[i + 1] ?? '').trim())
    if (text) msgs.push({ id: `h${i}`, role, text })
  }
  return msgs
}
