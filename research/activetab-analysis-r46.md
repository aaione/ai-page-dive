# activeTab / sidePanel / scripting 差距分析报告（r46）

对照来源：官方 activeTab 概念页、permissions API 页、sidePanel API 页、scripting API 文档 + Chromium 源码错误串（见 doc-activetab / doc-scripting / doc-sidepanel 三份核对结论）；本地实现：`apps/extension/public/manifest.json`、`apps/extension/src/background/sw.ts`（754 行）、`apps/extension/src/sidepanel/App.tsx`、`apps/extension/src/sidepanel/Settings.tsx`、`apps/extension/src/content/extract.ts`。

---

## 1. activeTab / sidePanel 使用与官方语义的偏差

### 1.1 两个关键点的判定

**「点图标打开面板是否授予 activeTab」——授予，且本实现路径正确。**
- 官方四手势清单第 1 项 "Executing an action" 即工具栏 action 点击。本地实现（sw.ts:107）显式 `setPanelBehavior({ openPanelOnActionClick: false })`，走 `action.onClicked` → `sidePanel.open({ tabId })`（sw.ts:198-210）。点击本身完成手势授予，与官方一致。
- 关键规避：doc-sidepanel a 项证实 `openPanelOnActionClick:true` 时 Chrome 消费掉点击、`onClicked` 不触发——本地 r8 注释（sw.ts:102-106）已记录此实证并选了正确路径。**与官方（未成文的）实际行为对齐，无偏差。**
- 附带正确项：`commands._execute_action`（Cmd+Shift+D）属官方手势第 3 项（commands API 快捷键），快捷键路径同样授予且触发 onClicked，链路成立。

**「面板内点击是否手势」——不是 activeTab 手势。**
- 官方手势清单不含"扩展页内点击"；doc-sidepanel d 项明确面板内点击不（再）授予 activeTab（它只满足 `sidePanel.open` 的 user gesture 要求，那是另一个 API 的要求）。
- 本地实现依赖 action 点击时刻的残留授权：面板内点「总结」→ `executeScript` 用的是**此前那次 action 点击授予的 per-tab 临时授权**。链路自洽，但有一个隐含依赖：activeTab 授权在「面板开着、用户未离开该页」期间持续（官方：授权持续到导航离开或关 tab）。锚定 tab 内**跨源导航**（sw.ts:247-259 注释已识别）会撤销授权，面板不收起（锚定是页签维度），此时点总结 → `no-permission` → 文案「点工具栏图标重授权」指引正确。**无偏差，闭环成立。**

### 1.2 官方空白区的本地姿态（无偏差但有暴露面）

| 官方空白 | 本地姿态 | 评估 |
|---|---|---|
| 非手势路径打开面板（侧边栏下拉）是否授予 | sw.ts:627-634 fallback 注释「不会造成越权（executeScript 直接被 Chrome 拒绝）」 | 正确——官方四手势外不授予，Chrome 拒注入。实际暴露面极小：全局默认 `enabled:false` + 锚 per-tab true（sw.ts:136-147），非锚 tab 的下拉里选不到 PageDive |
| 切 tab 后授权是否保留 | target 不随切 tab 变（锚定语义） | 官方未定义；实测授权随 tab 而非焦点，切回仍可用。本地"切回锚 tab → 仅刷新 page-meta"不重注入，若授权意外失效由 no-permission 兜底。可接受 |
| SW 回收后授权状态 | 见第 3 节 | 授权在浏览器侧，不受 SW 回收影响（社区共识）；本地 session 恢复设计与此不冲突，但缺自验用例 |
| 扩展 reload 后授权 | 未处理 | 必然撤销（等效浏览器状态重置），走 no-permission 兜底，可接受 |

---

## 2. 错误分类对照官方 executeScript 失败模式全集（A–F）的误伤与遗漏

### 覆盖矩阵

