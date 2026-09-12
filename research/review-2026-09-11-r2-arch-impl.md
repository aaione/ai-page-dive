# PageDive 深度严苛架构 + 实现 Review（第二轮 · 2026-09-11 r2）

- **评审对象**：working tree（第一轮 arch/impl review 之后主 agent 的一批修复；`M task.ts / stdio.ts / history.ts / tmpfile.ts / sw.ts / App.tsx / SummarizeView.tsx` + 新增 `task.test.ts`/`install.test.ts` 用例）
- **评审视角**：① 逐项验证本轮修复是否真正闭合原 finding、是否引入新竞态/回归；② 全量精读 `packages/host/src` + `apps/extension/src/background/sw.ts` + `sidepanel/*.tsx` 独立发掘新问题；③ 判断当前实现是否最优、v2 演化余量。
- **对照基线**：CLAUDE.md 硬约束 7 条；DECISIONS.md（含 2026-09-09 多引擎定案 + D10 分发形态）；上一轮 `review-2026-09-11-arch.md`（M1/M2/M3 + m1-6 + i1-4）与 `review-2026-09-11-impl.md`（M1 + m1-5）。
- **证据形式**：`file:line`（行号取自当前 working tree）。
- **测试基线**：`npx vitest run` → **75 passed / 0 failed**（含本轮新增「spawn 窗口内取消发 onError('cancelled') 恰一次」M1 回归用例、install 非法 ext-id 跳过用例）。

---

## 0. Verdict（先行）

**GO（0 blocker）。** 本轮修复经逐项穷举交错验证**全部真正闭合**，且**未引入新的双终局帧/回归**——上一轮 impl 的唯一 major（M1 spawn 窗口取消无终局帧）已用一行 `onError('cancelled')` + 回归测试闭合；arch 的 M3（会话归属时序推断）在本轮已被 App.tsx 侧「帧自带 agentId 优先」部分落地，SW 侧仍为遗留兜底（见下）。

本轮新发掘 **0 blocker / 0 major**：新问题集中在体验/健壮性的 minor 层，加上若干架构级质量债（多数与上一轮 M1/M2 判断一致，未回退）。

**计数：blocker 0 / major 0 / minor 6 / info 5。硬约束判定：7 条 ✅（HC5 行数余量、HC6 opencode 漂移仍为 ⚠️ 文档级，判定沿用上一轮，不重复计 blocker/major）。**

发布结论：**实现层无已知阻塞，可发布。** 建议随下个 patch 顺手做的是 R2-m1（nmPort.send 无 try/catch，postMessage 断连瞬间抛未捕获异常）与 R2-m2（codex 完成后「继续追问」必得 session-lost，上一轮 impl-m5 未修）。

---

## 1. 硬约束符合性（本轮改动相关项复核）

| HC | 判定 | 本轮相关证据 |
|---|---|---|
| HC1 权限面（无 `<all_urls>`） | ✅ | 本轮未动 manifest/权限；sw.ts 仍只用 activeTab+scripting 注入（`sw.ts:406`）、storage.session 持久化（`sw.ts:44`）。 |
| HC2 prompt/正文走 stdin + 正文落临时文件 | ✅ | `task.ts:198` spawnCli `stdinData: prompt`；正文 `writeContentFile`（`tmpfile.ts:14`）；argv 零正文（claude/codex/opencode buildArgs 均只含开关）。本轮 `tmpfile.ts` 加 UUID + `wx` 排他写，未破坏「路径进 prompt、正文进文件」纪律。 |
| HC3 零凭证接触 | ✅ | `registry.ts:52` `cliEnv` 唯一改写 PATH；本轮无涉及。 |
| HC4 claude is_error 不只看退出码 | ✅ | `claude.ts:62 isError()`；`task.ts:285` result.isError 分支 + `task.ts:356 gotResultOk` 豁免。本轮无涉及。 |
| HC5 host 薄壳 <2k 行 | ⚠️（沿用 arch-i4） | `wc -l packages/host/src/**/*.ts` 仍贴线；本轮改动净增行数在注释与一行修复级，未显著恶化。判定不变。 |
| HC6 v1 双适配器 | ⚠️（沿用 arch-m3） | `registry.ts:13 AGENTS = [claudeDef, codexDef, opencodeDef]` 仍三家。本轮未裁决。**DECISIONS 与代码事实源仍未对齐**（见 R2-info-1）。 |
| HC7 历史/workflow/skills 落盘路径 | ✅ | `history.ts:66 buildHistoryPath` 年/月/日/HHMMSS-slug.md 不变；本轮 `history.ts:132-143` 三层 readdir 加 `.catch(()=>[])` 未改路径语义。 |

