# Privacy Policy / 隐私政策

*Last updated: 2026-10-04*

PageDive（"AI PageDive" Chrome 扩展及其本机组件）按以下方式处理数据。核心承诺：**PageDive 没有服务器——你的网页内容只在扩展与本机 CLI 之间流转，不经我们中转，也不被我们存储。**（CLI 与其模型服务如何通信由该 CLI 自身的隐私政策决定，见下。）

## English Summary

PageDive has no servers, no accounts, and no API keys. When you click "summarize", the extension extracts the current page's content and sends it via Chrome Native Messaging directly to an AI CLI (claude / codex) installed and logged in on your own machine, where it is written to a per-task temp file (deleted the moment the task ends; crash leftovers are swept the next time you run a task, for files older than an hour) for that CLI to read; the CLI runs in a stable working directory (`~/.ai-page-dive/agent-workspace/`, kept long-term as the anchor for follow-up questions in the same session; attachments you add are symlinked there and swept by the next task — page content itself never lands in this directory). We never transmit, intermediate, or store your content: no telemetry, no analytics, no crash reports. History, workflows, skills, and any attachments you attach (persisted under `~/.ai-page-dive/attachments/` for history restoration) live under `~/.ai-page-dive/` on your machine. Follow-up session state stays in Chrome session storage (cleared on browser restart); panel preferences (ambience, reading size, chosen workflow, enabled skills, history limit) and an in-flight task pointer are kept in the extension's own local storage on your machine (`pd-*` keys — UI preferences only, no page content). When probing available CLIs, PageDive reads (only) the `model` field from your CLI's local config file (`~/.claude/settings.json` / `~/.codex/config.toml`) to display the default model — read-only, best-effort, nothing else parsed or sent anywhere. Note that the CLI you invoke keeps its own session transcripts of what it processes (e.g. claude under `~/.claude/projects/`) — that is the CLI's built-in behavior, governed by its own privacy policy and outside PageDive's control. The only outbound exit is user-initiated sharing (Settings → "Share"), which opens your chosen platform's share page with this product's link and name. How your CLI communicates with its model service is governed by that CLI's own privacy policy (claude → Anthropic, codex → OpenAI). The optional "always allow reading" host permission is off by default and granted only by explicit user action.

## 数据处理

- **网页正文与元数据**：扩展在你点击总结时提取当前页正文（Readability），经 Chrome Native Messaging 传给本机组件，写入本机临时文件供本机 AI CLI 读取。全程在本机完成。
- **你的输入与附件**：同样只在本机处理（附件为文本 ≤512KB/个 或 图片 ≤500KB/个，图片以 base64 传输）。
- **AI CLI**：PageDive 以子进程方式调用你本机已安装且已登录的官方 CLI（claude / codex）。CLI 与其模型服务之间的通信遵循该 CLI 自身的服务条款与隐私政策；PageDive 不接触、不存储、不代理任何凭证或流量，也永不对你的 CLI 用量收费。
- **CLI 本地配置读取（只读）**：探测可用 CLI 时读取其本地配置文件的默认模型字段（claude：`~/.claude/settings.json`；codex：`~/.codex/config.toml`）以在界面显示默认模型——仅此一个字段，best-effort；不解析其余内容，也不向任何地方回传。
- **分享出口（用户主动）**：设置页「分享给朋友」在你点击时，把本产品的链接与名称带至你所选平台的分享页（如微博/X，新标签打开）；除此之外不经手任何数据，分享内容也与你总结过的网页无关。

## 存储位置（全部在本机）

- 总结历史 / workflow / 技能：`~/.ai-page-dive/`
- 附件（持久化，历史恢复可追溯）：`~/.ai-page-dive/attachments/`
- CLI 工作目录（会话 cwd 锚点 + 附件软链）：`~/.ai-page-dive/agent-workspace/`——固定工作区，**追问会话的恢复锚点，长期保留、不随任务清理**；附件软链由下次任务启动时补扫，正文不落此目录（正文临时文件在系统临时目录，随任务终局删除）
- CLI 运行临时文件：系统临时目录 `/tmp/pagedive/`（任务结束即删；异常退出的残留在你下次总结时被兜底清扫回收——清 1 小时前的旧文件，无定时机制）
- 追问会话状态：Chrome storage（session 域，浏览器重启即清）
- 面板偏好与在跑任务指针（localStorage / storage.local，持久落盘于本机扩展存储）：氛围/字号档、所选 workflow、技能启用列表、历史保留条数等 `pd-*` 键——均为产品 UI 偏好，**不含网页内容**

### 你所选 CLI 自身的落盘（PageDive 之外）

claude CLI 会把它经手的会话转录（含被总结的网页正文）写入其自身目录（如 `~/.claude/projects/`）；codex 亦会在其自身数据目录留存会话记录（以其官方文档为准）。这是 CLI 的内置行为——PageDive 不创建、不读取、不清理这些文件；查看或清除请参考对应 CLI 的官方文档。

## 我们不做的

- 没有 PageDive 服务器：无账号、无登录、无 API key
- 不收集任何遥测、分析数据或崩溃报告
- 不向任何第三方出售或传输你的数据

## 权限用途

| 权限 | 用途 |
|---|---|
| activeTab / scripting | 你点击时提取当前页正文（仅该页；无常驻 `<all_urls>` 访问——可选读取权限默认关闭，见本表末行） |
| sidePanel | 侧边栏界面 |
| nativeMessaging | 与本机组件进程间通信 |
| storage | 追问会话恢复（session 域，浏览器重启即清）+ 面板偏好与在跑任务指针的本地持久存储（localStorage / storage.local，仅 UI 偏好与任务指针，不含网页内容） |
| optional_host_permissions（可选读取） | 默认关闭；仅当你在授权出错提示气泡中开启「始终允许读取网页」并经 Chrome 确认后授予。授予后对任意普通页面放行读取（免逐页手势重授权）；可在 `chrome://extensions` 随时收回 |

## 联系

<https://github.com/aaione/ai-page-dive/issues>
