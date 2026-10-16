# r82 上架前三合一严苛审终裁报告（CWS 合规 + 遗漏核对 + 产品交互）

- 日期：2026-10-16
- 触发：用户指令「上架前的全面严苛 review，判断当前是否有遗漏，最后对产品交互严苛 review」
- 基线（实测采信）：HEAD `12a5912` 工作区干净 · 292 vitest 全绿 · host 红线 2199/2200 · npm registry latest=0.1.4 · 远端 main 与 tag `v0.1.4` 已推 · 待上传包 `apps/extension/pagedive-cws-v0.1.4.zip`（213KB，构建自 HEAD）
- 方法：workflow（run wf_15a96a2c-1d6，20 agent / 1.38M tokens）：6 finder 并行 → 跨维去重 → 14 条 high/medium 逐条对抗复核（默认反驳姿态、file:line 亲验、node 实跑重现）→ 主编终裁（去重 / 亲验头号 high / 抽验透传 low 2 条）。34 条 low/info 透传（不进复核池，主编抽验）。
- 复核断流披露：1 例复核员 429 速率断流（finding「升级横幅复制命令」的 package-integrity 版）——同缺陷另有两条独立复核（其一 node 重放切片 + zip 解包实锤）已完成，补位成立，无静默丢失。
- 维度分：CWS 政策合规 7 / 包完整性与升级路径 7 / 遗漏核对 7 / 主流程交互 6.5 / 追问会话交互 6 / 错误边缘态 7.5

## 三分收集

| 裁决 | 数量 | 说明 |
|------|------|------|
| confirmed | 11（去重后） | 13 条原始 confirmed，三组跨维撞车合并（横幅复制 ×3、F22 ×2） |
| rejected | 0 | — |
| unfetched | 1 | 429 断流，同缺陷补位复核成立 |
| pass-through | 34 | low/info（新发现 11 + r81 残留确认与长债 23），抽验 2 条成立 |

---

## 一、上架阻断级（已进 v0.1.4 zip 实物，提审前必修 + 重打包）

### P1（high）升级横幅「复制命令」按钮复制出 issues URL 而非 npm 命令

- 证据：`apps/extension/src/sidepanel/App.tsx:1055` `outdated.slice(outdated.lastIndexOf('：') + 1)`——r56（df8a869）设计假设「命令在末段」；r76（e28e49d）在命令**之后**追加 E404_HINT（`sw.ts:520-521`），其内含两个全角冒号（「…尚未发布到 npm：」「…等发版后重试：github.com/…」）。node 重放两种横幅（outdated `sw.ts:524` / upgrade `sw.ts:532`）切片输出均为 `github.com/aaione/ai-page-dive/issues）`。
- 实物实锤：v0.1.4 zip 内 `background.js` 含 E404_HINT 全文、`sidepanel.js` 含 minified 切片逻辑——两半 bug 均已进待上传包。
- 触发面：host 落后于扩展钉版的全部用户（现存 host 0.1.2 手动装机用户装 CWS 0.1.4 后必见 upgrade 横幅；未来每次发版窗口期同样命中）。按钮还闪「已复制 ✓」假成功；横幅明言「手抄必错」，用户零理由怀疑复制结果。
- 测试盲区：全仓无任何测试钉此切片（grep `lastIndexOf` 仅此一处）。
- 修法：E404 提示前置于命令，或 SW 回包结构化拆 `{ bannerText, cmd }`；补「复制内容==npm 命令」参数化测试。

### P2（medium）manifest 商店描述「内容不出本机」无限定语（F22 残留，r81 low 升级）

- 证据：`apps/extension/public/manifest.json:7`「无 API key、内容不出本机」——zip 内 manifest 逐字节同源（复核员 unzip 亲验）；`Settings.tsx:359` 分享文案同款复现。而 `PRIVACY.md:9` / `README.md:68` 均已是限定口径（claude→Anthropic、codex→OpenAI）。
- git 考古实锤：r71（5df7e0f）为把 description 压进 132 字符上限，把原本准确的「正文不经 PageDive 服务器」压缩成更强的失实表述。
- 上架视角：manifest description 是 CWS 商店页第一落点文案，与自家 PRIVACY.md 自证矛盾——误导性隐私主张属 CWS 拒因面，隐私敏感用户事后反噬。
- 修法：对齐 README:68 口径（如「正文直交本机 CLI，不经 PageDive 服务器」），当前 98/132 字符余量足够。

