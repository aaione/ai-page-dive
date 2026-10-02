# 产品多维严苛 Review — r54（2026-09-30，r53 同日续轮）

## 方法与规模

不重复 r53 的 8 维扫荡，三路增量：**r53 盲区三角度深掘（含 live-fire 实弹）+ 四热区新猎（bilingual 防 r53 重复）+ 逐发现单怀疑者对抗驳斥**。

Workflow 25 agents / 约 1.01M tokens / 13.5 分钟；原始发现 18 → **确认 11（P2×2、P3×9）/ 驳回 7**。盲区裁决三份。热区之一（安装面 h4）agent 未按 schema 返回、结果损失，已单独补跑（结果见文末补记）。11 条确认全部由主会话逐条对照源码亲核（严苛标准），无一仅凭 agent 陈述收录。

## 盲区裁决（本轮核心产出——两条推翻 r53 自身断言）

### ① 注入围栏：verdict = mitigated（confidence: high，live-fire 实证）

codex 0.156.1 实弹三发 + control + claude 一发，全部按适配器真实 spawn 路径原样复刻 flags：

| 路径 | 实弹结果 |
|---|---|
| codex fresh（`--sandbox read-only`） | touch 被拦（Operation not permitted），marker 未出现——**围栏生效** |
| codex resume（`-c sandbox_mode="read-only"`，r53 头号悬案） | 同拦；control 仅换 `danger-full-access` 同 touch 即放行——**`-c` 是活配置通道，等价性闭环** |
| claude（`-p --permission-mode default`） | Bash×2（含 realpath 形态）+ Write×1 全拒，permission_denials 留痕——**围栏生效** |

**但发现本轮唯一真实绕过面**：codex 路径未封用户 MCP server（→ 确认项 #8，P2）。live-fire stderr 实证 codex spawn 真在连用户 config.toml 声明的 MCP server（rmcp worker 连 127.0.0.1:3845）。技能体/附件入口结构面核对封闭（正文全量只经临时文件，prompt 仅含路径）。

### ② 升级漂移：verdict = real-risk，但 r53 断言被推翻一半

**r53 称「协议无版本握手」是漏察**——握手实际存在且工作：sw.ts:15 `MIN_HOST_VERSION` + probe 后 versionLt 判 outdated 弹横幅（含升级命令）、nmport 透出 hostVersion、host version.ts 读失败兜底 0.0.0 强制提示。npm 实查唯一已发布版 0.1.2 已含全部 ext→host 依赖消息，**现存版本对无失配**。

剩余真缺口：stdio.ts switch 17 case 无 default（未知消息静默吞，→ #10 P3）+「新增依赖型消息须抬 MIN_HOST_VERSION」无构建期强制（流程债）。r53 报告已随本轮修正。

### ③ token 经济：verdict = mitigated，r53 断言被推翻

**r53 称「extract.ts 无任何截断上限锚点」是漏察**——`MAX_CONTENT = 200_000`（extract.ts:13）在全部提取路径生效，截断 notice 与 approxTokens 均已透出。量化：200k 字符 ≈50k tokens，claude 200k 上下文余 3.7 倍；最坏组合（200k 页 + humanize 全文改写 ≈100k + 5×512KB 附件）≈110k 仍不超限，**无失败模式**。剩余缺口仅为观测债（→ #11 P3）。r53 报告已随本轮修正。

---

## 确认缺陷清单

### P2（2）

#### #1 失败任务打 ✓ 角标：task-done 不核 isError，CLI 运行内失败在收起窗口被标成成功
- **点位**：`apps/extension/src/background/sw.ts:605`
- **证据**：`if (msg?.t === 'task-done') chrome.action.setBadgeText({ text: '✓' })` 无条件打 ✓，全文件零处消费 isError。硬约束 #4：claude 运行内失败（is_error 在 stdout、退出码可 0）走 onDone{isError:true} 而非 onError——host task.ts:357-379 → stdio.ts 以 `task-done{isError:true}` 发出 → App.tsx:492-506 渲染为错误气泡。**角标与面板 UI 对同一帧给出相反判定**。
- **场景**：收起面板（r16 注释自证此时角标是唯一信号）→ CLI 运行内失败 → 用户看到 ✓ 回来，等着的却是错误气泡。失败场景恰是最需要回看原因的场景。
- **修法**：:605 改 `msg.isError ? '!' : '✓'`；task-error 帧补打 '!'（当前收起窗口 task-error 无任何角标）；sw.test 补三分支锚。
- **亲核**：✓ 源码直读。

