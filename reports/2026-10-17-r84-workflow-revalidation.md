# r84 workflow 三轨复验——dist v0.1.4 零回归确认 + r83 两处勘误

> 用户指令：「启动workflow全面执行打开谷歌浏览器加载当前编译的插件，全面验证产品」（r83 同款指令的 workflow 编排复跑）。
> 验证对象：`apps/extension/dist/`（v0.1.4，与 r83 逐字节同版——期间仅 docs commits）。
> 方法：4-agent workflow（run `wf_b54e2cc1-fe4`）：轨 A/B/C 并行执行（r83 定稿驱动逻辑固化为 `/tmp/pd-e2e-wf/track{A,B,C}.mjs`，agents 执行+排障+结构化回报）→ 屏障 → 终审复核员对账 r83 基线（怀疑立场：弱证据降级）。总计 64 次工具调用 / 212k tokens / 11.7 分钟。

## 结果矩阵（三轨全绿 + 终审 overallPass=true / regressions=[]）

| 轨 | 载体 | 检查数 | 结果 | 迭代轮次 |
|----|------|--------|------|---------|
| A | CFT 真浏览器加载 dist | 10 | 全过 | 3 轮（均为脚本侧修复） |
| B | dev harness（vite 5199 自管自停） | 12 | 全过 | 2 轮（均为脚本侧修复） |
| C | host 直驱真 CLI | 8 | 全过 | 一次跑通 |

### 轨 A 要点（10/10）

manifest 0.1.4 / SW 存活且 ID 逐字符命中 `nclbhhhmgcabjlgmlbkoblipogajajgn` / Onboarding 指引含 install.sh 命令与真实扩展 ID（截图 01 目检）/ NM 注册后 SW `sendNativeMessage` ping→pong 逐字 `{"t":"pong","hostVersion":"0.1.4"}`（lastError null）/ host 就绪后面板主 UI 无指引残留（截图 02：新对话+claude 选择器+默认模式）/ chrome://settings 前台切换后占位卡片「当前页面无法提取正文——浏览器内置页…」在位（截图 03）。

### 轨 B 要点（12/12，覆盖超 r83）

默认 tips（已就绪+1.2万 tokens）/ swcycle=claude 会话还原「本轮已完成」/ 追问续流（lenDelta 114）/ 历史浮层（mock 条目）/ 设置面板（CLI 分区 claude 2.1.170/codex 0.157.0）/ 三错误路径（unsupported 占位、taskfail=timeout「一键总结超时未完成——直接按 Enter 以原模式重试」、hostdown 双帧路径）/ **session-lost 完整走链**（新增 2 检查：默认态总结→追问触发气泡「上轮会话已失效——直接重新发送即可」terminal.ts:31→重发自愈走全新总结完成，末帧文案计数 2 实证）。截图 10 张。

### 轨 C 要点（8/8，一次跑通）

pong hostVersion 0.1.4 / agents：claude `2.1.296 (Claude Code)` + codex 双可用 / workflows 恰五档 / 首轮真 CLI 21.9s：两分片对账 chars=5412 精确、阶段流转 spawned→thinking、task-meta GLM-5.2+sessionId、45 chunk、终局 isError:false usage 18632+1002 unrecognized:0 / 追问轮 resume 续接 usage 2388（首轮 12.8%）追加同一历史文件 / 落盘实测九字段 frontmatter 全（title/url/agent/status:done/ts/usage/duration_ms/session_id/content_chars），正文含 pd:user/pd:assistant 分隔的双轮对话。

## 新发现与勘误

### 1. r83 勘误①：history-read「通过」系超claim（本报告修正）

r83 报告写「history-list/read：列表 + 全文读取通过」——复查 r83 原始 result JSON，`historyRead` 字段 **ABSENT**：驱动脚本（host-drive.mjs/resume-test.mjs）应答帧谓词写错，等 `t:'history-read'` 而协议回帧实为 `t:'history-file'`（protocol.ts:51 请求 / :301 回帧；host stdio.ts:135 发送），5s 超时被 `catch(()=>null)` 静默吞掉。r83 当时验证的是「直接读落盘文件内容」，协议帧路径从未验过。**r84 本轮已补真验证**：独立探针双文件均收到完整 `history-file` 回帧（12s 窗口，内容与落盘一致）——该协议路径首次真过。产品两侧（host 发送/扩展消费）协议一致，无产品缺陷；属驱动脚本 bug + r83 措辞超出证据（违反「回执措辞必须可从证据逐字导出」纪律，在此入账纠偏）。

### 2. r83 勘误②：「swcycle-lost 气泡时序 2s」系误诊

轨 B agent 溯源 chrome-mock.ts:151：session-lost **仅在 followUp 追问时触发**（panel-ready 不带会话还原），与截图时序无关。r83 该场景实际未走到触发路径。r84 完整走链后气泡+自愈全过，覆盖反超 r83。

### 3. 环境观察（非缺陷）

- 真 CLI 已升 claude 2.1.296（r83 时期 2.1.x 旧版）；轨 B 设置页显示的 2.1.170 为 mock 固定值。
- 首轮总结正文以「渣渣，」开头——真机 claude CLI 读到用户全局 ~/.claude/CLAUDE.md 前缀指令的环境效应。
- 轨 A 视觉目检曾报 onboarding 两处 ID「疑似不一致」，源码仲裁（Onboarding.tsx 三处命令同变量模板拼接）判定为小字体长串 ID 的 OCR 转录误差，DOM includes 断言佐证一致。

## 终审 anomalies 处置（7 条全闭合，零降级）

脚本迭代 3 条（A 轮1 断言误读 resp.version→实为 hostVersion、轮2 profile NM 注册跨轮残留加 rmSync；B 图标按钮仅 aria-label 锚点加选择器）+ r83 误诊修正 1 条（上述②）+ 轨 C 帧谓词弱点 1 条（上述①，已补真验证）+ notes 转录笔误 1 条（thinking 计数 542 实为 513）+ 环境效应 2 条（上述 3）。弱证据点名 2 处（relaunch-sw-alive、onboarding-embeds-ext-id 的 detail:null）均由同段强断言/源码仲裁闭合。

## 结论

**dist v0.1.4 经 workflow 三轨复验 + 终审对账：对 r83 基线零回归，四层（浏览器加载/NM 传输/host↔真 CLI/UI 全流程）全部通过**；过程中修正 r83 报告两处不准确（history-read 超claim、lost 时序误诊），并将 e2e 驱动固化为可复用脚本（含已知帧名修正点）。提审闸门不变：**P3 新机空跑主线实测**（用户真机，`store/p3-fresh-run-guide.md`）仍是最后一关。

## 证据索引

- workflow 运行：run `wf_b54e2cc1-fe4`（journal：`…/subagents/workflows/wf_b54e2cc1-fe4/journal.jsonl`，4 agents 全 done）
- 三轨结果：`/tmp/pd-e2e-wf/track{A,B,C}-result.json`
- 截图 13 张：`/tmp/pd-e2e-wf/shots-a/`（3）+ `shots-b/`（10）
- 驱动脚本（as-run 存档）：`/tmp/pd-e2e-wf/track{A,B,C}.mjs`（A/B 含 agents 迭代修订；C 的 history-read 谓词已知错误见勘误①，复用时改等 `t:'history-file'`）
- history-read 补验探针帧转储：本会话 Bash 记录（双文件 history-file 回帧）
- 历史落盘样本：`~/.ai-page-dive/history/2026/10/17/231917-ai-pagedive-readme-e2e-直驱.md`