> **重打包路径**：CWS 0.1.4 从未上传——修 P1+P2 后直接 `pnpm build` + 重跑 `package-cws.mjs` 出新 zip 即可，**无需 bump 版本**（host/npm 侧零改动，check-version 七点位仍全 0.1.4）。

---

## 二、提审前置动作（流程/素材，非代码）

### P3（high）r81 优先级①明定的「新机空跑主线实测」未执行

- 证据：`reports/2026-10-14-r81-product-audit.md:83` 列入修复优先级①（运维链终点）；CHANGELOG Unreleased 段止于 publish/push/tag 闭合，零实测入账；全仓 reports grep「空跑/真机/录屏」零执行记录。
- 前科实证：r64 审计记载远端 install.sh 钉 @0.1.3 E404、新用户 100% 安装死路而本地测试全绿——同类「账面绿、实物断」只被外部实测发现过。r81③ 指纹持久化与 r81① watchdog 恰是 chrome shim 与真实 SW 分歧最大的区域。
- 动作：干净 mac（或新用户账户 + 清 `~/.ai-page-dive` 与 NM 注册表）跑通 raw.githubusercontent install.sh → 装扩展 → 首次总结 → 追问 → 历史恢复，录屏入账。

### P4（medium）CWS 审核演示预案缺失——审核员无法复现核心功能

- 证据：主链路双前置（终端装 host + CLI 登录态）；全仓无 screenshots/、无 store-listing 草稿、无演示视频、无测试说明。内部 `research/ship-readiness-audit-2026-09-09.md:45` 早已自证「审核大概率被退，退一次即损失 1–5 天」，但该待办未入 DECISIONS 账本、r81 未覆盖。
- 动作：listing 附核心总结流演示视频 + 分步测试说明（安装命令、CLI 登录前置、失败可观察现象）；仓库先行成稿，Dashboard 填写时取用。

---

## 三、confirmed 交互缺陷（v1.x 修复批，不阻断提审）

### P5（medium）F14 残留恶化：追问轮空输入在页面有变化时真的发出无用户意图的任务

- `sw.ts:601-639`：空 instruction 先经 resync 组装——指纹不中时披露行（:631）拼进空指令使其非空，绕过 `startFollowUp` 首行守卫（:1000 `!instruction.trim() && !attachments?.length`）→ 任务实发，CLI `--resume` 收到「请读取附件后作答」却无任何问题，自主发挥烧订阅 token + 空壳用户气泡。panel 三入口（send :321 / 按钮 :1253 / Enter :1211）全放行。行为随页面状态分裂（指纹命中才报 empty-instruction）。测试零覆盖。
- 修法：SW 侧空校验挪到披露行拼接之前（末道守卫）；panel 前置拦截 flashHint；补两形单测。

### P6（medium）pdf-page / empty-content / extract-crash 三码气泡指引是死路

- `terminal.ts:46/50/52` 三码均指引「复制正文粘贴为附件后直接追问」——但追问需已有会话，三码失败均发生在 spawn 前无 session；同锚页重发走首轮路径，PDF 正则（`sw.ts:1200`）与 extractBest 失败（:1266-1271）先于附件消费（:1298）→ 原样复吃同一错误码。pdf-page 前半句「转存 HTML」落 file:// 又被 `isNormalPage`（:351）排除吃 unsupported-page（文案错因）。纯文本粘贴落输入框不落附件（:1219-1227），字面动作也不可执行。
- 修法三选一：附件在场即放行提取门 / 文案改可执行路径（换锚指引）/ 失败建无页面会话。

### P7（medium）重开面板在途历史还原窗口内点「新对话」——旧对话复活 + 复活会话追问必报 session-lost

- `App.tsx:326-344` panel-ready 置 restorePathRef；newChat（`SummarizeView.tsx:513-524`）与 beginSession（`App.tsx:891-897`）均不清该 ref；history-file 守卫（:445-476）只查 pending/taskId——newChat 后两值皆空，迟到还原帧整体覆写为旧会话。对照 resumeHistory（:903-907）显式清 ref（r54-#4 同族修复漏了新对话按钮）。SW 侧 new-session 已删会话（`sw.ts:674-688`），复活 UI 追问一发即 session-lost（:601-607）。
- 修法：newChat/beginSession 对齐 resumeHistory 清 `restorePathRef.current = null`。

