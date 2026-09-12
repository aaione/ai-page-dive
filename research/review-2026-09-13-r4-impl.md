# 第五道审视线：r4 修复终态严苛实现 review（2026-09-13）

- 范围：`packages/host/src` 全部 + `apps/extension/src/background/sw.ts` + `apps/extension/src/sidepanel/App.tsx` 状态机
- 基线：commit `c7f5fa1`（第四轮 14 项修复），逐项验证修复本身作为新代码的正确性
- 验证：host vitest 81/81 全绿（本次实测）；CLAUDE.md 7 条硬约束逐条核对无违反（权限面、stdin 递送、零凭证、is_error、host 薄壳、双适配器、历史落盘路径均成立）

## 判决

**GO**。0 blocker / 0 major / 4 minor / 3 info。

四轮修复的核心链路（迟到回调对账、cwd 回收、面板重开恢复、会话归属、tmp 清扫、frontmatter 去重）逻辑闭环均验证成立；存留问题全部是窄竞态窗口或失败路径的体验降级，无一破坏数据完整性或功能正确性，可随下个迭代清账。

---

## 重点逐项验证

### 1. cleanupCwd() 四处调用 —— 成立，一处观察

`task.ts:340-345`。四条路径逐一核对：

| 路径 | 位置 | 时序 | 判定 |
|---|---|---|---|
| isError | task.ts:293 | `finished/doneSent` 前置 → clearTimeout → reap → cleanupCwd → `await persist('error')` → onDone；期间 exit 事件被 `doneSent` 挡住（:246）、迟到 stdout 事件被 `finished` 挡住（:263） | 正确 |
| timeout | task.ts:228-242 | `finished/timeoutSent` 前置 → onError → `void persist('interrupted')` → cleanupCwd → cancel()（内部 reap）；exit 事件被 `timeoutSent` 挡住 | 正确 |
| spawn 窗口 cancel | task.ts:221-226 | reap → cleanupCwd → onError('cancelled')；此时尚未建 timeoutTimer、未注册 exit 监听 | 正确 |
| 正常 finish | task.ts:349 | exit 事件内，persist 前；reap 不需要（进程已退） | 正确 |

`stableCwd` 豁免与 `sessionCwds.values()` 豁免方向保守（宁留勿删），resume 锚点不会被误删。spawn-fail 路径（:213）不走 cleanupCwd 而是原地 rm + `agentCwd !== stableCwd` 判断——此时 `this.proc` 未赋值，写法正确。

**Info-1（观察）**：`sessionCwds` 检查实为死代码——只有 claude 解析器产出 sessionId（claude.ts:24），而 claude 恒跑 stableCwd（`filePathInPrompt` 仅 opencode 有），mkdtemp cwd 永不可能出现在 `sessionCwds` 值集里。无害，防御性保留可接受；`sessionCwds` 只收 claude 且 host 按 NM 连接存活、生命周期短，无内存累积问题。

**Info-2**：`spawn.ts:40` 的 `mkdtemp(/tmp/pagedive-*)` 目录在 host 被 SIGKILL 等硬死时泄漏（cleanupCwd 无机会跑）；`tmpfile.ts` 的启动清扫只覆盖 `/tmp/pagedive` 目录下文件、不覆盖 `pagedive-*` 前缀目录。macOS 3 天 tmp 周期清理兜底，v1 可接受。

### 2. panel-ready hasSession/activeTask 恢复链 —— 成立，一处窄竞态

SW 端（sw.ts:201-202）：`hasSession` 跟随 `lastSession`（storage.session 恢复链经 `sessionTouched` 守卫，sw.ts:56-67，微任务先于任何用户消息执行完，无竞态）；`activeTask` 跟随 `currentTask`（task-done/task-error 严格按 taskId 匹配清理，sw.ts:293-299，面板关闭不影响 SW 侧清理）。

Panel 端守卫（App.tsx:134）：`taskId/activeId/pending` 任一非空不覆盖——正确防止覆盖用户已开始的新轮。恢复后 `aliveAt: Date.now()` 起表，host 心跳经 SW 转译（`currentTask` 存在即转发，sw.ts:303-309）与恢复的 taskId 匹配续命，任务真死则 120s 看门狗收尾。闭环成立。

