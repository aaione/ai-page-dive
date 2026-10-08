# PageDive 产品质量终审报告（第六轮 · r64 · workflow 对抗验证制）

- 审计对象：main@e819e23（r63 修复批后 3 提交：2f9c437 报告 / e1ae2cd 修复批 / e819e23 宪法同步）
- 基线（主编 2026-10-08 实测，审计员直接采用）：registry `["0.1.2"]`；领先 origin 67 提交（r63 时 64，断口扩大）；零 tag；224/224 全绿；host 2194/2200
- 审计制：6 维并行（**功能维度首次真浏览器实驱** dev harness，functional 拆 A/B 组各领场景）→ 逐条 non-low 发现独立对抗验证 → 终审评委裁决。功能组断言以 a11y 快照为准，截图存 `/tmp/pagedive-r64/shots/`

## 头条裁决

**否，且微降至 7.0。**（r63 为 7.2）

r63 唯一改判条件——发布链三连（publish→push→tag）——第 6 轮未执行且断口 64→67 继续扩大；对抗验证更坐实**远端 install.sh（origin/main=r51 时期）钉 @0.1.3 同样不在 registry**：一键安装对新用户 100% E404、README 备选双路径全死，本地一切改进对公众为零。功能面首次真浏览器实驱是本轮增量：A 组三场景全过、console 零 error/warn（8.5），r63 medium#5 兑现；但 B 组挖出真机可感新缺陷——SW 回收还原不剥 frontmatter，元数据渲染成对话标题（medium，harness 实测复现 + 代码链核实）。工程近满分、产品未发布：critical 不除，终审不放行。

## r63 改判条件与遗留兑现核对

| r63 项 | 兑现状态 |
|---|---|
| critical#1 发布链三连 | **未兑现且恶化**——断口 64→67；远端脚本钉 0.1.3 连 r51 的发布都没走完（两次 release bump 均未推送） |
| high#4 扩展无普通用户通道 | 未兑现——README 步①仍要求 git clone + pnpm build 开发者模式 |
| high 守门脚本锁本地 | 未兑现——check-published / check-install-dist / package-cws 全在未推送提交里，对远端零执法、从未运行一次 |
| high CWS 材料零就绪 | 未兑现——store/ 目录不存在 |
| medium#5 npm&& 无兜底 FAQ | **兑现**——e1ae2cd FAQ 条目技术准确（npm prefix -g/bin/PATH 可照抄），A 组实驱确认；README 手动备选侧裸 `&&` 残留半边（降 low） |
| 10 low | 大部分兑现（D3 口径/README 第五档/PRIVACY 表述等 6 条经 decisions 维逐字核实）；README 测试数字滞后（219 vs 224）新记 low |

## 维度得分表

| 维度 | 得分 | 备注 |
|---|---|---|
| functional-a（实驱） | 8.5 | ①主流程 markdown 层级/时长/追问入口/复制反馈 ②停止链路（无 CLI 失败前缀、输入不回填）③no-permission 气泡 + GrantHostRow 全过；console 零报错 |
| functional-b（实驱） | 7.0 | ④⑤⑦⑧ 全过零报错；挖出 frontmatter 新缺陷；session-lost 场景经复核可达（审计员停手过早，驳回）；⑨档位下拉/长标题截断因预算未验完 |
| decisions | 8.0 | D1-D9 全落实（PRIVACY 五行逐行对账全中）；r63 宪法同步五笔属实 |
| install | 6.5 | 安装脚本工程近满分（四态退出码/PATH 兜底/幂等原子写）；critical 断连压过一切打磨 |
| docs | 6.5 | CHANGELOG r63 六条与 diff 逐字对齐零抬升（r61 措辞制度过关）；224 精确对账；唯安装链三重断裂致命 |
| release | 5.5 | 发布链第 6 轮未动、守门脚本零执法、CWS 零材料；本地门禁质量合格但全程未上战场 |

## 确认问题清单（跨维去重归并后：1 critical / 3 high / 2 medium / 10 low 存活；驳回 1）

### critical（1）

1. **[r63 遗留] 发布链三连第 6 轮未执行，公开安装全线死路，断口 64→67 扩大**——四维同根合并（install/docs/release 各自独立提出）。证据链：本地 install.sh:43 钉 @0.1.4 / README ≥3 处钉 0.1.4 / Onboarding 动态拼 manifest 0.1.4，registry 实测仅 `["0.1.2"]`；**远端 origin/main（60b00b2，r51）install.sh:43 钉 @0.1.3 同样 E404**，E404 文案指向的 releases 页零 tag 也是死路。新用户复制面板 curl 命令 → 100% E404 无降级。修法不变：`npm publish 0.1.4 → git push origin main → git tag v0.1.4`（顺序不可反），约 10 分钟

### high（3）