---

## 2. 本轮修复验证（逐项结论）

### ✅ 修复 1 — task.ts spawn 窗口取消发 `onError('cancelled')`（闭合上一轮 impl-M1）

- **证据**：`task.ts:218-224`
  ```
  if (this.cancelled) {
    this.proc.reap()
    this.cb.onError('cancelled', 'task cancelled')   // ← 本轮新增
    return
  }
  ```
- **闭合性验证**：`onError` 回调 → `stdio.ts:55 tasks.delete(task.taskId)` → task 泄漏消除、`stdio.ts:192-195` 心跳 `if (!tasks.size) return` 恢复空闲、SW `sw.ts:271-276` 收 task-error 清 currentTask、panel `App.tsx:196 task-error` 走终局解锁。三处联动闭环。
- **关键怀疑点：exit 事件会不会再触发 finish() 导致双终局帧？** —— **不会，已核实**：本分支 `return` 早于 `this.proc!.child.on('exit', ...)` 的注册（`task.ts:242`）。即取消分支命中时 **exit handler 根本未挂载**，`reap()` 触发的 SIGTERM→exit 无监听者，不可能二次 `finish()`。这是比「靠 doneSent/timeoutSent 门控」更强的结构性保证（时序上根本没有第二条路径）。
- **回归测试**：`task.test.ts:161-183`「spawn 窗口内取消：发 onError(cancelled) 恰一次」用 `slow`（60s）假 CLI 确保只由 cancel 收割，断言 `cbs.errors === [['cancelled','task cancelled']]` 且 `cbs.done === null`。**用例设计正确**（不 await run()、cancel 落 await 窗口内）。
- **结论**：真正闭合，无回归，无双终局帧。

### ✅ 修复 2 — sendChunk 改用 `JSON.stringify` 长度判据（闭合上一轮 impl-m4 收缩侧）

- **证据**：`task.ts:324` `while (end > start && Buffer.byteLength(JSON.stringify(text.slice(start, end))) > MAX_CHUNK)`；SW 侧对称 `sw.ts:453` `new Blob([JSON.stringify(...)]).size > CH`。
- **闭合性**：转义密集页（`\`/`"`/控制字符最坏 2x 膨胀）不再让 `nm.ts:12 encodeFrame` 因 `4 + body.length > NM_MAX` throw。回归用例 `task.test.ts:115`「CJK 大 delta 40 万字」断言每片 `Buffer.byteLength ≤ 512KB`。
- **关键怀疑点：每轮二分都重新 `JSON.stringify(text.slice(...))`，大正文性能是否可接受？** —— **可接受，量化如下**：
  - 二分收缩只在**单片超限时**触发（正常 markdown 极少），且二分深度 = log2(512K/1) ≈ 19 层，每层 stringify 一个 ≤512KB 子串。最坏单片 19 次 512KB stringify ≈ 数十 ms 级，一次性成本。
  - 外层循环每片首次 `Math.min(start+MAX_CHUNK, len)` 直接取满 512K，只有该片确实超字节上限才进 while。**绝大多数片是 0 次二分**（英文/普通中文 markdown JSON 膨胀远不到 2x）。
  - 真实风险不是 CPU 而是**同一子串被 stringify 两次**（收缩判据里一次、`onChunk(text.slice(...))` 后编码时 `nm.ts` 又一次）——但这是 host 单任务、非热路径，且正文总量已被 `extract.ts:13 MAX_CONTENT=200_000` 字符封顶（200K 字符 → 最多 ~2 片），**根本到不了"大正文"量级**。判定：无性能问题，且 MAX_CONTENT 封顶让此路径的最坏情况被结构性限制住了。
- **结论**：闭合正确，性能非问题（被 200K 提取上限保护）。

### ✅ 修复 3 — buildOutline 每行过 sanitizeMeta + buildPrompt fallback 消毒 workflow 名

