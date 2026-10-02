# 产品多维严苛 Review — r53（2026-09-30）

## 方法与规模

Workflow 多 agent 编排：8 维度并行深读（每 finder 先读 AGENTS/DECISIONS/r52 报告再下矿，防重复上报）→ 跨维度去重 → 双镜头对抗核查（证据镜头 + 影响镜头，双确认才收，分裂归争议）→ 完整性批评家扫盲区。57 agents，约 2.14M tokens。

原始发现 24 → 去重 24 → **确认 19（含 1 对跨维度重复，唯一 18）/ 争议 1 / 驳回 4 / 盲区 3**。

19 条确认全部由主会话逐条对照源码亲核（严苛标准），无一仅凭 agent 陈述收录。分级：**P2×6、P3×12**（唯一化后），无 P1。

## 总体结论

产品主干（NM 通信、进程收割、流归一化、历史落盘）经 r47-r52 五轮深审后已相当扎实，本轮零 P1。剩余确认项集中在三个簇：

1. **状态机边界的「无邮戳帧」**——task-done/__host-disconnected 的 pending 击穿族（#5/#6），是 r52 P1 竞态修复的同族尾巴；
2. **生命周期的「只删一半」**——附件软链、删历史残留附件、timeout 先删后收割（#4/#7/#8）；
3. **测试网覆盖的声明面**——2220 行 UI 编排零锚、e2e 硬编码路径（#13/#17）。

另有三个**结构性盲区**（prompt 注入面、ext↔host 升级漂移、token 经济）是八维度都没碰的，见文末——比单条 P2 更值得排期。

---

## 确认缺陷清单

### P2（6）

#### #1 升级横幅命令未钉版本，与「钉版本」头号信任卖点自相矛盾
- **点位**：`apps/extension/src/background/sw.ts:365`
- **证据**：outdated 横幅给的是裸 `npm i -g @aaione/ai-page-dive`。而钉版本是本项目头号信任动作（Onboarding FAQ 已钉版本 + b556cf8 ③把 FAQ 第二处 npm 命令收编进 npmCmd 常量——横幅是漏网的第三处）。
- **影响**：老用户按横幅升级到意外新版（major 转变时是错误指令）；且横幅命令缺 `ai-page-dive install --ext-id` 二段，NM 注册可能悬空。
- **修法**：横幅复用 npmCmd 单源 + 完整两连命令。
- **亲核**：✓ 源码直读。

#### #3 listSkills 缺目录名校验——非法名技能进列表后启用即静默失效
- **点位**：`packages/host/src/skills.ts:29-33`（对照 workflows.ts:68-70、skills.ts:51）
- **证据**：`listSkills` 的 `out.set(e.name, …)` 不过 `assertValidWorkflowName`；`getSkillBodies:51` 却校验并 `continue` 跳过。r50 注释宣称「同一 skills 列表」防线，实际列表路径没有。
- **影响**：目录名含 `/`、`..` 等的技能出现在列表 → 用户选用 → getSkillBodies 静默丢弃 → 技能不生效且无提示。
- **修法**：listSkills 入 set 前同样校验并跳过（或校验后打日志）。
- **亲核**：✓ 源码直读。

#### #5 迟到终局帧（无 tabId 邮戳）可击穿面板 pending 态——双发门在提取窗口被打开
- **点位**：`apps/extension/src/sidepanel/App.tsx:470-488、520-588`（配合 `background/sw.ts:597-601`）
- **证据**：`foreignAdopt`（App.tsx:155-156）只拦「有数字 tabId 且不匹配锚」的帧；sw.ts:597-601 对非 currentTask 的帧**原样转发不盖邮戳**。task-done 分支 :478-488 在 `s.taskId === null && s.pending` 时无任何守卫直接落终局（清 pending、记 finished）。
- **场景**：双窗口，A 面板发起总结（cancelCurrent 连坐砍掉 B 的在跑任务）→ A 处于 pending 提取窗口 → B 任务的真终局帧从 host 迟到，无邮戳直达 A → A 的 loading 消失、输入解锁 → 用户再发 = 双发。
- **影响**：与 r52 P1 冷启动竞态同族的无邮戳击穿；追问路径窗口数百毫秒，总结路径被 task-status reading 帧缩窄但未封死。
- **修法**：终局帧（done/error/disconnect）对 pending 面板同样过邮戳归属：无邮戳 + 非本面板任务 → 丢弃（或 sw 转发时一律补发方 tabId 邮戳，治本）。
- **亲核**：✓ 三处源码直读，场景逐步走通。

