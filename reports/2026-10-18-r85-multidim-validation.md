# r85 九维并行全面验证——dist v0.1.4 多维度产品验证报告

> 用户指令：「启动专业且多维度的workflow全面执行打开谷歌浏览器加载当前编译的插件，全面验证产品」。
> 验证对象：`apps/extension/dist/`（v0.1.4，与 r83/r84 同版，期间零代码 commit）。
> 方法：10-agent workflow（run `wf_391a9248-8a7`）：九维并行（基线回归×3 + 新维度×6）→ 屏障 → 终审复核（跨维对账 + evidence 打假 + 完备性批判）。总计 157 次工具调用 / 721k tokens / 13.9 分钟。
> 输出纪律（r84 勘误制度化）：帧谓词先对 protocol.ts 核对（本轮 trackC.mjs:114 谓词已由 agent 当场修正为 `t:'history-file'`，探针数值 1510 chars 与之一致）；超时必须落 ABSENT 痕迹。

## 九维结果矩阵（全过，合计 64 检查项，零回归零 fatal）

| # | 维度 | 检查 | 结果 | 关键数值/证据 |
|---|------|------|------|--------------|
| 1 | A+D 基线·浏览器+历史联合路径 | 15 | ✅ | ID 命中、Onboarding 含真实 ID、pong hostVersion 0.1.4、真历史 9+ 条目渲染、点开正文完整（截图 01/19/20 目检） |
| 2 | B 基线·dev harness | 12 | ✅ | 12 场景含 lost 自愈（末帧计数 2）；首轮零修改零重跑 |
| 3 | C 基线·host 直驱真 CLI | 8 | ✅ | 首轮 isError:false usage 22702+1230（28.9s）、追问 2494（11%）同文件追加、九字段 frontmatter 三处交叉一致、history-file 探针补验 310ms 回帧 |
| 4 | E 性能（新增） | 4 | ✅ | launch 575ms / SW 存活 51ms / 面板冷加载 141ms / NM 往返中位 68ms（8 次 51-70ms）——全处阈值 1-5% 量级 |
| 5 | F 压力与边界（新增） | 7 | ✅ | 600KB 三分片重组精确 / cancel 终局+收割 / 三连起停后仍 pong / 2MB 超限帧 → desync 自终结（stderr「frame length 2097225 exceeds max 1048576…terminating host」、exitCode 0、huge 任务收 task-error cancelled）/ cancel 零落盘 |
| 6 | G 内容提取质量（新增） | 15 | ✅ | wiki（>2000 字符）/ GitHub / example / 30 万字病态页（200k 截断命中、script/css 噪音剔除、CJK 保留）四页形状全过 |
| 7 | H 包与权限审计（新增） | 5+外链 | ✅ | zip↔dist 文件集+逐字节一致 / 权限恰五项、无必需 host_permissions / 外链 37 条全分类（w3c 命名空间 22、react 文档串 2、终端命令 3、github 5、分享 intent 5），**运行时远程加载嫌疑 0** / 图标四尺寸 / 无内联脚本 |
| 8 | I 测试套件（新增） | 3 | ✅ | vitest **295/295**、host 行数 **2199 < 2200（余量仅 1 行）** |
| 9 | J UI 深走查（新增） | 4 | ✅ | markdown 渲染深度（h/li 计数>0）/ 设置持久化（语言跨 reload 保持）/ 流式输入态（见口径差）/ a11y 无名交互件仅 1 个 |

## 终审独立抽证（怀疑立场）

复核员独立核验并全部吻合：protocol.ts:300-301 HistoryFileMsg 帧名（勘误①口径）、host 源码四处锚点（stdio.ts unknown-message 分型 / task.ts:499 零产出守卫 / nm.ts:41 desync 终结 / task.ts:167 cancelled）、manifest 权限恰五项、CWS zip 逐字节对账、frontmatter 九字段与 session_id/usage/content_chars 三处交叉、三目录截图目检、vitest+行数复跑。未发现任何 evidence 与实际矛盾。

