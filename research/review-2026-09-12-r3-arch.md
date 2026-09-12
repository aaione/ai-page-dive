# PageDive 架构 Review（第三轮 · 2026-09-12 r3 · 最终发布态）

- **审查对象**：HEAD `d39cbce`（发布态；d3dfc75 之后仅一个修复 commit）
- **视角**：架构设计维度——硬约束逐条判定、协议演化模式、状态归属、测试分布、v2 演化余量
- **对照基线**：CLAUDE.md 硬约束 7 条；DECISIONS.md（含 2026-09-09 多引擎定案）；六份既有 review + `deep-analysis-2026-09-12.md`（已覆盖项不重复立案，但按指示复核三条 major 现状）
- **证据形式**：`file:line`（d39cbce 实测）；测试实测 `npx vitest run` → **76 passed / 76**（12 文件全在 packages/host）
- **方法**：全量精读 sw.ts / App.tsx / protocol.ts / registry / task.ts 关键段 + git diff d3dfc75..d39cbce 增量核对 + manifest / 行数 / 测试分布实测

---

## 0. Verdict（先行）

**GO（0 blocker / 1 major / 5 minor / 3 info）。** 架构支撑发布：七条硬约束无一实质违反（HC5/HC6 为文档与度量口径问题而非代码问题，各一行级修法）；v1 核心链路（取消终局、内容对账、看门狗、终局拒收）经六轮审查已收敛，本轮无新 blocker/major 级缺陷。唯一 major 是**沿用且结构性恶化的 arch-M1（panel 状态字段生命周期矩阵）**——d39cbce 的新增字段（resumable/aliveAt）使它从「应尽快做」升级为「发布后第一个 PR 必做」，但不构成发布阻塞（其近期产物 F1/F9 已在 d39cbce 修复）。v2 多引擎的「host 零改、SW 编排」主张在最新代码上复核仍成立，前置条件不变且只剩两件小事（arch-M3 采信帧 agentId、task-meta 门控）。

---

## 1. 硬约束符合性判定表（逐条，d39cbce 实测）

| HC | 判定 | 证据与说明 |
|---|---|---|
| HC1 权限面（无 `<all_urls>`） | ✅ | `apps/extension/public/manifest.json` permissions 恰为 activeTab/scripting/nativeMessaging/sidePanel/storage 五项，无 host_permissions；`<all_urls>` 仅存在于 E2E 构建变体（`vite.config.ts:18`，E2E_BROAD_PERMS 显式开关，不入生产产物）。d3dfc75..d39cbce diff 未触 manifest |
| HC2 prompt/正文走 stdin + 正文落临时文件 | ✅ | `task.ts:198` spawnCli stdinData=prompt；正文 `tmpfile.ts` UUID+wx 排他写；argv 零正文（三家 buildArgs 只含开关）。本轮 `originalName` 是 workflow 元数据字段，不触 prompt 通道 |
| HC3 零凭证接触 | ✅ | `registry.ts` cliEnv() 唯一改写 PATH；probeModel 只读 CLI 自身配置文件（`~/.claude/settings.json` 等），不碰 token。d39cbce 未触 |
| HC4 claude is_error 不只看退出码 | ✅ | `task.ts` isError 分支 + gotResultOk 豁免双路径健在；task.test.ts 17 用例含「is_error 路径 onDone(isError=true) 只发一次」回归（本轮实测通过） |
| HC5 host 薄壳 <2k 行 | ⚠️ | **raw wc 实测 2029 行，贴线超出 29 行**（含 `scripts/postinstall.ts` 107 行；剔除注释/空行后 code-only 1590 行）。v3 报告提示「余量仅十行级」现已兑现为名义超标。见 R3-A1 |
| HC6 v1 双适配器 | ⚠️ | `registry.ts:13` `AGENTS = [claudeDef, codexDef, opencodeDef]` 三家；CLAUDE.md HC6 写「claude + codex 双适配器」。**文档与代码事实源未对齐**。见 R3-A2（建议：改文档，不删适配器） |
| HC7 落盘路径 | ✅ | `history.ts` 年/月/日/时间戳-slug.md、workflows/skills 目录结构未动；d39cbce 的 workflows.ts 改动只加 originalName 守卫，路径语义不变 |

---

## 2. 三条既有 major 复核（arch-M1 / M2 / M3 在 d3dfc75/d39cbce 后的现状）

### arch-M1 任务终局语义三处分布 → **worsening（结构性恶化，定级维持 major）**

