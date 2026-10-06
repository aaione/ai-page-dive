# PageDive 产品质量终审报告

> 审计日期：2026-10-06 · 6 维度审计 → 对抗核实 → 终审
> 基准 HEAD `2418c9c`（main，本地领先 origin/main 51 提交），版本 0.1.4
> 上轮基线：`reports/2026-10-05-product-audit.md`（0.1.3，HEAD `1ed138f`）

## 头条裁决

**有条件是。**

代码本体已达到「高质量完成」：上轮三项改判条件**全部兑现**（README 失实表述已消灭、额度 authHint + PDF 分型已落地、文档一次性收敛完成），上轮 Top 5 **五项全修**，210/210 测试全绿、七点版本门禁全绿、六条硬红线实测全守、CHANGELOG 0.1.4 八条 Fixed 逐条对照 git diff 零虚报。

但 0.1.4 是一次**「本地发布」**：51 个提交未推 origin（远超任务所述 5 个）、npm registry 停在 0.1.2、origin/main 的 install.sh 钉着从未 publish 的 @0.1.3——**现在任何新用户照 GitHub README 走安装主线，第一步 npm i 即 E404 硬失败**，且失败指引误导排障方向（只覆盖 EACCES/nvm/网络）。专为拦此状况的 `check-published.mjs` 门禁本身也在未推送的 51 提交内，从未在 CI 执行过。r59 全部修复未交付到任何对外信道，GitHub 对外仍展示上轮已定性的失实文案与断链命令。

**改判条件（可验收，合计约 25 分钟）**：

1. `npm publish`（dry-run 已验证通过，37 文件/58.4kB 干净产出）→ `git push origin main` → `git tag v0.1.4`。**顺序不能反**（先 push 后 publish 会让 CI check-published 红）。约 10 分钟，消灭唯一 high。
2. 删 `SummarizeView.tsx:522` codex「不支持追问」失实标注（与 codex.ts:31-34 thread_id 实现、sw.ts:495-496 canResume、README.md:90 对外承诺三方直接矛盾，100% 触发于最高频决策点），顺手改 :518/:1045 陈旧注释与 :1085「此 CLI 暂不支持追问」口径。约 15 分钟。

以上完成后可改判「是」。**不构成改判障碍的**：CWS 商店材料（上轮已定性为发布运营待办，0.1.4 批未恶化）；PDF 无后缀分型与 rate-limit 文案档（对抗核实降级为 low，见下）。

## 与上轮对比（0.1.3 → 0.1.4）

### 已修（r59 五提交 afaab84/1a2f230/b802976/ba32dcd/2418c9c 逐一核实落地）

| 上轮问题 | 上轮定级 | 现状 |
|---|---|---|
| README「CWS 审核中」失实表述（Top 1 / 改判条件 1） | medium | **已修**：README.md:28 改「准备提交 CWS，上架前先手动加载」——但修复仅在本地 2418c9c，**GitHub 对外仍展示旧文案**（见存活 #13） |
| 额度耗尽无中文归一化（Top 2 / 改判条件 2） | medium | **已修**：App.tsx:1069-1074 authHint 额度档五形态正则 + 三出路中文文案，调用面三路全挂（:564/:630/:1060，上轮 missedErrBubble 漏挂缺口同修）——**残余同源缺口降级为 low 存活**（#1） |
| PDF 无专项识别（Top 3 / 改判条件 2） | medium | **已修**：sw.ts:936 有后缀 PDF 分型 + App.tsx:761 如实出路文案 + 4 测试用例——**无后缀 PDF 漏判降级为 low 存活**（#2） |
| 设置页裸露英文错误码（Top 4） | medium | **已修**：Settings.tsx:204-212 四码中文映射 + 未知码兜底，句式与 App.tsx 体系逐字一致 |
| 文档漂移三连（Top 5 / 改判条件 3） | medium | **已修**：README 210 对齐实跑、DECISIONS D10/v2 路线图/决策 #1 三处修订全部落地且账实一致，用例数漂移根源消灭 |
| cancel 静默疑点（上轮审计 T1） | — | **核销**：看门狗路径拒收前已在本地渲染超时气泡并回填输入（App.tsx:206-231），「点了停止无感知」场景不存在 |
| codex 追问是文档虚言疑点 | — | **核销**：codex.ts:32-34 thread_id 对称下发 + codex.ts:92-93 exec resume，与 README.md:90 逐字对得上 |

