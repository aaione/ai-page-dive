# r77 双终审迟到收割报告（code + product，r82 后对账）

- 日期：2026-10-16（发起于 2026-10-12 r76 收官后，session 中断 4 天后收割）
- 审计对象：发起基线 HEAD `c43aab3`（r76 后）——**收割时仓库已被并行推进至 r82**（HEAD `03bd069`，26 commits：r77b/r78/r79/r80 批 + r81 双审修批 + 0.1.4 发布链闭合 + r82 上架前终裁）。审计员实测抓获基线漂移并自适应，本报告按 r82 现状口径出账。
- 方法：双 workflow（code 6 维 9 agents/369k tokens + product 5 维 10 agents/323k tokens），每 non-low 发现独立对抗复核（默认怀疑立场、file:line 亲验、node 实跑重现），tests 维度授权变异自证。
- 正面结论：r76 批 7 项修复全部验证成立；发布链已闭合（registry latest=0.1.4 = install.sh 钉版 = tag v0.1.4，CI check-version/check-published 双腿在跑）；292 用例全绿；host 红线 2199/2200 内；DECISIONS 9 决策零违背；r76 批 8 commits CHANGELOG 入账无漏无多、措辞可逐字导出。

## 三分收集

| 侧 | dims | confirmed | rejected | lows | unfetched |
|----|------|-----------|----------|------|-----------|
| code | 6/6 | 2 | 0 | 8 | 0 |
| product | 5/5 | 4 | 0 | 7 | 0 |

终判：code 7.5/否（无发版阻断）；product 9/是。主编终裁阶段再剔除 product low `r77-install-1` 一条（evidence 前提「registry 无 0.1.4」实测已被推翻，风险随发布链闭合自消）。

## 一、新立案（r81/r82 账面均未覆盖）

### N1（medium）vitest 全量套件偶发红未定位——terminal.test.ts 三戳族为复核修正后的首要嫌疑，本机磁盘 92% 满是已证放大器

- 同命令多跑六跑三红（原 finding 三跑 + 复核员三跑各自独立复现）；复核员修正定位：失败用例均落在 `apps/extension/src/sidepanel/terminal.test.ts`（「stampTerminal 终局三戳 > r72 收编 content-mismatch」与「r81 键域互锁 > C8：UNDELIVERED_CODES 全集逐成员」），单文件跑 20/20 绿（692ms）——时序/并发负载敏感；原嫌疑 task-watchdog.test.ts 在红跑中反而全绿。
- 环境混杂因素（亲测证实）：本机数据卷 92% 满（16Gi avail），红跑日志出现真实 `ENOSPC: disk full` history persist 失败；首红跑 tests 耗时 126.69s vs 绿跑 77.97s（+63%）。真时钟长跑用例（task-timeout.test.ts:17 / task-watchdog.test.ts:70 硬上限 9s）在满负载并行下亦超窗假红（T-1）。
- 修向：排查 terminal.test.ts 三戳族的并发文件间状态污染；CI 落盘失败用例名（`--reporter=json`/verbose）；真时钟用例放宽 jasmineTimeout 或并发隔离；**清本机磁盘**（ENOSPC 已实际干扰测试落盘，非仓库 bug 但持续污染审计信号）。

### N2—N9（low，8 条）

