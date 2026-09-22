渣渣，以下为独立产品审计报告（r44-audit，2026-09-23）。

# PageDive 产品审计报告（独立复审）

> 审计对象：Side Panel 全部用户可见面。方法：代码逐行（App / SummarizeView / History / Settings / index.css 全文 2052 行）+ 单张 hero 态实景截图交叉验证 + 对 `research/product-audit-r43.md` 的对抗核查。评判基线：四原则（名实一致 / 状态归属 / 进退对称 / 体系收敛）。

---

## 一、功能完备性

### F1 ⚡ 技能微标在追问轮虚假标注——r42 修掉的问题经 r43 改形后复发 【P0】
- **问题**：技能仅随首轮注入（`send()` 里 `hasSession ? undefined : skills`，SummarizeView.tsx:254-260）。r42 已判定「追问轮亮徽标 = 虚假标注」并修掉气泡形态。r43 把徽标迁到 tips 行做**常驻微标**（SummarizeView.tsx:992-996），但它只读 `pd-enabled-skills`，不感知轮次——追问轮微标照亮，title 承诺「总结时注入增强指令」，实际该轮不注入。同一产品对同一事实（技能首轮-only）在两轮迭代里修了两次形态、错了一次语义，根因是**常驻展示形态与轮次语义错配**，不是徽标挂哪儿。
- **证据**：SummarizeView.tsx:260（注入判定）vs SummarizeView.tsx:993（title 文案「已启用技能（总结时注入增强指令）」）。
- **建议**：追问态（`hasSession`）微标降透明 + title 改「追问轮不注入技能——新对话后生效」；或微标只在首轮前可见。禁止常驻亮标。
- **级别**：**P0**（名实不符，与 r43 自判 P0 的 F3 同性质复发）。

### F2 同屏两个「空输入发送」入口跑不同档位 【P0】
- **问题**：hero 态大 CTA「深度总结本页」显式传 `forceWf='deep'`；但同一屏的输入框 Enter / 金色发送钮走无参 `send()`——`wf = workflow === 'default' ? 'deep' : workflow`（SummarizeView.tsx:254），`workflow` 是 **localStorage 持久值**（r16 起）。用户昨天选过「论文模式」，今天打开新闻页：界面大按钮写着「深度总结本页」，空输入按 Enter 实际跑论文模式。气泡虽诚实标注「论文模式本页」，但用户已点了看起来是「深度总结」的操作。两个入口、同一手势语义、不同执行——名实分裂。
- **证据**：SummarizeView.tsx:1055-1063（CTA 双按钮）vs 254（wf 映射）vs 926-931（发送钮 disabled 只看 `usableCount`）。
- **建议**：空输入 + 无会话时让发送钮与 CTA 同语义（空输入发送即走 `deep`，或发送钮在空输入且 `workflow≠default` 时也走 CTA 的显式档）；至少 hero 态把「当前将执行：论文模式」体现在 CTA 文案或模式下拉高亮上。
- **级别**：**P0**。

### F3 「正在分享」进行时态在 hero 态是谎言 【P1】
- **问题**：tips 条「正在分享「…」」随 `pageMeta` 存在即渲染（SummarizeView.tsx:496,980），hero 态（用户尚未做任何操作）也在宣称「正在分享」。截图实证：面板处于空闲态（中部空白、无消息流），tips 已显示「正在分享「2026年9月，前端圈…」」——此刻没有任何分享行为发生。
- **证据**：截图顶部 tips 区；SummarizeView.tsx:979-981。
- **建议**：空闲态改「已就绪：「标题」· host」或「当前页面：…」，任务启动后再切「正在分享」。
- **级别**：P1。

### F4 `pageUnsupported` 只管内容区，输入区零联动 【P1】
- **问题**：chrome:// 页 placeholder 显示「当前页面无法提取正文」，但输入框 placeholder 仍是「想了解这个网页的什么？」、发送钮仍亮——用户输入后发送才收 `unsupported-page` 错误气泡。防御前移只做了一半（内容区），输入区名实矛盾。
- **证据**：SummarizeView.tsx:920（placeholder 只区分 `hasSession`）、928（disabled 不含 `pageUnsupported`）vs 1038-1048。
- **建议**：`pageUnsupported` 时输入框 placeholder 改「此页面无法提取——切换到普通网页后可用」并发送钮置灰。
- **级别**：P1。

### F5 恢复历史会话后 tips 可能残留历史来源页 【P1，待真机核验】
- **问题**：`resumeHistory` 把 `pageMeta` 设为历史条目的来源页（App.tsx:677）。此后用户点「新对话」再一键总结，SW 提取的是**当前锚定页**，tips 在新的 `page-meta` 广播到达前显示的还是历史来源页——总结结果与 tips 所指页面错位。
- **证据**：App.tsx:674-683；`page-meta` 仅随 panel-ready / tab 切换广播（App.tsx:295-300），任务启动路径是否重推未在本次素材中见到。
- **建议**：`beginSession`（新对话）时主动向 SW 请求当前 tab 的 page-meta，或清空 tips 至广播到达。
- **级别**：P1（若任务启动确会重推 page-meta 则降 P2）。