| 官方组 | 触发可能 | 本地归类 | 判定 |
|---|---|---|---|
| A 参数校验（files/func 互斥等） | 不可触发（用法固定） | — | ✅ |
| B `No tab with id: *`（注入瞬间 tab 已关） | 可能 | `injectErr` 落 **no-permission**（sw.ts:681） | ❌ 误伤：对已关 tab 指引「点图标重授权」空转 |
| C 主机权限类（`Cannot access...` / 受限页） | 核心场景 | **no-permission**（sw.ts:681）；受限页前置 `unsupported-page`（sw.ts:639, isNormalPage） | ✅ 正确（真授权失效场景） |
| D `Could not load file` | dist 损坏/升级中 | **inject-failed**（sw.ts:679，r46 已修） | ✅ |
| D 其余（空 files/重复/UTF-8/超限） | 几乎不可触发 | 落 no-permission | ⚠️ 理论遗漏，实际可忽略 |
| E `Frame ... showing error page` / `is not ready` / `was removed` | 可能（网络错误页、渲染竞态） | **两级误伤**，见下 | ❌ |
| F registerContentScripts | 不使用 | — | ✅ |

### E 组的隐性误伤链（最重要发现）

官方文档明文：**多 frame 注入的返回数组只含成功 frame，失败 frame 被静默省略**。本地 `extractBest`（sw.ts:591-607）的 func 注入 `catch(() => undefined)` 后只看 `pages.length`：

1. **全部 frame 被静默省略**（典型：页面正显示网络错误页、frame not ready）→ `results` 为空数组（不是 undefined，不会走 catch）→ `pages` 空、`errs` 空 → **no-permission**。物理原因是页面状态，指引「点图标重授权」空转。
2. **`__pagediveExtract` 自身抛异常**（extract.ts:136-138 catch 返回 `{error: String(e)}`，如页面 JS 冲突、病态 DOM 爆栈）→ errs 只含非 `empty-content` 字符串 → **no-permission**。code-errors 报告的「no-permission 兜底过宽」在官方语义下确认为惯犯路径。
3. **主 frame 省略、仅小 iframe 成功** → 竞选出小 frame 正文 → 不报错但内容错（静默质量事故，无 notice）。低概率但存在。

### 遗漏的独立分类

- **tab-closed**（B 组 + E 组 `Tab containing frame ... was removed.`）：应与 no-permission 分离——正确指引是「页面已关闭」而非重授权。
- **frame-not-ready / error-page**（E 组）：正确指引是「刷新页面后重试」，当前无此分类。
- 追问轮 `startFollowUp` 无注入，不涉及 A–F。✅

### code-errors 报告的其余误伤确认（与本节交叉验证）

均属实：timeout/parse/host-shutting-down 挂 `cliFault=true`（「CLI 报告运行失败」前缀错怪对象，前两者是本机组件侧物理原因）；content-mismatch 双份文案拼接（sw.ts:501 message 与 ERROR_LABEL 同义重复）；`bad-request`（sw.ts:382）缺 onStartResult 翻译走裸码；sw.ts:294 异常兜底 `String(e?.message)` 原文直出。

---

## 3. SW 回收丢 target 与 fallback 策略的风险、官方推荐做法

### 现状

- `target`（sw.ts:92）是纯 SW 内存态；`persistSession` **不持久化 target**（只存 panelTabId/panelWindowId 等，sw.ts:62）。
- SW 回收后两条重建路径：
  - `panel-ready`（sw.ts:305-324）：`!panelTabId || !target` 时 fallback `tabs.query({active:true, lastFocusedWindow:true})`，取活跃普通页为锚+target。
  - `startSummarize`（sw.ts:630-634）：`target?.id` 失效时 fallback 同样 query。

### 风险

1. **fallback 语义弱于可用的确定性重建**：`panelTabId` 已从 storage.session 恢复，本可直接 `tabs.get(panelTabId)` 重建 target——activeTab 授权在浏览器侧、不随 SW 回收（官方未明文但普遍观察），重建后**授权仍有效**。当前用 `query(active, lastFocusedWindow)` 重建，多数场景下 active === panelTabId 结果等价，但引入两个偏差面：
   - 面板本身可能是 lastFocusedWindow 的焦点"页"——代码已用 `isNormalPage` 排除（sw.ts:629 注释），但排除后 `tab = null` → `no-tab`，而正确的答案本是"用 panelTabId 拿锚 tab"。
   - `panel-ready` 分支里 `panelTabId = active.id`（sw.ts:313）**覆盖已恢复的锚**：若用户切走 tab 后面板经任何路径重开，锚被改写为当前活跃 tab——锚定承诺被静默漂移（该 tab 可能无 activeTab 授权，后续注入失败归 no-permission）。