| # | 位置 | 缺陷 | 修法 |
|---|------|------|------|
| N2 | `App.tsx:844-865` | send 回调先到时终局不记 finished 台账，跨通道到达顺序反转时双气泡第三路径复发（r76-E 去重设计的漏网点；复核降 medium→low：窗口极窄、下次发送自愈） | 回调终局返回对象补 `finished: [...s.finished, resp.taskId].slice(-8)`（一行） |
| N3 | `packages/host/src/task.ts:328-335,459-465` | 失败轮历史痕迹只覆盖 is_error 族——runtime-error/parse 轮零产出不落盘、有产出无失败标记，用户无法区分「部分总结」与「中途崩溃」（r76-B 修全性缺口） | runtime-error/parse 轮对齐 is_error 的 errorText 入册豁免 |
| N4 | `task.ts:290-292` | timeout 路径唯一逆序：先发终局帧后落盘（isError/gotResultOk 均 await-先落盘）——慢盘 + 立即断连时 timeout 轮历史丢失，3.2s 收割窗是唯一兜底 | 对齐另两路径先 persist 再发终局 |
| N5 | `task.ts:376,383,386,454-467` | errorText/stderrTail 按 UTF-16 码元截断可切半代理对且无截断标记，同仓 stdio.ts:165-167 已有回退+标记范式未对齐 | 照搬 stdio.ts 截断范式 |
| N6 | `Settings.tsx:211` + `App.tsx:695,1119` | 「未知错误（码 X）」兜底格式三处内联拷贝已现微漂移——r72/r80/r81 三轮缺键债均在此域发生 | 格式串并入 terminal.ts 导出（如 `unknownLabel(code)`）收口 |
| N7 | `sw.ts:521` + `App.tsx:1047` | E404_HINT 的 Issues 出路是裸文本 URL——横幅纯文本 span 不可点击、无协议前缀，新用户需手抄 37 字符；Settings/Onboarding 既有链接化惯例未对齐 | 横幅 URL 链接化或给可点击按钮 |
| N8 | `App.tsx:831` | 注释陈旧：称 START_FAIL_LABEL 14 键，HEAD 实为 15 键（r81 M3 增补 host-not-found） | 改 15（顺手修） |
| N9 | 制度面两条并案 | ① 产物级声明盲区：CHANGELOG r76-F「zip 重打包 + check-only 双绿」不可从版本库复核（zip 被 gitignore、输出无存档），且 r82 已实证该包结构合规但内容带病（P1）——产物打包声明应附 check 输出存档或 zip 指纹，否则降格「已执行未验证」；② 发版顺序半制度化：CI 双腿消解了 publish 断链主风险，但 tag 打点与 zip 重打包两步无 runbook 无门禁，「zip 内容=代码终态」全靠人工（R77-REL-1 即活例） | 发版 runbook 补 publish→install.sh→push→tag→重打 zip 全序 + zip 指纹入账 |

## 二、交叉确认与挂账去重

- **r82 P1 复制命令 bug**：ux-1 ≡ R77-REL-1 与 r82 终裁三 workflow 独立撞车，node 重放切片 + zip 解包哈希亲验（background.js/sidepanel.js/manifest.json 与 dist 逐一相同）——P1 未修、未重打包，**提审前必修清单维持 r82 口径不变**。
- **C1 host 余量 1 行**（2199/2200）：≡ r82 挂账 C11，不重复计。
- **基线漂移族**（Q1 ≡ R77-DOCS-1 ≡ r77-decisions-1 ≡ T-2）：编排侧元发现，对仓库无行动项；其价值是阻止了按 r76 快照出反事实报告（会把已闭合的发布链再报「双断 + 递延 17 轮」）。
- **r77-install-1**：主编剔除——「SW 升级提示指向 npm 不存在的 0.1.4」前提已随 0.1.4 发布失效。

## 三、遗留观察

- **raw.githubusercontent CDN 暂态**：git 权威源 install.sh 已钉 @0.1.4，但 CDN 仍缓存钉 0.1.3 旧脚本（复核员两次实抓均旧；0.1.3 从未上 registry）——缓存过期前新用户 `curl|sh` 仍 E404 且拿到旧文案。下轮复查。
- **本机磁盘 92% 满**：非仓库缺陷，但 ENOSPC 已实际干扰测试与审计信号，建议清理。

## 四、tests 维度变异自证记录

三组 r76 补测目标（persist 零产出守卫 / runtime-error 拆码 START_FAIL 键 / 终局三戳 UNDELIVERED_CODES）5/5 变异全红（删被守代码必红，非假网）；收割后工作区 `git status` 亲测干净（Q1 复核员所见的 task.ts 瞬时修改系变异窗口，已还原）。