### 遗留未修（上轮已报，r59 未触碰）

SPA 慢渲染零等待提取（low）、codex sessionId 空串追问关闭（low）、「模式/档」术语混用（low）、历史页真空态四字（low）、总结语言无 hint（low）、三处气泡裸英文 detail（low）、多引擎定案无状态标记（low，**已延续两轮**）、host 行数余量（low，且从 3 行缩到 2 行——r59 净增 1 行）。

### 新发现

- **（high）安装主线断裂**：registry 停 0.1.2 + origin/main install.sh 钉未发布 @0.1.3 + README curl 命令正拉这份脚本 = 新用户 100% E404。
- **（medium）「本地发布」**：51 提交未推、零 tag、发布提交零 CI 覆盖、GitHub 对外失实文案与断链命令持续在线。
- **（medium）codex 下拉恒标「不支持追问」**：与已交付实现及 README 对外口径直接矛盾。
- **（low→已降级）rate limit/断网/529 文案档**、**（low→已降级）无后缀 PDF 漏判**：上轮两大 medium 的修补残余，对抗核实确认触发面与伤害均低于原报。

### 分数涨跌

总分 49 → 46.5（**跌 2.5**）。五个工程维度全部持平或上涨（承诺兑现 +0、旅程闭环 +0.5、决策遵守 +1），唯发布就绪度 6 → 4（**跌 2**）——上轮是「材料待办」，本轮是「主线断裂」：失实表述修了但修在本地，发布链的 push/publish 环节整体缺位。

## 维度得分表

| 维度 | 本轮 | 上轮 | Δ | 一句话 |
|---|---|---|---|---|
| 承诺兑现度 | 9 | 9 | 0 | CHANGELOG 八条 Fixed 逐条零虚报、210 口径零漂移，唯 codex 下拉失实标注算文案不算承诺（计入体验维度） |
| 安装与首次运行 | 9 | 9 | 0 | 本地链路完好（七点版本门禁全绿、钉点自洽）；registry 断裂计入发布维度 |
| 核心用户旅程闭环 | 8.5 | 8 | +0.5 | 上轮两大 medium 洞已补、四层错误归一化体系成型；残余是降级后的打磨残渣（rate-limit 文案不精确、无后缀 PDF 误诊、SPA 零等待） |
| 决策与范围遵守 | 8 | 7 | +1 | 三处文档修订全落地、六条红线实测全守；扣分在多引擎定案无标记延续两轮 + 行数余量 2 行且仍在缩 |
| 体验与文案打磨 | 8 | 8 | 0 | 设置页错误码/authHint/PDF 文案三修且体系一致，但挖出新 medium（codex 下拉失实）+ 四项 low 遗留未动 |
| 发布就绪度 | 4 | 6 | -2 | 工程侧满分（publish dry-run 干净、门禁设计精准），但「发布」动作本身缺位：51 提交未推、registry 停 0.1.2、安装主线 E404、零 CI 覆盖 |
| **合计** | **46.5** | **49** | **-2.5** | |

## 确认问题清单（按降级后严重度，共 14 项存活）

### high（1）

**1. 线上安装主线当前断裂：registry 停 0.1.2，origin/main 的 install.sh 钉未发布的 @0.1.3，照 README 执行 curl|sh 必得 E404**
- 证据：`npm view @aaione/ai-page-dive` 实查 versions=["0.1.2"]；`git show origin/main:install.sh` 第 43 行 `npm i -g @aaione/ai-page-dive@0.1.3`；README.md:33 的 curl 命令拉的正是这份脚本。install.sh:44-47 失败指引只覆盖 EACCES/nvm/网络，不含 E404，用户被引向权限排障。`check-published.mjs` 门禁（b2ecf83）在未推送的 51 提交内，从未在 CI 执行。
- 核实：三位核实者全部 isReal=true/high confidence。两位维持 high；一位降 medium（理由：项目未公开推广、新用户流量≈0、10 分钟可愈）。**终审维持 high**：README 是唯一对外安装入口、钉版本无任何兜底即硬失败、「发布就绪度」审计的核心正是此环节；CHANGELOG 宣称 [0.1.4] - 2026-10-06 已发布而 registry/push 双缺位，属发布动作半途而废而非纯材料待办。
- 修复：先 `npm publish` 再 `git push`（顺序不能反）再 `git tag v0.1.4`，约 10 分钟；顺手 install.sh:44 失败清单补 E404 提示。