2. **官方推荐做法无明文**；事实标准是：持久化目标 tab 标识（本实现已有 panelTabId）+ 恢复时 `tabs.get` 重建 + 接受 activeTab 浏览器侧持久性 + 注入失败时以错误文案引导重手势。本地实现已完成 80%，差"用 tabs.get(panelTabId) 替代 query(active)"这一步。
3. followUp 不需要 target，session-lost 已正确兜底（sw.ts:372 + App.tsx:617 自愈闭环）。✅
4. doc-activetab 落地含义中建议的 dev harness 自验用例（「action 点击后跨 SW 回收仍可 script 注入」）**尚未落地**——r45 的 chrome-mock（src/dev/chrome-mock.ts）`contains` 恒 false、无 activeTab 生命周期模拟。

---

## 4. optional_host_permissions 实现正确性（对照官方）

### 已正确的部分

- manifest 声明 `optional_host_permissions: ["<all_urls>"]`（manifest.json:15-17）——安装时不产生 host 警告，符合 activeTab 页"零警告替代"定位。
- Settings.tsx:102-121：`permissions.contains({origins:['<all_urls>']})` 查询——**origins 形式的 optional host 授予是持久的、contains 可查**（官方 permissions API 明文，与 activeTab 临时授权不可查形成对照，doc-activetab d 项）。用法正确。
- `request()` 在 toggle 点击的同步手势内调用（官方硬性要求）✅；用户拒绝时 `g=false` 正确回写 ✓；`remove()` 对称 ✓。
- 授予后 host permission 持久覆盖该 origin，注入逻辑无需区分授权来源——天然正确（官方虽未写叠加语义，持久授权 ⊇ 临时授权，无冲突面）。

### 偏差与遗漏

1. **无 `permissions.onAdded` / `onRemoved` 监听**：授予/撤销只反映在 Settings 面板自身 state；SW 侧、其他已开面板实例不感知。后果轻（授权只影响注入成功率，无需主动动作），但 Settings 关闭再开前状态可能陈旧（含 grant 后 contains 的回填时序）。
2. **产品联动缺失**：no-permission 错误文案（App.tsx:589）只指引「点图标重授权」，不告知设置里有免手势选项——高频受挫用户发现不了这个出口。
3. **与 CLAUDE.md 硬约束 1 的文面冲突**：约束写死「不申请 `<all_urls>`」，r46 的 optional 形式是事实修订但文档未同步——按项目规则「违反即 bug」的字面解释会造成审读混乱。需要把约束 1 补一句「optional_host_permissions（用户显式授予）除外」。
4. dev chrome-mock `contains` 恒 false——dev harness 下 toggle 行为未仿真，仅影响自验覆盖。

---

## 5. 修复建议（按优先级）

### P1 — no-permission 兜底拆分（E 组误伤链）

- **问题**：`extractBest` 把"全部 frame 静默省略 / `__pagediveExtract` 抛异常 / executeScript 整体 undefined"一律归 no-permission（sw.ts:601-604），指引「点图标重授权」对页面状态类物理原因空转；B 组 tab 已关同样落 no-permission（sw.ts:681）。
- **证据**：官方"失败 frame 被静默省略"+ E 组 `showing error page` / `is not ready` / B 组 `No tab with id`；r46 之前 inject-failed 曾同样误归此处（注释自认惯犯路径）。
- **方案**：① `extractBest` 区分 `results === undefined`（整体 reject → 保留 no-permission，含 detail）与 `results.length === 0`（全 frame 省略 → 新码 `page-not-ready`，文案「页面尚未就绪（可能显示错误页）——刷新后重试」）；② func 内 catch 的原始 error 串透传（errs 取首个而非仅比对 empty-content），含 `RangeError`/`Script error` 类 → 新码 `extract-crash`，文案「页面脚本冲突导致提取失败」；③ injectErr 匹配 `/No tab with id/i` → 新码 `tab-closed`，文案「页面已关闭」。
- **风险**：低——纯错误归类拆分，UI 需在 onStartResult 表补 3 项翻译；`page-not-ready` 与 `empty-content` 文案需明确区分（前者页面异常，后者页面正常但无正文）。

