import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createClaudeParser } from '../src/agents/claude.js'
import { createCodexParser } from '../src/agents/codex.js'

/** r52（review #14）：真实 CLI 采录 fixture 此前零重放——parser 单测全是手抄帧，
 * 锚不到「真实流里实际混着什么类型」。重放断言 unrecognized===0：CLI 升级引入
 * 新事件类型时此处变红，即驱动重采 fixture（漂移感知闭环的采样端）。
 * fixture 由 scripts/record-fixtures.mjs 采录 + 脱敏（喂法与其重放校验同口径） */
const lines = (f: string) =>
  readFileSync(new URL('../../../scripts/fixtures/' + f, import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))

function unrecognizedOf(make: () => (l: string) => { type: string }[], file: string): number {
  const parse = make()
  let n = 0
  for (const l of lines(file)) for (const ev of parse(l)) if (ev.type === 'unrecognized') n++
  return n
}

/** r62（code #4）：计数锚抓不住「帧 type 没变、载荷字段漂移」——CLI 升级把
 * delta.text / item.text 改名时 unrecognized 不涨、流式正文却全空，真机坏而测试
 * 绿。双向锚：被测解析器累积的 text-delta 全文 === 从 fixture 原始行直接提取的
 * 期望全文（第二只眼，不经被测解析器），任一侧字段漂移必失配。 */
function accTextOf(make: () => (l: string) => { type: string; text?: string }[], file: string): string {
  const parse = make()
  let acc = ''
  for (const l of lines(file)) for (const ev of parse(l)) if (ev.type === 'text-delta') acc += ev.text ?? ''
  return acc
}

function rawTextOf(file: string, pick: (d: any) => string): string {
  let acc = ''
  for (const l of lines(file)) {
    try {
      acc += pick(JSON.parse(l))
    } catch {
      /* 非 JSON / pick 落空行不计 */
    }
  }
  return acc
}

describe('真实流 fixture 重放', () => {
  it('claude-stream.jsonl（27 行，含 stream_event 流）：全流零未识别', () => {
    expect(unrecognizedOf(createClaudeParser, 'claude-stream.jsonl')).toBe(0)
  })

  it('codex-stream.jsonl（7 行，含 3 条 item.error 配置噪声）：未识别=已知噪声数', () => {
    // r54（review #9）：item.error 不再静默吞，计入 unrecognized 透出（仅维护者
    // console.debug + 失败路径诊断，成功任务用户零感知）。fixture 是采样机真实流
    // （含被忽略配置项的 3 条警告）——钉住 3：CLI 升级引入新事件类型/新噪声
    // 时计数顶破此值即红，驱动重采 fixture
    expect(unrecognizedOf(createCodexParser, 'codex-stream.jsonl')).toBe(3)
  })

  it('claude 双向锚：text-delta 累积全文 === result 帧正文（r62 code #4）', () => {
    // result 帧的 result 字段是 CLI 侧的终稿全文——与解析器逐 delta 累积互相独立
    expect(accTextOf(createClaudeParser, 'claude-stream.jsonl')).toBe(
      rawTextOf('claude-stream.jsonl', (d) => (d.type === 'result' && typeof d.result === 'string' ? d.result : '')),
    )
  })

  it('codex 双向锚：text-delta 累积全文 === agent_message 正文拼接（r62 code #4）', () => {
    expect(accTextOf(createCodexParser, 'codex-stream.jsonl')).toBe(
      rawTextOf(
        'codex-stream.jsonl',
        (d) => (d.type === 'item.completed' && d.item?.type === 'agent_message' && typeof d.item?.text === 'string' ? d.item.text : ''),
      ),
    )
  })
})