### medium（2）

**2. codex 引擎下拉恒标「不支持追问」，与已交付的 thread_id 续接实现及 README 对外口径直接矛盾**
- 证据：SummarizeView.tsx:521-522 硬编码 `a.id === 'codex' ? '不支持追问' : ''`（无条件、每项恒显）；对照 codex.ts:31-34 thread.started 产 meta.sessionId、sw.ts:495-496 `canResume`（注释明言 codex 正常轮 canResume=true）、README.md:90「codex 以 thread_id 续接会话」。附带 :518/:1045 陈旧注释、:1085「此 CLI 暂不支持追问」在罕见降级轮错怪 CLI。
- 核实：isReal=true / high，维持 medium——装 codex 的用户每次选引擎都看到失实标注（100% 触发），会误导引擎选择。
- 修复：删 :522 一行 + 改三处陈旧口径，约 15 分钟。

**3. 0.1.4 是「本地发布」：51 个提交未推 origin（远不止任务所述 5 个），发布提交零 CI 覆盖，GitHub 对外仍展示失实文案与断链安装命令**
- 证据：`git rev-list origin/main..HEAD --count` = 51（origin/main 停在 60b00b2/r51 时代）；git tag 为空；ci.yml 仅 push/PR 触发，即 0.1.4 的 210 用例/构建/版本门禁从未在 CI 环境跑过（本审计本地实跑 24 files/210 passed + 门禁全绿作替代验证）。远端 README:27 仍展示上轮已定性的「CWS 审核中」失实表述——**上轮 Top 1 的修复未交付到对外信道**。
- 核实：isReal=true / high，维持 medium。
- 修复：与 #1 同一条 push 解决；补 tag 半分钟。

### low（11）

**4.（降级自 medium）rate_limit_error（snake_case）/断网/Overloaded(529) 错误文案仍裸显英文**
- 对抗核实降级理由：最高频 429 人读文本 "Rate limit reached" 已命中 r59 额度档正则 `limit reached`（虽被归为「额度耗尽」文案，并非裸显）。真实残余仅 snake_case 形态、Connection error/fetch failed（断网，10 分钟长任务中真实可达）、Overloaded/529 三类。指引打磨缺口而非同源大洞。
- 修复：authHint 追加一档 `rate ?limit|429|too many requests|connection error|fetch failed|network|overloaded|529` + 限流→稍等重试、网络→检查网络后重发的中文文案，约半小时。

**5.（降级自 medium）无后缀线上 PDF 漏判，回落到「滚动触发懒加载」无效指引**
- 对抗核实降级理由：触发面是「PDF 页 × 无后缀」双重子集；且 empty-content 文案同时含「粘贴正文作为附件直接追问」这条对 PDF 实际有效的出路，伤害限于误诊+前半句无效指引。带 .pdf 后缀的主流场景（arxiv 等）已正确分型。
- 修复：正则补 `format=pdf|download=|/pdf/` 常见模式 + document.contentType 探测细分，约 1-2 小时。

**6. SPA 慢渲染注入后零等待即提取（上轮遗留）**——sw.ts:966-998 注入后立即 extractBest，重 SPA 首次点总结有概率空手，靠重试文案自愈。修复：empty-content 时短等待重提一次，约半天。（未经对抗核实）

**7. codex thread.started 未达（sessionId 空串）时追问入口关闭（上轮遗留）**——罕见降级窗，README.md:90 已如实披露；App.tsx:440 注释「claude 有、codex 无」与现实相反属陈旧注释。修复：决策题（接受现状或提供「以正文重发起」出路），注释改一行。（未经对抗核实）

