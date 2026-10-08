# PageDive 决策记录

> 2026-08-31 grilling session 定案。调研依据：research/product-architecture-report.md（7 路调研 + 对抗核查）。

## 已拍板决策

| # | 决策位 | 结论 |
|---|---|---|
| 1 | 定位 | **零配置一键深度阅读 agent**（候选 A）。适配层是底层能力顺带产出，垂直场景由 workflow 生态承载。**2026-10-05 修订（r59）**：对外口径为「零账号 · 零 API key · 一键深度阅读」——「零配置」字面承诺已于 0.1.2 期间收回（本机组件需一次终端安装），内部档同步对齐 |
| 2 | 命名 | **PageDive**（弃用 read-one）。npm 包 `ai-page-dive`，安装命令 `ai-page-dive install`。项目目录：`/Users/apple/work/hs/ai-feature/ai-page-dive/`。**2026-09-27 修订（r52）**：双名规则——manifest/CWS 展示名用「AI PageDive」（商店内 "AI" 检索词），正文文案短名「PageDive」，npm 包名不变 |
| 3 | 通信底座 | **Native Messaging 薄 host + Side Panel 主 UI**。否决 localhost daemon 主通道（Chrome 147 LNA 政策风险）。host 预留 `--daemon` 升级位。权限：`activeTab` + `scripting` + `nativeMessaging` + `sidePanel`，不申请 `<all_urls>`。**2026-09-23 修订（r46）**：加 `optional_host_permissions: ["<all_urls>"]`——安装时依然零权限警告，设置页「始终允许读取网页」开关由用户主动授予（Chrome 弹一次确认）；解决换页后 activeTab 收权导致的「尚未授权提取」反复重授权痛点。默认关闭，最小权限叙事不变 |
| 4 | 历史记录 | **host 侧 markdown 落盘 + 档 B+**：`~/.ai-page-dive/history/年/月/日/时间戳-slug.md`（frontmatter 元数据）+ 历史列表/查看/删除/Finder 定位 + 过滤 + 搜索。**2026-09-26 修订（r51-audit）**：搜索已含全文（r17 起——正文命中返回前后片段，title/url 命中免读全文的快路径）；导入导出/对话关联 → v2 |
| 5 | CLI 适配 | **v1 = claude + codex 双适配器**。AgentDef 接口按六家（claude/codex/opencode/gemini/qwen/dsh）字段并集设计。`claude -p --output-format stream-json --verbose`；`codex exec --json`（r8 删 `-o <file>` 死机制：最终文本取自流事件，该文件写了清了从不读）。prompt 一律走 stdin。**2026-09-16 修订（r8-review）**：opencode 以「实验档」进入默认探测（UI 标注「实验」+ Gatekeeper 弹框提示）——它是唯一无进程级工具围栏的 CLI（claude `--allowedTools=Read`、codex `--sandbox read-only`，opencode CLI 无等效 flag），对不可信网页正文属已接受的例外，见「已知限制」节 |
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
- host：薄壳 Node（运行时 <2.2k 行，CI 断言），per-connection spawn、幂等、pgid 进程树收割、流归一化、≤1MB chunk
  - 2026-09-23 重校准：阈值 2k → 2.2k。2k 是立项时拍的数，r47 被真实业务代码撑破（2039 行，CI 转红）；同时把统计口径从「packages/host/src 目录行数」改成「host 进程运行时代码总量」（ROOTS 可跨包 + 断言 host 运行时零依赖），堵掉「拆个新包就过线、而 host 该跑的代码一行没少」的后门。**阈值到此为止——下次破线的正确响应是删功能或删注释，反复上调的红线等于没有红线。**
- CLI 运行内失败打 stdout（claude）——必须解析 `is_error`，不能只看退出码
- workflow 机制：`~/.ai-page-dive/workflows/<name>/WORKFLOW.md`（frontmatter + 正文即 prompt），目录即插件、懒扫描，用户目录 shadow 内置同名
- 合规红线：只子进程调起未修改官方 CLI 二进制、用户自己登录、零凭证接触、零流量代理、永不对 CLI 用量收费

### 扩展↔本机连接架构定案（2026-09-04 多维调研，留在 NM）

