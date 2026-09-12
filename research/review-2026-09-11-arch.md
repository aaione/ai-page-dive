# PageDive 架构设计维度深度严苛 Review（2026-09-11）

- **评审对象**：commit `8fd0f12`（发布前六项修复：version 单源化 / SW 占位帧 / panel pending 态）之后的 main
- **评审视角**：决策质量、模块边界、演化能力。行级 bug 另有实现维度审查，此处只在与架构相关时引用。
- **对照基线**：CLAUDE.md 硬约束 7 条 + v1 优先级；DECISIONS.md（含 2026-09-09 多引擎定案）；research/product-architecture-report.md。
- **证据形式**：`file:line`（行号取自当前 working tree）或文档引用。

---

## 0. Verdict（先行）

**架构支撑 v1 发布：GO（0 blocker）。架构支撑 v2 多引擎：审校模式（v1.x）余量充足；并列模式的墙明确且已被 DECISIONS 显式推迟（推 v2 等数据），不是隐性地基问题。**

3 个 major 均为质量债而非结构债：状态机三处副本（M1）、extension 帧门控零测试（M2）、SW 会话归属的时序推断（M3——v2 编排的第一块会塌的砖，但修复 <0.5 天）。它们不阻塞发布，但 M1/M2 每拖一周，"防尾巴帧/防双发"类修补的堆叠成本越高（近 6 轮修复 commit 已证明 bug 重心从 host 迁移到 extension 状态机）。

**计数：blocker 0 / major 3 / minor 5 / info 4。硬约束判定：5 ✅、2 ⚠️、0 ❌。**

---

## 1. 硬约束符合性审计（逐条）

### HC1 权限面 → ✅

- 证据：`apps/extension/public/manifest.json` `permissions = ["activeTab","scripting","nativeMessaging","sidePanel","storage"]`，无 `host_permissions`、无 `<all_urls>`。`storage` 为 2026-09-08 修订明确允许（仅 session 域，SW 恢复追问会话态）。
- 判定成立。备注见 [info] i1：`apps/extension/vite.config.ts:12`（`E2E_BROAD_PERMS`）可一键构建宽权限变体到 `dist-e2e`。发布产物无污染，但存在"误用 build:e2e 产物打包上传"的人为面。建议：`E2E_BROAD_PERMS=1` 时在 manifest `name` 追加 " (E2E)" 后缀，使误发布产物一眼可辨。

### HC2 prompt/正文一律走 stdin / 正文落临时文件 → ✅

- 证据：`packages/host/src/spawn.ts`（`stdinData` 经 `child.stdin.write + end` 递送 prompt）；`packages/host/src/agents/claude.ts` buildArgs 仅 `['-p','--output-format','stream-json','--verbose','--include-partial-messages', ...resume]`，`agents/codex.ts` buildArgs 仅 `['exec','--json','--sandbox','read-only','--skip-git-repo-check','-o',lastMsgFile]`——argv 零正文、零 prompt；`agentdef.ts` 注释明示"prompt 一律走 stdin（硬约束），此处不含正文"。
- 正文/附件全量落盘：`packages/host/src/tmpfile.ts`（`tmpdir()/pagedive/taskId.md`，`mode 0o600`，60s 延迟清理）、`task.ts` `materializeAttachments()` 同机制。协议侧另有 `task-content` 分片（≤512KB，`protocol.ts MAX_CHUNK`）+ `content-received` 字符对账——argv 长度上限约束在全链路成立。

### HC3 零凭证接触 → ✅

- 证据：`packages/host/src/agents/registry.ts` `cliEnv() = { ...process.env, PATH: cliPath() }`——唯一的环境改写是补 PATH（macOS Dock 启动 PATH 极简问题），不读/不写/不代理任何 token/OAuth/流量；`resolveBin` 走 `which` 解析用户自装的官方二进制。spawn 传参只含 argv + stdin + cwd + NO_COLOR。合规红线（未修改官方 CLI、用户自己登录）成立。

### HC4 claude 运行内失败（is_error）不能只看退出码 → ✅

- 证据：`agents/claude.ts` `isError()` 显式 `is_error` 字段优先、`subtype !== 'success'` 兜底；`packages/host/src/task.ts:304-307`（`gotResultOk`）+ `task.ts:352`——`code !== 0 && !gotResultOk` 才按失败终局，"result 已成功交付后 exit code 异常仍算成功"，硬约束 #4 的精神在终局分派处也有落地。

