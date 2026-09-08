# 总裁决

**代码最优性**：host 核心链路（NM 帧协议 / 任务编排 / 进程收割 / 终局幂等）设计质量高、硬约束全部落实，但存在 3 个已验证的 high 级缺陷——中文主路径的 history-read 截断字节/字符混淆、超时路径不落盘历史、startSummarize 不取消旧任务，均属"静默数据丢失/资源泄漏"，是 v1 发布阻断项。
**交互**：核心总结流程（提取→发送→流式渲染→历史回看）完整且有过期帧防御，但"静默降质"散布在附件跳过、对账失败误报、超时丢输出三个点，与产品"宁可失败不可半截总结"的哲学自相矛盾，修复成本均极低。
**npm 必要性**：npm 是 v1 零配置安装链路（curl|sh → npm i -g）的唯一支撑，**必须保留**；但 sudo 守卫语义冲突（install.sh 建议 sudo、postinstall 防 sudo、install.ts 不设防）和 curl|sh 无 checksum 两处发布前必须修，brew cask 推 v1.x 且有结构性前置。

---

# 一、代码实现（确认的问题，按严重度排序）

## High

### 1. history-read 截断混淆字节/字符维度，CJK 下帧静默丢失
- **位置**：`packages/host/src/stdio.ts:89-92`（判超限用 `Buffer.byteLength(content)` 字节、截断却用 `content.slice(0, HISTORY_MAX_BYTES)` 字符）；`packages/host/src/nm.ts:12-13`（encodeFrame 超 1MB throw）；`packages/host/src/stdio.ts:159-165`（runNative 的 send 空 catch 吞掉异常）
- **后果**：纯中文历史 3 字节/字符，1MB 内容 ≈ 35 万字符 < 921600，slice 为 no-op，截断完全失效；encodeFrame throw 被吞，扩展端既收不到 history-file 也收不到 error 帧，面板静默无响应。本产品面向中文用户（附件 sanitize 含 CJK 白名单），这是主路径 bug，违反"静默数据不完整比报错更危险"红线。
- **修复**：Buffer 维度统一——`Buffer.from(content,'utf8')` 判长、`buf.subarray(0, HISTORY_MAX_BYTES).toString('utf8')` 截断（注意 replacement char 边界）；runNative 的 send 失败改为上报 error 帧而非吞掉。

### 2. startSummarize 不先取消在跑任务：旧 CLI 进程泄漏 + 双流竞争
- **位置**：`apps/extension/src/background/sw.ts:345-433`（全程无 cancelCurrent，:388 直接覆盖 currentTask）；对照 :197（resume-history）、:208（new-session）均先 `if (currentTask) cancelCurrent()`，且 :194 注释表明作者明知此坑
- **后果**：旧任务取消句柄永久丢失（task-cancel/task-done 清理都严格按 currentTask.taskId 匹配），旧 CLI 进程（pgid 树）空跑到 10 分钟超时，浪费用户订阅额度；host 所有帧经 sw.ts:291 无差别转发 panel，仅靠 UI 层 taskId 过期帧拒绝缓解。追问轮 startFollowUp（:312）同样不取消。附带：taskId 毫秒时间戳无随机后缀（:383、:302），有碰撞面。
- **修复**：startSummarize / startFollowUp 入口先 `await cancelCurrent()`；taskId 加随机后缀。

### 3. timeout 路径不落盘历史 + shutdown 窗口内新任务被 exit(0) 静默带走
- **位置**：`packages/host/src/task.ts:223-230`（超时置 timeoutSent=true 后 cancel）；`task.ts:233-234`（exit handler 首行 `if (doneSent || timeoutSent) return resolve()` 直接返回，永不进 finish()/persist()）；对照 :338-341 cancel/SIGTERM 路径有 `persist('interrupted')`；`packages/host/src/stdio.ts:182-186`（shutdown 无 closing 标志，3.2s 窗口内新 task-start 仍被处理随后被 exit(0) 带走，扩展侧只见断连）
- **后果**：CLI 跑 9 分 50 秒产出的大量 accText 超时瞬间全部蒸发——无历史文件、无 interrupted 标注（唯一保留是 onError('timeout') 在 cancel 前已发出）；shutdown 窗口问题概率低但排障方向被误导。
- **修复**：超时路径复用 cancel 的 `persist('interrupted')` 语义；shutdown 开始即置 shuttingDown 标志，期间收到 task-start 回 `{t:'error', code:'shutting-down'}`。