### P2 — SW 回收后的 target 重建改为确定性路径

- **问题**：`panel-ready` / `startSummarize` 的 fallback 用 `query(active, lastFocusedWindow)` 且 `panel-ready` 分支会用 active.id **覆盖已恢复的锚**（sw.ts:313、632），锚漂移 + 可能选中无授权 tab。
- **证据**：panelTabId 已持久化恢复（restoreSession），activeTab 授权不随 SW 回收（浏览器侧状态）；query 语义在"面板自身是焦点页"场景靠 isNormalPage 排除后直接落 no-tab，而正解是锚 tab。
- **方案**：两处 fallback 改为：先 `tabs.get(panelTabId)`（恢复态优先，成功即重建 target 且不改锚），失败再退 query(active)。`panel-ready` 里 `panelTabId = active.id` 仅在 panelTabId 为 null（真无锚）时执行。
- **风险**：低——行为只在"SW 回收 + 面板重开"窗口变化；需回归 r14 场景（侧边栏下拉打开的无锚面板首次锚定）不受影响（panelTabId===null 分支保持现状）。

### P3 — content-mismatch 双文案 + cliFault 误标修正

- **问题**：SW 下发的 message 与 ERROR_LABEL 同义拼接出两遍「正文传输不完整…请重试」（sw.ts:501 + App.tsx:818-827）；timeout/parse/host-shutting-down 标 `cliFault=true` 错挂「CLI 报告运行失败」前缀。
- **证据**：code-errors 报告 2/3/4 条，物理原因均为本机组件侧。
- **方案**：SW 下发 content-mismatch 时 message 置空（UI 只用 ERROR_LABEL）；ERROR_LABEL 表加 cliFault 白名单（spawn-fail/parse/no-agent/content-mismatch 为 true，timeout/host-shutting-down 改 false 或引入 `hostFault` 第三前缀）。
- **风险**：低——纯展示层；注意 timeout 语义上仍可能由 CLI 卡死引起，改前缀为「本机组件」比「CLI」更准确但需文案评审。

### P4 — onStartResult 补 `bad-request` 翻译 + optional host 联动

- **问题**：`resume-history` 缺参走裸码 `bad-request`（sw.ts:382，翻译表无此项）；no-permission 文案不引导设置里的免手势授权。
- **证据**：code-errors「缺 UI 翻译」节；第 4 节产品联动缺失。
- **方案**：onStartResult 表补 `bad-request: '请求参数不完整，请重试'`；no-permission 文案尾部加「或在 设置 → 网页读取授权 开启一次授权，之后无需每次点击图标」。
- **风险**：极低。注意 CLAUDE.md 硬约束 1 需同步补 optional 例外，否则文案推广与约束文面冲突。

### P5 — dev harness 补 activeTab 跨 SW 回收自验

- **问题**：doc-activetab 落地含义建议的自验用例（action 点击 → SW 回收 → 仍可 script 注入）未落地；chrome-mock 无授权生命周期。
- **证据**：src/dev/chrome-mock.ts `contains` 恒 false、无 grant/revoke 模拟；官方对"SW 回收是否影响 activeTab"无明文（doc-activetab b 项），实现依赖社区共识行为。
- **方案**：chrome-mock 增加 `grantedTabs: Set` + `onActionClick` 授予 + `onCommitted` 跨源撤销的最小仿真；dev harness 加用例「点击授权 → 模拟 SW 重启（重置内存态、走 restoreSession）→ executeScript 仍成功」。
- **风险**：中低——mock 仿真与真实 Chrome 行为有偏差（正是官方空白区），用例注释须标明"仿真依据为社区共识，非官方保证"，防止未来 Chrome 行为变更时 mock 给出假绿。

---

## 结论

本地实现在两个关键决策点（`openPanelOnActionClick:false` 走 onClicked、面板内点击不依赖新手势）上与官方语义及实测行为**对齐且更保守**，r8/r15 的真机实证路径选对了。主要差距集中在**错误归类的粒度**（no-permission 吞掉 E 组页面状态类失败与 tab-closed）和 **SW 回收后 target 重建的确定性**（有 panelTabId 却用 query(active) 弱重建且可能覆盖锚）。optional_host_permissions 的 API 用法全部正确，差产品联动与 CLAUDE.md 约束同步。