### HC5 host 薄壳 <2k 行 → ⚠️（成立但余量 14 行）

- 证据：`find packages/host/src -name '*.ts' | xargs wc -l` = **1986 行**（含 `scripts/postinstall.ts` 107 行、`agents/` 三适配器 + registry 共 328 行）。
- 判定：数字上满足。但两个结构性备注：
  1. **余量 14 行是指标异化的温床**（[info] i4）："薄壳 <2k" 本意是防 host 长成第二个产品，现在它反过来会诱发"为保数字把该放 host 的逻辑塞进 extension"的错位。建议 DECISIONS 把约束改述为能力边界（"host 不做编排/不持有产品语义"），行数降级为监控指标而非红线。
  2. `task.ts` 单文件 553 行是 host 的 28%，Task 类内 5 个终局布尔标志（见 §3）——薄壳约束挡不住单类复杂化。

### HC6 v1 = macOS + Chrome、claude + codex 双适配器 → ⚠️（决策与实现漂移）

- 证据：DECISIONS 决策 #5"只实现两家"；`agents/registry.ts` `AGENTS = [claudeDef, codexDef, opencodeDef]` **三家**，且配套 `opencode-parser.test.ts`、`scripts/smoke.mjs opencode`、`scripts/e2e-opencode.mjs` 全链路存在。
- 判定：实现超前于拍板（[minor] m3）。opencode 在 DECISIONS 中反复出现（Gatekeeper 已知限制、多引擎讨论），说明它是事实上的准 v1 成员。二选一：a) 修 DECISIONS 记录"opencode 进入 v1.x"及动机；b) registry 加 feature flag 收编。**决策文档与代码谁是事实源必须显式裁决一次**，否则后续 review（含本次）无法判定"第三家"是漂移还是定案。

### HC7 历史/workflow/skills 落盘路径 → ✅

- 证据：`packages/host/src/history.ts` `buildHistoryPath()` = `~/.ai-page-dive/history/年/月/日/HHMMSS-slug.md`（frontmatter 元数据：title/url/agent/workflow/status/usage/sessionId）；追问轮 `appendHistoryTurn` 以 `pd:user`/`pd:assistant` 注释分段 append 同一文件；`.pagedive → .ai-page-dive` 一次性迁移 + `assertInRoot` 路径围栏。workflows `~/.ai-page-dive/workflows/<name>/WORKFLOW.md`、skills `~/.ai-page-dive/skills/`（`workflows.ts`/`skills.ts`，目录即插件、用户目录 shadow 内置）。与 DECISIONS #4 及既定技术决策完全一致。

---

## 2. 模块边界：shared 作为唯一契约面的完整性

**总体**：`packages/shared`（page + agentdef + protocol）作为两侧唯一共享契约、被两侧单向消费（见 §6），结构成立。但 **NM 协议之外还存在两个未契约化的真实协议**，且 SW 已从"透明转发"演化为"协议中间人"——这是本轮 review 确认的最重要的架构事实变化。

### [minor] m1 — SW 合成帧的隐式约定未进 protocol.ts

- 证据：
  - `protocol.ts:297` `{ t: '__host-disconnected' }` 已显式进契约并标注"SW 合成"——这半步走对了；
  - 但 `sw.ts:400` SW 合成 `{ t:'task-status', phase:'reading' }` 占位帧，与 host 真帧**同型不可区分**。`phase:'reading'` 在 `protocol.ts:190` 本是 host 的合法相位（AgentEvent status union 同样含 reading），"reading 只由 SW 发、host 不发"这条约定只存在于 sw.ts 注释与 App.tsx 的消费注释里，protocol.ts 无一字说明；
  - `protocol.ts:240` `TaskErrorMsg.code` 联合类型中 `'content-mismatch'` 是 SW 专属（host `task.ts` onError 的 code union 不含它），`'no-agent'`/`'bad-request'` 与 `'content-mismatch'` 分属不同发送方，类型上无任何标注；
  - `sw.ts:261` SW 对 host `agents` 帧 merge lastModels 后"**取代原帧**"下发——SW 会改写协议负载。
