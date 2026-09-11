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
    const { install } = await import('./install.js')
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
  default:
    console.log(`pagedive host ${HOST_VERSION}\n  ai-page-dive install [--ext-id <id>]\n  pagedive probe\n  pagedive --stdio`)
}
