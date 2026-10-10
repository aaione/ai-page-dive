# r70 产品终审报告

- **对象**：main@015e8d2（r69 修复批后）· v0.1.4 · host 2196/2200 · 235 用例
- **终审分数**：6.5 / 10 —— 判定：**不通过**
- **核心问题**：PageDive 的 v1 作为产品是否高质量完成？
- **收割对账**：confirmed 8 条 / rejected 1 条 / low 8 条；维度 5/5 交付

### 执行记录

- 首跑（2026-10-10）429 限额打穿：12 agents 中 7 个 429（5 小时上限型）——纪律 #12 命中，等重置后同 runId `wf_fcfbd4e7-f5d` resume。
- 二跑（2026-10-11 16:07）install/release 两维度 audit agent 再栽 **[1302] 瞬时速控**（非限额、非不交卷），3/5 维度交付即出临时判 6.5——纪律 #2 对账不完整，三跑补齐。
- 三跑（2026-10-11 16:2x）5/5 维度收官：15 agents / 666882 tokens，verdict 基于完整维度重判，维持 6.5/否。
- **跨维度去重**：C2（curl 主线 E404 无排障条）/ C3（npm 备选线 + FAQ 空页）/ C4（README/install.sh 钉版）/ C6（三版本断链）系**同一发布链断根的四个截面**（分属 install/docs/release 三维度各自确认）——合并计为 1 条主发现「发布链 critical 第 10 轮」，实际独立发现数 = 8 − 3 = **5 条**（1 critical 发布链 + 2 medium CHANGELOG 账目 + 2 low）。C4/C2 审计员自标「非新发现/续计」。
- 对账备注：C1（AGENTS:43 零配置）与 L7（docs 维度同款）同根重复——C1 为准（对抗验证 severityFinal 降 low），L7 并入。

## 终审判词

> 否。工程面已是合格产品：decisions 8 / ux 8.5 / 安装本地代码质量高，235 用例实跑通过，r69 四项 UX 修复属实装，九大决策与隐私三条「不做」承诺逐条可在代码落实。但产品成立的判据不是代码而是用户可达：发布链 critical 已第 10 轮续存——registry 0.1.2 / 远端 install.sh 0.1.3 / 本地钉 0.1.4 / 85 commits 未推 / 零 tag，新用户今天走 curl 主线必 E404，npm 备选线同根 E404，FAQ 逃生口指向空 releases 页，「稍等几分钟」对三周未发之版是空等——产品唯一入口对全部新用户关闭。虽定性为用户凭证操作递延而非工程未修，但对产品终审而言结果等价：不可安装的产品没有高质量完成。叠加 CHANGELOG 计数归因第 4 次触 r61 制度、版本账错位，判 6.5/否。一次三连（publish 0.1.4 + push + tag）即可解套，期待 r71 转正。

## 维度得分

| 维度 | 得分 | 总判断 |
|------|------|--------|
| decisions | 8 | D1 落实（对外全口径已改，AGENTS:43 内部档漏网）；D2 落实；D3 落实（optional_host_permissions 默认关+气泡开关与 r63 修订一致）；D4 落实（history.ts:88/119/240 路径/frontmatter/prune 全对上）；D5 落实（agents 仅 claude/codex，opencode r55 删档有锚）；D6-D9 落实；多 |
| install | 3.5 | 安装旅程本地代码质量高（install 幂等/origins union/原子写/四态退出码、npmCmd 拆行+pre-line、README/FAQ 一致），但对外承诺今天全线断裂：curl 主线与 npm 备选线同根 E404（发布链第 10 轮挂账），E404 逃生口指向空 releases 页，SW 横幅 && 拼接残留 r69 同族缺陷。修复就绪未推送，用户视角仍不可达。 |
| ux | 8.5 | r69 四项修复全部属实装：tips 失败第四态判定链与文案落位（SummarizeView:651/:1245，取消气泡走「已分享」分支）；复制按钮 aria-label 三态真切换（:935）；技能开关「技能 X 启用」与 CLI 开关「X 显示于新对话」同为状态名谱（Settings:661/:600）；App:626 cancelled 标记驱动 sr-only 终局分流。主流程错误/空态 |
| docs | 6 | r69 修复批 CHANGELOG 四条 Fixed 与 20ac0a6/6256a70 diff 逐条可导出，测试实跑 235/25 文件与三处数字一致，PRIVACY「不做」三条（零遥测/零服务器/零凭证）代码核实成立，五档名与 workflow-labels 对齐，版本三处钉 0.1.4 一致。但计数口径第 4 次触线（229→235 增量归因造假）+ 发布链 critical 续挂第 10 |
| release | 3 | 发布链 critical 第 10 轮维持：registry 0.1.2/远端 0.1.3/本地 0.1.4 三断链，新用户 curl 装 npm 即 E404、85 commits 未推零 tag、远端 CI 推定红。本地守门体系（check-version 七点/check-published/check-install-dist/package-cws）完备但拦不住发版不动作。新发现：CHA |

