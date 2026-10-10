# r68 产品终审报告（2026-10-10）

> 审计对象：`a8c0586..dc36bf0`（r67 修复批 6 提交）。5 维度：A/B 组真浏览器实驱（dev harness）+ decisions/install/docs/release 四静态维，发现逐条对抗验证。
> 跑批：单 workflow 串行（code → product）；product 批首跑 4 agents 未交卷（jsonl 诊断：真不交卷非 429），journal resume 后全量收割。25 agents，1.09M tokens。

## 终审：6.0 / 10 —— isHighQuality: **否**

| 维度 | 分 | 一句话 |
|---|---|---|
| functional-a | 8.5 | 主流程/取消/noextract 三场景实驱全过；r66 两条 low（sr-only 取消分流/tips 三态）实测兑现关账；console 零红 |
| functional-b | 9.5 | 六场景+横切零新账：还原无 frontmatter、追问语境条在位、lost 自愈、五档名一字不差 |
| decisions | 7.5 | D1-D9 全落实，「消耗订阅额度」三处口径一致互补；唯 D10 公众侧零生效（critical 共账）+ AGENTS「零配置」残留 |
| install | 5.5 | 本地安装工程近满分（四态退出码/PATH 兜底/幂等/原子写）；发布链第 9 轮未动，公众可用性 0 分 |
| docs | 6.5 | r67 四条 CHANGELOG 逐字可导出零抬升；扣分：测试数字 229 vs 232 漂移、「4 项可修 medium」计数不可导出 |
| release | 1.5 | 发布链三连第 9 轮未执行且断口扩至 81，双版本 E404；守门/CWS 材料全锁本地 |

**判词**：r66 后 6 提交在代码侧兑现良好——low 批四项（sr-only 取消分流、取消与 codex tips 三态、manifest 删「免费」、README 拆 &&）与两条 code medium（anchorTabId 帧锚、frontmatter 收口）的产品面全部真浏览器实驱关账，无抬升。但发布链 critical 第 9 轮续存且断口 74→81 扩大：registry 仅 0.1.2，本轮复核补强——**远端 install.sh 钉 0.1.3、本地钉 0.1.4 双版本均 E404**，公开安装对公众为零；3 项 high 全续存。新账 3 medium：面板 npmCmd 裸 && 与 README 漂移、dist 仍播已删「免费」文案且守门不查一致性、CHANGELOG 计数再犯措辞制度。功能已「可发布」，发布动作本身连续 9 轮为零——v1 作为产品未完成，维持「否」，6.0。

## confirmed（去重仲裁后 1 critical / 3 high / 3 medium）

### critical ×1

1. **[r66 遗留] 发布链三连第 9 轮未执行，公开安装通道双版本 100% E404**（release/install/docs/decisions 四维共账，4 条同题合并；全部复核员独立实测维持 critical）
   实测基线：registry `@aaione/ai-page-dive` versions=["0.1.2"]（dist-tags latest=0.1.2）；`git ls-remote --tags origin` 零输出；origin/main 落后本地 81 提交（r66 时 74，主编基线 80 系快照时点差，断口续扩方向一致）。
   本轮复核补强：`git show origin/main:install.sh` 第 43 行钉 `@0.1.3`（实测 E404）、本地 install.sh:43 与 README:36/46/74 钉 `@0.1.4`（实测 E404）——**registry 唯一存在的 0.1.2 与两条公开通道钉的版本全对不上**；install.sh:47 E404 指引指向零 tag 的 releases 页，同为死路。新用户复制面板 Onboarding、远端 install.sh、README npm 备选任一命令必死且零降级。
   修复顺序：`npm publish 0.1.4 → git push origin main → git tag v0.1.4 && git push --tags`（顺序不可反：push 先于 publish 会使 ci.yml check-published 首跑即红）。

### high ×3（r66 遗留三项全续存）

2. **扩展本体无普通用户安装通道**（复核分歧：一员维持 high / 一员降 medium——README 诚实披露「上架前先手动加载」临时态、v1 目标用户具备终端能力；按 r62–r66 历轮终裁口径维持 high，medium 论证记录在案）
   README:28 步①要求 git clone + pnpm 构建 + 开发者模式加载；CWS 未上架（README:10 注释自证）；GitHub API 实测 Releases 数组长度 0，零 zip。复核补强：即使开发者走完 clone+build，curl 主线也因版本 E404 断——安装链比 r66 描述更彻底地断。
