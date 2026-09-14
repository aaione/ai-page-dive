# PageDive 第五轮终局综合判决（r5-final）

- 日期：2026-09-14
- 审查对象：commit `8d5a6eb`（本地 main，测试 82/82，host 运行时 1956 行）
- 本轮定位：前四轮（~60 修复 + 5 份 r4 报告，判决 GO/条件GO）之后的最后对抗闸门
- 输入：第五轮五维度（impl / sec / ux / arch / fix-audit）交叉裁决后的 finding 组 13 条，跨维度矛盾 0 条
- 终局验证：本报告落笔前对 13 条中全部高危证据锚点做了独立源码抽查（nm.ts / spawn.ts / claude.ts / task.ts / check-host-lines.mjs / App.tsx / SummarizeView.tsx / sw.ts），逐行比对裁决组引用，**无一失实**

---

## 一、判决速览

| 维度 | 结果 |
|---|---|
| **verdict** | **条件GO** |
| blocker | 0 |
| major | 5 |
| minor | 8 |

**一句话结论**：架构与安全面已收敛（r4 全部 major 确认修复、零 blocker、硬约束七条无一违背），但本轮交叉裁决实证了 5 条 major——其中 2 条是用户可达的 **host 整进程崩溃入口**（EPIPE 未捕获 / 附件帧 >1MB 同步 throw）、1 条直接污染**默认总结路径的输出质量**（claude 解析器终答重复）、2 条是 UI 显式承诺的功能路径失效（仅附件发送任务段为空 / 模式选中却静默不套用）。5 条 major 全部修复并回归后方可发布；均为局部修复（估 1-2 天），不动架构。

**发布闸门（条件）**——按修复优先级排序：

1. **M-A / M-B（host 崩溃双入口）**：两条根因独立、互为印证 host 缺顶层异常防护，建议同批修：① spawn.ts 补 `child.stdin.on('error')`（吞 EPIPE 即可）+ host 顶层 `process.on('uncaughtException')` 兜底转 task-error；② SW 侧附件走 content 同款分片或加总量预算 + host `createFrameReader` 的 len 超限从裸 throw 改为协议错误帧。任一不修，多 panel 并发场景一个用户动作即可杀掉全部在途任务。
2. **M-C（claude prevText 终答重复）**：默认总结路径必经（buildPrompt 明示「请读取该文件全文」→ Read 工具流多 assistant 消息），直接伤 v1 第一优先级「深度总结质量」且污染历史落盘。修法：`assistant` 事件内 prevText 已重置为当条消息文本，问题在 `stream_event` 累积跨消息——按 message 边界重置（`d.type === 'assistant'` 处 prevText=text 已有，需在新的 stream_event 序列起点识别消息切换）。
3. **M-D / M-E（同点不同根，建议合并修复）**：均在 task.ts:192 一行但机制相反——M-D 空串绕过（`!instruction` falsy 判定 vs `??` 不回退空串，修法 `??`→`||` 或前置归一化）；M-E 模式静默丢弃（host 语义为既定设计，缺陷在 UI 错配：发送带问题时 UI 应明示模式不套用，或顶栏不显示已选态）。合并为一个修复单元处理 `instruction: ''` 语义与 UI 告知。

---

## 二、新 findings 逐条（13 条，交叉裁决终态）

### major（5）

#### M-A. child.stdin 无 error 监听：大 prompt + CLI 快速退出 → EPIPE → host 整进程崩溃
- **位置**：`packages/host/src/spawn.ts:60-65`（writeStdin 仅同步 try/catch），全文件无 `child.stdin.on('error')`（已独立核实 grep 为 false）；`index.ts` / `stdio.ts` / `nm.ts` / `task.ts` / `spawn.ts` 均无 `uncaughtException`（五个文件逐一核实）
- **触发路径**：用户自建 workflow/skills 拼装 prompt（硬约束 #2 下尺寸不受控）→ 超管道缓冲 → CLI 快速退出（未登录 / `--resume` 失效会话）→ stdin 异步 EPIPE → `child.on('error')`（L55，只覆盖 spawn 失败）捕不到、同步 try/catch 捕不到异步事件 → uncaughtException → host 整进程死，NM 断连、同 host 多 panel 在途任务连带死亡、落盘中断
- **裁决注**：单维度（impl）但双票验证 + dist 构建实操复现 + 触发前提由仓库自身 buildPrompt 指示造成，不降级
- **我方核验**：spawn.ts L55-66 原文与描述一致；`stdin.on('error'` 全文件不存在；五文件 `uncaughtException` 均为 false ✅

