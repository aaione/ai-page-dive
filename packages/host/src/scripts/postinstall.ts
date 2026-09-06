// packages/host/src/scripts/postinstall.ts —— 编译为 dist/scripts/postinstall.js
// 设计约束（D10 定案）：只用 node: 内置；永不抛错、永不阻塞安装；
// 只在「包管理器全局安装 + macOS + 非 root + dist 已构建」时静默注册 NM host。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerManifests } from '../install.js'

/** 包根（dist/scripts/ 的上两级）：比 cwd 稳，npm link 场景也正确 */
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function log(msg: string): void {
  console.log(`[ai-page-dive] ${msg}`)
}

/** 用户终端里没有扩展 ID——真实命令只能从扩展面板复制（chrome.runtime.id 动态渲染） */
function pointToPanel(): void {
  log('请回到扩展面板（AI PageDive 侧边栏），复制面板上显示的命令执行即可完成登记。')
}

/**
 * 全局安装判定（纯 pkgDir 启发式 + lifecycle env）：
 * - npm -g：npm_config_global === 'true'（npm 7+ 可靠）
 * - pnpm -g（approve-builds 放行后）：包目录落在 PNPM_HOME 全局根下（带路径分隔符边界；
 *   resolve 规范化吃掉 PNPM_HOME 尾斜杠——shell 配置常见形态）
 * - yarn v1 -g：包目录落在 ~/.config/yarn/global/node_modules 下
 * monorepo pnpm install / CI / 本地 npm i / file: 链接均不满足 → false
 * export 供测试（main 只传 process.env 与模块级 pkgDir）。
 */
export function detectGlobalInstall(env: NodeJS.ProcessEnv, pkgDir: string): boolean {
  if (env.npm_config_global === 'true') return true
  const pnpmHome = env.PNPM_HOME ? resolve(env.PNPM_HOME) : undefined
  if (pnpmHome && pkgDir.startsWith(pnpmHome + sep)) return true
  // yarn v1 全局：~/.config/yarn/global/node_modules/<pkg>（macOS 路径）
  if (pkgDir.includes(`${sep}yarn${sep}global${sep}node_modules${sep}`)) return true
  return false
}

/** 顶层全局判定：npm i -g <宿主> 时嵌套依赖也会看到 npm_config_global——
 * 顶层全局包的父目录是 node_modules，且其上一级没有另一个包的 package.json */
export function isTopLevelGlobal(pkgDir: string): boolean {
  const parent = dirname(pkgDir)
  if (!parent.endsWith(`${sep}node_modules`)) return false
  const grandparentPkg = join(dirname(parent), 'package.json')
  try {
    if (existsSync(grandparentPkg)) {
      const gp = JSON.parse(readFileSync(grandparentPkg, 'utf8'))
      if (gp.name && gp.name !== 'ai-page-dive') return false // 嵌套在宿主包里
    }
  } catch { /* 读不到按顶层处理 */ }
  return true
}

async function main(): Promise<void> {
  // 0) 显式逃生门：开发/CI 可主动禁用
  if (process.env.PAGEDIVE_SKIP_POSTINSTALL) return

  // 1) 全局判定先行（最重要的一条顺序约束）：本地/monorepo/CI 一律静默，
  //    连「平台不支持」也不打印——Linux 贡献者的 npm install 不该看到 macOS 营销
  if (!detectGlobalInstall(process.env, pkgDir)) return
  if (!isTopLevelGlobal(pkgDir)) return

  // 2) CI/Docker：无人阅读，静默（root 守卫的两行指引在 CI 里只是日志噪音）
  if (process.env.CI) return

  // 3) v1 仅 macOS（到这里才打印：确实是全局安装了但平台不对的真实用户）
  if (process.platform !== 'darwin') {
    log('当前平台非 macOS，v1 暂不支持，已跳过自动注册。')
    return
  }

  // 4) dist 未构建（半构建 tarball——prepack 应已拦住，此处双保险）→ 跳过
  if (!existsSync(join(pkgDir, 'dist', 'index.js'))) {
    log('安装产物不完整，已跳过自动注册；请在扩展面板按提示操作。')
    return
  }

  // 5) root/sudo 守卫：root 写出的 manifest/wrapper 属主为 root，后续普通用户
  //    幂等重写会 EACCES 死锁。不做 SUDO_USER 换算（跨用户属主是新的失败面）。
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    log('检测到以 root/sudo 运行，已跳过自动注册（避免写坏用户目录属主）。')
    log('建议：用 nvm/Homebrew 的 Node 以普通用户重装（npm i -g ai-page-dive，无需 sudo）。')
    pointToPanel()
    return
  }

  // 6) 静默注册：安静版 install（无 CLI 探测输出），origins 为空属预期——
  //    Chrome 对未登记扩展报 forbidden，由面板引导补一条短命令（含真实扩展 ID）
  //    （yarn v1 全局用户：detectGlobalInstall 的 yarn 路径特征命中即注册；
  //     识别不了的包管理器落守卫 1 静默跳过，面板完整命令兜底）
  try {
    const written = await registerManifests([], true)
    if (!written.length) {
      log('未发现 Chrome 数据目录（Chrome 未启动过？）。启动一次 Chrome 后，回到扩展面板按提示操作。')
      return
    }
    log('NM host 已自动注册（许可名单为空属预期）。')
    pointToPanel()
  } catch (e) {
    log(`自动注册失败（不影响安装）: ${e instanceof Error ? e.message : String(e)}`)
    pointToPanel()
  }
}

// 永不阻塞安装：吞掉一切异常（deliberately swallow: must never block install）
main().catch((e) => {
  log(`postinstall 异常（已忽略）: ${e instanceof Error ? e.message : String(e)}`)
})
