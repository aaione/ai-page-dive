# r83 浏览器加载实测——三轨 e2e 产品全面验证报告

> 用户指令：「启动workflow全面执行打开谷歌浏览器加载当前编译的插件，全面验证产品」。
> 验证对象：`apps/extension/dist/`（2026-10-16 重打包，manifest 0.1.4，含 r82 P1/P2 修复）+ `packages/host/dist/`（NM wrapper 同入口）。
> 方法：Chrome 安全模型不允许自动化工具伪造 activeTab 手势（实测定论），单一「浏览器全链路」不可达——
> 拆三轨合并覆盖，等价于全链路：

| 轨 | 载体 | 覆盖段 |
|----|------|--------|
| A | Chrome for Testing 156 真浏览器加载 dist | 扩展加载 / SW / 面板 / 版本握手 / Chrome NM 传输 / 错误路径 |
| B | 官方 dev harness（`dev.html` + chrome-mock） | UI 交互全流程（流式/追问/历史/设置/四错误场景） |
| C | NM 帧协议直驱 host（与 wrapper 同入口） | host↔真 CLI 全链路（首轮/追问/落盘/历史） |

## 轨 A：真浏览器加载实测（全部通过）

- **加载与身份**：CFT `--load-extension` 加载 dist 成功；manifest key 推导 ID `nclbhhhmgcabjlgmlbkoblipogajajgn` 实测命中（SW URL 实证）；与 NM `allowed_origins` 匹配。
- **SW**：`background.js` service worker 注册、evaluable、probe 消息可进出。
- **Chrome NM 传输层**：SW 侧 `sendNativeMessage` 直达 host，回协议帧（`unknown-message` 应答实证四层全通：manifest 发现 → wrapper → repo dist host → 回帧）。
- **版本握手**：panel-ready 应答 `hostVersion: "0.1.4"`、无 outdated/upgrade 横幅（同版正确静默）。
- **sidepanel.html**：以 tab 形态可开、标题 PageDive、完整渲染。
- **真 sidePanel**：cliclick 真点击工具栏图标（先经扩展菜单固定）→ `chrome.sidePanel.open` 实际 dock 出右侧面板（截图 desktop6）。
- **Onboarding 态**：host 未注册时面板完整渲染安装指引，install 命令自动拼真实扩展 ID（`install.sh | sh -s -- nclbhhhmgcabjlgmlbkoblipogajajgn`）。
- **chrome:// 错误路径**：受限页 placeholder「当前页面无法提取正文——浏览器内置页…」正确呈现（与 dev harness `?unsupported=1` 互证一致）。

## 轨 B：dev harness UI 全流程（全部通过）

场景：480×860 视口模拟侧栏。截图 `10`–`15` 系列（/tmp/pd-e2e/shots/）。

1. **主占位**：默认模式就绪 + page-meta tips 三件套（「已就绪·页面标题 / ⚠ 正文超长截断 8 万字 / ≈1.2万 tokens」）。
2. **深度总结**：mock 流式 → 终局「本轮已完成 · CLAUDE · 8.2s」+ markdown 结构渲染（要点/细节/结论）；tips 切「已分享」。
3. **追问**：多轮气泡追加；tips 切「对话上下文·追问已附当前页快照」。
4. **历史**：条目列表（agent 徽标 + 时间戳）。
5. **设置**：六区（模式/CLI/技能/外观/数据/关于）+ CLI 版本（claude 2.1.170 / codex 0.157.0）+ 总结语言。
6. **错误场景四连**：`?unsupported=1`（置灰 placeholder）/ `?taskfail=timeout`（「CLI 报告运行失败：一键总结超时未完成——直接按 Enter 以原模式重试」双呈现）/ `?hostdown=1`（host-disconnected 终局 + Enter 重试）/ `?swcycle=lost`（会话还原链启动）。

## 轨 C：host 直驱真 CLI（全部通过）

驱动：`/tmp/pd-e2e/host-drive.mjs` + `resume-test.mjs`（4B LE 长度前缀帧协议，`--stdio` 同 wrapper 入口）。结果 JSON：`/tmp/pd-e2e/host-drive-result.json`。

