# 实现维度严苛 Review — 2026-09-11（commit 8fd0f12 之后）

审查人：代码实现维度深度 review（默认怀疑一切，逐 finding 附 file:line 证据与触发时序）
范围：packages/host/src 全部 / apps/extension/src/background/sw.ts + lib/nmport.ts / packages/shared/src/protocol.ts / panel 侧（App.tsx / SummarizeView / HistoryView / Onboarding）
验证手段：全量精读 + 竞态时序推演 + `npx vitest run`（12 files / 73 tests 全绿）+ dist 产物布局核查

---

## 结论

**实现层达到可发布水准（有条件 GO）**：0 blocker、1 major、5 minor。
U1 双发竞态修复（占位 + 哨兵 + pending 门）经穷举交错验证成立；C1 版本单源在 npm 全局/pnpm/postinstall 三场景解析正确；C2 终局解绑 + finished 拒帧闭环。唯一 major 是一个取消窗口的终局帧缺失（一行级修复），建议随下个 patch 一并出。

---

## Findings

### [major] M1 — CLI 启动窗口内取消：无终局帧 + host 任务泄漏 + 心跳永续，panel 输入锁死

**证据**：`packages/host/src/task.ts:218-222`

```ts
// spawn 成功后又已取消（cancel 落在 await 窗口内）：立即收割，勿让进程跑满超时
if (this.cancelled) {
  this.proc.reap()
  return
}
```

**触发时序**（每个 await 都是真实窗口）：

1. `contentReady` → `t.run()`（task.ts:127）入口 cancelled 检查（:131）通过
2. run() 连续 `await`：`writeContentFile`(:143) → `getWorkflow`(:154) → `getSkillBodies`(:158) → `materializeAttachments`(:189) → `makeAgentCwd`/`getStableAgentCwd`(:170-176) → `await spawnCli`(:198) —— 5-8 次磁盘 IO + spawn，数毫秒到数十毫秒
3. 用户在此窗口点「停止」→ SW `cancelCurrent()`（sw.ts:240）→ host `tasks.get(id).cancel()`（stdio.ts:79）→ `cancelled=true, proc=undefined`
4. spawnCli resolve → task.ts:219 命中 → `reap(); return` —— **`onError('cancelled')` 从未发出**
5. 后果链：
   - panel：已收到 SW 合成 `task-status(reading)` 帧（sw.ts:400）→ `activeId` 置位 → `running=true` 永真（SummarizeView.tsx:100）→ 输入框 disabled、停止钮常驻；再点停止 → SW `currentTask` 已 null → `cancelCurrent()` 返回 undefined → 无任何帧 → **锁死，唯一出路是「新对话」**
   - host：`tasks` Map 永不 delete（delete 只挂在 onDone/onError，stdio.ts:40/55）→ 任务对象泄漏
   - `setInterval` 心跳（nm.ts? no — stdio.ts:188-191）条件 `tasks.size > 0` 永真 → 每 20s 一帧 → **SW 永不空闲回收**（常驻耗电）

**窗口可达性**：用户「点发送后立刻反悔」是高频操作，且该窗口恰是 CLI 冷启动最慢的阶段。高频、可复现。

**修法**（一行级）：

```ts
if (this.cancelled) {
  this.proc.reap()
  this.cb.onError('cancelled', 'task cancelled')
  return
}
```

`onError` 回调内 `tasks.delete`（stdio.ts:55）同步闭环，panel 收 task-error(cancelled) 解锁。建议补一条 vitest：mock IO 慢返回 + cancel 落窗内，断言 onError('cancelled') 恰发一次。

---

### [minor] m1 — HistoryView 删除对账重拉丢失搜索上下文（stale closure）

**证据**：`apps/extension/src/sidepanel/HistoryView.tsx:21-36`

```ts
useEffect(() => {
  const listener = (m: HostToExt) => {
    ...
    if (m.t === 'deleted' || (m.t === 'error' && m.code === 'delete-fail')) refresh()
  }
  ...
}, [])                                  // ← 空依赖，listener 捕获首渲染的 refresh
function refresh(q = query) { ... }     // ← 默认参数捕获首渲染的 query = ''
```