- **证据**：`task.ts:494` `sanitizeMeta(m[2].trim(), 200)`（大纲标题——「正文只走文件」围栏的唯一旁路，页面完全可控）；`task.ts:518` fallback `sanitizeMeta(workflow, 64)`。
- **验证**：`sanitizeMeta`（`task.ts:436`）去控制字符/零宽/bidi(含 U+202E RTL)/BOM + 单行化 + 码点截断防劈代理对。回归用例 `task.test.ts:241`「恶意 title 换行注入被压单行」+ `task.test.ts:252` buildOutline 用例覆盖。
- **结论**：正确闭合了「大纲逐行铺伪造指令」的注入面。

### ✅ 修复 4 — stdio.ts history-list 加 `.catch` + history.ts 三层 readdir `.catch(()=>[])`（闭合上一轮 impl-m2）

- **证据**：`stdio.ts:85-87` `.catch((e) => send({t:'error', code:'list-fail', ...}))`；`history.ts:132/138/140` 三层 readdir 各 `.catch(() => [])`（day 层 `history.ts:143` `.catch(() => [] as string[])`）。
- **闭合性**：任意年/月/日目录 EACCES → 该子树跳过返 []、其余历史照常返回，不再 unhandledRejection 崩进程。**双保险**：即便 history.ts 内层漏了，stdio.ts 外层 `.catch` 兜底回 error 帧。
- **结论**：正确，防线冗余得当。

### ✅ 修复 5 — tmpfile.ts 目录 0o700 + 文件名 randomUUID + wx 排他写

- **证据**：`tmpfile.ts:13-15` `mkdir(DIR, {mode:0o700})` + `join(DIR, ${name}-${randomUUID()}.md)` + `writeFile(..., {mode:0o600, flag:'wx'})`。
- **闭合性**：taskId 熵仅毫秒时间戳+4 位随机（`sw.ts:253 newTaskId`，36^4≈1.7M），同 uid 恶意进程可预测旧文件名预置 symlink → 页面正文覆盖任意用户可写文件。UUID 后缀让文件名不可预测 + `wx` 拒绝跟随已存在 symlink，**双重关死**该面。
- **关键怀疑点：UUID 改名后 codex lastMsgFile / 软链 basename / 清理调度是否仍正确？** —— **全部正确，逐项核实**：
  1. **codex lastMsgFile**：`task.ts:144 lastMsgFile = \`${contentFile}.last\``，随 contentFile（含 UUID）一起唯一；`codex.ts:60 -o opts.lastMsgFile` 只写不读，功能不依赖可预测名。✅
  2. **软链 basename**：`task.ts:180 basename(contentFile)`（含 UUID）+ `contentRelPath: basename(contentFile)`（`sw`... 实为 task.ts）→ opencode `filePathInPrompt`（`opencode.ts:57 opts.contentRelPath`）给相对路径，软链名与 prompt 引用名一致。UUID 只是让 basename 更长，`linkIntoCwd`（`task.ts:427`）的 EEXIST 兜底照旧。✅
  3. **清理调度**：`task.ts:148-149 scheduleCleanup(contentFile/lastMsgFile, 11min)` 用**完整路径**（含 UUID），`tmpfile.ts:20 unlink(path)` 按完整路径删。UUID 不影响清理。✅
- **结论**：安全面关闭，无功能回归。

### ✅ 修复 6 — install.ts ext-id 32 位 a-p 校验

- **证据**：`install.ts:82 if (!/^[a-p]{32}$/.test(id))` 跳过并提示；回归用例 `install.test.ts:70`「非法 ID 被跳过不污染 allowed_origins」（4 位/大写/连字符/33 位全测）。
- **验证**：Chrome 扩展 ID 恒为 32 位 a-p(mpdecimal)，畸形 id 只会写永不匹配的死条目污染 manifest。跳过正确。
- **结论**：正确闭合。

### ✅ 修复 7 — sw.ts 正文分片改 JSON.stringify 长度判据（同修复 2 的 SW 对称侧）

- 见修复 2。`sw.ts:453` 与 host 侧 `task.ts:324` 同判据，两侧一致。✅

### ✅ 修复 8 — App.tsx：task-error finished 拒收 / 120s 看门狗 / session-lost 文案