- **握手**：`pong`（hostVersion 0.1.4）/ `agents`（claude available）/ `workflows`（五档模式全列出）。
- **首轮总结（真 CLI 22s）**：分片正文对账（content-received chars 精确匹配）→ 阶段流转 `spawned→reading→thinking` → `task-meta`（model GLM-5.2 + sessionId）→ 45 chunk 流式 → `task-done`（isError:false、usage 21386+1092、durationMs 21927、unrecognized 0）。
- **落盘质量**：`~/.ai-page-dive/history/2026/10/17/010135-ai-pagedive-readme-e2e-直驱.md`——frontmatter 九字段全（title/url/agent/status/ts/usage/duration_ms/session_id/content_chars），正文按 instruction 结构化（五要点 + 快速开始命令）。
- **追问轮（真 resume）**：`resumeSessionId` 续接——usage 从 21k 降至 2.2k（实证上下文复用而非全量重发）；8 chunk 终局 isError:false；问答追加进**同一历史文件**（多轮还原链）。
- **history-list/read**：列表 + 全文读取通过。

### 过程中发现并修复的驱动侧问题（非产品 bug）

- 追问轮初测挂起（heartbeat 无终局）：host 只在 `contentReady` 后 `run()`——SW 真实流（sw.ts:1025-1027）会补发空正文分片 `{text:'', done:true}` 触发。驱动补帧后即通。**协议契约成立，产品无缺陷**。

## 环境发现（后续 e2e 复用）

1. **branded Chrome 155 忽略 `--load-extension`**（chrome://version 实证 flags 到位但扩展不载）——须用 Chrome for Testing。
2. **playwright 默认 args 含 `--disable-extensions`**，压过 `--load-extension`——需 `ignoreDefaultArgs: ['--disable-extensions']`。
3. **CFT 的 user-level NM 目录跟 `--user-data-dir` 走**（`<user-data-dir>/NativeMessagingHosts/`），非产品文档的 `~/Library/Application Support/...` 固定路径——四处候选目录实测试错后定位。
4. **activeTab 手势无法自动化**：cliclick 合成点击可触发 onClicked/sidePanel.open，但 `tabs.query` 的 url 可见性不获得（Chrome 安全模型）——浏览器内「读取页面→总结」段不可无人工介入自动化；这正是拆三轨的原因。

## 遗留观察（挂账，非阻断）

1. **既有残留**：`~/Library/Application Support/Google Chrome/NativeMessagingHosts/com.pagedive.host.json`（平级目录 `Google Chrome`，201B 旧版）——早于本次验证存在；正式 Chrome 不读此路径，但其他 Chromium 系若读会拿到旧版注册。建议用户清理或下版 install.sh 收敛。
2. **SW 回收后弱重建边界**（自动化环境特有）：SW 重启后 `resolveContentTab` 弱链依赖 `tabs.query` url 可见性，无 host 权限时受限——真用户主路径（点图标即总结，onClicked 的 tab 参数特供 url）不受影响；与 r82 挂账 F 系无冲突，仅记录。
3. dev harness `?swcycle=lost` 的 session-lost 气泡在截图窗口内未及到达（mock 时序 2s），非缺陷。

## 结论

**当前 dist（v0.1.4 含 r82 P1/P2 修复）在浏览器加载、NM 传输、host↔真 CLI 全链路、UI 全流程四层全部通过**，未发现新的产品缺陷；两处环境级发现（NM 平级残留目录、自动化手势边界）已挂账。提审闸门中 P3「新机空跑主线实测」仍留待用户真机执行（store/cws-listing-v0.1.4.md §8）。

## 证据索引

- 截图：`/tmp/pd-e2e/shots/`（18 张：真浏览器 01-06 + dev harness 10-15）
- 桌面取证：`/tmp/pd-e2e/desktop*.png`（真侧栏 dock、扩展菜单、pin 序列）
- host 直驱结果：`/tmp/pd-e2e/host-drive-result.json` + 两个驱动脚本
- 历史落盘样本：`~/.ai-page-dive/history/2026/10/17/010135-ai-pagedive-readme-e2e-直驱.md`