- **结论：留在 Native Messaging，否决 WebSocket daemon 与云中继两条替代路线。**
- 否决 WebSocket daemon（`ws://127.0.0.1` + 常驻进程）：① 需新增 host_permissions，违反权限四件套硬约束 ② Chrome LNA（Local Network Access）已在 142 默认生效、147 起扩展到 WebSocket（chromestatus.com/feature/515272807206928），loopback 豁免是当前宽限而非 spec 承诺（WICG 终态含 public→loopback）③ Chrome 强制的 `allowed_origins` 要换成自建 Origin/token 校验（DNS rebinding 防护）④ daemon 常驻管理 + SW 30s 保活心跳。省的只是「注册 + 重启浏览器」两步，净换险。
- 否决云中继（Claude --chrome 的 `bridge.claudeusercontent.com` 模式）：Anthropic 为远程会话/跨设备用账号 UUID 配对，页面数据流经其服务器——直接违反「正文不经任何服务器中转」的本产品红线。
- 行业铁律（1Password/Bitwarden/JetBrains/Claude 全核实）：无产品做到「扩展装完即用」连本机程序；桌面 App 产品靠安装器藏这步，纯 CLI 产品只能显式一次终端命令。Anthropic 静默预装 NM manifest 到 7 个浏览器曾引发 2026-04 隐私丑闻——坚持 pull（用户主动 `ai-page-dive install`），不做 push。
- **ID 漂移根因修复**：`public/manifest.json` 加 `key` 字段（RSA 公钥，官方机制，developer.chrome.com/docs/extensions/reference/manifest/key），unpacked 扩展 ID 恒定为 `nclbhhhmgcabjlgmlbkoblipogajajgn`，与加载路径无关；CWS 上架零影响（商店用自己的签名，key 只管开发期）。私钥在 `~/.ai-page-dive/dev-extension-key.pem`（0600）。
- **Onboarding 自愈**：引导命令动态带 `--ext-id ${chrome.runtime.id}`（install 幂等 + origins 追加不覆盖，一条命令通吃「host 未装 / ID 未登记」）；`panel-ready` 探测失败回传 `nmError`，panel 区分 `forbidden`（只差补登记，轻文案）vs `not found`（完整安装引导）。
- 附带定案：`ai-page-dive install` 后续补 `doctor` 子命令（host 侧自检 manifest 位置/JSON/path/origin 匹配）——NM 调试信息只在 Chrome 内部错误日志，扩展侧拿不到（v2）。

### 已知限制（opencode 的 Gatekeeper 弹框，v1 接受）

- **2026-09-24 补：codex 无进程级 Read 路径白名单**——claude 有 `--allowedTools=Read(//path/**)`（r48/M7 已收紧为正文/附件/工作目录三根路径白名单），codex 的 `--sandbox` 只有 read-only 工作区级围栏、无按路径白名单的工具级开关，等效收紧需上游支持。当前 codex 面与 claude r47 之前同水位（沙箱只读 + 工具拒绝面靠 CLI 默认权限模型），v1 接受。