3. **发布守门 CI 零远端执法，全锁本地**（两员独立实测维持 high）
   `git ls-tree origin/main:scripts/` 无 check-published/check-install-dist/package-cws（本地三文件俱在）；远端 ci.yml 仅 pnpm test + check-version + check-host-lines，零引用三守门脚本。r55/r58/r65 整条守门链从未在远端跑过一次，「防忘发版」仍靠人肉——断口 67→74→81 连续三轮扩大即机制失效实证。
4. **CWS 上架材料零就绪**（三报两裁 high 一裁 medium，2:1 维持 high；r64 起历轮口径）
   仓库根无 store/ 目录（全历史零记录）；listing 文案、1280×800 商店截图、逐权限 justification 三件核心材料为零。降级员论证：PRIVACY.md:38-45 已有中英双语权限用途表、DECISIONS:75 已预核 CWS 政策先例（KeePassXC/1Password）、package-cws.mjs 打包链在位——缺的只是 dashboard 表单材料，实际缺口小于标题。维持理由：上架是 high#2 唯一解路径，nativeMessaging+optional_host 高敏组合是人工审核高打回风险项，材料缺失使 critical 存续期不可控。

### medium ×3（本轮新账）

5. **面板 npm 备选命令仍裸 && 拼接，与 README r67 拆行口径漂移**（复核维持 medium）
   `Onboarding.tsx:11` npmCmd 仍是 `npm i -g … && ai-page-dive install …` 单行，同时喂点击复制与排障文案；README:45-47 同批已拆两行并注明 r66 理由。用户从面板（实际复制源）复制的恰是未修版：npm i 失败时第二条静默跳过、登记未发生，90s 后面板提示误导为「Chrome 未完全重启」指错排障方向。Onboarding:201-203 注释自认 r58#24 同场景第三次复发。
6. **CHANGELOG Unreleased 头「r66 code 全部 4 项可修 medium」计数不可从 diff 导出——实修 3 项**（复核维持 medium；r61 措辞制度违例，r66 medium#5 同族复发）
   CHANGELOG.md:10 自称「全部 4 项可修」，Fixed 尾部实况：:33-35 = r66 code#1/#2/#3 三个 fix 提交（195aeac/feadfc7/e0e9a66），:36 自我标号「low 批」——medium 级实修 3 项，第 4 条是 low。r66 code 报告 7 medium 中 #4 fixture/#5 UI 债/#6 复杂度/#7 协议均债型续存。无论按哪种读法「4 项」都对不上。
7. **r67 manifest 描述改动后 dist 未重建，package-cws 守门不查内容一致性**（复核维持 medium；与 r68 code low#3/#9 同题共账，product 侧加重：带上架影响面）
   dist/manifest.json（mtime 10-08）:7 仍播「免费、无 API key…」，public/manifest.json 已于 4b27a9b 改「消耗你自己的 CLI 订阅额度」；package-cws.mjs --check-only（:35 早退）只断言 manifest 声明产物在盘，不比对 dist 与 public 内容。若信「守门已挂 CI」直接打包上传，会带着已明令删除的「免费」描述上 CWS——与订阅额度事实矛盾、审核敏感。真机在用 dist 同样播旧文案。

### 主编仲裁记录

- **发布链 critical 四维共账 4 条同题**（release×2/install/docs/decisions 各一）：证据链互补（远端钉 0.1.3 / 本地钉 0.1.4 / registry 0.1.2 / 零 tag / 断口 81），合并 1 条，全部复核员独立实测维持 critical。
- **3 项 high 各有同题多报**：无普通用户通道 2 报（high/medium 分歧，按历轮终裁维持 high，降级论证记录）；守门 CI 2 报（双 high 无分歧）；CWS 材料 3 报（high/high/medium，2:1 维持 high）。
- **测试数字 229 vs 232**：初审 medium，复核降 low（纯文档数字漂移无功能损伤，行号引述有误但内容逐字属实）——按复核 severityFinal=low 收入 low 表。
- **dist 滞后与 code low#3/#9 跨报告同题**：code 侧裁 low（守门脚本缺断言），product 侧裁 medium（r67 diff 引入的新残留面 + 直接打包上 CWS 场景）——按影响面完整度取 medium，r69 一并修。