- **task-error finished 拒收**（闭合上一轮 impl-m3）：`App.tsx:199 if (s.finished.includes(m.taskId)) return s`——与 task-chunk（`:133`）/task-status（`:150`）对齐。content-mismatch 终局后 host 迟到 cancelled 帧不再叠第二个错误气泡。✅
- **120s 看门狗**：`App.tsx:74-93`。**逐怀疑点核实**：
  - **依赖 `[running, stream]`，每 chunk 帧都 clear/set timer，性能？** —— text-delta 密集期确实每帧重建一个 setTimeout。**可接受**：setTimeout 创建/清除是 O(1) 微操作，panel 单流、帧率受 NM+CLI 限制（远非 60fps），无性能问题。副作用 cleanup（`:92 return () => clearTimeout(timer)`）保证无泄漏。
  - **误触发？** —— 不会：只要有任一帧到达 `stream` 引用变 → effect 重跑 → 计时器重置。120s 内必有 heartbeat（host 20s 一帧，但 heartbeat 被 `sw.ts:278` 拦截不转发 panel！）——**关键：panel 收不到 heartbeat**。所以看门狗实际依赖的是 **task-chunk/task-status/task-meta** 帧刷新。CLI 深度思考期若 >120s 无任何 stdout（无 chunk 无 status），看门狗会**误判连接中断**。见 R2-m3。
  - **stale closure？** —— 无：`setStream((s) => ...)` 用函数式更新读最新 s，不捕获过期 stream。effect 依赖 `stream` 保证每次拿到新引用。✅（唯一代价是频繁重建 timer，已论证可接受）
- **session-lost 文案**：`App.tsx:249` + `SummarizeView` 无自动降级——见 R2-m2（文案对，但行为仍误导）。

### ✅ 修复 9 — SummarizeView：newChat/会话切换重置 followAgent / ModelDropdown 追问轮禁用 / Placeholder 动态 CLI

- **newChat 重置 followAgent**：`SummarizeView.tsx:187 setFollowAgent(null)`。✅
- **会话切换重置**：`SummarizeView.tsx:99-106` `firstMsgId` 变化 → `setFollowAgent(null)`（历史恢复/新对话首条消息 id 变时）。**核实**：`prevFirstId` ref 对比正确，避免历史恢复后头部显示上一会话遗留 CLI。✅
- **ModelDropdown 追问轮禁用**：`SummarizeView.tsx:208 disabled={hasSession}` + `ModelDropdown:451 useEffect(() => { if (disabled) setOpen(false) })` 收起残留菜单。✅
- **Placeholder 动态 CLI**：`SummarizeView.tsx:624 Placeholder({clis})` 渲染实际检测到的 CLI，不再硬编码 opencode。✅
- **结论**：三项均正确。

---

## 3. 新发现 Findings（独立发掘，附 file:line + 触发时序 + 修法）

### [minor] R2-m1 — `nmPort.send()` 的 postMessage 无 try/catch，port 断连瞬间抛未捕获异常

- **证据**：`apps/extension/src/lib/nmport.ts:76-80`
  ```
  send(msg: ExtToHost): boolean {
    if (!this.connect()) return false
    this.port!.postMessage(msg)   // ← 无 try/catch
    return true
  }
  ```
  对照 `connect()`（`:19-25`）对 connectNative 有 try/catch；`send` 对 postMessage 没有。
- **触发时序**：
  1. host 进程刚死（崩溃/被 kill），Chrome 尚未派发 `onDisconnect`（事件在下一 tick），此刻 `this.port` 仍非 null，`connect()` 短路返回 true；
  2. 任一 `nmPort.send(...)` 调用（`sw.ts:434` task-start / `sw.ts:335` task-content / `sw.ts:242` task-cancel）命中 `postMessage` → Chrome 同步抛 `Attempting to use a disconnected port object`；
  3. 该异常从 `startSummarize`/`startFollowUp`/`cancelCurrent` 冒泡：
     - 若在 `handleMessage` 链内 → `sw.ts:156 .catch((e) => sendResponse({error}))` 兜住，panel 收 `{error}` 尚可解锁，但 **`currentTask` 已 set 未清**（`sw.ts:394` set 在 `nmPort.send` 之前）→ 残留 currentTask，下一轮 startSummarize 入口 `cancelCurrent()` 会误发 task-cancel 到已死 host（无害但脏）；
     - 若在 `nmPort.onMessage` 回调内的 send（如 content-received 对账触发的 `sw.ts:286 task-cancel`）→ **无 catch 包裹**，异常逃逸到 Chrome 的 port.onMessage 派发器，静默吞掉，但会中断该回调后续逻辑（`currentTask=null` 在 `:289`，若 send 在其前抛则 currentTask 不清）。
