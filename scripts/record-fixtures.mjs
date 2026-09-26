#!/usr/bin/env node
/**
 * r51 A2②：CLI 流式 fixture 重采样。上游 CLI 自动升级改流格式时，此前只能等用户
 * 报障才发现——本脚本对真机 CLI 发一个最小任务，把原始流存到
 * scripts/fixtures/<id>-stream.jsonl，并用当前解析器重放，报告：
 *   版本 / 事件类型直方图 / 未识别事件数（>0 = 解析器需要跟进适配）。
 * 产物即测试 fixture 的事实来源：把新样本贴进 packages/host/test/<id>-parser.test.ts
 * 并同步 SummarizeView 的 MIN_VERSIONS 基线。
 * 用法：node scripts/record-fixtures.mjs [claude|codex]（默认两个都采；需 CLI 已登录）
 */
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { createClaudeParser } from '../packages/host/dist/agents/claude.js'
import { createCodexParser } from '../packages/host/dist/agents/codex.js'

const PROMPT = 'Reply with exactly: ok'
const TASKS = {
  claude: {
    // 与 claudeDef.buildArgs 的流式面一致（读围栏/权限旗子对本任务无语义，采样从简）
    args: ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'],
    parser: createClaudeParser,
  },
  codex: { args: ['exec', '--json', '--skip-git-repo-check'], parser: createCodexParser },
}

const sh = (bin, args, opts = {}) =>
  new Promise((resolve) => {
    const p = spawn(bin, args, opts)
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('error', () => resolve(undefined)) // 未安装
    p.on('close', () => resolve(out))
    if (opts.stdin) p.stdin.end(opts.stdin)
  })

async function sample(id) {
  const t = TASKS[id]
  const version = ((await sh(id, ['--version'])) ?? '').trim().split('\n')[0]
  if (!version) return console.log(`⛔ ${id} 未安装/不可执行，跳过`)
  const raw = await sh(id, t.args, { stdin: PROMPT + '\n' })
  const lines = raw.split('\n').filter((l) => l.trim().startsWith('{'))
  const parse = t.parser()
  const hist = new Map()
  let unrecognized = 0
  for (const l of lines) {
    try {
      const kind = JSON.parse(l).type
      hist.set(kind, (hist.get(kind) ?? 0) + 1)
      for (const ev of parse(l)) if (ev.type === 'unrecognized') unrecognized++
    } catch { /* 非 JSON 行（CLI 杂音）不计 */ }
  }
  const file = new URL(`./fixtures/${id}-stream.jsonl`, import.meta.url)
  await writeFile(file, lines.join('\n') + '\n')
  console.log(`✅ ${id} ${version} → ${file.pathname.split('/').pop()}（${lines.length} 行）`)
  console.log(`   事件类型：${[...hist.entries()].map(([k, n]) => `${k}×${n}`).join(' ') || '（无）'}`)
  console.log(unrecognized
    ? `   ⚠️ 未识别事件 ${unrecognized} 个——CLI 版本高于解析器实测，需适配并更新 fixture/MIN_VERSIONS`
    : '   未识别事件 0 个——解析器与当前版本兼容')
}

const targets = process.argv[2] ? [process.argv[2]] : Object.keys(TASKS)
if (!targets.every((t) => TASKS[t])) {
  console.error('用法：node scripts/record-fixtures.mjs [claude|codex]')
  process.exit(1)
}
for (const id of targets) await sample(id)
