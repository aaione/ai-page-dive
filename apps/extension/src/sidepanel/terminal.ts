import type { TerminalCode } from '@ai-page-dive/shared'

/** r74（r73 code high#2/low#8）：终局三件套从 App.tsx 拆出——UNDELIVERED_CODES.has
 *  生产逻辑此前零测试执行（App 组件全仓零直测，tips 测试手搓 props），纯函数化后
 *  terminal.test.ts 直测；App.tsx 同步瘦身（r73 膨胀挂账部分清账）。 */

export const ERROR_LABEL: Partial<Record<TerminalCode, string>> = {
  'spawn-fail': 'CLI 启动失败——终端跑一次 which claude / which codex 确认已安装，或用官方安装器重装后重试',
  // r76（r75 code medium#3）：运行期崩溃拆码——spawn 已成功、正文已过 stdin，
  // 不入 UNDELIVERED_CODES（已送达的生成阶段失败），tips 不再误标「分享未成功」
  'runtime-error': 'CLI 运行中异常退出——本次总结未完成，请重试',
  // r52（review #16）：完整用户向文案——host 原始英文 "task exceeded 10min" 不再
  // 拼进气泡（task-error 分支的 timeout 专用处理 + console.debug 维护者通道）
  timeout: '任务超时（上限 10 分钟）——你的问题已放回输入框（未覆盖已有草稿），可直接重发',
  cancelled: '已取消',
  parse: 'CLI 输出异常',
  'no-agent': '未知 CLI',
  'bad-request': '请求参数不完整',
  'content-mismatch': '正文传输不完整，已取消——请重试',
  'host-shutting-down': '本机组件正在重启',
  // r72（r71 code C3）：断连收件箱码（sw.ts emitTerminal code:'host-disconnected'）——
  // 此前不在表内，missedErrBubble 兜底渲染成「未知错误（码 host-disconnected）」
  'host-disconnected': '本机组件连接中断——请重试',
  // r55（#10）：SW 冷启动把孤儿任务指针折算成的终局（扩展更新/重载打断在跑任务）
  'ext-restarted': '扩展更新或重启打断了进行中的任务——请重新发起',
  // r80 审计：收件箱补发通道（missedErrBubble 只查本表）——r80(A) 运行期 session-lost
  // 只加了 START_FAIL_LABEL，面板收起重开落「未知错误（码 session-lost）: 裸英文」
  //（r72 host-disconnected 同型复发的教训：两表都要有可达码的键）
  'session-lost': '上轮会话已失效——直接重新发送即可（将开始全新总结）',
}

/** r76（r75 product high#3）：启动前失败族（SW onStartResult return error / 同码
 *  task-error 帧）文案单一事实源——此前 14 键内联在 App.tsx send 回调，帧通道查
 *  ERROR_LABEL 落「未知错误（码 no-permission）: 原始英文」，同一失败双通道两副
 *  面孔。两通道同查本表；detail（原始英文）由回调通道句尾拼接，帧通道不拼。 */
export const START_FAIL_LABEL: Partial<Record<TerminalCode, string>> = {
  'host-not-found-retry': '本机组件连接闪断——通常已自动恢复，请重试',
  'no-tab': '没有可总结的页面（先在普通网页上点扩展图标）',
  'unsupported-page': '浏览器内置页面无法提取（chrome:// 等）',
  'pdf-page': 'PDF 页面暂不支持总结——转存为 HTML 页面，或复制正文粘贴为附件后直接追问',
  'inject-failed': '扩展文件加载失败（content.js 缺失——多为更新或加载不完整）——请在 chrome://extensions 刷新 PageDive 后重试',
  'tab-closed': '刚看的页面已关闭——在要总结的页面上重试',
  'page-not-ready': '页面尚未就绪（或正在显示错误页）——刷新页面后重试',
  'extract-crash': '页面脚本冲突导致提取失败——可重试，或粘贴正文作为附件直接追问',
  'no-permission': '本页尚未授权提取（换页后授权失效）——点工具栏上的 PageDive 图标后重试，或开启「始终允许」一劳永逸',
  'empty-content': '页面没有可提取的正文——等页面加载完成（或滚动到底部触发懒加载）后重试；也可粘贴正文作为附件直接追问',
  cancelled: '已取消',
  'empty-instruction': '请输入要追问的内容（或直接点「新对话」重新总结本页）',
  // r80(A)：文案去「扩展服务重启」限定——同码现在双触发（SW 会话丢失 / CLI 侧
  // resume 目标丢失），通用措辞两边都如实
  'session-lost': '上轮会话已失效——直接重新发送即可（将开始全新总结）',
  'frame-too-large': '内容过长（输入 + 附件超出单帧 1MB 上限）——精简附件或缩短输入后重试',
}

/** r71（r70 product C9/L3）：终局「页面未送达 CLI」code 集——tips 分流依据。
 *  timeout/parse/is_error/ext-restarted 等已送达（正文已过 stdin）的生成阶段失败
 *  不在集内；cancelled 走独立「已停止」态也不在集内。r72（r71 code C6）收编
 *  content-mismatch：SW 侧该终局=正文对账超时即取消（spawn 前），CLI 从未收到
 *  完整正文——是典型未送达而非已送达失败。r74（r73 code low）收编
 *  host-shutting-down：host 关闭收割窗内拒收 task-start，正文从未过 stdin。
 *  r76（r75 code medium#4）点名 host-disconnected 不收编：断连时正文已过
 *  stdin（已送达），tips 不标「分享未成功」——App 实时/收尾/missed 三路径
 *  统一走 stampTerminal 同值。 */
const UNDELIVERED_CODES = new Set<TerminalCode>([
  'no-tab', 'unsupported-page', 'pdf-page', 'inject-failed', 'tab-closed', 'page-not-ready',
  'extract-crash', 'no-permission', 'empty-content', 'frame-too-large', 'host-not-found',
  'host-not-found-retry', 'spawn-fail', 'no-agent', 'bad-request', 'empty-instruction',
  'session-lost', 'content-mismatch', 'host-shutting-down',
])

/** r74（r73 code low#8 + high#2）：终局三戳单一事实源——cancelled/undelivered/
 *  cliFault 判定此前散布 4 落点且形态漂移（实时分支两排除、missed 三排除、
 *  onStartResult 带冗余前置）。统一对齐 missed 最全版；ext-restarted 实时不可达
 *  （SW 冷启动孤儿指针折算必走 missed 路径），收敛零行为变化。
 *  code?: string 边界诚实——跨进程来的运行时即 string，闭集外新码落
 *  undelivered:false + cliFault:true（App 侧另有「未知错误」文案兜底）。 */
export function stampTerminal(code?: string): { cancelled: boolean; undelivered: boolean; cliFault: boolean } {
  return {
    cancelled: code === 'cancelled',
    undelivered: UNDELIVERED_CODES.has((code ?? '') as TerminalCode),
    cliFault: code !== 'cancelled' && code !== 'content-mismatch' && code !== 'ext-restarted',
  }
}
