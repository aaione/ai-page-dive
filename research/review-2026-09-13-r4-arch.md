# PageDive 第五道审视线 · 终态架构 Review（r4-arch）

- 日期：2026-09-13
- 基线 commit：`c7f5fa1`（第四轮对抗审查 14 项修复后终态）
- 前序：r1（产品严苛 review）→ r2（发布就绪审计）→ r3（`review-2026-09-12-r3-arch.md`，GO 0/1/5/3）→ r4 修复轮（c7f5fa1）→ **本轮 = 修复后终态的第五道审视**
- 审查方式：全仓实测（git 考古 + 逐文件静态分析 + 逐 commit 行数回溯），非偏好判断

---

## 0. Verdict（先行）

**GO（0 blocker / 2 major / 4 minor / 2 info）。**

v1 发布不阻塞：c7f5fa1 的 14 项修复质量高（arch-M3 会话归属已正确消解、cleanupCwd 四路径收口、frontmatter 去重把 host 运行时口径拉回 1956 < 2000）；panel-ready 协议扩展经共存矩阵验证无兼容风险（§1）。两条 major 均不挡发布：arch-M1/M2 沿用（发布后第一个 PR 必做，r3 已定级，本轮复核未恶化也未消解）；新增的是 **v2 前置的 SW 状态单值化阻碍**（§3）——它不 impact v1 任何行为，但会让 v2 多引擎编排的第一周就撞墙，定级「v2 开工前必须」。

---

## 1. c7f5fa1 架构影响：panel-ready 协议扩展的向后兼容矩阵

### 1.1 结论：矩阵安全，且比表面看起来更安全

本次扩展涉及三块：frontmatter.ts 抽取（host 内部重构，无协议面）、cleanupCwd（host 内部资源管理，无协议面）、panel-ready 响应新增 `hasSession` / `activeTask` 字段。逐一过共存矩阵：

| 共存场景 | 判定 | 依据 |
|---|---|---|
| 新扩展 + 旧 host | ✅ 安全 | `hasSession`/`activeTask` 由 **SW 侧合成**（`sw.ts` panel-ready case 从自身 `lastSession`/`currentTask` 派生），不依赖 host 任何新帧。host 的 `task-meta` 帧自带 `agentId` 自 `19448d4`（2026-09-04，早于 0.1.0 发布）就存在（`stdio.ts:37` 无条件发送），不是本次新增字段——新 SW 的 `owner = msg.agentId ?? taskId 兜底`（`sw.ts:322-336`）在现存所有 host 版本上都有真实数据支撑，兜底分支实际是防御性死代码（好事） |
| 旧扩展 + 新 host | ✅ 安全 | host 侧本次零协议变更（frontmatter/cleanupCwd 均为内部实现）；`agentId` 在 `protocol.ts:210/227` 本就声明为 optional，旧 SW 忽略之 |
| 旧 SW + 新 panel（或反之） | ✅ 不存在 | SW 与 panel 同属扩展单一 bundle，Chrome 原子更新，**这个象限在物理上不存在版本差**——这是扩展架构对比传统 C/S 的天然红利，review 时可直接划掉矩阵的四分之一 |
| host 版本门槛 | ✅ 未触碰 | `MIN_HOST_VERSION = '0.1.0'`，host repo 版本 0.1.1。本次扩展没有抬高门槛，也没有引入「新扩展依赖新 host 帧但门槛未抬」的隐性漂移 |

### 1.2 本次扩展的正确性复核（超出兼容性）

`activeTask` 透出 `{ taskId, startedAt }` 的最小切面设计得当——只给身份与时刻，不透传 content/page（SW 单例持有，panel 按需经既有消息取）。panel 消费端的守卫 `if (s.taskId !== null || s.activeId !== null || s.pending) return s`（App.tsx panel-ready handler）正确防止了「重开面板撞上仍在内存的流状态」双重绑定。这层是 c7f5fa1 里质量最高的修复。

### 1.3 附带缺口（minor，见 F3）

panel-ready 响应形状（`ok/outdated/page/hasSession/activeTask`）**无类型契约**：`protocol.ts` 定义了 36 种 NM 帧，但 panel↔SW 的 runtime 消息（panel-ready/summarize/cancel/new-session/set-pinned…）一个都不在 shared；App.tsx 消费端用内联 `as { taskId: string; startedAt: number }` 断言。功能无碍（同 bundle 同版本），但每加一个字段就多一处双端手写形状——正是本次扩展用的模式，下轮扩展还会用。

---

## 2. SW（sw.ts 516 行）职责膨胀：拆分阈值判定

### 2.1 现状实测

