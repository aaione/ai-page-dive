# r46 产品+代码评审报告（对抗验证确认版）

- 日期：2026-09-23
- 范围：sidepanel（App.tsx / SummarizeView.tsx）、background（sw.ts）、host（task.ts / nm.ts / stdio.ts）
- 方法：初审 findings 全部经对抗验证（verifyReason 证实，个别含场景修正注记）
- 计数：**critical 0 / high 0 / medium 7 / low 9，共 16 条**（产品侧 7、代码侧 9）

---

## 一、产品侧（product-ux / product-resilience）

### P1【medium】受限页（chrome:// 等）发送按钮已禁用，但键盘 Enter 仍可发出总结请求

- **位置**：`apps/extension/src/sidepanel/SummarizeView.tsx:947`（按钮 disabled 在 :962）
- **证据**：发送按钮 disabled 条件含 pageUnsupported（:962 `disabled={pageUnsupported || ...}`），r44-audit F4 注释宣称「输入区联动置灰，防御前移」。但 textarea 的 onKeyDown 分支（:947）只判 `if (usableCount || input.trim() || attachCount)`，无 pageUnsupported 检查——用户在 chrome:// 页输入文字后按 Enter 即触发 onStart()，请求发往 SW 后才收到 'unsupported-page' 错误气泡（App.tsx:587）。send() 守卫（:247）同样全函数无 pageUnsupported 检查。按钮禁用的防御被键盘路径完全绕过，同一状态两个入口行为不一致（refillOnFailure 会回填文本，但错误气泡+请求已发出的体验割裂属实）。
- **建议**：在 onKeyDown 的发送分支与 send() 首行统一补 `!pageUnsupported` 守卫（与按钮 disabled 同条件），或复用 running 分支的轻提示模式给「此页面无法提取」即时反馈，让键盘与鼠标路径一致。

### P2【medium】看门狗判死 / host 断连终局只回填文本，附件永久丢失

- **位置**：`apps/extension/src/sidepanel/App.tsx:182`（__host-disconnected 在 :545 附近）
- **证据**：send() 发送后即 `setAttachments([])`（SummarizeView.tsx:267），SW send 回调失败路径由 refillOnFailure（SummarizeView.tsx:233-241）同时回填文本与附件。但 App.tsx 的看门狗判死（:182 `...(lastUser?.text ? { refill: ... } : {})`）和 __host-disconnected（:545 同款）两条终局路径只回填 `lastUser.text`——refill 结构只有 text 字段，附件不在其中。更实锤的是附件-only 轮：bubbleText 计算为空串（SummarizeView.tsx:259，附件存在时 `text || ''`），`lastUser.text` 为 falsy，连文本回填也被条件抹掉——用户面对错误气泡+完全空白的输入区，附件既不在输入区也不在 refill 里。
- **建议**：将附件纳入 refill 结构（如 refill.attachments），或在 beginTurn 时暂存本轮附件快照，终局异常时与文本一并还原到输入区（chips 状态），对齐 SW 回调失败路径已兑现的「可改后重发」承诺。

### P3【medium】task-done is_error 终局不回填输入框，与 task-error/断连/看门狗路径不一致

- **位置**：`apps/extension/src/sidepanel/App.tsx:440`（task-done 分支 L430-454）
- **证据**：task-error 分支（L499-510，注释明言 r33-ux「失败终局回填本轮问题」）、看门狗（L182）、__host-disconnected（L545）三处均回填 lastUser，但 task-done 的 is_error 路径（L440-453）只置 error/isError/cliFault，无 refill。claude 的运行内失败打在 stdout is_error（项目硬约束 #4 明示不能只看退出码），这正是 task-done is_error 的主场景——用户重试需对着气泡手抄。
- **建议**：task-done 分支 isError 时复用 task-error 的 refill 逻辑：lastUser 存在且 is_error 时追加 `refill: { n: (s.refill?.n ?? 0)+1, text }`。

### P4【low】零可用 CLI 时键盘 Enter 仍可发出注定失败的总结