状态副本三方现状（d39cbce 实测）：

- **host**：Task 类生命周期标志位 7 个（cancelled/ran/finished/doneSent/timeoutSent/gotResultOk/contentDone，`task.ts:57-80`）——未增，稳。
- **SW**：模块级变量 9 个（currentTask/lastSession/currentAgentId/sessionTouched/lastModels/target/panelTabId/agentsCache/pinned，`sw.ts:21-82`）——未增，稳。
- **panel**：TaskStreamState 字段 9 个（taskId/messages/activeId/pending/finished/phase/done/**resumable**/**aliveAt**，`App.tsx:22-41`）——**d3dfc75/d39cbce 净增 2 个字段**。

恶化程度的量化（本轮核心结论）：panel 现有 **3 个 BLANK 重置点**（beginTurn `App.tsx:297` / beginSession `:307` / resumeHistory `:317`）× **9 个字段** = 27 格「保留/清空」生命周期矩阵，且字段已分化出四种生命周期类别（轮次级：taskId/activeId/pending/phase；会话级：resumable/messages/finished 累计；活性级：aliveAt；终局级：done）。**近两个 commit 内该矩阵已产出 2 个 shipped bug + 1 个错误修法**：F1（resumable 误随 BLANK 清零）与 F9（finished 台账漏记在跑任务）都是字段生命周期归类错误，F9 的首个修法提案（「保留 s.finished」）本身也是错的（v3 报告自认）。d39cbce 的修复方式是给 beginTurn 加行内注释逐字段解释保留语义（`App.tsx:294-296`）——**是在给矩阵写文档而不是消灭矩阵**，每加一个字段注释就长一行，正是不可持续信号。

**streamReducer 抽取的最小切面现在更紧迫了吗？是，且切面已完全成形**：d39cbce 的 App.tsx 里 6 个帧 case（chunk/status/alive/meta/done/error）+ 看门狗 setStream + 4 个重置/终局入口（beginTurn/beginSession/resumeHistory/onStartResult）已全部是 `(s) => ({...})` 纯函数形态，只是内联在组件里。最小抽取 = 把这 10 个变换搬进 `streamReducer.ts` 纯函数（约 150 行搬家，零逻辑改动），立刻获得单测能力（见 §4 测试清单）并消灭「字段生命周期靠注释维系」的模式。**建议定为发布后第一个 PR，赶在任何再往 TaskStreamState 加字段的改动之前**（v2 审校模式必然还要加字段，届时矩阵 12+ × 3）。

### arch-M2 extension 零单测 → **unchanged（定级维持 major，归入 arch-M1 的抽取 PR 一并解除）**

实测：`find apps/extension -name '*.test.*'` 零命中；76/76 用例全在 packages/host。d3dfc75/d39cbce 两 commit 的全部 panel 修复（resumable 保留、finished 补记、看门狗刷新面、task-alive 续命）依旧零回归网。落地清单见 §4。

### arch-M3 SW 会话归属靠 currentAgentId 时序推断 → **unchanged（v1 内 minor、v2 前置 blocker，建议发布后立即修）**

`sw.ts:316-330` 的 task-meta/task-done 捕获块**三处**仍用 `currentAgentId` 而非帧自带 `agentId`：

1. `sw.ts:318` `lastSession = { agentId: currentAgentId, ... }`
2. `sw.ts:323` `lastModels.set(currentAgentId, msg.model)`
3. `sw.ts:326` `agentsCache` 按 `a.id === currentAgentId` merge

协议侧 `TaskMetaMsg/TaskDoneMsg` 已定义 `agentId?`，host `stdio.ts:37/44` 已发送，panel 侧（App.tsx:142）已采信——**只有 SW 这三处不采信**，是三方一致性里掉队的最后一方。v1 可达窗口（取消 agent A 的任务 → 立即用 agent B 起新总结 → A 的迟到 task-meta 把 A 的 sessionId 记到 B 名下 → 追问走 B 的 CLI 带 A 的 session id）狭窄但非零；v2 审校串行交接（A done 同 tick 起 B，currentAgentId 已切 B）下**必现**。修法不变：三处改 `msg.agentId ?? currentAgentId`，<0.5 天。**这是 v2 开工清单上唯一必须先动的 SW 改动**，建议随 v1.x 首个 PR 与 streamReducer 同批落地。

---

## 3. 审查清单逐项

### 3.1 task-alive 协议帧与合成帧家族边界（清单 #2）

SW 合成帧家族实测为 **4 个成员，而非 3 个**：

