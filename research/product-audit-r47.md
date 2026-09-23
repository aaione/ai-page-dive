# PageDive 全面审计报告（r47）

日期：2026-09-24 ｜ 基线：main@8432615 ｜ 审计人：Claude（两轮多 agent workflow）

## 审计方法与规模

| 轮次 | 结构 | agents | tokens | 产出 |
|---|---|---|---|---|
| 第一轮：双轨审计 | 产品 5 维 + 代码 6 维并行 → 主编去重定级 → 高危对抗验证 | 14 | 934k | 82 优点 + 49 发现（2 坐实） |
| 第二轮：多维自校验 | 23 条 medium 全量复验 + 3 盲区补审（a11y 重跑/manifest 对账/承诺对账）+ 核心优点抽验 6 条 + low 抽验 5 条 | 29 | 1.2M | 23/23 坐实（11 降级 low）+ 盲区 13 新发现 + 抽验 11/11 属实 |

纪律：每条发现必须给 `文件:行号` 证据；verifier 默认反驳姿态（拿不准即否）；v2+ 范围（daemon/Windows/marketplace）不当缺陷；违背 DECISIONS.md 的「建议」无效。第一轮 a11y 维度 agent 失败丢失，第二轮补位重跑。

## 总体判定

**这是一份高质量实现。** 95 条核实优点（抽验 6/6 机制级优点全部属实，high confidence），核心机制——NM 协议对账、进程树收割、看门狗防冤杀、流式渲染分层、错误路径枚举——均属可溯源的高水准工程（每处竞态有 r 编号注释）。无 critical 缺陷：零数据丢失、零硬约束违背、权限面与 DECISIONS 逐项对账干净。

**优化空间集中在四处**：① a11y 有一处 high（reduced-motion 写了但级联顺序错了、实际失效）；② 对外承诺面过期（README/PRIVACY 与 r40/r46 的代码事实脱节）——对以隐私为核心卖点的产品，政策与 manifest 矛盾是硬伤；③ 核心循环有三处用户可感的语义断裂（CTA 回填漂移 / send 静默 / 模式双名）；④ 工程债（ext 侧零测试、无错误边界、sw.ts 过载、CSS token 漂移）。

## High（3 条，两轮验证坐实）

### H1. prefers-reduced-motion 降级几乎完全失效
`index.css:322-331` 的 `@media (prefers-reduced-motion: reduce)` 块位于**全部动画声明之前**——CSS 级联中 @media 不增加优先级，同特异性时源顺序靠后者胜：349 行的 `animation: pd-slide-in-right 280ms` 覆盖 323 行的 `animation: none`。气泡滑入、菜单 pop-in、条目交错等进场动画在 reduce 偏好下照常播放，注释自述的「前庭保护（WCAG 2.3.3）」承诺落空。
**修**：@media 块移到文件末尾 + 降级声明加 `!important`（与 `.pd-exiting` 同谱）；同时补 `.pd-dot`/`.pd-chat-cursor`（无限循环动画不在清单内）。

### H2. README 仍承诺 opencode「实验档」可用，但 r40 已下架
`README.md:18/63/69` vs `registry.ts:9-16`（opencodeDef import 已注释，AGENTS 数组无此项）。用户按 README 装 opencode 期望可用，探测永远不会列出——**说了但做不到**，脱节 2 天+。
**修**：README 三处改为「claude/codex 双引擎（opencode 适配器已就绪、暂因 Gatekeeper 上游问题下架）」；发版检查清单加「README 引擎列表 vs AGENTS 数组对账」。

### H3. PRIVACY.md/README 权限叙事与 manifest 矛盾
manifest 已含 `optional_host_permissions: ["<all_urls>"]`（r46），但 PRIVACY.md（2026-09-16）权限表仍写「不申请 `<all_urls>`」、README:20 同——**CWS 审核与用户信任都会拿 PRIVACY.md 对账 manifest，政策与事实直接矛盾**。另：PRIVACY.md 称「附件为文本 ≤512KB」，代码已支持图片附件且落盘 `~/.ai-page-dive/attachments` 未列入存储清单。
**修**：PRIVACY.md 补 optional_host_permissions 行（默认关闭 + 用户主动授予 + 授予后行为变化）、附件条目与存储清单更新、Last updated 刷新；README:20 同步。

## Medium（16 条）