#### #7 删除历史条目后对应附件永久残留
- **点位**：`packages/host/src/history.ts:259-262`（配合 task.ts:105-127、stdio.ts:132-135）
- **证据**：`deleteHistory` 只有 `assertInRoot(path); await rm(path)`——删 md 单文件；pruneHistory:196-213 也只 unlink `.md`。`~/.ai-page-dive/attachments/` 无任何清理出口。
- **影响**：隐私面——用户「删除历史」的心智是连内容一起删，附件正文永久留存本盘。
- **修法**：md frontmatter 已记附件路径（r51 持久化）→ deleteHistory 读 frontmatter、连带删附件（孤儿扫描可后置 v2）。
- **亲核**：✓ 源码直读。

#### #13 SummarizeView/App 共 2220 行 UI 编排零测试
- **点位**：`apps/extension/src/sidepanel/SummarizeView.tsx`（114-182 回填族）+ `App.tsx`（540-620 消息编排）
- **证据**：extension 测试文件只有 historyTurns / workflow-labels / sw 三个；无任何测试 import App 或 SummarizeView。实证：r47 回填族 bug 在 r52 #9 原样复发——该区域无网不是理论风险。
- **影响**：本轮 #5/#6/#9/#10 四条 P2/P3 全落在这 2220 行里，回填/终局编排每轮深审都出新伤。
- **修法**：不必求全覆盖——先锚「终局帧 × 面板状态」矩阵（pending/streaming/idle × done/error/disconnect，6 格）+ 回填守卫，用 r52 SW 网同款 chrome/nm mock 思路。
- **亲核**：✓ grep 全测试文件确认。

#### #17 e2e 四脚本 import 硬编码本机绝对路径，他机/CI 必然跑不起来
- **点位**：`scripts/e2e.mjs:7`（e2e-ui.mjs / e2e-runtime.mjs / e2e-opencode.mjs 同）
- **证据**：`import ... from '/Users/apple/.nvm/.../playwright-core/index.mjs'`——四脚本各 1 处。
- **影响**：e2e 资产是死资产：换机、CI、协作者全部当场报错；「钉死依赖路径」的正确做法是 resolve 包根而非写绝对路径。
- **修法**：`createRequire(import.meta.url).resolve('playwright-core')` 一行替换四处。
- **亲核**：✓ grep -c 四脚本各 1 命中。

### P3（12，唯一化后）

#### #2 curl|sh 安全 FAQ「不下载二进制、不写系统目录」与 Homebrew 兜底冲突
- `README.md:65` 无条件宣称「只装 npm 包……无 sudo、不写系统目录」；install.sh:16-18 有 brew 兜底（brew 写 /opt/homebrew，极端时引导 sudo）。**修法**：FAQ 收窄为「默认路径 npm 无 sudo；Node 缺失时 brew 兜底可能写 /opt/homebrew」。✓ 亲核。

#### #4 timeout 两条终局路径 cleanupCwd 先于 reap——违反自身 M5 不变量
- `task.ts:288-289`（timeout 成功路径）、`:298-300`（timeout 失败路径）都是 cleanupCwd → reap；error 路径 :319-323 是正确序并自述「先收割再删 cwd」（M5）。进程树还活着时目录先被删，CLI 子进程可能向已删 cwd 写/重建路径。**修法**：两处对齐 reap→cleanupCwd。✓ 亲核。

