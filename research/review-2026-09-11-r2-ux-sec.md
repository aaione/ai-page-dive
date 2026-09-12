# PageDive R2 产品交互 + 安全严苛 Review（2026-09-11 第二轮）

- 审查对象：主 agent 修复 F1/F2/F3/F5/F6/F7/F9/F10/F13/F14 + sec-M1/M2/I1/I2 之后的工作树
- 审查人角色：资深产品交互设计师 + 安全工程师 + CWS 发布顾问（默认怀疑一切）
- 方法：逐文件行级走读（App / SummarizeView / Onboarding / HistoryView / Settings + sw.ts + host: task/tmpfile/install/stdio/history/agents 全解析器）+ 帧时序穷举（reading/spawned/thinking/streaming/done/error/cancelled）+ heartbeat/thinking 帧全链路追踪 + 每个 finding 附 file:line 与触发路径
- 改动文件核对：`apps/extension/src/sidepanel/{App,SummarizeView,HistoryView,Settings,Onboarding}.tsx`、`background/sw.ts`、`packages/host/src/{task,tmpfile,install}.ts`

---

## Verdict

**NO-GO（1 blocker）。** 本轮修复大部分成立，但 **F3 看门狗（120s）会误杀 codex 的正常长任务**——这是修复自身引入的、用户高频可感知的新缺陷，且恰好命中 v1 双主力之一的 codex + 最高优先级的「深度研读」场景。清掉这 1 个 blocker（把看门狗从「盯 panel 帧」改为「盯 host 存活/heartbeat」）后可转 GO。

| 级别 | 计数 |
|---|---|
| blocker | 1（R2-B1 看门狗误杀 codex 长任务） |
| major | 2（R2-M1 followAgent 指纹碰撞残窗、R2-M2 新建模式空正文可落盘 shadow） |
| minor | 5 |
| info | 4 |

安全面：本轮 4 个安全修复（sec-M1/M2/I1/I2）**全部验证闭合**，无新增安全 blocker/major；新发现均为交互层。

---

## 一、硬约束 / 承诺符合性（复核仍在位）

| 约束 | 状态 | 证据 |
|---|---|---|
| 权限四件套 + storage，无 `<all_urls>` | ✅ | manifest 无 host_permissions（上轮 sec review 实测）；本轮改动未新增权限 |
| CLI prompt/正文走 stdin，正文写临时文件 | ✅ | `task.ts:198-208` spawnCli `stdinData: prompt`；正文 `writeContentFile`（tmpfile.ts） |
| 零凭证接触 / 零外联 | ✅ | 全仓 src 无 fetch/WebSocket（上轮实测）；本轮改动零网络行为 |
| claude 运行内失败判 stdout | ✅ | `task.ts:285` result.isError → onDone(isError) |
| host 薄壳 pgid 收割 | ✅ | 本轮 task/stdio 改动未破坏收割链 |
| 历史落盘路径规范 | ✅ | `history.ts:66-75` buildHistoryPath 年/月/日/时间戳-slug |

---

## 二、本轮修复逐项验证

### F1 followAgent 跨会话不重置 — ✅ **主链闭合，残 1 处碰撞窗（见 R2-M1）**

- 修法证据：`SummarizeView.tsx:99-106`（以 `firstMsgId = stream.messages[0]?.id` 为会话指纹，变化即 `setFollowAgent(null)`）+ `:186`（newChat 显式 `setFollowAgent(null)` 双保险）+ `sw.ts:198`（首轮 followUp 返回带 `agentId`，SummarizeView.tsx:142 `setFollowAgent(resp.agentId)`）。
- 正向验证：claude 追问 →「新对话」→ beginSession 置 BLANK（messages=[]，firstMsgId=''）→ 选 codex 首轮 → beginTurn 首条 `u{Date.now()}`（id 变）→ effect 重置 followAgent=null → 下拉/头部走 effectiveAgent=codex。✅ 与原 finding 描述的错误路径已断。
- 历史恢复路径：resumeHistory 置 BLANK + 新 messages（App.tsx:285-292，首条 id=`h0` 或 `h{item.ts}`），firstMsgId 变 → 重置；App 另写 `setAgentId(item.agent)`。✅
- **残留**：`firstMsgId` 作指纹在「两次历史恢复首条 id 都为 `h0`」时不变，effect 不触发（见 R2-M1）。newChat 有显式重置兜底，但 resume→resume 无显式重置，仅靠指纹。

