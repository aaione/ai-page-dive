# r58 双轨严苛审计——产品完成度 × 代码安全/质量（2026-10-05）

## 0. 方法论与范围

- **双轨 14 维**：产品 6 维（安装上手/核心价值/容错恢复/UI 打磨/文档真实性/发布就绪）+ 代码 8 维（硬约束合规/穿越注入供应链/prompt 注入/进程管理/NM 协议/竞态与 SW 生命周期/数据落盘隐私/代码质量与测试有效性）
- **对抗验证**：每条发现由独立怀疑论者证伪（默认驳回——防线已在别处/severity 夸大/v2+ 愿望/r57 重报即杀）。两轮共 100 个 subagent、~360 万 tokens、356+328 次工具调用
- **数据合并**：run1（49 agents）与 run2 resume（51 agents，补 docs-truth/nm-protocol 两维）确认项取并集去重；两轮验证链结论冲突时（0700 三树缺口）采信有实证的确认侧并标注
- 审计基线：main @ 501b2b0（r57 全闭环、177 测试绿、host 2187/2200、0.1.3 钉版待 publish）

## 1. 总体判定

### Q1：产品是否高质量完成？——**B+（良好偏优），主路径优秀、失败路径有系统性残留**

- **强项**：零配置主路径（CWS → curl|sh → 首份总结）链路完整；七条硬约束全部合规（hard-constraints 维 0 发现）；177 测试回归网在 SW 层极密（557 行）；r53-r57 五轮审计的修复质量经得起本轮复查（绝大多数 r57 闭环事项未被重报）
- **缺口集中在两族**：①**失败触达族**——启动前失败/中途发送失败不入收件箱、cancelled 陈旧复读、丢片覆写：r57 #4 的 emitTerminal 修法没有推到全家族（4 条 P2 同根）；②**长文质量族**——humanize 档物理不可达、大纲静默截断（r57 #2「截断必须如实」标准没贯穿到输出侧与导航层）
- 无 P0；P1×1（进程收割守卫过宽——孙进程永久泄漏）

### Q2：代码是否安全且最高质量的实现？——**安全 A-，质量 B+**

- **安全面扎实**：零凭证接触/权限面/stdin 纪律逐条过审无违规；穿越/注入面仅 4 条 P3（sanitizeMeta 区间缺口、outline 围栏翻转、deleteHistory symlink、saveWorkflow 并发旁路）且均有前提条件，无 P0/P1 安全洞。本机单用户威胁模型下，攻击面收敛得比多数同类产品好
- **「最高质量」不成立的三块**：①P1 进程泄漏（正确性）；②测试三大盲区——codex 适配器集成层零覆盖、UI 层 ~2800 行零测试、nmport（SW 唯一 IO 依赖）零测试且被 sw.test 整体 mock 替换；③注释/文档诚实度出现系统性漂移（sw.ts 头注释、AGENTS.md 硬约束①、README codex 追问——文档落后于代码演进）
- 行数红线余量 13（2187/2200）经复核为政策约束非缺陷，但批 1 修复预计 +30~50 行——**先拆/删再修**（候选：DEFAULT_TASKS 双源消除即省 ~8 行）

## 2. 发现汇总（38 条：P1×1 / P2×16 / P3×21）