#### M-B. task-start 帧内嵌全量附件文本，无分片无总量上限 → >1MB 单帧 host 同步 throw 崩溃
- **位置**：`apps/extension/src/background/sw.ts:477`（attachments 整帧内嵌，仅 `contentMarkdown` 有 512KB 分片 L488-506，已核实）→ `packages/host/src/nm.ts:34`（`if (len > maxLength) throw` 在 stdin data 回调内同步抛出，JSON parse 有 try/catch 而长度检查没有，已核实原文）
- **触发路径**：面板 pickAttachments 单文件 ≤512KB、数量 ≤5（`SummarizeView.tsx:167` slice(0,5)）→ 3×500KB 附件即组出 ~1.5MB 帧（**全在 UI 自身放行范围内，实测复现**：3×500KB 全放行 → host 崩溃）→ `createFrameReader` 同步 throw → 未捕获 → host 死。追问路径 `sw.ts:361` 同面
- **裁决注**：单维度（sec）但实测复现成立，非提权（附件为用户自选）但必然崩溃 + 连带杀在途任务，与 M-A 互为印证 host 缺异常防护，维持 major
- **我方核验**：nm.ts L34 裸 throw 原文属实；sw.ts L477 task 对象内含 attachments、L488-506 仅 contentMarkdown 分片属实 ✅

#### M-C. claude 解析器 prevText 跨 assistant 消息不重置——工具流场景终答整段重复
- **位置**：`packages/host/src/agents/claude.ts:14`（模块级 prevText）/ L30（stream_event 累积）/ L40-46（assistant 事件 startsWith diff + `prevText = text` 重置）
- **触发路径**：buildPrompt（`task.ts:553`，已核实「请读取该文件全文后再作答」）→ claude -p 必走 Read 工具流产生多条 assistant 消息 → msg1 前言流式累积进 prevText → msg2 终答 `text.startsWith(prevText)` 因 prevText 含 msg1 前缀必然失败 → else-if 分支（L43-44）把终答全文再次作为 text-delta 推出 → panel 流式输出与 accText（历史落盘同源）终答重复两份。**双票验证 + dist 构建实操复现**
- **裁决注**：触发前提由仓库自身 prompt 指示造成，证据等级高，维持 major
- **我方核验**：claude.ts L14/L30/L40-46 结构与裁决描述完全一致；task.ts:553 指示语属实 ✅

#### M-D. 仅附件发送（输入框留空）到达 host 后「## 任务」段为空字符串
- **位置**：链路五点全部核实——`SummarizeView.tsx:143/154`（`instruction: text`，text='' 原样传）→ `sw.ts:477` 原样透传 → `task.ts:183`（`!this.input.instruction` 把 '' 当 falsy 走 wfBody 分支）→ `task.ts:192` 与 `buildPrompt:519` 的 `??` 对 ''（非 nullish）**不回退** → task = '' → prompt「## 任务」下为空，CLI 无任何指令，输出不可预期
- **可观测承诺**：发送按钮因 attachCount>0 启用 + 用户气泡「（附件：a.txt）」——UI 明示支持仅附件发送，实际路径完全失效
- **裁决注**：与 M-E 同在 task.ts:192 一行但根因相反（空串绕过回退 vs 优先级未告知），不合并定级；修法 `??`→`||` 两案同点，**建议合并修复**
- **我方核验**：task.ts L183/L185/L191-192/L518-522 原文逐行核对，`??` 链对空串的行为推演成立 ✅