**核心循环（3）**
- **M1 CTA 轮失败回填语义漂移**：hero 按钮「深度总结本页」失败后回填输入框，用户重发时这句**气泡标签文案被当作 instruction 字面指令**，deep workflow 完整模板被整体绕过（`task.ts:210-219` 亲证 `instruction || wfBody`）——r44 刚修过的「名实分裂」在回填路径复活。修：refill 携带 wf 字段（注意回填写入点有 **4 处**，漏一处漂移仍复现）。
- **M2 send 回调对 lastError 静默**：SW 唤不醒时回调整体 no-op，本轮挂 loading 120s 零反馈（`SummarizeView.tsx:293/308` 无 else 分支；同文件 panel-ready 有退避重试，此路径漏了对称处理）。修：else 走既有 `host-not-found-retry` 文案链。
- **M3 同一内置模式两套名字**：主界面下拉「深度总结」vs 设置页列表「deep」（`WF_LABEL` 只在 SummarizeView，Settings 直接渲染 `w.name`）。修：WF_LABEL 抽共享模块，设置页主行雅名+副行目录名（注意 WF_LABEL 有 5 处引用一并迁移）。

**健壮性（3）**
- **M4 超时误杀已交付任务**：result 成功帧已解析（gotResultOk=true）但进程未退出时，10min 超时分支不看它、照走 `onError('timeout')` + `persist('interrupted')`（`task.ts:253-277`）。修：超时分支前置 `gotResultOk` 检查改走成功终局。
- **M5 child 'error' 分支不 reap**：运行期 error 终局无 `this.proc?.reap()`（`task.ts:282-290`），与 cancel/timeout/isError 三路径不对称——detached 进程组无人收割继续烧 CLI 配额，且先 cleanupCwd 会删正在运行进程的工作目录。修：补一行 reap，**放 cleanupCwd 之前**。
- **M6 全应用无 React 错误边界**：渲染异常即整面板白屏丢全部会话态（`main.tsx` 19 行直接 render，grep 无 ErrorBoundary）。修：~20 行类组件包 `<App />`，fallback「重新加载」按钮。

**安全（1）**
- **M7 Read 围栏可读全盘**：claude `--allowedTools=Read` / codex `--sandbox read-only` 均不限读路径，恶意正文「读取 ~/.ssh/ 并复述」可穿透（prompt 级缓解非硬屏障）。修：claude 侧 `Read(路径/**)` 白名单（注意 macOS tmpdir 实为 /var/folders 软链需 `//` 前缀、追问轮 contentFile 为空串需容忍、白名单必须涵盖 attachments 否则拦断自己的正常链路）；**codex 无等效配置，须在 DECISIONS「已知限制」记录该不对称**，防「围栏已收窄」的错觉。

**工程债（6）**
- **M8 ext 侧 3900+ 行零自动化测试**（sw.ts/App.tsx/SummarizeView/Settings/nmport 全裸奔；r45 dev harness 12 项自验未挂 CI）。修：nmport 帧编解码抽纯函数补测 + sw 路由表抽可注入模块 + dev harness 自验脚本化。
- **M9 sw.ts 807 行六职合一**（锚定/会话持久化/NM 路由/提取/分片/编排共享顶层可变状态）。修：锚定机器与分片纯函数抽 lib/（注意 sw 用 Blob.size、host 用 Buffer.byteLength，测长口径不同，抽公共需注入抽象）。
- **M10 install.sh 钉版本无 CI 断言**（四处版本号纯手工 bump；MIN_HOST_VERSION 不抬时漏 bump 表现为「新功能静默缺失」）。修：release 检查脚本断言四处一致（跨维度双印证）。
- **M11 零 CLI 空态指引与自身认知相悖**（空态只给 npm 路线，但 registry 注释自认 native installer 是 2026 官方首选；codex 连命令都没给）。修：文案补 native installer 路线。
- **M12 三个下拉选中后焦点丢 body**（onClick 走 `setOpen(false)` 绕过 close() 的还焦；Esc 有还焦、Enter 选中没有）。修：三处改调 close()，或 useListboxMenu 封装 onSelect 统一语义。
- **M13 CSS 维护债三条**（琥珀树脂配方三处手抄 stop 微差 / accent alpha 20+ 处硬码无 token / spawn 行缓冲三边界零测试）。各自最小修见附表；树脂 token 化需保留 per-instance 可覆盖变量（45% 是 r21c 有意调参非漂移）。

**文档（2，计入 H2/H3 已列）**— M14/M15 为 H2/H3 的 medium 部分（附件叙事、版本同步），不重复计。

## Low（35 条，简列）