- **位置**：`apps/extension/src/sidepanel/SummarizeView.tsx:247`（onKeyDown :947、按钮 disabled :962）
- **证据**：send() 守卫 `(!text && !attachments.length && !usable.length)` 与按钮 disabled 都只拦「空输入 + 无 CLI」；用户在未装任何 CLI 时输入任意文字按 Enter（:947 `input.trim()` 为真即放行），effectiveAgent 回退 'claude'（App.tsx:728-731 `|| 'claude'`）照发 summarize，最终吃到 spawn-fail 错误。Placeholder 的安装指引此刻已被用户气泡/错误气泡顶掉，新用户首次尝试即走弯路。属体验/引导断裂而非功能错误，low 定级合理。
- **建议**：usable.length === 0 时无论输入是否有内容都拦截发送（或 Enter 时置灰并轻提示「先安装/启用一个 CLI」），把 Placeholder 的安装+重试检测引导保持在屏。

### P5【low】SW 回收后 target 丢失，pageMeta 归零、tips 条与 pageUnsupported 判定退化

- **位置**：`apps/extension/src/background/sw.ts:92`（persistSession L60-64、pageMeta L613-618）
- **证据**：persistSession 持久化 sessions/panelTabId/lastModels 等，但不含 target（L92 纯内存变量）。SW 30s 回收后 restoreSession 只恢复锚定态；pageMeta() 依赖 target?.url 否则返回 null。panel-ready 的 fallback（L305-324）只在「当前活跃普通页」时补 target。验证注记：场景比初审描述窄——面板重开常见路径（切回锚 tab 触发 remount→panel-ready→活跃页即锚页）会经 fallback 自愈；真实退化窗口是 SW 在面板空闲时被回收后锚 tab 内导航——onUpdated（L254 `target?.id === tabId`）失配致 meta 刷新失效（tips 陈旧），及重开瞬间活跃页非普通页的窄场景。低危定级恰当。
- **建议**：将 target 的 `{id,url,title,favIconUrl}` 最小快照随 persistSession 一起写入 storage.session，restoreSession 时用 tabs.get 校验存活后恢复。

### P6【low】面板重开的历史还原 5s 兜底过短，慢 spawn 时迟到 history-file 帧被丢弃

- **位置**：`apps/extension/src/sidepanel/App.tsx:248`（迟到帧丢弃在 :322）
- **证据**：restorePathRef 设路径后发 history-read，5s 后无回帧即清 restorePathRef 并降级 reopened 提示（「此前对话已清空」）。但 history-read 走 nm 转发（sw.ts:419）——host 若刚死/NM 断连，nmPort 重 spawn node 冷启动可达数秒（nmport.ts:45 注释自证「node 冷启动可慢，默认 8s」），>5s 后迟到的 history-file 帧因 `m.path !== restorePathRef.current`（L322，已置 null）被丢弃且无重试。对话数据仍在磁盘，但重开面板的用户被误告知「已清空」，体验上等同丢失。
- **建议**：兜底延长至 10-15s，或在超时降级前通过 panel-ready 探测 host 就绪状态决定是否再等一轮；降级文案引导「到历史中查看完整对话」。

### P7【low】codex（无 sessionId）会话在面板收起/重开后 React 态全丢，且无自动还原路径

- **位置**：`apps/extension/src/background/sw.ts:522`（sessions.set 条件在 :517）
- **证据**：`if (msg.sessionId && owner)` 才 sessions.set（L517-522）——codex 不产 sessionId（App.tsx:435 注释「codex 无 → resumable 保持 false」），tab 永无 Session 记录；restoreSession（L74）亦要求 `v?.sessionId` 才恢复。面板切 tab 被收起（React 态丢）再重开：panel-ready 无 hasSession/historyPath（L337、L348-356 全依赖 sessions 表），r14 的 history-read 还原整个被跳过，对话只剩手动进「历史」→继续对话的冷路径。对比 claude 同场景自动还原完整多轮，codex 用户感知为「内容消失」。
- **建议**：对无 sessionId 的 CLI 也归档 `{agentId, sessionId:'', historyPath}`（恢复时 resumable=false 但 historyPath 可用于 r14 还原）；或 panel-ready 在无 session 时也尝试读最近一份本 tab 的历史文件。

---

## 二、代码侧（code-sw / code-panel / code-host）

### C1【medium】onRemoved 清理 sessions/disabledTabs 后未持久化，被 onActivated 的 restoreSession 复活（清理失效 + 无界增长）