### F2 Settings 空正文 shadow 掉真实模式 — ✅ **已有模式闭合，新建模式未覆盖（见 R2-M2）**

- 修法证据：`Settings.tsx:194-198`——`editor.originalName && !editor.body.trim()` 时拒绝保存 + 提示「正文为空或尚未加载完成」。
- 正向验证：选中已有模式 → workflow-file 未到达（body='')→ 改描述触发 dirty → 点保存 → 命中守卫拒绝落盘。✅ 原「空正文 shadow」路径封死。
- 「合法清空正文」是否误伤：对 workflow 而言空正文 = 空任务指令（`task.ts:513` `workflowBody ?? DEFAULT_TASKS[...]`，空串 `''` 是 falsy 会 fallback 到 DEFAULT_TASKS——但用户副本一旦存在，`getWorkflow` 命中用户空副本，body='' 直接进 prompt 任务段）。故拒绝空正文是**正确保护**，非误伤。
- **未覆盖**：新建模式 `originalName===null`（newWorkflow，Settings.tsx:173），守卫不生效，可保存空 body（见 R2-M2）。

### F3 SW 死亡看门狗 120s — ❌ **修复引入 blocker（见 R2-B1）**

- 修法证据：`App.tsx:74-93`——`running` 时启 120s timer，`[running, stream]` 依赖：running 期任一帧改 `stream` 即清并重启 timer；120s 无帧仍 running → 收尾 streaming 气泡 + 解锁 + 错误气泡「连接中断」。
- **原意图达成**：SW 真死时（NM port 消亡、无任何帧）120s 后确实解锁，逃生。✅ 这一半对。
- **致命反作用**：panel 重置计时器**只认进 panel 的帧**（task-chunk / task-status / task-meta 会 setStream）。而 `heartbeat` 帧被 `sw.ts:279` 拦截 `if (msg?.t === 'heartbeat') return` **不转发 panel**，无法重置计时器。于是「host 活着、任务正常跑、但 120s 内没有 chunk/status 帧」= 被误判为死亡（见 R2-B1 完整推演）。

### F5 HistoryView 搜索态删除后重置 — ✅ 成立

- `HistoryView.tsx:20-21` query 入 `queryRef`，`:48` refresh 默认参 `queryRef.current`；`:41` deleted/delete-fail 触发 `refresh()` 保住搜索词。✅

### F6 session-lost 文案 — ✅ 成立

- `App.tsx:249` 改为「请点『新对话』后重新发送本次问题」，不再承诺「本次将开始全新总结」的空动作。✅

### F7 追问轮 ModelDropdown 禁用 — ✅ 成立

- `SummarizeView.tsx:209-210` `disabled={hasSession}` + `disabledTitle="追问沿用首轮 CLI"`；`ModelDropdown` :451 `if (disabled) setOpen(false)` 收起残留菜单。✅ 假可供性消除。

### F9 HistoryView host 未连接提示 — ✅ 成立

- `HistoryView.tsx:27-33` replied/waited 双态；`:181-184` 三分支：replied→「暂无历史」/ waited(3s)→「本机组件未连接，历史暂不可读」/ 否则「加载中…」。✅

### F10 / F14 Placeholder 无 CLI 指引 / 动态渲染 — ✅ 成立

- `SummarizeView.tsx:625-636`（`!clis.length` → 「未检测到本机 AI CLI，请先安装 claude/codex」）+ `:645-650`（动态 map 实际 clis，不再硬编码 opencode）。✅

### F13 Onboarding 文案 90s vs 1 分钟 — ✅ 成立

- `Onboarding.tsx:33`（阈值 90_000）+ 文案 :67 / :111 / :119 统一为「1 分半」。✅

### sec-M1 outline 消毒 — ✅ 成立

- `task.ts:494` `sanitizeMeta(m[2].trim(), 200)`——outline 每行过控制字符/零宽/bidi 清洗 + 单行化。原「逐行铺伪造指令」旁路封死。✅

### sec-M2 tmpfile 加固 — ✅ 成立（残 1 处 wx 副作用，见 R2-minor-5）

- `tmpfile.ts:13-15` `mkdir(DIR, {mode:0o700})` + 文件名 `${name}-${randomUUID()}.md` + `writeFile(..., {flag:'wx'})`。symlink 预置攻击面关死（UUID 不可预测 + wx 拒绝跟随已存在文件）。✅

### sec-I1 install ext-id 校验 — ✅ 成立

- `install.ts:82` `/^[a-p]{32}$/` 校验，非法 id 跳过并提示，不再污染 allowed_origins。✅