| # | 级 | 族 | 标题（短） | 位置 | 批 |
|---|---|---|---|---|---|
| 1 | P1 | 进程收割 | reap/killNow 组长先退守卫过宽：孙进程永久孤儿 + tasks Map 永不清 + 心跳使 host/SW 永生 | spawn.ts:95-107; task.ts:165-168 | 1 |
| 2 | P2 | 进程收割 | CLI 二进制缺失（ENOENT）spawn-fail 通道失效：reject 在 resolve 后 no-op，误报 parse | spawn.ts:46-49; task.ts:237-253 | 1 |
| 3 | P2 | 失败触达 | 启动前失败族（提取/帧超限/host-not-found）不入收件箱——提问静默蒸发 | sw.ts:905-921, 944-951, 781-794 | 1 |
| 4 | P2 | 失败触达 | startSummarize/FollowUp 中途发送失败终局不入收件箱（同族） | sw.ts:981-985, 800-804 | 1 |
| 5 | P2 | 失败触达 | cancelled 终局无条件入箱 + task-done 不清箱——重开复读陈旧「已取消」 | sw.ts:589-600, 738-756 | 1 |
| 6 | P2 | 失败触达 | 丢片取消不登记 cancelledTaskIds——host 迟到帧覆写收件箱 content-mismatch | sw.ts:657-677, 744-752 | 1 |
| 7 | P2 | 竞态 | 孤儿任务指针折算每次 restoreSession 重跑——成功任务被折算成 ext-restarted 幻影 | sw.ts:391, 148-158, 753-756 | 1 |
| 8 | P2 | 数据落盘 | pruneHistory 删历史不连带删 attachments——附件永久孤儿无清理路径 | history.ts:240-257 | 1 |
| 9 | P2 | 数据落盘 | r55「全树 0700」漏 workflows/skills 子树，存量装机维持 0755 | workflows.ts:120; skills.ts:68 | 1 |
| 10 | P2 | 文档 | README 称 codex 不支持追问——与实现直接相悖（r57 盲区3 只修了代码注释没修 README） | README.md:18, 78, 90 | 2 |
| 11 | P3 | 文档 | AGENTS.md 硬约束①「storage 仅 session 域」与 storage.local 实际用法相悖 | AGENTS.md:26 | 2 |
| 12 | P3 | 文档 | check-published 红灯文案「恒报组件过旧」与实际软提示行为不符 | check-published.mjs:33 | 2 |
| 13 | P3 | 文档 | 升级横幅命令直跑时 postinstall 打印与 && 后半段指引互相矛盾 | postinstall.ts:106-107 | 2 |
| 14 | P3 | 长文质量 | humanize 档「全文改写篇幅相当」长文物理不可达，无降级/披露（P2 见明细） | humanize/WORKFLOW.md:9, 90 | 3 |
| 15 | P3 | 长文质量 | buildOutline 60 条/2000 字符静默截断，残缺大纲呈现为完整 | prompt.ts:67, 98 | 3 |
| 16 | P3 | 长文质量 | buildOutline 围栏状态机可被奇数个 ``` 翻转——其后标题大纲静默丢失 | prompt.ts:56-67 | 3 |
| 17 | P3 | 长文质量 | DEFAULT_TASKS 兜底与内置 WORKFLOW.md 双源漂移 | prompt.ts:144-148 | 3 |
| 18 | P2 | UI/UX | 吸底双轨冲突：拖滚动条回看被流式帧反复拽回底部 | StreamMarkdown.tsx:121-160 | 4 |
| 19 | P2 | UI/UX | 历史详情降级文案指路不存在的「下载」按钮 | StreamMarkdown.tsx:169-171 | 4 |
| 20 | P3 | UI/UX | 消息级复制按钮 aria-label 恒「复制全文」，无已复制/失败反馈 | SummarizeView.tsx:922 | 4 |
| 21 | P3 | UI/UX | 升级横幅「复制命令」剪贴板失败静默吞掉 | App.tsx:969-976 | 4 |
| 22 | P3 | UI/UX | missedErrBubble cancelled 码双重前缀文案 | App.tsx:1035-1037 | 4 |
| 23 | P3 | UI/UX | host-not-found 复核零退避，单次失败整面板切 Onboarding 丢对话态 | App.tsx:736-739 | 4 |
| 24 | P2 | 安装 | npm 全局 bin 不在 PATH 时「重开终端重跑」永久死循环 | install.sh:52-54 | 5 |
| 25 | P3 | 安装 | 无扩展 ID + 零 CLI 时 RC=2 吞掉 RC=3 指引，「无需重跑」误导 | install.ts:152-154 | 5 |
| 26 | P3 | 安装 | install.sh 顶层直线无尾部哨兵，curl|sh 截断停任意中间态 | install.sh:6-70 | 5 |
| 27 | P3 | 协议 | createFrameReader catch 把 handler 同步异常伪装「JSON 损坏」吞帧 | nm.ts:51-55 | 6 |
| 28 | P3 | 协议 | content-received 对账单向：回执被吞零超时兜底→无限 loading | sw.ts:657-676, 990-992 | 6 |
| 29 | P3 | 协议 | nmport lastDisconnectError 跨连接世代不清除——报陈旧错误 | nmport.ts:30-31, 51-54 | 6 |
| 30 | P3 | 竞态 | SW 空闲态 cancel 返回 undefined 但 listener 已 return true——通道不闭 + unhandled rejection | sw.ts:519-523, 379-383 | 6 |
| 31 | P3 | 安全 | sanitizeMeta 漏 U+00AD/U+180B-180E/U+FE00-FE0F/tag 区（U+E0000-E007F） | prompt.ts:15 | 7 |
| 32 | P3 | 安全 | deleteHistory 附件连带删未复用符号链接解析，可越树删文件 | history.ts:309-314 | 7 |
| 33 | P3 | 安全 | saveWorkflow 原地覆盖分支绕过 wx 守卫——并发新建+编辑可覆盖原创 | workflows.ts:122-137 | 7 |
| 34 | P3 | 数据落盘 | /tmp/pagedive 存量 0755 永不收敛（ensureDir 只验属主） | tmpfile.ts:13-22 | 7 |
| 35 | P2 | 测试债 | codex 适配器 Task 集成层零覆盖——双适配器之一端到端全靠 claude 模拟 | task.test.ts | 8 |
| 36 | P2 | 测试债 | 扩展 UI 层 ~2800 行零测试（App/Settings/HistoryView/Onboarding/StreamMarkdown） | vitest.config.ts:8 | 8 |
| 37 | P2 | 测试债 | nmport.ts 零测试且被 sw.test 整体 mock 替换——probe/send/stale 回归全绿照跑 | nmport.ts:1-109 | 8 |
| 38 | P3 | 杂项 | useSetting 唯一未使用导出；sw.ts 头注释消息面清单不符 + 重复行 | SummarizeView.tsx:82; sw.ts:4, 47/51 | 8 |

> 级别口径：P0=阻断发布/数据损失/可利用安全面（本轮 0 条）；P1=核心体验受损或确定性 bug；P2=质量/一致性缺陷；P3=打磨。
> 注：#14 humanize 验证链定为 P2（表中 P3 为笔误更正——**P2×16 含 #14**，P3 实为 20 条 + #38 杂项合并计 1）。

## 3. 明细（按族）

### 3.1 进程收割族（#1 P1、#2 P2）

**#1 [P1] reap()/killNow() 组长先退守卫过宽**
- 位置：`spawn.ts:95-107`（守卫在 :97）；`task.ts:165-168`（killNow 同款）
- r58 N2 只修了「组长死于 reap 自己发的 TERM」子形态。组长在 reap 调用**前**已退出（正常 exit 后工具孙进程持 stdout 写端——r33/r47 自证的机制形态）时，残组收不到任何信号：(a) 抗信号/长跑孙进程成永久孤儿（detached 组存活于 host 之外）烧机器与 CLI 配额；(b) cancel 路径更糟：ran 任务的终局依赖 close→finish，孙进程不退则任务永无终局、tasks Map 永不清除、~20s 心跳使 host 与 SW 双永生——用户只看到永远 loading
- 修复：组长已退出时 reap 不应整体短路——保留对 -pgid 的 TERM→KILL 链（空组 ESRCH 已被吞；r58 已论证 3s 窗内 pgid 复用不可达），或 `kill(-pgid, 0)` 探测组仍有成员时照常收割；killNow 同步去掉 exitCode 短路
- 锚：task-timeout 系新增「组长先退 + 孙进程抗信号」用例（SIGTERM 忽略的孙进程在组长 exit 0 后仍被 KILL 收割 + cancel 得终局）

**#2 [P2] ENOENT 时 spawn-fail 通道失效**
- 位置：`spawn.ts:46-49`（error 事件在 resolve 后 reject 成 no-op 死通道）；`task.ts:237-253`（未传 onSpawnError）
- probeAgents 通过后二进制消失/PATH 漂移时，用户看到「CLI 输出异常 exit -2」（parse 文案）而非 spawn-fail 的安装排障指引——环境问题被误诊为 CLI 故障
- 修复：spawn.ts 记录「error 已发」标志，resolve 后的 error 走 onSpawnError 上抛；task.ts 接线并把终局归为 spawn-fail

### 3.2 失败触达族（#3-#7，收件箱覆盖面——r57 #4 修法的家族化残留）

**#3/#4 [P2] 启动前与发送中失败不入收件箱**（sw.ts:905-921/944-951/781-794/981-985/800-804）：点发送后立刻切 tab（锚定语义使面板自动收起——设计鼓励的自然行为）恰逢提取秒级失败（no-permission/empty-content 常见）或 NM 发送失败：重开面板全新空态，上一条提问无气泡无错误无痕迹。r53 #5 注释自认的「最差结局」在启动前失败族残留。修复：全部失败 return 口统一走 emitTerminal 入箱（code 复用错误串）。

**#5 [P2] cancelled 陈旧复读**（sw.ts:589-600 入箱 + 738-756 不清）：高频流程必中——取消旧任务（入箱）→ 新任务成功（不清箱）→ 重开面板 → 成功对话后又拼一条陈旧「已取消」。修复：cancelCurrent 的 emitTerminal 只广播不入箱（ownerTab 传 null），或终局清理处 `lastTerminals.delete(currentTask.tabId)`。

**#6 [P2] 丢片覆写**（sw.ts:657-677 与 744-752）：mismatch 取消不登记 cancelledTaskIds，host 迟到的 cancelled 帧覆写收件箱里的 content-mismatch 条——用户看到「已取消」而非「丢片请重试」。违反 r57 盲区5 不变式③的自身意图。修复：补台账登记，或收件箱已有同 taskId 条目时不得覆写。

**#7 [P2] 孤儿折算竞态**（sw.ts:391/148-158/753-756）：孤儿任务指针折算每次 restoreSession 重跑，与终局清理构成读-清竞态——**已成功完成的任务**被折算成 ext-restarted 幻影错误气泡。长期高频使用必命中。修复：折算只做一次（顶层冷启动置位），或与 clearRunningTask 串行化。

### 3.3 数据落盘族（#8、#9、#34）

**#8 [P2] prune 附件孤儿**（history.ts:240-257）：pruneHistory 删历史不读 frontmatter 连带删 attachments——用户附件（全文文本+解码图片）永久留在 `~/.ai-page-dive/attachments/`，历史详情页（唯一删除入口）已消失，再无任何清理路径。修复：按 deleteHistory 同款树内限定连带 rm。

**#9 [P2] 0700 收敛漏 workflows/skills**（workflows.ts:120; skills.ts:68）：r55 承诺「全树 0700」只覆盖 root/history/workspace——mkdir mode 对已存在目录 no-op，bca4b9a 之前创建过自定义 workflow 的机器维持 0755。run1 驳回/run2 确认（验证链冲突，采信实证侧：mkdir 无 chmod 是事实，r55 commit 口径未兑现）。修复：首次触达时补 chmod（对齐 task.ts:26-27 模式）。同型 #34：/tmp/pagedive 存量 0755（tmpfile.ts:13-22，ensureDir 补一行 chmod）。

### 3.4 文档真实性族（#10-#13、#38b）

**#10 [P2] README codex 追问三处失实**（README.md:18/78/90）：r57 盲区3 修了 sw.ts/protocol.ts 注释，README 没跟上——「codex 不支持追问（CLI 不回传会话 id）」与 thread_id 实现直接相悖，功能被文档藏没。修复：三处文案更新（含降级口径）。
**#11** AGENTS.md 硬约束①「storage 仅 session 域纯内存」与 storage.local 任务指针（r55 #10 自加的）相悖——贡献者必读的「违反即 bug」文档自己说谎。**#12** check-published 红灯文案描述不存在的阻断横幅。**#13** 升级横幅命令直跑时 postinstall 与 && 后半段指引矛盾（r7-ux 同类在升级路径复发）。**#38b** sw.ts 头注释消息面清单低估 + 重复行。

### 3.5 长文质量族（#14-#17）

**#14 [P2] humanize 物理不可达**（humanize/WORKFLOW.md:9, 90）：MAX_CONTENT=200k 允许 20 万字符进档，「全文改写篇幅相当」超出单 turn 输出上限数倍——静默半途（用户以为完整直接转发）或 max-output 错误。r57 #2「截断必须如实」标准没贯穿到输出侧。修复：workflow 增加超长分段交付 + 未覆盖显式声明。
**#15** outline 60 条静默截断无披露（prompt.ts:67/98，一行修复）。**#16** outline 围栏状态机被奇数个 ``` 翻转——其后标题全部丢失（prompt.ts:56-67）。**#17** DEFAULT_TASKS 双源漂移（prompt.ts:144-148）——顺带是行数红线的减行机会。