### F6 自定义 workflow 命中 `WF_LABEL` 键名时标签撒谎 【P2】
- 用户目录 shadow 内置 `deep` 后，下拉与气泡仍显示硬编码「深度总结」，实际跑用户正文。`WF_LABEL` 兜底逻辑对 shadow 场景无豁免（SummarizeView.tsx:1086,608）。

---

## 二、交互品质

### I1 ModelDropdown 禁用态零视觉样式，与 WorkflowDropdown 不对称 【P1】
- **问题**：追问轮两个下拉都禁用。WorkflowDropdown 有 `.pd-workflow-dropdown.inactive`（opacity .45 + cursor，index.css:1326-1335）；ModelDropdown 的 `className="pd-dropdown inactive"`（SummarizeView.tsx:782）**在全部 CSS 中无对应规则**（已 grep 两份 css 验证）。追问轮 CLI 下拉看起来完全可点，仅 hover 有 title——触屏 / 不 hover 的用户无从得知为何切不了 CLI。同一顶栏、同一禁用语义、两种视觉语言。
- **建议**：补 `.pd-dropdown.inactive { opacity:.45; cursor:default }`，或两处共用一个 `.inactive` 规则。
- **级别**：P1（体系收敛缺口 + 状态不可感知）。

### I2 历史删除 / Finder 按钮键盘不可达 【P1】
- **问题**：`.pd-history-item-action { display:none }`，仅 `:hover` 才 `display:flex`（index.css:1589-1604），无 `:focus-within`。`display:none` 元素不可聚焦——键盘用户 Tab 永远跳过这两个按钮，历史删除功能对纯键盘用户**断链**。而列表主按钮（打开详情）键盘可达，形成「能进不能删」的半可达态。
- **建议**：默认 `visibility:hidden`/`opacity:0`（保留可聚焦）替代 `display:none`，加 `.pd-history-item:focus-within .pd-history-item-action { display/visibility 开启 }`。
- **级别**：P1。

### I3 「新对话」零确认收割在跑任务，与删除两步确认不对称 【P1】
- **问题**：running 中点「新对话」→ `new-session` 直接取消任务 + 清空对话（SummarizeView.tsx:358-365），无任何确认。对比：历史删除是低频可逆性差的动作，做了两步确认（HistoryView.tsx:54-65）；「取消正在烧 token 的总结 + 清空全部对话」破坏面更大却一键生效。顶栏「新对话」紧邻 CLI 下拉，窄面板误触概率不低。
- **建议**：running 时「新对话」改两步（按钮变「确认结束并清空？」），或至少在气泡区给「已取消进行中的总结」回执。
- **级别**：P1。

### I4 第四条 notice（attachNotice）漏网：inline style + 旧动画谱 + 缩进破格 【P1】
- **问题**：r43 I1 修了三条 notice 并宣称「三处 inline style 清除」，但输入区还有第四条——附件跳过提示仍是纯 inline style：`style={{ margin:'0 12px 6px', fontSize:12, color:'var(--color-pd-danger)' }}`（SummarizeView.tsx:522）。三重破格：① action-bar 已是 16px padding 体系，tips/chips/胶囊 r43 已归位 0 缩进，这条 12px 缩进独树一帜（r43 S1 修漏的同类）；② 动画用 `pd-rise-in`（14px 旧谱）而非 r43 新立的 `pd-slide-up-in` 底部滑入谱（A1 漏网）；③ 文字用 `--color-pd-danger`（≈4.2:1，背景/边框色）而系统文字专用 token 是 `--pd-danger-text`（8.1:1）——同类警示文字 `pd-error` 用的是后者。
- **建议**：并入 `.pd-bar-note` 类（可加 `.danger` 变体换色），归位 0 缩进，动画入滑入谱。
- **级别**：P1。

### I5 `pd-bar-note` 出现即布局重排，输入行跳位 【P1】
- **问题**：三条 notice 是 `pd-action-bar-inner`（flex-wrap）内的 `flex:1 1 100%` 行（index.css:900-937）。出现时把附件钮/输入框/发送钮整体挤到下一行，消失时跳回——用户在 running 中按 Enter，`enterHint` 弹出，输入框瞬间下坠 ~22px 且焦点中的光标位置视觉跳变。r43 把 notice 从「从未显示」修成「显示了」，但没考虑显示的**代价是重排**。
- **建议**：notice 行移出 `pd-action-bar-inner`（放 tips 与胶囊之间的独立层），或为 inner 预留固定 note 高位。
- **级别**：P1。

