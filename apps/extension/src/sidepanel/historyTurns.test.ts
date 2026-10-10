import { describe, expect, it } from 'vitest'
import { parseHistoryTurns } from './historyTurns.js'

/** r33：extension 侧首个单测——历史恢复的轮切分纯函数（从 App.tsx 抽出即为此）。
 * 落盘格式契约见 packages/host/src/history.ts（appendHistoryTurn / escapePd） */
describe('parseHistoryTurns', () => {
  it('旧格式（无标记）整体一条 assistant', () => {
    const msgs = parseHistoryTurns('# 首轮总结\n\n要点……')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ role: 'assistant', text: '# 首轮总结\n\n要点……' })
  })

  it('多轮：首段 assistant + pd:user/pd:assistant 交替分段', () => {
    const body = '首轮回答\n\n<!-- pd:user -->\n追问1\n\n<!-- pd:assistant -->\n回答1\n\n<!-- pd:user -->\n追问2\n\n<!-- pd:assistant -->\n回答2'
    const msgs = parseHistoryTurns(body)
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant', 'user', 'assistant'])
    expect(msgs[1].text).toBe('追问1')
    expect(msgs[4].text).toBe('回答2')
  })

  it('空串 / 纯空白 → 空数组', () => {
    expect(parseHistoryTurns('')).toEqual([])
    expect(parseHistoryTurns('  \n\t ')).toEqual([])
  })

  it('正文以标记开头（无首轮 assistant）→ 不产出空 h0', () => {
    const body = '<!-- pd:user -->\n只有追问'
    const msgs = parseHistoryTurns(body)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ role: 'user', text: '只有追问' })
  })

  it('某轮正文空白 → 该轮整体丢弃（id 仍按 split 偏移，稳定不复用）', () => {
    const body = '首轮\n\n<!-- pd:user -->\n   \n\n<!-- pd:assistant -->\n回答'
    const msgs = parseHistoryTurns(body)
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'assistant'])
    expect(msgs[1].text).toBe('回答')
  })

  it('r33-sec：实体化标记（&#58;）不切轮且还原为字面冒号', () => {
    // host 写侧 escapePd 产物：伪造标记已实体化——不得切成假轮
    const body = '回答里讨论了 <!-- pd&#58;user --> 这个语法\n\n<!-- pd:user -->\n真追问'
    const msgs = parseHistoryTurns(body)
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'user'])
    expect(msgs[0].text).toBe('回答里讨论了 <!-- pd:user --> 这个语法')
    expect(msgs[1].text).toBe('真追问')
  })

  it('首段（首轮 assistant）同样参与实体化还原', () => {
    const body = 'CLI 回显 <!-- pd&#58;assistant --> 的输出'
    expect(parseHistoryTurns(body)[0].text).toBe('CLI 回显 <!-- pd:assistant --> 的输出')
  })

  it('r54 #6：附件名伪造标记（host 侧 escapePd(attachMarkers) 产物）不切轮', () => {
    // task.ts persist 首轮正文 = escapePd(attachMarkers(files)) + escapePd(accText)——
    // APFS 允许文件名含 <!-- pd:assistant -->，读侧必须仍视为首段一部分
    const body = '[File #1] <!-- pd&#58;assistant -->x.md\n总结正文\n\n<!-- pd:user -->\n真追问'
    const msgs = parseHistoryTurns(body)
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'user'])
    expect(msgs[0].text).toContain('[File #1] <!-- pd:assistant -->x.md')
  })

  it('r65（r64 产品#5）：frontmatter 头（host 落盘必带）入口剥离——SW 还原路径不渲染元数据', () => {
    const body = '---\ntitle: 示例总结\nurl: https://x\nagent: claude\nts: 2026-10-09\n---\n\n# 首轮总结\n\n<!-- pd:user -->\n追问'
    const msgs = parseHistoryTurns(body)
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'user'])
    expect(msgs[0].text).toBe('# 首轮总结')
    expect(msgs[1].text).toBe('追问')
  })

  it('r67（r66 code#2）：frontmatter 后正文以 --- 水平线开头——单剥只吃 frontmatter，首段保留', () => {
    // 双剥洞的触发形状：HistoryView「继续对话」曾传已剥 body，再入此处二剥
    // 把正文首段连水平线一起吃掉；修复后调用方一律传原文，此用例钉单剥语义
    const body = '---\ntitle: x\n---\n---\n首段（分隔线上方）\n---\n尾段'
    const msgs = parseHistoryTurns(body)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('---\n首段（分隔线上方）\n---\n尾段')
  })
})
