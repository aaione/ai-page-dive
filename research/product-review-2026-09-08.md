# PageDive 产品严苛 Review（2026-09-08）

> 基于三份判决（分发方案 / 可优化点 / 扩展方向）整理，所有结论可溯源至各判决 reasoning。

---

## 执行摘要

**「能否不做 npm 包」——技术上能，v1 阶段不该。** 本机组件本身不可省略：浏览器沙箱内不存在任何免安装的本机进程调用通道，Native Messaging 要求本机落盘 manifest + 可执行文件；localhost HTTP/WS 替代通道需新增 host_permissions（违反硬约束 #1）、把端口暴露给任意网页、还需常驻 daemon（违背薄壳设计），被三重否决。但「不做 npm」的替代渠道（Homebrew cask / 单二进制 curl|sh / 签名安装器）均有成熟先例——问题在于 v1 目标用户（已装 claude/codex CLI 的开发者）100% 有 Node 和终端，npm 摩擦≈0，而 host 是 1885 行零依赖纯 Node，npm 全局装免编译免打包。**七个 NM host 先例无一用 npm 主渠道，正因它们需要编译运行时；PageDive 恰是 npm 分发的理想客体质，npm 是差异化优势而非妥协。**

**「零配置极限在哪」——一跳（一条终端命令），且已是当前设计。** 「零终端命令」在 Chrome 平台无合规解法，属 v2 签名桌面 App 范畴。补上 Tridactyl 式 curl|sh 便利脚本（内含 Node 探测 + brew 兜底 + checksum）后，一跳即该平台理论最优。

**当前最大差距不在架构而在扩展侧运行时健壮性**：SW 全内存状态（session-lost 可用 chrome.storage.session 低成本消除，P0）、200k 字符静默截断、task-content 分片无确认机制。架构选型（NM 薄 host、零凭证、stdin+临时文件、<2k 行）在先例对照下全部成立且是当前生态空白位，无方向性错误。

---

## 一、npm 包问题深度分析

### 1.1 本机组件是否可省（证据）

**不可省略是平台事实而非实现选择**：