#### #2（workflow 序号 #8）codex 路径未封用户 MCP server——read-only 沙箱不约束 MCP 调用，注入面旁路
- **点位**：`packages/host/src/agents/codex.ts:78-83`
- **证据**：claude.ts:124 有 `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` 封死同面（注释归因 r47-perf，实际同时是安全面）；codex.ts 全文 **0 处 mcp 字样**（grep 实证）。codex read-only 沙箱（macOS Seatbelt）只约束 codex 为 shell spawn 的子进程；MCP server 由 codex 进程自身作为客户端调用、不经沙箱。live-fire stderr 实证：spawn 真在连用户 config.toml 的 MCP server（chrome-devtools @ 127.0.0.1:3845）。
- **场景**：用户 codex config.toml 配过任一有写/网络能力的 MCP server → 恶意网页正文注入「调用 MCP 工具 X 执行 Y」→ codex 在 read-only 沙箱内经 MCP 绕过围栏。
- **修法**：codex.ts buildArgs 两路径各追加 `'-c', 'mcp_servers={}'`（`-c` 是活配置通道已被 control 实证；与 claude 形成双适配器对称；TOML 空表写法真机验一次）。
- **亲核**：✓ claude.ts:124 与 codex.ts grep 0 命中双证。

### P3（9）

#### #3（workflow #1）task-done 是六个任务帧 handler 中唯一缺 foreignAdopt 守卫者
- `App.tsx:467-487`（对照 389/415/437/450/527 五处均有——grep 实证）。双窗口下空闲面板（s.taskId===null）捡他 tab 终局帧的 sessionId → `resumable: s.resumable || !!m.sessionId`（:484）无条件生效——codex 面板（无 sessionId）错误开放追问入口，追问落到别人的 claude 会话。与 r53 #5（pending 击穿）同点不同枝：修法一揽子——task-done 补 foreignAdopt + pending 守卫。✓ 亲核（grep 五处 + 478-488 直读）。

#### #4（workflow #2）resumeHistory 不清在途 restorePathRef——迟到 history-file 帧顶掉刚装载的历史会话
- `App.tsx:275-286`（置 ref）+ `353-382`（history-file 分支按 ref 收帧）+ `748-777`（resumeHistory 零触碰 ref——grep 实证仅 146/275/282/283/354-357 六处）。用户发起还原 A 后立刻手点恢复历史 B → B 装载完成 → A 的迟到回帧仍匹配 ref → 整体 BLANK 顶掉 B 的会话，12s 兜底另路径再覆盖。修法：resumeHistory 入口清 ref 一行。✓ 亲核。

#### #5（workflow #4）面板收起期间 task-error 终局零痕迹
- `sw.ts:605-608`：task-error 无角标、清 currentTask 后无归档。纯 task-error 路径（spawn-fail：CLI 被升级打断/路径失效；SW 侧 content-mismatch）三通道（角标/会话/落盘）全空，重开面板如任务从未存在。注意核验修正：timeout 与 parse-fail **有**历史落盘（task.ts:295-297 persist('interrupted')、:460 persist('error')），零痕迹的只有 spawn-fail 与 content-mismatch。修法：task-error 打 '!' + panel-ready 带 lastTerminal（一次性消费）。✓ 亲核（605-608 直读）。

#### #6（workflow #5）首轮附件标记未经 escapePd 落盘——附件名可注入伪造轮边界
- `task.ts:520`：`(attachFiles.length ? `<!-- pd:user -->\n${attachMarkers(attachFiles)}\n` : '') + escapePd(this.accText)`——escapePd 只套 accText；attachMarkers（prompt.ts:132-135）裸用 `a.name`，而同文件 attachSection:128 走 sanitizeMeta（消毒口径分裂）。追问轮 task.ts:497→history.ts:132 整体转义，两路不对称。APFS 文件名可含 `<!-- pd:assistant -->` 字样 → 恢复会话轮次结构被附件名伪造。修法：:520 对 attachMarkers 输出同过 escapePd（与追问轮口径对齐）+ 单测锚。✓ 亲核（两文件直读）。

#### #7（workflow #6）appendHistoryTurn 以 flag:'a' 追加已删除文件会静默重建无 frontmatter 孤儿
- `history.ts:127-136`：assertInRoot 后 `writeFile(path, ..., { flag: 'a' })`——'a' 模式文件不存在即创建，内容只有裸轮段。删除历史 + 同会话追问（SW session 域仍持 historyPath，sw.ts 删除分支不清 sessions map）→ 重建的僵尸文件永不进列表（readFrontmatter 双 undefined）却占 pruneHistory 名额。修法：append 前校验目标仍是有效历史文件（stat + frontmatter 头），不存在则跳过并 logFail 同谱留痕。✓ 亲核。

