# PageDive 产品质量终审报告

> 审计日期：2026-10-05 · workflow `wf_df8057ee-bb7`（6 维度审计 → 对抗核实 → 终审）
> 11 agents / 82 tool uses / ~497k tokens · 基准 HEAD `1ed138f`（main），版本 0.1.3

## 修复回执（2026-10-05 r59，审计当日）

三项改判条件 + Top 5**全部完成**：① README「CWS 审核中」→「准备提交 CWS，上架前先手动加载」；② 额度耗尽 authHint 中文指引 + PDF 页面专项分型（pdf-page，不再给懒加载指引，含测试）；③ 文档一次性收敛（README 177→210 并补 `pnpm test`、DECISIONS D10 补记 install.sh 主线、v2 路线图移出已交付两项、决策 #1 对齐「零账号 · 零 API key」、AGENTS.md 用例数同步）；另完成设置页错误码中文映射 + 未知码兜底 + missedErrBubble authHint（Top 4）。验证：210/210 全绿、完整两段构建通过。

## 总裁决

**有条件通过。**

条件（全部可验收）：

1. **消除 README「CWS 审核中」的失实表述**——`README.md:28` 当前无任何仓库材料支撑「已提交审核」，属对外表述与事实不符。改为如实口径（如「准备提交 CWS」）或实际完成提交并入库材料。
2. **补齐错误归一化两处确认缺口**——额度耗尽（usage limit）错误匹配中文指引（`App.tsx:1065-1068` authHint 正则扩展）；PDF 页面不再给出「滚动到底触发懒加载」这类必然失败的重试指引（`sw.ts:307` isNormalPage / `App.tsx:764` empty-content 分型）。
3. **文档同步一次性收敛**——README 177→203 并补 `pnpm test`；DECISIONS.md 三处修订（D10 install.sh 主线、v2 路线图已交付项标记、决策 #1「零配置」口径）。

以上三项预估合计 1~2 人日。完成后可改判「是」。**不构成改判障碍的**：CWS 商店材料与逐项审核文案——属发布运营待办（项目决策中已明确为后续事项），不计入产品质量本体。

**裁决依据**：对抗核实后**零 critical、零 high 存活**。原始 high/critical 各一项分别被驳回（时序错位、定性反了）与降级（发布纪律而非产品缺陷）。工程质量底子扎实：203/203 测试全绿、构建全绿、版本四处钉一致 0.1.3、host 行数红线 2197/2200 且历史上真按「删功能不抬阈值」执行过。失分集中在文案归一化薄层与文档纪律，不在架构与实现。

## 维度得分表

| 维度 | 得分 | 确认问题数 | 被驳回数 | 一句话 |
|---|---|---|---|---|
| 承诺兑现度 | 9 | 0 | 0 | 对外承诺逐字有代码支撑且多处强于承诺，唯一失真是 README 用例数滞后（少报非虚报） |
| 安装与首次运行体验 | 9 | 0 | 0 | 罕见的打磨深度，失败场景均有实证迭代过的出口，仅剩版本钉死靠人工 bump 的流程风险 |
| 核心用户旅程闭环 | 8 | 0（未经对抗核实） | 0 | 断点降级远超同类 v1 水准，唯额度耗尽与 PDF/慢 SPA 的错误归一化存在可验证缺口 |
| 决策与范围遵守 | 7 | 0 | 1 | 硬约束与决策在代码层全部守住，但 DECISIONS.md 三处修订滞后于现实 |
| 体验与文案打磨 | 8 | 0（未经对抗核实） | 0 | 整体高水准，设置页错误码裸露与「模式/档」术语混用距卓越差一步 |
| 发布就绪度 | 6 | 3（均降级存活） | 0 | 工程与文档底子合格，但商店材料为零且 README「审核中」表述与现状矛盾 |

## 确认问题清单

### 经对抗核实确认（isReal=true，按降级后严重度排列）

**1.（medium）CWS 商店材料全套缺失 + README「审核中」表述失实**
- 证据：`store/`、`assets/`、`docs/` 三目录均不存在；全仓库无任何截图/商店文案/zip 产物/发布 job（`.github/workflows/ci.yml` grep release|cws|webstore 零命中）；唯一对外文案是 `apps/extension/dist/manifest.json:7` 的 129 字符描述。`README.md:28` 自称「CWS 审核中」但仓库内无任何支撑材料。
- 核实意见：事实全部属实，但 critical→medium——README 已给出完整手动加载路径，DECISIONS.md 显示 CWS 上架是有意识的后续事项，材料数小时可补齐，不阻塞现有分发路径。**存活的是「审核中」的失实表述，不是材料缺失本身。**

