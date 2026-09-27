// r48（M10）：版本号四处一致硬门禁——apps/extension、packages/host、manifest、
// install.sh 任一处升版漏改，CWS zip 与 install.sh 拉的 npm 包即错位（装出旧
// host 报「扩展与组件不匹配」）。CI 22 腿跑（ci.yml），本地：node scripts/check-version.mjs
import { readFileSync } from 'node:fs'

const expect = JSON.parse(readFileSync('apps/extension/package.json', 'utf8')).version
// r51-review：README×2 + host README 的 npm 备选命令同钉 @版本——散落引用一并并入硬门禁
// （数组语义 = 提取到的每个版本都须等于 expect 且至少一处，漏改/写 latest 均炸 CI）
const all = (re) => (s) => [...s.matchAll(re)].map((m) => m[1])
const spots = [
  ['packages/host/package.json', (s) => JSON.parse(s).version],
  ['apps/extension/public/manifest.json', (s) => JSON.parse(s).version],
  ['install.sh', (s) => s.match(/@aaione\/ai-page-dive@([\d.]+)/)?.[1] ?? '(未找到版本号)'],
  ['README.md', all(/@aaione\/ai-page-dive@([\d.]+)/g)],
  ['packages/host/README.md', all(/@aaione\/ai-page-dive@([\d.]+)/g)],
  // r51 深审：mock 的 getManifest 版本是硬编码字符串（harness 里喂给 Onboarding 动态
  // npm 命令），发版不跟即漂——8d78e0e 已实证此点位会漂，并入门禁。
  // 正则锚定 getManifest 行：mock 的 AGENTS 列表里还有 CLI 版本串，泛匹配会撞错
  ['apps/extension/src/dev/chrome-mock.ts', (s) => s.match(/getManifest[^\n]*version: '([\d.]+)'/)?.[1] ?? '(未找到版本号)'],
]

let bad = 0
for (const [file, pick] of spots) {
  const got = pick(readFileSync(file, 'utf8'))
  const ok = Array.isArray(got) ? got.length > 0 && got.every((v) => v === expect) : got === expect
  if (!ok) {
    console.error(`✗ ${file}: ${JSON.stringify(got)} ≠ ${expect}`)
    bad++
  }
}
if (bad) process.exit(1)
console.log(`✓ 版本一致 ${expect}（extension / host / manifest / install.sh / README×2 / host README / mock）`)
