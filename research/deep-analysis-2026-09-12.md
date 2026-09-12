# 第三轮深度分析报告（2026-09-12）

- **审查对象**：HEAD `d3dfc75`
- **覆盖范围**：全量通读 `packages/host/src`（13 文件）+ `apps/extension/src`（sw.ts / nmport.ts / sidepanel 全部 / content 两件）+ `packages/shared/src`；交互维度独立 map；npm 分发面复核
- **基线**：六份既有报告 —— `product-architecture-report.md`、`review-2026-09-11-impl.md`、`review-2026-09-11-ux.md`、`review-2026-09-11-r2-arch-impl.md`、`review-2026-09-11-r2-ux-sec.md`、`deep-analysis-2026-09-11.md`，全部增量发现已逐条对照去重
- **方法**：双维度 map（代码 / 交互）→ 候选发现 → 逐条对抗验证（代码逐行核实 + 既有报告排除清单核对 + 反驳穷举）→ 存活 findings 13 条（12 confirm / 1 downgrade）

---

## ① 三问结论

**Q1：当前代码实现是否达到此阶段最优？**
**是。** 六轮审查后核心链路（取消终局、内容对账、outline 消毒、临时文件加固、看门狗心跳化、发布自包含）已收敛，本轮全量通读仅剩 4 minor + 1 info 的边角非对称与失败窗口残尾，无 blocker / major，合计 <1 天工时可清零；两条已被排除的旧结论（impl 排除 #4、ux 排除 #5）因 d3dfc75 引入 `resumable` 字段后前提失效，本轮已重新立案并给出修法。

**Q2：交互维度还有多少优化空间？**
**收敛中，残留一处 major 级数据破坏 + 一组高频动线上的 minor。** 本轮交互 map 新增 8 发现（对抗验证后 1 major / 4 minor / 2 info，其中 codex 追问闭环由 major 降为 minor），最高性价比三件事：codex 不可追问的预期管理（约 10 行，消除双主力用户群最大困惑源）、Onboarding ✅/🎉 标记对齐（两行文案，直接影响首装转化）、running 结束焦点回位 + readOnly（一个 useEffect，每轮追问受益）。

**Q3：npm 分发是否仍必要？**
**是，且必要性增强（verdict: npm-necessary，confidence: high）。** d3dfc75 四项改动全部是 npm 路径内部加固，未触动前两轮四条前提（MV3 沙箱禁 spawn / 编译二进制被 D10+Gatekeeper 封死 / daemon+WebSocket 被 LNA+薄壳决策封死 / 目标用户 Node 先验不变）；新增的 postinstall 静默注册（五道静默门守卫完整）是 npm lifecycle 独有能力，任何替代形态（zip / brew / Releases）均复刻不了，无新替代选项。npm 发布面本轮核验通过：files 含 dist/builtins/builtins-skills 且非空、prepack=tsc、dist 平铺使 version.ts 的 `../package.json` 在全局安装下成立。

---

## ② Findings 表（对抗验证后存活，13 条）

定级为对抗验证后终值；verdict 列为验证结论。C=代码维度，U=交互维度。