## 过程裁定记录（诚实账）

- **F 轨 oversize 判据修正（我的脚本错误，agent 纠正）**：脚本原判「host 不死」为过，产品 r5/r6-sec 既定语义是「NM 流失步唯一正确响应是终结本进程」——R3 判据改为 dead&&desyncTrace&&exitCode 0，实测吻合。我的原始注解与产品语义不符，以 agent 驳斥为准。
- **J 维 3 口径差（非缺陷）**：任务书预期「流式期间输入框禁用」，产品 r7-ux 决策（SummarizeView.tsx:1229 注释）刻意允许预输入——agent 未伪造 disabled 证据，改验防误发三件套（按钮切停止/Enter 拦截+提示/草稿保留）全生效后裁 PASS。
- C 轨 round1 usage 22702 高于 r84 基线 18632 约 4k：十千位量级自然波动，如实记录不判 FAIL。

## 新增挂账（low，v1.x 候选）

1. **历史正文标记泄漏**：历史详情把追问轮分隔注释 `<!-- pd:user -->` / `<!-- pd:assistant -->` 以纯文本渲染（A 轨目检发现，既有行为非回归；修复应在渲染层剥注释或落盘层转义）。
2. **a11y 弱名**：历史搜索框仅 placeholder 无显式名（placeholderOnlyCount=1，WCAG 弱名），建议补 aria-label。
3. **host 行数余量 1 行**（2199/2200）：C11 既有挂账的再确认——下一笔 host 改动前必须先做减法。

## 完备性批判：九维与 P3 均未覆盖的盲区（终审产出）

1. optional `<all_urls>` 用户授予流端到端（授予入口→permissions.request 弹窗→授权后免 activeTab 总结）
2. 分享按钮真实点击链路（intent 页面实际打开）
3. 键盘快捷键 Cmd+Shift+D（manifest commands 注册与触发）
4. 附件添加 UI 交互路径（单测有落盘/symlink 覆盖，UI 链无）
5. 双 tab 并发任务互斥/对账（pdRunningTask 单指针语义）
6. 卸载后 NM 注册与 ~/.ai-page-dive 留存/清理策略（CWS 隐私视角）

其中 1-3 已并入 P3 真机指引「顺带补验」节（成本约 5 分钟）；4-6 维持 v1.x 挂账。P3 已覆盖归属（不算盲区）：新机 install.sh 主线、拖 zip 安装、P1 横幅降升级。

## 结论

**dist v0.1.4 经九维并行验证 + 终审独立抽证：对 r83/r84 基线零回归；性能、压力边界、真实页面提取、包权限与零后端外链审计、测试套件与行数红线、UI 深走查六个新维度全部通过。终审提审信心判定：高。** 提审闸门不变：P3 新机空跑主线实测（用户真机，`store/p3-fresh-run-guide.md` 含新增顺带补验节）仍是最后一关。

## 证据索引

- workflow 运行：run `wf_391a9248-8a7`（journal：`…/subagents/workflows/wf_391a9248-8a7/journal.jsonl`，10 agents 全 done）
- 结果：`/tmp/pd-e2e-wf/track{A,D,B,C,E-perf,F-stress,G-extract,H-package,J}-result.json` + `probe-history-file.mjs` 探针（I 维为 pnpm test 输出，证据在 agent 呈报）
- 截图：`shots-a/`（5）+ `shots-b/`（10）+ `shots-j/`
- 驱动脚本（as-run 存档，含 agent 迭代修订）：`/tmp/pd-e2e-wf/track{A,D,B,C,E-perf,F-stress,G-extract,H-package,J-uideep}*.mjs`
- 历史样本：`~/.ai-page-dive/history/2026/10/18/010849-ai-pagedive-readme-e2e-直驱.md`