## 确认的发现（对抗验证 isReal:true，8 条）

### C1. [LOW] AGENTS.md v1 Priority 节仍以「零配置」居首——D1 r59 修订第 2 轮漏网

- **证据**：AGENTS.md:43「**零配置 + 深度总结质量。**」——r69 只改了 :6 概述，v1 Priority 节漏网；DECISIONS.md:9 D1 r59 明文「内部档同步对齐」
- **损害**：AGENTS.md 是所有 agent/审计首读文档，v1 Priority 的第一优先级措辞与已收回的对外承诺继续漂移，传染后续回执与文案（r68 已修 :6 同款问题，:43 属同批漏改）
- **修法**：AGENTS.md:43 改「零账号·零 API key + 深度总结质量」或「低门槛 + 深度总结质量」
- **复核**（confidence: high）：逐字核实成立：main@015e8d2 下 AGENTS.md:43 原文「**零配置 + 深度总结质量。** 其余一切（daemon、全文搜索、Windows、marketplace……）都是 v2+，见 DECISIONS.md。」；而 DECISIONS.md:9 D1 r59 明文「对外口径为『零账号 · 零 API key · 一键深度阅读』——『零配置』字面承诺已于 0.1.2 期间收回（本机组件需一次终端安装），内部档同步对齐」。同文档 AGENTS.md:6 已改为「零账号 · 零 API key（本机组件需一次终端安装，见 D1 r59 修订）」，README.md:12/19 也已是「零账号 · 零 API key」——即同批修订确实漏掉了 v1 Priority 节这处，:43 是仓库对外承诺口径收回后仅存的「零配置」居首表述（DECISIONS.md:86 是历史否决理由引述，不算承诺）。结论不被证伪，确属 D1 r59「内部档同步对齐」的漏网。但影响仅限 agent/审计首读文档的措辞漂移，无运行时、无用户可见面，一行修复，按分级口径（low=瑕疵）severity 应从 medium 下调为 low。

### C2. [CRITICAL] curl 主线今天必 E404，且远端脚本连 E404 排障条都没有——修复躺在未推送的 85 commits 里（挂账第 10 轮续计）

- **证据**：远端 origin/main install.sh 钉 @0.1.3（registry 仅 0.1.2）；git diff origin/main...HEAD 显示 E404 排障 bullet（install.sh:47）是本地未推新增（ce3e90f）
- **损害**：新用户照面板复制 curl 命令必失败，且远端失败提示只有 EACCES/nvm/网络三条，E404 对不上任何一条——用户无从判断，直接流失。发布链修复已就绪但 85 commits 未推，用户等不到
- **修法**：推送 + npm publish 0.1.4（用户凭证操作，已递延 10 轮）
- **复核**（confidence: high）：实测四项证据全部成立：1) origin/main:install.sh:43 钉 `npm i -g @aaione/ai-page-dive@0.1.3`；2) npm view @aaione/ai-page-dive versions 实测 registry 仅 ["0.1.2"]——0.1.3/0.1.4 均未发布，curl|sh 主线对新用户必 E404；3) 本地 HEAD install.sh 已改钉 0.1.4 并含 E404 排障 bullet（ce3e90f），但 git log origin/main..HEAD 实测 85 条未推送，git diff origin/main...HEAD 确认 E404 bullet 为本地新增——远端失败提示仅 EACCES/nvm/网络三条，E404 无对位；4) packages/host/package.json 版本 0.1.4 未 publish。安装主线是产品唯一入口，新用户 100% 失败且提示误导，critical（承诺公开违背/用户必然流失）成立；发现已如实定性为发布链挂账（推送+publish 0.1.4 为必要修复），无夸大。

### C3. [HIGH] npm 折叠备选线同根必 E404：钉 manifest 版本 0.1.4，registry 无此版；FAQ E404 逃生口指向零 release 的空页