2. **[r63 遗留] 扩展本体无普通用户安装通道**——README:28 步①要求 git clone + pnpm install && pnpm build + 开发者模式加载；非开发者第一步即卡死，curl 通道又 E404，两条路全断。修法：发布链完成后提交 CWS；上架前至少提供 zip 下载 + 加载指引。（跨维同题两条，一条验证 high 一条降 medium，主编取 high——r63 连续性 + 根因同一）
3. **[r63 遗留] 三个发布守门脚本锁本地未推送，从未运行一次**——check-published / check-install-dist / package-cws 对远端 main 与 PR 零执法；本轮断口继续扩大即为「防忘发版零拦截」的实证。修法：随 push 一并到位，CI 自动执法
4. **[r63 遗留] CWS 上架材料零就绪**——无 store/ 目录、无 listing / 截图 / 逐权限 justification；上架是消灭「无通道」的唯一路径，nativeMessaging + optional host 权限组合有被打回风险，需预写说辞

### medium（2）

5. **SW 回收还原路径不剥 frontmatter（新发现，harness 实测复现）**——`?swcycle=claude` 快照：还原对话首条气泡呈现 H2「title: 示例总结 url: … agent: claude ts: …」；App.tsx:399 history-file 分支直接 `parseHistoryTurns(m.content)`，historyTurns.ts 无剥离；对照 HistoryView.tsx:169 有剥离正则、「继续对话」入口（App.tsx:858）body 是剥离后传入——只有自动还原这一条路径漏。host 落盘必含 frontmatter（history.ts:125-137），SW 30s 回收是 MV3 常态 → 高频可感。修法：还原路径复用剥离正则（或 parseHistoryTurns 入口先 splitFrontmatter，host 侧 frontmatter.ts 已有同构工具）
6. **package:cws 打包守门纯手工前置，CI 无挂钩（新发现）**——脚本覆盖面合格（manifest 声明产物逐一断言在盘，package-cws.mjs:19-27），但只在人记得手工跑时才执法；跳过则残缺 dist 打进上架包即「用户装到点总结必死」旧险回归。修法：把 dist 完整性断言拆独立步骤挂 ci.yml build 之后

### low（10）

实驱侧：取消终局 sr-only 播报「本轮已完成」语义误导｜取消后 tips 条残留「正在分享「…」」进行时文案｜dev mock usage 字段与协议漂移 + cancel 终局英文不忠实（harness 保真度盲区，不计产品账）｜**[待查] 全新加载未触发操作，面板自行出现已完成「深度总结本页」任务（三次观测）**——疑 mock 收件箱重放伪影，需真机手测一次排除｜harness 删除流程失真（条目复活，mock 侧缺口）
文档侧：README 五档名与 WF_LABEL 雅名非一字不差｜README 测试数字滞后（24 文件/219 用例 vs 实测 25/224）｜README 手动备选 npm 命令仍裸 `&&`（medium#5 只修了面板侧）｜manifest 商店描述首词「免费」与 FAQ「会消耗 CLI 订阅额度」并存，商店语境无 FAQ 兜底

## 被驳回发现（1）

- **[harness 契约] 场景⑥ session-lost 不可达（functional-b，原 medium → not-a-bug）**：驳回员复核——审计员只测首轮发送就停手；mock task-meta（chrome-mock.ts:79）广播 sessionId → App.tsx:441 置 resumable → SummarizeView 建立会话，追问轮发 `msg.followUp` 即可触发 session-lost 链路。场景可达，产品无缺陷，属审计停手过早。

## Top 5 必修（投入产出排序）

1. **发布链三连**——10 分钟，唯一 critical，下面全部项的前置
2. **push 后确认三个守门脚本 CI 首跑**——随 push 零额外工作量，把「防忘发版」从人肉变机器
3. **CWS 材料包**——store/ 目录（listing + 1280×800 截图 + 5 权限逐条 justification，nativeMessaging/optional host 重点预写）
4. **SW 还原剥 frontmatter**——复用 HistoryView 正则的一行级修复，高频可感；顺手补一个还原路径断言用例
5. **package:cws 完整性断言挂 CI**——拆独立步骤入 ci.yml，封死残缺 dist 进上架包

## 终审一句话

本地工程与文档纪律已经把能自己做的做到了实处（实驱三场景全绿、CHANGELOG 逐字对齐、D1-D9 全落实）；产品面向公众的死结只剩一条——发布链三连连续 6 轮未执行且断口在扩大，这不是工程问题而是执行问题：10 分钟的手工动作，不做，一切终审都不放行。

---

### 流程记录（收割纪律对账）

- 跑批 2 次：首跑 decisions/install 交卷，functional（单 agent 扛 9 场景浏览器实驱）/docs/release 过载未交付；拆 functional 为 A/B 组 + 全维硬预算后重续，6 维全交卷零故障
- 对抗验证对账：11 confirm + 1 reject 全交付；跨维去重 11 → 7（发布链四条同根、无通道两条、守门脚本两条）
- 功能实驱增量：r63 前功能维度一直是纯静态走查，本轮真浏览器驱 9 场景中 7 个完整验证（⑨ 档位下拉/长标题截断因预算截断，移交 r65），断言锚 a11y 快照文本
- 新发现中唯一产品代码缺陷（frontmatter 噪音）经「代码链核实 + harness 复现 + 真机语义排除 mock 差异」三重验证成立
