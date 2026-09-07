#!/usr/bin/env node
/**
 * opencode 浏览器级验证：加载 dist-e2e 扩展 → 打开文章页 → 面板选 opencode → 总结 → 验证流式输出。
 * 复用 e2e.mjs 启动骨架；自测用本地 opencode（用户要求优先使用本地 opencode）。
 */
import { execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { chromium } from '/Users/apple/.nvm/versions/node/v24.15.0/lib/node_modules/@playwright/mcp/node_modules/playwright-core/index.mjs'

const EXT = '/Users/apple/work/hs/ai-feature/page-dive/apps/extension/dist-e2e'
const PROFILE = '/tmp/pd-e2e-opencode-profile'

function install(extId) {
  execSync(
    `PAGEDIVE_EXTRA_NM_DIR=${PROFILE}/NativeMessagingHosts ${process.execPath} /Users/apple/work/hs/ai-feature/page-dive/packages/host/dist/index.js install --ext-id ${extId}`,
    { stdio: 'pipe' },
  )
}

async function launch() {
  return chromium.launchPersistentContext(PROFILE, {
    executablePath: process.env.PD_CHROME
      ? process.env.PD_CHROME
      : '/Users/apple/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check'],
  })
}

// 轮次 1：拿扩展 ID
let ctx = await launch()
await new Promise(r => setTimeout(r, 2500))
let extId = null
for (const p of ctx.pages()) extId = p.url().match(/^chrome-extension:\/\/([a-p]{32})/)?.[1] ?? extId
if (!extId && ctx.serviceWorkers()[0]) extId = ctx.serviceWorkers()[0].url().match(/chrome-extension:\/\/([a-p]{32})/)?.[1]
if (!extId) { console.error('FAIL: extension not loaded'); await ctx.close(); process.exit(2) }
await ctx.close()
install(extId)
console.log(`✅ registered ${extId}, restarting browser`)
ctx = await launch()
await new Promise(r => setTimeout(r, 2500))

// 文章页 + panel
const page = await ctx.newPage()
const srv = createServer((_q, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(readFileSync(new URL('./fixtures/article.html', import.meta.url)))
}).listen(8767)
await page.goto('http://127.0.0.1:8767/', { waitUntil: 'domcontentloaded' })
await page.bringToFront()
const panel = await ctx.newPage()
await panel.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
await panel.waitForTimeout(2500)

const bodyText = () => panel.evaluate(() => document.body.innerText)

// ── 断言 0：host 探测 + opencode 可用 ──
const probeOk = await panel.evaluate(
  () => new Promise(r => chrome.runtime.sendMessage({ t: 'panel-ready' }, resp => r(!!resp?.ok))),
)
const t0 = await bodyText()
console.log(`host=${probeOk} 面板文本: ${t0.split('\n').slice(0, 6).join(' | ')}`)

// 通过 SW list-agents 拿 opencode 可用性
const agents = await panel.evaluate(async () => {
  const l = (m) => { if (m?.t === 'agents') { chrome.runtime.onMessage.removeListener(l); resolve(m.agents) } }
  let resolve
  chrome.runtime.onMessage.addListener(l)
  chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'list-agents' } })
  return new Promise(r => { resolve = r })
})
const oc = agents.find(a => a.id === 'opencode')
console.log(`opencode available=${!!oc?.available} version=${oc?.version ?? ''}`)
if (!oc?.available) {
  console.error('⛔ FAIL: opencode 不可用'); await ctx.close(); process.exit(1)
}

// ── 断言 1：面板选 opencode + workflow，总结完成 ──
// model dropdown: aria-label="选择 CLI 模型"
await panel.getByRole('button', { name: '选择 CLI 模型' }).click()
await panel.getByRole('option', { name: /^opencode/ }).click()
await page.bringToFront()
await panel.getByRole('button', { name: '深度总结当前页' }).click({ timeout: 10_000 })
console.log('▶ opencode 总结已点击')

let summary = ''
const deadline = Date.now() + 240_000
try {
  while (Date.now() < deadline) {
    await panel.waitForTimeout(5000)
    const t = await bodyText()
    if (/tokens:|CLI 报告运行失败|启动失败|超时|已取消|无提取权限|没有可总结|无法提取|没有可提取|CLI 输出异常/.test(t)) { summary = t; break }
  }
  summary ||= await bodyText()
} catch (e) {
  console.log(`⚠️ 浏览器轮询中断: ${String(e?.message ?? e)}`)
  // 诊断：opencode 进程是否在跑、面板最后状态
  const { execSync } = await import('node:child_process')
  try {
    const ps = execSync("ps aux | grep -iE 'opencode run|opencode' | grep -v grep | head -5").toString()
    console.log('opencode 进程:\n' + ps)
  } catch { console.log('(无 opencode 进程存活)') }
  summary = await bodyText().catch(() => '(browser closed, 无法读取面板)')
}
console.log('=== panel tail ===')
console.log(summary.slice(-600))

const done = /tokens:/.test(summary) && !/CLI 报告运行失败|启动失败|CLI 输出异常|恶意软件/.test(summary)
console.log(done ? '✅ opencode 总结链路完成' : '⛔ opencode 链路失败')

// 截图存档
await panel.screenshot({ path: '/tmp/pd-e2e-opencode-panel.png', fullPage: true }).catch(() => {})

console.log(done ? '\n✅ OPENCODE E2E PASS' : '\n⛔ OPENCODE E2E INCOMPLETE')
await ctx.close()
srv.close()
process.exit(done ? 0 : 1)