## Medium

### 4. NM 帧读取器无长度上限校验 + O(n²) 拷贝
- **位置**：`packages/host/src/nm.ts:25-41`——:31 readUInt32LE 后无上限校验（发送端 encodeFrame 有 NM_MAX 检查，接收端缺失），损坏头 0xFFFFFFFF 会使 :28 Buffer.concat 无界累积（内存 DoS 面）；每 data 事件全量 concat，大帧多 chunk O(n²)
- **修复**：读出 len 后校验 `length <= NM_MAX`，超限销毁流报协议错误；累积改 chunk 队列按需拼装。对端虽是自家扩展（可信环境），协议鲁棒性缺一口。

### 5. reap 的 pid 复用误杀防御缺失
- **位置**：`packages/host/src/spawn.ts:87-94`——reap 不检查 `child.exitCode`，SIGTERM 和 3s 后 SIGKILL 都直接 `kill(-child.pid)`；child 已退出后迟到 reap（task.ts:123/219/280）在 pid 被复用且复用者恰为进程组长时可误杀无关进程组
- **核实修正**："setTimeout 未 unref 拖住退出"不成立（所有退出路径经 stdio.ts:184 `process.exit(0)` 强制退出）；3.2s/3s 耦合已有注释锁死（stdio.ts:177-178），仅常量未收敛 shared。真实剩余风险是低概率误杀防御缺失。
- **修复**：reap 前检查 `child.exitCode !== null` 则只等不杀；两处 3s 常量收敛到 shared 单一来源。

### 6. extractBest 取最长 frame 无置信度；task-done 无过期校验
- **位置**：`apps/extension/src/background/sw.ts:334`（`reduce` 纯按 contentMarkdown 长度择优，长导航/页脚/广告 frame 可压过真实正文，notice 只覆盖截断与低置信不覆盖选错）；`apps/extension/src/sidepanel/App.tsx:124-141`（task-done 分支无 taskId 比较，对比 :102 task-chunk、:116 task-status、:148-149 task-error 均有过期拒绝——取消后旧任务迟到 done 帧会把新一轮 streaming 气泡提前定稿）
- **修复**：extractBest 引入正文密度启发（文本/标签比、段落长度）；task-done 补 taskId 匹配，过期 done 仅更新会话元数据不动消息列表。

### 7. prompt 注入面：页面元数据未消毒即拼入 prompt（已接受但未标注）
- **位置**：`apps/extension/src/background/extract.ts:115-116`（title/byline 原样，DOMPurify 只消毒正文 HTML）；`packages/host/src/task.ts:422-433、444-451`（page.title/url/byline 直接模板拼入 prompt 与 workflow 正文）；`packages/host/src/history.ts:123`（分段标记 `<!-- pd:user -->`/`<!-- pd:assistant -->` 固定字面量无 nonce，正文含此字面量即误切多轮还原）
- **修复**：title/byline 加长度上限 + 控制字符清洗；历史分段标记加随机 nonce（存 frontmatter）；在 DECISIONS.md 风险表显式登记此接受项。

> **已证伪不采纳**（供存档）：① "codex/opencode 解析器与四标志构成脆弱隐式契约"——codex 增量 text-delta 是主通道（codex.ts:28-31 → task.ts:267-270），host 从未读回 .last 文件，兜底完备（task.ts:293-297/:343），重复 result 被同步块幂等挡住；② "SW 全内存任务态是结构性 P0 单点"——NM port 生命周期绑定 SW（stdio.ts:170 注释），SW 回收即 host stdin end → reapAll 立即收割，任务期有 20s heartbeat 保活，lastSession 已由 commit 7344cec 持久化到 chrome.storage.session（sw.ts:35-57），所述 P0 后果在现有代码中无法发生。

---

# 二、交互优化空间（按用户旅程排序）

## 旅程 1：安装（Onboarding → curl|sh → brew 兜底）

**1.1 sudo 安装陷阱：官方提示把用户引向最深的坑**（severity: high，详见 §三.2）
用户照 install.sh:36 提示走 `sudo npm i -g`，postinstall root 守卫静默跳过注册（失去自动注册），若再 sudo 执行 install 则以 root 属主落盘 wrapper/manifest，普通用户后续幂等重写触发 EACCES——报错对普通用户不可解读。