- 理由：协议契约的价值在"新增消费方时无需读实现即可推演语义"。当前 panel 开发者必须同时知道三个文件的注释才能正确处理 task-status。v2 编排（SW 要合成更多帧：B 任务启动提示、审校状态条）会让 SW 合成帧数量继续上涨，隐式约定面同步膨胀。
- 建议（低成本）：protocol.ts 内建 `/** 发送方 */` 注释分区——在 HostToExt 每个 frame 类型标注 `host` / `SW 合成` / `SW 改写后转发`；给 SW 专属 code（content-mismatch）和 SW 专属相位（reading）加 "SW-only" 文档注释。若 v2 合成帧进一步增多，再考虑 `origin: 'host'|'sw'` 字段或独立帧名（现在不必）。

### [minor] m2 — panel→SW 内部消息面完全无类型

- 证据：`sw.ts` 头注释列出消息面（`{t:'summarize',...}/cancel/new-session/panel-ready/nm`），但 handleMessage 实现里全是 `msg.instruction as string | undefined` 式断言（sw.ts `'summarize'` 分支）。该运行时真实协议不进 shared 也罢，extension 内部也无 types 定义。
- 理由：U1 类竞态 bug 的温床之一——字段名拼错/漏传在 TS 层零防护，只能靠手动验证发现。SW↔panel 是 extension 内部边界，放 `apps/extension/src/lib/types.ts` 即可，不必污染 shared。
- 建议：定义 `PanelToSw` discriminated union + `sendMessage` 收窄包装，一次性消掉全部 `as`。

---

## 3. 状态归属：任务状态三处分布 + 本轮新增副本

**现状盘点**（一个任务的终局语义在三处各自实现）：

| 位置 | 状态 | 防御规则 |
|---|---|---|
| host `task.ts` | tasks Map（stdio.ts:60）+ Task 内 **5 个布尔**（cancelled/finished/doneSent/timeoutSent/gotResultOk，task.ts:63-76）+ sessionCwds Map | 终局只发一次、timeout 先标记、exit 异常按 gotResultOk 豁免 |
| SW `sw.ts` | **8 个模块级可变量**：currentTask(:21)/lastSession(:35)/currentAgentId(:37)/target(:64)/agentsCache(:67)/pinned(:72)/panelTabId(:89)/lastModels | task-done/error 严格按 taskId 匹配才清 currentTask；expectedChars 对账 |
| panel `App.tsx` | TaskStreamState：taskId/activeId/**pending（本轮新增）**/**finished（本轮新增）**/phase/done | 首帧绑定、异 taskId 丢弃、finished 含内拒收（slice(-8)）、pending 双发门 |

**判定 [major] M1：还能被一个开发者完整推理，但已到上限。** 近 6 轮修复（U1 双发竞态、C2 迟到帧收割、resume-history 前取消在途任务……）本质是在三处各自补丁同一条"任务终局/帧归属"语义——每一处防御单独看都正确且有注释，但"一帧从 host stdout 到 panel 气泡的所有命运"现在需要同时持有 6+ 个门控条件。本轮 pending/finished 又各加一个，趋势是每修一个竞态加一个标志位。这不可持续，但也**不需要动大架构**。

**最小收敛方案（三步，均局部重构）：**

1. **panel 侧（收益最大、最先做）**：把 App.tsx 的 `switch(m.t) setStream(...)` 提取为纯函数 reducer——`apps/extension/src/lib/streamReducer.ts`，签名 `(s: TaskStreamState, m: HostToExt) => TaskStreamState`。逻辑一行不改，只是搬家。搬家后它变成 §5 要求的第一块单测的测试对象，且"过期帧语义"从此有唯一文字化定义处。
2. **SW 侧**：8 个模块变量收敛为一个 `swState` 对象（`{ task, session, agents, ui }` 分组）。收益不是行数而是**持久化/恢复/推理的原子性**——现在 persistSession 手工挑 3 个字段序列化，漏一个就是下一个 SW 回收竞态 bug。
3. **host 侧**（可最后做）：Task 的 5 布尔收敛为单 `phase: 'running'|'ok'|'err'|'cancelled'|'timeout'` 字段 + 转移断言。5 布尔的非法组合空间（2^5=32，合法约 6 个）目前只靠注释约束。

不建议（现阶段的过度设计）：三处统一状态机库、SW 引入 store 框架、panel 改 saga——那是 v2 并列双流改造时的事。

---

## 4. 演化能力：v2 多引擎（SW 编排、host 零改）

对照 DECISIONS 2026-09-09 定案逐项核对现状余量：

**成立的部分：**