- **NM 通道**：官方 NM 文档要求 macOS 在 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` 落 manifest JSON（name/path/type:stdio/allowed_origins）。「没有本机文件就没有 NM」。
- **Web 平台**：不存在任何能启动本机进程的 API（WebRTC 是浏览器间 P2P 媒体通道，与 IPC 无关）。
- **localhost HTTP/WS 替代通道被三重否决**：
  1. 扩展 fetch 127.0.0.1 需在 host_permissions 声明（且 localhost 与 127.0.0.1 要分别声明）——直接违反硬约束 #1；
  2. PNA/LNA 规范将 127.0.0.0/8 归为 local address space、要求 preflight，该规范存在本身证明裸 localhost 端口可被任意网页探测（CSRF/DNS rebinding），无法像 NM 的 allowed_origins 只绑定固定扩展 ID；
  3. 需本机常驻监听进程，而 NM 是 Chrome per-connection spawn、连接断即退，与 host 薄壳无常驻 daemon 的设计冲突。
- **content script 网络路线同样不通**：Chrome 130 起 content script 即使扩展持有 host_permissions 也总是以页面 origin 发跨域请求，必须绕道 background SW 再 fetch——多一跳且受 MV3 SW 30s 生命周期限制。这反向支持现有架构：页面内容由 SW 统一经 NM 下发。

**结论**：`npm i -g + install` 是逻辑必然。「零配置启动」的极限 = 用户敲一条终端命令 + 本地落一组文件。

### 1.2 分发方案对比矩阵

| 方案 | 用户负担 | 工程成本 | 风险 | 约束冲突 |
|---|---|---|---|---|
| **npm 主线（现状）** | 一条命令（目标人群摩擦≈0） | 0（维持现状） | nvm 切版本丢全局包 / PATH 互污 / EACCES——wrapper 写死 process.execPath 已缓解最大失败面 | 无 |
| **curl \| sh 便利脚本** | 一条命令（复制粘贴） | 2-4 人日 | 2026-04 已有 macOS malvertising 投毒 curl -L\|sh 实战攻击，必须带 checksum/签名校验 | 无（定位为 npm 的便利包装，内部仍走 npm） |
| **Homebrew cask（v1.x）** | 一条命令 | 1-2 周（含前置除障） | npm 与 brew 并存会互相改写 manifest path 指向（固定 HOST_NAME + path 单值的新失败面），须先加分发来源标记 | 无 |
| **单二进制 Go 重写（v2）** | 一条命令（免 Node） | 5-8 人日重写 + 2-3 人日 e2e 全量重跑 | 制造平行第二代码库；D10 已以 fatal blocker 否决（builtins 相对 import.meta.url 解析、install.ts hostPath 校验、三层路径全要换） | 与硬约束 #4「<2k 行 Node」表述冲突，需显式修订决策 |
| **单二进制 Node SEA（v2）** | 一条命令（免 Node） | 低（Node 25.5+ 一条命令出二进制） | 产物 80-110MB、Stability 1.1（Active development）；engines>=18 只剩软约束 | 无硬冲突，但气质不符 |
| **Bun compile** | 一条命令 | 中 | 90-100MB 官方自认 too big；Bun 不是 Node——spawn 密集 + pgid 收割行为差异需全量 e2e 重测 | 潜在行为差异 |
| **vercel/pkg** | — | — | npm 404 停更（2023-03），已死 | **禁用** |
| **dmg/pkg 未签名安装器** | 下载+双击 | 高 | Gatekeeper 对未公证产物比裸二进制更严；Developer ID $99/年对 v1 开发者受众零增益 | D10 已拍板否决 |
| **签名桌面 App（v2）** | 零终端（破圈非开发者） | 高（含 $99/年 Developer ID） | — | v2 范畴；KeePASSXC 模式（App 内开关自写 manifest）完全对位 |

**生态佐证**：七个受核查的 NM host 先例——browserpass（Go，apt/nix/brew tap）、Tridactyl（Nim，curl|sh）、fx_cast（Node 却仍打安装器+brew cask）、TabFloater（C++，Releases 平台二进制）、browsh（Go，Releases 单二进制+Docker）、KeePassXC（host 内置桌面 App）——无一用 npm 做主渠道，原因是它们都有编译运行时。PageDive host 是 1885 行零依赖纯 Node（仅 node: 内置 + Buffer + process），npm 全局装免编译、免安装器、免签名，是这七家里没人占的空白位。

**CWS 上架无政策障碍**：tabfloater（Companion 必装）挂 CWS 徽章长期在架，KeePassXC-Browser/1Password/Bitwarden 等需桌面端 host 的扩展均在架多年。CWS 红线是「扩展运行时自下载执行代码」，引导用户自行装 NM host 属用户主动 pull，不触线——建议商店描述明确标注 requires local companion (Node.js)。

### 1.3 推荐路线图

**短期（v1 发布前后）**：
- 维持 npm 单主线不动摇，不立项任何替代分发渠道（P0，成本 0）。README/商店描述标注 requires Node.js >= 18 + requires local companion (Node.js)。
- 面板 Onboarding 改为渲染一条可复制的 `curl -fsSL https://pagedive.dev/install.sh | sh` 便利安装命令（P0，2-4 人日）。抄 Tridactyl `:nativeinstall` 模式：脚本探测 Node（缺失给 brew install node 引导）→ npm i -g → `ai-page-dive install --ext-id`（幂等、origins union）；必须带 checksum 校验并文档明示风险。同时把面板硬编码 npm 语义文案抽象成「安装命令」，为换渠道留缝。

**长期（v1.x / v2）**：
- v1.x：Homebrew cask 第二渠道（P1，1-2 周）。前置两件事：(1) manifest 增加分发来源标记，防 npm 与 brew 并存互相改写 path；(2) 把 postinstall 的 npm/pnpm/yarn 启发式抽象成可被 cask post_install 复用的 registerManifests 调用。稳定后向 homebrew-cask 主仓提 PR。
- v2：按 D10 既定三条件（无 Node 流失可测量 / 愿投 Developer ID / Windows 提上日程，其一满足）立项单二进制，形态排序：Go 重写 > Node SEA（仅作 npm 包可选形态）> 签名桌面 App（KeePASSXC 模式服务非开发者破圈）。多渠道并存时统一走 GitHub Releases 作二进制 CDN。禁用 vercel/pkg；Bun 需全量 e2e 重测后才可考虑。