**8. 多引擎「审校模式」定案无「未实施」状态标记（上轮遗留，已延续两轮）**——DECISIONS.md:89-95 定案写到实现级细节与已交付条目混排；全库 grep 仅 sw.ts:721 一处设计注释引用它作为代码设计依据。修复：加一行状态标记，约 5 分钟。（未经对抗核实）

**9. host 行数红线余量 2198/2200 仅剩 2 行，r59 净增 1 行（上轮遗留且恶化 3→2）**——门禁守住但下个任意 host 小需求即触线，届时按既定纪律将被迫现场删功能。修复：主动腾挪或预删低价值功能，约 0.5-1 天纯防御性投入。（未经对抗核实）

**10. 「模式」与「档」术语混用（上轮遗留）**——Settings 页「模式」系 vs SummarizeView:1255/:183「档」系。修复：统一为「模式」，改两处约 10 分钟。（未经对抗核实）

**11. 历史页真空态仅四字「暂无历史」（上轮遗留）**——对照 :314 连接等待态都有解释文案。修复：一行 hint，5 分钟。（未经对抗核实）

**12. 「总结语言」设置项无 hint，「自动」档含义不自明（上轮遗留）**——判定规则无处披露。修复：一行 hint，5 分钟。（未经对抗核实）

**13. no-permission/inject-failed/extract-crash 三处气泡内嵌裸英文 detail 无「原始信息」标注（上轮遗留）**——App.tsx:762/:765/:766，对照 authHint 同产品两套口径。修复：统一加前缀或降为 title 悬浮，15 分钟。（未经对抗核实）

**14. CWS 商店材料仍为零（上轮已知待办，现状复核）**——store/assets/docs 三目录均不存在、ci.yml 无 release 步骤；README.md:28 失实表述本身已消灭（修复在本地待 push）。与上轮裁决一致：不阻塞手动加载分发路径，不构成改判障碍。（未经对抗核实）

## 被驳回发现

本轮对抗核实零驳回（原始发现 14 项全部存活，其中 2 项被降级：#4 medium→low、#5 medium→low；#1 有两位核实者维持 high、一位建议 medium，终审采纳维持 high）。上轮被驳回两项无复发。

## Top 5 必修清单（按投入产出排序）

**1. 发布动作收尾：`npm publish` → `git push origin main` → `git tag v0.1.4`（~10 分钟）**
顺序不能反（先 push 会让 CI check-published 红）。消灭唯一 high（#1）+ medium（#3）+ 上轮 Top 1 修复的对外交付。顺手在 install.sh:44 失败清单补一条 E404「版本未发布」提示。

**2. `SummarizeView.tsx:522`——删 codex「不支持追问」失实标注（~15 分钟）**
删一行 + 改 :518/:1045 两处陈旧注释 + :1085 改「本轮暂不可续问」口径。消灭唯一产品文案 medium（#2），消除「README 说支持、下拉说不支持」的自相矛盾。

**3. `App.tsx:1069-1074`——authHint 补限流/网络/529 档（~半小时）**
正则追加一档并配中文文案（限流→稍等重试；网络→检查网络后重发），与 r59 改法同构。顺带把 429 文案从「额度耗尽」误归中拆出来。

**4. `sw.ts:936`——PDF 分型补无后缀形态（~1-2 小时）**
正则补 `format=pdf|download=|/pdf/` 常见参数/路径模式；extractor 或 empty-content 分型探测 document.contentType，把无后缀 PDF 从 empty-content 细分出来。

**5. 廉价债一波清（合计 ~40 分钟）**
DECISIONS.md 多引擎定案加「⏳ 未实施」标记（5 分钟，已拖两轮）；历史真空态/总结语言两处一行 hint（10 分钟）；三处气泡 detail 加「原始信息：」前缀（15 分钟）；App.tsx:440 陈旧注释改一行（1 分钟）；「模式/档」统一（10 分钟）。host 行数余量 2 行的腾挪（0.5-1 天）可排下个迭代但**必须排在任何 host 新功能之前**。

---

**终审一句话**：代码本体已经配得上「高质量完成」——上轮条件与 Top 5 全兑现、零 critical、六条红线实测全守；卡住裁决的不是代码而是一个没做完的动作：publish + push + tag，10 分钟补完这最后一公里，PageDive 0.1.4 即名副其实。