- **证据**：Onboarding.tsx:14 npmCmd 钉 @${manifest.version}=0.1.4；FAQ（Onboarding.tsx:199）指路 github.com/aaione/ai-page-dive/releases 确认——仓库零 tag，releases 为空页
- **损害**：「curl 走不通」的用户按面板指引换 npm 路线，得到同一个 E404；按 FAQ 进 releases 求确认，看到空页面——两条官方路径全部死路，且提示语「稍等几分钟重试」对三周未发的版本是空等
- **修法**：发版（根治）；过渡期文案给降级出路：手动 npm i -g @aaione/ai-page-dive@0.1.2 可用（MIN_HOST_VERSION=0.1.0，sw.ts:15，0.1.2 过闸仅触发升级建议不阻断）
- **复核**（confidence: high）：Onboarding.tsx:14 npmCmd 钉 `@aaione/ai-page-dive@${chrome.runtime.getManifest().version}`，manifest.json:5 版本 0.1.4；npm registry 实测仅有 0.1.2（dist-tags latest=0.1.2），0.1.4 必 E404。Onboarding.tsx:199 FAQ E404 逃生口指向 GitHub releases，实测 tags=[]、releases=[] 空页；「稍等几分钟重试」对未发版无效。sw.ts:15 MIN_HOST_VERSION='0.1.0'，fix 前提（0.1.2 可用）属实。且 install.sh:43 同样写死 @0.1.4，curl 主线也死——比发现更重。唯一缓冲是 0.1.4 可能尚未发上 CWS、现网暴露面有限，故 high 恰当不拔 critical。

### C4. [CRITICAL] README/install.sh 钉 @0.1.4 但 npm 仅 0.1.2——新用户照文档装必 E404（发布链 critical 续挂第 10 轮，非新发现）

- **证据**：README.md:46 与 install.sh:43 均写 `npm i -g @aaione/ai-page-dive@0.1.4`；npm registry dist-tags.latest=0.1.2（主编实测基线）
- **损害**：文档承诺的安装命令对真实新用户必然 404，一键安装主流程在公开口径上不成立
- **修法**：发布 0.1.4 到 npm 或将文档/脚本钉回已发布版本（用户凭证操作已递延 10 轮）
- **复核**（confidence: high）：证据逐字属实：README.md:46 `npm i -g @aaione/ai-page-dive@0.1.4`、install.sh:43 `if ! npm i -g @aaione/ai-page-dive@0.1.4; then`，另 README.md:36/74 还有多处同钉 0.1.4。仓库 packages/host/package.json:3 version=0.1.4，说明是「已 bump 未发布」。实测 npm registry：`npm view @aaione/ai-page-dive` 返回 versions='0.1.2'、dist-tags.latest='0.1.2'——0.1.4 不存在于 registry。结论成立：新用户照 README 或 curl|sh 主流程安装必然 E404。唯一缓解是 install.sh 对 E404 有友错误提示（「版本可能尚未发布……稍等几分钟重试」），但这只解释失败、不能让安装成功，一键安装主流程在公开口径上确实不成立；且提示语暗示「刚发版窗口期」，实际是 0.1.4 从未发布，误导用户空等。severity 维持 critical：面向全部新用户的公开安装承诺违背，非特定场景。

### C5. [MEDIUM] CHANGELOG r69「测试 229 → 235 用例（r69）：帧锚三用例」delta 不可导出——r67 批 3 个用例从未入账

- **证据**：CHANGELOG.md:53；d146ad2 后 195aeac/feadfc7/e0e9a66 各 +1 用例（git diff 计 it() 各 +1），20ac0a6 +3。229+3=232≠235，差额 3 条无出处
- **损害**：r61「计数必须可逐字导出」制度第 4 次触线：终数 235 虽对（pnpm test 实测 235/25 文件），但增量归因造假——r67 批 3 用例被悄悄计入 r69 名下，审计轨迹失真
- **修法**：改为「229 → 232（r67 三用例）→ 235（r69 帧锚三用例）」或等效分列
- **复核**（confidence: high）：CHANGELOG.md Unreleased Docs 末行原文「测试 229 → 235 用例（r69）：帧锚三用例（panel-ready 异窗回包锚 / summarize 内容源帧锚优先 / 帧锚误杀向鉴别 + 对照）」——数字差 +6 但只点名 3 用例。git diff 实测（d146ad2 之后）：195aeac +1 it()、feadfc7 +1 it()、e0e9a66 +1 it()（三者均为 r67 批），4b27a9b +0，20ac0a6（r69）+3 it()（逐条核对正是「panel-ready 异窗回包锚 / summarize 内容源帧锚优先 / 误杀向鉴别」三个，与 CHANGELOG 点名一致），6256a70/015e8d2 +0。229+3+3=235 终数正确，但 r69 名下 +6 中 3 条实为 r67 用例。r67 入账 commit dc36bf0 的 diff 只加 4 条 Fixed 文字、无任何测试计数 delta，README/AGENTS 停在 229 直到 015e8d2 一次跳 235——r67 三用例从未入账属实。无替代解释（「对照」即使算 1 条也仅 4，对不上 +6）。审计轨迹归因失真、触 r61「计数可逐字导出」制度，但不影响运行时且终数正确，medium 恰当。

