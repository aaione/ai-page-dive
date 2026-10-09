#!/usr/bin/env node
/** r62（产品#4）：CWS zip 打包守门——断言 dist 产物完整再打 zip。
 * 项目自证发生过单段构建产出「manifest 声明 content.js 但文件缺失」的残缺 dist
 * （AGENTS Dev Harness 节警告），该 dist 若打进上架包即用户装到「点总结必死」。
 * manifest 声明的每个入口（content_scripts/background/html/icons）逐一断言在盘。
 * 用法：先跑完整两段 `pnpm build`，再 `node scripts/package-cws.mjs`。macOS（系统 zip）。 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(REPO, 'apps/extension/dist')

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error(`⛔ ${DIST}/manifest.json 不存在——先跑完整两段 pnpm build（单段 vite build 会产残缺 dist）`)
  process.exit(1)
}

const manifest = JSON.parse(await readFile(join(DIST, 'manifest.json'), 'utf8'))
const required = ['manifest.json', 'sidepanel.html', 'background.js']
for (const cs of manifest.content_scripts ?? []) required.push(...(cs.js ?? []))
for (const v of Object.values(manifest.icons ?? {})) required.push(v)

const missing = required.filter((f) => !existsSync(join(DIST, f)))
if (missing.length) {
  console.error(`⛔ dist 残缺（声明了但文件缺失）：${missing.join(', ')}——重跑完整 pnpm build`)
  process.exit(1)
}
console.log(`✓ dist 完整：${required.length} 个 manifest 声明产物全在盘`)

// r65（r64 产品#6）：--check-only 到此为止——只跑完整性断言不打 zip（CI 挂钩用；
// zip 只在上架打包时需要，且依赖系统 zip）
if (process.argv.includes('--check-only')) process.exit(0)

// CWS 要求 manifest 在 zip 根：cwd 进 dist 平铺打包
const out = join(REPO, 'apps/extension', `pagedive-cws-v${manifest.version}.zip`)
execFileSync('zip', ['-q', '-X', '-r', out, '.'], { cwd: DIST, stdio: 'inherit' })
console.log(`✓ ${out}（${(readFileSync(out).length / 1024).toFixed(0)} KB，上传 Chrome Web Store 开发者后台用）`)