### sec-I2 buildPrompt fallback 消毒 — ✅ 成立

- `task.ts:518` `sanitizeMeta(workflow, 64)`——workflow 名进 fallback 文本前消毒。✅

---

## 三、新 Findings

### [blocker] R2-B1 — F3 看门狗误杀 codex 正常长任务（修复自身引入的高频回归）

- **证据**：
  - 看门狗仅由进 panel 的帧重置：`App.tsx:74`（`running = stream.activeId!==null || stream.pending`）+ `:92`（依赖 `[running, stream]`，只有 `setStream` 才重置 timer）。
  - `heartbeat` 帧不进 panel：`sw.ts:279` `if (msg?.t === 'heartbeat') return`——host 每 20s 的保活帧（`stdio.ts:191-194`）到 SW 即被吞，**永不 setStream**。
  - codex 帧序列在思考+生成期**完全静默**：`codex.ts:25-27`（仅 `thread.started` 发一次 `thinking`）→ `:28-31`（正文是 `item.completed` 的 `agent_message`，**整段一次性**作为单条 text-delta，codex exec `--json` 无 token 级增量）→ `:33` `turn.completed`。即 panel 侧只会收到：`task-status(reading)` → `task-status(thinking)` → 【长静默】→ `task-chunk(全文)` → `task-done`。
- **触发路径（高频）**：
  1. 用户对一篇长文档选 codex + 「深度研读」（`DEFAULT_TASKS.deep`，task.ts:560，要求通读全文出结构化报告）→ 点总结。
  2. SW 发 reading 占位帧 → host spawn codex → parser 首行 `thread.started` 发 thinking 帧（此时最后一次 setStream，timer 重启）。
  3. codex 读 200K 正文 + 生成深度报告，思考+生成耗时 **> 120s**（长文档下极常见，实测 deep 模式分钟级）。这期间 codex 无任何中间 JSONL 事件 → host 无 chunk/status 帧 → panel 无 setStream → **120s 到点看门狗触发**。
  4. 看门狗把仍在跑的真任务收尾：streaming 气泡强制 `streaming:false`、`activeId:null`、追加错误气泡「连接中断（扩展服务可能已被浏览器回收）——请点『新对话』或重试」（App.tsx:87），输入框解锁。
  5. 数秒后 codex 真出全文：`task-chunk(全文)` 到达 → 但 App.tsx:133 `finished` 尚未记录该 taskId（看门狗分支没写 finished），`taskId` 已被看门狗置 null → 首帧绑定重开一个 streaming 气泡 → 紧接 `task-done` 定稿。**结果：用户先看到「连接中断」错误气泡，几秒后又冒出正常总结**——UI 自相矛盾、误导「产品坏了」，且用户可能已点「新对话」（sw.ts new-session 会 cancelCurrent 杀掉真在跑的 codex，白烧订阅额度 + 丢结果）。
- **为什么是 blocker**：① 命中 v1 双主力之一（codex）× 最高优先级场景（深度研读长文）= 高频；② 表现为「正常任务被判死 + 矛盾 UI」，比修复前「SW 真死锁死」更频繁地伤害正常用户；③ claude 侧因 `--include-partial-messages` 生成期有密集 text_delta（claude.ts:28）通常能持续重置，风险低——但 claude 的**纯思考期/工具轮**若 >120s 无 text/thinking delta 同样中招（低频但存在）。
- **修法（择一，推荐前者）**：
  1. **看门狗改盯 host 存活而非 panel 帧**：让 heartbeat 透传 panel（或 SW 收到 heartbeat 时给 panel 补发一个轻量 `task-alive` 帧），panel 收到即重置 timer。host 活着就有 20s 心跳，120s（=6 个心跳）无心跳才是真死。这是语义正确的修法——看门狗要检测的是「SW/host 死」，heartbeat 正是「host 活」的信号，把它挡在 panel 外再拿「无帧」判死是自相矛盾。
  2. 若坚持不透传 heartbeat：看门狗触发前先向 SW 发一个同步探活（`chrome.runtime.sendMessage({t:'ping-task'})`），SW currentTask 非空则回 ok → 续命；仅 SW 无响应/无 currentTask 才判死。
  3. 兜底加固（无论选哪个）：看门狗触发分支应把当前 taskId 记入 `finished`（App.tsx:87 附近），否则真任务的迟到 chunk 会重开矛盾气泡。

### [major] R2-M1 — followAgent 指纹 `firstMsgId` 在 resume→resume 同首条 id 时不重置

