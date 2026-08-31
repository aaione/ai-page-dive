# read-one 产品与架构决策报告

> 综合来源：competitors / prior-art / cli-modes / native-comms / extraction / local-repos / distribution 七路调研 + 对抗性核查。所有关键结论标注出处；已核查确认的 CLI 能力论断直接采信。

---

## 一、执行摘要（确定性结论）

1. **赛道已被验证但格局未固化**：steipete/summarize（6.6k star、MIT、已上架 Chrome Web Store、复用 Codex/Claude/Gemini CLI 认证）已占住"插件 → 本机 CLI 总结"约 85% 的卖点，但它是 **CLI 优先的开发者工具**：需装 CLI + token 配对、总结是单轮抽取式管线、无 workflow 插件机制。窗口期估计只有数月（该 repo 日更）。（来源：prior-art、competitors 分支）
2. **read-one 这个名字弃用**：无法律冲突但语义弱、不传达"深度/AI/本地"、口播易混（read on / red one）、拼写变体多。**推荐改名 PageDive**（首选，GitHub/npm/CWS 未见冲突），备选 Readsmith、Gistr；避开 DeepRead、PageForge（撞名严重）。（来源：competitors 分支命名核查）
3. **推荐定位**："零配置、一键、agent 式多步深度阅读"——面向已订阅 Claude Pro/Max 或 ChatGPT Plus 的开发者与重度知识工作者，BYO-CLI-subscription（零边际推理成本、零 API key、内容不出本机）。
4. **通信底座定案：Native Messaging 薄 host 为主通道，预留 daemon 升级位**。否决"纯 localhost WebSocket/HTTP 作主通道"——Chrome 147 起 Local Network Access 权限已波及扩展的 ws://localhost，豁免条款官方未确认，属不可控政策风险。（来源：native-comms 分支）
5. **CLI 适配层采用声明式 AgentDef（open-design RuntimeAgentDef 裁剪版）**：一个 CLI 一个 def 文件；Claude Code、Codex、OpenCode、Gemini、Qwen 五家有一等无头模式 + JSON/JSONL 输出（对抗性核查已确认核心 flag），dsh 用 plain-stream 兜底；**长正文一律走 stdin**（argv 上限 E2BIG/ENAMETOOLONG 是必踩坑）。（来源：cli-modes 分支 + 核查、local-repos 分支）
6. **提取管线定案**：Readability（Apache 2.0，商用友好）→ DOMPurify → Turndown(GFM)，分层站点适配器（arXiv/YouTube/文档站打样）+ innerText 兜底；**正文全量写本地临时文件，prompt 给文件路径 + 大纲 + 元数据，让 agent 自主决定分段读取**——多步深度总结正是与所有云端竞品的本质差异。（来源：extraction 分支）
7. **是否参考 open-design：参考，但"抄文件、不抄架构"**。抄 RuntimeAgentDef 接口形状、stdin 递送、pgid 进程树收割、能力探测门控、SSE 断线重放思想、clipper 的 MV3 通信模式、SKILL.md 式插件机制；**不做运行时依赖**（od daemon 1.3 万行 server.ts 绑死其产品域），**明确不要** landlock 沙箱、ACP 协议、PTY、MCP 注入策略矩阵。（来源：local-repos 分支）
8. **可插拔 workflow 值得做，且是核心壁垒**：全部竞品均无此设计，属真实空白；od skills 证明"目录即插件 + frontmatter 清单 + 懒扫描"实现成本极低（一个 skills.ts + 目录约定）。v1 只做"frontmatter 声明总结风格 + 正文即 prompt"这一个约定，marketplace 延后。（来源：competitors、local-repos 分支）
9. **最大合规风险是 Anthropic 条款，但存在明确合规路径**：只以子进程调起用户自己安装、自己登录的**未修改官方 claude 二进制**（等价于用户手动粘网页进终端，官方原话允许 end user 使用 unmodified Claude Code binary）；红线是零凭证接触、零流量代理转发、永不对 Claude 用量收费。Codex 侧官方明确开放第三方 harness。（来源：distribution 分支，Anthropic legal-and-compliance 条款）
10. **商业化定调 Raycast/Obsidian 模式**：基础总结免费（边际成本为零 + 获客面），Pro 买断 $30–60 或年费 $20–50 卖 workflow 生态/结构化导出/多 CLI 路由；团队知识库为远期 B2B 第二曲线，v1 不投。（来源：distribution 分支）