**产品/UX（12）**：npm 备选命令无 Node 引导 ｜ 发送按钮静默（Enter 有提示按钮漏了）｜ 下载文件名取当前页非快照页 ｜ quota 报错英文原文 ｜ no-extractor 归因误导 ｜ 过期 task-error 错标「已取消」 ｜ sendMessage 裸调未 catch ｜ 生效时机说明覆盖不全 ｜ 默认 tab 与排序首位不一致 ｜ 「总结语言」归类错位（降级）｜ 授权说明残留数据 tab（降级）｜ 默认 CLI 回退无告知（降级；主视图选择器其实透明，失真仅设置页）

**架构/代码（8）**：parser 分发内嵌 task.ts（降级，加第四 CLI 改动面大）｜ HostToExt 混入 SW 合成帧（降级）｜ 滚动双写两套并行（降级，收敛时保留「输入意图判方向」语义）｜ SV 1192 行 9 组件（降级）｜ chunk 常量三处定义 ｜ 'bad-request' 死协议成员 ｜ 追踪像素渲染（降级；覆写 img 点击加载）｜ 流式段落尾部不渲染

**host（4）**：mkdtemp 残留目录清扫不覆盖 ｜ 10min 超时一刀切（命中 v1 主路径，抽验建议考虑升 med）｜ join('') 双拼 ｜ 裸名 spawn 与探测可能不一致

**CSS（6）**：Tailwind 双轨（降级；主案「删 @theme」与 DECISIONS 技术栈决策冲突，应走 token 单源化次案）｜ 死 token 家族（降级）｜ 结构玻璃手抄两份 ｜ 受光环 16 行×2 ｜ reduce 清单漏循环动画 ｜ 零碎重复规则

**测试（3）**：AGENTS 单例打桩泄漏污染 ｜ stderr 尾巴浅覆盖 ｜ 红线脚本 .js 可绕过（降级；现状诚实，是守卫健壮性缺口非活 bug）

**a11y/manifest（4）**：分享菜单 Tab 逐项停 ｜ 授权失败静默 ｜ 品牌名 AI PageDive vs PageDive ｜ 流式无 aria-busy

## 优点面（95 条，按维度）

- **onboarding（10）**：安装路径行业最短 + 退出码四态全分流；自愈闭环（幂等 origins/forbidden 分流/指数退避）；⌘Q 卡装兜底；host/扩展版本脱钩有握手
- **core-loop（8）**：秒级即有反馈链；看门狗盯心跳不误判 codex 静默；关面板回来完整恢复（续流/incomplete 预置）；追问轮上下文严谨
- **error-edge（10）**：失败归因拆四类；host-not-found 不闪跳假引导；is_error 全链路落实；「半截内容比失败更受重视」三防线（抽验属实）
- **host-robustness（11）**：pgid 收割防 PID 复用误杀（抽验属实）；崩溃三连兜底；流解析边界系统化
- **arch（6）**：shared 真双向复用 + type-only import 使零依赖被结构保证（抽验属实）；协议判别联合 + total 对账；2.1k 行内分层仍清晰
- **a11y 基建（7，盲区补审新增）**：useDialogFocus/useRovingNav/useListboxMenu 三件套；流式读屏洪泛防护深思熟虑；历史两步删除键盘可达
- **manifest 对账（6，盲区补审新增）**：权限五项严格对账无多申；页面暴露面为零静态面；optional 授权语义与「用户主动授予」叙事一致（按钮内嵌出错气泡、明示真实范围、告知收回路径）
- **承诺对账（6，盲区补审新增）**：零遥测经 grep 全量核实成立；「不收费/零凭证」措辞精确不越界；供应链钉版本诚实

## 修复优先级建议

1. **立即（对外承诺 + a11y 承诺）**：H2 README opencode、H3 PRIVACY 权限表、H1 reduced-motion（半小时级 ×3）
2. **本周末（用户可感断裂）**：M1 CTA 回填、M2 send 静默、M5 error reap、M6 错误边界（各 ≤ 半天）
3. **下周（工程债起步）**：M8 nmport/sw 可测化第一批、M4 超时终局、M12 下拉还焦
4. **排期**：M3/M7/M9/M10/M11/M13 + low 按表

---
*原始数据：第一轮 strengths 82/confirmed 2/unverified 47；第二轮复验 23 坐实（11 降级）+ 盲区 13 发现 + 抽验 11/11 属实。全部发现含完整证据与修法存档于会话 /tmp/audit-r{1,2}.json。*
