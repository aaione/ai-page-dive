// r48（M10）：版本号四处一致硬门禁——apps/extension、packages/host、manifest、
// install.sh 任一处升版漏改，CWS zip 与 install.sh 拉的 npm 包即错位（装出旧
// host 报「扩展与组件不匹配」）。CI 22 腿跑（ci.yml），本地：node scripts/check-version.mjs
import { readFileSync } from 'node:fs'

const expect = JSON.parse(readFileSync('apps/extension/package.json', 'utf8')).version
const spots = [
  ['packages/host/package.json', (s) => JSON.parse(s).version],
  ['apps/extension/public/manifest.json', (s) => JSON.parse(s).version],
  ['install.sh', (s) => s.match(/@aaione\/ai-page-dive@([\d.]+)/)?.[1] ?? '(未找到版本号)'],
]

let bad = 0
for (const [file, pick] of spots) {
  const got = pick(readFileSync(file, 'utf8'))
  if (got !== expect) {
    console.error(`✗ ${file}: ${got} ≠ ${expect}`)
    bad++
  }
}
if (bad) process.exit(1)
console.log(`✓ 版本一致 ${expect}（extension / host / manifest / install.sh）`)