#### #6 __host-disconnected 空闲态无条件回填
- `App.tsx:611` `rf = refillFor(s, lastUser)` 无条件执行；:602-605 守卫只覆盖 `m.taskId != null` 的帧；:620 needBubble 只看 s.pending。空闲面板 + host 崩溃 → 上一轮**已成功**的问题静默回到输入框。**修法**：refill 仅在 `s.pending || s.taskId === m.taskId` 时构造。✓ 亲核。

#### #8（=#12 跨维度重复）附件软链无界累积
- `task.ts:122` 每轮 `symlink(p, join(agentCwd, basename(p)))`；:105 注释「不清理——历史恢复可追溯」；cleanupCwd 显式豁免 stableCwd（:428-433）。每任务含每轮追问各留一条永不清理的软链；唯一受益者 opencode 已下架。**修法**：resume 轮先清本轮同名旧链（幂等重建），或 agentCwd 内链接带轮次后缀。✓ 亲核。

#### #9 history-read 失败不消费 read-fail，干等 12s
- `App.tsx:276-284`：还原路径只有 12s setTimeout 兜底；App listener 无 `error` case 消费 host 的 read-fail 帧（stdio.ts:130）。文件被外部移动/删除后面板重开干等 12 秒才降级。**修法**：listener 加 read-fail 分支立即走兜底 UI。✓ 亲核。

#### #10 文案承诺「已放回输入框」，草稿守卫会静默跳过回填
- `SummarizeView.tsx:185` `setInput((cur) => cur.trim() ? cur : r.text)`——用户有草稿时不回填；App.tsx:614/920 文案无条件承诺「你的问题已放回输入框」。**修法**：文案改「已放回输入框（未覆盖已有草稿）」或回填时带 toast。✓ 亲核。

#### #11 history-read 的 JSON 编码校验只覆盖 >900KB 分支
- `stdio.ts:116-127`：JSON 字节数复检只在 >900KB 截断分支做；≤900KB 但转义密集（`\n`、`\"`、CJK 双写）的历史文件截断后可击穿 1MB NM 帧限 → encodeFrame 抛 oversize → 历史静默不可读。**修法**：截断后无论原始大小一律复检编码后字节数。✓ 亲核。

#### #14 sw 回归网只锚注释链前半
- r12「会话按源 tab 归档不串台」、r13「预 disable 幂等」在 sw.ts 有整段注释与逻辑，sw.test.ts 无对应锚。**修法**：补 2 用例（多 tab 归档隔离 / 重复 disable 幂等）。✓ 亲核（本人所写测试，短板属实）。

#### #15 runnative.test.ts 固定 wait(150) 对赌子进程冷启动
- SIGTERM 用例先 wait(150) 再发帧——赌 host 子进程 150ms 内注册完 term 探针；慢 CI 上冷启动超 150ms 则用例偶发。**修法**：改为轮询 stderr 等待 `[pd-test] term` 注册标记（reap.test.ts 的 GC_READY 同款手法——当时两文件一前一后写的，后写的用了对的手法）。✓ 亲核（本人所写，属实）。

#### #16 content 提取器与 page 协议契约零行为锚
- sw.test.ts:137 用 executeScript mock 直接喂成品 PAGE 对象；extract.ts:1-139（DOM → markdown 的全部降级链）零测试。**修法**：抽 extract 纯函数对 3 类真实 DOM 片段（article/无主容器/iframe 混排）断言输出。✓ 亲核。

#### #18 host README 内置 workflow 清单少列 2 档
- `packages/host/README.md:23` 写「内置 deep / paper / quick」；实际 `packages/host/builtins/` 五目录：**deep / humanize / paper / product-audit / quick**（b556cf8 已单测锁定五档雅名）。npm 发布面的直接事实漂移。**修法**：改清单 + 顺手在 workflow-labels 测试加「五档名与 builtins/ 目录一致」断言，防再漂。✓ 亲核（ls builtins/ 实证）。