**Minor-1**：App.tsx:131-144 `activeTask` 恢复块不查 finished 台账。触发路径：panel-ready 响应在 SW 侧组合（含 activeTask 快照）后、panel 回调处理前的毫秒窗内，恰有该任务的 task-done 到达——panel listener（先注册）收到终局、taskId 解绑入台账，随后 panel-ready 回调的守卫只查 `taskId/activeId/pending`（全空，通过），为已终局任务建 streaming 占位气泡，永无终局帧，120s 后看门狗误报「响应超时——请点新对话或重试」。任务在面板关闭期间正常完结后重开面板、且完结落在毫秒级窗口内才触发。**建议**：恢复块守卫补 `!s.finished.includes(at.taskId)`。

### 3. onStartResult 台账守卫 + beginTurn 保留 finished —— 闭环成立，一处窄漏

- 迟到 cancelled 回调带 taskId（sw.ts:466）+ panel 台账对账（App.tsx:320）+ beginTurn/beginSession/resumeHistory 三处保留台账（:352/:362/:380）——主链路闭环。
- 无 taskId 的错误路径（no-tab/unsupported-page/no-permission/empty-content/host-not-found/session-lost/empty-instruction）均为**当轮同步响应**，经同一 send 回调返回，不构成跨轮迟到帧——不需要台账。
- `finished.slice(-8)` 容量 cap 理论上可驱逐仍在飞的旧 taskId，需 8 轮并发终局叠加，实际不可达。

**Minor-3**：台账守卫漏「taskId 从未绑定」的迟到取消。触发路径：用户发 A（beginTurn 置 pending）→ 在 SW 的 reading 占位帧（sw.ts:439，currentTask 占位后立即发）到达 panel 前点「新对话」再发 B——beginSession/beginTurn 时 `s.taskId` 均为 null，tA 不入台账；随后 A 的迟到 cancelled 回调带 `taskId=tA` 但不在 finished，穿透守卫：清掉 B 的 pending、注入错误气泡，且 `pending=false` 短暂打开双发门。窗口为 SW 消息处理延迟级别（毫秒-秒），触发需要用户在该窗口内连点两轮操作。**建议**：onStartResult 增加兜底——`s.pending === true` 且 `resp.taskId` 不等于当前绑定（null）时，降级为仅收尾 streaming 气泡、不动 pending/taskId；或新对话时向 SW 查询并预记在跑 taskId。

### 4. saveWorkflow 撞名守卫三分支 —— 逻辑正确

workflows.ts:119-132：新建撞用户名拒（originalName undefined ≠ name）/ 原地覆盖自己放行（originalName===name）/ 改名撞他人拒、改名到全新名放行且写新成功后才删旧（r3-sec m2 顺序保留）。撞内置名不拒（shadow 设计特性）——正确。save-sweep.test.ts:18-38 三分支断言到位：拒后**验证原正文未被被动**（:21 读回含 v1，非只断言 rejects）、放行后验证内容已更新——断言强度合格。

**Minor-4**：workflows.ts:119-127 clash 探测到 writeFile 之间无串行化。两条 workflow-save NM 消息并发（stdio.ts:134 异步派发、不排队）可双双通过 clash 检查，后写静默覆盖先写——正是 F7 要防的原创内容不可恢复丢失面。单面板单用户串行操作下难以触发。**建议**：host 侧对 workflow-save 加 promise 链串行化（或在写前二次探测 + `wx` 排他创建）。

### 5. tmpfile sweep —— 成立