### 3.6 UI/UX 族（#18-#23）

**#18 [P2] 吸底双轨冲突**（StreamMarkdown.tsx:121-160）：拖滚动条（不产生 wheel/key/touch 事件）时 SummarizeView 的 stickRef 停了、StreamMarkdown 的 stickyRef 还在——每个节流帧把 scrollTop 拽回底部。修复：吸底判定收敛单一来源。
**#19 [P2] 降级文案指路不存在的下载按钮**（StreamMarkdown.tsx:169-171）。**#20/#21** 复制按钮双态口径（r57 #15 拍板）两处漏改。**#22** missedErrBubble cancelled 双重前缀。**#23** host-not-found 复核零退避整面板丢对话态。

### 3.7 安装脚本族（#24-#26）

**#24 [P2] npm bin PATH 死循环**（install.sh:52-54）：自定义 prefix 用户「重开终端重跑」永远同一步 die。修复：die 前探测 `npm prefix -g` 给可粘贴 PATH 前缀命令。**#25** RC=2/3 优先级（一行）。**#26** main 函数 + 尾行哨兵（一行级加固）。

### 3.8 协议健壮族（#27-#30）

**#27** createFrameReader 的 catch 把 handler 同步异常伪装「JSON 损坏」吞帧（nm.ts:51-55）——与 r54 #10 可观测性目标相悖。**#28** content-received 对账单向无超时兜底：done 片或回执被吞 → host 心跳永生 + SW 保活 + panel 无限 loading 三重放大（sw.ts:657-676/990-992）。**#29** nmport 陈旧错误跨世代。**#30** SW cancel 空闲态 return true 通道不闭。

