# r78 产品交互严苛自测报告（dev harness 全场景）

- 日期：2026-10-13 · run `wf_309b3d77-c3b`（23 agents / 538 工具调用 / ~16 min）
- 路径：dev server + chrome-mock（真机 Chrome 独立页签实测，各维度独立 pageId 并行）
- 编排：预飞（探通 + 交互面/mock 能力对账）→ 7 维度并行实测 → 每 finding 独立 skeptic 复现对质（判 real-bug / harness-limit / expected）
- 账目：75 断言通过；14 findings → **5 confirmed（4 个独立缺陷，两条同根因）/ 4 harness-limits / 5 误报驳回**；复核员 14/14 交卷

## 一、确认缺陷（按优先级）

### 1. [high] 流式输出全程不可见，done 才一次性上屏

- 复现（两次独立运行）：chunk#1 T+700ms 到达，T+799ms `.pd-md` 挂载但 `mdLen=0`，直到 T+2500ms done 全文 + 终局一次性出现；流式期间全程只显示「思考中…」
- 根因（StreamMarkdown.tsx）：生产入口 `main.tsx` 以 `<React.StrictMode>` 包裹 App；首个 chunk 触发首挂载排定 100ms 节流 timer → StrictMode 模拟卸载清理执行 `clearTimeout(timerRef.current)` 但**不置 null** → 模拟重挂载后 effect 首行守卫 `if (timerRef.current) return` 永远早退（timer 已死引用仍在）→ 后续每个 chunk 被挡，`rendered` 全程空串；唯一出路是 done 分支直接 `setRendered(text)`
- 单测漏网原因：StreamMarkdown.test.ts 手写 harness 用裸 `createRoot` 无 StrictMode
- **产品影响：真机流式 UI 核心体验失效**（有终局兜底，不丢数据）
- 修法（一行）：卸载清理同时 `timerRef.current = null`；单测补 StrictMode 形状

### 2. [medium] 完成气泡底部「新对话/复制/下载」按钮被 tips 条层叠遮挡（未滚到底时不可点）

- 复现：done 态未滚到底（atBottomGap 99px）时 elementFromPoint(按钮中心) 命中 `SPAN.pd-page-tips-text` 而非按钮；程序化 `btn.click()` 正常 → React 逻辑无缺陷，纯层叠问题
- 根因（index.css）：`.pd-action-bar > * { position: relative; z-index: 1 }` 抬升 tips 层压住静态定位的 `.pd-chat-actions`；底部 padding 158px 的「滚到底才让出磨砂区」设计在未滚到底时不成立（按钮 rect 与 tips rect 垂直重叠 22px）
- 修法方向：chat-actions 提 z-index（或 tips 层 pointer-events 让出重叠区）；真机 sidepanel 高度有限时必现

### 3. [medium] 全新总结完成后 PageTips 显示「（本轮未同步页面——基于此前内容作答）」——与事实相反

- 复现（两路径逐字核对）：默认态首轮总结 done 后 tips 逐字渲染降级文案；发追问后 30ms 内翻转为正确文案「· 追问已附当前页快照」——降级预告先于任何追问出现
- 根因（SummarizeView.tsx:656 + :1264-1269）：`dimmed={hasSession ? 'resume' : …}`——首轮 done 拿到 sessionId 即 hasSession=true，resume 分支按 `meta.resynced/unchanged` 三分，首轮两者恒 falsy 落入降级文案。**生产 SW 同构**（sw.ts 只在追问轮重抓路径广播 resynced/unchanged）——mock 忠实镜像，真机同样误显
- 与 r71 确立的「tips 如实」原则冲突：本轮明明成功分享正文
- 修法方向：分流依据改「本轮是否 followUp」而非单纯 hasSession；首轮完成后保持「已分享「…」」

### 4. [medium] 图文混合粘贴被图片接管，文本静默丢失

- 复现：DataTransfer 同含 image/png File 与 text/plain flavor → `defaultPrevented=true`、出图 chip、文本全页不存在、console 零告警
- 根因（SummarizeView.tsx onPaste）：只读 `e.clipboardData.files`，text 以 flavor 形式存在时不在 `.files`——「image 文件 + text flavor」被判纯图接管；全函数无 `getData('text/plain')`。**直接违背同文件注释自陈口径**（「图文混合走默认文本粘贴」）
- 修法方向：clipboardData 含 text flavor 时走默认粘贴（`files` 里纯图才接管）

## 二、harness-limits（mock 缺口，非产品缺陷）

1. [medium] done 气泡无 token 用量显示——mock 的 task-done usage 字段形状与 NM 协议失真（真机有）
2. [medium] 无历史入库提示——产品本来就不在 done 气泡展示 historyPath（设计如此）
3. [low] 取消气泡渲染 mock 的英文 message「task cancelled」——真机 host 回中文/结构化 message
4. [low] 历史删除二次确认后 mock 无回执帧、3s 窗口外静默回滚——mock 缺 history-delete 处理

## 三、误报驳回（5，防再报）

- 「≈1.2万 tokens」非「≈12,345」——finder 预期写错（UI 本地化格式化）
- 「?swcycle=lost 无会话入口，session-lost 是死代码」——实测可达（需先有会话态）
- 「unsupported 态附件按钮可点」——复现属实但属预期（加附件无害，发送恒禁用）
- 「历史详情不展示 frontmatter 元数据」——设计如此（列表项已含 meta）
- 「历史时间戳绝对时间非相对时间」——finder 预期无依据

## 四、harness 覆盖空洞（对账产出，14 条，高优 5）

| 高优空洞 | 说明 |
|---|---|
| Onboarding 安装引导全族 | route() 恒 ok:true——安装失败首旅程零覆盖 |
| `__host-disconnected` 三路径三戳 | mock 从不广播该帧（近期三轮修复重点无法回归） |
| task-error 非 cancelled 错误族 + refill 回填 | mock 任务恒成功；错误终局/回填无帧可触发 |
| panel-toggle 收起 / panel-anchor 换锚 | 无 SW，结构性不可测 |
| resume-history 历史恢复链 | route() 不处理该消息——点了没反应，与 swcycle 静态还原是两条链路 |

其余（medium）：codex 流形状恒 claude、task-alive 心跳/看门狗、SW 唤不醒分支、workflow-save/delete 回执链；（low）：低版本横幅、history-pruned、read-fail 退回、分片/128K 降级、new-session SW 侧语义。

## 五、建议

- 立即修：#1（流式，一行 + 单测补 StrictMode 形状）；#4（粘贴，含 text flavor 分流 + 单测）
- 紧随：#3（PageTips 首轮分流）；#2（chat-actions z-index）
- harness 补强挂账：高优空洞前两条（task-error 族 + host-disconnected 帧注入场景参数）
