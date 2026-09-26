# Privacy Policy / 隐私政策

*Last updated: 2026-09-26*

PageDive（"AI PageDive" Chrome 扩展及其本机组件）按以下方式处理数据。核心承诺：**PageDive 没有服务器——你的网页内容只在扩展与本机 CLI 之间流转，不经我们中转，也不被我们存储。**（CLI 与其模型服务如何通信由该 CLI 自身的隐私政策决定，见下。）

## English Summary

PageDive has no servers, no accounts, and no API keys. When you click "summarize", the extension extracts the current page's content and sends it via Chrome Native Messaging directly to an AI CLI (claude / codex) installed and logged in on your own machine, where it is written to a local temp file for that CLI to read. We never transmit, intermediate, or store your content: no telemetry, no analytics, no crash reports. History, workflows, and skills live under `~/.ai-page-dive/` on your machine; follow-up session state stays in Chrome session storage (cleared on browser restart). The only outbound exit is user-initiated sharing (Settings → "Share"), which opens your chosen platform's share page with this product's link and name. How your CLI communicates with its model service is governed by that CLI's own privacy policy (claude → Anthropic, codex → OpenAI). The optional "always allow reading" host permission is off by default and granted only by explicit user action.

## 数据处理

- **网页正文与元数据**：扩展在你点击总结时提取当前页正文（Readability），经 Chrome Native Messaging 传给本机组件，写入本机临时文件供本机 AI CLI 读取。全程在本机完成。
- **你的输入与附件**：同样只在本机处理（附件为文本 ≤512KB/个 或 图片 ≤500KB/个，图片以 base64 传输）。
- **AI CLI**：PageDive 以子进程方式调用你本机已安装且已登录的官方 CLI（claude / codex）。CLI 与其模型服务之间的通信遵循该 CLI 自身的服务条款与隐私政策；PageDive 不接触、不存储、不代理任何凭证或流量，也永不对你的 CLI 用量收费。
- **分享出口（用户主动）**：设置页「分享给朋友」在你点击时，把本产品的链接与名称带至你所选平台的分享页（如微博/X，新标签打开）；除此之外不经手任何数据，分享内容也与你总结过的网页无关。

## 存储位置（全部在本机）

- 总结历史 / workflow / 技能：`~/.ai-page-dive/`
- 附件（持久化，历史恢复可追溯）：`~/.ai-page-dive/attachments/`
- CLI 运行临时文件：系统临时目录（任务结束后定时清理）
- 追问会话状态：Chrome storage（session 域，浏览器重启即清）

## 我们不做的

- 没有 PageDive 服务器：无账号、无登录、无 API key
- 不收集任何遥测、分析数据或崩溃报告
- 不向任何第三方出售或传输你的数据

## 权限用途

| 权限 | 用途 |
|---|---|
| activeTab / scripting | 你点击时提取当前页正文（仅该页，不申请 `<all_urls>`） |
| sidePanel | 侧边栏界面 |
| nativeMessaging | 与本机组件进程间通信 |
| storage | 恢复追问会话状态（session 域，不落盘） |
| optional_host_permissions（可选读取） | 默认关闭；仅当你在授权出错提示气泡中开启「始终允许读取网页」并经 Chrome 确认后授予。授予后对任意普通页面放行读取（免逐页手势重授权）；可在 `chrome://extensions` 随时收回 |

## 联系

<https://github.com/aaione/ai-page-dive/issues>