#### #19 chrome-mock 头注释声明的 ?noskills=1 场景开关未实现
- `chrome-mock.ts:8` 头注释承诺该开关，全文件仅此 1 处 `noskills` 字样——无任何 `q.get('noskills')` 消费。**修法**：实现或删注释行。✓ 亲核（grep 全文件 1 命中）。

---

## 争议项（1）

**历史列表「在 Finder 中显示」失败零反馈**：host stdio.ts:141 失败回 `reveal-fail` 帧，HistoryView listener 只处理 read-fail/delete-fail，reveal 漏网（按钮 fire-and-forget）。证据镜头确认帧确实无消费者；影响镜头指出同类「点了没反应」在 r3-ux 已定性为必修（R3-m2）。争议点不在是否存在而在修不修——建议随 #9 一并处理（同族：host 错误帧无消费者）。

## 被驳回项（4）

1. **版本比较双源（sw.ts versionLt vs workflow-labels verLt）**——两函数输入同源（同一 manifest 版本串），无法漂移出不同结果；且 b556cf8 已单测锚定语义。
2. **跨窗口换锚 panelTabId 单槽覆盖**——r9 已记录为 backlog 的既知设计，非本轮新缺陷。
3. **content-mismatch 分支漏登 cancelledTaskIds**——时序在 host 侧封死：cancel-ack 后 host 不再发该任务帧，迟到帧场景不成立。
4. **runnative beforeAll 全量 pnpm build 的 CI 隐含依赖**——CI 本就 pnpm + build-before-test，重复合规非缺陷。

## 盲区三角度（完整性批评家产出——八维度都没碰，建议优先排期）

### ① Prompt 注入面：不可信网页内容 × 持工具权限的 CLI agent
产品核心数据流 = 把用户无控制权的网页正文喂给有文件系统/命令工具的 agentic CLI。r48-M7 给 claude 钉了 `--permission-mode default`、r6-sec 给 codex 钉了 `--sandbox read-only`，但 codex.ts:78-83 注释自曝：**resume 子命令无 --sandbox flag，read-only 围栏靠 `-c sandbox_mode="read-only"` config 覆盖「等价保持」——从未经对抗验证**（config 覆盖与 flag 在 codex 内部是否同一执行路径、能否被会话内指令解除，零验证零测试）。建议：一次人工对抗实验（resume 轮诱导写文件/出围栏），不通过则 resume 轮补围栏或降级拒绝。

> **r54 修正（同日 live-fire 实弹，codex 0.156.1）**：三路径围栏全部实测有效——codex fresh `--sandbox read-only` 拦 touch（Operation not permitted）；resume `-c sandbox_mode="read-only"` 同拦，且加发 control（仅换 `danger-full-access`）同 touch 即放行，证明 `-c` 是活配置通道而非会话沙箱继承的巧合，**等价性悬案闭环**；claude `--permission-mode default` 三次越权尝试（Bash×2/Write×1）全拒。但发现新旁路：**codex 路径未封用户 MCP server**（claude.ts:124 有 `--strict-mcp-config --mcp-config {"mcpServers":{}}`，codex.ts 全文零 mcp 字样）——read-only 沙箱不约束 MCP 调用，实测 codex spawn 真在连用户 config.toml 声明的 MCP server（rmcp worker 连 127.0.0.1:3845）。升 **P2**，见 r54 报告 #8。

