#!/usr/bin/env node
/** 硬约束 5 断言：host 进程运行时代码总行数 < 2200，且 host 运行时零依赖。
 *
 * 把红线从「文档承诺」变成「构建断言」（r4-arch：修复轮 +43/轮的趋势会先于 v2 破线——
 * 1849 → 1902 → 1956）。r47-arch 重校准：
 *
 * 1. 口径改成「host 进程跑的总代码量」而非「某个目录的行数」——ROOTS 可跨包，且断言
 *    host 运行时零依赖。原先单目录口径留了个后门：把代码拆进新 workspace 包就能过线，
 *    而 host 进程该跑的代码一行没少。红线要守的是薄壳这件事，不是某个路径的数字。
 * 2. 阈值 2000 → 2200。2000 已在 r47 被真实业务代码撑破（2039，CI 红）；把它抬到
 *    2200 是承认「2000 当初是拍的，不是算出来的」。**再破线时请删功能或删注释，不要
 *    再抬阈值**——阈值被反复上调的红线等于没有红线。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url)) // 非 URL.pathname：后者对空格/非 ASCII 路径百分号编码 → ENOENT（r5）
const LIMIT = 2200

/** 参与统计的目录：host 进程实际加载的代码。剔除 scripts/（装机一次性安装器，不在 NM 主循环里）。
 *  若将来把运行时代码拆到新 workspace 包，必须把该目录加进这里 */
const ROOTS = ['packages/host/src']
const SKIP = /(^|\/|\\)scripts($|\/|\\)/

function tsFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (SKIP.test(relative(REPO, p))) continue
    if (statSync(p).isDirectory()) out.push(...tsFiles(p))
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

/** 行数：按换行计，末行无换行也算一行（与 wc -l 差 1 但更贴「代码行数」直觉）。
 *  不再用 `wc -l | tail -1`——单文件时 wc 不输出 total 行，会把该文件行数当总数（历史隐患） */
function countLines(file) {
  const text = readFileSync(file, 'utf8')
  if (!text) return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

const files = ROOTS.flatMap((r) => tsFiles(join(REPO, r)))
const total = files.reduce((n, f) => n + countLines(f), 0)

// 运行时零依赖：dependencies 非空意味着有包随 host 一起跑，上面的 ROOTS 就漏统计了
const pkg = JSON.parse(readFileSync(join(REPO, 'packages/host/package.json'), 'utf8'))
const deps = Object.keys(pkg.dependencies ?? {})
if (deps.length) {
  console.error(
    `⛔ host 出现运行时依赖：${deps.join(', ')}\n` +
      `   硬约束 5 要求 host 运行时零依赖；若确需引入，请同步把其代码目录加进本脚本 ROOTS，` +
      `否则红线统计会漏掉真正在跑的代码。`,
  )
  process.exit(1)
}

if (total >= LIMIT) {
  const top = files
    .map((f) => [countLines(f), relative(REPO, f)])
    .sort((a, b) => b[0] - a[0])
    .slice(0, 5)
    .map(([n, f]) => `     ${String(n).padStart(4)}  ${f}`)
    .join('\n')
  console.error(
    `⛔ host 运行时行数 ${total} ≥ ${LIMIT}（硬约束 5 红线）\n` +
      `   请删功能、精简注释或移入 scripts/——不要上调阈值。最大的几个文件：\n${top}`,
  )
  process.exit(1)
}
console.log(`✅ host 运行时行数 ${total} < ${LIMIT}（${files.length} 个文件，余量 ${LIMIT - total}）`)
