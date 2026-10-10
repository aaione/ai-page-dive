# PageDive 产品功能深度终审报告（0.1.4 · r66 · 第八轮 · workflow 对抗验证制）

- 审计对象：main@d146ad2（r65 修复批后：e57c193 收割定向化+windowId / e29a197 形状闸 / a78a9d2 frontmatter 剥离 / 9b7a87a cancel 契约测试 / e6c0c53 package-cws --check-only+CI / d146ad2 文档）
- 基线（主编 2026-10-09 实测）：host 2196<2200；25 文件 229/229 全绿；registry `["0.1.2"]`；领先 origin 74 提交；零 tag
- 审计制：6 维并行（功能实驱 A 组 3 场景 / B 组 6 场景真浏览器实驱 + 四静态维）→ 逐条发现独立对抗验证（默认怀疑）→ 终审评委裁决。全程 5 次跑批（前 4 次死于 API 429 限额断供/速率挤爆，见文末流程记录），A/B 实驱组以终轮同 runId 补跑足额交卷

## 头条裁决

**否：6.0。**（r64 为 5.8 同向，发布死锁未解）

r64 改判条件（发布链三连）第 7 轮完全未兑现且断口 67→74 继续扩大：registry 仅 0.1.2、**远端 install.sh 钉 0.1.3 本地钉 0.1.4 双 E404**、零 tag——新用户复制面板/README 任一命令必死且零降级，「零配置一键」对公众为零，critical 维持。r65 修复批本身质量合格：frontmatter 剥离经真浏览器实驱确认兑现、README 五档名一字不差、229 口径逐字对上——但三守门脚本与 CI 步骤全锁本地，远端零执法，对外效力为零。

**产品本体功能侧近乎全绿**：实驱 9 场景全过、console 零 error/warn、决策一致性近满分（D1-D9 全落实）。工程近优而发布死锁：产品高质量 ≠ 产品高质量完成，v1 仍未向任何新用户交付。唯一新账：CHANGELOG「Top5 必修兑现」实测仅 2/5 属措辞水分（r61 制度违例）。

## 维度得分表

| 维度 | 得分 | 备注 |
|---|---|---|
| functional-a（实驱） | 8.5 | 3 场景全过：主流程层级正确 / 流式中+pending 期取消干净收敛 / no-permission 授予分支反馈明确；console 零报错 |
| functional-b（实驱） | 8.5 | 6 场景全过：claude 还原无 frontmatter（r64 medium#5 实测兑现）/ codex 无追问语境条 / session-lost 自愈 / 五档一字不差 / 历史 Finder 删除 / 设置六 tab |
| decisions | 8.5 | D1-D9 全落实；r65 六提交零 manifest diff；唯 DECISIONS 应急清单口径滞后（2194/余量6 vs 实测 2196/4） |
| install | 6 | 本地工程近满分（四态退出码/幂等原子写/PATH 兜底/卡装自愈），公众可用性 0 分 |
| docs | 6.5 | r65 五条新账逐字对上 diff 零抬升；扣分：Unreleased 头「Top5 必修兑现」实测 2/5 措辞水分 |
| release | 2 | 发布链第 7 轮未执行断口再扩；守门机制全备而发布动作为零 |

## 确认问题清单（去重归并后：1 critical / 3 high / 1 medium / 10 low；10 confirmed 经 verify 全 isReal、0 驳回、1 项跨轮仲裁）

### critical（1）

1. **[r64 遗留] 发布链三连第 7 轮未执行，公开安装通道 100% E404 双版本全死**（release/install/docs 三维同账）
   实测链：registry `["0.1.2"]`，0.1.3/0.1.4 直连均 404；`git ls-remote --tags` 零输出；origin/main 落后 74；远端 install.sh:43 钉 `@0.1.3`、本地钉 `@0.1.4`（README:36/45/72 同）——两个版本都不在 registry；Onboarding.tsx:11 动态拼 manifest 版本同样落死；E404 文案指路的 releases 页零 tag 也是死路。唯一在 registry 的 0.1.2 无任何公开入口引用。
   修法：`npm publish 0.1.4 → git push origin main → git tag v0.1.4`（顺序不可反），约 10 分钟。

### high（3）

