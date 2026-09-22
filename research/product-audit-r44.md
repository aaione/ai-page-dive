# PageDive 产品审计处置报告 r44

> 2026-09-23 · 本轮与前几轮的本质区别：**审计不是自查，是真实启动的独立 CLI 任务**。
> 原始报告全文见 `research/product-audit-ai-r44-raw.md`（未删改）。

## 执行证据（workflow 真启动）

- **workflow**：`~/.ai-page-dive/workflows/product-audit/WORKFLOW.md`（新建，frontmatter + 四维审计框架正文，用户目录 shadow 体系——日后总结任何网页产品时可复用）
- **启动方式**（对齐产品自身调用谱：prompt 走 stdin、`--allowedTools=Read` 进程级围栏）：
  ```bash
  claude -p --allowedTools=Read < /tmp/pd-audit-r44-prompt.md > /tmp/pd-audit-r44-out.md
  ```
- **素材**：DECISIONS.md、五个 UI 源文件、用户实景截图（hero 态）、r43 自查报告（供对抗核查）
- **独立性**：CLI 首次接触产品，逐行读了 2052 行 CSS + 全部 TSX；它甚至抓到了启动后落盘的 r44 分享按钮改动（V3「9 按钮堆叠」当场打脸本轮代码）

## 审计发现 vs 处置对照

### P0（两条，全部实施）

| # | 发现 | 处置 |
|---|---|---|
| F1 | ⚡ 技能微标追问轮虚假标注**复发**（r42 同款问题的形态转移：r43 迁到 tips 常驻微标后只读全局开关、不感知轮次，title 承诺「总结时注入」实际追问轮不注入） | ✅ PageTips 加 `dimmed` prop：追问轮微标 opacity .45 + title 改「追问轮不注入技能（新对话后生效）」 |
| F2 | hero CTA「深度总结本页」与空输入 Enter **档位分裂**（CTA 显式 deep，Enter 吃 localStorage 记忆档——界面承诺与执行不符） | ✅ `send()`：空输入+无附件+无会话（=一键路径）强制 deep 与 CTA 同语义；有自定义输入才按所选档 |

### P1（十项，全部实施）

| # | 发现 | 处置 |
|---|---|---|
| F3 | hero 空闲态「正在分享」是进行时谎言（截图实证） | ✅ idle（无消息）时改「已就绪」，任务/会话期保持「正在分享」 |
| F4 | pageUnsupported 只管内容区，输入区 placeholder/发送钮零联动 | ✅ ActionBar 传 `pageUnsupported`：placeholder 改口 + 发送钮置灰 |
| I1 | ModelDropdown 禁用态 `pd-dropdown inactive` 全 CSS 无对应规则（追问轮看似可点） | ✅ 补 `.pd-dropdown.inactive { opacity:.45; cursor:default }` 与 workflow 下拉同语言 |
| I2 | 历史删除按钮 `display:none` 键盘不可聚焦——纯键盘用户**能进不能删**（a11y 断链） | ✅ 改 `visibility:hidden` 保留焦点链 + `:focus-within` 双通道开启（confirming 态同步补 visibility） |
| I3 | running 中「新对话」零确认收割在跑任务——与历史删除的两步确认不对称 | ✅ running 态两步：首击变「确认结束？」（danger 色，3.5s 窗口同删除谱），再击执行 |
| I4 | 第四条 notice（attachNotice）漏网：inline style + 12px 缩进破格 + rise-in 旧谱 + danger 背景色当文字色 | ✅ 归队 `.pd-bar-note danger` 变体（文字色用 danger-text 8.1:1） |
| I5 | bar-note `flex:100%` 在胶囊 flex 里出现/消失使输入行内部撕裂跳位（光标视觉跳变） | ✅ 三条 notice 移出 `pd-action-bar-inner` 成独立层——胶囊整体平移，不再内部换行 |
| V1 | hero 卡顶贴 40px + 面板中段一整片空壁（截图实证「上下两块悬浮、中间断裂」） | ✅ `.pd-content:has(> .pd-placeholder)` flex 化 + `margin:auto` 垂直居中——`:has` 只在 hero 态切换布局，消息流零回归 |
| V3 | 关于页 9 按钮平铺（5 分享+点赞吐槽）——低频动作做成最显眼的东西；👍💬 自违 r43 emoji 规范 | ✅ 分享收二级：「分享给朋友」+ 展开式 3 列网格（微博/𝕏/Reddit/HN/Bluesky）；「点赞 👍/吐槽 💬」→「GitHub 点赞/反馈吐槽」纯文字 |
| V5/V6 | tips notice 双重间距（gap 8 + margin-left 8）；顶栏贴顶过紧 | ✅ 删 margin-left；topbar padding-top 10→12 |

### 顺手修（审计衍生）

- `motion.ts` 存量类型错误（r36 起 `setShown(null)` 与签名不符，vite 不查类型从未暴露）→ state 修正 `T | null`，tsc 全绿

### 降级与记录（不盲从审计）

| # | 审计判断 | 本轮裁决 |
|---|---|---|
| F5 | 恢复历史后 tips 残留来源页（P1 待核验） | **降 P2**：核验 sw.ts:695——`startSummarize` 提取成功必重推 page-meta，残留窗口秒级且自动纠正；审计自设的降级条件成立 |
| A1 | bar-note 有进无退违反 r43「总检通过」 | 接受批评但取其第二方案：**轻提示允许裸卸载**写入规范（注释已落）——瞬态 note 不值得 useExitValue 复杂度；r43「总检通过」结论确属过强，记录在案 |
| V2/V4/A4 | 字号实为 10 档（非 r43 记的 8 档）；硬编码色 3 处；transition 5 档纳管 | 数据采纳，规范更新，存量渐进迁移不集中回归（维持 r43 节奏） |
| F6 | 自定义 workflow shadow 内置 deep 时标签撒谎 | P2 记录（极低频：需用户刻意同名 shadow） |

## 方法论收获（为什么会抓到自查抓不到的）

1. **实现者自审的结构性盲区**：r43「进退场总检通过」的结论对自己当轮新增件（bar-note）就不成立——改代码的人默认它是对的；独立审计逐行 grep `.pd-dropdown.inactive` 无规则才发现禁用态裸奔。
2. **形态迁移会带走语义债**：r42→r43 技能徽标换了三次挂载点，「追问轮不注入」的语义约束每次都要人肉重新接——本次以 dimmed+title 改口显式桥接。
3. **规范立得太快会自违**：r43 立「emoji 只限两个存量」时没盘过库（实测 9 种），且当轮就在新增 👍💬。规范前先 grep 全库。