---

## 二、市场格局与空白点

### 是否已有人做成？——**核心路线已被做出来，但"产品化完成"没有**

| 已占 | 占据者 | 对 read-one 的压缩 |
|---|---|---|
| 插件 → 本机 CLI 认证复用 + 网页总结 | steipete/summarize（6.6k star，CWS 已上架） | 直接竞品，最高 |
| 官方 CLI 操控浏览器 | Claude in Chrome、Codex Chrome 扩展 | 平台风险，锁自家生态 |
| 本地小模型总结 | PageAssist（8.2k star，Ollama） | 不同赛道（本地推理 vs 本地 CLI） |
| MCP 反向路线（CLI 调浏览器） | mcp-chrome（12k star 但 2026-01 起疑似停滞）、chrome-devtools-mcp | 入口在终端，非一键 UX |
| 云端一次性摘要 | Sider/Merlin/Monica/Glarity/Eightify | 红海，正是要差异化的对象 |

（来源：prior-art、competitors 分支，stars 为 2026-08-31 GitHub API 实测）

### 仍空白（read-one 的生存空间）

1. **零配置一键体验**：summarize 需装 CLI + token 配对，是开发者向；"扩展装完即用"的产品未见。
2. **agent 式多步深度总结作为主卖点**：所有竞品（云端的和 summarize）均为单轮抽取式；"多轮提取-验证-结构化、agent 自主抓取引用"无人主打。
3. **可插拔总结 workflow**：无任何竞品做文件式插件机制（gunpowderlabs/chrome-summarize 有 `.claude/skills` 雏形但 0 star，仅证明架构可行）。
4. **CLI 中立适配层的产品化**：官方扩展各锁自家，summarize 绑自家 CLI。

**结论**：作为"summarize 的复刻"不值得做（晚了 8 个月）；作为"深度阅读 agent + workflow 生态"值得做，且必须快。

---

## 三、产品方向（三选一，指定推荐）

### 候选 A（推荐）：PageDive — 零配置一键深度阅读 agent

- **目标用户**：已订阅 Claude Pro/Max 或 ChatGPT Plus、日常阅读大量技术/研究/长文内容的开发者与重度知识工作者（中国区叠加 DeepSeek/dsh 用户）。
- **核心差异化**：① 免 API key、复用已有 CLI 订阅（零边际成本）；② 内容只在本机进程流转（隐私卖点 + CWS 审核最强声明）；③ agent 式多步深度总结（区别于所有一次性摘要）；④ 可插拔 workflow 生态。
- **MVP 功能集**：
  1. Side Panel 一键总结当前页（Readability 管线 → 本地临时文件 → CLI agent → 流式渲染）
  2. Claude Code + Codex 两个适配器先行（订阅复用两大支柱），OpenCode/Gemini 次之，dsh plain-stream 兜底
  3. 内置 3–4 个 workflow：快速摘要 / 深度研读（多步）/ 论文模式（arXiv 适配器打样）/ 追问对话（会话 resume）
  4. `pagedive install` 一条命令装 host + 自动探测本机已装 CLI
- **命名**：PageDive（"深潜页面"直指深度总结）。

### 候选 B：CLI 中立总结适配层（开发者工具向）

把多 CLI 适配（含 dsh、Qwen 等长尾）做成核心卖点，host 甚至可被第三方扩展复用。**不推荐为主动位**：适配层是壁垒但不是用户可感知的价值，适合作为 A 的底层能力而非定位。