- `swept` 单例（tmpfile.ts:13-14）：`sweep()` 首行同步置位，`writeContentFile` 的 check+call 在同一 tick 内同步完成，JS 单线程下不存在并发双扫窗口；即使双扫也幂等。
- 1h 阈值 vs 11min 生命周期：正文/附件文件调度 11min 清理（> 10min 任务超时 + 1min 迟读缓冲），任务最大生命周期 ≈ 11min << 1h，运行中文件不可能被误删；sweep 在写新文件**之前**执行，新文件 mtime 为当下、永不命中阈值。相容。
- readdir/stat/unlink race：`stat().catch(() => null)` + `isFile()` 守卫 + `unlink().catch(() => {})`——条目消失/替换为目录均静默跳过。正确。
- save-sweep.test.ts:42-57 用 utimes 回拨 mtime 验证旧删新留，断言到位。

### 6. sw.ts 会话归属 owner 逻辑 —— 成立

sw.ts:329-346：host 侧 task-meta 恒带 agentId（stdio.ts:37）、task-done 恒带 agentId（stdio.ts:44），`msg.agentId ?? (taskId 匹配 currentTask ? currentAgentId : undefined)` 的 fallback 分支实际仅为防御；「取消 A 后起 B，A 迟到 meta 记到 B 名下」的原始 bug 被帧自带 agentId 正确修复。`historyPath ?? lastSession?.historyPath` 在 task-meta（不带 historyPath）时保持旧值、task-done（带首轮路径）时覆盖——正确。lastModels 归属同链路，merge 下发（:341-344）与 panel 侧独立 merge（App.tsx:174-175）双保险。

**Info-3（观察）**：取消 A（claude）后起 B（codex，无 sessionId）时，A 的迟到 task-meta 会让 lastSession 停留在 A 的 claude 会话——followUp 用 `lastSession.agentId` 执行，恢复的是 claude A 会话、自洽正确，但 UI 下拉若显示 codex 则展示与执行不一致。极窄窗口、执行面无错，v1 可接受。

### 7. frontmatter 去重等价性 —— 完全一致

`splitFrontmatter`（frontmatter.ts:3-8）与三处原手写逐字符等价（git diff 核对）：history.ts 的 4KB 头读回退路径仅把「end<0 → 全量读回退」改写为「parts undefined → 全量读再 split」，回退触发条件（`startsWith('---')` 失败或 `\n---` 未找到）与回退行为（全量读、仍无则 undefined）不变；skills.ts 无 fm 回退全文、workflows.ts 空 body 拒绝，均逐分支保留。等价性成立，且 history.test.ts 既有用例全绿佐证。

---

## 其他过境发现（非本轮重点）

- **Minor-2**：sw.ts:429-431 `startSummarize` 在提取/注入成功前就清空 `lastSession` 并 persist。失败路径（no-permission / empty-content / host-not-found——新任务从未启动）下，上一条 claude 会话的追问能力被误毁；而 panel 侧 `resumable` 经 beginTurn 保留（App.tsx:349）仍为 true，追问入口可见、发送得 session-lost——SW 与 panel 状态不一致。**建议**：`lastSession = null` 挪到 `nmPort.send(task-start)` 成功之后。
- 良性确认：timeout 路径 cleanupCwd 先于 reap 执行——rm -rf 仍在跑的 CLI 的 cwd 在 macOS 上合法（cwd 被 unlink 后进程不复活它），被杀进程无后续写入影响，v1 仅 macOS，非问题。
- 良性确认：`sendChunk` 的 JSON.stringify 字节收缩切片（task.ts:320-335）与 SW 发送侧（sw.ts:488-509）同一标准，done 片带 total 对账闭环。

## 结论

| 级别 | 数量 | 清单 |
|---|---|---|
| blocker | 0 | — |
| major | 0 | — |
| minor | 4 | M1 activeTask 恢复不查台账（App.tsx:131）/ M2 失败路径误毁 lastSession（sw.ts:430）/ M3 台账漏未绑定 taskId 的迟到取消（App.tsx:317）/ M4 saveWorkflow TOCTOU（workflows.ts:119） |
| info | 3 | I1 sessionCwds 检查为死代码 / I2 mkdtemp 目录硬死泄漏 / I3 迟到 meta 下 lastSession 与 UI 下拉展示不一致 |

**GO** —— 四轮修复全部验证成立，存留 4 minor 均为窄窗口竞态/失败路径体验项，无数据完整性或正确性风险，不阻塞发布。