### P8（medium）page-meta 广播无锚邮戳——双窗双面板下 B 窗追问/导航污染 A 面板 tips

- 任务帧自 r16 起全量盖 tabId 邮戳（`sw.ts:918-925`），但 page-meta 家族四处裸广播（:617 unchanged / :632 resynced / :365 onActivated / :396 onUpdated；复核员另发现 :1287 首轮提取成功同病）；消费端 `App.tsx:432-437` 零守卫。B 窗追问把 A 的 pageMeta 覆写成 B 页：tips 混合态虚假陈述 + ≈tokens 显示 B 体量（与用量透明卖点冲突）。
- 修法：page-meta 补 tabId/windowId 邮戳，panel 按 anchor 过滤（对齐 foreignAdopt 判据）。

### P9（medium）重开还原的对话气泡 CLI 归属错标

- 自动还原路径（`App.tsx:444-479`）不注入 agentId（parseHistoryTurns 产物仅 {id,role,text}），气泡 fallback 落 effectiveAgent（默认 CLI 回退链），同屏 ModelDropdown 却用 sessionAgentId 显示会话真实 agent——默认 CLI≠会话 CLI 的用户每次重开面板必现两信号矛盾，直至首次追问回填 followAgent 自愈。对照手动 resumeHistory（:915-920）两侧都修过（r7-review 同族），自动路径漏修。
- 修法：SummarizeView:691 fallback 链在 effectiveAgent 前插 sessionAgentId（prop 已在）。

### P10（medium）package-cws.mjs 守门不含 sidepanel.html 子资源

- required 清单全部来自 manifest 声明（`scripts/package-cws.mjs:22-29`）；`sidepanel.html:6-7` 引用的 `/sidepanel.js` 与 `/assets/*.css` 不经 manifest 声明，永不进校验面；:31 existsSync 不判非空。第一段 build 半途挂 + 人工补跑第二段（vite.content.config.ts `emptyOutDir:false`）即形成「守门全绿但侧板空白」的混版包。守门脚本立项动机（AGENTS.md 明文记载的残缺 dist 前科）与实态有实质差距。
- 修法：解析 sidepanel.html 的 script/link 引用（含 hash 文件名自动跟随）并入 required，existsSync 升级为非空断言。

### P11（low，复核校准降级）resync 快照来源页 tips 错位 + favicon 丢失

- `SummarizeView.tsx:708` ctxAnchor 覆盖 pageMeta 的 title/url：页签 A→B 导航后追问，tips 显示「对话上下文『A』· 追问已附当前页快照」而实附 B 快照——文案字面不假（「对话上下文」锚定 A 是 r56/r57 刻意设计），缺陷本质是快照来源欠披露而非虚假陈述；CLI 收到正确快照、答案正确。复核员裁 low（较 r66/r68/r78 同类「主动虚假」型更轻）。

---

## 四、low/info 挂账（34 条透传，抽验 2 条成立）

**新发现（11 条）**：⌘⇧D suggested_key 与 Chrome 内置 Bookmark All Tabs 冲突可能不自动绑定（README 已有兜底指引）· 守门无法识别陈旧混版 dist（建议 vite define 注入版本戳断言）· SW 横幅命令仍 `&&` 拼接与 Onboarding 两行口径相悖 · 追问轮起跑无 SW 占位帧（冷连接秒级零反馈 + 该窗口取消零确认）· 追问轮截断 note 只披露给 CLI 不进 page-meta（PageTips 已有 notice 渲染位未用）· 新对话不清 attachments/attachNotice（文本清附件不清，自身不对称）· unchanged 分支「零膨胀」与 ≈N tokens 同屏矛盾 · Onboarding 态消费收件箱即删（missed 终局零痕迹）· 双窗折叠侧终局因「任一 listener 在听」不入箱（代码自认升级路径）· 收件箱补发气泡 label 与 message 同义复读 · ext-restarted 补发零上下文（不显示哪页、不恢复问题文本）。