- 516 行、12 个函数、`handleMessage` 7 个 case、**7 个模块级可变状态**（currentTask / lastSession / currentAgentId / sessionTouched / target / agentsCache / pinned，另有 lastModels Map 与 panelTabId）
- panel-ready 单 case 现承担五职责：① dock 对齐（panelTabId fallback + anchorPanel）② NM probe ③ 版本握手（versionLt + outdated 文案）④ tips 页元数据 ⑤ 会话/任务恢复态透出（hasSession/activeTask）

### 2.2 判定：**v1 未到硬阈值；v2 编排器进入前必须拆**。依据是三条可量化信号，不是行数偏好：

1. **状态读写图已全联通**：7 个 let 中，panel-ready 路径读 5 个（lastSession/currentTask/target/panelTabId/agentsCache）、写 2 个；startSummarize 写其中 4 个。任一职责的改动半径都是整个模块——这是「内聚假象」的典型形态：五行职责看似都服务「panel 生命周期对齐」，实际共享的只是可变全局状态而非领域概念。
2. **修改加速度可测**：r4 一轮修复给 panel-ready 加了 2 个响应字段 + panel 消费端约 40 行。恢复类需求（重开面板/切 tab/SW 回收重建）每出现一种丢态场景，就会往这个 case 塞一个字段——hasSession/activeTask 是第 6、7 个字段，且没有收敛迹象（v2 还会要 per-agent 恢复态）。
3. **反证：无 bug 归因于尺寸**。本轮 14 项修复只有 1 项落在 sw.ts（迟到 cancelled 带 taskId），且是逻辑漏洞非结构问题。516 行本身没有制造错误率——所以「现在必须拆」不成立，拆它是为了 v2 而不是为了 v1。

**v2 阈值的具体推演**：v2 编排器（A 的 task-done 同 tick 发 B 的 task-start，DECISIONS 定案）需要在 SW 里新增 per-agent session map、任务等待队列、编排状态机，保守估计 +150~250 行进 sw.ts → 700 行单文件、模块级可变状态翻倍至 14+，且与现有 7 个 let 全部交叠。到那时再拆是拆带电线路。

### 2.3 建议切面（v2 前必须，非现在）

- **sessionStore**：lastSession + lastModels + agentsCache + persistSession/restoreSession 整体搬出（这组状态的唯一共性就是「会话域持久化」，天然内聚）；
- **orchestrator**：currentTask + currentAgentId + startSummarize/startFollowUp 的任务生命周期段；
- handleMessage 收窄为纯路由 + panel-ready 响应合成。
拆分与 §3 的单值化改造同批做，一次迁移一次回归。

---

## 3. 多引擎审校模式（v2）剩余阻碍清单

lastSession 归属（跟帧 agentId）本轮已修且修法正确（§1.1）。在当前终态上逐项复核「SW 编排、host 零改、panel 单流状态机复用」三主张：

| # | 阻碍 | 现状证据 | 影响 | 定级 |
|---|---|---|---|---|
| V1 | **lastSession 单值结构** | `let lastSession: { agentId, sessionId, historyPath? } \| null`——只有「上一轮」概念。审校模式 A、B 的 session 需并存（追问要能分别续 A/B 的会话），单值意味着 A done 起 B 时 A 的 session 被顶掉 | v2 第一周必撞 | **v2 前必须**（改 per-agent Map，随 §2.3 sessionStore 拆分同批） |
| V2 | **currentTask 单值** | `currentTask` 同时承担「在跑任务句柄」+「内容暂存」（A 的输出要喂 B 的 prompt）。编排期 A 在跑、B 待发时单值无法表达两阶段 | 编排队列的地基缺失 | **v2 前必须**（随 orchestrator 拆分设计） |
| V3 | panel 单流复用的前提 = arch-M1 消解 | messages 已带 agentId 标识（实测 App.tsx TaskStreamState 后半段含 agentId 引用）——并流渲染基础在；但 9 字段 × 3 BLANK 重置点的生命周期矩阵未抽 reducer，v2 给每条消息加引擎署名、给流加「A 完成 B 接棒」中间态时，矩阵先爆 | v2 加字段前必须 | **v2 前必须**（= arch-M1，发布后第一 PR 顺位） |
| V4 | host 零改主张 | 复核成立：A 输出→B prompt 走 stdin 通道已有；正文临时文件机制复用；NM 帧面不需要新帧。唯一注意：若 v2 某功能需要 host 新帧，MIN_HOST_VERSION 机制已就绪（单值 '0.1.0'，抬门槛即可） | 无阻碍 | 记录即可 |
| V5 | task-meta 门控（r3 提出的另一件前置） | 已随 owner 计算一并修掉：`msg.agentId ?? (currentTask && msg.taskId === currentTask.taskId ? currentAgentId : undefined)` 同时解决了归属与门控 | 已消解 | — |