| # | 维度 | 标题 | 定级 | verdict | 位置 | 修复要点（修正后） |
|---|------|------|------|---------|------|---------------------|
| F1 | C | 追问轮失败窗口把 resumable 永久清零，下一条追问静默降级为全新总结（推翻 impl 排除 #4 的前提） | minor | confirm | `apps/extension/src/sidepanel/App.tsx:44,296-303` | `beginTurn` 改 `{...BLANK, resumable: s.resumable, ...}`——resumable 属会话级字段，不随轮次重置；同时消除每轮追问窗口的下拉解锁闪变与占位文案闪烁。SW 侧 lastSession 在失败路径未清空，panel 单点修复即可恢复 |
| F2 | C | opencode 附件从不软链进 agent cwd，与「沙箱只准读 cwd」设计自相矛盾——opencode 轮附件不可读 | minor | confirm | `packages/host/src/task.ts:105-119,551-556` | 对 `def.filePathInPrompt` 存在的 agent（即 opencode）逐个 `linkIntoCwd(att.path, agentCwd)`，attachSection 改用 `basename`；**resume 轮需在 sessionCwds 记忆 cwd 上同样执行**。claude/codex 保持绝对路径 |
| F3 | C | task.ts isError 终局绕过 finish() 的 mkdtemp cwd 回收，opencode 报错轮泄漏临时目录 | minor | confirm（验证发现第二盲区） | `packages/host/src/task.ts:284-302` | 将 finish() 的 cwd 回收抽为 `reapAgentCwd()`，在 **isError 分支与 timeout 路径两处**补调（timeout 同样因 timeoutSent 早退绕过 finish()，系原 finding 未覆盖的第二盲区）；保持「cwd 已入 sessionCwds 不删」语义 |
| F4 | C | 看门狗 aliveAt 实际刷新面窄于注释：task-status/task-meta 均不续命，重页提取 + 首心跳延迟叠加可致误杀 | minor | confirm | `apps/extension/src/sidepanel/App.tsx:39,127-182` | task-status / task-meta 两个分支各加 `aliveAt: Date.now()`（一行 ×2，与 :39 注释对齐）。残余（提取本身 >120s）可达性极低可接受不修，但修复注释中应言明 |
| F5 | C | task-meta 是唯一缺 finished/taskId 门控的任务帧——当前 FIFO 下不可达、v2 多引擎即成真洞 | info | confirm | `apps/extension/src/sidepanel/App.tsx:127-143` | 补齐双门控（taskId===null 时放行以保留首帧绑定语义，绑定仍交 chunk/status）；建议与 arch-M1 streamReducer 抽取合并落地，避免第五处复制门控 |
| F6 | U | codex 不可追问的体验闭环缺失：总结完成后界面静默回到「新总结」形态，追问触发全新提取且必然答非所问 | minor（major 降级） | downgrade | `SummarizeView.tsx:116,566` / `task.ts:183,191` / `sw.ts:202-209` | resumable=false 完成后，ActionBar 上方渲染弱提示「该 CLI 不保留对话上下文，继续输入将开始全新总结」+ placeholder 改「再问一句（将开始新一轮总结）…」，仅 SummarizeView 约 10 行。降级理由：前身（impl-m5/R2-m2）两轮均定 minor，本条是修复残留且体验严格更轻；DECISIONS 已定调 codex 无 resume 属能力边界 |
| F7 | U | Settings 模式重命名无重名校验：改名撞另一模式名会静默覆盖对方正文（原创内容不可恢复丢失），旧目录残留孤儿 | **major** | confirm | `Settings.tsx:318-324,185-208` / `workflows.ts:108-118` | 双层防御：panel 侧 saveWorkflow 追加重名检查（可一并挡住 shadow 内置的误操作）；host 侧 workflow-save 补传 originalName 增加守卫；改名成功后删旧目录消除僵尸副本；补 vitest 用例。与 F2/R2-M2 同属静默数据破坏类，那两条只堵了空正文 |
| F8 | U | Onboarding 完成标记与脚本实况不符：面板教用户等「✅」但那是 Node 探测步（最早最快），真完成标记是「🎉 安装完成」；两处阈值也不一致（1 分钟 vs 1 分半） | minor | confirm | `Onboarding.tsx:121,113,34,57` / `install.sh:31,49` | 三处对齐：:121 与 :113 stuck 文案（原 fix 漏了此处）同改「🎉 安装完成」；install.sh:49「1 分钟」改「1 分半」；:57 去掉 copiedAtRef 首次守卫每次刷新，「立即检测」按钮 onClick 一并 setStuck(false)+重置 |
| F9 | U | newChat/resumeHistory 重置 BLANK 连 finished 台账清空，取消任务在途尾巴 chunk 走首帧绑定落入空会话，形成常驻半截气泡 +「已取消」错误（推翻 ux 排除 #5） | minor | confirm | `App.tsx:43-45,306,316` / `sw.ts:226-232` | **修正原 fix**：`finished: s.finished` 无效（在跑任务从未终局、不在台账），须显式 `finished: s.taskId ? [...s.finished, s.taskId].slice(-8) : s.finished`。原排除 #5 的「闪现自愈」不成立——终局标错后气泡常驻 messages |
| F10 | U | HistoryView 的 history-file 回帧无名字守卫（Settings 有同款）：「返回→点下一条」时正文与元数据/继续对话错配 | minor | confirm | `HistoryView.tsx:38,140-143,63` | pendingPathRef 守卫：点击时记 path，listener 比对不符即丢，「返回列表」置 null——同修「迟到旧帧强行拽回详情页」这一更宽窗口症状。协议帧已带 path，host 零改动 |
| F11 | U | 用户模式删除无确认一步即毁：rm -rf 原创目录，与 HistoryView 删除的 confirm 防线双标 | minor | confirm | `Settings.tsx:210-213,356-358` / `workflows.ts:121-124` | deleteWorkflow 对非内置模式加 confirm（与 HistoryView.tsx:167 同模式），builtin 保持「恢复默认」无确认 |
| F12 | U | instruction 静默覆盖所选模式正文：非 default 模式下输入自定义问题时模式不生效，UI 无优先级提示 | info | confirm | `SummarizeView.tsx:127,151-156` / `task.ts:183,191-192` | host 端 instruction 优先语义不变（task.test.ts:277 已锚定）；UI 侧在 workflow!=='default' 且输入非空时加一行弱提示。「语义合并」属产品决策，须先在 DECISIONS.md 立项 |
| F13 | U | 追问输入焦点不回位：running 期 disabled 丢焦点，完成后不自动 focus，每轮追问都要先点一下（F15 修复后残端） | info | confirm | `SummarizeView.tsx:92-94,565` | useEffect 在 running true→false 时 focus；更优：disabled 改 readOnly（保持可聚焦 + 消掉 F15 预输入缺失），发送侧拦截已存在不受影响 |

