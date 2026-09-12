# R3 代码实现维度终审（review-2026-09-12-r3-impl）

- **审查对象**：HEAD = d39cbce；两批修复 `d3dfc75`（四维 review 九项）+ `d39cbce`（v3 深度分析七项）逐行回归 + 三轮遗漏增量
- **审查员**：impl 维度（第三轮）；并行 sec 维度报告见 `research/review-2026-09-12-r3-sec.md`
- **基线防重复**：review-2026-09-11-{ux,impl,arch,sec}.md、r2-{arch-impl,ux-sec}.md、deep-analysis-2026-09-12.md 已覆盖问题不重复计
- **验证手段**：全量源码阅读（sw.ts / App.tsx / task.ts / stdio.ts / spawn.ts / workflows.ts / nmport.ts / install.ts / tmpfile.ts / SummarizeView.tsx / HistoryView.tsx / Onboarding.tsx / registry.ts / install.sh）+ 正则字节级 PoC + vitest 全量（12 文件 76 用例全绿）
- **host 行数约束复核**：`packages/host/src/**/*.ts`（含 agents/）共 **1922 行 < 2000**，达标但仅余 78 行余量（见 i6）

---

## 一、两批修复回归验证（13 项全闭合）

| 修复项 | 验证点 | 结论 |
|---|---|---|
| impl-M1 spawn 窗口取消终局 | task.ts:221-225 `cancelled` → `reap()` + `onError('cancelled')`；该路径 return 先于 :242 exit listener 注册，**结构性无双终局帧**；stdio.ts:54-57 onError 即 `tasks.delete`，Map/心跳无泄漏 | ✅ |
| sec-M1 outline/workflow 名消毒 | task.ts:494 `sanitizeMeta(m[2].trim(), 200)`、:518 `sanitizeMeta(workflow, 64)` 在位——但消毒函数本身有新 bug（**R3-impl-M1**，见下） | ⚠️ 消毒点在位，函数有 bug |
| sec-M2 tmpfile 加固 | tmpfile.ts:19-21 `0o700` + `randomUUID` + `flag:'wx'` 在位；预置 symlink 面关死 | ✅ |
| impl-m2 history 兜底 | stdio.ts:85-87 `.catch` 回 list-fail 帧；history.ts 三层 readdir `.catch(()=>[])` 在位 | ✅ |
| impl-m3 task-error finished 拒收 | App.tsx:228 在位，与 chunk(:149)/status(:177) 对齐 | ✅ |
| UX-F3/F4 看门狗 + 刷新面 | App.tsx:80-105 看门狗；aliveAt 刷新面：chunk:157 / task-status:183 / task-meta:131 / task-alive:169 / beginTurn:305——穷举五面齐 | ✅（但见 m4 唤醒误杀） |
| sendChunk JSON.stringify 二分 | task.ts:325 与 sw.ts:476 对称，转义密集页不再击穿 NM 1MB | ✅ |
| sessionTouched | sw.ts:43/51/217/229/413 三显式分支（resume-history/new-session/summarize）前置置位；冷启动「SW 被消息唤醒 → handleMessage 先于 storage.get 回调」竞态闭合 | ✅ |
| startedAt 保留 | sw.ts:451 提取后重建 currentTask 时 `currentTask?.startedAt ?? Date.now()`——elapsedMs 不清零 | ✅ |
| F7 重名守卫双层 | Settings.tsx 预检（非内置撞名拒）+ workflows.ts:118-125 host 侧 originalName 守卫 + 删旧目录 | ✅（但见 m5 rm 顺序） |
| F1 resumable 会话级保留 | App.tsx:304 beginTurn 保留 | ✅（但引入粘滞残窗，见 m3） |
| F9 finished 台账补记 | App.tsx:314 beginSession / :332 resumeHistory 均补记在跑 taskId | ✅ |
| F10/F11/F8 | HistoryView pendingPathRef 守卫（:41-44，返回置 null :70）；Settings 删除 confirm（:218）；Onboarding 🎉 对齐 + copiedAtRef 刷新（:57）+ 立即检测重置（:130-133）；install.sh 1 分半对齐 | ✅ |
| nmport send try/catch | nmport.ts:78-87 在位 | ✅（但 probe 漏同保护，见 M2） |
| install ext-id 校验 | install.ts:82-87 `/^[a-p]{32}$/` + 测试用例 | ✅ |
| opencode resultSent 门控 | opencode.ts result 唯一性 | ✅ |