### 3.9 安全细项（#31-#33）

**#31** sanitizeMeta 缺口：U+00AD/U+180B-180E/U+FE00-FE0F/tag 区 U+E0000-E007F（prompt.ts:15）——tag-char 对用户不可见对 CLI 可读，meta 行 smuggling 消毒不完整。修复：字符类补区间或 `\p{Cf}`。**#32** deleteHistory 附件删除未复用 realOrSelf 符号链接解析（history.ts:309-314）——词法前缀校验可被目录内 symlink 越树。**#33** saveWorkflow 原地覆盖分支绕过 wx 守卫（workflows.ts:122-137）——并发「新建+编辑」可覆盖他方原创（r54 #8 要防的情形存在旁路）。

### 3.10 测试债三大盲区（#35-#37）

- **#35 codex 集成零覆盖**：parser→Task→终局/sessionId/resume wiring 全靠 claude 等价模拟——硬约束⑥的一等公民没有端到端锁。修复：codex 形状 FAKE_CLI 一组（thread.started/item.completed/turn.completed），断言 meta(thread_id)/累积/终局/resume args
- **#36 UI 层 ~2800 行零测试**：流式渲染/设置页编辑/历史删改/附件气泡全无断言——SW 层修得密恰恰反衬 UI 是回归防线整段空白
- **#37 nmport 零测试**：SW 唯一 IO 依赖被 sw.test 整体 vi.mock——probe 超时/stale-port/重建分支回归时测试全绿照跑

