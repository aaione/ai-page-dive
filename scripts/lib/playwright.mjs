// r53 #17：playwright-core 解析链——此前五个 e2e 脚本硬编码
// /Users/apple/.nvm/versions/node/v24.15.0/.../playwright-core/index.mjs，node 升版即全体断裂。
// 解析顺序（paths 语义 = 在该目录下找 node_modules/<spec>，故传父目录）：
//   repo node_modules（若日后加 devDep）→ npm 全局直接安装档 → @playwright/mcp
//   嵌套依赖（本机现状：playwright-core 经全局 @playwright/mcp 间接存在）。
// ponytail: 不把 playwright 塞进 repo devDeps（百 MB 级传递体），借用已有全局安装。
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** r58（R4）：e2e 共用路径参数化——repo 相对推导 + env 覆盖。硬编码绝对路径
 *  只在单人单机成立：换机/换 chromium build（chromium-1217 是版本化目录）即断 */
export const REPO = fileURLToPath(new URL('../..', import.meta.url))
export const HOST_DIST = `${REPO}packages/host/dist/index.js`
export const EXT_DIST_E2E = `${REPO}apps/extension/dist-e2e`
export const EXT_DIST = `${REPO}apps/extension/dist`

/** 浏览器路径：env 覆盖 → chromium.executablePath()（随 playwright-core 期望
 *  build 走）→ 该 build 未装时扫 ms-playwright 缓存取最新已装 chromium build
 *  （全局 @playwright/mcp 期望版本与缓存不一致是常态，本机即 1222 vs 1217/1243） */
export function browserExecutable(chromium) {
  if (process.env.PAGEDIVE_E2E_BROWSER) return process.env.PAGEDIVE_E2E_BROWSER
  try {
    const p = chromium.executablePath()
    if (existsSync(p)) return p
  } catch { /* 走缓存回退 */ }
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  const builds = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
  for (const b of builds) {
    for (const arch of readdirSync(join(cache, b)).filter((d) => d.startsWith('chrome-mac'))) {
      const app = join(cache, b, arch, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
      if (existsSync(app)) return app
    }
  }
  throw new Error('ms-playwright 缓存无 chromium build：npx playwright install chromium 或设 PAGEDIVE_E2E_BROWSER')
}

export async function loadChromium() {
  const { createRequire } = await import('node:module')
  const { execSync } = await import('node:child_process')
  const { dirname } = await import('node:path')
  const req = createRequire(import.meta.url)
  let globalRoot = ''
  try {
    globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    // npm 不在 PATH：跳过全局档
  }
  // 空数组 = 从脚本自身 node_modules 向上解析（repo 档，若日后加 devDep）
  const chain = [
    [],
    ...(globalRoot ? [[dirname(globalRoot)], [`${globalRoot}/@playwright/mcp`]] : []),
  ]
  for (const paths of chain) {
    try {
      const mod = await import(req.resolve('playwright-core', { paths }))
      // CJS interop：cjs-module-lexer 对 playwright-core 的再导出探测不到 chromium
      const c = mod.chromium ?? mod.default?.chromium
      if (c) return c
    } catch {
      // 试下一档
    }
  }
  throw new Error(
    'playwright-core 未找到：请在 repo 安装 devDependency，或全局任装 playwright-core / @playwright/mcp 其一',
  )
}