---

## 二、新发现（三轮均漏）

### [major] R3-impl-M1 — sanitizeMeta 正则范围错误：非拉丁文字元数据被整段清空

- **位置**：`packages/host/src/task.ts:438`
- **证据**（字节级解码 + PoC）：
  ```js
  .replace(/[\x00-\x1f\x7f-‏ -⁯...]/g, ' ')
  //                     ^^^^^^ 实际字符类范围：
  //  U+007F–U+200F（意图只是 C1 控制 U+007F-009F + 零宽 U+200B-200F）
  //  U+2028–U+2061（意图 U+2028-202F + U+2060-206F）
  'Café'.replace(re,' ')      // → 'Caf '     （é=U+00E9 被删）
  'Новости'.replace(re,' ')   // → '        ' （西里尔 U+04xx 全灭，标题清空）
  'Ελληνικά' / 'العربية'      // → 同样整段清空（希腊/阿拉伯 ≤ U+200F）
  ```
  覆盖面：**带变音拉丁（é ü ñ ç ° © « »）、希腊、西里尔、希伯来、阿拉伯、天城文等全部 ≤ U+200F 文字系**逐字符替换为空格，再经 `/\s+/g` 折叠 + trim → 标题/作者/站点名直接清空或残缺。U+2030–U+2061（‰ ′ ″ 等印刷标点）同样误删。反向：U+2062–U+206F（含 bidi isolates U+2066-2069）**漏覆盖**，零宽/bidi 消毒意图未完全达成。
- **触发时序**：任一俄语/希腊语/中东/南欧页面总结 → buildPrompt 的「标题: 」行为空、buildOutline 标题行残缺 → CLI 在无标题元数据下总结，质量降级且无任何报错（静默）。
- **影响评估**：中/日/英主力场景无感（CJK U+4E00+、假名 U+3040+ 均越界存活，ASCII 安全）——故不硬阻塞中文用户；但 CWS 面向全球发布，且与 v1 优先级「深度总结质量」直接冲突。**发布前应修**（建议随 0.1.2 与 r3-sec 的 R3-m1/m2/i1 同批）。
- **修法**：`/[\x00-\x1f\x7f-\x9f​-‏ - ⁠-⁯﻿￾-￿]/g` + 一条多文种用例（é/西里尔/假名存留，U+2066 删除）。10 分钟。
- **为何三轮漏**：sec 轮验证的是「消毒点覆盖面」（七注入点全覆盖 ✅），未对正则本身的区间做字节级核对；注释写的意图（200B-200F）与实际字符类（7f-200f）不符，视觉审查极易滑过。

### [minor] R3-impl-M2 — nmport.probe() 的 postMessage 无 try/catch（与本次修复的 send() 同类窗口）

- **位置**：`apps/extension/src/lib/nmport.ts:72`
- **证据**：`this.port!.postMessage({ t: 'ping' } as ExtToHost)` 裸调；send() 刚修的「host 刚死但 onDisconnect 尚未派发 → port 非空但 postMessage 同步抛」窗口在 probe 同样存在。
- **触发时序**：panel 打开瞬间 host 恰好退出 → connect() true → postMessage 抛 → Promise executor 内 throw → probe reject → handleMessage catch → panel-ready 应答 `{error:...}` → `setHostOk(false)` → **误进 Onboarding 安装引导**（host 明明装了）。
- **修法**：与 send() 同款 try/catch，失败 `resolve({ ok: false, error: 'port dead' })`。5 分钟。

### [minor] R3-impl-m3 — resumable 粘滞为真：失败窗口后换 CLI 的「假追问入口」

- **位置**：`apps/extension/src/sidepanel/App.tsx:133,201,304`
- **证据**：`resumable: s.resumable || !!m.sessionId` 只增不减——task-meta 带 sessionId（claude init 事件先到）即置 true；此后该任务失败（无完整回答）、用户不点「新对话」直接再问 → hasSession=false 走**全新总结**（SW startSummarize 已清 lastSession，sw.ts:414），但 beginTurn 保留 resumable=true（F1）；若新轮 CLI 是 codex（永不回 sessionId），resumable 粘滞为真 → canFollowUp=true → 「继续追问…」入口可点 → 追问必得 session-lost——恰是 F1 想消除的误导的反向残窗。
- **触发时序**：claude 轮 meta 已达 + 任务失败 → 直接输入新问题（非追问）→ codex 完整回答 → 点追问 → session-lost。链路长但全真实可达。
- **修法**：非 followUp 发送时复位 resumable=false（beginTurn 加 `{ followUp }` 参数，或 SW summarize 应答成功后复位）。3 行。

