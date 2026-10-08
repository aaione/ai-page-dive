# PageDive 产品质量终审报告（第五轮 · r63 · workflow 对抗验证制）

> 审计日期：2026-10-08 · 方法：双 workflow（5 维度并行审计 → 每条 non-low 发现独立对抗验证 → 终审合议），resume 补跑制
> 基准 HEAD `b29f624`（main，本地领先 origin/main **64** 提交），版本钉 0.1.4（registry 实测停 **0.1.2**，零 tag）
> 上轮基线：`reports/2026-10-07-r62-product-audit.md`（r62 判 7.6「否」）

## 头条裁决

**否，且降档至 7.2。**（r62 为 7.6）

r62 改判硬条件 = 发布链三连（`npm publish` → `git push origin main` → `git tag v0.1.4`），本轮逐条实测对账：**三连一步未执行**。registry 仍只有 `["0.1.2"]`；断口从 59 扩到 64 提交；`git ls-remote --tags` 零输出。且本轮对抗验证挖出比 r62 更硬的证据：**远端 origin/main 的 install.sh:43 钉的是 `@0.1.3`——同样不在 registry**，即 0.1.2→0.1.3 已先断一轮，不必等 0.1.4 推送，当前公开的一键安装命令已经在挂；E404 安慰文案（「刚发版有窗口期…到 releases 确认」）指向的 releases 页零 tag 零 release，指引自查即穿帮。

工程侧持续兑现：r62 三条 medium（授权拒绝显式反馈 / 追问 15s 对账兜底 + CHANGELOG 补账 / CWS zip 打包守门）经对抗验证确认真修；219 测试、PRIVACY 逐条可溯源、安装脚本工程近满分。**产品内核是好的，交付意志是缺的**：连续第 5 轮停在「差的只是 10 分钟」。入口死路压过面板内一切打磨——产品对目标用户（零配置非开发者）实际不可达。

> 审计方法留痕：本轮两次跑批（首轮 3/5 维度交卷，resume 补齐 ux/release 后 5/5；中间一次 0-token 瞬时基础设施故障重试恢复），合计 31 agent 次，0 驳回。发布态断言全部亲测（`npm view` / `git ls-remote` / GitHub contents API），复核员并修正了一处维度审计的失实表述（「curl 主线 E404」实为 install.sh 拉取可达、断裂点在 npm i 版本 E404——影响结论不变、归因更准）。

## r62 改判条件兑现核对

| r62 改判条件 | 本轮实测 | 判定 |
|---|---|---|
| npm publish 0.1.4 | `npm view @aaione/ai-page-dive versions` → `["0.1.2"]` | ❌ 未执行 |
| git push origin main | `git rev-list --count origin/main..HEAD` = 64（r62 为 59，断口扩大） | ❌ 未执行 |
| git tag v0.1.4 | `git ls-remote --tags origin` 零输出 | ❌ 未执行 |
| （新增恶化项）远端 install.sh 钉版 | `git show origin/main:install.sh` → 钉 `@0.1.3`，registry 无 0.1.3 | ❌ 已先断一轮 |

## 维度得分表

| 维度 | r63 | r62 | 要点 |
|---|---|---|---|
| 决策一致性 | 8.0 | 9.0 | D1-D9+修订逐条落实、破线应急清单自洽可执行✅；扣分：D10 安装主线实质断裂（critical 遗留）+ 3 条 low 宪法文档滞后（D3 漏 storage/开关入口未记/注释残留） |
| 安装旅程 | 7.0 | 7.5 | 脚本工程近满分（四态退出码/PATH 兜底/幂等/原子写，r62 三条 medium 已修）；公开可达的安装通道为零 |
| UX 完整性 | 7.0 | 8.2 | 面板内打磨优：授权拒绝三分支反馈、追问 15s 对账兜底、历史删除/搜索空态闭环；入口死路压过面板内一切 |
| 文档兑现 | 7.5 | 8.0 | 措辞水分罕见干净：PRIVACY 逐条有代码证据、CHANGELOG 抽 6 条全可从 diff 导出；扣分在安装链失实持续 + 4 条 low |
| 发布就绪 | 6.0 | 6.5 | zip 守门兑现（package-cws.mjs 已出 v0.1.4 zip）；发布链三连未执行、守门脚本锁本地从未运行、CWS 材料零就绪 |

## 确认问题清单（去重归并后：1 critical / 3 high / 1 medium / 10 low 存活；驳回 0）

> 原始 13 条确认中 5 条为发布链 critical 的跨维度重复、3 条 CWS 材料、3 条 npm&&兜底，已归并。

### critical（1）

1. **[r62 遗留] 发布链三连未执行——一键安装全网必 E404，断口 59→64 继续扩大**。registry 实测仅 `["0.1.2"]`；远端 `origin/main:install.sh:43` 钉 `@0.1.3`、本地钉 `@0.1.4` 均未发布；README:33/36/45 全部安装路径同钉 0.1.4；零 tag 且 E404 文案指向空 releases 页（误导性安慰）；`check-published` 门禁不在 origin、从未运行一次。对抗验证修正归因：install.sh 拉取本身可达（GitHub contents API 200），断裂点精确在 `npm i` 一步版本 E404，无降级路径。**修复动作约 10 分钟：`npm publish` → `git push origin main` → `git tag v0.1.4`（顺序不可反），push 后确认 CI 首跑（check-published 此刻会红，恰好倒逼先 publish）。**