**触发时序**：用户搜索 "foo"（列表过滤）→ 删除一条 → `deleted` 帧到达 → stale `refresh()` 以 `query=''` 重拉 → 全量列表替换过滤结果，搜索框仍显示 "foo" 但列表未过滤，UI 自相矛盾。

**修法**：`query` 入 `useRef`，refresh 读 `queryRef.current`；或 listener 挂进带 `[query]` 依赖的 effect（注意防抖定时器对账）。

---

### [minor] m2 — listHistory 链路无 rejection 兜底，可崩 host 进程

**证据**：
- `packages/host/src/stdio.ts:83`：`listHistory(msg.query, msg.limit).then((items) => ...)` —— **无 .catch**
- `packages/host/src/history.ts:135/138/141`：`readdir(year)/readdir(month)/readdir(day)` 三层 **均无 try/catch**（对照：per-file 读取在 :145 有 try 包裹；`listWorkflows`/`listSkills` 内部全 catch，安全）

**触发时序**：历史目录中任意年份/月份目录 EACCES（共享 mac 上其他用户属主、手动 chmod）→ readdir 抛出 → promise reject → unhandledRejection → Node ≥18 默认策略 **进程退出** → NM 断连 → panel 报「本机 host 连接中断」，且此后每次打开历史面板都复现（host 重启后再撞同一目录）。

**修法**：stdio.ts:83 补 `.catch(e => send({t:'error', code:'list-fail', message:...}))`（与 history-read/delete 同构，:100/:105）；或 history.ts 三层 readdir 各 `.catch(() => [])`。

---

### [minor] m3 — content-mismatch 终局后，host 迟到的 cancelled 帧再叠一个错误气泡

**证据**：`apps/extension/src/sidepanel/App.tsx:169-188`（task-error handler 不查 `finished`）

**触发时序**：
1. NM 丢片 → SW 合成 `task-error(content-mismatch)` 直接发 panel（sw.ts:287）并 `task-cancel` host、`currentTask=null`
2. panel 终局：taskId=null、finished+=taskId，独立错误气泡已出
3. host 侧 `Task.cancel()` → reap → exit → `finish()` → `onError('cancelled')`（task.ts:345-348）→ `task-error(cancelled)` 帧迟到
4. panel：`s.taskId === null` → 走「当前任务」分支 → 把 reading 占位空气泡（streaming、text=''）转成第二个「已取消」错误气泡 —— **同一事故两个错误气泡**

对照：task-chunk(:107) 与 task-status(:124) 均有 `finished.includes` 拒收，task-error 漏配。

**修法**：task-error handler 开头补 `if (s.finished.includes(m.taskId)) return s`。

---

### [minor] m4 — 512KB 分片按原文字节收缩，未计 JSON 转义扩张，最坏 2x 可破 1MB 帧限

**证据**：
- 发送侧 host：`packages/host/src/task.ts:314-327`（`Buffer.byteLength(text.slice(...)) ≤ MAX_CHUNK` 即收）
- 发送侧 SW：`apps/extension/src/background/sw.ts:450-464`（`new Blob([...]).size` 同判据）
- 帧编码：`packages/host/src/nm.ts:12-14` —— `JSON.stringify` 后 `4 + body.length > 1MB` 即 throw

**触发时序**：markdown 片段 512KB 中 >50% 是 `\`（JSON 转义 `\\` 2x）或密集 `"`+控制字符——正则教程页/代码转义密集页真实存在 → host 侧 `encodeFrame` throw → `runNative.send` catch 只 console.error（stdio.ts:170）→ **该 chunk 静默丢失，panel 正文缺段且无任何报错**（seq 继续，对账机制只覆盖 task-content 方向，不覆盖 task-chunk 方向）。SW→host 方向同理 [?]（Chrome 对超限 NM postMessage 的行为——丢弃或报错——未查证到权威文档，标疑；host 侧路径是确证的）。

**修法**：收缩判据改用 `JSON.stringify(text).length`（或 Buffer.byteLength(JSON.stringify(text))）≤ MAX_CHUNK；或 MAX_CHUNK 直接降 256KB（带宽损失可忽略，彻底关死 2x 上限）。

---