- **"host 零改"主张基本成立**（[info] i4）：`stdio.ts` tasks Map 天生多任务（`tasks.set(task.taskId, t)`，task-cancel 按 id 路由），A/B 两个任务对 host 就是两次独立 task-start——串行审校（A done 同 tick 发 B start）host 确实零改。临时文件按 taskId 命名（tmpfile.ts）、历史两任务两文件，均无单任务假设。
- **审校串行复用 panel 单流状态机成立**：A task-done 终局解绑 taskId（本轮 C2）→ B 首帧重新绑定 → B 的 chunk 天然新气泡。DECISIONS 的推演与现状代码一致。
- NM port 保活：双任务消息更密，heartbeat 机制无压力。

**会顶到的墙（按爆的先后排序）：**

1. **[major] M3 — SW 会话归属靠"此刻 currentAgentId"时序推断，v2 编排的第一块塌砖**。证据：`sw.ts:36-37` 注释自认"task-meta 到达时此刻的 agent 即会话归属"；task-meta/task-done 的 sessionId 捕获分支用 `currentAgentId` 而非帧自带 agentId。串行审校的交接窗口（A done 清 currentTask → B start 改 currentAgentId → **A 的迟到 task-meta/task-done 到达**）会把 A 的会话记到 B 名下，追问挂错引擎——恰是 DECISIONS 承诺"追问挂 B 的会话、A 经 resume-history 可恢复"要依赖的正确归属。并列模式（真并发双流）下该推断**必然**错。而 host 侧帧早已自带归属：`stdio.ts` task-start 回调 `onMeta: send({..., agentId: task.agentId, ...})`、task-done 同。**修复 <0.5 天：SW 捕获逻辑改信任 `msg.agentId ?? currentAgentId`，推断降级为兜底。建议随 v1.x 审校模式第一个 PR 落地，甚至提前到 v1。**
2. panel 单 taskId 绑定 + "已绑定后异 taskId 一律丢弃"（App.tsx task-chunk/task-status 分支）：并列双流的硬墙——但这是 DECISIONS 显式拍板推迟的（"并列 arena 推 v2 等数据，1-2 周双流 UI 改造"），且 §3 的 reducer 抽取会让未来双流改造有现成的语义底座。不计 finding。
3. lastSession/currentAgentId 单值：审校模式"B 会话覆盖 A"符合 DECISIONS 设计（A 走 resume-history），可接受；仅注意 persistSession 的字段序列化在双会话期需要扩为 per-agent map（随墙 2 一起动）。

**结论**：v1.x 审校模式的架构余量真实存在且足够，唯一需要现在动手的是 M3（帧自带归属优先）。

---

## 5. 测试金字塔

**现状**：host 12 个 vitest 文件（buildargs/claude-parser/codex-parser/opencode-parser/history/install/nm/registry/stdio/task/version/workflows）——流解析、路径围栏、版本防漂移全覆盖，是金字塔合格的下两层。extension **零单测基建**（root `vitest.config.ts` 的 include 未覆盖 `apps/extension`，package.json 无 test script，依赖里无测试环境）。e2e 为 `scripts/e2e*.mjs`/`verify-panel-open.mjs` 手动 playwright 驱动脚本，无 `*.spec.ts`、无 playwright.config、不进 CI 断言。

**对 v1 的合理性判定**：DECISIONS 技术栈拍板"vitest 覆盖 host 纯函数 + AgentDef buildArgs；扩展侧手动验证"——**当时**风险重心在 host 流解析，该决策正确。**现在**不成立：近 6 轮修复（U1/C2/C3 本轮全在 extension 侧状态机；U1 是 major 级竞态）证明 bug 密度已迁移到 panel 帧门控/SW 编排窗口，而那里零防护。测试分布应随 bug 分布迁移，这是 [major] M2 的判据，不是"补测试教条"。

**最该补的第一块（具体到文件与用例）**：

新建 `apps/extension/src/lib/streamReducer.ts`（§3 第 1 步的产物），配套 `apps/extension/src/lib/streamReducer.test.ts`，root vitest.config include 加 `apps/extension/src/**/*.test.ts`（纯函数，无需 jsdom）。用例名（每条对应一个已发生过或险些发生的真实 bug）：

1. `rejects late chunk of finished taskId (reap tail must not reopen a terminal-less bubble)` —— 对应 C2 收割尾巴帧
2. `binds on first frame and drops frames carrying a different taskId (stale hijack guard)` —— 对应取消后旧任务尾随劫持
3. `pending gate holds running=true between send and first frame (double-send guard)` —— 对应 U1 双发竞态
4. `error after synthetic reading placeholder filters empty streaming bubble` —— 对应 U1 的 onStartResult 失败路径滤空占位气泡
5. `task-done unbinds taskId, records finished, closes streaming bubble with usage/isError`
6. `task-done of a stale task only closes streaming bubbles, never finalizes the new round` —— 对应 App.tsx task-done 的过期帧分支