## rejected（0 条）

本轮 18 条 confirmed 全部通过对抗验证（isReal=true / confidence=high），驳回 0。复核员普遍补强而非削弱（HEAD 指认 dc36bf0→94ab499 快照漂移、断口 80→81、远端 install.sh 钉 0.1.3 等细节均系复核新发现）。

## low ×5

| # | 发现 | 出处 |
|---|---|---|
| 1 | dev harness mock usage 字段名与协议不符（usage.input/output vs inputTokens/outputTokens），token 用量展示在 harness 不可验证——订阅额度透明承诺在唯一自验路径上无护栏 | chrome-mock.ts:81 |
| 2 | 复制按钮已复制反馈不可达屏幕阅读器（title 随状态变，aria-label 恒「复制全文」） | SummarizeView.tsx:931 |
| 3 | 提取失败终局 tips 显示「已分享」——页面实际未分享给 CLI，三态缺失败分支，与 r67 修的「进行时谎言」同类语义不实方向相反 | SummarizeView.tsx:1239 |
| 4 | AGENTS.md:6 残留「零配置」措辞——D1 r59 修订要求内部档同步对齐，九轮未收口；AGENTS 是所有 agent/审计首读文档，措辞漂移传染回执 | AGENTS.md:6 |
| 5 | 测试数字 229 vs 实测 232——README 两处 + AGENTS.md 未同步（r67 增 3 用例未记），CHANGELOG 210→219→224→229 逐轮记账链断档（初审 medium，复核降 low） | README/AGENTS/CHANGELOG |

## r66 遗留核对表（product 侧）

| r66 裁决 | r68 状态 |
|---|---|
| critical：发布链第 7 轮未执行 | **第 9 轮续存**，断口 74→81；本轮补强：远端 install.sh 钉 0.1.3 亦 E404（双版本断） |
| high#2：无普通用户通道 | 续存（Releases 实测 0、CWS 未上架） |
| high#3：守门 CI 零远端执法 | 续存（远端 ci.yml 零引用三守门脚本） |
| high#4：CWS 材料零就绪 | 续存（无 store/ 目录） |
| low：sr-only 取消分流 | **实驱关账**（取消流 sr-only 播「本轮已取消」） |
| low：tips 三态 | **实驱关账**（取消后/codex 还原不再显示进行时「正在分享」） |
| low：manifest 删「免费」 | **源文件关账，dist 残留转新 medium#7**（public 已改、dist 未重建+守门不查） |
| low：README 拆 && | **README 关账，面板半边转新 medium#5**（Onboarding npmCmd 未跟） |
| low：CLI 开关 aria-label | **实驱关账** |
| low：AGENTS「零配置」 | 续存（low#4） |

## 实驱验证点（r67 修复的产品面兑现）

- **A 组主流程**：reading→thinking→4 chunk→done 渲染层级正确；取消流 sr-only「本轮已取消」+ tips「已分享」；noextract 气泡无 CLI 失败前缀、GrantRow 授予反馈在位；console 零红。
- **B 组六场景**：swcycle=claude 还原无 frontmatter 渲染、追问语境条在位；codex 还原 tips=「已分享」无追问条；lost 出「会话已失效…全新总结」自愈气泡；unsupported 发送置灰；noskills 空态不崩。
- **横切**：五档名与 workflow-labels.ts 一字不差；历史/继续对话/设置六 tab/长标题 ellipsis 全过；全页面 console 零 error/warn。

## 修复批建议（r69 优先序，product 侧）

1. **发布链三连**（用户凭证操作，不可代理）：`npm publish 0.1.4 → git push origin main → git tag v0.1.4 && git push --tags`——critical#1 + high#3 一刀全清，且是 high#2 的前置
2. medium#7：package-cws 加 dist↔public manifest 一致性断言（diff version+description，不一致拒打包）+ 上架前重跑完整两段 build
3. medium#5：Onboarding npmCmd 拆两行（与 README 同形态），顺带还 r58#24 三连复发
4. medium#6 + low#5：CHANGELOG 计数如实化（「3 项 medium + low 批」）+ 测试数字 229→232 三处同步 + 逐轮记账链补上
5. low 批搭车：#2（aria-label 随状态）、#3（tips 失败分支）、#4（AGENTS「零配置」对齐 D1 修订）
