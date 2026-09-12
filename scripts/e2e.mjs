#!/usr/bin/env node
/**
 * 浏览器 E2E：加载 PageDive 扩展 → 开文章页 → 面板一键总结 → 验证流式输出与历史。
 * 关键顺序：Chromium 启动时枚举 NM hosts → 必须先写 manifest 再启动浏览器。
 */
import { execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { chromium } from '/Users/apple/.nvm/versions/node/v24.15.0/lib/node_modules/@playwright/mcp/node_modules/playwright-core/index.mjs'

// E2E 变体构建（广权限）到 dist-e2e；产品 dist 不动。
// 失败即退出：filter 名失配曾静默跑旧 dist-e2e 两天（@pagedive → @ai-page-dive 改名漏改），
// E2E 虚假绿灯比不跑更危险
import { spawnSync } from 'node:child_process'
const EXT = '/Users/apple/work/hs/ai-feature/ai-page-dive/apps/extension/dist-e2e'
const build = spawnSync('pnpm', ['--filter', '@ai-page-dive/extension', 'build:e2e'], {
  stdio: 'pipe',
  cwd: '/Users/apple/work/hs/ai-feature/ai-page-dive',
})
if (build.status !== 0) {
  console.error('[e2e] build:e2e 失败:\n' + build.stdout + '\n' + build.stderr)
  process.exit(1)
}
// 扩展 ID 由 dist 内容 hash 决定（无 key 时）；先启动一次拿不到——所以首轮用
// 轮询策略：启动 → 拿 ID → 若与已注册 ID 不同则注册并重启浏览器。
const PROFILE = '/tmp/pd-e2e-profile'

function install(extId) {
  execSync(
    `PAGEDIVE_EXTRA_NM_DIR=${PROFILE}/NativeMessagingHosts ${process.execPath} /Users/apple/work/hs/ai-feature/ai-page-dive/packages/host/dist/index.js install --ext-id ${extId}`,
    { stdio: 'pipe' },
  )
}

function registeredIds() {
  try {
    const m = JSON.parse(
      execSync(`cat "${PROFILE}/NativeMessagingHosts/com.pagedive.host.json"`).toString(),
    )
    return m.allowed_origins.map((o) => o.match(/chrome-extension:\/\/(.+)\//)[1])
  } catch {
    return []
  }
}

async function launch() {
  return chromium.launchPersistentContext(PROFILE, {
    executablePath: '/Users/apple/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check'],
  })
}

// 轮次 1：启动拿扩展 ID
let ctx = await launch()
await new Promise(r => setTimeout(r, 2500))
let extId = null
for (const p of ctx.pages()) {
  extId = p.url().match(/^chrome-extension:\/\/([a-p]{32})/)?.[1] ?? extId
}
if (!extId && ctx.serviceWorkers()[0]) {
  extId = ctx.serviceWorkers()[0].url().match(/chrome-extension:\/\/([a-p]{32})/)?.[1]
}
if (!extId) { console.error('FAIL: extension not loaded'); await ctx.close(); process.exit(2) }
await ctx.close()
// 无条件注册 + 重启：Chromium 启动时枚举 NM hosts，manifest 必须在启动前就位
install(extId)
console.log(`✅ registered ${extId}, restarting browser`)
ctx = await launch()
await new Promise(r => setTimeout(r, 2500))

// 打开文章页 + panel
// E2E 无法伪造 action 手势：先让页面成为当前 tab，再经 SW 消息设 target（与 action 同语义）
const page = await ctx.newPage()
const srv = createServer((_q, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(readFileSync(new URL('./fixtures/article.html', import.meta.url)))
}).listen(8765)
await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' })
await page.bringToFront()
// SW eval：模拟 action 点击的 target 赋值（绕过浏览器 UI 的 E2E 通道）
const sw = ctx.serviceWorkers()[0]
await sw.evaluate(async (tabId) => {
  // 与 action.onClicked 相同语义：target = 被总结的 tab
  chrome.tabs.get(tabId).then(t => {
    // 直接触发已在监听器之外，这里 eval 不能碰闭包 target——改用消息
  })
}, page.pageId).catch(() => {})
const panel = await ctx.newPage()
await panel.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
await panel.waitForTimeout(2000)

const st = await panel.evaluate(async () => {
  // 直接问 SW 要 probe 详情
  const resp = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ t: 'panel-ready' }, (r) => {
      void chrome.runtime.lastError
      resolve(r)
    })
  })
  return { probe: JSON.stringify(resp), text: document.body.innerText.slice(0, 200) }
})
console.log('panel state:', JSON.stringify(st))

// 点击总结（先把 http 页带回前台：SW fallback 以 active tab 为目标）。
// 聊天式 UI：主按钮 aria-label「发送」，空输入 disabled——先填指令再发送
await page.bringToFront()
await panel.getByRole('textbox', { name: '自定义指令' }).fill('用三句话总结这个页面', { timeout: 10_000 })
await panel.getByRole('button', { name: '发送' }).click({ timeout: 10_000 })
console.log('▶ summarize clicked')

// 完成态 = 气泡收尾（MessageActions 动作条渲染）或任一错误文案。
// （旧判定 /tokens:/ 已失效：聊天式 UI 不再渲染 tokens 行）
const deadline = Date.now() + 300_000
let ended = false
while (Date.now() < deadline) {
  await panel.waitForTimeout(4000)
  const st = await panel.evaluate(() => ({
    done: !!document.querySelector('.pd-chat-actions'), // 收尾气泡的动作条（复制/下载）
    err: /CLI 报告运行失败|启动失败|响应超时|已取消|无提取权限|没有可总结|无法提取|没有可提取|页面没有可提取/.test(document.body.innerText),
  }))
  if (st.done || st.err) { ended = true; break }
}
if (!ended) console.log('⚠ 5min 未观测到终局（可能仍在生成）')

const summary = await panel.evaluate(() => document.body.innerText)
console.log('=== panel tail ===')
console.log(summary.slice(-1200))

// 历史视图
const hist = await panel.evaluate(async () => {
  const btns = [...document.querySelectorAll('button')]
  btns.find(b => b.textContent === '历史')?.click()
  await new Promise(r => setTimeout(r, 2000))
  return document.body.innerText.slice(0, 500)
})
console.log('=== history ===')
console.log(hist)

// 判定：有收尾气泡动作条（真实输出完成）且无错误文案
const finalState = await panel.evaluate(() => ({
  hasActions: !!document.querySelector('.pd-chat-actions'),
  hasError: /CLI 报告运行失败|启动失败|响应超时|已取消/.test(document.body.innerText),
}))
const pass = finalState.hasActions && !finalState.hasError
console.log(pass ? '\n✅ E2E PASS' : '\n⛔ E2E INCOMPLETE')

// 截图存档
await panel.screenshot({ path: '/tmp/pd-e2e-panel.png', fullPage: true }).catch(() => {})
await ctx.close()
process.exit(pass ? 0 : 1)