### [minor] R3-impl-m4 — 看门狗系统睡眠唤醒必误杀（1s 下限 < 一个心跳周期）

- **位置**：`apps/extension/src/sidepanel/App.tsx:103` `Math.max(WATCHDOG_MS - elapsed, 1_000)`
- **触发时序**：长任务运行中合盖睡眠 1 小时 → 唤醒 → elapsed 巨大 → timer=1s → 1 秒后判「响应超时」；而 host 恢复心跳最长需 20s → task-alive 迟到被 finished 拒收（:165）→ 后续全部 chunk 被拒（:149）——**host/CLI 实际存活且继续烧额度，UI 已宣告死亡**；用户重试还会经 SW cancelCurrent 再收割一次旧任务。
- **修法**：下限从 `1_000` 改为 `25_000`（一个心跳周期 + 抖动）——正常路径 elapsed << WATCHDOG_MS 不受影响，仅陈旧 aliveAt 场景多等一拍。1 行。

### [minor] R3-impl-m5 — saveWorkflow 改名保存 rm 旧目录先于写新文件（非原子，不可恢复丢失面）

- **位置**：`packages/host/src/workflows.ts:124-128`
- **证据**：`await rm(join(USER_DIR, input.originalName), …)` → `mkdir` → `writeFile`。writeFile 失败（磁盘满/EACCES/外接卷）时旧模式已删——正是 F7 要防的「原创内容不可恢复丢失」在低概率 IO 失败下的复现。
- **与并行评审关系**：`review-2026-09-12-r3-sec.md` R3-m2 独立发现同一问题（撞车确认，定级一致）。
- **修法**：先写新目录成功、后 rm 旧目录；顺序对调即闭合。

### [info] R3-impl-i6 — host 行数 1922/2000，余量 78 行

硬约束 #5「<2k Node」当前达标（含 agents/）。v2 多引擎（DECISIONS 六家并集）落地前建议拆分 task.ts（562 行）或迁移 DEFAULT_TASKS/prompts 到独立模块，避免下一次适配器收尾即破线。

### [info] R3-impl-i7 — sw.ts 分片循环不感知取消/易主

`sw.ts:474-491` task-content 分片循环不检查 `currentTask?.taskId === taskId`：取消/换任务后继续把旧正文全量发给 host（host 已删任务 → 逐帧回 no-task error，panel 静默忽略）。无用户可见害处，纯浪费带宽/帧数；循环内加一行守卫提前 break 即可（正文可达数 MB，多个 512KB 帧白发）。

### [info] R3-impl-i8 — __host-disconnected 不清 pending/不记 finished（陈述，防后续误报）

App.tsx:247-257 只置 done/收尾 streaming。现有路径全覆盖：pending 窗口由 SW startSummarize 失败应答（onStartResult）清、已绑任务由看门狗兜底；host 已死无迟到帧，finished 无需记。无行动项。

---

## 三、v3 报告 F2/F3 复核（任务书指定）

### F2 — opencode 附件不软链进 agent cwd：**确认未修，定级 minor 准确，不升阻塞**

- 证据：task.ts:105-119 `materializeAttachments` 仅 `writeContentFile` 落 tmpdir，无 `linkIntoCwd`；仅 contentFile 在 :179 软链。attachSection（:551-556）给 tmpdir 绝对路径，opencode `--dir` 钉死 cwd + 沙箱只读 cwd（opencode.ts:64 filePathInPrompt 即为此设计）→ 附件对 opencode 不可读。
- 不升级理由：硬约束 #6 明确 **v1 = claude + codex 双适配器**；opencode 是超额第三家（registry 已挂、UI 可见），其附件功能坏属已知债，不触 v1 发布门。修法照 v3 报告（逐附件 linkIntoCwd + attachSection 改 basename，**resume 轮需在 sessionCwds 记忆的 cwd 上同样执行**——v3 报告已正确指出）。