#### #8（workflow #7）saveWorkflow 撞名守卫 TOCTOU——声称防御的并发场景恰能穿透
- `workflows.ts:122-135`：readFile 检查 → mkdir → writeFile 直接 truncate 覆写，检查与写非原子。双 Chrome profile 各自 spawn host 进程共享 USER_DIR 无跨进程锁——正是守卫注释（:119-121）自己点名的并发 actor。后写者静默覆写先写者原创正文，双方都收 workflow-saved 成功。且 writeFile 无 tmp+rename，写中途被收割留截断文件。修法：`open(path,'wx')` 独占占位（EEXIST 即撞名报错）+ tmp/rename 原子提交。✓ 亲核。

#### #9（workflow #9）codex resume 围栏有效但依赖字面量，版本漂移零信号——且比自述更糟
- 围栏本体 live-fire 已证有效（盲区①）；剩余风险是 codex 大版本改 `sandbox_mode` 语义/名称时围栏静默退化。怀疑者核查发现比发现自述更糟：其宣称的「unrecognized 链路理论可见」不成立——`ignoring N unrecognized configuration settings` 帧走 item.completed(item.type='error') 命中已知分支（codex.ts:37-40）被完全吞掉，不进 default、永不产生 unrecognized 事件，**漂移将零信号**。修法：parser 对 item.error 帧透传 unrecognized 事件进 r51 计数链 + 注释留档 live-fire 实证。✓ 亲核（codex.ts:37-41/78-83 直读）。

#### #10（workflow #12，原报 P1 驳至 P3）host 对未知 ExtToHost type 静默吞
- `stdio.ts` switch 17 个 case、**0 处 default**（grep 实证）。P1 判定被驳：唯一已发布 host 0.1.2 已含全部 ext→host 消息 + MIN_HOST_VERSION 握手既有——现存版本对不可达。保留 P3 加固：补 default 回 `error{code:'unknown-message', ref}` + console.error，作为门禁漏抬时的最后防线（「按钮没反应」变「可理解的升级提示」）。✓ 亲核。

#### #11（workflow #15）仓库零真实 contentMarkdown 样本——200k 上限无数据支撑
- `scripts/fixtures/` 仅 3 文件（claude 流 13.7K / codex 流 964B / 玩具 article.html 1.6K），真实提取样本 0 个；extract 已算出的 originalChars/truncated 只转 notice 即丢。将来调 MAX_CONTENT 无数据可依（r0 报告留有「评估上调 400-500k」待办）。修法（怀疑者修正版）：把 originalChars/truncated 随 task-meta 落进 history frontmatter 自然积累分布——record-fixtures 只采 CLI 流不触提取管线，瞄它没用。✓ 亲核（ls 实证）。

---

## 被驳回项（7，均有硬理由）

1. **MIN_HOST_VERSION 恒 0.1.0 从未抬**——场景第一步断链：npm 实查唯一发布版 0.1.2 已含全部 ext→host 依赖消息（0.1.0/0.1.1 从未发包，0.1.0「发布即坏」是提交记录明载的阻塞项），现存安装面无失配；与 r53 #1（横幅未钉版本）同常量重复。流程加固建议（protocol.ts 注释版本表 + 构建期断言）值得做但非 bug。
2. **install.sh 钉版本无降级防护**——三环全断：面板复制的命令不含版本号永远拉 main；CI check-version 门禁强制钉版随发版 bump；真降级了也有版本握手横幅兜底可自愈。
3. **MAX_CHUNK「单源」叙事失实**——前提与 git 史实不符：8f448a7 当时确实收敛 shared 值导入，双拷贝是 ffed99b 为修「npm 装后 ERR_MODULE_NOT_FOUND」的有意回退且 message 如实记载；vitest 双锚测试（同值断言 + host 无值导入守卫）实际且充分拦截漂移。无失实载体（AGENTS.md 无「单源」声明）。
4. **allowed_origins 只增不减**——注释明示的 union 设计（dev ID 与 CWS ID 共存）；uninstall 整删 manifest 即完整重置；错 ID 被 32 位校验 + forbidden nmError 双防线兜底；自动清理反而有害（会误删多 ext-id 手动登记）。
5. **extract 已有 200k 上限（任务前提过时）**——对 r53 盲区③断言的正面驳斥，已采纳为盲区裁决。
6. **humanize 档消耗 ≈2 倍无提示**——两道既有防线：档位下拉 hint 白纸黑字「全文改写（非摘要）」+ PageTips 常驻「≈X万 tokens（计入你的 CLI 订阅）」。文案增强可选，非缺陷。
7. **prompt「读全文」+ 追问多轮放大无提示**——多轮叠加算术是对 CLI 内部行为的推测（prompt caching 下不成立）；读全文是 v1 头号承诺的有意设计；发现自陈「v1 接受」。

