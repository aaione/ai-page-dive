# PageDive 代码安全与质量终审报告

> 审计日期：2026-10-05 · workflow `wf_2714dbdb-07d`（6 维度审计 → 对抗核实 → 终审）
> 7 agents / 91 tool uses / ~380k tokens · 全部发现均附代码级证据，无一被对抗核实驳回

## 修复回执（2026-10-05 r59，审计当日）

Top 5 + 次优先**全部修复**：T1 cancel 误杀守卫（拒收象限+测试）、T2 0755 三缺口（attachments 根+YYYYMM / history list 全树 / workflows 根，4 个新收敛测试实测 0700）、T3 spawn 复用 resolveBin 绝对路径、T4 原生 task-error 对齐 emitTerminal 判据（receiverOnline 双象限测试）、T5 迟到归档改 tabOf（源页签归档+幽灵帧丢弃测试）、seq 重复帧去重守卫。验证：24 文件 210/210 全绿（+7 用例）、行数守门 2198/2200（余量 2，两处注释压缩抵扣）、完整两段构建产物齐全。「安全」两项剩余条件中仅 src/scripts 口径缝隙未动（需产品拍板：入统计或修订口径声明）。

## 总裁决

**「是否安全且最高质量的实现」**

- **安全 = 有条件是**。未发现任何 critical/high 可利用安全漏洞；正文临时文件 symlink 劫持面已关死、NM 注册面锁定、零凭证接触属实。条件（验收制）：
  1. 修复 cancel 带 taskId 而 currentTask 为空时退化为无 taskId cancel 的误杀路径（sw.ts:536-539），并补齐该象限测试；
  2. 完成存量 0755 收敛三缺口（attachments / history 旧年月 / workflows 根），以本机实测目录权限全部 0700 为验收；
  3. spawn 侧复用 resolveBin 绝对路径，消除探测/spawn 二进制解析不一致与 `~/.local/bin` 影子面。
- **质量 = 有条件是**。203 用例真实、零运行时依赖属实、strict 全仓下发、守门三项命令全过。条件：
  1. host 行数余量 3 行近乎必破——按红线自述「删功能不抬阈值」先行腾挪，并正视 src/scripts/ 327 行的口径豁免缝隙（要么入统计、要么修订口径声明）；
  2. 统一两条终局路径的收件箱判据（host 原生 task-error 对齐 emitTerminal 的「有接收端不入箱」），补对应测试；
  3. 清理 5 处 `catch (e: any)` 与 readdir 静默吞错（EACCES/EIO 应上报而非伪装空历史）。

## 维度得分表

| 维度 | 得分 | 确认 | 被驳回 | 未核实低风险 |
|---|---|---|---|---|
| NM 与进程边界 | 8.5 | 1 medium + 3 low | 0 | 0 |
| 文件系统安全 | 8.0 | 3 medium + 2 low（另 1 项正面确认） | 0 | 0 |
| 扩展端安全 | 8.5 | 2 medium + 2 low | 0 | 0 |
| 协议与竞态正确性 | 7.5 | 4 medium + 2 low | 0 | 0 |
| 守门与测试真实度 | 8.5 | 2 medium + 2 low | 0 | 0 |
| 工程质量 | 8.5 | 2 medium + 3 low | 0 | 1（spawn.ts 空监听为已论证刻意设计，无行动项） |

合计：**0 critical / 0 high / 14 medium / 约 15 low**。

## 确认问题清单

**Critical：无。**

**High：无。**

**Medium（14 项，按严重度排列）：**