| 帧 | 合成点 | 语义 | protocol.ts 注释 |
|---|---|---|---|
| `task-status{phase:'reading'}` | `sw.ts:423`（U1 提取窗口占位） | loading/停止钮即时反馈 | ❌ 未标注 SW 合成；且 `'reading'` 在类型联合里**无 host 生产者**（host 只发 spawned/thinking，`task.ts:195`/agents） |
| `task-error{code:'content-mismatch'}` | `sw.ts:308`（对账失败） | NM 丢片即取消 | ❌ 未标注 SW 合成 |
| `task-alive` | `sw.ts:296`（heartbeat 转译） | 看门狗续命 + 进度感 | ✅ 已标注 |
| `__host-disconnected` | `sw.ts:335`（NM 断连） | 停 loading 提示 | ✅ 已标注 |

**判定 [minor]（R3-A6）**：边界本身仍可推理——四个合成点各有独立且成立的理由（UX 占位 / 完整性 / 活性转译 / 断连广播），没有出现「同一帧型 host 与 SW 都发、语义分叉」的不可推理形态。但**注释契约只覆盖一半**：读 protocol.ts 的人会认为 task-status/task-error 全部来自 host，排障「panel 收到 content-mismatch 但 host 日志没有」时会错方向。建议：TaskStatusMsg 注明「`reading` 相位由 SW 合成（提取窗口占位），host 只产 spawned/thinking」；TaskErrorMsg 的 `content-mismatch` 注明「由 SW 合成（content-received 对账失败）」。两行注释，顺手修。

### 3.2 WorkflowSaveMsg.originalName 协议演化模式（清单 #3）

**判定：好先例 [info]（R3-A7）**。理由：

- **可选字段 + 语义内聚**：`originalName?` 只在改名语义下携带，host 侧守卫完整（`workflows.ts:118-125`：目标名撞其他用户模式即拒 + 成功后删旧目录防孤儿），协议注释把「何时携带、host 做什么」写清了——这正是 v2 多引擎消息（task-start 需要加第二引擎上下文、审校模式需要 reviewOf 关联）该复用的模式。
- **向后兼容性实测成立**：旧 host 收到带 originalName 的 workflow-save 会忽略未知字段，行为退化为「存新名 + 旧目录残留」——孤儿目录是良性降级（无数据丢失、无崩溃、无静默覆盖）。
- **一个需显式继承的规则**：MIN_HOST_VERSION 未抬高（`sw.ts:12` 仍 0.1.0），意味着降级是静默的。对本字段可接受；但 v2 若复用此模式，**降级必须良性且在协议注释里写明降级行为**（例：「旧 host 忽略 X 字段时行为为 Y」），恶性降级的字段必须抬版本门。建议把这条写进 DECISIONS 多引擎定案或 protocol.ts 文件头，作为协议演化守则。

### 3.3 状态归属恶化量化（清单 #4）

见 §2 arch-M1。量化结论重述：**9 字段 × 3 重置点 = 27 格生命周期矩阵；近两 commit 产出 2 bug + 1 错误修法（错误率实证）；d39cbce 用注释记录矩阵而非消灭矩阵**。streamReducer 最小切面（10 个已成形纯函数变换搬家）见 §2，紧迫度判定：**从「应尽快」升为「发布后第一 PR、v2 加字段前必做」**。

### 3.4 测试分布与 extension 首块测试落地清单（清单 #5）

现状：76/76 全在 host（task 17 / install 6 / codex-parser 7 / opencode-parser 8 / claude-parser 10 / stdio 5 / workflows 10 / history 29 项计 / buildargs 3 / version 2 / nm 4 / registry 7）；extension 零测试（arch-M2 unchanged）。

**落地建议（发布后第一周，与 streamReducer 抽取同一 PR）**：

