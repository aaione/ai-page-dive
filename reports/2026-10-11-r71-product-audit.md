# r71 产品终审报告（2026-10-11）

- **审计基线**：main@b7f7b4d，本地钉 v0.1.4；外部状态实测：registry latest=0.1.2 / 远端 install.sh 钉 0.1.3 / 领先 98 commits / 零 tag
- **运行**：wf_5e20c78a-51e，一跑即成——15 agents / 690k tokens / 123 tool uses
- **总分 6.5 / 否**（isHighQuality=false；产品内核近 8 分水准，发布通道 3 分拖垮全局）
- **对账**：confirmed 7（1 critical 维持 + 1 high + 3 medium + 1 critical→high + 1 medium→low）/ rejected 2 / unfetched 0 / lows 5

## 评委判词

> r71 产品面修复批属实兑现：tips 五态、版本账归位、测试 239 口径均可从代码与实跑验证，决策落实 9/9、UX 主流程成熟（8 分）、文档 7.5 分，工程内功配得上高分。但作为产品未高质量完成：发布链 critical 第 11 轮断链，新用户今天安装必死路；且新发现 manifest description 143 字符超 Chrome 132 上限——即便发版也传不上 CWS，三道守门零拦截；r71 门禁还引入「正在检测」永久死路新 medium，PRIVACY 英文口径漏改。产品内核已近 8 分水准，发布通道 3 分拖垮全局：先修 description 长度并加断言，再走完 publish→push→tag，方可谈完成。

## 维度分

| 维度 | 分 | 总判断 |
|---|---|---|
| decisions | 9 | 9/9 决策落实可验证；红线 2199<2200 守住；仅文档数字漂移一处 |
| install | 4 | 工程质量高（幂等/union/原子写/四态码/root 守卫）；但发布断链使旅程今天不可完成，curl 与 npm 双路全断 |
| ux | 8 | tips 五态名谱与代码一致、finished 台账稳定拒收迟到帧；扣分：agentsLoaded 无超时兜底死路 |
| docs | 7.5 | 239 五处口径一致、r71 批逐字可导出；扣分：PRIVACY 英文漏改、Unreleased 账目缺口 |
| release | 3 | 守门机制设计完备；发布链第 11 轮断链 + description 超限新发现 + zip 过期无失效 + 商店材料缺三件 |

## r70 → r71 修复映射核对

r70 产品面 3 medium（CHANGELOG 计数归因失真 / 版本账错位 / tips 矫枉过正）**全部真清**——tips 五态、版本账归位、239 口径五处一致均经实驱核实。代价：门禁修复引入 P2 新死路；PRIVACY 只改中文漏英文（P3）。

## Confirmed（7 条）

### P1 [high] curl 主线 E404 逃生口是死胡同
- **证据**：install.sh:47 指引「稍等几分钟后重试；仍 404 到 releases 确认该版本已发布」；实测 releases 零 tag、registry 无 0.1.3/0.1.4
- **损害**：非开发者用户按提示重试永远失败，releases 空页无结论无出路，无降级装 0.1.2 提示——安装旅程第一步终结且用户归因自己环境
- **修法**：E404 措辞改为引导 npm dist-tag 或直接给降级命令；根因仍是发布三连（挂账）

### P2 [medium] r71 重试按钮门禁造成新死路——agents 帧丢失时永久「正在检测本机 CLI…」
- **证据**：SummarizeView.tsx:541 门禁重试按钮；:1285-1291 无 agentsLoaded 时只渲染占位文本无超时出口；App.tsx:425 是全文件唯一 setAgentsLoaded(true)（仅 'agents' 帧触发），__host-disconnected handler 不触碰它
- **损害**：ping 成功但 agents 帧丢失（host 崩溃/NM 断连/spawn 二连失败）后面板永久「正在检测」零按钮；唯一恢复是关重开侧栏，普通用户不可发现。8s 后按钮不回来——probing 冷却只作用于已渲染按钮
- **修法**：agentsLoaded 加 10s 超时兜底（置 true 落「未检测到」空态），或 waiting placeholder 内也放重试按钮

