import { describe, expect, it } from 'vitest'
import { verLt, wfLabel } from './workflow-labels.js'

// r51 深审：版本比较语义此前零测试锚定（A2① 门控的判定核心）；用例覆盖真机
// --version 的全部实测形态 + 边界（迁移自 SummarizeView 时语义逐字保留）
describe('verLt 版本比较（a 侧净化）', () => {
  it('真机形态：codex-cli 前缀 / (Claude Code) 后缀', () => {
    expect(verLt('codex-cli 0.156.1', '0.156.1')).toBe(false) // 恰等基线不提示
    expect(verLt('codex-cli 0.46.0', '0.156.1')).toBe(true)
    expect(verLt('2.1.162 (Claude Code)', '2.1.162')).toBe(false)
    expect(verLt('2.0.62 (Claude Code)', '2.1.162')).toBe(true)
  })
  it('分段数值比较而非字符串比较', () => {
    expect(verLt('0.46.0', '0.156.1')).toBe(true) // '46'>'15' 字符串序会判反
    expect(verLt('10.0', '9.9')).toBe(false) // 两位数段
  })
  it('prerelease 后缀净化成第四段（比较方向安全：旧版仍提示，新版不误报）', () => {
    expect(verLt('0.46.0-beta.1', '0.156.1')).toBe(true)
    expect(verLt('0.157.0-beta.1', '0.156.1')).toBe(false)
  })
  it('长度不齐按 0 补段', () => {
    expect(verLt('2.1', '2.1.162')).toBe(true)
    expect(verLt('2.1.162', '2.1')).toBe(false)
  })
})

describe('wfLabel 雅名映射', () => {
  it('内置五档全有雅名（加档漏补即裸奔目录名——product-audit 曾漏）', () => {
    for (const w of ['quick', 'deep', 'paper', 'humanize', 'product-audit']) {
      expect(wfLabel(w)).not.toBe(w)
    }
  })
  it('自定义档回退目录名', () => {
    expect(wfLabel('my-custom')).toBe('my-custom')
  })
})
