#!/usr/bin/env node
/** r58（N1）dist 级 install 冒烟：真实用户跑的是 dist/index.js install，不是 src/。
 *  vitest 全程 PAGEDIVE_HOST_ENTRY 注入跑 src/ 源码——N1 这类「hostPath 算到
 *  dist/scripts/index.js（不存在）」的发布断链在单测里永不可见，只能打 dist。
 *  隔离 HOME：不碰开发机/CI 真实 NM manifest 与 ~/.ai-page-dive */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const HOST_BIN = join(REPO, 'packages/host/dist/index.js')
const EXT_ID = 'a'.repeat(32)

if (!existsSync(HOST_BIN)) {
  console.error(`⛔ ${HOST_BIN} 不存在——先 pnpm --filter @aaione/ai-page-dive build`)
  process.exit(1)
}

const home = await mkdtemp(join(tmpdir(), 'pd-distsmoke-'))
mkdirSync(join(home, 'Library/Application Support/Google/Chrome'), { recursive: true })

try {
  const r = spawnSync(process.execPath, [HOST_BIN, 'install', '--ext-id', EXT_ID], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  })
  // 退出码语义：0=就绪 2=零 CLI（CI 无 claude/codex）3=无 origins——皆非断链；
  // 1=硬失败（host entry 不存在正是 N1 的漏出形态）
  if (![0, 2, 3].includes(r.status)) {
    console.error(`⛔ install 退出码 ${r.status}（N1 类断链形态）\n${r.stdout}\n${r.stderr}`)
    process.exit(1)
  }
  const manifestPath = join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.pagedive.host.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!manifest.allowed_origins?.includes(`chrome-extension://${EXT_ID}/`)) {
    console.error(`⛔ allowed_origins 未登记扩展 ID: ${JSON.stringify(manifest.allowed_origins)}`)
    process.exit(1)
  }
  // wrapper 引用的 host entry 必须真实存在——N1 正是断在这里（wrapper 指向
  // dist/scripts/index.js，Chrome 起 NM host 直接失败）。wrapper 三行 exec 形如
  // exec 'node' 'entry' --stdio，紧邻 --stdio 的引号段即 host entry
  const wrapper = readFileSync(manifest.path, 'utf8')
  const entries = [...wrapper.matchAll(/'([^']+)' --stdio/g)].map((m) => m[1])
  if (!entries.some(existsSync)) {
    console.error(`⛔ wrapper 未指向任何存在的 host entry:\n${wrapper}`)
    process.exit(1)
  }
  console.log(`✅ dist install 冒烟通过（exit ${r.status}，entry=${entries.find(existsSync)}）`)
} finally {
  rmSync(home, { recursive: true, force: true })
}