- **2026-09-22 修订：opencode 入口暂时下架（registry 注释，适配器保留）**——弹框非「偶发一次」而是**每次必弹且拦杀**（SIGKILL），加上开发者工具豁免指引亦实测无效，已从「可接受的实验档」退化为「基本不可用」；v1 以 claude + codex 双适配器交付。恢复条件：上游改 bundle 方式（固定提取路径 pre-sign / 不再运行时提取）或 macOS 提供进程级 quarantine 清除 API。
- **2026-10-01 修订（r55）：适配器文件删除**——下架满 9 天上游无修复迹象，且 host 行数红线（硬约束 5，<2200）被 r53/r54 安全修复批击穿（2262），按「再破线时删功能，不抬阈值」纪律删 `agents/opencode.ts`（82 行，含专属 parser 测试与 e2e 脚本）。恢复条件不变；恢复时从 git 历史（r53/r54 提交前）找回适配器与测试，cwd/软链管线（filePathInPrompt 槽位）未删可直接复用。
- **症状**：从 Chrome 派生的 host 调起 opencode 时，它内嵌 Bun 1.3.14 每启动把 adhoc 签名的运行时 dylib（随机名 hash）提取到临时目录再 dlopen。macOS 的 quarantine 是「进程树级传播」——Chrome 调用 `qtn_proc_apply_to_self` 让其子树新建的所有文件带 `com.apple.quarantine`（与签名、Chrome 盘上 xattr 均无关）。文件名每次随机 → Gatekeeper 每次重新弹「无法验证是否含恶意软件」。
- **已证伪的 host 侧方案**（勿回退）：
  - xattr 竞态轮询剥 `com.apple.quarantine`（spawn 后 120ms×4s）——Gatekeeper 在 dlopen 瞬间即评估，外部轮询追不上，实测无效。
  - `qtn_proc_set_flags(qp,0)+qtn_proc_apply_to_self` 清自身——`apply_to_self` 语义是 opt-in（让己方文件带 quarantine），即便 flags=0 也会让随后创建的文件**全部**带 quarantine（实测 `0081;...;;`）。只 ADD 不 CLEAR，无公开清除 API。
- **现状**：claude/codex 为官方签名二进制、无运行时 dylib 提取 → 不受影响，v1 主路径零弹框。opencode 弹框是上游通病（`anthropics/claude-code#14914` Claude 自家扩展同样命中、官方未修），在我们控制之外；UI 已对 opencode 下拉显示「首次使用或会弹一次系统安全确认」。彻底解决需上游改 bundle 方式（固定提取路径 pre-sign / 不再运行时提取）或 macOS 提供进程级清除 API。

## v1 范围（MVP）

1. Side Panel 一键总结当前页（提取 → 本地临时文件 → CLI agent → 流式渲染）
2. claude + codex 双适配器（opencode 实验档默认探测，2026-09-16 修订，见 D5；2026-09-22 起 opencode 入口暂时下架；2026-10-01 适配器文件删除守行数红线，见「已知限制」节）
3. 内置 workflow：立项拍 3-4 个，实际交付 5 个（quick / deep / paper / humanize / product-audit）——2026-09-26 r51-audit 对齐口径
4. `npm i -g @aaione/ai-page-dive && ai-page-dive install`（自动注册 NM + 探测已装 CLI）
5. 历史 B+ 档

### Host 分发形态定案（2026-09-06 全网调研 + 三评委裁决，D10）

- **结论：npm 主线不变（`npm i -g @aaione/ai-page-dive && ai-page-dive install`），补失败兜底文案；二进制/安装器路线全部否决。** 三评委（UX/成本/风险）一致最高分给「npm + 兜底增强」。2026-09-15 修订：npm 组织 `aaione` 建立，包名由裸名 `ai-page-dive` 改为 `@aaione/ai-page-dive`（bin 命令名 `ai-page-dive` 不变，用户全局命令零感知；NM host 名 `com.pagedive.host` 与包名解耦不受影响）。**2026-10-05 修订（r59 补记）**：安装主线已换 install.sh（`curl -fsSL .../install.sh | sh -s -- <扩展ID>` 一条命令：Node≥18 探测 + brew 兜底 + npm 钉版本 + NM 注册），npm 两连命令降为折叠手动备选（README 快速开始）。
- 否决编译单二进制（deno compile / bun --compile / node SEA / @yao-pkg/pkg）：① 受众零增益——用户必先装 AI CLI（claude/codex 官方 2026 起首选 native installer，**不依赖 Node**；npm 版仅备选——原「均需 Node」论断已被证伪并修正：host 的 cliPath 已补 `~/.local/bin` 探测），「免 Node」收益在装过 npm 版 CLI 的用户为零、在 native 安装用户由 install.sh 的 Node 探测兜底；② 本地审计确认 3 个 fatal blocker（`workflows.ts:11`/`skills.ts:12` 的 builtins 相对 `import.meta.url` 解析、`install.ts:35` hostPath 校验——编译产物下内置 workflows/skills 静默消失、install 直接 throw），修复 2.5 人日 + 永久维护二进制管线；③ vercel/pkg 已归档。
- 否决 dmg/pkg/.command 无签名安装器：macOS Sequoia 起 Gatekeeper 对未公证产物的「Open Anyway」路径更严苛，Chrome 拉起 NM host 时同样过 Gatekeeper——体验反而比 npm 差；签名公证需 $99/年 + 永久 CI。
- CWS 政策核实：扩展引导用户**自行**安装本机 NM host 不触红线（KeePassXC 70 万 / 1Password 700 万在架先例）；NM host 不属 remote code。红线是扩展运行时自下载执行代码。
- 开源先例结论：「商店页 → 完全无终端」唯一成立形态 = 带 GUI 的签名桌面 App 首启自写 manifest（Bitwarden/1Password 模式）；CLI/npm 形态 host（browserpass、mcp-chrome-bridge）无一例外需终端。可借鉴：mcp-chrome-bridge 的 postinstall 自动注册（`tryRegisterUserLevelHost`，失败静默降级）。
- **v2 无终端安装器触发条件**（满足其一才立项，形态 = 签名桌面 App + 首启自写 manifest，非编译 CLI）：(a) 无 Node 用户成为可测量流失来源；(b) 愿投 $99/年 Developer ID + 公证 CI；(c) Windows 支持提上日程。