- **位置**：`apps/extension/src/background/sw.ts:262`
- **证据**：onRemoved 里 `sessions.delete(tabId)` 和 `disabledTabs.delete(tabId)`（L262-263）只改内存，未调 persistSession（persistSession 只在 L279 锚关闭分支里调用）。而非锚 tab 关闭后，下一次任意 tab 切换触发 onActivated 的 `await restoreSession()`（L221），L74 sessions 恢复虽受 !sessionTouched 约束但 onRemoved 不设 sessionTouched（L52-55：只有 summarize/resume-history/new-session 触发），L82 disabledTabs 恢复完全无守卫——已删条目被旧持久化态灌回，且后续任意 persistSession（如 L188/L523）把死条目重新写回 storage，L43「tab 关闭即清理」意图被击穿，sessions/disabledTabs 实际无界（违背 L263 注释「防 Set 无界增长」意图）。验证注记：初审称 ensureTabsDisabled 会继续对死 tab id 发 setOptions 略有夸大——该函数（L162-168）只遍历 tabs.query 活 tab，但核心缺陷成立。
- **建议**：onRemoved 对非锚分支也调用 persistSession()（或在 restoreSession 灌入 disabledTabs/sessions 前过滤掉经 tabs.exists 校验过的死 id）；更根本的是锚定态恢复不应在每次 onActivated 无条件执行，只在 SW 冷启动首帧执行一次。

### C2【medium】迟到 task-meta（取消竞态窗内）会把已取消/已 new-session 清除的会话重新归档进当前锚定页签

- **位置**：`apps/extension/src/background/sw.ts:518`
- **证据**：SW 在 cancelCurrent（L425-447）先发 task-cancel 并立即 `currentTask = null`；host 侧 task.ts:295 的「取消后迟到 meta 不发」守卫只在 host 处理完 task-cancel 置 cancelled 之后生效——NM 消息序上，CLI 的 init/sessionId meta 若已先于 task-cancel 到达 host 转发管道（host 侧 stdio.ts:50 task-meta 帧恒带 agentId，只要 meta 事件在 host 处理 task-cancel 前被解析转发即达 SW），仍会送达 SW。此时 SW 侧 currentTask 已 null，L513-525 走兜底路径：owner=msg.agentId、tabId 落到 panelTabId（L518）→ sessions.set + persistSession。「新对话」（L395-401 刚 delete）后被迟到 meta 重新归档，sessionTouched 只挡 restoreSession 不挡本路径（L399 注释范围自认）。后果：面板重开（panel-ready L337 读 sessions.get(panelTabId)）显示 hasSession + historyPath，用户「新对话」后输入被引回已取消的半截 CLI 会话，违背 new-session 语义。
- **建议**：在 task-meta/task-done 归档分支记录「已取消 taskId 集合」（或至少最近一个被 cancel 的 taskId），迟到帧 taskId 命中则跳过 sessions.set；或归档兜底分支加 sessionTouched 时间窗校验。

### C3【medium】运行中切到受限页后停止按钮被禁用，无法取消在跑任务

- **位置**：`apps/extension/src/sidepanel/SummarizeView.tsx:962`
- **证据**：发送/停止复合按钮 `disabled={pageUnsupported || (!running && !input.trim() && !attachCount)}`。pageUnsupported 随 page-meta 广播实时更新（App.tsx:307-312）：任务运行中用户把当前 tab 导航到 chrome:// 等受限页，pageUnsupported 翻 true，此时 running=true 但按钮被 disabled——textarea Enter 在 running 态只弹 enterHint 不取消（SummarizeView.tsx:939-945），非破坏性停止入口确实丢失，任务只能烧到看门狗 120s 或自然结束。验证注记：初审「唯一的取消入口失效」略过头——「新对话」两步确认后发 new-session，SW 侧 cancelCurrent()（sw.ts:395-401）也会取消在跑任务，但那是破坏性路径（清空全部对话），核心 bug 成立。
- **建议**：disabled 条件改为 `(!running && (pageUnsupported || (!usableCount && !input.trim() && !attachCount)))`——pageUnsupported 只应禁发送态，不得禁停止态。

### C4【medium】重开面板的 history-file 还原帧可覆盖用户刚发出的新轮，丢用户气泡与任务绑定