- **证据**：`SummarizeView.tsx:99`（`firstMsgId = stream.messages[0]?.id ?? ''`）作为会话切换指纹；resumeHistory 生成首条 id 为 `h0`（App.tsx:380 parseHistoryTurns 首段固定 `id:'h0'`）或空正文历史的 `h{item.ts}`（App.tsx:292）。
- **触发路径**：会话 A（claude）→ 追问（followAgent='claude'）→ 打开历史，恢复历史条目 X（agent=codex，有多轮正文，首条 id='h0'）→ 由于从 A 的 followAgent 状态切来，firstMsgId 从 A 的 `u...`/`h...` 变为 `h0`（变化 → 触发重置 ✅）。**但**：紧接着不返回、再从历史恢复条目 Y（agent=claude，同样首条 id='h0'）→ firstMsgId 仍为 `h0`（**不变** → effect 不触发）→ followAgent 残留上一恢复态；若此时对 Y 追问完成，头部显示的 CLI 可能与 Y 的真实 agent 不符。
- **为什么 major 而非 minor**：多 CLI 用户连续从历史恢复不同 agent 的会话是既定用例（DECISIONS 审校模式 + resume-history），「显示与真实执行不符」正是 F1 要根治的信任问题，指纹碰撞让它在此路径复活。
- **修法**：resumeHistory 里让 App 显式把 agent 透传并重置 followAgent（新增 prop 或用一个每次 resume 自增的 epoch 作指纹，而非 messages[0].id）；或 parseHistoryTurns 首条 id 带上 `item.ts`/`item.path` 使其跨条目唯一（`h0` → `h{item.ts}-0`）。

### [major] R2-M2 — 新建模式（originalName=null）可保存空正文，落盘即空指令用户副本

- **证据**：`Settings.tsx:194` 空正文守卫条件为 `editor.originalName && !editor.body.trim()`——`originalName` 对新建模式恒为 `null`（newWorkflow，Settings.tsx:173），守卫短路跳过。新建时 body 有占位默认文案（Settings.tsx:179「在这里写下…」），但用户可全选删空后直接保存。
- **触发路径**：设置 → 新建模式 → 命名 `mymode` → 清空正文 textarea → 保存 → host `saveWorkflow` 落盘 `~/.ai-page-dive/workflows/mymode/WORKFLOW.md`（body=''）→ 主界面选该模式总结 → `task.ts:513` `workflowBody ?? DEFAULT_TASKS[workflow]`——但 `getWorkflow('mymode')` 命中用户副本返回 `body:''`，`workflowBody=''`（falsy）→ fallback DEFAULT_TASKS['mymode']=undefined → fallback 文案「未找到，使用默认」。即用户精心命名的模式静默退化为默认摘要，无异常提示。
- **为什么 major**：与 F2 同类的静默数据破坏（违背「深度总结质量」），F2 只堵了「已有模式」半边，新建这半边漏了；且新建是用户投入意图最高的路径。
- **修法**：空正文守卫去掉 `editor.originalName &&` 前置，改为「任何保存都要求 body.trim() 非空」（新建/已有一致）；或新建允许空但保存前 confirm 一次。

### [minor] R2-m3 — 看门狗触发后追问轮同样中招，且 hasSession 判定受污染

- **证据**：追问轮也占 running（`SummarizeView.tsx:111`），走同一看门狗。codex 追问（resume 轮无正文，纯思考+生成）静默 >120s 同样被误判。看门狗收尾把 streaming 气泡置 `streaming:false` 但**不清 error**，该气泡 `!m.error && m.text` 若 text 为空则 `canFollowUp` 不满足（SummarizeView.tsx:112），追问链在误判后可能错误回退为新总结。
- **修法**：随 R2-B1 一并解决（心跳续命后追问轮不再误判）。

### [minor] R2-m4 — 看门狗错误气泡文案把「正常慢任务」误述为「服务被回收」

- **证据**：`App.tsx:87` 文案「连接中断（扩展服务可能已被浏览器回收）」。在 R2-B1 的误触发场景里这是**事实错误**——host 活着、任务在跑，只是慢。即便修好 R2-B1，真 SW 死亡场景该文案也过于技术化（普通用户不懂「扩展服务被回收」）。
- **修法**：改为「响应超时，请重试或点『新对话』」这类不预设死因的中性文案。

### [minor] R2-m5 — tmpfile `wx` 排他写：追问轮附件文件名冲突时静默丢附件（低概率）

