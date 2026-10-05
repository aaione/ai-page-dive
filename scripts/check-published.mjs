// r55（#12）：钉版已发布门禁——仓库钉 X 而 npm registry 只有更旧版时，install.sh
// 装出旧 host，扩展立刻报「组件过旧」横幅（r55 实测：registry 停在 0.1.2，仓库已
// 钉 0.1.3）。发版是手动 npm publish，此门禁把「忘了 publish」从用户侧报错前移到
// CI 变红。独立步骤、不进 pnpm test：离线开发不该被拦，在线 CI 才执法
import { readFileSync } from 'node:fs'

const pinned = JSON.parse(readFileSync('packages/host/package.json', 'utf8')).version

let latest
try {
  const res = await fetch('https://registry.npmjs.org/@aaione%2Fai-page-dive', {
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  latest = (await res.json())?.['dist-tags']?.latest
} catch (e) {
  console.error(`✗ npm registry 不可达（${e.message}）——门禁无法核实，按失败处理`)
  process.exit(1)
}
if (!latest) {
  console.error('✗ registry 响应缺 dist-tags.latest')
  process.exit(1)
}
// ponytail: 三段数值比较——字符串序在 0.1.10 vs 0.1.9 会选错提示语（两侧都红，仅文案错向）
const cmp = (a, b) => {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}
if (latest !== pinned) {
  console.error(
    cmp(latest, pinned) < 0
      ? `✗ 仓库钉 ${pinned} 未发布（registry latest = ${latest}）——先 npm publish 再合：install.sh 此刻装出旧 host，新扩展的新协议消息它静默无响应（症状：按钮无反应/新功能失效，并非版本横幅）`
      : `✗ registry latest = ${latest} 领先仓库钉版 ${pinned}——升版提交漏了，把仓库版本跟上`,
  )
  process.exit(1)
}
console.log(`✓ 钉版 ${pinned} 已发布（registry dist-tags.latest 同版）`)