全部建议不触碰硬约束 #1-#6，无需修订任何决策。

---

## 二、产品功能可优化点

总体判断：架构选型在先例对照下全部成立，无方向性错误；差距集中在扩展侧运行时健壮性与工程卫生。

| 优先级 | Title | 改哪里 | Effort |
|---|---|---|---|
| **P0** | SW 关键状态持久化到 chrome.storage.session，消除 session-lost | `apps/extension/src/background/sw.ts`（实测零 chrome.storage 引用，lastSession 14 处全是内存变量，MV3 SW 30s 回收后追问报 session-lost、cancel 发不出）。改法：SW 启动时从 storage.session 恢复 lastSession/target/currentTask.taskId；task-meta/task-done 捕获 sessionId 时同步写入；followUp 前先查 storage 再报 session-lost；cancel 同理 | 1-2 人日 |
| **P1** | 长文截断显式化 + 评估上调 200k 上限 | `apps/extension/src/content/extract.ts` 的 MAX_CONTENT=200_000 两处 slice 均无 truncated 标志。改法：extractBest 返回 {markdown, originalLength, truncated}，经 task-start/task-meta 带到 panel 显示「原文 N 字符，已截断至 200k」；评估上限提到 400-500k（正文走临时文件由 CLI 分段读取，传输不是瓶颈，200k 主要限制总结深度） | 1 人日 |
| **P1** | task-content 传输完整性回执校验 | `sw.ts` 分片发送无确认机制，NM port 中途断开则 host 拿半截正文。改法：SW 在 task-start 帧带 contentTotalBytes；host（`packages/host/src/task.ts`）收齐后回 content-received {bytes}；SW 校验不一致或超时则重发/报错 | 1-2 人日 |
| **P1** | 提取置信度提示挂到 PageTips | `extract.ts` 的 extractBest 取最长 frame + innerText 兜底，无质量信号。改法：提取结果带 confidence 字段（readability 成功=高 / adapter 命中=高 / innertext 兜底=低 / 多 frame 长度接近=低），panel 在 PageTips 区提示「本页提取质量较低」 | 1 人日 |
| **P1** | 统一历史路径文档：CLAUDE.md 硬约束 7 与实现对齐 | host task.ts 实测落盘 `~/.ai-page-dive/history/`（与 DECISIONS.md ④ 一致），但 CLAUDE.md 硬约束 7 写 `~/.pagedive/history/`。修 CLAUDE.md 为 `~/.ai-page-dive`，防止 e2e 断言按错误路径实现 | 0.5 人日 |
| **P2** | E2E 构建不再原地改写 public/manifest.json | `apps/extension/vite.config.ts` BROAD 模式直接写源文件再靠 exit 钩子还原，被 kill -9 时 `<all_urls>` 残留（CWS 红线）。改法：复制 public/ 到临时目录、在副本上注入、vite 用副本作 publicDir | 0.5 人日 |
| **P2** | MAX_CHUNK 常量收敛到 shared 单一来源 | `packages/shared/src/protocol.ts` 与 `packages/host/src/task.ts` 各有一份 512*1024 且注释自认手工同步。host 已 devDep shared，直接 import | 0.5 人日 |
| **P2** | Onboarding 探测改指数退避 + 页面隐藏暂停 | `Onboarding.tsx` 固定 3s 轮询 probe，每次 spawn 冷启动 node 进程。改法：3s 起步指数退避封顶 15s，visibilityState=hidden 暂停，重新可见立即 probe | 0.5 人日 |
| **P2** | StreamMarkdown 增量分块渲染 | `sidepanel/StreamMarkdown.tsx`（实测 0 个 useMemo）全量重 parse。改法：按双换天切分已完成段落，每块独立 memo 化，仅尾部活跃段重渲染；64k 降级阈值可提到 128k | 1 人日 |
| **P2** | agents merge / 双 onMessage 监听收敛单一事实源 | SW 与 panel 各写一份 agents merge；App.tsx 与 Settings/HistoryView 双监听 runtime.onMessage。改法：SW 下发前完成 merge，panel 只渲染；监听收敛为 App 单入口分发 | 1 人日 |