**2.（medium）CWS 逐项审核文案未准备（single purpose / 权限 justification / 数据使用表单）**
- 证据：全库 grep 无任何 single purpose 声明、nativeMessaging/scripting 答辩文案、optional `<all_urls>` 使用理由、Chrome 隐私实践 tab 披露；PRIVACY.md 素材（双语逐权限 + CLI 落盘披露）与 manifest 核对无误但未成表单形态。
- 核实意见：事实成立，但 high→medium——该问题在 `research/ship-readiness-audit-2026-09-09.md:45` 近一月前已记录，属已知未闭环待办；CWS justification 是 dashboard 表单字段不要求入库；DECISIONS.md:75 已预核实政策先例（KeePassXC/1Password）。剩余真实风险是提交时口径与 PRIVACY.md 不一致拖长审核 1–5 天。

**3.（low）README 开发者节无测试命令且用例数漂移（177 vs 实际 203）**
- 证据：`README.md:112` 写「vitest 177 用例」，实跑 `pnpm test` 24 files / 203 passed（AGENTS.md 同口径 203，README:112 还自称「与 AGENTS.md 同口径」，成了漂移自证）；README 开发者节唯一命令是 `pnpm install && pnpm build`，全文无 `pnpm test`。
- 核实意见：证据全部属实，但 high→low——纯文档漂移，零运行时影响；`package.json` 第 7 行即 test script，README:111 已链接 AGENTS.md。修复成本一行。

### 未核实项（medium/low，未经对抗核实，按维度单列）

**核心旅程闭环（2 medium + 2 low，建议下次对抗核实优先覆盖）**
- **（medium）额度耗尽无中文归一化**：`App.tsx:1065-1068` authHint 正则 `/log ?in|sign ?in|authenticat|unauthorized|api[ _-]?key|credential|401/i` 不覆盖 "usage limit reached / insufficient credits" 类错误；「复用已有 CLI 订阅」是核心卖点，重度用户撞额度只看到英文原文气泡。
- **（medium）PDF 页面无专项识别**：`sw.ts:307` isNormalPage 与 `extract.ts` 均无 PDF 检测，PDF 走 empty-content 后得到「滚动到底部触发懒加载」这一对 PDF 必然无效的重试指引；本地 file:// 已归 unsupported-page，PDF 是同一清单唯一漏掉的文档型断点。
- （low）SPA 慢渲染无等待策略，`sw.ts:944-977` 注入后立即提取，靠事后文案兜底。
- （low）追问轮 sessionId 空串时入口关闭（`sw.ts:518` / `App.tsx:767`），窄窗降级语义诚实但有出路成本。

**体验与文案打磨（2 medium + 4 low）**
- **（medium）设置页裸露英文错误码**：`Settings.tsx:209` `` `${m.code}: ${m.message}` `` 直接渲染，read-fail/delete-fail 等码与 host 原文原样展示，是全产品唯一漏掉 ERROR_LABEL 中文映射的错误面。
- **（medium）未知错误码兜底裸显 + missedErrBubble 漏过 authHint**：`App.tsx:628` 未收录码裸显 `m.code`；`App.tsx:1057` message 未过 authHint（对照 :562/:628 均过）。
- （low）「模式」与「档」术语混用（`Settings.tsx:373` vs `SummarizeView.tsx:1255`）。
- （low）历史页空状态仅四字「暂无历史」，无下一步引导（`HistoryView.tsx:306-315`）。
- （low）「总结语言」设置项无 hint，「自动」档含义不自明（`Settings.tsx:603-618`）。
- （low）no-permission 等文案内嵌原始英文 detail 片段（`App.tsx:759-763`）。

**决策与范围遵守（1 medium + 1 medium + 1 medium + 2 low，扣除被驳回 1 项后）**
- **（medium）DECISIONS.md 安装主线与 README/AGENTS.md 矛盾**：D10（`DECISIONS.md:72`）钉死 npm 两连命令，但 `README.md:33` 主线已是 `curl | sh`（npm 降为折叠备选）——主路径更换这一重大产品决策绕过了决策记录，「任何实现不得违背」的账本反而落后于实现。
- **（medium）v2 路线图未同步**：`DECISIONS.md:99` 仍列「追问对话 + 对话历史」，但 `README.md:18/:90` 证实追问已交付（含 codex thread_id 续接）；全文搜索同样已实现。v2 列表 7 项中至少 2 项已进 v1，路线图失去账本功能。
- **（medium）README 用例数漂移 177 vs 203**（同发布就绪度第 3 项，跨维度重复计）。
- （low）host 行数红线余量仅 3 行（2197/2200）——纪律守住但缓冲归零，下个需求即触线，应主动腾挪。
- （low）多引擎「审校模式」定案写到实现级细节（入口/prompt/frontmatter 字段全写死）但代码零踪迹、无「未实施」状态标记，与已交付条目混排。

**承诺兑现度（1 medium + 2 low）**
- （medium）README 177 vs 203（同上，跨维度第三处计数）。
- （low）首屏「一键调用」与两段式安装旅程有轻度落差，但快速开始与 FAQ 已如实披露。
- （low）DECISIONS.md 决策 #1 仍写「零配置」，0.1.3 对外已改口「零账号·零 API key」，内部档未同步。

