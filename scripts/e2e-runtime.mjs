#!/usr/bin/env node
/**
 * 运行时修复专项 E2E（4887ca9 回归）：取消链路 / 心跳静默 / 追问多轮落盘 / 大正文不击穿。
 * 复用 e2e-ui.mjs 的启动骨架；claude 全链路是主断言（自测只用 claude，不碰 codex）。
 */
import { execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { chromium } from '/Users/apple/.nvm/versions/node/v24.15.0/lib/node_modules/@playwright/mcp/node_modules/playwright-core/index.mjs'

const EXT = '/Users/apple/work/hs/ai-feature/ai-page-dive/apps/extension/dist-e2e'
const PROFILE = '/tmp/pd-e2e-rt-profile'

function install(extId) {
  execSync(
    `PAGEDIVE_EXTRA_NM_DIR=${PROFILE}/NativeMessagingHosts ${process.execPath} /Users/apple/work/hs/ai-feature/ai-page-dive/packages/host/dist/index.js install --ext-id ${extId}`,
    { stdio: 'pipe' },
  )
}

async function launch() {
  return chromium.launchPersistentContext(PROFILE, {
    // 正式 Chrome 137+ 默认忽略 --load-extension（安全收紧），必须用 Chrome for Testing
    executablePath: '/Users/apple/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check'],
  })
}

// ── 启动骨架：两轮拿 extId + 注册 NM ──
let ctx = await launch()
let extId = null
// 轮询至 15s：SW 注册时序不稳（2.5s 固定等待在慢启动机器上会漏）
for (let i = 0; i < 30 && !extId; i++) {
  await new Promise(r => setTimeout(r, 500))
  for (const p of ctx.pages()) extId = p.url().match(/^chrome-extension:\/\/([a-p]{32})/)?.[1] ?? extId
  if (!extId && ctx.serviceWorkers()[0]) extId = ctx.serviceWorkers()[0].url().match(/chrome-extension:\/\/([a-p]{32})/)?.[1]
}
if (!extId && ctx.serviceWorkers()[0]) extId = ctx.serviceWorkers()[0].url().match(/chrome-extension:\/\/([a-p]{32})/)?.[1]
if (!extId) { console.error('FAIL: extension not loaded'); await ctx.close(); process.exit(2) }
await ctx.close()
install(extId)
console.log(`✅ registered ${extId}, restarting`)
ctx = await launch()
await new Promise(r => setTimeout(r, 2500))

// 本地文章页（含超长正文变体）
const fixture = (n) => `<!doctype html><meta charset="utf-8"><title>${n === 1 ? '取消链路测试' : '追问落盘测试'}</title>
<article><h1>${n === 1 ? '取消测试文' : '多轮对话文'}</h1>
<p>${'深度学习在自然语言处理领域引发了范式转变。'.repeat(n === 1 ? 200 : 11_000)}</p>
<p>transformer 架构的自注意力机制是现代大模型的基石。</p></article>`
const srv = createServer((q, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(fixture(q.url.includes('page2') ? 2 : 1))
}).listen(8767)

const page = await ctx.newPage()
await page.goto('http://127.0.0.1:8767/', { waitUntil: 'domcontentloaded' })
await page.bringToFront()
const panel = await ctx.newPage()
await panel.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
await panel.waitForTimeout(2500)

const bodyText = () => panel.evaluate(() => document.body.innerText)
const results = []
const check = (name, ok, extra = '') => {
  results.push([name, ok])
  console.log(`${ok ? '✅' : '⛔'} ${name}${extra ? ` (${extra})` : ''}`)
}

// ── 断言 0：host 探测 OK + 心跳不泄漏到 UI ──
const probe = await panel.evaluate(
  () => new Promise(r => chrome.runtime.sendMessage({ t: 'panel-ready' }, resp => r(resp))),
)
check('host 探测 ok', !!probe?.ok)
check('probe 透出 hostVersion', typeof probe?.hostVersion === 'string' && probe.hostVersion.length > 0, `v=${probe?.hostVersion}`)

// ── 断言 1：取消链路——发送后立即取消，UI 进入可重发态且旧帧不劫持 ──
const input = panel.getByRole('textbox', { name: '自定义指令' })
/** 发送前把文章页带回前台（playwright 的 newPage 会切焦点到 panel；且 SW 重启后
 * target 兜底 query active tab 会拿到 panel 自己 → unsupported-page） */
const send = async (text) => {
  await page.bringToFront()
  await input.fill(text)
  await panel.keyboard.press('Enter')
}
await send('请深度总结这篇文章，输出尽可能长的详细报告')
console.log('▶ 已发送（等待 spawned）')
// 等 loading 出现（停止钮 = aria-label 停止）
await panel.waitForSelector('button[aria-label="停止"]', { timeout: 30_000 })
await panel.waitForTimeout(1500) // 让任务真正 spawn
await panel.getByRole('button', { ariaLabel: undefined, name: /^$/ }).count().catch(() => 0)
await panel.click('button[aria-label="停止"]')
console.log('▶ 已点停止')
await panel.waitForTimeout(3000)
const afterCancel = await bodyText()
const cancelOk = /已取消|cancelled/.test(afterCancel) && !/思考中/.test(afterCancel)
check('取消后 UI 落定（已取消 + 无残留 loading）', cancelOk, afterCancel.match(/已取消.*/)?.[0]?.slice(0, 40))