### ② 扩展 ↔ host 升级漂移：无协议版本握手
host 用户装一次就忘，扩展从 CWS 自动更新——两条升级轨道天然异步。shared/protocol.ts `version?` 可选、无 MIN_HOST 强制握手；nmconst.ts 头注释自认 MAX_CHUNK 契约是两份拷贝。**「新版扩展发消息给旧版 host（或反向）」的行为无人审过**：优雅降级还是静默吞消息导致升级后按钮无响应？这类 bug 一旦发布即覆盖全部存量用户（P1 级）。install.sh 重装幂等性、allowed_origins 的 dev/CWS ext-id 不一致同属此面。建议：协议加最低版本握手 + 老 host 收未知 type 的显式 error 回帧（r51 已补 unknown 计数，还差拒绝语义）。

> **r54 修正**：本段「无版本握手」判断**有误，r53 漏察**——握手实际存在：sw.ts:15 `MIN_HOST_VERSION` + probe 后 `versionLt(hostVersion, MIN_HOST_VERSION)` 判 outdated 弹一次性横幅（含升级命令），nmport 透出 hostVersion，host version.ts 读失败兜底 0.0.0 强制提示（失败方向安全）。npm 实查唯一已发布版 0.1.2 已含全部 ext→host 依赖消息，现存版本对无失配。剩余真缺口收窄为：① stdio.ts switch 17 个 case **无 default**——未知消息仍静默吞（P3 加固项，r54 #10）；②「新增依赖型消息须同步抬 MIN_HOST_VERSION」无构建期强制（纯流程债）。

### ③ 用量经济面：页面体量无上限 × 复用用户订阅
头号承诺「复用用户已有 CLI 订阅」，但全链路无人体检过「一次深读烧多少 token」。stdio.ts 已有 >900KB 历史文件分支说明大体量真实存在；extract.ts 无任何截断/上限锚点——10MB DOM 全量进 prompt，轻则击穿 CLI 上下文上限报错（失败 UX 维度只看了进程失败没看模型层失败），重则单页烧掉订阅额度显著比例，直接反噬信任卖点。建议：extract 出口加体量上限 + 超限显式提示（v1 只需常量 + 文案）。

> **r54 修正**：本段「无任何截断/上限锚点」判断**有误，r53 漏察**——extract.ts:13 `MAX_CONTENT = 200_000` 在全部提取路径生效（readability 主链 :110、innerText/shadow 兜底 :107/:20/:28 四处 slice），截断 notice（:118-121）与 approxTokens（:133）均已随 PageContent 透出。200k 字符 ≈50k tokens，低于 claude 200k 上下文 3.7 倍余量，无失败模式；最坏组合（200k 页 + humanize 全文改写 + 5×512KB 附件）≈110k tokens 仍不超限。剩余真缺口收窄为：仓库零真实 contentMarkdown 样本、200k 取值无数据支撑（P3 观测债，r54 #11）——修法是把 extract 已算出的 originalChars/truncated 落进 history frontmatter 自然积累分布（record-fixtures 只采 CLI 流、不触提取管线，瞄它没用）。

## 建议行动顺序

1. **修 P2 六项**（#5 无邮戳击穿是 r52 P1 同族尾巴，最优先；#1/#3/#7/#17 修法都是几行级）
2. **盲区①对抗实验**（一次性人工验证，成本半天，风险敞口最大）——r54 已完成：围栏全有效，新出 codex MCP 旁路 P2（见 r54 报告）
3. **P3 十二项**（#4 两行换序、#18 一行清单 + 断言，先摘便宜的；#13 测试网是中期工程）
4. **盲区②③排入 r54+**（协议握手涉及双端发布节奏；token 上限涉产品决策）——r54 已审：②的握手已存在（见上方修正），③的上限已存在（见上方修正），均降级为 P3 加固项

## 附录：亲核记录

19/19 确认项全部由主会话直接读源码核对（含 builtins/ 目录 ls、四脚本 grep 计数、extension 测试面 grep），争议/驳回项理由亦经复核。分级沿用 workflow 双镜头结论，P 级以影响面重校（无 P1：全部不触及数据损坏/安全边界突破/全量用户不可用）。