第二优先：`sw.ts` 的 onMessage 帧门控（currentTask 匹配/content-received 对账/终局清理）同样抽纯函数 + 同款帧序用例。这两块补完，extension 侧最脆弱的两处就有与 host 同级的回归网，e2e 手动脚本退回它该在的"发布前冒烟"位置。

---

## 6. 依赖方向 + version.ts 方案判定

**依赖方向 ✅**：`apps/extension/package.json` dependencies 含 `"@ai-page-dive/shared": "workspace:*"`；host 同（stdio.ts/task.ts 均 `import ... from '@ai-page-dive/shared'`）。shared 不反向 import 任何一侧、不依赖 chrome/node API（page/agentdef/protocol 全纯类型 + MAX_CHUNK 常量）。单向成立且干净。

**[info] i3 — version.ts 运行时读 package.json：架构上可接受，优于常量+断言。** 判据：

- host 是 Node 运行时（非打进浏览器的静态 bundle），`version.ts:7` 启动一次 `readFileSync(new URL('../package.json', import.meta.url))`——src 与 dist 到包根层级对称（`src/version.ts → ../package.json`、`dist/index.js → ../package.json`），npm 发布恒含 package.json，链条封闭；
- 失败兜底 `'0.0.0'` → 握手判"过低"强制升级提示，**失败方向安全**（这正是架构评审关心的性质）；
- 备选方案（常量 + version.test.ts 断言与 package.json 一致）把单源变成了"双源+断言"，bump 时多一处必改；且断言只防 CI 内漂移，防不住打包残缺。当前方案 + 既有 version.test.ts 四处断言已是更优组合。
- 唯一错位 [info]：extension 侧 manifest.json/package.json 的版本一致性断言放在 `packages/host/test/version.test.ts`（跨包断言寄居在 host 测试里）。v2 若 host/extension 发版节奏分化（DECISIONS 明示"更新节奏脱钩"），此处会变成假耦合，届时应迁到 root 级测试或 CI 脚本。

---

## 7. 协议版本化：MIN_HOST_VERSION 完备性 → ⚠️（基本安全，两个缺口）

**机制现状**：`sw.ts:12` `MIN_HOST_VERSION = '0.1.0'`；panel-ready 时 `nmPort.probe()` → pong 带 hostVersion（`version.ts:7` 单源）→ `versionLt` 过低则一次性横幅 + 一条到底的升级命令（sw.ts:179-180）。注释明确抬升条件："协议新增依赖消息时（如 heartbeat）才抬高"。

**"旧 host 遇新消息是否真的安全"逐路径核对：**

- **旧 host + 新 ext 发新消息类型**：host `stdio.ts` handle 的 switch 无 default 分支 → 静默忽略。安全性靠两点成立：a) 探测帧（ping）是 v0.0.1 起就有的，版本检查本身不依赖新消息；b) 横幅在 panel-ready（用户动作起点）出现，先于任何任务。**判定：症状可见（横幅）、方向安全**。但"静默忽略"意味着若 MIN_HOST_VERSION 忘了抬，症状退化回"按钮无反应"——这正是注释自己承认的陷阱。
- **新 ext 发旧消息的新字段**（如 task-start 未来加字段）：host 忽略未知字段（JSON 解析宽容）→ 安全。
- **旧 ext + 新 host**：host 只回 ext 认识的帧或新增帧被 ext 的 switch 默认忽略（App.tsx switch 按帧名分发，未知帧落空）→ 安全。

**[minor] m5 — 缺口一：MIN_HOST_VERSION 抬升与协议变更是纯人肉联动。** protocol.ts 每次新增/语义变更 ExtToHost 消息，必须有人记得抬 sw.ts 常量，无任何机械约束。建议：在 protocol.ts 的 ExtToHost union 顶部维护一行 `// requires MIN_HOST_VERSION >= x.y.z` 逐消息注释表（随消息走，diff 可见），或最低限度在 DECISIONS 的 protocol 变更 checklist 中加一条。成本一行注释，防的是"按钮无反应"这类最难远程诊断的支持工单。