**1.2 安装等待体验**（medium）
brew install node 可耗时数分钟，Onboarding.tsx:59 "约 30 秒仅一次"的承诺在 brew 路径失真，面板无"正在等待安装完成"活跃状态（仅 :106 静态文案）；探测退避封顶 15s、每次 probe spawn 冷 node 进程白烧（Onboarding.tsx:14-15 注释自认）；FAQ（:86-99）只覆盖报错场景，缺"脚本只做三件事"的透明化说明与仓库源码链接；curl|sh 无 checksum（见 §三.3）。
**修复**：等待期显示持续状态文案；补脚本行为透明化说明 + 源码链接。

## 旅程 2：发送总结（附件 → 对账）

**2.1 附件超限/读失败静默跳过，用户不知道附件没带上**（high）
`apps/extension/src/sidepanel/SummarizeView.tsx:140-143`——`f.size > 512*1024` 直接 continue，读取失败也 `catch { /* 跳过 */ }`，均无提示；:136 注释写着"提示并跳过"但提示逻辑根本未实现。用户附 5 个文件实际只带上 3 个，总结偏差无从归因。正文传输有 content-received 双向对账，附件却零反馈——与项目对账设计哲学自相矛盾。
**修复**：跳过时在附件区/chip 即时标红"附件 X 超过 512KB 已跳过"。成本极低，一致性收益高。

**2.2 连点两次总结导致旧任务失控**（medium，机制详见 §一.2）
panel 内主路径有护栏（running 时 send 早退 :110、输入框 disabled :520、按钮变停止钮 :527-528），实际触发靠多 tab 各开 side panel 共享单个 SW currentTask、或终局帧时序竞态。修复同 §一.2，另可在任务进行中给发送钮加明确过渡态。

## 旅程 3：等待运行（10 分钟窗口）

**3.1 超时十分钟输出全丢**（high，机制详见 §一.3）
等待体验的最差路径：用户盯了十分钟，最后连部分结果都拿不到。修复后 panel 错误文案应引导"部分结果已存历史"。

**3.2 content-received 对账失败误报 spawn-fail，排障方向指错**（核实后定级 medium：message 文本本身已写明真实原因，但前缀语义矛盾真实存在）
`apps/extension/src/background/sw.ts:263-269` 对账不一致时发 `code:'spawn-fail'`，经 App.tsx:336-341 映射 + :160 拼接，用户实际看到"CLI 启动失败（未安装或不在 PATH）: 正文传输不完整（NM 丢片），已重试"——前后矛盾。协议六种错误码（shared/protocol.ts:240）确无 content-mismatch 类码。
**修复**：新增 'content-mismatch' 错误码，panel 映射"正文传输不完整，请重试"。

## 旅程 4：结果与历史（回看/搜索/恢复）

**4.1 历史搜索无防抖，每次击键全量磁盘扫描**（medium）
`apps/extension/src/sidepanel/HistoryView.tsx:89-92` 每 keystroke 直接走 SW→NM→host 全链路；host `listHistory`（history.ts:130-161）递归扫年/月/日三层目录，:163-164 每文件全量 readFile 只为解析头部 frontmatter，无缓存/索引/mtime 短路，且异步无排队会并发扫描。历史功能随使用时间线性劣化，是最晚爆发但最伤留存的问题。
**修复**：panel 侧 300ms 防抖；host 侧只读文件头 N 字节 + 目录 mtime 缓存。

**4.2 中文历史文件 >1MB 时面板静默无响应**（high，即 §一.1 的用户侧表现）——修复 §一.1 后自动消解。

---

# 三、npm 包是否必须

| 分发方案 | v1 可用性 | 零配置程度 | 安全面 | 维护成本 | 判决 |
|---|---|---|---|---|---|
| **curl\|sh → npm i -g**（现行） | ✅ 已落地 | 最优（一条命令，brew 兜底装 node） | 无 checksum/pin（§3.3 需补） | 低（npm registry 自带完整性） | **v1 唯一主渠道** |
| 手动 npm 两连命令 | ✅ 已保留 | 差（两条命令+记 ext-id） | 同上 | 零 | 折叠区手动备选，维持现状 |
| brew cask | ❌ 未做（评估 1-2 周） | 好 | 好 | 中 | **v1.x 再做**，上 cask 前必须修 §3.1 |
| 官网 zip/DMG 直装 | ❌ 未做 | 差（手动下载+配 manifest） | 好（可签名） | 高（双平台打包链） | 不做 |