- **新文件**：`apps/extension/src/sidepanel/streamReducer.ts`（从 App.tsx 抽出的纯函数：`reduceTaskFrame(s, m)` + `beginTurn/beginSession/resumeHistory/watchdogTimeout` 四个 action 变换）+ `apps/extension/src/sidepanel/streamReducer.test.ts`
- **基建**：reducer 抽成 `.ts` 纯模块（不 import React/DOM），root vitest 默认 include 直接覆盖（packages/host/test 同模式），**零新依赖、无需 jsdom**。apps/extension/package.json 加 `"test": "vitest run --dir src"` 可选
- **首批 10 个用例**（每个都锚定一个已 shipped 的 bug 或已知竞态，即「测试跟着 bug 分布走」）：
  1. 首帧绑定：taskId=null 时 task-status/task-chunk 绑定 + 建占位气泡（含 SW reading 占位帧）
  2. 绑定后异 taskId 拒收：chunk/status/alive 三帧族各自丢帧（防取消后尾随劫持）
  3. finished 台账拒迟到 chunk（收割尾巴不重开气泡）
  4. task-done/task-error 终局：解绑 + 记账 + streaming 收尾 + isError 气泡
  5. 迟到 task-done（异 taskId）：只收尾 streaming、不定稿新一轮（App.tsx:180 分支）
  6. **F1 回归**：beginTurn 保留 resumable（会话级字段）
  7. **F9 回归**：beginSession/resumeHistory 把在跑 taskId 显式记入 finished
  8. task-alive：不新建气泡、只更新 aliveAt + phase（含 finished/taskId 双门控）
  9. 看门狗超时：终局态写入 + 在跑 taskId 记入 finished + streaming 全收尾（App.tsx:85-100）
  10. onStartResult 错误终局：滤掉空占位气泡 + pending 解除
- **第二块（可选，v2 前）**：task-meta 门控用例（对应 R3-A5，v2 前 task-meta 补双门控时一并加）

### 3.5 v2 多引擎余量复核（清单 #6）

- **host 零改主张：成立（不变）**。stdio tasks Map 多任务、taskId UUID 临时文件（并发冲突面更小）、两任务两文件历史——d3dfc75/d39cbce 的全部改动（workflows 守卫、panel 状态字段）均未触 host 单例/单任务假设。
- **SW 编排：串行审校可行**。A 的 task-done 命中 currentTask 严格匹配清位（`sw.ts:283-289`）→ 同 tick 发 B 的 task-start 重占 currentTask——单槽串行语义恰好够用，无需并发改造。
- **两处 v2 前置缺口（均已立案）**：arch-M3 三处 currentAgentId（§2，v2 必现错记）+ task-meta 无门控（R3-A5，见下）。
- **panel 侧**：审校串行 = 单流状态机复用（B 的 chunk 天然新气泡）——但前提是 streamReducer 先落地，否则「B 的气泡挂 A 的会话态」类字段生命周期 bug 会以 27 格矩阵为温床继续冒。

---

## 4. Findings 汇总表