**刻意不做（v2+）**：竞品标配的 PDF/YouTube 总结、划词解释/翻译、多模型切换，在硬约束 6（v1=零配置+总结质量）下属刻意不做。唯一 v1 该补的竞品位动作是安装兜底：npm i -g 失败（EACCES/nvm 丢全局包）时的引导文案容错——已并入第一章 curl|sh 建议，不阻塞。

---

## 三、可扩展方向

排序原则：先加固 v1 深度总结质量（P0），再做云端结构性做不到的增值（P1），最后是扩展生态（P2/v2+）。所有方向锚定「本机 CLI」独有能力（无限额、agentic 多步、本地读写、复用订阅、内容不出本机），均不违背硬约束。

### 排序清单

| # | 方向 | 优先级 | 用户故事 | 技术路径 | 为何竞品做不到 |
|---|---|---|---|---|---|
| 1 | **长文/多附件 agentic 分段精读管线（深度笔记而非摘要）** | P0，M（2-3 人周） | 丢进 200k 字长文或网页+附件组合，得到结构化深度笔记（论点树、术语表、可追问细节锚点） | 正文已写临时文件；内置 workflow 多阶段编排——生成大纲 → CLI 按节精读（claude -p --output-format stream-json 流式呈现中间步骤）→ 交叉引用合成终稿；host 仅需允许 workflow 声明多轮调用预算，超时从 10min 放宽可配置 | 多轮 agentic 精读单篇耗 token 是单次摘要 10-50 倍，MaxAI 免费档日限额 / Kagi 按 token 美元值 Fair Use 在经济模型上不可承受；本机订阅内零边际成本。v1「总结质量」的直接延伸，属主线 |
| 2 | **本地知识库直写导出（Obsidian/Logseq vault 一键存档）** | P1，S-M（1-2 人周） | 总结完成点「存入 vault」，带 frontmatter 的 markdown 直接落进 Obsidian 仓库并建双链 | Settings 配 vault 路径；host 复用 history.ts 现成 markdown+frontmatter 逻辑写第二份文件（幂等、原子写），零新依赖 | 云竞品导出要么 OAuth 接 Notion/Readwise API（凭证+配额），要么复制粘贴；本地直写任意目录是文件系统能力，内容不经任何第三方 |
| 3 | **敏感页面隐私模式（内网/邮件/医疗，免落盘保证）** | P1，S（数天） | 看公司内网 wiki、网页邮箱、体检报告页也敢点总结——开「不留痕迹」：不写历史、临时文件即用即删 | task-start 加 ephemeral 标志，host 跳过 history 落盘、临时文件 CLI 退出后立即 rm（现有 300s 延迟清理改即时）；UI 显眼开关 + 免责文案（对齐 D8） | 结构性不可能——全部 8 家竞品（含以隐私为品牌的 Kagi）正文必须上云才能推理，这不是功能差距是架构差距。把既有架构差异产品化，成本极低 |
| 4 | **本机代码库对照阅读** | P1，M（2 人周，主要在 cwd 安全边界设计） | 读框架 breaking change 公告时问「我的 repo 哪些地方会受影响」，agent 直接 grep 本地项目代码逐处对照 | Settings 注册受信项目根目录；host 将 spawnCli 的 cwd 从固定 workspace 切到该目录（spawnCli 已支持 cwd 参数，claude --resume 需按 cwd 分桶 session）；prompt 仍走 stdin，代码文件由 CLI agentic 自主读取 | 需把整个代码库上传第三方服务器（体积、隐私、安全合规三重不可行）；Cursor/Copilot 也不做「网页×本机代码」交叉。对开发者人群是杀手级场景 |
| 5 | **历史库 agentic 检索与追问** | P2，M（2 人周，v2+） | 面板直接问「上次那篇讲 RSC 的文章结论是什么」，CLI 扫历史目录回答并附链接，可跨文章主题综述 | 新增内置 workflow，把 history 根路径给 CLI agentic grep/read，零索引零向量库；panel 历史搜索框升级自然语言入口 | 全部阅读历史是本机 markdown 文件，云竞品要么没本地历史、要么得全量上传才能检索（隐私灾难）。**前置依赖：先统一 DECISIONS.md 与 CLAUDE.md 历史路径不一致** |
| 6 | **论断核查与延伸研究（agentic 多步验证）** | P2，M（2 人周，v2+） | 读评测/新闻/论文点「核查此文」，agent 对核心论断逐条多步搜索交叉验证，输出带引用的置信度评级和反例 | 利用 claude CLI 自带 web search 能力（AgentDef 已有 capabilityFlags --help 子串探测门控），纯 workflow 提示词编排，host 零改动 | 单次核查烧 5-20 次搜索 + 多轮推理 token，竞品分层限额下要么不可用要么锁高价位档（Kagi Research mode 锁 $25 Ultimate 档）；本机免费无限。需先在 v1 验证 agentic 工具调用稳定性 |
| 7 | **PDF/论文全文深度阅读（arXiv abs → 整篇 PDF 精读）** | P2，M（2-3 人周，v2+） | 在 arXiv abs 页点图标，直接基于整篇 PDF 出方法论拆解/实验对照/局限性分析 | adapters.ts 已有 arXiv 打样——扩展为提取 PDF 链接，host 下载到临时目录（入站流量，不违反内容不出本机），文件路径交 claude CLI（原生读 PDF）；prompt 走 stdin 给路径 | Kagi 文件上传上限 30MB 且必须上云，MaxAI 按次扣额度；本地读文件无上限零边际成本，付费论文不出本机。需逐站点验证可达性与容错 |
| 8 | **批量阅读队列与合并 digest** | P2，M-L（3-4 人周，v2+） | 白天攒 10 个 tab，晚上点「出 digest」，顺序深度总结合成带来源的合并简报（主题聚类、观点冲突标注） | 逐 tab 点图标入队（每次点击=activeTab 手势授权，规避 `<all_urls>` 硬约束）；队列与正文暂存 host 侧文件（绕开 SW 30s 回收单点）；host 顺序 spawn + 终轮合并 prompt | 10 篇 × agentic 深度总结 token 成本在竞品免费档必超限，付费档等于多掏 $20/月；本机零边际成本。逐 tab 手势有 UX 摩擦、host 需引入队列态（与薄壳 <2k 行抢预算） |