### C6. [CRITICAL] 发布链三版本断链第 10 轮：新用户 curl 装机即 npm E404，远端 CI 推定红

- **证据**：install.sh:43 `npm i -g @aaione/ai-page-dive@0.1.4`（本地）；实测基线：registry latest=0.1.2、远端 install.sh 钉 0.1.3、本地领先 85 commits 未推、零 tag
- **损害**：新用户按 README 跑 curl 装 0.1.3，registry 无此版直接 E404，装机当场失败、onboarding 必死；远端 main 钉 0.1.3>registry 0.1.2，按 check-published.mjs 逻辑远端 CI 已红且持续无人修，门禁沦为背景噪音；老用户重跑 install.sh 同样 404，升级路径全断
- **修法**：一次完成三连：npm publish 0.1.4 → git push（85 commits）→ 打 v0.1.4 tag；此后发版纪律固化为升版即三连，杜绝跨轮递延
- **复核**（confidence: high）：逐项亲自核实，证据全部成立：1) 本地 install.sh:43 逐字为 `if ! npm i -g @aaione/ai-page-dive@0.1.4; then`；2) `git fetch origin` 后取 origin/main:install.sh 第 43 行钉的是 `@aaione/ai-page-dive@0.1.3`，与「远端钉 0.1.3」一致；3) 实测 registry.npmjs.org：dist-tags.latest=0.1.2，versions 仅含 0.1.2——0.1.3/0.1.4 均不存在；4) `git log origin/main..main` = 85 commits 未推，本地 tag 与 `git ls-remote --tags origin` 均为 0；5) check-published.mjs 逻辑读 packages/host/package.json 的 version 作 pinned（远端=0.1.3），与 registry latest(0.1.2) 不等即 `process.exit(1)`，故远端 main 的 ci.yml 第 46 行该步必红，与「远端 CI 推定红」吻合（脚本头注释还自证 r55 时就发生过同款：registry 停 0.1.2、仓库钉 0.1.3）。影响链成立：README 主路径 curl|sh 拉 origin/main 的 install.sh → npm i -g @0.1.3 → registry 无此版 E404 → install.sh `exit 1`，新用户装机当场失败（脚本虽有 E404 友好提示指向 releases，但 releases 也无任何 tag，重试无解）；老用户重跑同样 404，升级路径同断。唯一的缓解性提示文案不能改变安装必然失败的事实。severity=critical 成立：公开承诺的安装流程对所有新用户必然失败，属承诺公开违背。

### C7. [MEDIUM] CHANGELOG 版本账错位：0.1.4 段不含 r66-r69 修复，Unreleased 堆 4 轮改动

- **证据**：CHANGELOG.md:55 `## [0.1.4] - 2026-10-06`（仅 r59 批）；:8 `## [Unreleased]` 载 r66-r69 全部修复（npmCmd 拆行/一致性断言/测试 229→235 等）
- **损害**：本地已钉 0.1.4，若按现状 publish，发布的 0.1.4 代码实含 Unreleased 所列改动而 0.1.4 段不载——用户对着 CHANGELOG 排障时条目与实物不符；或被迫再跳 0.1.5，版本语义继续稀释
- **修法**：发版前把 Unreleased 的 r66-r69 条目并入 0.1.4 段（或明确升 0.1.5 并同步 check-version 七处钉点）
- **复核**（confidence: high）：CHANGELOG.md:8 `## [Unreleased]` 载 r60–r69 全部修复（r69 条目含 npmCmd 拆行、package-cws --check-only 一致性断言、Docs 尾条"测试 229 → 235 用例（r69）"逐字核实）；`## [0.1.4] - 2026-10-06` 段仅 r59 批；packages/host、packages/shared、apps/extension 三处 package.json 均钉 0.1.4。实测 npm registry：@aaione/ai-page-dive 仅有版本 0.1.2（latest=0.1.2），0.1.3/0.1.4 从未发布——即 CHANGELOG 已写带日期的 0.1.3/0.1.4 段而实物不存在，比原发现更重；且 CHANGELOG r68 入账条目自证"远端 install.sh 钉 0.1.3 双版本 E404"，版本账错位已在安装链造成过用户可感 404。若按现状 publish 0.1.4，发布代码实含 Unreleased 所列改动而 0.1.4 段不载，影响推导成立。替代解释（Unreleased 堆积是 Keep a Changelog 标准发版前姿势）被"版本段已带日期预写、版本号已钉"的事实削弱。medium 恰当：条件于发版动作的特定场景损伤，非主流程可感。

