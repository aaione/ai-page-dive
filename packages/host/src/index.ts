#!/usr/bin/env node
/** pagedive host 入口：--stdio（NM）/ install / probe */
import { runNative } from './stdio.js'
import { HOST_VERSION } from './version.js'

const [cmd, ...rest] = process.argv.slice(2)

switch (cmd) {
  case '--stdio':
    runNative()
    break
  case 'install': {
    const { install } = await import('./scripts/install.js')
    const ids = rest.flatMap((a, i, arr) => (a === '--ext-id' ? [arr[i + 1]] : [])).filter(Boolean)
    await install(ids)
    break
  }
  case 'probe': {
    const { probeAgents } = await import('./agents/registry.js')
    const agents = await probeAgents()
    for (const a of agents) {
      console.log(a.available ? `✅ ${a.id} ${a.version ?? ''}` : `⛔ ${a.id} 未安装`)
    }
    break
  }
  case 'uninstall': {
    // r52（review #5）：卸载出口——preuninstall 钩子与手动清理共用
    const { uninstall } = await import('./scripts/uninstall.js')
    uninstall()
    break
  }
  default:
    // r54（#12）：bin 名统一为 npm 实名 ai-page-dive——pagedive 是旧名残留，
    // 用户照抄 `pagedive probe` 会 command not found
    console.log(`ai-page-dive host ${HOST_VERSION}\n  ai-page-dive install [--ext-id <id>]\n  ai-page-dive uninstall\n  ai-page-dive probe\n  ai-page-dive --stdio`)
}