2. **[r64 遗留] 扩展本体无普通用户安装通道**——README:28 步①要求 git clone + pnpm 构建 + 开发者模式加载；CWS 未上架、Releases 零 zip，非开发者两条路全断（与 critical 同根，r64 口径单列）
3. **[r64 遗留] 发布守门脚本与新 CI 步骤全锁本地，远端零执法**——`git ls-tree origin/main scripts/` 无 check-published / check-install-dist / package-cws；远端 ci.yml 49 行旧版零引用；「防忘发版」仍靠人肉，断口 67→74 扩大即实证。注意顺序：先 push 后 publish 会使 ci.yml:46 check-published 首跑即红
4. **[r64 遗留] CWS 上架材料零就绪**——store/ 目录不存在，无 listing / 1280×800 截图 / 逐权限 justification；nativeMessaging + optional_host 高敏组合无预写说辞，上架周期不可控（部分补位在：PRIVACY.md、DECISIONS:75 CWS 政策核实、package-cws.mjs 打包链已备）。*跨轮仲裁：初审 verify 降 medium（无直接用户损伤）、终轮裁 high（上架是唯一解路径）；损伤本体已记 critical/high 主账，材料债本条按 medium-high 边界记 high 与 r64 对齐*

### medium（1）

5. **CHANGELOG Unreleased 头「r64 双终审 Top5 必修兑现」措辞水分——实测仅兑现 2/5**（docs，本轮新账）
   r64 Top5 必修中：收割定向化 / 形状闸两项代码侧兑现且经实驱/代码双审确认；发布链三连 / 守门 CI 首跑 / CWS 材料三项未动（两项本属发布运营）。「兑现」二字全称量化误导发布就绪判断，违反 r61「能力描述必须可从 diff 逐字导出」制度。修法：改为「Top5 必修部分兑现（代码侧 2 项；发布链/CWS 属运营待办）」。

### low（10，归类）

- r64 遗留存活：取消终局 sr-only 播报「本轮已完成」语义误导（实驱复核确认在位）/ 取消后 tips 条残留「正在分享…」进行时文案（正常完成态显示「对话上下文」对照）/ README npm 备选裸 `&&`（docs+install 双报）/ manifest「免费」与「消耗 CLI 订阅额度」并存
- 新增观测：codex 还原态 tips 同族进行时文案 / Settings「隐藏 X」switch `aria-checked={!off}` a11y 语义反转（Settings.tsx:595-597）/ 测试首跑 1 failed（228/229）二三次全绿——负载敏感观测项（r64 task-timeout 假红同族，ENOSPC 出现在同机日志）/ DECISIONS 应急清单行数口径滞后（2194/6 vs 2196/4）/ dev mock usage 字段与协议漂移 + cancel 终局英文（harness 保真度，不计产品账）
- r64 幽灵任务 low 本轮两轮实驱均未复现——除牌

## r64 遗留核对

| r64 账 | r66 状态 |
|---|---|
| critical 发布链三连 | 第 7 轮未执行，断口 67→74，维持 critical |
| medium#5 SW 还原 frontmatter | **实驱兑现关账**（历史还原无 frontmatter 头 + 追问续流成立） |
| high 无普通用户通道 / 守门未推送 / CWS 材料 | 三项全维持（运营债） |
| low 幽灵任务 | 两轮未复现，除牌 |
| low README 裸 && / manifest「免费」/ sr-only / tips | 续存 |

新账：CHANGELOG 措辞水分 1 条 medium + 3 条 low 观测。

## 流程记录

5 次跑批：run-1/2（10/14 时段）死于 429[1308] 5h 限额窗；run-3（22:07 重置后）四静态维交卷但 A/B 实驱组死于 429[1302] 双 workflow 并发速率挤爆；run-4（22:41）A/B 跑到 66/79 轮死于 429[1308] 新窗打穿（03:00 重置）；run-5（次日 10:2x）同 runId 补跑 A/B + verify 链 + verdict 足额交卷。journal 缓存跨 5 轮累计 43+ result，废轮烧掉的 subagent tokens 约 450 万——429 限额是 r62-r66「非交付瘟疫」的主因成分，教训已入 memory（workflow-audit-discipline #12）。