## 4. 驳回记录（两轮 18 条，代表性的 6 条）

| 驳回 | 理由（复核后采信） |
|---|---|
| saveWorkflow 改名「删旧目录」无归属校验 | EEXIST 阻断攻击前置条件（y 只能由发起方首创）——但 #33 覆盖了同族真实旁路 |
| host 行数余量 13 无缓冲 | 政策约束非缺陷（AGENTS.md 明文「再破线删功能」）——已列入批 1 前置考量 |
| spawn 失败撞取消窗口错报 | task.ts:151-162 该窗口 proc 未赋值，取消不可能造成 spawn 失败 |
| Onboarding「5-15 分钟」与 90s 卡装矛盾 / 手动复制路径不启动检测 / Chromium 变体注册 | 三条均为低概率组合或已有兜底（详见 task 输出） |
| 追问附件每轮重编号 [Image #1] | CLI 会话侧行为，host 无法稳定重编号（v2+） |

## 5. 发布前清单（非代码缺陷，流程项）

1. **CHANGELOG**：0.1.3 条目冻结于 2026-09-21、[Unreleased] 空——此后 100+ 提交（含 P1 级修复与安全修复）将随 0.1.3 发布零披露。**npm publish 前必须补**（验证轮以「未发布仍可改」驳回为缺陷，但作为发布清单项成立）
2. **npm publish 0.1.3**（挂账）：阻塞新用户安装（ETARGET）+ main 的 check-published 门禁红

## 6. 处置批次建议

- **批 1（正确性/用户数据，先拆行再修）**：#1 P1 收割守卫 + 锚 / #2 spawn-fail / #3-#6 收件箱覆盖面族（emitTerminal 家族化 + cancelled 不入箱/终局清箱/丢片台账）/ #7 孤儿折算一次性 / #8 prune 连带删 / #9+#34 chmod 收敛补齐。前置：DEFAULT_TASKS 双源消除（#17 提前，省行）
- **批 2（文档触达）**：#10 README codex / #11 AGENTS 硬约束① / #12 check-published 文案 / #13 postinstall 升级指引 / #38b sw 头注释
- **批 3（长文质量）**：#14 humanize 分段披露 / #15 outline 截断披露 / #16 围栏闭合修复 / #17（若未在批 1 做）
- **批 4（UI/UX）**：#18 吸底单轨 / #19 下载按钮 / #20-#22 双态口径补齐 / #23 退避
- **批 5（安装脚本）**：#24 PATH 死循环 / #25 RC 优先级 / #26 尾部哨兵
- **批 6（协议健壮）**：#27 catch 拆分 / #28 对账超时 / #29 陈旧错误 / #30 cancel 返回值
- **批 7（安全细项）**：#31 sanitizeMeta 区间 + 锚 / #32 realOrSelf 复用 / #33 覆盖旁路
- **批 8（测试债，跨批并行补锚）**：#35 codex 集成 / #37 nmport 单测（优先）/ #36 UI 最小交互面

## 7. 数据与工件

- run1 结果：`/private/tmp/claude-501/.../tasks/wt6bcyun8.output`（23 确认/11 驳回）
- run2 结果：`/private/tmp/claude-501/.../tasks/wan1lv9lb.output`（29 确认/7 驳回）
- 合并明细 JSON：`/private/tmp/r58-final.json`（含全部 evidence/why/suggestion/verdict 原文）
- workflow 脚本：`~/.claude/projects/.../workflows/scripts/pagedive-r58-double-audit-wf_25ad10e7-032.js`