**明确推荐：npm 包必须保留。** install.sh 的"一条命令"零配置承诺完全建立在 `npm i -g ai-page-dive` 之上，v1 用户全有 npm（产品 review 判定），brew cask 无增量收益。但发布前有三件必做的事：

**3.1 brew cask 前置：多渠道 path 互踩隐患**（medium，v1.x 前置项）
`packages/host/src/install.ts:9` HOST_NAME 固定 + wrapper 恒为 `~/.ai-page-dive/host-wrapper.sh`（:18），双渠道安装时互相改写的是 wrapper 内容中的 hostEntry（:22）——install.ts:74-76 的"重定向提示"因 `prev.path === wrapperPath` 恒真而**永不触发，互踩完全静默**；卸载其一后 wrapper 指向已删路径，env node 兜底救不了已删的 hostEntry。origins union 只增不减（:69-71）进一步固化混乱。上 cask 前须加 distribution source 标记 + `--reset` 子命令（index.ts:5-26 现仅 --stdio/install/probe 三命令）。

**3.2 真实 bug：sudo 建议与 root 守卫语义冲突，install.ts 无守卫**（high，发布阻断）
证据链：install.sh:36 EACCES 分支建议 `sudo npm i -g` → postinstall.ts:78-85 root 守卫（注释自述"root 写 manifest/wrapper 会导致幂等重写 EACCES 死锁"）getuid()===0 时**静默跳过**注册 → 但 install.ts 全文 grep getuid/sudo/root 零匹配，install.sh:44 第 3 步又直接跑 `ai-page-dive install`——同一写路径一防一不防，维护漂移。修复：install.sh 删 sudo 建议或加警示；install.ts 复用 postinstall 同款 root 守卫（提取共享模块防再漂移）；补 getuid=0 时 install no-op 的测试。

**3.3 curl|sh 无 checksum/版本 pin，与自述理由矛盾**（medium，发布前，约半人日）
install.sh:4-5 注释称"脚本不下载任何二进制，无需 checksum"——理由不成立：脚本 :34 `npm i -g` 与 :44 `install` 本身就是任意命令入口，仓库被入侵或 raw 传输被劫持即可注入载荷；且产品 review 自留 2026-04 macOS malvertising 投毒 curl -L|sh 实战先例，明确要求"必须带 checksum 校验"，实现未满足。Onboarding.tsx:6 复制命令也指向 main 浮动头。修复：`sh -s -- <ID> <sha256>` 双参数 self-check，或 pin git tag commit SHA，由发布流程注入当日 hash。

---

# 四、Top 5 行动项

| # | 行动项 | 位置 | 严重度 | 工作量 |
|---|---|---|---|---|
| 1 | **history-read 截断改 Buffer 维度 + send 失败上报 error 帧**（中文主路径静默无响应，发布阻断） | `packages/host/src/stdio.ts:89-92,159-165`、`nm.ts` | high | 0.5 天 |
| 2 | **sudo 链路三处对齐**：install.sh 删 sudo 建议、install.ts 加 root 守卫（与 postinstall 提取共享模块）、补 getuid=0 测试 | `install.sh:36`、`packages/host/src/install.ts:98`、`scripts/postinstall.ts:78-85` | high | 0.5 天 |
| 3 | **超时路径 persist('interrupted') 落盘部分输出** + shutdown 置 shuttingDown 标志拒新任务 | `packages/host/src/task.ts:223-234`、`stdio.ts:182-186` | high | 0.5 天 |
| 4 | **startSummarize/startFollowUp 入口先 cancelCurrent()** + task-done 补 taskId 过期校验 + taskId 加随机后缀 | `apps/extension/src/background/sw.ts:345-433`、`sidepanel/App.tsx:124-141` | high | 0.5 天 |
| 5 | **消灭两处静默降质**：附件跳过即时标红提示；新增 'content-mismatch' 错误码替换对账失败的 spawn-fail 误报 | `SummarizeView.tsx:140-143`、`sw.ts:263-269`、`shared/protocol.ts:240` | high/medium | 0.5 天 |

**紧跟其后的第二梯队**：curl|sh 加 checksum/pin（发布前，§3.3）、历史搜索 300ms 防抖 + host 只读头 N 字节（§4.1）、NM 帧长度上限校验（§一.4）。