- **证据**：`tmpfile.ts:15` `flag:'wx'`；`task.ts:112` 附件走 `writeContentFile(\`${taskId}-att-${safe}\`, ...)`，文件名含 randomUUID（tmpfile.ts:14），碰撞不可能——**但** `materializeAttachments` 的 try/catch（task.ts:110-117）会把 wx 的 EEXIST 与写失败一起吞掉「单个失败跳过」。randomUUID 下 EEXIST 实际不会发生，故此项仅为「wx 副作用理论面」记录，非真缺陷。主任务正文文件（task.ts:144 `writeContentFile(this.taskId, ...)`）无 UUID 后缀？——核对：`writeContentFile` 内部统一追加 `-${randomUUID()}`（tmpfile.ts:14），故 taskId 相同也不会 EEXIST。✅ wx 不会误伤合法任务。
- **结论**：sec-M2 的 wx 修复**不会**让合法任务失败（randomUUID 保证唯一 + tmpfile 内部统一加后缀）。原任务要点里担心的「wx 让合法任务失败」= 排除。

### [minor] R2-m6 — 看门狗依赖 `[running, stream]`：stream 每帧变更重建 timer，长任务下高频 clearTimeout/setTimeout（轻微开销）

- **证据**：`App.tsx:92` 依赖数组含整个 `stream` 对象，每个 chunk 帧都会 setStream → 重建 120s timer。深度总结数千 chunk 下是数千次 timer 重建。功能正确（每帧重置正是意图），但可用 `stream.taskId + activeId + 一个 tick 计数` 收窄依赖降低重建频率。产品无感，记录备查。

### [minor] R2-m7 — Onboarding forbidden 态卡装文案仍说「安装完成」，与 forbidden（已装只差登记）语义不符

- **证据**：`Onboarding.tsx:110-115` stuck 文案「复制命令已超过 1 分半仍未检测到安装完成」在 forbidden=true 时也展示（stuck 与 forbidden 正交）。forbidden 场景 host 已装、只差 `ai-page-dive install --ext-id` 登记，谈「安装完成」是错框架。
- **修法**：stuck 文案按 forbidden 分支（「登记未生效，多半需完全重启 Chrome」）。

### [info] R2-i8 — running 期输入框整体禁用（F15 遗留，未在本轮范围）

- `SummarizeView.tsx:561` `disabled={running}`。深度研读分钟级期间无法预输入下一问。产品取舍，Gemini 侧栏允许预输入仅拦发送。非本轮 finding，重申。

### [info] R2-i9 — `aria-live="polite"` 仍挂消息容器（F16 遗留）

- `SummarizeView.tsx:220`。流式期每 chunk 变更刷屏读屏器。非本轮范围，重申。

### [info] R2-i10 — 看门狗 120s 与 host 心跳 20s / 任务超时 10min 三个时间常量无单一来源

- `App.tsx:75`（120s）、`stdio.ts:194`（20s heartbeat）、`task.ts:20`（10min）。三者本应协同（看门狗 > N×心跳间隔）却分散硬编码。修 R2-B1 时应显式让看门狗阈值 = k × 心跳间隔并注释关联。

### [info] R2-i11 — Settings 新建/切换丢未保存编辑无确认（F11 遗留）

- `Settings.tsx:150` selectWorkflow 直接覆盖 editor 不看 dirty。非本轮范围，重申。

---

## 四、已验证安全清单（本轮复核 PoC 未成立）

1. **outline 注入旁路（sec-M1）**：`task.ts:494` 每行 `sanitizeMeta(_, 200)`，控制字符/零宽/bidi/换行全清 + 60 行 2000 字符双截断——逐行铺伪造指令面封死。✅
2. **临时文件可预测路径（sec-M2）**：`tmpfile.ts:13-15` 0o700 目录 + randomUUID 文件名 + wx 排他写——symlink 预置攻击不可行。✅
3. **install ext-id 注入（sec-I1）**：`install.ts:82` `/^[a-p]{32}$/`，畸形 id 跳过。✅
4. **workflow 名 fallback 注入（sec-I2）**：`task.ts:518` `sanitizeMeta(workflow,64)`。✅
5. **路径穿越（history read/delete/append/reveal）**：`history.ts:28-32` `assertInRoot` resolve + `r===ROOT || startsWith(ROOT+sep)` 双条件；append/read/delete/reveal 全部前置 assert。✅
6. **workflow/skill 名校验**：`Settings.tsx:6` `WF_NAME_RE`（前端）+ host 侧 assertValidWorkflowName（上轮验证）。✅
7. **argv 注入**：spawn 数组形态无 shell；resume/路径全 host 生成（上轮验证，本轮 codex/claude buildArgs 复核无 shell 元字符面）。✅
8. **content-received 对账**：`sw.ts:282-290` 丢片即取消，半截正文不进 CLI。✅ 与看门狗独立（对账走 task-error(content-mismatch)，带 taskId，走正常终局）。
9. **heartbeat 不污染 UI**：`sw.ts:279` 拦截（e2e-runtime.mjs:169 断言 UI 无 heartbeat 字样）——安全/整洁角度正确；问题在看门狗错误依赖（R2-B1），非 heartbeat 本身。
10. **NM 帧 DoS**：`nm.ts` NM_MAX 1MB throw；分片 512KB（sw.ts:446 / task.ts:324）Blob 字节维度收缩防击穿。✅
11. **零外联**：本轮改动无网络调用。✅