### 候选 C：垂直领域深度阅读工作台（论文/财报/法务模板市场）

想象空间大但 v1 过重，且垂直模板恰恰应该由可插拔 workflow 生态去承载，而非产品定位。作为 A 起量后的演进方向。

---

## 四、技术架构（推荐方案定案）

### 4.1 架构图

```
┌─────────────────────────── Chrome (MV3) ───────────────────────────┐
│                                                                    │
│  Content Script          Service Worker            Side Panel UI   │
│  (activeTab 触发时注入)   (编排中枢)                 (常驻扩展页面)  │
│        │                       │                        ▲          │
│  [提取管线]                     │                        │ 流式渲染  │
│  Readability→DOMPurify          │   chrome.runtime       │          │
│  →Turndown(GFM)→markdown        │   ──────messages───────┘          │
│  + 站点适配器(arXiv/YT/文档站)   │                                   │
│        │                       │ open port (connectNative)          │
│        └──sendMessage──────────┤ port 保活 SW (官方机制)             │
└────────────────────────────────┼────────────────────────────────────┘
                                 │ Native Messaging (32-bit 长度前缀 JSON,
                                 │ host→扩展单条 ≤1MB, chunk 分片)
                                 ▼
┌────────────────────── 本机 pagedive host (<2k 行 Node) ─────────────┐
│  · 薄壳: per-connection spawn, 幂等, 断线自动重连                   │
│  · AgentDef registry (声明式 def, 一个 CLI 一个文件)                │
│  · spawn: detached + pgid 收割 (SIGTERM→3s grace→SIGKILL)          │
│  · 流解析器: claude-stream-json / codex-jsonl / plain-stream       │
│  · 能力探测门控 (--help 子串匹配 → 按 cap 加 flag)                  │
│  · [升级位] --daemon 模式: 常驻 daemon 跑长任务, port 断不丢任务     │
│         │                                                          │
│    spawn(stdio:[stdin,'pipe','pipe']), prompt 走 stdin             │
└─────────┼──────────────────────────────────────────────────────────┘
          ▼
   claude -p --output-format stream-json   (用户自己的登录态)
   codex exec --json                        (复用已保存认证)
   opencode run --format json / gemini -p / qwen -p
   dsh --profile headless (plain-stream 兜底)
```

### 4.2 组件职责

| 组件 | 职责 |
|---|---|
| Content Script | 用户手势触发后做 DOM 快照提取（SPA 天然规避时序问题），产出统一 schema：`{url, title, byline, publishedTime, siteName, lang, contentMarkdown, extractor, approxTokens}` |
| Service Worker | 编排中枢：调 content script 提取 → 持有 NM port → 派发任务、转发流式 chunk 至 Side Panel；断线重连 |
| Side Panel | 常驻扩展页面，流式渲染总结、追问对话入口（SW 存活靠 port 而非 Side Panel 本身） |
| host（Node 单文件） | 薄壳：AgentDef registry、spawn/取消/进程树收割、流归一化、≤1MB chunk 分片、幂等重连；所有跨连接状态落盘 |
| AgentDef | 纯声明式 CLI 描述（见 4.3），buildArgs 是纯函数，极易单测 |

### 4.3 CLI 适配器接口（伪代码，RuntimeAgentDef 裁剪版）

