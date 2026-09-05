# PageDive 决策记录

> 2026-08-31 grilling session 定案。调研依据：research/product-architecture-report.md（7 路调研 + 对抗核查）。

## 已拍板决策

| # | 决策位 | 结论 |
|---|---|---|
| 1 | 定位 | **零配置一键深度阅读 agent**（候选 A）。适配层是底层能力顺带产出，垂直场景由 workflow 生态承载 |
| 2 | 命名 | **PageDive**（弃用 read-one）。npm 包 `ai-page-dive`，安装命令 `ai-page-dive install`。项目目录：`/Users/apple/work/hs/ai-feature/page-dive/` |
| 3 | 通信底座 | **Native Messaging 薄 host + Side Panel 主 UI**。否决 localhost daemon 主通道（Chrome 147 LNA 政策风险）。host 预留 `--daemon` 升级位。权限：`activeTab` + `scripting` + `nativeMessaging` + `sidePanel`，不申请 `<all_urls>` |
| 4 | 历史记录 | **host 侧 markdown 落盘 + 档 B+**：`~/.ai-page-dive/history/年/月/日/时间戳-slug.md`（frontmatter 元数据）+ 历史列表/查看/删除/Finder 定位 + 过滤 + 标题/URL 搜索。全文搜索/导入导出/对话关联 → v2 |
| 5 | CLI 适配 | **v1 = claude + codex 双适配器**。AgentDef 接口按六家（claude/codex/opencode/gemini/qwen/dsh）字段并集设计，只实现两家。`claude -p --output-format stream-json --verbose`；`codex exec --json -o <file>`。prompt 一律走 stdin |
| 6 | 平台 | **v1 = macOS + Chrome**。Linux 声明支持不承诺测试；Windows/Edge/Brave → v2（install 分支留位） |
| 7 | 开源 | **全开源 MIT**（2026-09-01 定案；host 可审计 = 信任自证；与 summarize/React/Vite 等 MIT 生态零摩擦，Apache-2.0 的专利条款对本品类无暴露面） |
| 8 | 付费墙站点 | **尽力提取当前已渲染内容**（等价用户手动复制），不绕过访问控制；设置页免责文案；SPA 差站点走提取质量提示不硬拦截 |
| 9 | 定价 | **v1 完全免费无付费墙**。Raycast 式路线：开源核心免费 → workflow 生态起量 → Pro 卖生态增值 |

## 技术栈（2026-08-31 grilling 补充定案）

| 位 | 选型 |
|---|---|
| 仓库形态 | pnpm monorepo：`apps/extension` + `packages/host` + `packages/shared`（AgentDef 类型 / NM 消息协议两侧共用） |
| host | 纯 Node（>=18）+ TypeScript，**运行时零依赖**（NM 协议长度前缀手写 ~20 行） |
| 扩展 UI | Vite + React + TypeScript，Side Panel 为主 UI |
| 样式 | Tailwind v4 + 手写少量组件（不引 shadcn 全套） |
| markdown | react-markdown + remark-gfm（流式渲染 = 每帧重渲染累积文本） |
| 测试 | vitest 覆盖 host 流解析器 + AgentDef buildArgs 纯函数；扩展侧手动验证 |

## 既定技术决策（调研定案，随架构锁定）

- 提取管线：Readability → DOMPurify → Turndown(GFM)；站点适配器（arXiv/YT/文档站）打样；innerText 兜底
- 正文全量写本地临时文件，prompt 给文件路径 + 大纲 + 元数据，agent 自主分段读取
- host：薄壳 Node（<2k 行），per-connection spawn、幂等、pgid 进程树收割、流归一化、≤1MB chunk
- CLI 运行内失败打 stdout（claude）——必须解析 `is_error`，不能只看退出码
- workflow 机制：`~/.ai-page-dive/workflows/<name>/WORKFLOW.md`（frontmatter + 正文即 prompt），目录即插件、懒扫描，用户目录 shadow 内置同名
- 合规红线：只子进程调起未修改官方 CLI 二进制、用户自己登录、零凭证接触、零流量代理、永不对 CLI 用量收费

### 扩展↔本机连接架构定案（2026-09-04 多维调研，留在 NM）