### C8. [LOW] package-cws 一致性断言只查 version/description 两字段，permissions/name/icons 漂移漏网

- **证据**：scripts/package-cws.mjs:37 `for (const k of ['version', 'description'])`；:22 required 不收 action.default_icon
- **损害**：改 permissions（含 optional_host_permissions）后未重建 dist，check-only 因两字段未变照绿，zip 带旧权限上架——权限错位正是 CWS 审核最敏感打回点，且用户看到的授权提示与源码声明不符
- **修法**：一致性断言升级为 dist↔public manifest 全对象 deep-equal（或至少加 name/permissions/optional_host_permissions/icons）；required 补收 action.default_icon
- **复核**（confidence: high）：证据逐字属实：scripts/package-cws.mjs:37 确为 `for (const k of ['version', 'description'])`，:22 required 确为 ['manifest.json','sidepanel.html','background.js']（+content_scripts.js+icons 值），不收 action.default_icon。全仓搜过无别处做 dist↔public manifest deep-equal，CI（.github/workflows/ci.yml 22 腿）也是先 `pnpm -r build` 再 `package-cws.mjs --check-only`，即该一致性断言本身就是唯一的「dist 陈旧哨兵」，且哨兵只嗅 2 个字段——这是真实覆盖缺口。但影响推导被三重削弱：1) action.default_icon 与 manifest.icons 引用的是同一组 icon-16/32/48/128.png（实测 public/manifest.json 两处路径完全相同），:24 的 icons 循环已把这 4 个文件断言在盘，default_icon 子论点今日零实效；2) CWS 发布新包必须递增 version，而 version 恰在哨兵内——任何真实上架动作必触发哨兵强制重建，「zip 带旧权限上架」路径实质被堵死，只有「改权限不 bump version 只传草稿/本地装」的边角场景漏网；3) CI 内先 build 后 check，漂移不可能在 CI 发生，风险仅剩本地跳过文档明令的完整两段构建这一种叠加误操作。结论：事实成立、属发布工程加固项而非可感损伤主路径，severity 从 medium 降为 low。

## 驳回的发现（对抗验证 isReal:false，1 条）

### R1. [MEDIUM] SW 版本横幅命令仍用 && 拼接——r69 在 Onboarding 明确消灭的「第一条失败静默吞第二条」同场景在升级指引里存活

- **原证据**：sw.ts:487/495：`npm i -g @aaione/ai-page-dive@${version} && ai-page-dive install --ext-id …`；Onboarding.tsx:11-13 r69 注释明确 && 拼接时 npm i 失败→登记未发生，属 r58#24 三次复发族
- **驳回理由**：证据引述逐字属实：background/sw.ts:487/495 确为 `npm i -g @aaione/ai-page-dive@${version} && ai-page-dive install --ext-id …`，Onboarding.tsx:11-14 r69 注释存在且 npmCmd 已拆两行。但影响推导不成立：sw.ts 横幅仅在 probe 返回 r.ok && r.hostVersion 时触发（host 已装且 ext-id 已登记，否则走 Onboarding 的 not-installed/forbidden 路径），第二条 install --ext-id 是幂等补登记，被 && 吞掉不产生任何状态缺失；横幅判据是重新 probe 的 host 版本号，不存在 Onboarding 的 90s 卡装检测误诊链路；且 npm i 失败本身会打在终端、横幅已内嵌「若报 E404 稍后重试」预期管理。r69 消灭的是「登记静默缺失→误诊 Chrome 未重启」，升级横幅两条都不沾，只是与 r69 形态不一致的风格差异。
- **终判**：not-a-bug（confidence: high）

## low 批（8 条，不走对抗验证）