**r81 残留确认（16 条）**：F3 codex「完整支持」未披露围栏弱一级（claude.ts:141 根域 Read 白名单 vs codex.ts:94 全机只读）· F6 install.sh 无平台前置门 · F8 retina 截图仅降质不降分辨率 · F9 截图跳过零提示 · F10 elapsed 首现 40s（心跳 20s × `secs > 30` 门槛）· F13 混贴静默丢图（r78 只修文本方向）· F15 快照对半截断不回升 · F16 codex resume 正则绑死单英文文案 · F17 丢快照分支零 page-meta · F14 low 侧（会话态空输入错误气泡+不可见空气泡，其恶化面已升 P5）· C2 sess 快照跨 await 陈旧 · C3 附件落盘失败静默 · C5 escapeYaml 无形状闸 · C6 残余面（Settings/HistoryView/Onboarding 零变异网）· C11 红线余量 1 行（上架后首个 host 热修即流程死路）。

**长债/流程（6 条）**：C10/C14 SW 复杂度热点与导出常量 · optional `<all_urls>` 审核问询风险（listing 预置答辩文案）· CWS 提审未发生（含平台定向/详情页文案未核实）· 新机空跑（已升 P3）。

---

## 五、dims 对账与不可核实面

| 维度 | 分 | covered | 关键结论 |
|------|----|---------|---------|
| CWS 政策合规 | 7 | 20 项 | 权限最小化/CSP/WAR/远程代码禁令产物级扫描（eval=0/动态 import=0/零遥测 SDK）全过；PRIVACY.md 披露与代码逐项对得上；single purpose 成立；F22/F3 是仅有的门面失实 |
| 包完整性与升级路径 | 7 | 9 项 | zip↔dist sha256 全一致；icons 实测有效 PNG；协议 0.1.2→0.1.4 兼容实测（17 帧型全认）；**CWS 首发 0.1.4、registry 无 0.1.3——「自动更新老用户」实际不存在**；upgrade 横幅命令链完整但复制按钮坏（P1） |
| 遗漏核对 | 7 | 6 项 | r81 产品审 27 + 代码审 14 全量对账：已修 13、残留 16、长债 6、流程欠账 2（空跑/提审）；reports/ 28 份跨轮扫描无 r81 之外悬空 critical |
| 主流程交互 | 6.5 | 9 站 | 点击链/Onboarding/发起/进行中/流式/终局三态守卫网未发现新漏洞；新病集中在还原窗口（P7/P9）与 page-meta（P8） |
| 追问会话交互 | 6 | 10 面 | F14 恶化（P5）为最大新病；F9/F13/F17 残留确认；session-lost 自愈四环闭合核验通过 |
| 错误边缘态 | 7.5 | 8 族 | 25 码逐码旅程全走查；双窗修复链核验健康；新病为三码死路（P6）与收件箱三残留 |

**不可核实面（需 CWS 登录态/真机，共 26 项入账）**：Dashboard 实际填写内容 · `<all_urls>` 实际问询烈度 · 审核员无 CLI 环境的实际裁决（P4 后果）· ⌘⇧D 真机绑定实况 · 真机 SW 回收/双窗竞态/IME 矩阵/retina 截图 · 空指令任务下 CLI 实际生成形态 · host>ext 跨版本配对。

## 六、终裁结论

1. **当前状态可以提审吗？不建议直接提**——v0.1.4 zip 带两处已知病（P1 复制按钮功能性断裂 + P2 商店页隐私主张失实），修复成本一行级且 CWS 未上传过 0.1.4，重打包零代价。
2. **提审前最小清单**：修 P1+P2 → `pnpm build` + 重出 zip → 新机空跑主线实测（P3）→ listing 素材成稿（P4，演示视频+测试说明）→ Dashboard 填写（平台定向 macOS+Chrome、隐私政策 URL 指向 PRIVACY.md、权限理由栏预置 `<all_urls>` 答辩文案）→ 上传提审。
3. **P5-P10 六条 medium 进 v1.x 首个修复批**（F14 恶化优先——涉及 token 消耗）；P11 与 34 条挂账按节奏消化，C11 host 红线余量债在首个 host 修复批时合并删减。
4. 三分收集：confirmed 11 / rejected 0 / unfetched 1（补位成立）——本轮无虚报存活，对抗复核全部为证据亲验型确认（含 node 重放与 zip 解包实锤）。