| # | 级别 | 摘要 | 证据 | 建议 |
|---|---|---|---|---|
| R3-A1 | minor | HC5 名义超标：host src raw 2029 行 > 2000（含 postinstall.ts 107；code-only 1590） | `wc -l` 实测 | 发布不改代码；在 CLAUDE.md HC5 显式定口径：「code-only（剔注释/空行）<2k，scripts/ 安装器不计入 NM host 运行时预算」——或如实改为「<2.1k raw」。禁止静默口径漂移 |
| R3-A2 | minor | HC6 文档-代码漂移：CLAUDE.md「claude + codex 双适配器」vs registry 三家（opencode 已含 8 个解析器测试 + probeModel + DECISIONS「opencode Gatekeeper v1 接受」专节） | `registry.ts:13`、CLAUDE.md HC6、DECISIONS 已知限制节 | **改文档不删适配器**。理由：① 代码是事实源，opencode 已测试 shipped；② DECISIONS 多引擎定案（引擎池/审校模式）本就需要第三家做前置；③ 发布前数天删适配器 = 无收益的回归风险。CLAUDE.md HC6 改「claude + codex + opencode 三适配器（多引擎定案前置，AgentDef 接口按六家字段并集设计）」 |
| R3-A3 | major | arch-M1 恶化（量化见 §2）：panel 9 字段 × 3 BLANK 重置点，近两 commit 2 bug + 1 错误修法；d39cbce 以注释记录生命周期矩阵而非消灭 | `App.tsx:22-45,294-330` | 发布后第一 PR：streamReducer 最小切面抽取（10 个纯函数变换搬家，~150 行，零逻辑改动）+ §3.4 十用例。v2 加字段前必做 |
| R3-A4 | minor（v1）/ v2 blocker | arch-M3 unchanged：SW 三处（lastSession/lastModels/agentsCache merge）仍用 currentAgentId 时序推断，不采信帧 agentId；host 已发、panel 已信、独 SW 不信 | `sw.ts:318,323,326` vs `stdio.ts:37,44`、`App.tsx:142` | 三处改 `msg.agentId ?? currentAgentId`，<0.5 天，随 streamReducer 同批落地。v2 审校第一个 PR 的硬前置 |
| R3-A5 | minor（自 info 升级） | task-meta 仍是无门控任务帧（F5），且 d39cbce 给它新增了 aliveAt 刷新——**无门控帧现在喂看门狗活性信号**，还会写 resumable（迟到 meta 的 sessionId 可把 codex 会话错标可追问）。v1 窗口窄（跨 agent 取消+起新）；v2 审校 claude→codex 交接必现 | `App.tsx:127-139`（无 finished/taskId 判定，`aliveAt: Date.now()` 为 d39cbce 新增） | 按 v3 方案补双门控（taskId===null 放行保留首帧绑定语义）；v2 前必须。与 streamReducer 合并落地，避免第五处复制门控 |
| R3-A6 | minor | protocol.ts 合成帧注释契约滞后：4 个 SW 合成帧只标注 2 个；`'reading'` 相位在类型联合中无 host 生产者（类型对生产者集合说了谎） | `protocol.ts:240-245,297-305` vs `sw.ts:308,423` | 两行注释：TaskStatusMsg 注明 reading 为 SW 合成、TaskErrorMsg 注明 content-mismatch 为 SW 合成 |
| R3-A7 | info | WorkflowSaveMsg.originalName 是 v2 协议演化的好先例（可选字段 + host 守卫 + 注释完整 + 良性降级）；缺一条成文的「可选字段演化守则」 | `protocol.ts` WorkflowSaveMsg、`workflows.ts:108-125` | 把守则写进 protocol.ts 文件头或 DECISIONS：「可选字段演进 = 降级必须良性且注释写明降级行为；恶性降级必须抬 MIN_HOST_VERSION」 |
| R3-A8 | info | arch-M2 unchanged：extension 零测试，76/76 全在 host；d3dfc75/d39cbce 全部 panel 修复无回归网 | find 实测、vitest 实测 | §3.4 落地清单（streamReducer.test.ts + 10 用例，零新依赖） |
| R3-A9 | info | v2 余量复核：host 零改成立、SW 单槽串行恰好够用；前置仅剩 arch-M3 + task-meta 门控两件 | `stdio.ts` tasks Map、`sw.ts:283-289` | 无新动作；维持「v2 开工前完成 A3/A4/A5」排序 |

### 与基线报告的增量关系

- arch-M1/M2/M3 为复核项（非新发现），M1 定级维持 major 并给出量化恶化证据，M2 维持 major 并给出解除路径，M3 维持 v1-minor/v2-blocker 双轨定级。
- R3-A5 从 v3 的 info 升级为 minor：d39cbce 给 task-meta 加 aliveAt 刷新（F4 修复）无意中扩大了这个无门控帧的写面（活性信号 + resumable），属于「修复扩面」型新证据。
- R3-A1 从 v3 的「余量十行级」预警兑现为名义超标，需要口径裁决。
- 其余为本轮新立案（HC6 建议、协议注释、演化守则、测试清单、v2 复核）。

---

## 5. 结论

**架构支撑发布，且支撑 v2 演化——附一个明确的债务清偿顺序。**

1. **发布**：0 blocker。七条硬约束无实质违反；两条 ⚠️（HC5 行数口径、HC6 文档漂移）都是文档一行级修正，建议随发布 commit 顺手清掉（R3-A1/A2），不要把「文档与事实源不一致」带进首个公开发布版。
2. **发布后第一周（顺序固定）**：① streamReducer 抽取 + 10 用例（R3-A3/A8，消灭 27 格生命周期矩阵）；② SW 三处采信帧 agentId（R3-A4）；③ task-meta 双门控（R3-A5，并入 ①）。三件事合计约 2 天，做完后 extension 侧同时获得回归网与 v2 就绪度。
3. **v2 多引擎**：host 零改 + SW 编排 + panel 单流复用的既定架构在 d39cbce 上复核全部成立；DECISIONS 多引擎定案无需修订。唯一新增的治理项是把「可选字段协议演化守则」成文（R3-A7），避免 v2 消息扩展时重蹈「静默降级无文档」的覆辙。
4. **趋势判断**：R1→R2→R3 三轮，blocker/major 从多发收敛到 0 blocker / 1 major（且该 major 是债务恶化而非新缺陷），minor 从面上收敛到窗口级与文档级。架构本身（NM 薄壳 host + SW 编排 + 可插拔 AgentDef）经受住了六轮对抗审查没有出现结构性返工信号——这是对「v1 架构选型正确」最有力的实证。