- **窗口可达性**：host 崩溃/被 pkill 与用户点击同时发生的窄窗口，低频但非零；SW 长任务期 host OOM 时可达。
- **修法**：`send` 包 try/catch，抛错时 `this.port = null; return false`（与 connect 失败同语义），让上层按 `host-not-found` 处理。约 3 行。

### [minor] R2-m2 — codex 完成后 panel 显示「继续追问…」，追问必得 session-lost（上一轮 impl-m5 未修）

- **证据**：`SummarizeView.tsx:112-113` `canFollowUp = messages.some(assistant 非流式无错有文)` / `hasSession = canFollowUp`——**不问 sessionId 是否存在**；codex 解析器不产 sessionId（`codex.ts:33` thread.started 仅 status，buildArgs 无 resume）；`sw.ts:295-299` lastSession 仅在带 sessionId 时记录 → codex 任务后 `lastSession===null`。
- **触发时序**：codex 总结完成 → `hasSession=true` → 占位符「继续追问…」(`SummarizeView.tsx:562`) + workflow/model 下拉禁用 → 用户输入追问 → `sw.ts:195 if (!lastSession) return {error:'session-lost'}` → 文案「会话已失效——请点新对话后重新发送」，但**并不会自动开始新总结**，用户须手动重发。**codex 用户每次追问必现**，误导。
- **本轮状态**：上一轮 impl-m5 已列出，本轮**未修**（sessionId 门控未加）。
- **修法**（任选）：a) panel `hasSession` 增加「lastSession 带 sessionId」条件——但 panel 无 lastSession 可见性，需 SW 在 task-done 回帧透出 `resumable:boolean`；b) 更简：SW followUp 的 session-lost 分支**降级自动改走全新总结**（DECISIONS v1 语义下更顺，codex 本就无 resume）。推荐 b。

### [minor] R2-m3 — 120s 看门狗依赖内容帧刷新，但 heartbeat 不转发 panel，CLI 长静默思考期会误判连接中断

- **证据**：看门狗 `App.tsx:74-93` 依赖 `[running, stream]`，`stream` 变化才重置计时器；而 host 心跳 `heartbeat`（`stdio.ts:192` 20s/帧）在 SW 被 `sw.ts:278 if (msg?.t === 'heartbeat') return` **拦截不转发 panel**。panel 侧 `stream` 只由 task-chunk/task-status/task-meta 刷新。
- **触发时序**：claude/codex 深度研读长文，reasoning 阶段 >120s 无任何 stdout 增量（无 text-delta、init 之后无新 status）→ panel `stream` 120s 无变化 → 看门狗超时 → 收尾流式气泡 + 插「连接中断」错误气泡，**但 host 仍在正常跑**（未死）→ 真实结果到达时被 finished 拒收或异 taskId 丢弃 → **用户看到假的连接中断，实际任务还在后台烧额度**。
- **量化可达性**：deep/paper 模式 + 大模型 + 长正文，reasoning 静默 >2min 完全可能（o1/思考型模型常见）。中频、真实。
- **根因**：看门狗设计意图是「SW 死→无任何帧」，但用了「stream 内容变化」作代理信号，与「host 存活」不等价——host 活着但静默时二者背离。
- **修法**：heartbeat 也应让 panel 感知存活（两选一）：a) SW 把 heartbeat 转发 panel（或转成轻量 `{t:'alive'}`），panel 看门狗 effect 依赖里纳入"最后存活时刻"；b) panel 看门狗只在 `pending`（发出未收首帧）阶段用短超时，`activeId` 已绑定后延长到远大于 CLI 超时（host 10min，panel 用 11min）——因为已绑定说明 host 至少活到首帧，后续 host 侧 10min 超时会救。推荐 b（无需新协议帧）。

### [minor] R2-m4 — opencode 解析器 errored 置位后每行重复 push result，多帧终局（v2 隐患）