- **位置**：`apps/extension/src/sidepanel/App.tsx:322`
- **证据**：panel-ready 触发 history-read 后（App.tsx:243-253），restorePathRef.current===hp 期间（≤5s），面板 resumable 尚为 false → hasSession=false，输入框可用，用户 Enter 走首轮 summarize 分支：beginTurn（App.tsx:631-642）已插入用户气泡并置 pending=true（新任务已在 SW 启动）。此时 history-file 回帧到达，App.tsx:322 守卫只查 `m.path !== restorePathRef.current`（restore 仍在途，通过），App.tsx:327-333 `setStream((s) => ({ ...BLANK, done: true, resumable: true, messages: msgs }))` 无 s.pending/s.taskId 在途守卫，把刚开的新一轮整体抹掉——用户的问题气泡消失、pending 绑定被清，随后迟到 chunk 只能靠收养逻辑凭空重建 assistant 气泡（App.tsx:379-382），本轮提问上下文丢失。restorePathRef 仅由该帧自身或 5s 兜底 timer 清除，beginTurn 不清它；竞态链路在代码层完整可复现。
- **建议**：history-file 分支加在途守卫：`if (s.pending || s.taskId !== null) { restorePathRef.current = null; return s }`——还原让位给用户已主动开始的新轮，或改为把还原内容 merge 进现有 messages 而非整体 BLANK。

### C5【low】pageUnsupported 不拦 send()/Enter 路径，受限页仍可发出必败请求（代码维度重复确认）

- **位置**：`apps/extension/src/sidepanel/SummarizeView.tsx:247`
- **证据**：send() 守卫（:247）与 Enter 守卫（:947-950）均无 pageUnsupported 拦截，按钮 disabled（:962）却有——两路径行为不一致；textarea 永不 disabled（:952-953 注释明言 r7-ux 放开），placeholder 承诺「切换到普通网页后可用」（:954）却可 Enter 发出必败请求，靠 SW 异步报 unsupported-page（App.tsx:587）兜底。usable.length===0 且有 text 时同样放行（effectiveAgent 兜底 'claude'，App.tsx:729），也依赖 SW 异步报错。与产品侧 P1 同根，代码维度补记。
- **建议**：send() 首行与 Enter 守卫统一加 `pageUnsupported` 拦截（或给 attachNotice 同款即时提示）；usable 为空时也应在 UI 前置拦截而非依赖 SW 异步报错。

### C6【low】「新对话」两步确认仅靠 title/aria-label 变化，读屏器零播报

- **位置**：`apps/extension/src/sidepanel/SummarizeView.tsx:393`
- **证据**：running 态下 handleNewChat 首次点击只置 confirmNew=true（:378-385），按钮只有 title/aria-label 变化（:394-395）与可见文案「确认结束？」（:402）。读屏器普遍不自动播报已聚焦按钮的 accessible name 变化，SR 用户首击零反馈、3.5s 窗口（:375）内需再按才生效，很可能误以为按钮失效。同文件错误/完成态均有 role=alert/status 播报（:454、:458、:696、:711），此处确缺，与 r31-a11y 自身标准不一致。
- **建议**：confirmNew 翻 true 时渲染一条视觉隐藏的 `role="status"`（如「再次点击以确认结束当前对话」），与 r31-a11y 的 sr-only status 区同谱。

### C7【low】spawn 成功后的 'error' 事件路径缺少清理对称（cleanupCwd / clearTimeout 均未调用）

- **位置**：`packages/host/src/task.ts:278`
- **证据**：run() 在 spawnCli resolve 后注册的 `child.on('error')` 只做 `this.finished = true; resolve(); this.cb.onError('spawn-fail', 'child runtime error')`。ENOENT 等 spawn 失败的 'error' 事件是异步派发的——spawnCli 内部 IIFE 在 attach 监听后同步 resolve（spawn.ts:105），'error' 在下一个 macrotask 才触发，所以这条路径正是「CLI 不存在」的常见失败入口（task.ts:236 try/catch 只能捕获同步 throw）。对比所有其他终局路径——isError（:324-326）、timeout（:264）、cancel-post-spawn（:247）、finish（:397-398）——都执行了 clearTimeout + cleanupCwd，唯独此路径两者皆缺：(1) :252 已设置的 10min timeoutTimer 滞留（有 finished 守卫自无害）；(2) mkdtemp 临时 cwd（filePathInPrompt 型 agent）永久泄漏——tmpfile.ts 的 sweep 只清 trustedDir 内文件，tmpdir/pagedive-XXXX（spawn.ts:35）不在清扫范围。当前实际影响限于 opencode（已下架、claude/codex 用 stableCwd），low 定级恰当。
- **建议**：error 处理分支补 `clearTimeout(this.timeoutTimer)` 与 `this.cleanupCwd()`，与 :245-250 cancel 窗口路径的对称清理对齐；错误信息可透传 stderrTail 保留排障线索。