- **结论：留在 Native Messaging，否决 WebSocket daemon 与云中继两条替代路线。**
- 否决 WebSocket daemon（`ws://127.0.0.1` + 常驻进程）：① 需新增 host_permissions，违反权限四件套硬约束 ② Chrome LNA（Local Network Access）已在 142 默认生效、147 起扩展到 WebSocket（chromestatus.com/feature/515272807206928），loopback 豁免是当前宽限而非 spec 承诺（WICG 终态含 public→loopback）③ Chrome 强制的 `allowed_origins` 要换成自建 Origin/token 校验（DNS rebinding 防护）④ daemon 常驻管理 + SW 30s 保活心跳。省的只是「注册 + 重启浏览器」两步，净换险。
- 否决云中继（Claude --chrome 的 `bridge.claudeusercontent.com` 模式）：Anthropic 为远程会话/跨设备用账号 UUID 配对，页面数据流经其服务器——直接违反「内容不出本机」。
- 行业铁律（1Password/Bitwarden/JetBrains/Claude 全核实）：无产品做到「扩展装完即用」连本机程序；桌面 App 产品靠安装器藏这步，纯 CLI 产品只能显式一次终端命令。Anthropic 静默预装 NM manifest 到 7 个浏览器曾引发 2026-04 隐私丑闻——坚持 pull（用户主动 `ai-page-dive install`），不做 push。
- **ID 漂移根因修复**：`public/manifest.json` 加 `key` 字段（RSA 公钥，官方机制，developer.chrome.com/docs/extensions/reference/manifest/key），unpacked 扩展 ID 恒定为 `nclbhhhmgcabjlgmlbkoblipogajajgn`，与加载路径无关；CWS 上架零影响（商店用自己的签名，key 只管开发期）。私钥在 `~/.ai-page-dive/dev-extension-key.pem`（0600）。
- **Onboarding 自愈**：引导命令动态带 `--ext-id ${chrome.runtime.id}`（install 幂等 + origins 追加不覆盖，一条命令通吃「host 未装 / ID 未登记」）；`panel-ready` 探测失败回传 `nmError`，panel 区分 `forbidden`（只差补登记，轻文案）vs `not found`（完整安装引导）。
- 附带定案：`ai-page-dive install` 后续补 `doctor` 子命令（host 侧自检 manifest 位置/JSON/path/origin 匹配）——NM 调试信息只在 Chrome 内部错误日志，扩展侧拿不到（v2）。

### 已知限制（opencode 的 Gatekeeper 弹框，v1 接受）

- **症状**：从 Chrome 派生的 host 调起 opencode 时，它内嵌 Bun 1.3.14 每启动把 adhoc 签名的运行时 dylib（随机名 hash）提取到临时目录再 dlopen。macOS 的 quarantine 是「进程树级传播」——Chrome 调用 `qtn_proc_apply_to_self` 让其子树新建的所有文件带 `com.apple.quarantine`（与签名、Chrome 盘上 xattr 均无关）。文件名每次随机 → Gatekeeper 每次重新弹「无法验证是否含恶意软件」。
- **已证伪的 host 侧方案**（勿回退）：
  - xattr 竞态轮询剥 `com.apple.quarantine`（spawn 后 120ms×4s）——Gatekeeper 在 dlopen 瞬间即评估，外部轮询追不上，实测无效。
  - `qtn_proc_set_flags(qp,0)+qtn_proc_apply_to_self` 清自身——`apply_to_self` 语义是 opt-in（让己方文件带 quarantine），即便 flags=0 也会让随后创建的文件**全部**带 quarantine（实测 `0081;...;;`）。只 ADD 不 CLEAR，无公开清除 API。
- **现状**：claude/codex 为官方签名二进制、无运行时 dylib 提取 → 不受影响，v1 主路径零弹框。opencode 弹框是上游通病（`anthropics/claude-code#14914` Claude 自家扩展同样命中、官方未修），在我们控制之外；UI 已对 opencode 下拉显示「首次使用或会弹一次系统安全确认」。彻底解决需上游改 bundle 方式（固定提取路径 pre-sign / 不再运行时提取）或 macOS 提供进程级清除 API。

## v1 范围（MVP）

1. Side Panel 一键总结当前页（提取 → 本地临时文件 → CLI agent → 流式渲染）
2. claude + codex 双适配器
3. 内置 3-4 个 workflow（快速摘要 / 深度研读多步 / 论文模式）
4. `npm i -g ai-page-dive && ai-page-dive install`（自动注册 NM + 探测已装 CLI）
5. 历史 B+ 档

## v2 路线图（已明确延后）

`--daemon` 常驻（关面板不中断）/ 全文搜索 / 导入导出 / 追问对话 + 对话历史 / Windows / Edge/Brave / marketplace / OpenCode 等更多适配器 / dsh 深度支持

## 待办素材

- opencode 方法论报告（后台跑着，非阻塞）：v1 内置 workflow 的 prompt 设计参考；若未交付由主会话自行设计