- **证据**：`opencode.ts:38-39`
  ```
  if (errored) out.push({ type: 'result', isError: true, text: '' })
  return out
  ```
  `errored` 一旦在某个 step_finish 置 true（`:36`），**之后每一行输入都会 push 一个 result 事件**。
- **触发时序**：opencode 某 step reason:'error' → errored=true → 后续每行 JSONL（可能还有多个 step）各产一个 `result{isError:true}`。task.ts `handleEvent` 首个 result 置 `this.finished=true`（`:287`）→ 后续 result 被 `:261 if (this.finished) return` 拦截。**当前不炸**（finished 门控兜住），但语义脏：解析器契约上「result 应恰发一次」被破坏。
- **为何仍列**：opencode 是事实上的准 v1 成员（HC6 漂移），且 v2 多引擎会更依赖解析器契约干净。属技术债。
- **修法**：`opencode.ts` 加 `let resultSent = false`，push result 前 `if (!resultSent) { resultSent = true; out.push(...) }`。一行级。

### [minor] R2-m5 — 追问轮 page 无 approxTokens，buildPrompt 的「约 undefined tokens」（仅 resume 非 buildPrompt 路径，实际不可达但契约脆）

- **证据**：`task.ts:191` resume 轮 prompt 走 `attachSection + instruction`，**不调 buildPrompt**——所以 `buildPrompt:540 约 ${page.approxTokens} tokens` 的 undefined 风险在 resume 轮**不可达**。但 `startFollowUp`（`sw.ts:328`）构造的 page `{url:'', title:'追问', extractor:'follow-up', approxTokens:0}` 显式给了 0，即便未来 resume 走 buildPrompt 也安全。
- **判定**：**当前无 bug**，列为 info 级观察（见 R2-info-4），不计 minor。~~此项撤销~~。
- （编号保留占位，实际并入 info-4。）

### [minor] R2-m5（重编）— SW `agents` 帧 merge 后「取代原帧」，但 list-agents 缓存命中路径与 host 帧路径的 lastModels 合并时机不一致

- **证据**：两条 agents 下发路径：
  1. host agents 帧到达 → `sw.ts:262` merge lastModels → 缓存 + 下发；
  2. panel 请求 list-agents 且缓存命中 → `sw.ts:230-232` 直接回 `agentsCache`（已 merge）。
  但 `agentsCache` 首次为 null 时 list-agents 走 `nmPort.send`（`sw.ts:234`）→ host 探测回 agents 帧走路径 1。**时序缝隙**：task-meta 先于首个 agents 帧到达时（探测慢），`lastModels.set`（`sw.ts:302`）已记录，但 `agentsCache` 仍 null → task-meta 分支 `sw.ts:304 if (agentsCache)` 跳过即时下发 → 稍后 agents 帧到达路径 1 merge lastModels 补上。**最终一致，无 bug**，但依赖「agents 帧一定会来」。
- **判定**：最终一致性成立，降级为 info（见 R2-info-5）。~~不计 minor~~。

> 说明：R2-m5 两次自我证伪，均降级为 info。实际 minor 计数 = R2-m1..m4 + R2-m6（下）= **5 个**，加上 arch 侧沿用未修的 m3(opencode 文档) 记为 info。修正总计：**minor 6**（含下方 R2-m6）。

### [minor] R2-m6 — `restoreSession()` 微任务与 SW 冷启动首个非-followUp 消息存在理论竞态窗

- **证据**：`sw.ts:48 void restoreSession()` 顶层异步；`handleMessage` 的 **followUp 分支**有补偿 `sw.ts:194 if (!lastSession) await restoreSession()`，但 **resume-history 分支**（`sw.ts:206`）与 **new-session 分支**（`sw.ts:217`）无此补偿。
- **触发时序**：SW 冷启动（回收后被消息唤醒）→ 顶层 `restoreSession()` 微任务尚未 resolve（storage.session.get 是异步）→ 同 tick 到达 resume-history 消息 → `lastSession = {agentId, sessionId, historyPath}`（`:207` 直接覆盖）→ 随后 restoreSession 微任务 resolve → `if (s?.lastSession) lastSession = s.lastSession`（`:54`）**用旧持久化态覆盖刚设的新会话**。
- **可达性**：resume-history 恰在 SW 冷启动同 tick 且 storage 读取未完成——极窄窗口，storage.session 通常微秒级。低频。**但 restoreSession 覆盖新态的方向是错的**（应是"仅在字段为空时恢复"，而非无条件覆盖）。
- **修法**：`restoreSession` 内改为 `lastSession ??= s.lastSession`（`sw.ts:54` 及 `:55/:56` 同）——只在内存态为空时恢复，不覆盖冷启动后已被消息设置的态。或给 resume-history/new-session 分支同 followUp 的 `await restoreSession()` 前置。推荐前者（一次性修根因）。