## 与 r53 的合并视图

r53（唯一 18）+ r54（13，含补跑 2）= **31 条未修确认项**（P2×8：r53 六 + r54 两；P3×23）。修法聚类：
- **sw.ts 终局信号族**（r53 #5 + r54 #1/#3/#5）：foreignAdopt 补全 + isError 角标 + task-error 痕迹，建议一次修完 + sw.test 扩锚
- **codex 安全族**（r54 #2/#9）：mcp_servers 封死 + item.error 透传，一次修完
- **历史落盘族**（r53 #7/#8/#11 + r54 #6/#7）：附件转义对称 + append 校验 + 附件连带删，同文件连修
- **安装/发布面漂移族**（r53 #1/#2/#18 + r54 #12/#13）：文案与承诺对照实际，全是几行级
- **一行级杂项**：r53 #3/#4、r54 #4/#10
- **测试债**：r53 #13/#14/#15/#16/#17、r54 #11（观测债）

## 建议行动顺序（更新版）

1. **P2 八项**（r54 #2 codex MCP 封死是唯一安全面项，一行级最优先；sw 终局信号族一次修完）
2. **P3 一行级先摘**（r53 #4 两行换序、#18 清单 + 断言；r54 #4 清 ref、#6 转义对称、#7 append 校验）
3. **流程加固二件**（stdio default 回帧 + protocol 版本表断言——防未来漂移的根修）
4. **测试债中期**（r53 #13 UI 状态机矩阵网为最大一块）

## 附录：亲核记录

11/11 确认项全部亲核：sw.ts 605-608/15/363-366、claude.ts:124、codex.ts grep 0 命中、App.tsx foreignAdopt grep 五处 + 478-490/275-286/354-357/748-777、task.ts:513-524、prompt.ts:125-140、history.ts:120-140、workflows.ts:115-135、stdio.ts grep 0 default、extract.ts:13/107/110/118、fixtures ls。盲区三裁决的修正已回写 r53 报告（盲区②③断言标注 r53 漏察 + 修正后事实）。

## 补记：安装面 h4 补跑（2 条 P3，均已亲核并入）

热区 hunter h4 因未按 schema 返回损失，单独补跑 agent 得 2 条，主会话亲核后全部确认。合计 r54 确认 **13（P2×2、P3×11）**。

#### #12 host CLI 帮助文案 bin 名错位：提示用户跑不存在的 `pagedive` 命令
- **点位**：`packages/host/src/index.ts:33`
- **证据**：default 分支输出 `pagedive host <ver>\n  ai-page-dive install …\n  ai-page-dive uninstall\n  pagedive probe\n  pagedive --stdio`——同一屏帮助里 install/uninstall 用实名 `ai-page-dive`、probe/--stdio 用 `pagedive`，而 bin 只注册 `ai-page-dive`（packages/host/package.json:10-12 实证），npm 全局不存在 `pagedive` 命令。
- **场景**：新用户装完跑 `ai-page-dive` 验证 → 照帮助抄 `pagedive probe` → `command not found` → 误判安装损坏（正是最需要信任的时刻）。
- **修法**：文案统一 bin 实名（含 `pagedive host` 前缀），一行修。
- **亲核**：✓ index.ts:33 与 bin 注册双读。

#### #13 README 卸载 FAQ 对 pnpm 用户承诺落空——preuninstall 清理在 pnpm 全局安装下永不执行
- **点位**：`README.md:89`
- **证据**：README:89 无条件承诺「`npm uninstall -g` —— preuninstall 钩子自动清理（NM manifest + wrapper）」。preuninstall 挂 npm lifecycle（package.json:27）；pnpm 全局默认不跑钩子——产品自己在 host README:17（「pnpm 全局安装默认不执行安装钩子，请手动跑 install」）和 Onboarding.tsx:199（「用 pnpm？全局安装默认不执行安装钩子」）都承认了**安装侧**，唯独卸载侧没同步：uninstall.ts 的清理只经 preuninstall 或手动 `ai-page-dive uninstall` 触发。
- **场景**：pnpm 安装的用户按 README 跑 `npm uninstall -g` → npm 报 not installed → `pnpm rm -g` 移除包 → 钩子从未运行 → NM manifest + wrapper 永久残留，与「最小 footprint」叙事和「自动清理」承诺双漂移。
- **修法**：README:89 补 pnpm 例外一句（卸载前先手动 `ai-page-dive uninstall`），与安装侧口径对齐。
- **亲核**：✓ 四文件原文直读。