1. **cancel 带 taskId 而 currentTask 为空时退化为无 taskId cancel，可误杀 host 侧最近任务**（协议）。`sw.ts:536-539` 守卫 `msg.taskId && currentTask && ...` 在 currentTask 为 null 时不命中，落入 `cancelCurrent()` → `sw.ts:630-634` 无条件发无 taskId cancel → host `stdio.ts:104-106` 收割 `[...tasks].at(-1)`。`sw.test.ts:608` 未覆盖该象限；`App.tsx:202` 注释与生产行为相反。影响面：看门狗/终局竞态窗口下误杀无关在途任务。
2. **存量 0755 收敛三缺口**（文件系统）。attachments 目录完全无 chmod 收敛（`task.ts:136-137`，实测 0755）；history 只收敛当次写入路径，旧年月目录 0755 永存（`history.ts:103-106`，实测 history/2026 与 2026/09 均 0755）；workflows 根无收敛（`workflows.ts:119-122`，实测 0755）。影响面：同机其他用户可枚举文件名（历史 slug 含页面标题 = 阅读史元数据）；被根目录 0700 缓解为纵深不一致。
3. **CLI 二进制探测/spawn 解析不一致 + 用户可写 PATH 目录前置**（NM 边界）。probe 用 resolveBin 绝对路径（`registry.ts:71-82`），实际 spawn 传裸名重查（`task.ts:240-242` / `spawn.ts:38`）；`~/.local/bin` 等排在系统目录前。影响面：同 uid 影子二进制优先执行、探测版本与实际执行可能不一致。
4. **host 原生 task-error 无条件入收件箱，与 emitTerminal 口径不一致**（协议）。`sw.ts:782-789` 不检测广播是否有接收端，面板已看过仍会在重开时经 missedTerminal 复读。`sw.test.ts:429` 只测了 SW 合成帧路径。
5. **迟到 task-meta/task-done 会话归档兜底当前锚 panelTabId**（协议）。`sw.ts:727` 与同函数 `tabOf` 路由（:765-767）口径矛盾，违背 r12「别页签绝不捡会话」不变式；cancelledTaskIds cap 16 淘汰后守卫失效。后果是会话串台（B 页签 resume A 的 CLI 会话）。
6. **task-content/chunk 的 seq 契约两端均不执行**（协议）。host `stdio.ts:90-102` 零校验、panel `App.tsx:465-473` 只测跳变不去重，重复帧文本被二次 append。当前 NM 通道有序故为理论缺口，未来任何重试/重放逻辑会静默产生重复正文。
7. **SW 的 nm 通用转发无字段级校验**（扩展端）。`sw.ts:549-569` 任意 ExtToHost 原样转发，panel 一旦出现 XSS 即成任意 host 命令通道。当前无注入点，纵深防御项。
8. **页面正文原样进 prompt，提示注入为产品固有威胁**（扩展端）。`extract.ts:150-163` 无围栏指令。建议 prompt 封装层加「正文是不可信数据」围栏并收敛 CLI 默认权限。
9. **host 行数余量 3 行 + 历史趋势 +43 行/轮**（守门）。`check-host-lines.mjs:73` 实测 2197/2200，下个修复轮必破线；红线形态退化为「每轮先做行数腾挪」，存在口径外逃逸（挪 scripts/、拆包）诱惑。
10. **行数口径与 src/scripts/ 豁免缝隙**（守门）。install/postinstall/uninstall 共 327 行被 SKIP 排除，但 `index.ts:12-29` 运行时动态 import——写 NM manifest、chmod 等安全敏感操作所在链路不受薄壳纪律约束。
11. **history.ts readdir 错误静默吞成「无历史」**（工程质量）。`history.ts:196/:244` catch 不区分 ENOENT 与 EACCES/EIO，真实 IO 故障伪装成空列表，排障无从下手。
12. **5 处 `catch (e: any)` 绕过 useUnknownInCatchVariables**（工程质量）。history.ts:112、task.ts:253、workflows.ts:129、stdio.ts:149/:156。全仓仅存的 strict 逃逸点，可零成本清零。

**Low（摘要）**：stdin 无背压/无 host 侧长度上界；task-content 无累积上限；帧读取器 O(n²) Buffer.concat；workflow tmp 文件 pid 可预测（同 uid 前提下理论）；agent-workspace 同前缀链接误删；restoreSession 浅校验；manifest 未显式声明 CSP；协议无逐消息版本校验；NmPort.probe 并发 pong 串扰；runnative 测试内嵌全量 build；vite.config `__dirname` 前向不兼容警告；nm.ts `(obj: any)` 入口；shared 包版本 0.1.0 脱轨；spawn.ts 空监听（已论证刻意设计，无行动项）。另：tmpfile.ts symlink 劫持防御为**正面确认**（三层防御齐全，无可利用面）。

## 被驳回发现

无。本轮 6 维度审计的对抗核实未驳回任何发现；所有 finding 均保有代码级证据。标注为「理论性/洁癖级」的 low 项系审计方自评降级，非驳回。

## 必须修复 Top 5（风险 × 投入排序）

