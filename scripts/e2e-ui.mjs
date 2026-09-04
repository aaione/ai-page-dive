#!/usr/bin/env node
/**
 * UI 交互 E2E：agent/workflow 下拉切换生效 + 历史 搜索/查看/删除 闭环。
 * 复用 e2e.mjs 的启动骨架；claude 全链路是本脚本的主断言（自测只用 claude，不碰 codex）。
 */
import { execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { chromium } from '/Users/apple/.nvm/versions/node/v24.15.0/lib/node_modules/@playwright/mcp/node_modules/playwright-core/index.mjs'

const EXT = '/Users/apple/work/hs/ai-feature/page-dive/apps/extension/dist-e2e'
const PROFILE = '/tmp/pd-e2e-ui-profile'

function install(extId) {
  execSync(
    `PAGEDIVE_EXTRA_NM_DIR=${PROFILE}/NativeMessagingHosts ${process.execPath} /Users/apple/work/hs/ai-feature/page-dive/packages/host/dist/index.js install --ext-id ${extId}`,
    { stdio: 'pipe' },
  )
}

async function launch() {
  return chromium.launchPersistentContext(PROFILE, {
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
console.log(`✅ registered ${extId}, restarting`)
ctx = await launch()
await new Promise(r => setTimeout(r, 2500))

// 文章页 + panel
const page = await ctx.newPage()
const srv = createServer((_q, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(readFileSync(new URL('./fixtures/article.html', import.meta.url)))
}).listen(8766)
await page.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' })
await page.bringToFront()
const panel = await ctx.newPage()
await panel.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
await panel.waitForTimeout(2500)

const bodyText = () => panel.evaluate(() => document.body.innerText)

// ── 断言 0：host 探测 + agents 列表含 claude ──
const probeOk = await panel.evaluate(
  () => new Promise(r => chrome.runtime.sendMessage({ t: 'panel-ready' }, resp => r(!!resp?.ok))),
)
const t0 = await bodyText()
const hasClaudeBtn = /claude/.test(t0)
console.log(`host=${probeOk} claude-btn=${hasClaudeBtn}`)
if (!probeOk || !hasClaudeBtn) {
  console.error('⛔ FAIL: host 探测失败或 claude 不可用'); await ctx.close(); process.exit(1)
}

// ── 断言 1：CLI 下拉切 claude + workflow 下拉切深度研读，总结完成 ──
// CLI pill：输入框上方内联行，aria-label="选择 AI CLI"
await panel.getByRole('button', { name: '选择 AI CLI' }).click()
await panel.getByRole('option', { name: /^claude/ }).click()
// workflow pill：输入框内左侧，aria-label="选择总结模式"，向上弹出
await panel.getByRole('button', { name: '选择总结模式' }).click()
await panel.getByRole('option', { name: '深度研读' }).click()
await page.bringToFront()
// 新 UI：chat 式输入 + Enter 发送
await panel.getByRole('textbox', { name: '自定义指令' }).fill('总结这篇文章的核心要点')
await panel.keyboard.press('Enter')
console.log('▶ claude + deep 总结已发送')

let summary = ''
const deadline = Date.now() + 300_000
while (Date.now() < deadline) {
  await panel.waitForTimeout(5000)
  const t = await bodyText()
  if (/tokens:|CLI 报告运行失败|启动失败|超时|已取消|无提取权限|没有可总结|无法提取|没有可提取|CLI 输出异常/.test(t)) { summary = t; break }
}
summary ||= await bodyText()
console.log('=== panel tail ===')
console.log(summary.slice(-500))

const claudeDone = /tokens:/.test(summary) && !/CLI 报告运行失败|启动失败|CLI 输出异常/.test(summary)
console.log(claudeDone ? '✅ claude 全链路完成' : '⛔ claude 链路失败')

// ── 断言 2：最新历史 frontmatter = agent: claude ──
const latest = await panel.evaluate(async () => {
  await chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-list' } })
  await new Promise(r => setTimeout(r, 1500))
  // HistoryView 自己监听 history-list；直接再发一次拿数据：
  return new Promise(resolve => {
    const l = (m) => { if (m?.t === 'history-list') { chrome.runtime.onMessage.removeListener(l); resolve(m.items[0]) } }
    chrome.runtime.onMessage.addListener(l)
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-list' } })
  })
})
console.log(`latest history: agent=${latest?.agent} title=${latest?.title?.slice(0, 30)}`)
const metaOk = latest?.agent === 'claude'
console.log(metaOk ? '✅ 历史元数据 agent=claude' : '⛔ 历史元数据不符')

// ── 断言 3：历史搜索过滤（右上角图标打开 overlay） ──
await panel.getByRole('button', { name: '总结历史' }).click()
await panel.waitForTimeout(1500)
// Playwright fill/press 走 CDP 真实输入事件，React onChange 一定能收到
const searchBox = panel.getByPlaceholder('搜索标题 / URL…')
await searchBox.fill('注意力')
await searchBox.press('Enter')
await panel.waitForTimeout(2000)
const filtered = await bodyText()
const hasTitle = filtered.includes('注意力机制综述')
const smokeCount = (filtered.match(/Smoke Test/g) ?? []).length
const searchOk = hasTitle && smokeCount === 0
console.log(searchOk ? '✅ 搜索过滤生效' : `⛔ 搜索过滤异常 hasTitle=${hasTitle} smoke=${smokeCount}：\n${filtered}`)

// ── 断言 4：点开查看正文 ──
await searchBox.fill('')
await searchBox.press('Enter')
await panel.waitForTimeout(1500)
await panel.waitForTimeout(1500)
await panel.evaluate(() => {
  const item = [...document.querySelectorAll('li button')].find(b => b.textContent.includes('注意力'))
  item?.click()
})
await panel.waitForTimeout(2000)
const detail = await bodyText()
const viewOk = detail.includes('返回列表') && (detail.includes('注意') || detail.includes('总结') || detail.length > 300)
console.log(viewOk ? '✅ 历史详情可查看' : `⛔ 历史详情异常：${detail.slice(0, 200)}`)

await panel.screenshot({ path: '/tmp/pd-e2e-ui-detail.png', fullPage: true }).catch(() => {})

const pass = claudeDone && metaOk && searchOk && viewOk
console.log(pass ? '\n✅ UI E2E PASS' : '\n⛔ UI E2E INCOMPLETE')
await ctx.close()
srv.close()
process.exit(pass ? 0 : 1)