### I6 多行输入长高后内容区可视底部被遮 【P2】
- textarea 自适应至 110px 封顶（SummarizeView.tsx:159-165），输入区长高最多 ~90px，而 `.pd-content` 底 padding 固定 158px（index.css:692）——五、六行草稿时末条消息尾部滚不出磨砂区。P2。

---

## 三、视觉风格

### V1 hero 卡顶部对齐不居中，面板中段断裂 【P1，截图实证】
- **问题**：`.pd-placeholder { margin: 40px auto 0; max-width:320px }`（index.css:729）——卡贴在上部，600px+ 的面板中段是一整片空壁。截图视觉判读明确点名「上下两块悬浮、中间断裂，比例失衡」。聊天产品空闲态的惯例是视觉重心居中（或至少压向输入区），顶部对齐 + 底部悬浮输入区把面板撕成两截。
- **建议**：placeholder 容器改 `margin: auto 0`（垂直居中）或 `place-content` 居中；tips 与 CTA 的视觉链路自然接续。
- **级别**：P1。

### V2 字号谱实测 10 档（比 r43 统计还多 2 档），且仍有 inline 字号 【P1】
- **问题**：实测两份 css 合并 `font-size` 数值档：**10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 15 / 17 / 22 共 10 档**（r43 S2 记 8 档，漏 15px 与至少一处）。另有 3 处 TSX inline `fontSize`（App.tsx:728、SummarizeView.tsx:522、Settings.tsx:534）完全游离于任何谱系。
- **建议**：维持 r43 收敛方向，但把「禁造新档」的执行点放在 review 清单（inline fontSize 一律拒），否则规范只是纸面。
- **级别**：P1（确认 r43，数据修正）。

### V3 关于页 9 按钮堆叠，自违 emoji 规范 【P1】
- **问题**：关于页 actions 区平铺 9 个按钮（隐私政策/快捷键/微博/X/Reddit/HN/Bluesky/点赞/吐槽，Settings.tsx:761-779），5 个分享入口+2 个 emoji 按钮（👍💬）在 360px 侧栏里占了近两行视觉重心。分享是极低频动作，平铺=把最不重要的东西做成最显眼的东西。且 r43 S3 刚立「emoji 只限既有两个存量（⚠/⚡）」——实测 emoji 存量还有 ⭐①②③🎉👍💬（grep 全 TSX），👍💬 即是规范后新增。自己立的规范下一轮就破。
- **建议**：收成一个「分享」按钮 + 平台二级菜单（或原生 `navigator.share`）；👍💬 去 emoji 换 SVG 或改纯文字。
- **级别**：P1（体系收敛失败 + 自违规范）。

### V4 硬编码颜色绕开 token 体系 【P2】
- `.pd-history-item-title` 用 `#F0F0F0`（token 体系外新造的近白，text-1 是 #F5F5F5）、`#8C8C8C`（= `--pd-text-3` 的值但硬编码）、`#7E7E7E` 同理（index.css:1552-1579）。改 token 时这三处不会跟。

### V5 tips 行内 notice 双重间距 【P2】
- 容器 `gap:8px`（index.css:868）+ `.pd-page-tips-notice` 又 `margin-left:8px`（index.css:1931）——notice 与前元素距 16px、其余元素间 8px，同一行两种节拍。删 margin-left 即齐。

### V6 顶栏贴顶过紧 【P2，截图佐证】
- `pd-topbar` top:0 + padding-top 10px（index.css:546-554），截图判读「与上边缘几乎齐平，有被裁切感」。macOS 惯例主操作距容器顶 ≥12px。

---

## 四、动效品质

### A1 `pd-bar-note` 有进无退——r43 新增件违反 r43 自己的总检 【P1】
- **问题**：r43 A4 宣称「进退场对称性总检（通过）」，但 r43 同轮新增的 `.pd-bar-note` 只有 `pd-slide-up-in 280ms` 进场（index.css:931-937），三条 notice 全部条件渲染直接卸载、零退场。同轮还有 attachNotice（rise-in 进、无退）、reopened 提示条、enterHint 同样裸卸载。「总检通过」的结论对 r43 自己的变更就不成立。
- **建议**：bar-note 挂 `useExitValue` 播 120ms sink-out（既有 `pd-sink-out` keyframes 现成），或接受「轻提示无退场」但把它写进规范（哪些件允许无退场），不能一边总检通过一边裸卸载。
- **级别**：P1。

### A2 底部滑入谱覆盖不全：attachNotice 掉队 【P1】
- r43 A1 立谱「底部常驻件走 slide-up-in」，attachNotice 是底部输入区件却仍是 `pd-rise-in` 14px 旧谱（SummarizeView.tsx:522）。与 I4 合并修复。