### F3 — isError/timeout 绕过 finish() 回收 cwd：**确认未修，定级 minor 准确，不升阻塞**

- 证据：task.ts:244 exit handler `if (this.doneSent || this.timeoutSent) return resolve()` 跳过 finish() → :338-344 的 mkdtemp cwd rm（spawn.ts:40 `pagedive-*`）不执行。isError（:286-302）与 timeout（:227-240）两路径同构绕过。
- 影响边界核实：仅 filePathInPrompt agent（opencode）用 mkdtemp cwd；claude/codex 走 stableCwd（本就不删）。**tasks Map 清理不受影响**（两路径都经 onDone/onError → stdio.ts:40/55 delete），无心跳永续、无 SW 不回收；泄漏物为近乎空的临时目录，macOS 周期清 tmpdir。定级 minor 恰当。
- 修法照 v3 报告 W3：抽 `reapAgentCwd()`，isError + timeout 两处补调（保持「cwd 已入 sessionCwds 不删」语义）。

---

## 四、已排除清单（防误报，12 项）

1. **heartbeat 转译无 currentTask 时静默**——host 心跳受 `tasks.size` 门控（stdio.ts:193），终局即停，无孤儿 task-alive。
2. **spawn 窗口取消双终局**——:224 return 先于 :242 exit listener 注册，结构性无双发；cancel 落在 :225-:243 之间不可能（同步段，JS 单线程）。
3. **beginTurn 双调用**（SummarizeView:133-134 attachNotice 随行）——setStream 函数式更新串行叠加，两条 user 气泡均保留，非覆盖。
4. **beginTurn 不记 finished 台账**（F9 只补 beginSession/resumeHistory）——send() 有 running 门（SummarizeView:132），running 中不可再发，无在跑任务被 beginTurn 覆盖的路径。
5. **follow-up 空 task-content 无 total**——SW expectedChars 留 undefined（sw.ts:304 判空跳过），对账设计内豁免。
6. **task-alive 在 taskId=null 时「抢跑首帧绑定」**——handler（App.tsx:164-170）只更新 aliveAt/phase，不设 taskId/activeId，不会空会话劫持；panel 重开中任务经 chunk 首帧正常重绑。
7. **HistoryView pendingPathRef 守卫不完备嫌疑**——详情页必经「返回」（:70 置 null）回列表，连续双不同 path 读取不可能，守卫充分。
8. **sessionTouched 冷启动竞态**——三显式分支均前置置位（sw.ts:217/229/413），restoreSession 后到即跳过；followUp 分支不置位正确（不改写 lastSession）。
9. **tmpfile 预置 symlink 攻击**——UUID + wx + 0o700 关死（与 r3-sec §一一致）。
10. **saveWorkflow originalName 路径穿越**——双侧 assertValidWorkflowName（r3-sec §2.1 PoC 不成立，一致；残 R3-m1 纵深由 r3-sec 计）。
11. **心跳 20s vs SW idle 30s**——余量 10s 足够，NM port 消息活动重置计时器。
12. **看门狗依赖数组缺 taskId/activeId**——[running, aliveAt] 足以驱动重排；timer 回调内再校验 activeId/pending，无过期击发面。

---

## 五、结论

**条件 GO（可发布）。**

- **发布前应修（随 0.1.2 小版本，合计 <1 小时）**：R3-impl-M1（sanitizeMeta 正则，10 分钟——对非拉丁页面是静默质量破坏，与 v1「深度总结质量」冲突）+ r3-sec R3-m1/m2/i1（与本轮 m5 撞车项已含）。
- **审核等待期吸收**：R3-impl-M2（probe try/catch）、m3（resumable 复位）、m4（看门狗下限 25s）、m7（分片循环守卫）。
- **F2/F3 维持 v3 报告 minor 定级**，均不升阻塞（影响面限于 v1 范围外的 opencode 适配器 / 临时目录缓慢泄漏）。
- **无 blocker**。两批修复（d3dfc75 + d39cbce）13 项验证全闭合，无回归；vitest 12 文件 76 用例全绿。

| 级别 | 计数 | 编号 |
|---|---|---|
| blocker | 0 | — |
| major | 1 | R3-impl-M1 |
| minor | 4 | R3-impl-M2 / m3 / m4 / m5（m5 与 r3-sec R3-m2 撞车） |
| info | 3 | i6 / i7 / i8 |