```typescript
interface AgentDef {
  id: string;                         // 'claude' | 'codex' | 'opencode' | 'gemini' | 'qwen' | 'dsh'
  bin: string;                        // 主二进制名
  fallbackBins?: string[];            // argv 兼容替身
  versionArgs: string[];              // ['--version']
  supportedVersionPattern?: RegExp;   // 接受 release line, 避免上游发 rc 就全用户告警

  authProbe?: { args: string[]; timeoutMs: number };  // 如 ['auth','status'], 退出码 0/1

  // 能力探测: 先 probe --help, 子串匹配后置 caps[id][key]=true,
  // buildArgs 按能力门控加参 (老版 CLI 不会因未知 flag 秒退)
  capabilityFlags?: Record<flagString, capabilityKey>;

  buildArgs(opts: SummarizeOpts, caps: Caps): string[];
  // claude: ['-p', instruction, '--output-format','stream-json','--verbose',
  //          '--allowedTools','Read,WebFetch']   (caps.partial → '--include-partial-messages')
  // codex:  ['exec','--json','--sandbox','read-only','-o',lastMsgPath]
  // gemini: ['-p', instruction, '--output-format','stream-json']
  // dsh:    ['--profile','headless', task]

  promptViaStdin: true;               // 一律 stdin: argv 上限 E2BIG(~128KB/Linux)
                                     // / ENAMETOOLONG(~32KB/Win) 必炸长网页
  streamFormat: 'claude-stream-json' | 'codex-jsonl' | 'plain-stream';

  resume?: { mode: 'specify' }                      // claude --resume <id>
         | { mode: 'capture'; eventId: string };    // codex thread.started.thread_id
}
```

**关键适配知识**（cli-modes 分支 + 对抗性核查确认）：
- Claude Code：`-p` + `--output-format stream-json`（官方示例同带 `--verbose`）；**运行内失败（如缺认证）作为 result 打到 stdout**——必须解析 `is_error`/subtype，不能只看退出码；`--json-schema` 仅 print 模式可用；订阅 OAuth 登录可用于无头（仅 `--bare` 强制 API key）。
- Codex：`codex exec` **默认复用已保存的 CLI 登录认证**（官方文档原话），非交互用法被明确支持；`--json` 时 stdout 变 JSONL 事件流；`-o` 可把最终消息落文件；`--full-auto` 已废弃，用 `--sandbox` 显式控制。
- dsh：stdout 仅最终文本、reasoning 走 stderr、无 JSON flag——用 plain-stream 兜底，深度支持走 `--profile sdk/acp`（延后）。
- Gemini：官方 headless 推荐 API key 而非 Google 账号登录，且全站横幅声明将被 Antigravity CLI 替代（2026-06-18，未付费层）——**适配备件低优先级 + 预留迁移**。

### 4.4 流式管线

```
CLI stdout(JSONL/text) → host 流解析器归一化(去重/usage/is_error 判定)
  → NM port ≤1MB chunk → SW → Side Panel 逐 token 渲染
断连: port 断 → Chrome 关 host stdin → host 退出
对策: host 无长连接状态 + 任务状态落盘; SW 重新 connectNative 重开,
      按 taskId 续传 (SSE Last-Event-ID 重放思想, od 已验证)
```

### 4.5 通信底座决策（含被否方案）

| 方案 | 判定 | 理由 |
|---|---|---|
| **Native Messaging 薄 host** | **采用（主通道）** | ID 白名单不可被网页访问（安全最强）；开放 port 官方机制保活 SW；仅 `nativeMessaging` 权限无 CWS 额外负担；一条 register 命令完成安装 |
| localhost daemon (ws/http) | **否决为主通道，保留为升级位** | Chrome 147 起 LNA 权限波及扩展的 WebSocket，host_permissions 豁免条款官方未确认（政策性高风险）；任何本机进程可连端口需自建 token；但 daemon 独立存活可保长任务不丢——以 host 的 `--daemon` 升级位承载，不改前端协议 |
| `sendNativeMessage`（无 port） | 否决 | 每条消息 spawn 新 host，只取首条回复，不适合流式长任务 |
| ACP / PTY / landlock 沙箱 | 否决 | 分别为 editor 双向交互、交互审批、不受信命令沙箱设计；read-one 是单向一次性"发网页收总结"，`-p` + stream-json + 空临时 cwd 即可 |

### 4.6 用户安装流程（定案）