---

## 五、产品交互整体优化建议（取舍层，非缺陷）

- **看门狗语义纠偏（最高优先）**：把「无 UI 帧」当死亡信号是本轮最大设计误判。正确心智模型：**host 心跳 = 心跳线**，SW 转发心跳到 panel，panel 只在「心跳线断」时判死。修 R2-B1 顺带把这条语义理顺，长任务 UX 才稳。
- **codex 长任务的进度感**：codex 全程静默到一次性出全文，用户盯着「思考中…」分钟级无进度。建议 host 在 codex 任务期把 heartbeat 透传成一个「仍在处理（已 Ns）」的 phase 更新（复用心跳，零新机制），既喂看门狗又给用户进度感——一箭双雕。
- **预输入（F15）**：长任务期允许输入框打字仅拦发送，减少「干等」——竞品通行做法，建议排期。
- **新建模式空正文（R2-M2）**与已有模式保护对齐，避免用户高投入路径静默退化。
- **历史 resume 的 agent 透传（R2-M1）**：resume 应显式携带并重置 UI 的 followAgent，而非依赖 messages[0].id 指纹的偶然唯一性。

---

## 六、Findings 汇总表

| ID | 级别 | 一句话 | 证据 | 修法 |
|---|---|---|---|---|
| R2-B1 | blocker | 看门狗误杀 codex 正常长任务（heartbeat 不进 panel，codex 思考期静默 >120s） | App.tsx:74-93 / sw.ts:279 / codex.ts:25-33 / stdio.ts:191-194 | 心跳透传 panel 续命 + 触发分支记 finished |
| R2-M1 | major | followAgent 指纹 firstMsgId 在 resume→resume 同 `h0` 首条时不重置 | SummarizeView.tsx:99 / App.tsx:292,380 | resume 显式重置 followAgent 或首条 id 带 ts |
| R2-M2 | major | 新建模式空正文可落盘，静默退化为默认摘要 | Settings.tsx:173,194 / task.ts:513 | 空正文守卫去掉 originalName 前置 |
| R2-m3 | minor | 追问轮同样被看门狗误杀 + hasSession 污染 | SummarizeView.tsx:111-112 | 随 R2-B1 解决 |
| R2-m4 | minor | 看门狗错误气泡把慢任务误述为「服务被回收」 | App.tsx:87 | 改中性「响应超时，请重试」 |
| R2-m5 | minor（排除） | wx 排他写不会误伤合法任务（randomUUID 保证唯一） | tmpfile.ts:14-15 | 无需改，记录 |
| R2-m6 | minor | 看门狗依赖整个 stream，长任务高频重建 timer | App.tsx:92 | 收窄依赖 |
| R2-m7 | minor | forbidden 态 stuck 文案仍说「安装完成」 | Onboarding.tsx:110-115 | 按 forbidden 分支文案 |
| R2-i8 | info | running 期输入框全禁用（F15 遗留） | SummarizeView.tsx:561 | 允许预输入仅拦发送 |
| R2-i9 | info | aria-live 挂消息容器刷屏读屏器（F16 遗留） | SummarizeView.tsx:220 | 阶段变化单独 polite 区 |
| R2-i10 | info | 120s/20s/10min 三常量无单一来源 | App.tsx:75 / stdio.ts:194 / task.ts:20 | 显式关联 + 注释 |
| R2-i11 | info | Settings 丢未保存编辑无确认（F11 遗留） | Settings.tsx:150 | dirty 时 confirm |

**计数**：blocker 1 / major 2 / minor 5（含 1 排除）/ info 4