### C8【low】writeFrame 忽略 sock.write() 的背压返回值，stdout 无 drain 处理

- **位置**：`packages/host/src/nm.ts:21`
- **证据**：`sock.write(encodeFrame(obj))` 丢弃返回值。Chrome 侧 NM 管道消费变慢（面板重渲染、浏览器进程繁忙）时，Node 会在 stdout Writable 的内部缓冲无界堆积帧数据——长回答数十个 512KB chunk 可瞬时堆出数十 MB 内存。且 writeFrame 的同步 throw 只覆盖「单帧超限」；异步 EPIPE 走 stream 'error' 事件，runNative（stdio.ts:186-243）对 process.stdout 无显式监听，最终落入 stdio.ts:235-238 的 uncaughtException 兜底（能 shutdown 但绕过 r5-sec 专门设计的 onDesync 语义）。
- **建议**：记录 write 返回 false 状态并在 true 恢复前暂停上游派发（或至少统计欠载字节打点告警）；对 process.stdout 补 'error' 监听将 EPIPE 归入 shutdown 路径。

### C9【low】onDone 的 errorText 未做帧大小约束，>1MB 时终局帧被静默丢弃、面板永久 running

- **位置**：`packages/host/src/task.ts:331`
- **证据**：chunk 正文有字节级分片（sendChunk，:369-384：JSON 序列化后 ≤MAX_CHUNK 逐片切割、seq 连续），但 isError 路径的 `errorText: ev.text`（claude result 的 is_error 文本，:334）无任何上限直接进帧；nm.ts encodeFrame 对 4+body > 1MB 会 throw（nm.ts:12-14），而 runNative 的 send 只 catch 打日志（stdio.ts:188-196）不降级重发——一旦 errorText 超限，task-done 终局帧丢失、任务已从 tasks Map 删除（stdio.ts:57 先 delete 后 send），面板侧该任务永久停留 running 态，只能靠后续 SW 空闲断连自愈。历史读取路径（stdio.ts:112-122）对同类问题做了完整截断处理，此处是不对称缺口。
- **建议**：errorText 落帧前按 JSON 字节截断（复用 sendChunk 的测量逻辑或 stderrTail 的 slice(-500) 惯例），保证终局帧恒可编码。

---

## 三、Top 5 修复优先级

1. **C4 history-file 还原帧覆盖新轮**（App.tsx:322）——直接丢用户刚发出的提问气泡+任务绑定，数据可见丢失，一行在途守卫即可修：`if (s.pending || s.taskId !== null) { restorePathRef.current = null; return s }`。
2. **C3 运行中停止按钮被禁用**（SummarizeView.tsx:962）——受限页导航后非破坏性取消入口全失，任务被迫烧满 120s 看门狗；disabled 条件改一个括号分组即可。
3. **P1/C5 受限页键盘 Enter 绕过 + 零 CLI 放行**（SummarizeView.tsx:247/947）——同一处守卫统一补 `pageUnsupported` 与 `usable.length===0` 前置拦截，一次修复消掉两条 finding，消除「按钮禁用但键盘照发」的入口不一致。
4. **C2 迟到 task-meta 复活已取消会话**（sw.ts:518）——违背 new-session 语义且用户无感知，后续输入被引回半截旧 CLI 会话；记录已取消 taskId 集合即可精准拦截。
5. **P2+P3 失败终局回填不对称**（App.tsx:182/440/545）——看门狗/断连/task-done is_error 三条路径统一 refill（text + attachments），对齐 SW 回调失败路径已兑现的「可改后重发」承诺，一次重构覆盖三条 finding。

---

## 附：严重度分布

| 严重度 | 产品侧 | 代码侧 | 合计 |
|---|---|---|---|
| critical | 0 | 0 | 0 |
| high | 0 | 0 | 0 |
| medium | 3 | 4 | 7 |
| low | 4 | 5 | 9 |
| **合计** | **7** | **9** | **16** |