1. CWS 一键安装扩展——权限仅 `activeTab` + `scripting` + `nativeMessaging`（**不申请 `<all_urls>`**，避免高危警告与高频拒审；用户手势触发的语义完全匹配）。
2. 首次点击检测不到 host → 弹引导页："复制这一行到终端：`npm i -g pagedive && pagedive install`"（目标用户全是有 Node 的开发者，摩擦最低）。
3. install 命令：写 host manifest（macOS `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`、Linux `~/.config/...`、Windows `reg add HKCU\...`，全部用户级无需 sudo）+ 探测本机已装 CLI 并列出可用适配器；开发期 unpacked 扩展 ID 不固定，register 支持参数化写 ID（allowed_origins 不支持通配符）。
4. 回到浏览器显示"已连接：检测到 Claude Code、Codex"，点击即用。"host not found"错误一律做成安装引导而非裸报错（browserpass/1Password 踩过的最大坑）。

---

## 五、可插拔 Workflow 设计

**判定：值得做，是核心壁垒，但 v1 只做最小约定。**

### 文件格式（照 od skills 机制起步）

```
~/.pagedive/workflows/
  deep-paper/
    WORKFLOW.md        # frontmatter: name / description / triggers / category
                       # 正文即 prompt（可引用 {url} {file} {meta} 占位符）
    assets/            # 可选: 引用资料、后处理脚本
```

- **目录即插件，markdown 正文即 prompt**——加载机制刻意简单：每次列表请求重扫目录、无 watch（od 原话"几十个 skill 重扫无所谓"）。
- 多 root 优先级：用户目录 shadow 内置同名 workflow；维护 id alias 表防改名后静默丢引用（od 踩过的坑）。

### 与 Claude skills 的关系

同构（SKILL.md 式文件即插件），但语义域不同：Claude skills 是"agent 能力扩展"，read-one workflow 是"总结风格与编排策略"。兼容设计：workflow 正文就是发给 CLI 的 prompt，天然可复用社区已有的 Claude skills prompt 资产。

### 生态想象空间评估

- **上限**：总结模板市场 = "Glarity 的 prompt 模板" × "agent 多步编排能力"的乘积——后者云端一次性 API 插件结构上做不到（无法多步），这是结构性差异而非功能差异。
- **参照系**：od 已长出 200+ skill 生态证明该机制可规模化；Claude skills 社区 2025–2026 已被接受，用户教育成本低。
- **节奏**：v1 内置 3–4 个 workflow 打样 → v2 开放用户目录加载 → v3 marketplace（抽成/团队共享，依赖生态起量，v1/v2 阶段不投）。
- **现实约束**：垂直领域模板（论文/财报/法务）是想象空间最大的部分，但依赖产品先起量，不应进 MVP 承诺。

---

## 六、风险与缓解（含被驳倒/存疑论断）

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | **Anthropic 执法**（2026-01 起封禁第三方 harness，点名禁止以用户名义路由订阅凭证） | 高 | 只子进程调起未修改官方 claude 二进制、用户自己登录（官方允许侧）；零 OAuth/token 接触、零流量代理、永不对 Claude 用量收费；文案明示"用量计入你的订阅"；持续盯执法口径 |
| 2 | **steipete/summarize 向下做易用性 + workflow** | 高 | 数月窗口期内抢"零配置 + agent 深度 + workflow 生态"心智；速度优先 |
| 3 | 官方扩展（Claude in Chrome / Codex）补齐"总结当前页" | 中高 | 打"CLI 中立 + 可插拔"牌——官方各锁自家生态，恰好留出中立位 |
| 4 | Native Messaging long-lived port 历史不稳定（Chromium #40755584 等） | 中 | host 幂等 + 自动重连 + 任务状态落盘；daemon 升级位兜底长任务 |
| 5 | CWS in-depth review（nativeMessaging 触发，周期数天至数周） | 中 | 提交时详述 host 用途与"内容仅本地处理"；activeTab 最小权限 |
| 6 | 用户账号被 Anthropic 风控误伤（用量形态异常） | 中（未确认） | 显著披露 + 每页总结节流上限 + 防循环触发 |
| 7 | Gemini CLI 被 Antigravity 替代（2026-06-18 横幅） | 中 | 低优先级适配 + 迁移预案 |
| 8 | 提取质量：中文页面/文档站 Readability 偶有误判 | 中 | 中文 top 50 站实测集；站点适配器 + "提取质量低"提示；硬付费墙/Twitter/ASR 明确放弃并公示 |
| 9 | Windows 兼容（NM O_BINARY、host 二进制、CLI 覆盖） | 中 | v1 以 macOS/Linux 为主，Windows 二阶段 |