### 排除项及理由

| 排除方向 | 理由 |
|---|---|
| 浏览器操作/自动化 agent（Dia、browser-use、Claude for Chrome 路线） | 需 `<all_urls>` 或 debugging 权限直接违反硬约束 #1；prompt-injection 攻击面巨大（官方自治模式攻击成功率仍有 11.2%）；与「只读总结」定位冲突，且 Anthropic 官方已占据该心智 |
| 历史/设置云端同步与多设备同步 | 正文与历史出本机，击穿「内容不出本机」结构性差异（自废内网/敏感页面独占卖点）；引入服务端基础设施与 D9 免费开源路线冲突；与 v1 零配置无关 |
| 本地小模型兜底（PageAssist/Ollama 路线） | 本地小模型总结质量上限远低于 claude/codex 旗舰，违背 v1「总结质量」优先级；不利用 CLI 订阅核心优势；双适配栈翻倍维护成本，稀释薄壳定位 |

---

## 四、与开源方案/竞品对照：我们的位置与差异化

**云端侧边栏竞品（MaxAI / Kagi / Sider / Monica 等 8 家）的两条结构性软肋**：

1. **经济模型**：均为「云 API 转售 + 订阅 + 分层限额」，免费档锁小模型 + 日限额，Kagi 甚至按 token 美元值计费超量即停。PageDive 复用本机已登录 CLI = 一次订阅两处用 + 零额外限额。
2. **隐私架构**：全部 8 家（含以隐私为品牌的 Kagi）推理必须上云，页面正文必须离开本机。PageDive 内容不出本机——这不是功能差距是架构差距，且可产品化为可感知卖点（见方向 3 隐私模式）。