结论：v2 剩余阻碍 = V1/V2（SW 状态单值化，一次拆分解决）+ V3（=arch-M1）。三件都是**结构性准备**而非协议/能力缺口——「host 零改、SW 编排」路线在终态上依然成立，且 host 侧确实无需动。

---

## 4. host 1956 行 vs <2000 红线：现状健康、趋势不健康

### 4.1 现状

- raw 总量 2063（含 `scripts/postinstall.ts` 107 行安装器）；**运行时口径 1956**（剔 postinstall），commit message 自述口径与实测一致
- c7f5fa1 的 frontmatter.ts 抽取（三处同构去重）是**净减法修复**——这在连续修复轮里少见，值得肯定
- 最大文件 task.ts 567 行，无单文件肥大

### 4.2 趋势（逐 commit 运行时行数回溯，剔 postinstall）

```
53756d5  1827 → 8fd0f12  1879 (+52) → 73304ac  1932 (+53) → c7f5fa1  1956 (+24)
```
近三个修复 commit 平均 **+43/轮**。红线余量 44 行——**按当前速度，下一轮中等规模修复轮即破线**。

### 4.3 判定与建议

- v1 发布：健康，不阻塞。
- v2 承诺「host 零改」理论上封顶了 v2 需求行数，但 review 修复轮是计划外增量，趋势会先于 v2 破线。
- **建议（现在必须，成本极低）**：CI 加行数守卫（一个 10 行脚本：`find packages/host/src -name '*.ts' ! -name 'postinstall.ts' | xargs wc -l` 超 2000 即 fail），把红线从「文档承诺」变成「构建断言」。否则下一轮修复会在无意中漂过。
- **建议（现在必须，一行文档）**：CLAUDE.md HC5 显式写明口径——r3 的 R3-A1 建议至今未执行，当前文本仍是裸的「目标 <2k 行 Node」。本次 commit message 已采用「运行时口径（剔 scripts/）」，但口径只活在 commit message 里，下一轮 review 还会重新吵一遍。同理 HC6（R3-A2）：CLAUDE.md:34 仍写「claude + codex 双适配器」，registry.ts 实为三家（opencode 含 8 个解析器测试）——文档-代码漂移两轮未修，改文档一句话。

---

## 5. 测试金字塔：发布后第一个回归的最可能落点

### 5.1 现状

81 用例全在 packages/host（task.test.ts 93 处断言密度最高的是流解析与终局语义）；extension 侧零测试文件（实测 find 零命中，DECISIONS 拍板手动验证）。金字塔形态：底座（host 纯函数）厚实，**中段（panel 状态机）与顶段（SW 路由）全空**。

### 5.2 最可能落点判定（按实证错误率，非直觉）

**panel 恢复路径（App.tsx 的 panel-ready 消费逻辑）**。依据：
1. 27 格生命周期矩阵近两 commit 已实证产出 2 个 shipped bug + 1 个错误修法（r3 量化，F1/F9）——这是全仓唯一有「错误率实证」的区域；
2. c7f5fa1 又往该区域净增约 40 行（hasSession 恢复 + activeTask 重建绑定 + 对账守卫），是当前**最新、最无测试、逻辑分支最密**的代码；
3. 其触发条件（面板收起重开、SW 30s 回收、切 tab）恰恰是手动验证最不容易稳定复现的路径——手动验证的覆盖盲区与代码风险区重合。

第二落点是 SW 的迟到帧处理（cancelled 带 taskId 对账、owner 兜底），同样零测试，但 c7f5fa1 刚经 30-agent 对抗验证过一轮，短期内再犯概率低于 panel 侧。

### 5.3 最小补测建议（= arch-M1/M2 解除方案，一份工两份债）

把 App.tsx 的 10 个已成形纯函数变换（beginTurn/beginSession/resumeHistory/看门狗 reducer/chunk 归并等）抽为 `streamReducer.ts`，对 reducer 跑 vitest——**纯函数测试无需 mock chrome API，是 extension 侧唯一零基建成本的测试切入面**。最小用例集（8-10 个）：
- beginTurn 保留 resumable/finished 台账（F1/F9 回归锚）；
- panel-ready 恢复：BLANK 态下 hasSession→resumable、activeTask→重建绑定，非 BLANK 态守卫不覆盖在跑流；
- 迟到 cancelled（带 taskId）对账：不击穿新一轮 pending；
- 看门狗 elapsed 分支。
这一步同时消 arch-M1（矩阵收敛为 reducer 单点）与 arch-M2（extension 破零）。定级：**发布后第一个 PR（v2 加字段前必须）**。