**核查中被修正/存疑的论断（已据此调整采信）**：
- "CODEX_API_KEY 仅在 exec 中支持"——被驳回：官方文档明确其可用于 exec、review、TS SDK、exec-server --remote；且官方页未提 `~/.codex/auth.json` 路径。核心结论（exec 默认复用已保存认证）不受影响。
- localhost + host_permissions 能否豁免 Chrome 147+ LNA 提示——官方无明确豁免条款，未确认。这是否决 localhost 主通道的直接依据。
- OpenCode stdin 管道传长文（官方文档未显式写明，源码/社区支持）——部分未确认；产品上 prompt 走 stdin + 临时文件双保险即可覆盖。
- Readability 中文效果无系统性 CJK 评测——未确认，需自建实测集。

---

## 七、五问五答（显式对应）

1. **命名**：read-one 不行，改名 **PageDive**（备选 Readsmith / Gistr）。
2. **架构**：MV3（activeTab + nativeMessaging）→ NM 薄 host（<2k 行 Node，幂等、pgid 收割、流归一化）→ spawn 本机官方 CLI 无头模式，prompt 走 stdin，chunk 流式回 Side Panel；预留 --daemon 升级位。
3. **关键产品思路**：零配置一键 + agent 式多步深度总结 + BYO-CLI 订阅（零 API key/零边际成本/内容不出本机）；Claude Code 与 Codex 适配器先行。
4. **是否参考 open-design**：参考——抄文件（RuntimeAgentDef、stdin 递送、pgid 收割、能力门控、SSE 重放、SKILL.md 机制、clipper 通信模式），不抄架构、不做运行时依赖；landlock/ACP/PTY/MCP 注入明确不要。
5. **可插拔架构价值**：真实空白、结构性差异（云端一次性 API 做不到多步编排）、实现成本极低（目录 + frontmatter + 懒扫描）——值得做且是核心壁垒；v1 最小约定，marketplace 起量后再做。

---

## 附：来源索引

- 竞品与市场：steipete/summarize（github.com/steipete/summarize，6,587 star 实测）、Claude in Chrome（code.claude.com/docs/en/chrome）、Codex Chrome（learn.chatgpt.com/docs/chrome-extension）、mcp-chrome（github.com/hangwin/mcp-chrome）、PageAssist（github.com/n4ze3m/page-assist）
- CLI 能力：code.claude.com/docs/en/headless、developers.openai.com/codex/noninteractive、opencode.ai/docs/cli、geminicli.com/docs/cli/headless、qwenlm.github.io/qwen-code-docs、github.com/deepseek-ai/deepseek-harness（对抗性核查确认核心 flag）
- 通信：developer.chrome.com/docs/extensions/develop/concepts/native-messaging、SW lifecycle、Local Network Access（developer.chrome.com/blog/local-network-access，chromestatus 5197681148428288）、Chromium #40755584
- 提取：github.com/mozilla/readability（Apache 2.0）、mixmark-io/turndown、jina.ai/reader
- 本地仓库：open-design `apps/daemon/src/runtimes/types.ts`（RuntimeAgentDef）、`skills.ts`；deepseek-harness `packages/host/apiproxy`
- 分发合规：developer.chrome.com/docs/webstore/program-policies、code.claude.com/docs/en/legal-and-compliance、theregister.com（2026-02-20 Anthropic 禁令报道）