**生态位**：「复用本机 CLI 订阅做深度网页总结」目前无直接对标者（同构型项目全部 <15 stars），PageDive 占据空白位。但**窗口期仅数月**——steipete/summarize 高频迭代、Anthropic 官方扩展能力持续扩张，方向排序因此以加固主线为先。

**NM host 开源先例对照**：七个先例（browserpass/Tridactyl/fx_cast/TabFloater/browsh/KeePassXC）验证了三件事——(1) NM host + CWS 上架无政策障碍；(2) curl|sh 与 brew cask 是社区已接受的分发模式；(3) 无一用 npm 主渠道因均有编译运行时，PageDive 零依赖纯 Node 恰是 npm 分发的理想客体质。

**架构选型对照结论**：NM 薄 host、零凭证、stdin+临时文件、<2k 行，在先例对照下全部成立且是当前生态空白位，无方向性错误。

---

## 五、风险与开放问题

| # | 风险/开放问题 | 影响 | 对策 |
|---|---|---|---|
| 1 | **窗口期风险**：生态位无直接对标者但仅数月（steipete/summarize 高频迭代、Anthropic 官方扩张） | 差异化被侵蚀 | 加快 P0（精读管线 + session-lost 修复）落地，优先级排序以加固主线为先 |
| 2 | **npm 真实失败模式**：nvm 切版本丢全局包、brew/nvm PATH 互污、EACCES | 安装失败流失 | wrapper 写死 process.execPath 已缓解最大失败面（Chrome NM 以极简 PATH exec）；curl|sh 脚本内嵌 Node 探测 + brew 兜底；面板容错文案 |
| 3 | **curl\|sh 投毒**：2026-04 已有 macOS malvertising 实战攻击 | 安全声誉 | 脚本必须带 checksum/签名校验，文档明示风险；定位为 npm 便利包装而非平行渠道 |
| 4 | **多渠道 manifest 互抢**：固定 HOST_NAME + path 单值，npm 与 brew 并存互相改写 | 渠道冲突 | v1.x 上 cask 前必须加 manifest 分发来源标记；postinstall 启发式抽象为可复用的 registerManifests |
| 5 | **构建红线**：vite 原地改 public/manifest.json，kill -9 时 `<all_urls>` 残留工作树 | CWS 审核红线 | P2 修复：复制到临时目录再注入（0.5 人日）——发布前必须清掉 |
| 6 | **文档分裂**：DECISIONS.md ④ 写 `~/.ai-page-dive/`，CLAUDE.md 硬约束 7 写 `~/.pagedive/`，代码实现用 `~/.ai-page-dive` | e2e 断言与 install 逻辑分裂，新贡献者按错误路径实现 | P1 修 CLAUDE.md 对齐 DECISIONS.md（0.5 人日）；是方向 5（历史 agentic 检索）的前置依赖 |
| 7 | **SW 生命周期单点**：lastSession/target 全在 SW 内存，批量队列等未来方向也受此制约 | 追问失败、任务态丢失 | P0 chrome.storage.session 持久化；队列态设计上暂存 host 侧文件 |
| 8 | **Node SEA Stability 1.1**：若 v2 走 SEA，产物 80-110MB 且官方仍在 Active development | 体积与稳定性 | v2 形态排序 Go > SEA；SEA 仅作 npm 包可选形态 |
| 9 | **开放问题**：200k 截断上限是否提到 400-500k；StreamMarkdown 长输出性能阈值；Bun compile 的 spawn/pgid 行为差异 | 总结深度 / 长输出体验 | 均已列入 P1/P2 待办，按优先级排期 |

---

*报告完。三份判决原文 reasoning 可溯源；硬约束 #1-#7 均未被任何建议触碰（除 Go 重写需显式修订硬约束 #4 表述，已推迟至 v2 立项时处理）。*