**安装与首次运行（1 medium + 4 low）**
- （medium）`install.sh:39-43` 钉版本靠人工 bump，面板侧（`Onboarding.tsx:11`）已用 manifest 版本动态拼消灭漂移，脚本侧仍靠发版纪律。
- （low）forbidden 分型依赖首轮 probe 回带 nmError，NM 未 spawn 时误显全量安装命令（`Onboarding.tsx:49`）。
- （low）非标准 Node 版本串被误报「版本过低」（`install.sh:28-29`）。
- （low）npm i -g 部分成功被报「安装失败」，用户被引向权限排障而实际重跑即愈（`install.sh:43-49` + `postinstall.ts:102-126`）。
- （low）stuck 卡装检测以「点过复制按钮」起算，手抄命令用户永不触发（`Onboarding.tsx:33-36` 注释自认的设计权衡代价）。

## 被驳回发现

**1.（原 high，驳回）「r45~r58 共 108 提交证明 0.1.3 发布时点对外承诺系统性漂移，属事后追账」**
- 驳回理由（confidence: high）：引用的 7 个提交全部核实为真，底层历史事实成立，但两个核心定性均不成立——
  - **时序错位**：CHANGELOG [0.1.3]（2026-10-05 定稿，HEAD `1ed138f` 即补记提交）将 r45~r58 全部修复聚合在 0.1.3 名下，0.1.3 发布时点承诺与实现已一致（README 已改口、终局零残留有测试锚、203 用例全绿、`b2ecf83` registry 钉版门禁就位）。漂移窗口属已发布的 **0.1.2**（09-16 发布 → 09-26 零配置改口 / 10-02 终局即删修复），不属 0.1.3。
  - **定性反了**：承诺级修复均**先于** 0.1.3 发布落地并随其交付，这是发布前收敛而非事后追账；「追账」要求修复晚于失真版本发布，对 0.1.3 不成立。
  - 另：「内容不出本机」早在 09-20（`e059248`）已主动改为不可证伪表述并如实归因 CLI 上云。
  - 修正为 low：剩余仅是「0.1.2 曾有约 2-3 周承诺失真窗」的流程教训，属已消灭的 0.x 早期历史状态。

**2.（严重度校准，非事实驳回）** 发布就绪度 3 项确认发现均被降级（critical→medium、high→medium、high→low），理由见确认清单核实意见——事实成立，定级与实际损害不匹配。

审计自我纠错机制本次实际发挥了作用：6 维度原始输出含 1 critical + 2 high，对抗核实后无一存活原级。

## 达到「高质量完成」必须修的 Top 5（按投入产出排序）

**1. `README.md:28`——消除「CWS 审核中」失实表述（~5 分钟）**
要么实际提交 CWS 并入库材料佐证，要么改为「准备提交 CWS，上线前先手动加载」。这是全仓库唯一存活的对外表述失实点，一行改动即消灭，投入产出比最高。

**2. `apps/extension/src/sidepanel/App.tsx:1065-1068`——authHint 正则补额度类错误（~半小时）**
正则追加 `usage ?limit|limit reached|quota|insufficient credits|额度`，文案给「订阅额度已用尽——等待额度重置、升级套餐或切换账号后重试」。直接命中「复用已有 CLI 订阅」核心卖点下最高频的真实失败场景，与未登录场景的中文指引拉平。

**3. `apps/extension/src/background/sw.ts:307`（isNormalPage）+ `App.tsx:764`——PDF 页面专项分型（~1 小时）**
按 `content-type`/URL 特征识别 http(s) PDF，走 unsupported-page 同款路径，给出「PDF 暂不支持，转存 HTML 或粘贴正文追问」的如实告知，替换当前对 PDF 必然无效的「滚动触发懒加载」指引。

**4. `apps/extension/src/sidepanel/Settings.tsx:209` / `:431-434`——设置页错误码中文映射（~1 小时）**
仿 `App.tsx:1027` ERROR_LABEL 建 host 错误码映射表（read-fail/bad-name/delete-fail/reveal-fail），替换裸拼 `` `${m.code}: ${m.message}` ``；顺手补 `App.tsx:1057` missedErrBubble 的 authHint 归一与 `App.tsx:628` 未知码的「未知错误（码 X）」兜底，消灭全产品最后一处错误码裸露面。

**5. 文档同步一次性 PR：`README.md` + `DECISIONS.md`（~1-2 小时）**
- `README.md:112`：177→203，开发者节补 `pnpm test`；
- `DECISIONS.md:72`（D10）：补记 install.sh 主线修订（npm 降为备选）；
- `DECISIONS.md:99`（v2 路线图）：追问对话、全文搜索标记「已在 v1 交付」并移出；
- `DECISIONS.md` 决策 #1：「零配置」→「零账号·零 API key」，对齐 0.1.3 全口径。
单 PR 收敛全部文档漂移根源（修订只打到部分文档），并考虑把用例数口径纳入 `scripts/check-version.mjs` 同类门禁。

---

**终审一句话**：工程纪律是真的（203 全绿、红线靠删功能守住、对抗核实后零 critical/high 存活），缺口集中在「最后一层文案归一化 + 文档同步」这一薄层——Top 5 合计约一个工作日内修完，修完即无愧「高质量完成」四字。