### P3 [medium] PRIVACY 英文 Summary 模型读取仍是单路径——r71「两路径」只改了中文
- **证据**：PRIVACY.md:9 英文「reads (only) the `model` field」；claude.ts:103 `return s.model || s.env?.ANTHROPIC_MODEL || undefined`；中文 bullet :16 已改两路径
- **损害**：英文读者/CWS 审核看到的隐私声明与实现不符，中英口径互相矛盾
- **修法**：英文 Summary 同步双路径表述

### P4 [critical→high] manifest description 实测 143 字符超 Chrome 132 上限——CWS 上传确定性打回（新发现）
- **证据**：apps/extension/public/manifest.json:7 双语 description node 实测 length===143；Chrome 官方上限 132
- **损害**：CWS 上传校验直接报 Invalid value for 'description'，0.1.4 根本传不上去；package-cws 六字段深比较只比一致性、check-version 只比版本号——三道守门零拦截
- **修法**：压缩至 ≤132 字符（双语二选一或精简）+ package-cws.mjs 追加 description.length<=132 断言

### P5 [critical] 发布链第 11 轮续计（standing deferral）
- **证据**：registry latest=0.1.2 / 远端 install.sh 钉 0.1.3 / 本地 0.1.4 / 98 commits 未推 / 零 tag（主编实测，verify 独立复核相符）
- **损害**：新用户 curl 官方路径必 E404 死路；老用户无升级通道，NM 协议演进后旧 host 静默无响应
- **修法**：publish→push→tag 三连（用户凭证操作，第 11 轮递延）；tag 无任何门禁是次生缺口

### P6 [medium→low] 盘上既有 pagedive-cws-v0.1.4.zip 过期且无失效机制
- **证据**：zip 时间戳 10-08 09:03，dist 10-11 01:57 重建——r67「免费」措辞删除等修复在 zip 生成之后
- **修法**：打包先删旧 zip 或写入构建指纹；上传 checklist 加「zip 必须当场重产」断言

### P7 [medium] CWS 材料四件套仅隐私件就绪（r70 挂账续计）
- **证据**：全仓 find 无 screenshots/store-listing 目录；PRIVACY.md 双语已备；截图/商店长描述/单用途声明三件缺
- **修法**：按 2026-09-09 ship 审计 B4 补三件

## Rejected（2 条）

- **npm 备选 FAQ 无 E404 条目形成引导死循环**（install high）——核心证据与现状不符：Onboarding.tsx 实测已含 E404 排障条目
- **package-cws 漏 content_scripts 深比较**（release medium）——引述属实但影响推导不成立（dist 由 public 构建派生，改 public 后 package-cws --check-only 比对 dist↔public 会先红）

## Lows（5 条）

1. DECISIONS 行数红线账数字过期（r67 口径 2196，实测 2199）
2. sudo npm uninstall 被 assertNotRoot 中止 preuninstall，指引「重装」不对症卸载意图
3. 两步确认 sr-only 播报为条件挂载 role=status，读屏器可能零播报
4. Unreleased 头「code 4 medium 全数修复」第四项（复杂度 C4）无 body 条目可对账
5. r71 修复批留在 Unreleased 与 0.1.4 钉版构成发布时点账目缺口

## 双终审合账（r71）

| | code | product |
|---|---|---|
| 分数 | 7.4 / 否 | 6.5 / 否 |
| confirmed | 11（9 medium + 2 降 low） | 7（1 critical + 1 high + 3 medium + 2 降） |
| 骨架交付纪律 | unfetched 0（三分收集生效） | unfetched 0 |

**r72 修复批排序建议**（按用户影响）：P4 description 超限（发版硬阻塞）→ P2 门禁死路 → C8 task.ts error 分支数据丢失 → C2/C3/C6 undelivered 落点破口 → P3 PRIVACY 英文 → P1 E404 措辞 → C5 跨窗错页 → C11 satisfies 补三文件 → P6 zip 失效机制。发布链 P5 三连仍递延（第 12 轮起计）。