- **L1. dist-e2e/manifest.json 含 host_permissions:<all_urls>，与硬约束①字面冲突**（decisions）——apps/extension/dist-e2e/manifest.json:49-50 "host_permissions":["<all_urls>"]（public/manifest.json 无此键，仅 :15 optional_host_permissions）
- **L2. uninstall 子命令缺 root 守卫——install/postinstall 有 assertNotRoot，防线不对称**（install）——install.ts:128 assertNotRoot('install')；uninstall.ts 全文（25 行）无 assertNotRoot 调用
- **L3. 取消发生在提取窗口（pending 期）时 tips 显示「已分享」——r69 同类语义不实的反向残余**（ux）——SummarizeView.tsx:651 failed 链排除 cancelled；:1245 `failed ? '分享未成功' : '已分享'`——pending 期点停止，SW 回 cancelled（App.tsx:832 cancelled:true），页面实际从未交给 CLI，tips 终局却显示「已分享
- **L4. 过期 task-error 帧分支 error 硬编码「已取消」，与 r69 新增的 cancelled 标记可自相矛盾**（ux）——App.tsx:626 mismatch 分支 `error: '已取消', isError: true, cancelled: m.code === 'cancelled'`——过期 timeout/parse 帧也渲染视觉「已取消」，但 SummarizeView.tsx:575 sr-only 按 cancell
- **L5. Settings 删除模式与 HistoryView 删除条目的两步确认缺 sr-only 播报——r46 C6 修过的问题在别处未同谱**（ux）——SummarizeView.tsx:511-513 confirmNew 配 `<span className="pd-sr-only" role="status">再次点击以确认…`；Settings.tsx:547 删除按钮仅文字变「确认删除（不可恢复）」，HistoryView.tsx:298 仅 aria-la
- **L6. 探测在途期顶栏已渲染「重试检测」按钮，与 placeholder「正在检测本机 CLI…」并存**（ux）——SummarizeView.tsx:1277 `!clis.length && !agentsLoaded` 显示「正在检测本机 CLI…」；:541 重试按钮条件仅 `usable.length === 0`（不含 agentsLoaded），探测在途即出现
- **L7. AGENTS.md v1 Priority 仍写「零配置」，与 D1 r59 修订「内部档同步对齐」相悖**（docs）——AGENTS.md:43「**零配置 + 深度总结质量。**」；DECISIONS.md D1 r59 修订：「零配置」字面承诺已收回，内部档同步对齐
- **L8. PRIVACY「仅读取 model 一个字段」表述与实现不符（实读两个路径）**（docs）——PRIVACY.md:16「仅此一个字段」；claude.ts:102-103 `s.model || s.env?.ANTHROPIC_MODEL`

## 亮点（strengths）

- 本地工程内核扎实：安装链幂等/origins union/原子写/四态退出码，host 薄壳行数红线由 CI 断言钉住，235 用例实跑通过（含真实流 fixture 重放与 SW 回归网），零凭证接触等硬约束代码核实成立
- UX 成熟度高且修复真实：r69 四项（tips 第四态判定链/复制按钮 aria 三态/技能开关状态名谱/cancelled 终局分流）全部逐字落位，主流程错误/空态/加载态覆盖完整，仅余 4 条 low 级语义与 a11y 残余
- 决策与隐私一致性可审计：九大决策（D1-D9）逐条对上实现、opencode 下架有锚、PRIVACY 零遥测/零服务器/零凭证三条「不做」承诺代码层面成立，多引擎能力诚实标「未实施」而非注水

## topIssues（终审排序）

1. 发布链三版本断链第 10 轮——新用户 curl 主线装机即 npm E404，产品唯一入口对全部新用户关闭，修复就绪但 85 commits 未推、零 tag
2. npm 备选线同根 E404 且 FAQ 逃生口指向零 release 空页——两条官方路径全部死路，「稍等几分钟重试」对从未发布的版本是误导性空等
3. CHANGELOG r69 计数增量归因失真（229→235 实为 r67 批 3 例 + r69 三例）——r61「计数必须可逐字导出」制度第 4 次触线，审计轨迹可信度持续失血
4. CHANGELOG 版本账错位：本地已钉 0.1.4 但 r66-r69 修复全堆 Unreleased——按现状 publish 将发布与 0.1.4 段条目不符的实物，或被迫再跳 0.1.5 稀释版本语义
5. AGENTS.md:43 v1 Priority 仍以已收回的「零配置」居首——D1 r59「内部档同步对齐」漏网，宪法文档措辞漂移持续传染后续回执与文案