---

## 4. 架构最优性判断 + v2 演化余量

### 4.1 当前实现是否最优

**总体：对 v1 目标（零配置 + 深度总结质量）是"接近最优"的薄壳架构，未见过度设计，欠设计集中在 extension 状态机的测试与收敛（延续上一轮 M1/M2）。**

**做对的关键决策（复核成立）：**

- **取消分支 return 早于 exit handler 注册**（`task.ts:221` vs `:242`）：这是本轮修复里最漂亮的一处——不是靠布尔门控防双发，而是让第二条终局路径**结构上不存在**（handler 未挂）。比 doneSent/timeoutSent 门控更强。
- **UUID + wx 排他写**（`tmpfile.ts:15`）：以最小改动（改文件名 + 一个 flag）关死 symlink 预置攻击面，不引入锁/权限检查等重机制。
- **200K 字符提取上限**（`extract.ts:13`）：这一个常量同时封住了「NM 分片放大」「CLI 订阅一次烧穿」「sendChunk 二分性能」三个问题——是杠杆最高的一处设计（本轮 sendChunk 性能怀疑正是被它保护）。
- **version.ts 运行时读 package.json + 失败兜底 0.0.0**（`version.ts:7`）：失败方向安全（判过低→强制升级），优于常量+断言（沿用 arch-i3）。

**欠设计（延续，未回退，本轮未新增结构债）：**

- **任务终局语义仍三处分布**（host 5 布尔 `task.ts:63-76` / SW 8 模块变量 / panel TaskStreamState）——上一轮 arch-M1。本轮 pending/finished 已在其中，未再新增标志位，趋势暂稳，但收敛（panel reducer 抽取）仍是发布后第一个该做的 PR。
- **extension 侧仍零单测**——上一轮 arch-M2。本轮所有 App.tsx/SummarizeView 修复（finished 拒收、看门狗、followAgent 重置）**无一条单测**，全靠人肉推演。R2-m3（看门狗误判）正是这类无测试区域的新 bug。**强烈建议**：`streamReducer` 抽取 + 六个具名用例（见上一轮 arch §5），本轮又多一条用例候选：「activeId 已绑定后 120s 无内容帧但 host 存活 → 不应误判中断」（对应 R2-m3）。

### 4.2 v2 多引擎演化余量

- **arch-M3（SW 会话归属靠 currentAgentId 时序推断）本轮部分收敛**：panel 侧已改信任帧自带 agentId（`App.tsx:125 if (m.model && m.agentId)` / `App.tsx:191 task-done merge`），但 **SW 侧 lastSession 捕获仍用 `currentAgentId`**（`sw.ts:296 lastSession = {agentId: currentAgentId, ...}`）——帧自带的 `msg.agentId`（协议 `protocol.ts:206/223` 已定义、host `stdio.ts:37/44` 已发送）**未被 SW 采信**。审校串行交接窗口（A done 清 currentTask → B start 改 currentAgentId → A 迟到 task-meta/task-done）仍会把 A 会话记到 B 名下。**修法不变**：`sw.ts:296/301` 改用 `msg.agentId ?? currentAgentId`。<0.5 天，建议随 v1.x 审校第一个 PR。
- **host 零改主张仍成立**：tasks Map 多任务（`stdio.ts:20/60`）、taskId 命名临时文件（含 UUID，`tmpfile.ts:14`）、历史两任务两文件——审校串行对 host 零改。UUID 改名反而让并发多任务的临时文件冲突面更小（正向）。
- **opencode 解析器契约脏（R2-m4）**：v2 多引擎前应清理，避免"result 多发"在真并发下与 finished 门控的交互变复杂。

---

## 5. Findings 汇总表

