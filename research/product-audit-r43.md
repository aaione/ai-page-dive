# PageDive 产品审计报告 r43

> 2026-09-23 · 范围：Side Panel 全部用户可见面（主对话 / 设置 / 历史 / 安装引导）
> 方法：四维扫描（功能 / 交互 / 风格 / 动画），以「高质量严苛」标准评判——凡与名实一致、
> 状态归属、进退对称、体系收敛四原则相悖者计为问题。结论分三级：P0 本轮已修 / P1 建议下轮 / P2 记录待 v2。

## 一、功能

### F1 模型显示双源摆动（P0 ✅ 本轮已修）
- **现象**：CLI 下拉模型行时而是 GLM 时而是 opus。
- **根因**：两条显示源不同步——① host 探测 `probeModel` 只读 `~/.claude/settings.json` 顶层 `model` 字段（代理用户配在 `env.ANTHROPIC_MODEL`，顶层无 → undefined）；② 任务运行时 SW `lastModels` 记录流内真实模型并 merge 进下拉。SW 30s 回收后 fresh 探测列表与 lastModels 互相覆盖，一有一无即摆动。`ANTHROPIC_DEFAULT_*_MODEL`（opus-4-7）在部分子任务路径被流内上报，是「opus」字样的来源。
- **修复**：`probeModel` 补读 `s.env?.ANTHROPIC_MODEL`（顶层 model 优先）——探测源稳定给出与流内一致的值，摆动消失。codex 侧读 `config.toml` 的 `model` 键，读法本就对称，无需动。

### F2 「默认模式」名实不符（P0 ✅ 本轮已修）
- `WF_LABEL.default = '默认模式'`，但 default 是「未显式选档」哨兵，实际执行映射 deep，空态 CTA 写「深度总结本页」——同一件事三个名字。已改 `default: '深度总结'`（内置 workflows 无 default 项，下拉无重名风险）。

### F3 技能状态归属错误（P0 ✅ 本轮已修）
- 技能是「设置里开的全局状态」，不是每条消息的属性。r37 起挂在用户气泡下（消息属性形态）+ r42 发现追问轮虚假标注。正确形态 = 输入区常驻状态微标：tips 行新增 `⚡ 名`（多技能 `⚡ 技能 ×N`），hover 有完整说明；气泡区不再占行。

### F4 hero 态技能状态不可见（P2 记录）
- tips 在首次 `page-meta` 后才出现，hero 态看不到技能微标。可接受：设置页开关本身可见、首次总结后即见。若日后要补，在 placeholder hint 加一行微字即可。

### F5 opencode 死码残留（P2 记录）
- `SummarizeView` 下拉 label 的 `a.id === 'opencode'` 三元是数据驱动的死码，无害。恢复 opencode 入口时自然复活，不清理。

## 二、交互

### I1 notice 行布局 bug + inline style 三连（P0 ✅ 本轮已修）
- **审计最重发现**：输入区三条 notice（模式替代告知 / 运行提示 / 不支持追问）的 `gridColumn: '1 / -1'` 写在 flex 容器里——**死属性**，提示文案从未按设计独占一行（低频出现所以从未暴露）。已修：容器补 `flex-wrap: wrap` + 抽 `.pd-bar-note` 类（`flex: 1 1 100%` 真正占满行），三处 inline style 清除。

### I2 tips 切页的屏幕阅读器重复播报（P2 记录）
- `PageTips` `role="status"` 随 key=url 重挂载，SR 用户每次换页被重读整条。信息本身对 SR 有价值；是否降为局部 aria-live 需真机 SR 实测定夺，不盲改。

### I3 textarea 高度自适应待核（P1 建议）
- `.pd-input` 注释称「高度由 JS 自适应」，长文本多行追问的实际体验未在本轮验证。下轮核对自适应上限与滚动行为。

## 三、风格

### S1 16px 边距体系破格（P0 ✅ 本轮已修）
- action-bar 容器 padding 已是 16px，但 tips `margin: 0 4px 8px`、attach-chips `padding: 0 2px 6px` 两处缩进破格（比输入胶囊浅 4px/2px，肉眼可见的不齐）。已归位 0 缩进，底部三件（tips/chips/胶囊）同缘。

### S2 字号谱系碎片化（P1 规范先行）
- 现存 8 档字号（10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 17 / 22）。严苛标准应收敛为 5 档语义化：10 微标 · 11 辅文 · 12 正文辅 · 13 强调 · 17+ 标题。本轮不起存量迁移（回归面大），立规范：新代码禁造新档，存量随改随迁。

### S3 emoji 与线性 SVG 图标混用（规范记录）
- `⚠`/`⚡` 文本符号与 1.4-1.5px 描边 SVG 并存。⚡ 自 r37 起已是技能认知符号，保留；规范：新图标一律 SVG 线性系，emoji 只限既有两个存量。

## 四、动画

### A1 底部滑入谱（P0 ✅ 本轮已修）
- r38/r42 两轮小位移（14px rise-in）实测感知弱（用户连续两轮报「没有动画」）。本轮立滑入谱：新 keyframes `pd-slide-up-in`（24px 位移 + easeOutQuint `cubic-bezier(.22,1,.36,1)` 丝滑收尾），tips 300ms 先入、输入胶囊 320ms/60ms delay 交错成组。reduced-motion 清单同步覆盖。

### A2 动画时长碎片化（P1 规范先行）
- 现存 12 档时长（120-380ms）。收敛目标 3 档：150 fast（反馈类）/ 250 base（内容类）/ 350 slow（容器类），曲线 3 条（ease-out / ease-back / slide 五次）。存量渐进迁移，不集中回归。

### A3 tips 切页无退场（P1 建议）
- 切页时旧 tips 直接消失换新（key 重挂载只有进没有退），标题瞬跳。既有 `useExitValue` 可保旧 meta 做 120ms sink-out，与 dropdown 收回同谱。工作量中、收益中，列下轮。

### A4 进退场对称性总检（通过）
- r36 建立的退场族（dropdown 收回 / hero 下沉 / overlay 淡出 / 历史详情下沉）与进场谱对称完好；r43 变更点（tips/胶囊/bar-note）的 reduced-motion 覆盖已核对无漏。

## 结论汇总

| 级别 | 条目 | 处置 |
|---|---|---|
| P0 | F1 模型摆动 · F2 默认模式 · F3 技能归属 · I1 notice 布局 bug · S1 边距破格 · A1 滑入谱 | ✅ 本轮已修并构建验证 |
| P1 | I3 textarea 自适应核对 · A3 tips 退场 · S2 字号收敛 · A2 时长收敛 | 规范已立，下轮渐进 |
| P2 | F4 hero 技能可见性 · I2 SR 播报 · F5 opencode 死码 | 记录在案，不盲动 |