### high（3）

2. **[r62 遗留] 扩展本体无普通用户安装通道——README 步①仍要求 git+Node+pnpm+开发者模式**（README:28）。非开发者在第一步即卡死；README:10 已预留 CWS 上线后反转步① 的注释位。对抗验证证伪了原 why 中「curl 主线 E404」的归因（拉取可达），但版本断链实锤更强，high 维持。
3. **[r62 遗留] CWS 上架材料零就绪——打包守门有了，上架本体仍无通道**。实测 `store/` 目录不存在、全仓无截图/listing/逐权限 justification；a74e562 只加了 `scripts/package-cws.mjs`（zip 产物守门，非上架材料）。nativeMessaging + optional `<all_urls>` 恰是 CWS 人工审核最易打回组合，无预案则上架时间不可控。修复：建 `store/`（中英 listing、≥1 张 1280x800 截图用 dev harness 拍摄、以 PRIVACY.md 为底稿扩写逐权限 justification 表）。
4. **[r62 遗留] 三个发布守门脚本全部锁在未推送提交里，从未运行一次**。`git ls-tree origin/main scripts/` 无 check-published/check-install-dist/package-cws；本地 ci.yml:44 有 check-published 步但 origin ci.yml 无。防忘发版/dist 断链/版本漂移对远端 main 与 PR 实际零拦截，无机器报警。修复：随 push 一并到位。

### medium（1）

5. **[r62 遗留] npm 备选命令裸 `&&` 串联，无 command-not-found 兜底——r58#24 同场景第三次复发**（Onboarding.tsx:11/14）。自定义 npm prefix 且 curl 通道不通的用户两条出路均撞 PATH 缺失：npm 装成功但 `ai-page-dive` 不可执行、`&&` 短路、登记未发生、面板零自愈提示。修复：FAQ 补 `npm prefix -g` → export PATH 一条，或改 npx 形式。

### low（10）

6. [decisions] DECISIONS D3 权限清单漏记 `storage`，宪法两文件不同步（DECISIONS.md:11 vs AGENTS.md 五权限）
7. [decisions] D3 写「设置页开关」，实现已迁至授权出错气泡，DECISIONS 未同步（DECISIONS.md:11 vs SummarizeView.tsx 实装位）
8. [decisions] SummarizeView.tsx:104 注释残留「零配置支柱」旧口径
9. [install] wrapper 钉死 node 绝对路径，nvm 升级后三段回退全部落空（install.ts:23 正则只匹配 brew Cellar 路径）
10. [ux] PDF 页面板侧未前置 URL 预判，placeholder 仍展示无效 CTA（sw.ts:969 已有 PDF URL 分型但 panel 未消费）
11. [docs] README 档位列举漏第五档 product-audit（README:22 vs workflow-labels）
12. [docs] PRIVACY 权限表自述与 manifest 字面冲突（PRIVACY.md:42 activeTab 行写「不申请 `<all_urls>`」的表述与 optional_host_permissions 并存易误读）
13. [docs] CHANGELOG Unreleased 缺 a74e562 入账（CWS 打包守门脚本 + 破线应急清单）
14. [docs] 测试套件存在偶发红：同日两次实测一次 `1 failed | 218 passed`（需代码侧定位，见代码终审报告）
15. [release] package-cws.mjs 守门兑现但纯手工前置，无自动挂钩（建议 package.json 加 `package:cws": "pnpm build && node scripts/package-cws.mjs"` 封死顺序）

## 被驳回发现（0）

无。但记录一处维度审计失实被复核员纠正：「curl 主线 E404」（raw.githubusercontent 拉取失败）系复核沙箱网络层 ECONNRESET 误判，GitHub API 实测 install.sh 可达——归因修正后结论不变。

## Top 5 必修（投入产出排序）

1. **发布链三连**（critical#1）：10 分钟，`npm publish → push → tag`，一键安装从全网必挂变为可用——连续 5 轮唯一硬改判条件。
2. **守门脚本随 push 到位**（high#4）：零额外工作量（就在未推送提交里），push 后 CI 自动执法防复发。
3. **CWS 材料开工**（high#3）：消灭「无普通用户通道」的唯一路径；nativeMessaging+`<all_urls>` 组合需提前准备 justification 预案。
4. **npm 备选命令兜底**（medium#5）：一条 FAQ 文案的事，r58#24 第三次复发了。
5. **宪法文档同步三笔**（low#6-8）：D3 漏 storage/开关入口/注释残留，半小时内可清。

## 终审一句话

内核值得发布、面板打磨真实、文档罕见干净——但连续第 5 轮，公开承诺的一键安装对全网新用户 100% E404，且断口还在扩大：**publish → push → tag 三连完成前，一切质量只在本地空转。**
