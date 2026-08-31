#!/usr/bin/env node
/**
 * M3 冒烟 harness：直接驱动 host 的 stdio 主循环（不经 Chrome），
 * 验证 task-start → 流式 chunk → done → 历史落盘 → cancel 收割。
 *
 * 用法：node packages/host/scripts/smoke.mjs claude|codex [cancel]
 */
import { spawn } from 'node:child_process'
import { unlink } from 'node:fs/promises'

const [agent = 'claude', mode] = process.argv.slice(2)
const hostEntry = new URL('../dist/index.js', import.meta.url).pathname

const host = spawn('node', [hostEntry, '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] })

function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj))
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length)
  return Buffer.concat([head, body])
}

let buf = Buffer.alloc(0)
host.stdout.on('data', (d) => {
  buf = Buffer.concat([buf, d])
  for (;;) {
    if (buf.length < 4) break
    const len = buf.readUInt32LE(0)
    if (buf.length < 4 + len) break
    const msg = JSON.parse(buf.subarray(4, 4 + len))
    buf = buf.subarray(4 + len)
    onMsg(msg)
  }
})

const PAGE = {
  url: 'https://example.com/smoke',
  title: 'PageDive Smoke Test 冒烟测试',
  byline: 'tj',
  siteName: 'example.com',
  lang: 'zh',
  extractor: 'smoke',
  approxTokens: 50,
}
const BODY = `# 冒烟测试正文

这是一段用于端到端冒烟的短正文。请你原样复述标题，然后用一句话说明你读到了这段话，不要做别的。`

const t0 = Date.now()
let chunks = 0

function onMsg(m) {
  if (m.t === 'task-chunk') {
    chunks++
    process.stdout.write(m.text)
  } else if (m.t === 'task-done') {
    console.log(`\n✅ done in ${Date.now() - t0}ms | chunks=${chunks} | isError=${m.isError}`)
    console.log(`   history: ${m.historyPath || '(无)'} | usage: ${JSON.stringify(m.usage)}`)
    exit(0)
  } else if (m.t === 'task-error') {
    console.error(`\n⛔ ${m.code}: ${m.message}`)
    exit(1)
  } else if (m.t !== 'task-status') {
    console.log(`[host] ${m.t}${m.code ? ` ${m.code}: ${m.message}` : ''}`)
  }
}

function exit(code) {
  host.stdin.end()
  setTimeout(() => process.exit(code), 200)
}

const taskId = `smoke-${Date.now()}`
host.stdin.write(frame({ t: 'task-start', task: { taskId, agentId: agent, workflow: 'quick', page: PAGE } }))
host.stdin.write(frame({ t: 'task-content', taskId, seq: 0, text: BODY.slice(0, 10), done: false }))
host.stdin.write(frame({ t: 'task-content', taskId, seq: 1, text: BODY.slice(10), done: true }))

if (mode === 'cancel') {
  setTimeout(() => host.stdin.write(frame({ t: 'task-cancel', taskId })), 1500)
}