1. **cancel 误杀守卫**（风险高/投入极小）：`apps/extension/src/background/sw.ts:536-539` 守卫改为 `if (msg.taskId && (!currentTask || msg.taskId !== currentTask.taskId)) return { ok: false }`——带 taskId 且无句柄时拒绝而非退化；`sw.test.ts` 补「带 taskId + currentTask 空」象限用例；同步修正 `App.tsx:202` 注释。
2. **存量 0755 收敛三缺口**（风险中高/投入小）：新增一个共享收敛函数（chmod 自身+逐级父目录至 `~/.ai-page-dive`），在 `task.ts:136-137`（attachments）、`history.ts:103-106`（list 时对全树年月目录收敛，而非仅当次路径）、`workflows.ts:119-122`（补 USER_DIR 根，对齐 skills.ts:68-69）三处调用。验收：实测三处目录 0700。
3. **spawn 复用 resolveBin 绝对路径**（风险中/投入小）：`packages/host/src/task.ts:240-242` 将 `bin: def.bin` 改为 resolveBin 已解析的绝对路径（探测与执行同源），同时消除探测版本与实际执行不一致。
4. **host 原生 task-error 收件箱判据统一**（风险中/投入小）：`sw.ts:782-789` 改走 emitTerminal（或复用其「sendMessage reject 才入箱」判据）；补 host 原生错误帧 + 有接收端的测试，与 sw.test.ts:429 形成双象限。
5. **迟到 meta/done 会话归档改用 tabOf**（风险中/投入小）：`sw.ts:727` 兜底分支从 `panelTabId` 改为 `tabOf(msg.taskId)` 台账查询，无记录则丢弃归档；补多 tab 迟到终局帧测试。同时评估给 cancelledTaskIds 淘汰时清归档指针。

（次优先：seq 重复帧去重一行守卫 `m.seq <= s.lastChunkSeq 则丢弃`——panel 侧单行，顺手修。）

## 红线符合性结论

| # | 红线 | 结论 | 证据 |
|---|---|---|---|
| 1 | 权限仅 activeTab+scripting+nativeMessaging+sidePanel+storage，不申请 `<all_urls>` | **符合** | manifest 实测核对；`optional_host_permissions` 为 D3 已拍板的用户主动授予项，默认关闭、安装零警告 |
| 2 | prompt/正文一律走 stdin，正文写本地临时文件 | **符合** | `spawn.ts:54-57` stdin 写入；`tmpfile.ts:52` 0600 + wx 排他写 + randomUUID 后缀 + 目录属主校验，symlink 劫持面关死 |
| 3 | 零凭证接触 | **符合** | 全链子进程调起未修改官方 CLI 二进制，无 token/OAuth/流量代理代码路径 |
| 4 | claude 运行内失败（stdout is_error）不能只看退出码 | **符合** | `claude.ts:79-83` + `task.ts:377` 硬判定落地 |
| 5 | host 薄壳 <2.2k 行（CI 断言） | **符合但存疑** | 实测 2197 < 2200 通过；存疑两点：余量仅 3 行（趋势 +43/轮，下轮必破）；src/scripts/ 327 行运行时经 index.ts 动态 import 却被统计口径排除，「host 进程跑的总代码量」声明与统计对象有缝 |
| 6 | v1 = macOS + Chrome，claude + codex 双适配器 | **符合** | opencode 适配器已按 D5 删除，无残留 |
| 7 | 历史落盘 `~/.ai-page-dive/history/年/月/日/时间戳-slug.md` + frontmatter | **符合** | history.ts 路径与结构实测一致；扣分不推翻结论（目录权限 0755 为质量问题，非路径违约） |

**总评**：这是一份高于行业平均水准的实现——竞态台账层层咬合、测试非 tautology、安全防御有多处超出同类产品的硬化（tmpfile 三层防御、pgid 收割、失步终结）。但「最高质量」尚差一步：14 个 medium 全部有真实代码证据，其中 cancel 误杀、会话串台归档、0755 收敛缺口三项是语义级缺陷而非理论洁癖。完成 Top 5 修复后，安全可升级为无条件「是」。

## 附：各维度一句话判词

- **NM 与进程边界（8.5）**：硬红线逐项核验通过；NM 帧解码对超限帧头/坏 JSON/handler 异常均不崩不卡；无 shell:true、argv 直传、resumeSessionId 白名单；遗留 1 medium（探测/spawn 解析不一致）。
- **文件系统安全（8.0）**：symlink 劫持面关死、slug 消毒不可穿越、prune 穿链复核齐全；遗留「存量 0755 收敛」基线落实不完整的三缺口（本机实测 0755 证据）。
- **扩展端安全（8.5）**：无 critical/high；2 medium 均为理论性纵深防御项（nm 通用转发无字段校验、prompt 注入固有威胁）。
- **协议与竞态正确性（7.5）**：丢片对账 + 三本台账 + 迟到帧邮戳层层咬合，成熟度高于绝大多数 MV3 扩展；4 个真实缺口（cancel 误杀象限、收件箱口径、seq 契约悬空、归档兜底串台）。
- **守门与测试真实度（8.5）**：203 用例真实、非 tautology、fixture 为真实形状；三项守门命令全过；余量 3 行 + src/scripts 口径缝隙为主要风险。
- **工程质量（8.5）**：零运行时依赖属实、strict 全仓下发；仅存 5 处 `catch (e: any)` 与 readdir 静默吞错。