**[minor] m6 — 缺口二：版本单向（host 上报，ext 不上报）。** host 无法按 ext 版本降级行为。当前所有帧向后兼容、无此需求；v2 若出现"host 需要 ext 新能力"的协议（如编排相关回执），单向版本就不够了。现在不动，但 DECISIONS 的协议演进节应记下这个触发条件。

**[info] i2 — `versionLt` 解析不含 prerelease**：`'0.2.0-beta.1'.split('.')` 第三段 `Number('0-beta')=NaN` → 所有比较 false → 判"不过时"。失败方向安全（不误拦），但若未来 npm 发 prerelease 渠道（`npm i -g ai-page-dive@next`），版本横幅会漏报。记录即可。

---

## Findings 汇总表

| # | 级别 | 摘要 | 证据锚点 | 清单节 |
|---|---|---|---|---|
| M1 | major | 任务终局语义在 host(5 布尔)/SW(8 变量)/panel(pending+finished 新副本) 三处各自堆防御，已达单开发者推理上限；给出三步最小收敛（panel reducer 抽取 → swState 对象 → Task phase 状态机） | task.ts:63-76, sw.ts:21-89, App.tsx TaskStreamState | §3 |
| M2 | major | 测试分布未随 bug 重心迁移：extension 帧门控零测试而近 6 轮修复大半在此；第一块补 streamReducer.test.ts 六个具名用例 | 近 6 commit + vitest include 范围 | §5 |
| M3 | major | SW 会话归属靠"此刻 currentAgentId"时序推断，v2 审校交接窗口/并列双流下必然记错引擎；帧已带 agentId，改信任帧 <0.5 天 | sw.ts:36-37 vs stdio.ts onMeta | §4 |
| m1 | minor | SW 合成/改写帧（reading 占位、content-mismatch code、agents merge 取代）的发送方约定未进 protocol.ts，契约面有隐式部分 | protocol.ts:190/240/297, sw.ts:261/400 | §2 |
| m2 | minor | panel→SW 内部消息面无类型，handleMessage 全 `as` 断言 | sw.ts summarize 分支 | §2 |
| m3 | minor | DECISIONS"v1 只实现两家" vs registry 三家（opencode 全链路在库）——决策文档与代码事实源未裁决 | registry.ts AGENTS | §1/HC6 |
| m5 | minor | MIN_HOST_VERSION 抬升与协议变更纯人肉联动，无机械/文档锚点 | sw.ts:12 注释 | §7 |
| m6 | minor | 版本握手单向（host→ext），v2 若需 host 按 ext 降级则不够——记录触发条件即可 | sw.ts:179 | §7 |
| i1 | info | E2E_BROAD_PERMS 宽权限构建产物存在误发布人为面，建议 name 加后缀 | vite.config.ts:12 | §1/HC1 |
| i2 | info | versionLt 不解析 prerelease，失败方向安全 | sw.ts versionLt | §7 |
| i3 | info | version.ts 运行时读 package.json 判定为可接受且优于常量+断言；跨包版本断言寄居 host 测试是未来小错位 | version.ts:7 | §6 |
| i4 | info | host 1986 行贴 2k 天花板，"行数红线"有指标异化风险，建议改述为能力边界；host tasks Map 多任务原生支持= "v2 host 零改"主张成立 | wc -l; stdio.ts:60 | §1/HC5, §4 |

（m4 编号并入 i4 的行数部分，避免重复计。）

---

## 结论

**v1 发布**：架构 GO。7 条硬约束 5 ✅ 2 ⚠️（HC5 行数余量、HC6 决策漂移——两者都是文档级修复）。权限面、stdin 纪律、零凭证、落盘约定执行得比多数 v1 项目干净；version 单源化（8fd0f12）方向正确。发布前建议顺手做的唯一一件事是 m3 的 DECISIONS 裁决（一句话修订），其余可随 v1.x。

**v2 多引擎演化**：审校模式（v1.x）的"SW 编排、host 零改"主张经代码核对**真实成立**——host 的多任务 Map、按 taskId 的临时文件/历史路径、panel 的首帧绑定语义都恰好是编排友好的。三块墙按序：M3 会话归属（审校窗口就爆，先修）、panel 单流（并列模式才爆，DECISIONS 已显式推迟）、lastSession 单值（随并列一起动）。M1/M2 的收敛不是 v2 前置条件，但每延后一周，extension 状态机的修补成本按近 6 轮 commit 的斜率上涨——建议 M2 的第一块测试（streamReducer 六用例）作为 v1 发布后的第一个 PR。