### [minor] m5 — codex 完成后 panel 显示「继续追问…」，发送必得 session-lost

**证据**：
- `apps/extension/src/sidepanel/SummarizeView.tsx:101-102`：`canFollowUp = messages.some(assistant 非流式无错有文)` —— **不问 sessionId 是否存在**
- codex 解析器不产 sessionId：`packages/host/src/agents/codex.ts:25-27`（thread.started → 仅 status 事件）；`codexDef.buildArgs`（:55-62）也无 resume 能力
- SW `lastSession` 仅在 `task-meta/task-done` 带 sessionId 时记录（sw.ts:295-299）→ codex 任务后 `lastSession===null`

**触发时序**：codex 总结完成 → panel `hasSession=true` → 占位符「继续追问…」+ workflow 下拉禁用 → 用户输入追问 → SW followUp 分支 `return {error:'session-lost'}`（sw.ts:195）→ 错误文案「会话已失效——本次将开始全新总结」，但**并不会真的开始新总结**，用户须手动重发。每次必现，误导。

**修法**（任选其一）：panel 侧 hasSession 增加「task-done 帧带 sessionId」条件；或 SW followUp 的 session-lost 分支降级自动改走全新总结（DECISIONS v1 双适配器语义下更顺）。

---

## [info]

1. **双 panel 窗口同流镜像**：两窗口各开 panel，runtime.sendMessage 广播使 A panel 终局后（taskId=null）会「首帧绑定」B 任务的流，两边同步渲染同一任务。单 panel 是 resume/new-session 后正确重绑的前提；双 panel 场景属镜像语义，v1 可接受，记为已知行为。
2. **外部 SIGTERM/SIGKILL 归因为 cancelled**（task.ts:345）：CLI 被 pkill/OOM-kill 时用户看到「已取消」而非异常。低频，文案层面可后续区分。
3. **agentsCache 离线陈旧**（sw.ts:229-232）：host 断连后 list-agents 仍回内存缓存（available 可能虚高），点击后才见 host-not-found。可接受。
4. **host 行数**：src 全量 1986 行（含 agents/ 四适配器 + postinstall 脚本），<2k 达标但已贴线——后续每加功能必须同步减或明确豁免 postinstall/agents 的口径。
5. **version.test.ts** 只覆盖 npm 包根场景断言（HOST_VERSION === package.json），dist 布局正确性靠 tsconfig rootDir=src 平铺保证（已核查 dist/version.js 存在且层级对称）——建议未来加一条 dist 产物存在性断言。

---

## 已排除清单（看似 bug，查证后正确）