### 对抗验证的关键修正与加成

- **F3 加重一档**：timeout 路径（task.ts:227-240）与 isError 同构绕过 finish()，盲区是两处而非一处，修法须同补。
- **F9 修法纠错**：原提案「保留 s.finished」对自家场景无效（在跑任务不在台账），必须显式把在跑 taskId 记入 finished。
- **F6 降级**：codex 追问闭环逻辑链全部成立，但属已知 CLI 能力边界上的预期管理缺失、前身两轮均 minor、主路径无损坏——major 虚高，定 minor。
- **F8 补漏**：除 :121 外，:113 stuck 横幅文案同样引用了错误标记，修复须两处同改。
- **两条旧排除被推翻立案**：impl 排除 #4（resumable 前提过时，git log -S 证实字段系 d3dfc75 引入）→ F1；ux 排除 #5（「finished 拒收兜住」对 BLANK 后状态不成立，「闪现自愈」不成立）→ F9。这印证了排除结论需要随代码演进重审。
- **查证未成立而丢弃的候选**（记录以防重查）：spawn ENOENT + stdin 写崩溃（实测 node 存活）、expectedChars 与 content-received 竞态（单线程同步块保证不成立）、opencode resume 死路径（无 sessionId 不可达，确认无害）。

---

## ③ 行动清单

### 发布前（5 项，合计约 1.5 天）

| 项 | 对应 | 内容 | Effort |
|----|------|------|--------|
| P1 | F7 | 模式重命名重名校验（panel 拒绝 + host 守卫 + 旧目录清理 + vitest） | M |
| P2 | F11 | 用户模式删除加 confirm | S |
| P3 | F8 | Onboarding ✅/🎉 与阈值三处对齐 + copiedAtRef 刷新 | S |
| P4 | F1 | beginTurn 保留 resumable（会话级字段不随轮次重置） | S |
| P5 | F9 | beginSession/resumeHistory 显式把在跑 taskId 记入 finished | S |