### 第三方 agent 运行时依赖判否（2026-09-09 grilling + socket API 实证调研，herdr.dev）

- **结论：v1 零第三方运行时依赖，不接 herdr（herdr.dev，36.5k stars 的 coding agent 运行时/多路复用器）做本地 CLI 通信。多引擎编排放 SW（A 的 task-done 同 tick 发 B 的 task-start），host 保持零改动薄壳。**
- 判否实证（抓取 herdr.dev/docs 三页核查）：
  - socket API 事件订阅面（`events.subscribe`）只有 workspace/tab/`pane.agent_status_changed` 生命周期事件，**无任何 agent 输出内容事件**（无 text_delta/result 类）；`agent.prompt --wait` 只回状态终局不带内容；取内容唯一路径 `agent.read` = ANSI 剥离的屏幕快照文本，官方最佳实践是「让 agent 把回复写临时文件、只回文件路径」——屏幕抓取路线自认的天花板。
  - integrations 分档表：claude/codex 仅为 **Session identity 档**（只上报会话 id 供恢复），"State still comes from Herdr's screen manifest detection"——对 v1 双主力连生命周期状态都无结构化数据。
  - 根因是访问模式正交：herdr 把 CLI 养在交互式 pane（TUI 渲染层只能抓屏），服务「终端里的人看 agent」；PageDive 用 `--print --output-format stream-json` 无头直读子进程 stdout（is_error/usage/text-delta 全量结构化流），服务「程序消费 agent 输出」。在结构化访问 claude/codex 上 NM host 路径比 herdr pane 路径更深。
  - 叠加项：依赖 herdr ≠ 替换 host（Chrome 只认 NM，host 必须在）而是加层（SW→NM→host→herdr CLI→server→pane 五层链路）；安装链翻倍违反零配置；herdr 解决的会话持久化/多机/羊群管理是 PageDive 不存在的瓶颈。
- 未来选项（不排期）：① 获客——herdr 用户 = 多 CLI 重度开发者 = 最精准画像，可在其社区做 use case 传播；② 反向集成——PageDive 若要出现在 herd 面板，正确姿势是作为 custom integration 用 `pane.report_agent` 上报任务状态，而非经 herdr 派任务。

### 多引擎（多 CLI 组合）定案（2026-09-09 grilling）——⚠️ 未实施（截至 v0.1.4 本节为实现级设计预留，非已交付功能，r60 审计标记）

