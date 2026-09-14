#!/usr/bin/env node
/** 硬约束 5 断言：host 运行时行数（src/ 剔除 scripts/ 安装器）< 2000。
 * 把红线从「文档承诺」变成「构建断言」（r4-arch：修复轮 +43/轮的趋势会先于
 * v2 破线——1849 → 1902 → 1956，余量 44 行） */
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const out = execSync(
  "find packages/host/src -name '*.ts' -not -path '*/scripts/*' -print0 | xargs -0 wc -l | tail -1",
  // fileURLToPath 而非 URL.pathname：后者对空格/非 ASCII 路径百分号编码 → ENOENT（r5）
  { cwd: fileURLToPath(new URL('..', import.meta.url)) },
).toString()
const n = Number(out.trim().split(/\s+/)[0])
if (!(n < 2000)) {
  console.error(`⛔ host 运行时行数 ${n} ≥ 2000（硬约束 5 红线）——请瘦身或移入 scripts/`)
  process.exit(1)
}
console.log(`✅ host 运行时行数 ${n} < 2000`)
