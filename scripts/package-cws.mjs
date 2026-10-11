#!/usr/bin/env node
/** r62（产品#4）：CWS zip 打包守门——断言 dist 产物完整再打 zip。
 * 项目自证发生过单段构建产出「manifest 声明 content.js 但文件缺失」的残缺 dist
 * （AGENTS Dev Harness 节警告），该 dist 若打进上架包即用户装到「点总结必死」。
 * manifest 声明的每个入口（content_scripts/background/html/icons）逐一断言在盘。
 * 用法：先跑完整两段 `pnpm build`，再 `node scripts/package-cws.mjs`。macOS（系统 zip）。 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
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
// r71（r70 产品 C8）：action.default_icon（string 或尺寸映射两种形状）同收——
// manifest 声明却缺文件时上架空图标，与 content_scripts 同罪
const di = manifest.action?.default_icon
if (typeof di === 'string') required.push(di)
else if (di) required.push(...Object.values(di))

const missing = required.filter((f) => !existsSync(join(DIST, f)))
if (missing.length) {
  console.error(`⛔ dist 残缺（声明了但文件缺失）：${missing.join(', ')}——重跑完整 pnpm build`)
  process.exit(1)
}
console.log(`✓ dist 完整：${required.length} 个 manifest 声明产物全在盘`)

// r69（r68 产品#7）：内容一致性——dist manifest 落后 public（改了 description/version
// 未重建 dist）时，已删措辞（如「免费」）会原样带上 CWS。version+description 逐字
// 比对，不一致即拒打包——完整两段 pnpm build 后 dist 才是新鲜的。
// r71（r70 产品 C8）扩面：name/permissions/optional_host_permissions/icons 同断——
// 改权限面后未重建 dist 时旧权限静默上架，恰是 CWS 审核最敏感打回点；对象/数组
// 用 JSON.stringify 深比较
const srcManifest = JSON.parse(readFileSync(join(REPO, 'apps/extension/public/manifest.json'), 'utf8'))
for (const k of ['version', 'description', 'name', 'permissions', 'optional_host_permissions', 'icons']) {
  if (JSON.stringify(manifest[k]) !== JSON.stringify(srcManifest[k])) {
    console.error(
      `⛔ dist/manifest.json 的 ${k} 与 public/manifest.json 不一致` +
        `（dist: ${JSON.stringify(manifest[k])} ≠ public: ${JSON.stringify(srcManifest[k])}）` +
        `——重跑完整 pnpm build 再打包`,
    )
    process.exit(1)
  }
}
console.log('✓ dist manifest 内容一致（version/description/name/permissions/optional_host_permissions/icons 对齐 public）')

// r72（r71 产品 P4）：Chrome manifest 规范 description ≤132 字符——超限 CWS 上传
// 确定性打回 Invalid value for 'description'（r71 实测 143 字符溜过三道门）。源头
// 拦截 + 本断言兜底，防后续改文案再超
for (const m of [manifest, srcManifest]) {
  if (m.description.length > 132) {
    console.error(`⛔ manifest description ${m.description.length} 字符超 Chrome 132 上限——CWS 上传必打回`)
    process.exit(1)
  }
}

// r65（r64 产品#6）：--check-only 到此为止——只跑完整性断言不打 zip（CI 挂钩用；
// zip 只在上架打包时需要，且依赖系统 zip）
if (process.argv.includes('--check-only')) process.exit(0)

// CWS 要求 manifest 在 zip 根：cwd 进 dist 平铺打包。
// r72（r71 产品 P6）：zip -r 对已有 zip 是增量更新——已删文件的旧条目会残留，
// 同版本号旧 zip 直接复用会把过期构建分发出去。先删旧档强制全量重产
const out = join(REPO, 'apps/extension', `pagedive-cws-v${manifest.version}.zip`)
if (existsSync(out)) rmSync(out)
execFileSync('zip', ['-q', '-X', '-r', out, '.'], { cwd: DIST, stdio: 'inherit' })
console.log(`✓ ${out}（${(readFileSync(out).length / 1024).toFixed(0)} KB，上传 Chrome Web Store 开发者后台用）`)