### A3 切页时「成组入场」只剩 tips 独舞 【P2】
- tips `key={pageMeta.url}` 切页重播滑入（SummarizeView.tsx:496），胶囊（`pd-action-bar-inner`）无 key 不重播——r43 注释宣称的「tips 先入、胶囊交错**成组**」只在面板首开成立，切页时组员只剩一个在动，成组叙事名实不符。要么都重播（频闪风险），要么接受 tips 单动但把注释里的「成组」措辞收敛。

### A4 时长谱实测维持 12 档 + transition 5 档 【P1 数据更新】
- animation 12 档（120-380ms）确认 r43 A2；另实测 transition 5 档（0.1/0.12/0.15/0.18/0.2s）——r43 的三档收敛规范应把 transition 一并纳管，否则收敛一半。

---

## 五、与 r43 自查报告的差异

**r43 没发现的（本轮新增）**：
| # | 发现 | 级别 |
|---|---|---|
| 1 | ⚡ 微标追问轮虚假标注复发（F1）——r42 同款问题的形态转移 | P0 |
| 2 | hero CTA 与空输入 Enter 的档位分裂（F2） | P0 |
| 3 | attachNotice 第四条 notice：inline style/12px 缩进/旧动画谱/danger 色（I4） | P1 |
| 4 | bar-note 有进无退 + 出现即重排（A1/I5）——r43 总检盲区恰是 r43 新增件 | P1 |
| 5 | ModelDropdown 禁用零视觉（I1，grep 证实无规则） | P1 |
| 6 | 「正在分享」空闲态进行时谎言（F3，截图实证） | P1 |
| 7 | 历史删除键盘不可达（I2） | P1 |
| 8 | 新对话零确认 vs 删除两步确认的不对称（I3） | P1 |
| 9 | 关于页 9 按钮 + 👍💬 自违 emoji 规范（V3） | P1 |
| 10 | hero 卡顶部对齐中段断裂（V1，截图实证） | P1 |
| 11 | pageUnsupported 输入区零联动（F4）、tips notice 双重间距（V5）、硬编码色（V4）、字号实为 10 档（V2） | P1/P2 |

**不同意 r43 的**：
- **A4「进退场对称性总检（通过）」**——不通过。bar-note / attachNotice / enterHint / reopened 条均无退场，其中 bar-note 是 r43 当轮新增。总检结论过强。
- **F3「正确形态 = 输入区常驻状态微标」**——形态正确但语义没跟上：常驻微标表达不了「首轮 only」的注入语义，追问轮虚假标注即由此生（本轮 F1）。「常驻状态」与「轮次语义」需要显式桥接，不是换个位置就完。
- **F4「hero 态技能不可见，可接受」**——结合 F1 看，问题的完整形状是「hero 态不可见 + 追问态虚假可见」，两头都错位。单独判 P2 成立，但应与 F1 合并处置。
- **S3「emoji 只限既有两个存量」**——存量统计错误：grep 实测至少 ⚠⚡⭐①②③🎉👍💬 九种，规范立在一个没盘过库的前提上。

**确认 r43 的**：I1 修复验证（`flex-wrap` + `flex:1 1 100%` 生效，index.css:900-937）；S1 归位验证（tips/chips 0 缩进）；F2 `WF_LABEL.default='深度总结'` 已落（SummarizeView.tsx:1075）；S2/A2 碎片化方向正确（数据更新为 10 档/12 档+5 档）；F5 opencode 死码保留合理——但补一点：若按 DECISIONS 恢复上架，label「实验」与已知限制里「每次必弹且拦杀=基本不可用」的事实不符，恢复时应改文案。

---

## 六、审计者盲区自查

1. **截图仅一张、且是 hero 态**：流式输出态、追问态、错误态、设置页、历史页、Onboarding 均无实景截图，相关判断纯出自代码推演；截图分辨率低且经视觉模型转述（「前端圈」曾误读为「前瑞穗」），颜色/间距数值以代码为准。
2. **无真机交互**：动画时序体感（24px 滑入是否「丝滑」）、IME 输入、hover/focus 实态、屏幕阅读器播报（r43 I2 遗留项无法复核）、双层 backdrop-filter 的掉帧风险，均未实测。
3. **Settings.css 未逐行读**（仅 grep 交叉验证特定选择器）：设置页视觉细节存在审计空洞。
4. **SW / host 侧代码未读**：`page-meta` 广播时序（F5 的错位窗口宽度）、`summarize` 消息的 SW 分支行为属推断；历史/会话恢复的端到端一致性未验证。
5. **窄面板（<360px）与超长标题/超长 workflow 名的挤压**未做布局实测（I8/V10 类判断标注了推断属性）。