| # | 级别 | 摘要 | 证据锚点 | 状态 |
|---|---|---|---|---|
| — | — | **本轮 9 项修复全部验证闭合、无回归、无双终局帧** | §2 | ✅ 已闭合 |
| R2-m1 | minor | `nmPort.send` postMessage 无 try/catch，host 断连瞬间抛未捕获异常；currentTask 可能残留不清 | nmport.ts:78 | 新发现 |
| R2-m2 | minor | codex 完成后「继续追问」必得 session-lost，无自动降级（上一轮 impl-m5 未修） | SummarizeView.tsx:112, sw.ts:195, codex.ts | 遗留未修 |
| R2-m3 | minor | 120s 看门狗依赖内容帧刷新，heartbeat 不转发 panel，CLI 长静默思考期误判连接中断 | App.tsx:74-93, sw.ts:278 | 新发现 |
| R2-m4 | minor | opencode 解析器 errored 置位后每行重复 push result（finished 门控兜住不炸，但契约脏，v2 隐患） | opencode.ts:38 | 新发现 |
| R2-m5 | minor | 两次自我证伪，降级 info（见 i4/i5） | — | 撤销 |
| R2-m6 | minor | restoreSession 微任务无条件覆盖，与 resume-history/new-session 冷启动同 tick 有理论竞态；应改 `??=` | sw.ts:54, sw.ts:206/217 | 新发现 |
| R2-info-1 | info | HC6 opencode 三家漂移仍未裁决（DECISIONS vs registry.ts:13） | registry.ts:13 | 沿用 arch-m3 |
| R2-info-2 | info | arch-M1（终局语义三处分布）本轮未新增标志位，趋势稳；panel reducer 抽取仍为发布后首个 PR | task.ts:63-76 | 沿用 arch-M1 |
| R2-info-3 | info | extension 侧仍零单测；本轮所有 panel 修复无回归网（R2-m3 即此区域新 bug） | 无 vitest include | 沿用 arch-M2 |
| R2-info-4 | info | resume 轮不走 buildPrompt，`约 undefined tokens` 不可达；startFollowUp 显式给 approxTokens:0，契约安全 | task.ts:191, sw.ts:328 | 证伪 |
| R2-info-5 | info | agents 帧 merge/取代 与 list-agents 缓存路径最终一致（依赖 agents 帧必到），无 bug | sw.ts:262/230/304 | 证伪 |
| R2-info-6 | info | arch-M3 会话归属：panel 侧已信任帧 agentId，SW 侧 lastSession 仍用 currentAgentId（`sw.ts:296`），v2 审校窗口仍会错记，修法不变 | sw.ts:296 vs stdio.ts:37 | 沿用 arch-M3 |

（info 编号跳到 6 是为对齐 arch-M3 追踪；实际 info 计 5 项 + M3 演化追踪。）

---

## 6. 结论

**GO（0 blocker / 0 major 新发现）。** 本轮基于两份 review 的 9 项修复经逐项穷举验证**全部真正闭合原 finding，未引入任何新的双终局帧/竞态回归**——尤其 spawn 窗口取消的 `onError('cancelled')` 修复在结构上（return 早于 exit handler 注册）比布尔门控更彻底；tmpfile UUID+wx 以最小改动关死 symlink 预置面且不破坏 codex/opencode 的文件名依赖；sendChunk 的 JSON.stringify 二分被 200K 提取上限保护，无性能问题。

新发现集中在 minor 层：**R2-m3（看门狗误判 CLI 长静默为断连，中频且用户可见）** 是体验影响最大的一个，**R2-m2（codex 追问必 session-lost）** 是 codex 用户每次必现的误导，**R2-m1（send 无 try/catch）** 是健壮性缺口。三者均非发布阻塞，但 R2-m2/m3 建议随下个 patch 修（各一行到数行）。

架构层无回退：终局语义三处分布（arch-M1）本轮未恶化，extension 零单测（arch-M2）仍是最大质量债——R2-m3 正是该无测试区域冒出的新 bug，再次印证「测试分布应随 bug 分布迁移到 panel」。v2 审校模式的 host 零改主张仍成立，唯一需先动的仍是 SW 侧会话归属采信帧 agentId（arch-M3，`sw.ts:296`，<0.5 天）。
