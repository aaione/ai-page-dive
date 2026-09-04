#!/usr/bin/env node
/**
 * 真机验证 action → sidePanel.open()（含 reload 后）。
 * 触发：osascript 系统级 ⌥⇧P（CDP 合成键不触发 extension command）。
 * 观测：runtime.getContexts(SIDE_PANEL)（getViews 在新 Chromium 已移除）+ SW 探针。
 */
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '/Users/apple/.nvm/versions/node/v24.15.0/lib/node_modules/@playwright/mcp/node_modules/playwright-core/index.mjs'

const EXT = '/Users/apple/work/hs/ai-feature/page-dive/apps/extension/dist'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const APP = 'Google Chrome for Testing'

spawnSync('pnpm', ['--filter', '@ai-page-dive/extension', 'build'], { stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname })

const server = createServer((_req, res) => {
  res.end('<html><body><h1>PageDive verify</h1></body></html>')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port

const PROFILE = mkdtempSync(join(tmpdir(), 'pd-verify-'))
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  executablePath: `/Users/apple/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/${APP}.app/Contents/MacOS/${APP}`,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check'],
})
const page = await ctx.newPage()
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })

async function waitSw(timeoutMs = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    for (const sw of ctx.serviceWorkers()) {
      if (!sw.url().endsWith('background.js')) continue
      // 排除 stale：evaluate 探活失败即旧实例，跳过
      const alive = await sw.evaluate(() => true).then(() => true).catch(() => false)
      if (alive) return sw
    }
    await sleep(200)
  }
  throw new Error('SW not found（快捷键没唤醒 SW = 按键没送达或 onClicked 没注册）')
}

function pressShortcut() {
  spawnSync('osascript', ['-e', `
    tell application "${APP}" to activate
    delay 0.3
    tell application "System Events" to keystroke "p" using {option down, shift down}
  `])
}

async function trigger(label) {
  pressShortcut()
  const sw = await waitSw()
  await sleep(2000)
  const st = await sw.evaluate(async () => {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })
    return { panelOpen: ctxs.length > 0, probe: self.__pdProbe ?? [] }
  })
  console.log(`${label}: panelOpen=${st.panelOpen}`)
  console.log(`  probe: ${JSON.stringify(st.probe)}`)
  return st.panelOpen
}

const n1 = await trigger('round1 (fresh load)')

// reload = 完整模拟用户路径：chrome://extensions 页面上点「重新加载」按钮
{
  const extPage = await ctx.newPage()
  await extPage.goto('chrome://extensions/')
  await sleep(800)
  // 点击目标扩展卡片上的 reload 按钮（shadow DOM 深处的 extensions-manager）
  await extPage.evaluate(() => {
    const mgr = document.querySelector('extensions-manager')
    const item = mgr?.shadowRoot?.querySelector('extensions-item-list')
      ?.shadowRoot?.querySelector('extensions-item')
    const reload = item?.shadowRoot?.querySelector('#dev-reload-button')
    if (!reload) throw new Error('reload button not found')
    reload.click()
  })
  await sleep(2500)
  await extPage.close()
}
const n2 = await trigger('round2 (after reload)')

server.close()
await ctx.close()
console.log(n1 && n2 ? 'PASS' : 'FAIL')
process.exit(n1 && n2 ? 0 : 1)