#### M-E. 选中非默认模式 + 输入问题 → 模式正文静默丢弃，顶栏全程显示已选中
- **位置**：host 语义（`task.ts:183/:192`）为 instruction 优先、非默认 workflow 正文整体让位——**该语义本身是既定设计**（task.ts:507 注释明示），不按「与决策冲突」驳回；缺陷在 UI 侧错配：`SummarizeView.tsx:154` 发送同时携带 workflow+instruction，WorkflowDropdown 顶栏/下拉全程显示该模式选中勾，无「输入问题后模式不套用」提示 → 用户看到模式生效假象，实际执行等价默认模式
- **量级**：核心旅程（挑模式+提问）高频命中，直接伤 v1「深度总结质量」，维持 major
- **我方核验**：task.ts 语义原文属实；SummarizeView L154 同时携带 workflow+instruction 属实 ✅

### minor（8）

| # | 标题 | 位置 | 裁决校准 |
|---|---|---|---|
| m-1 | `__host-disconnected` 的 needBubble 漏「pending 且上一轮遗留 isError 气泡」组合：重试轮断连零反馈 | `App.tsx:293`（`s.pending && !messages.some(m=>m.isError)` 未限定当前轮；L275 task-error 终局后重试即触发） | 双维度共识确认成立；触发为低频组合且后果为单轮零反馈（输入未锁、可再发）非锁死，维持 minor。已核实 L293 原文 ✅ |
| m-2 | 内部 review 批注作为字面 prompt 文本发给 CLI（「r4-sec M1：围栏上提为模板恒定行…」） | `task.ts:544-545`（反引号模板内非注释）+ deep/paper/quick 三个内置 WORKFLOW.md 各一行括注 | 默认总结路径每次携带、CLI 侧与历史落盘可观测，非纯风格。已核实 L544-545 在模板字符串内 ✅ |
| m-3 | check-host-lines.mjs 的 cwd 用 URL.pathname：路径含空格时百分号编码 → ENOENT → pnpm test 直接崩 | `scripts/check-host-lines.mjs:9` | 空格路径实测复现（退出码 1）；仅影响非常规 checkout 路径。已核实 L9 原文 ✅ |
| m-4 | 用户主动「停止」后气泡显示「CLI 报告运行失败：已取消: task cancelled」——错误归因 + 中英混排 | host 固定回 `task-error{code:'cancelled'}`（`task.ts:132/224`）+ `App.tsx:275` 统一拼 `${ERROR_LABEL[m.code] ?? m.code}: ${m.message}` + isError 前缀 | 每次取消必现但纯文案/归因，不因必现升级。已核实 L275 原文 ✅ |
| m-5 | 设置中关闭全部 CLI 后主视图显示「未检测到本机 AI CLI——请先安装并登录」——引导方向错误 | `SummarizeView.tsx:642`（Placeholder `!clis.length` 分支）；toggleCli 无「至少保留一个」守卫 | agents prop 已有区分所需信息，minor 恰当 |
| m-6 | task-meta 是 6 个帧 handler 中唯一缺 finished/taskId 双守卫者（+host 侧 `case 'meta'` 缺 `!cancelled` 守卫） | `App.tsx:159`（对比 task-chunk L181-183 有双守卫）；host `task.ts:267` 附近 | 降级 major→minor：可触发部分影响为迟到帧致模型名误标 + 单次心跳虚刷，窗口窄后果轻；streamReducer 重构主张属维护性不定 major。**建议与 streamReducer 首个 PR 同批**（同 listener 区域）。已核实 L159 无守卫 vs L181 有 ✅ |
| m-7 | r4-arch「SW 膨胀→sessionStore 拆分」判定半准确：sessionStore 成立（v2 动工前），orchestrator 证据不足 | sw.ts 会话态 8 触点 + sessionTouched 3 处手工置 true；r2-r4 修过 ≥3 次会话串档回归 | 维护性闸门类，判定经反证校准（orchestrator 拆分被证不成立），结论克制，minor |
| m-8 | 82 用例最危险盲区：单 stdio 会话内双任务交错零测试 | `stdio.test.ts` 仅 5 例、task.test.ts 全单任务；sessionCwds/stableCwd/heartbeat 是真实共享可变面 | v1 可达窗口窄（fire-and-forget cancel 的 REAP_GRACE 交错），主要价值是 v2 前提验证，minor |

---

## 三、跨维度矛盾裁决