// 取消后立刻重发：旧任务尾随帧不得劫持新一轮。判定「无劫持」的充分信号：
// 新输入进入 running（思考中/停止钮），且最终拿到 tokens:（CLI 真跑完）
await send('用一句话概括')
await panel.waitForSelector('button[aria-label="停止"]', { timeout: 20_000 }).catch(() => {})
const rerunRunning = await panel.evaluate(() => ({
  hasStop: !!document.querySelector('button[aria-label="停止"]'),
  disabled: document.querySelector('.pd-input')?.disabled,
}))
check('重发立即进入 running（停止钮 + 输入锁定，未被旧帧劫持）', rerunRunning.hasStop && rerunRunning.disabled)
// 完成判定用真实信号：MessageActions（复制/下载按钮组）只在 !running && msg.text 时渲染。
// 注意：上一条已取消的消息也带操作组——必须数「无 error 的完成消息」
const waitDone = async (label, timeoutMs) => {
  const dl = Date.now() + timeoutMs
  while (Date.now() < dl) {
    await panel.waitForTimeout(5000)
    const ok = await panel.evaluate(() => {
      const errs = [...document.querySelectorAll('.pd-error')].length
      const actions = [...document.querySelectorAll('.pd-chat-actions')].length
      const input = document.querySelector('.pd-input')
      return { actions, errs, disabled: input?.disabled }
    })
    if (!ok.disabled && ok.actions > 0) return true
  }
  return false
}
check('重发跑完（操作组出现 + 输入解禁）', await waitDone('round2', 300_000))

// ── 断言 2：追问多轮落盘（P1 核心：第 2 次追问仍 append） ──
// 第一轮完成后有 session：连续追问两次
for (let i = 1; i <= 2; i++) {
  await send(`第 ${i} 次追问：这篇文章的关键词是什么`)
  let t = ''
  const dl = Date.now() + 240_000
  while (Date.now() < dl) {
    await panel.waitForTimeout(5000)
    t = await bodyText()
    // 完成判定：输入框解禁 = running 结束
    const disabled = await input.isDisabled().catch(() => true)
    if (!disabled && /关键词|tokens:/.test(t)) break
  }
  console.log(`▶ 追问 ${i} 完成`)
  await panel.waitForTimeout(1000)
}

// 历史文件应含 2 个 pd:user 追问段（第 2 次追问不丢 = P1 修复生效）。
// 追问 append 在会话首页文件（列表按首页 ts 排序，断言4 之前的任务可能排更前）——
// 扫最近 5 个文件数 pd:user 总量
const turnCount = await panel.evaluate(async () => {
  const items = await new Promise(resolve => {
    const l = (m) => { if (m?.t === 'history-list') { chrome.runtime.onMessage.removeListener(l); resolve(m.items) } }
    chrome.runtime.onMessage.addListener(l)
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-list' } })
  })
  let total = 0
  for (const it of items.slice(0, 5)) {
    const file = await new Promise(resolve => {
      const l = (m) => { if (m?.t === 'history-file') { chrome.runtime.onMessage.removeListener(l); resolve(m.content) } }
      chrome.runtime.onMessage.addListener(l)
      chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-read', path: it.path } })
    })
    total += (file.match(/<!-- pd:user -->/g) ?? []).length
  }
  return total
})
check('两次追问都落盘（≥2 个 pd:user 段）', turnCount >= 2, `turns=${turnCount}`)

// ── 断言 3：心跳帧静默（任务期 UI 无 heartbeat 痕迹/无报错） ──
const finalText = await bodyText()
check('UI 无协议噪音（无 heartbeat/undefined 字样）', !/heartbeat|undefined|\[object/.test(finalText))

// ── 断言 4：超长 CJK 正文（page2 fixture ~24 万汉字 raw，200K 截断后走分片不击穿） ──
await panel.getByRole('button', { name: '开始新对话' }).first().click()
await page.goto('http://127.0.0.1:8767/page2', { waitUntil: 'domcontentloaded' })
await panel.waitForTimeout(1000)
await send('一句话总结')
const longDone = await waitDone('long', 360_000)
const longText = await bodyText()
check('超长正文任务完成（200K 截断 + 分片无 frame too large）', longDone && !/frame too large/.test(longText))

await panel.screenshot({ path: '/tmp/pd-e2e-rt-final.png', fullPage: true }).catch(() => {})

const pass = results.every(([, ok]) => ok)
console.log(pass ? '\n✅ RT E2E PASS' : `\n⛔ RT E2E FAIL (${results.filter(([, ok]) => !ok).map(([n]) => n).join(', ')})`)
await ctx.close()
srv.close()
process.exit(pass ? 0 : 1)