取舍依据：P1/P2 是静默数据破坏（与 F2/R2-M2 同漏洞面，仅剩的独立缺口）；P3 在首装转化路径上主动误导用户；P4/P5 是高频动线上的状态正确性残窗，均为一行级修复。

### 第一周（6 项）

| 项 | 对应 | 内容 | Effort |
|----|------|------|--------|
| W1 | F6 | codex（及一切 resumable=false）完成后的不可续聊提示条 + placeholder | S |
| W2 | F2 | opencode 附件软链进 agent cwd（含 resume 轮 cwd），attachSection 改 basename | M |
| W3 | F3 | cwd 回收抽 reapAgentCwd()，isError + timeout 两处补调 | S |
| W4 | F4 | 看门狗 task-status/task-meta 续命（一行 ×2） | S |
| W5 | F10 | HistoryView pendingPathRef 守卫 | S |
| W6 | F13 | running 结束焦点回位 + disabled 改 readOnly | S |

### v2（3 项）

| 项 | 对应 | 内容 | Effort |
|----|------|------|--------|
| V1 | F5 | task-meta 双门控 + 与 arch-M1 streamReducer 合并落地 | M |
| V2 | F12 | instruction × 非 default 模式的 UI 提示（或语义合并，需 DECISIONS 立项） | S |
| V3 | F4 残余 | SW 提取期周期性重发 reading 占位帧（>120s 极端场景，可选） | S |

### 不做

- 三条已证伪候选（spawn ENOENT stdin 崩溃 / expectedChars 竞态 / opencode resume 死路径）——不再立案。
- npm 替代分发形态——四条前提未动，postinstall 反而加深不可替代性，维持 npm-necessary。
- F6 的「复制上文到新问题」快捷键——留 v2，非本项必需。

---

## ④ 与前两轮（deep-analysis-2026-09-11.md / 2026-09-08.md）的差异说明

1. **从「广度扫描」转向「排除复审 + 失败窗口」**：前两轮以功能面与安全面扫描为主、产出 blocker/major 级问题；本轮全量通读后核心链路已收敛，增量仅 4 minor + 1 info（代码维），报告重心移向既有排除结论的时效性复审与失败路径（取消/超时/spawn 失败/看门狗误杀）残窗。
2. **两条旧排除被正式推翻**：impl 排除 #4 与 ux 排除 #5 均因 d3dfc75 的 `resumable` 字段引入而前提失效（F1/F9）。这是三轮以来首次出现「排除结论过时」类发现，建议后续审查将「排除清单随 HEAD 重审」固化为流程项。
3. **交互维度首次独立成图**：前两轮交互发现散见于 ux/r2-ux-sec 报告；本轮独立 map 产出 8 条全新发现（含唯一存活 major F7——重命名静默覆盖，填补了 F2/R2-M2 只堵空正文留下的同漏洞面缺口），并首次覆盖 resumable 门控修复后的 codex 完整闭环（F6）与跨工件一致性（Onboarding × install.sh，F8）。
4. **对抗验证引入「修法纠错」层**：本轮不止确认/降级 findings，还纠正了两条 finding 的原修法（F9 的 finished 台账无效方案、F8 漏改的 :113 文案），并加重一条盲区（F3 的 timeout 路径）——修法本身也需验证是本轮方法学增量。
5. **npm 结论从「必要」升为「必要且增强」**：postinstall 五道静默门 + version 单源等 d3dfc75 增量被核验为 npm lifecycle 专属能力，前两轮的替代形态清单全部维持被封死状态，无新选项。
6. **总量走势**：R1（09-08）→ R2（09-11）→ R3（本轮）：blocker/major 从多发降至 0 blocker / 1 major（且为交互维数据保护项而非架构缺陷），minor 从面上收敛到窗口级，与「当前实现达到此阶段最优」的判断相互印证。