**无。** 第五轮五维度交叉裁决后矛盾清单为空——各维度对重叠 finding（m-1 双维度、M-B 与 M-A 的崩溃面关系）均已给出合并/互证/不合并的明确理由，且理由与源码事实吻合，无需终局仲裁。

---

## 四、r4 分析链可信度评语

r4 五份报告的**修复质量**与**结构性判定**在本轮对抗审查下总体经受住了检验：

1. **修复有效性**：r4 的全部 major 确认在 `8d5a6eb` 修复且无回归实报——本轮 13 条 finding 无一是 r4 修复打穿的洞（m-1/m-6 是 r4 修复（needBubble 机制、finished 台账）覆盖不全的边角，属修复半径问题而非修复本身致 regression）。
2. **判定前瞻性得到新实证**：r4-arch 的「panel 生命周期手工守卫矩阵」警告被 m-6 新证据加强（6 个 handler 中 1 个漏防，正是矩阵类缺陷的形态）；「SW 膨胀」的 sessionStore 半边被 m-7 维持、orchestrator 半边被反证推翻——r4 分析链可被证伪且确实自我修正，可信。
3. **系统性盲区恰是 r4 视野外**：本轮 5 条 major 集中在两类 r4 未建维度的面——**host 进程级异常防护**（M-A/M-B：单流/单帧视角看不到整进程死活）与 **prompt 组装端到端语义**（M-C/M-D/M-E：host 单元测试对 `''` 边界与解析器跨消息态覆盖不足）。这不是 r4 失职，而是「修复轮视角」的结构性盲区，本轮补位正是五轮制设计的价值。
4. **测试断言的可信度注脚**：82/82 通过与上述 5 条 major 并存，印证 m-8 的判断——用例密度在单任务/单帧/单流路径上，跨任务交错与端到端 prompt 语义是真实盲区。

---

## 五、发布决策建议

**条件GO：修完 5 条 major 并回归后发布，预计 1-2 天。**

- **必须修复（闸门）**：M-A、M-B（host 崩溃双入口，建议同批 + 补一条 host 顶层 uncaughtException 兜底测试）；M-C（默认路径输出质量）；M-D + M-E（task.ts:192 同点合并修复，M-E 至少完成 UI 告知侧）。
- **强烈建议随批**：m-2（删两行内部批注，零风险、消除 CLI 侧可观测的迭代行踪泄漏）；m-6 的 task-meta 双守卫（一行守卫，与 m-4/m-1 同 listener 区域顺手修）。
- **可带入发布后首个迭代**：m-1 / m-3 / m-4 / m-5（纯文案/低频边角）。
- **不建议因 minor 推迟发布**：8 条 minor 无一影响核心旅程正确性。
- 修复后建议跑一次针对性回归：附件 3×500KB、大 prompt + CLI 未登录、默认模式 + 追问 + 工具流页（Read 全文）三条端到端路径。

---

## 六、backlog 增量（相对 r4 结构性 backlog 的净新增/修订）

1. **新增（host 进程韧性）**：host 顶层异常防护体系——`uncaughtException`/`unhandledRejection` 兜底转 task-error + spawn.ts stdin error 监听 + createFrameReader 超限改协议错误帧。M-A/M-B 修复只关两个入口，进程级兜底应作为常设机制（v2 多任务前的必要前提）。
2. **新增（测试盲区，接 m-8）**：stdio 单会话双任务交错测试集（sessionCwds/stableCwd/mkdtemp-cleanup/heartbeat 交叉面），定位为 **v2 多任务动工的前置验收**。
3. **修订（streamReducer 首 PR 范围扩大，接 m-6）**：r4 backlog 的「streamReducer 发布后第一 PR」应一并覆盖 task-meta finished/taskId 双守卫 + host `case 'meta'` 的 `!cancelled` 守卫，并附 streamReducer 首批 vitest 用例。
4. **维持不变**：sessionStore 拆分（v2 动工前，接 m-7 半准确判定）；SW 协议类型契约（r4 既定）。
5. **新增（卫生）**：内部 review 批注的防再生约定——prompt 模板/WORKFLOW.md 属发布产物，迭代注记一律进代码注释或 commit message，不进字符串字面量（可在 CI 加一条对 `task.ts` 模板与内置 WORKFLOW.md 的 `r\d+-` 模式扫描）。