- **价值定位**：把用户已付费的多个 AI 订阅从「备选项」变成「可组合的阅读引擎池」（本地免费版多模型聚合，正文不经 PageDive 中转）。默认单引擎，多引擎一律显式 opt-in + 成本前置（≈2× tokens 微标）；deep+双引擎不加二次确认（opt-in 已显式，微标已透明，过度防御）。
- **交付节奏**：v1.x 只交付**审校模式**（second opinion，1.5-2 天）；**并列对比推 v2 等定性反馈**（审校上线后看用户反馈 / GitHub issue 等定性信号——零遥测承诺下无量化数据源，2026-09-26 r51-audit 措辞对齐：风格差异诉求由重跑按钮 0.5 天覆盖，真有并列 arena 诉求再做 1-2 周双流 UI 改造）。
- **审校模式产品语义**：A 总结完 → 原文 + A 的产出喂给 B 审校 → B 输出「审校说明（改了什么/为什么）+ 修订后总结」两段，**追加为新气泡、不替换 A 的原文**（保留对照 = 保留 diff 价值）；追问挂 B 的会话；A 的会话经既有 resume-history 可恢复。
- **交互入口**：CLI 下拉底部「+ 添加第二引擎」→ 双 chip（`claude ✕ codex`）+ 模式微切换（审校⟷并列，v1.x 只有审校生效）+ ≈2× tokens 微标。默认态零变化，渐进披露，不加第三个下拉。
- **架构**：编排放 SW（A 的 task-done 同一 tick 内发 B 的 task-start，A 的 accumulated 输出作为 B 的上下文重发）——host 零改动（tasks Map 本就支持并发/串行多任务；审校串行 = panel 单流状态机直接复用，B 的 chunk 天然是新气泡）。审校 prompt 由内置 workflow `review-critique` 承载（可被用户目录 shadow 定制）。历史：两任务两文件现状机制零改，frontmatter 加 `reviewOf` 关联 A 的 historyPath。

### SW→host 转发帧白名单（2026-10-07 r61 入账）

- r60 起，panel→host 的 nm 通用转发只放行协议已知帧：`sw.ts` 的 `NM_FRAME_TYPES`（r61 起钉 `Set<ExtToHost['t']>`，与 shared/protocol.ts 17 帧绑定，拼写错编译红）。动机：panel 一旦被 XSS 攻陷，无白名单即成任意 host 命令通道（history-delete / workflow-delete 写删原语在册）；host 侧 assertInRoot 等校验是纵深第二层，不替代入口收窄。
- **边界变更需过决策**：新增协议帧必须同步白名单 + sw.test 用例（漏帧即功能回归——帧被入口拒发，面板功能静默失效）。r61 审计 #13 入账要求。

## v2 路线图（已明确延后）

`--daemon` 常驻（关面板不中断）/ 导入导出 / Windows / Edge/Brave / marketplace / OpenCode 等更多适配器 / dsh 深度支持

> 2026-10-05 修订（r59）：追问对话 + 对话历史（含 codex thread_id 续接）、全文搜索（r17 起 title/url/正文三域）已在 v1 交付，移出路线图。

## host 行数红线破线应急清单（2026-10-08 r62 入账；当前 2194/2200，余量 6）

r62 审计（code #5）：每轮净增 40–100 行的历史斜率下，破线只是时间问题；红灯下现找刀口是最差时点决策。**破线时按序取用，每刀 commit 回执注明出处本节，不得上调阈值（硬约束 5）**：

1. **先扫零引用导出与死代码**（2026-10-08 扫描结论：host src 当前零刀口——无零引用导出；`shared/src/index.js` 不在 ROOTS 口径内、删除不省行数）。验证命令：对 `packages/host/src` 每个 `export` 符号全仓 grep 消费。
2. **结构单源化**：找 N 处手写重复收敛为一处。先例：onDone 终局 payload 三处→`doneInfo()` 净减 5 行（r62）；DEFAULT_TASKS 影抄层删除 -8 行（r58）。候选方向（r62 quality 维度疑点，未确认）：NM 帧读写/路径校验/时间戳格式化的 host/ext 双侧重复。
3. **精简叙述性注释**：只压「讲故事」的长注释，**不动轮次锚定注释**（`rNN（#M）：不变式`格式是回归网的组成部分，删它=删测试）。
4. **删功能**：以上仍不够则提删功能决策（本文件过会），照 r55 删 opencode 适配器先例（-82 行，附恢复路径与条件）。红线到此为止——反复上调的阈值等于没有红线。

## 待办素材

- opencode 方法论报告（后台跑着，非阻塞）：v1 内置 workflow 的 prompt 设计参考；若未交付由主会话自行设计
