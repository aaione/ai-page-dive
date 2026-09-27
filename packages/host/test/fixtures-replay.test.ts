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

describe('真实流 fixture 重放', () => {
  it('claude-stream.jsonl（45 行，含 stream_event 流）：全流零未识别', () => {
    expect(unrecognizedOf(createClaudeParser, 'claude-stream.jsonl')).toBe(0)
  })

  it('codex-stream.jsonl（7 行，含 item.completed 环境噪声）：全流零未识别', () => {
    expect(unrecognizedOf(createCodexParser, 'codex-stream.jsonl')).toBe(0)
  })
})