---

## 6. 遗留债清单核对（r3 → 终态）

| 债项 | r3 定级 | 终态判定 | 证据 |
|---|---|---|---|
| arch-M1 panel 状态字段生命周期矩阵（streamReducer 抽取） | major，worsening | **仍在，未恶化未消解**。TaskStreamState 仍 9 字段 × 3 BLANK 点；c7f5fa1 的修复方式仍是「给矩阵加注释」（taskId 对账注释）而非消灭矩阵 | App.tsx 实测 9 字段/7 处 BLANK 引用；beginTurn 注释继续膨胀 |
| arch-M2 extension 零单测 | major，归入 M1 的 PR | **仍在**。81 用例全 host，extension 零命中 | find 实测 |
| arch-M3 SW 会话归属 currentAgentId 时序推断 | minor(v1)/blocker(v2 前) | **已消解** ✅。owner = 帧自带 agentId 优先 + taskId 匹配兜底，三处捕获块（lastSession/lastModels/agentsCache）全部改跟 owner | sw.ts:322-336 diff 实测；恰好也是 r3 预言的修法 |
| r3 R3-A1 HC5 行数口径显式化 | 一行文档 | **未执行**。CLAUDE.md:33 仍无口径注脚 | §4.3 |
| r3 R3-A2 HC6 双适配器文档漂移 | 一行文档 | **未执行**。CLAUDE.md:34 vs registry 三家 | §4.3 |
| r3 v2 前置第二件「task-meta 门控」 | v2 前 | **已消解** ✅（随 owner 计算一并） | §3 V5 |

---

## 7. Findings 汇总表

| ID | 级别 | 内容 | 时限 |
|---|---|---|---|
| F1 | major | arch-M1/M2 沿用：panel 生命周期矩阵 + extension 零测试（§5/§6）。修法已明确：streamReducer 抽取 + reducer vitest，一份工解除两债 | **发布后第一 PR；v2 加流字段前必须** |
| F2 | major（v2 前置） | SW 状态单值化：lastSession 单条 + currentTask 单值无法表达 v2 编排（§3 V1/V2）。与 §2.3 拆分（sessionStore/orchestrator）同批改造 | **v2 开工前必须**；v1 无需动 |
| F3 | minor | panel↔SW 消息（含 panel-ready 响应形状）无类型契约，shared/protocol.ts 只覆盖 NM 帧；双端手写形状 + as 断言（§1.3） | 随 F1 的抽取 PR 顺手在 shared 补 PanelReadyResponse 类型 |
| F4 | minor | host 行数红线无 CI 断言，趋势 +43/修复轮、余量 44 行（§4.2） | **现在必须**（10 行脚本） |
| F5 | minor | r3 R3-A1/R3-A2 两项一行文档修复连续两轮未执行（HC5 口径、HC6 三适配器）（§4.3） | **现在必须**（两行文档） |
| F6 | minor | sw.ts panel-ready 五职责 + 7 个模块级 let 读写图全联通（§2）——本身不产 bug，但构成 F2 的改造半径 | 并入 F2 时限；v1 记录即可 |
| I1 | info | frontmatter.ts 抽取是修复轮中少见的净减法，方向正确，可作后续修复轮的范式 | 记录即可 |
| I2 | info | activeTask 最小切面（只透 taskId/startedAt 不透内容）设计得当；panel 消费端非 BLANK 守卫正确 | 记录即可 |

### 与 r3 的增量关系

- 消解 2 项：arch-M3、task-meta 门控（c7f5fa1）；
- 沿用 1 项：arch-M1/M2（复合计 F1）;
- 新增 1 项 major：F2（v2 前置的 SW 状态单值化——r3 只审了归属正确性，本轮审了结构容量）；
- minor 净增 2 项（F3 契约缺失、F4 守卫缺失），F5 是旧债未清的追认。

---

## 8. 结论

终态较 r3 基线净改善：14 项修复全部落点准确，其中 arch-M3 的消解恰好采用了 r3 预言的修法（帧 agentId 优先），panel-ready 扩展经四象限共存矩阵验证无兼容债务，host 行数靠一次真正的净减法回到红线内。v1 具备发布条件。

风险集中在时间维度而非空间维度：host 行数趋势（+43/轮）会在下一轮修复破线、panel 矩阵会在 v2 加字段时爆、SW 单值状态会在 v2 编排第一周撞墙——三件事都有明确且便宜的解法（CI 守卫 10 行 / streamReducer 一个 PR / sessionStore+orchestrator 一次拆分），且都不在发布关键路径上。按 F4/F5（现在，半天）→ F1（发布后第一 PR）→ F2（v2 开工前）的顺序执行即可。

**GO。**