| # | 疑点 | 排除理由 |
|---|------|---------|
| 1 | 空正文时 SW 内容发送 while 循环不发 done 片 → host 永不 run | 提取器 `extract.ts:101` 对 `!markdown.trim()` 先返 `empty-content`，SW 在 `startSummarize` 提取失败分支提前 return；followUp 路径显式发空 done 片（sw.ts:334）。不可达 |
| 2 | sendChunk 二分收缩可能死循环（end 收敛到 start） | `slice(start,start)` 字节长 0 必然退出 while；单字符最大 4 字节远小于 512KB，end==start 后下一轮外层循环重新取 `start+CH`。收敛性成立 |
| 3 | host 收到未知 taskId 的 task-cancel 是否 no-op | `stdio.ts:79` `tasks.get(msg.taskId)?.cancel()` —— undefined 短路，无帧无副作用。U1 设计意图确认成立（提取窗口内的 cancel 正是打到不存在的 task） |
| 4 | dist/version.js 的 `../package.json` 层级在 npm 全局安装后失效 | tsconfig `rootDir:src, outDir:dist` 平铺（dist/version.js 实存），`../` = 包根；npm/pnpm 全局均保留包根 package.json；readFileSync 失败兜底 '0.0.0' → versionLt 判旧强制升级横幅，失败方向安全（version.ts:7-13） |
| 5 | `__host-disconnected` 不清 pending → running 永真 | 该分支同时 `setHostOk(false)` → App.tsx:285 早退渲染 `<Onboarding/>`，SummarizeView 卸载，锁死不可达 |
| 6 | U1 占位 currentTask 被 cancelCurrent 清掉后提取继续跑 → 隐形双任务 | 提取后哨兵 `if (!currentTask \|\| currentTask.taskId !== taskId) return {error:'cancelled'}`（sw.ts:425）穷举 cancel/new-session/resume-history/二次 summarize 四条交错路径均正确拦截；二次 summarize 场景由入口 `cancelCurrent()` + 哨兵双重闭合 |
| 7 | beginTurn 置 pending 后某条路径不清 → 永久 running | 逐路径核：task-chunk(:115)/task-status(:130)/task-done(:147)/task-error(:186)/onStartResult(:227) 全部 `pending:false`；断连路径由 #5 遮蔽；SW handleMessage 兜底 catch 必回 `{error}`（sw.ts:156）→ onStartResult 清。闭环 |
| 8 | finished 记录中 taskId 重新出现（复用/碰撞）→ 拒收误伤新任务 | `newTaskId` = 毫秒时间戳36 + 4 位随机（36^4≈1.7M），同毫秒同随机才会碰撞；finished 窗口仅 8 条，实际不可达 |
| 9 | resume 轮 `effectiveHistoryPath` 空串覆盖 lastSession | task.ts:380-382 显式 `input.historyPath \|\| this.historyPath`，注释即为此修复。正确 |
| 10 | timeout 路径 finish() 二次发终局 | `timeoutSent` 前置于 reap（task.ts:227-228），exit handler :241 先查 `doneSent \|\| timeoutSent`。isError 路径同理（doneSent :285）。双保险成立 |
| 11 | spawn reap 误杀 pid 复用后的无关进程组 | spawn.ts:94/99 双查 `exitCode/signalCode !== null` 才 kill(-pid)。正确 |
| 12 | 临时文件清理窗口（运行中被删 → CLI 读半截正文） | 正文/附件统一 11min 清理（task.ts:114/147-149）> 10min 任务超时，运行期文件必在；终局后 1min 缓冲覆盖迟到读取。成立 |
| 13 | `escapeYaml` 未消毒控制字符可破坏 frontmatter | 引号包裹 + 换行替换为空格（history.ts:60），YAML 双引号标量内控制字符不破坏结构；解析侧 get() 正则按行取。往返成立（有测试覆盖） |
| 14 | `restoreSession` 微任务与首个 followUp 消息竞态 | sw.ts:194 `if (!lastSession) await restoreSession()` 双保险 + storage.session 读取微秒级。成立 |
| 15 | SW 发送循环中 cancelCurrent 交错（正文分片中途取消） | 发送 while 循环无 await（sw.ts:450-467），JS 单线程无交错窗口；expectedChars 在循环后同步赋值，host 回执必在其后 |
| 16 | task-content 到达已 run 的 task（重复 done 片） | `Task.ran` 幂等闸（task.ts:128-129）。正确 |

---

## 回归验证对象逐项结论（本轮修复点）

| 修复项 | 结论 |
|--------|------|
| 1. version.ts | ✅ 正确（排除 #4）；测试断言三处版本串防漂移生效 |
| 2. sw startSummarize 重构 | ✅ 哨兵与占位逻辑穷举成立（排除 #6），**但暴露相邻 M1**（host 侧 spawn 窗口取消无终局——非本次改动引入，是 run() 既有缺口被 U1 的 reading 占位帧放大：占位帧让 panel 更早绑定 activeId，锁死从「偶发」变「必现」） |
| 3. App.tsx pending/finished | ✅ 闭环（排除 #5/#7/#8）；小缺口 m3（task-error 不查 finished） |
| 4. HistoryView 对账 | ⚠️ 回滚/重拉方向正确，但 stale query（m1）使重拉语义打折 |
| 5. setOptions warn/running 判定/附件按钮/括号/useRef | ✅ 逐项核对无误（ActionBar disabled 条件与 Enter 守卫对齐；比较器括号显式化正确） |

## 发布判定

- **必须修**：M1（一行 + 一条测试）
- **建议随修**：m2（host 崩溃面，两行）、m1/m3/m5（体验）、m4（可先降 MAX_CHUNK 一行避险）
- 其余可作为 backlog。修完 M1 后实现层无已知阻塞，GO。
