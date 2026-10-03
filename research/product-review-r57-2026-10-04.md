# 产品多维严苛 Review — r57（2026-10-04）

## 执行摘要

r56 四批修复落地后的第二轮复盘。原始发现 26 → 对抗核实确认 24 / 否决 2（P1×1 / P2×11 / P3×12）。结构性观察：**r56 修的「拆 opencode / PRIVACY 如实化 / workflow-read 帧收缩」三项各留了一条尾巴**（#8 filePathInPrompt 死分支使 PRIVACY 描述的机制不可达、#14 workflow 截断回写只修了半截、#15 ctxAnchor 修复在面板重开路径复发），而**文档-事实错位**（#8/#9/#10/#11）与**「看起来很可信」的静默失效**（#1 截断误导 agent、#2 shadow-DOM 杂讯当正文、#6 面板尾部 4 万字截断）首次超过纯代码 bug 成为本轮最大簇。

### 委托三问（证据化评级）

**(1) 实现是否高质量？—— 评级：B（良好但有纪律漂移）**
- 结论：核心链路（NM 流转发、终局收敛、会话恢复）工程密度高，r55/r56 修复真实收敛了大部分历史缺陷；但消息契约层与门禁层出现自我纪律侵蚀。
- 最强论据：164 用例回归网 + pgid 收割/终局即删/丢片对账等真实场景锚测试，r56 修复轮确实逐条落地（本轮 24 项中仅 3 项是 r56 修复直接残留）。
- 最大短板：**扩展源码在 CI 零类型检查（#16）+ SW/panel 消息路径仍 16 处 as any（#20）**——protocol.ts 324 行类型资产对最复杂的数据流不生效，r33 自述「panel 侧不再 as any 消费」的承诺已被后续修复轮侵蚀；叠加 host 行数余量仅 2 行（#18），下一个 hotfix 即破线。

**(2) 产品是否专业？—— 评级：C+（多处以「看起来正常」掩盖实际失效）**
- 结论：交互基线（Onboarding 复制反馈、tips 条、历史页）整体用心，但同类问题在产品内口径不一致，且文档向用户承诺了代码不给的东西。
- 最强论据：README/npm 的 preuninstall 自动清理承诺在 npm ≥7 上是 no-op 且已发布版本连钩子都没带（#11）；PRIVACY 描述的「正文软链悬空残留」机制在当前代码不可达（#8）——两份对外文档的白纸黑字与实然直接矛盾。
- 最大短板：**静默失效族**：超长总结面板只显示尾部 4 万字且文案不实（#6）、剪贴板失败仍打 ✓（#7）、干净机器卸载报告「已清理 3 处」（#13）、sw.test 之外 UI 组件零测试 + e2e 硬编码个人机器路径（#17）——专业度的下限由这些「无告警的失真」决定。

**(3) 是否解决用户核心痛点？—— 评级：B-（主场景成立，最长/最重内容上恰好打折）**
- 结论：「零配置一键深度总结」的主路径（Readability→stdin→CLI 深读）确实成立，v1 痛点匹配；但目标用户是「大量读长文的重度读者」，而多项失效恰好集中在超长内容与重度使用上。
- 最强论据：正文全量落盘 + agent 自主分段 Read + workflow 可插拔的架构确实区别于「一段 prompt 塞正文」的浅总结，追问会话恢复（--resume）覆盖了深读的第二半场。
- 最大短板：**超长文系统性误导（#1）**：200k 截断发生时 prompt 仍断言「完整正文、请读全文后作答」，agent 会把「后半部分缺席」当成「文章本来就没有」，产出结构性错误总结——深度总结质量承诺在最长、最需要深读的文档上以「看起来可信」的方式失效；同族还有 shadow-DOM 杂讯当正文（#2）、追问轮诱导模型重读已删文件（#22）、**钉版 0.1.3 未发布致新用户主安装命令必然 ETARGET（#21，P1）**。

---

## 方法与规模

Workflow 编排（r57 产品严审）：8 维并行查找（pain-fit / eng-correctness / ux-professionalism / trust-privacy / lifecycle / r56-regression / quality-standards / user-walkthrough）→ 每项发现双镜对抗核实（怀疑论者逐环验证代码事实与场景可达性 + 取舍校准镜对照 DECISIONS.md 已拍板项）→ 跨维去重合并。核实确认 24 / 否决 2。注意：#14/#17 各带一条反对 verdict（详见各自证伪记录），合并裁定维持确认但严重度不升。

---

## 确认缺陷清单（按严重度）

### #1 钉版 0.1.3 未发布：新用户主安装命令必然失败（ETARGET），且卡装自愈指引把用户引向错误方向（P1；user-walkthrough）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/install.sh:43
- **证据**：install.sh:43 `npm i -g @aaione/ai-page-dive@0.1.3`；Onboarding.tsx:6 installCmd 与 :11 npmCmd 两处同钉 0.1.3（取 manifest version）；实测 registry dist-tags latest=0.1.2、versions 无 0.1.3；README:28 ①又要求 CWS 上线前 git clone + pnpm install && pnpm build + 开发者模式手动加载。
- **影响**：persona (b)（同事推荐才装）此刻走查：要么走 README 路线——先装 git/Node/pnpm、跑构建、开发者模式加载，随后终端跑面板命令仍报 ETARGET；要么直接复制面板 curl 命令——npm 报 ETARGET。更糟的是 Onboarding 的 stuck 检测（Onboarding.tsx:202-211）90 秒后把失败归因为「Chrome 未完全重启」，让怕折腾的用户去 ⌘Q 反复重启，永远走不出去；「命令报错了？」FAQ（:187-201）只覆盖代理/EACCES/pnpm 三态，无版本不存在的场景。三个 persona 的第一步全部卡死，啊哈时刻无限期推迟。
- **修法**：立即发布 0.1.3 到 npm（b2ecf83 的 CI 门禁已在催，这是唯一根治）。同时加两道兜底：① install.sh 捕获 ETARGET/ENOVERSION 时打印「该版本尚未发布（可能刚发版传播中），请稍候重试或临时用 @latest」而非落进通用失败指引；② Onboarding 的 stuck 文案在 Chrome 重启建议前加一步「确认终端命令最终成功（无 npm 报错）」，把「命令本身失败」与「装好但未重启」分流。
- **证伪记录**：两条 verdict 均核实成立：install.sh:43 与 Onboarding.tsx:11（动态取 manifest 0.1.3）两处钉版 0.1.3，而 npm registry 实查 dist-tags.latest=0.1.2、versions 仅含 0.1.2，新用户主安装命令必然 ETARGET；不属于文档化取舍——b2ecf83 的 CI 门禁（registry dist-tags 必须跟上仓库钉版）自认此态为故障。P1 校准无异议。

### #2 正文截断后 prompt 仍断言「完整正文」，agent 在超长文上被系统性误导（P2；pain-fit）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/apps/extension/src/content/extract.ts:13（MAX_CONTENT=200_000）
- **证据**：extract.ts:13 MAX_CONTENT=200_000 硬截断，:110-129 截断信息只进 notice 发给面板 tips 条；packages/host/src/prompt.ts:112-117 模板恒定写「完整正文（markdown，约 N tokens）已写入本地文件…请读取该文件全文后再作答」；packages/host/src/task.ts:237-239 buildPrompt 调用链上没有任何截断标志位。task.ts:538-540 注释自认「200,000 恒值=触顶信号」——超长文截断是产品自己预期会发生的活场景。
- **影响**：目标用户是「大量读长文」的重度读者，在线书籍/长帖/长报告正是主场景。截断发生时用户虽看到 tips 提示，但 CLI agent 被明确告知「这是完整正文、请读全文后作答」——它会自信地把「后半部分缺席」当成「文章本来就没有」，产出「作者未给出结论」类结构性错误总结，且 60 条大纲（prompt.ts:51，从已截断内容构建）也无法补正。深度总结质量承诺在最长、最需要深读的文档上恰好失效，且失败方式是「看起来很可信」。
- **修法**：把 truncated 标志贯通进 prompt：PageContent 已有 notice 字段（packages/shared/src/page.ts:16），在 task.ts 组装时检测 contentChars 触顶（或 extract 时置 truncated 位），prompt 模板改为条件文案——「正文超长，已截断为前 200,000 字符（原文约 N 字符）；总结时请明示仅覆盖前文部分，勿对未读部分下结论」。顺带可在「正文导航」段附文件总行数与各段行号区间，帮助 agent 用 offset 分段 Read（claude Read 默认 2000 行上限，200k 字符文档单次读不完，目前只靠「不要只读开头」一句口头叮嘱）。
- **证伪记录**：两条 verdict 均 refuted=false：核实属实、推理链成立（行号有轻微漂移——MAX_CONTENT 实测在第 13 行非第 6 行，内容属实；truncated 信号仅拼进 notices → PageContent.notice）；不属已文档化取舍。同仓库 extract.ts:123 与 r56 #8 修订已确立「截断必须向用户透出」的自身标准，本条是该标准在 agent 侧的缺位。

### #3 shadow-DOM 正文站点：Readability 提到「非空杂讯」时静默当正文总结，低置信信号只在结果为空时触发（P2；pain-fit）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/apps/extension/src/content/extract.ts:108-127
- **证据**：extract.ts:108-109 注释自认「cloneNode 不克隆 shadow DOM——正文在 shadow root 里的站点 Readability 拿到的是壳」；:111 兜底链只在 `!markdown.trim()` 时才走 collectShadowText；:127 `lowConfidence = !article?.content`——Readability 只要返回任何非空 HTML（导航/评论区/页脚文本），shadow 兜底与低置信提示双双不触发。
- **影响**：现代 SPA 站点把正文整体渲染进 shadow root 的形态并不罕见（README/文档站/部分阅读类产品）。这些页面上 Readability 会从 light DOM 残余（菜单，侧栏，评论）拼出一段非空文本，用户拿到的「深度总结」总结的是页面杂讯而非正文，且无任何「解析失败/质量受限」提示——比直接报错更伤信任，因为输出看起来一本正经。产品对付费墙/结构差站点承诺「尽力提取已渲染内容」（D8），此缺口恰在该承诺的覆盖面上。
- **修法**：双重启发式兜底：① 提取后比对 markdown 长度与 collectShadowText(document.body) 长度，当 shadow 文本显著更长（如 >2x）且 markdown 未含 shadow 文本主段时，改用/合并 shadow 文本；② 或当 markdown 长度低于页面 body 文本某个比例（如 <30%）时也置 lowConfidence notice。技术上 collectShadowText 已现成（:33-47），只差触发条件从「结果为空」放宽为「结果可疑」。
- **证伪记录**：两条 verdict 均 refuted=false：代码事实全部属实（行号漂移至 108-109/111/127），机制主张经亲读代码全部属实——Readability 从 light DOM 壳拼出非空杂讯时 shadow 正文被忽略且无任何质量提示，extractor 还标为 readability 显得正常。取舍校准镜否决豁免。

### #4 连坐取消/断连等 SW 侧终局绕过 lastTerminals 收件箱：面板收起期间任务「凭空消失」，重开零解释甚至误导（P2；eng-correctness）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/apps/extension/src/background/sw.ts:60
- **证据**：sw.ts:60（lastTerminals 只收 task-error 形状）；sw.ts:546-557（cancelCurrent 合成 cancelled 终局仅广播，不写收件箱）；sw.ts:686（`!cancelledTaskIds.has(msg.taskId)` 把 host 侧迟到 cancelled 终局也挡在收件箱外）；sw.ts:696-706（onDisconnect 的 __host-disconnected 仅广播，不写收件箱）。r53#5/r54#5 只修了「host 原生 task-error 广播无接收端」这一路。
- **影响**：主路径可达：A 页签跑 deep 总结（claude init 已归档 sessionId 但无 historyPath）→ 用户切到 B 页签点图标起新总结（startSummarize 入口 cancelCurrent 连坐取消 A，sw.ts:777）→ 面板是窗口级单实例且随切 tab 收起，A 的 cancelled 广播无接收端被静默丢 → 切回 A 面板重开（React 态丢，走 panel-ready）：activeTask 已属 B、missedTerminal 空、hasSession=true 但 historyPath 缺 → 走 App.tsx:300-307 else 分支显示「此前对话已清空，可直接追问」——用户看到的是深度总结跑了几分钟后凭空蒸发、且提示文案与事实（被连坐取消）相反。host 崩溃 + 面板收起同理零痕迹。这与 sw.ts:546 r16 注释宣称的「被折叠的旧锚面板切回时能看到谁被取消了」不符——宣称的兑现依赖面板恰好在广播时刻可见。
- **修法**：cancelCurrent 在广播同时把合成终局写入 lastTerminals（owner 取 currentTask.tabId，广播与入箱双写，panel finished 台账幂等双收无害——sw.ts:543 注释自述「finished 幂等，双收无害」）；onDisconnect 对有 taskId 的断连同样入箱（折算为 code:'host-disstarted' 或 ext-restarted 同款处理，App ERROR_LABEL 补对应中文条目）；content-mismatch 补 tabId 邮戳与入箱（见 #5）；对 cancelledTaskIds 命中的 host 迟到 cancelled 帧，因 SW 合成帧已入箱，维持箱外拦截即可（避免双份）。补一条 SW 回归测试：连坐取消 + 面板无接收端 → 重开 panel-ready 应带 missedTerminal。
- **证伪记录**：两条 verdict 均 refuted=false 且指出场景比描述更彻底：四条代码证据全部亲读坐实（lastTerminals 只收 task-error 形状且唯一写入点在 687 行；cancelCurrent 合成终局仅广播；545-546 r16 注释宣称与实不符）；面板随切 tab 收起是本产品刻意设计，主路径可达。

### #5 超长总结降级为纯文本时静默截掉前文，且提示文案不实（说「纯文本显示」实际只显示尾部 4 万字符）（P2；ux-professionalism）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/apps/extension/src/sidepanel/StreamMarkdown.tsx:154-165
- **证据**：大文本降级分支渲染 `rendered.slice(-40_000)`（只保留最后 4 万字符），提示文案为「（内容较长，已切换为纯文本显示——完整 markdown 可用下方「下载」保存）」；流式期间版本（:159）「（内容较长，完成后纯文本显示）」措辞还暗示现在仍是 markdown、完成后才切换，实际此刻已是纯文本。
- **影响**：深度档总结长文（尤其 paper/humanize 档）输出超 128K 字符时：① 面板内只能看到末尾约 4 万字符，前文完全不可见，且没有任何「上文已截断」的说明——用户以为这就是全文，「深度总结质量」这一核心承诺在最长内容上恰恰打折；② 文案说「已切换为纯文本显示」是对全量的假承诺，用户不知道自己丢了内容（只有主动点下载才能发现全文）。
- **修法**：文案如实化并给出路：降级提示改为「内容超长，面板仅显示末尾约 4 万字符——开头部分请用下方「下载」保存后查看」，流式版本改为「（内容较长，已暂时以纯文本显示）」；进一步可把 slice 截断点提示在文首（如「⋯⋯前文约 X 字已折叠」），或提供「分段加载上文」按钮。
- **证伪记录**：两条 verdict 均 refuted=false：:155-165 确实在 rendered>128K 字符时降级、:162 只渲染尾部 4 万字符、无任何截断标记、done 后为永久态；文案未披露面板内仅显示尾部，确有误导。不属文档化取舍（DECISIONS.md/架构报告均未记录，也无测试锚定）；同仓库 extract.ts:123 与 r56 #8 修订确立了「截断必须向用户透出」的自身标准，本条违反该标准。

### #6 PRIVACY 描述的「正文软链悬空残留」机制在当前代码不可达——filePathInPrompt 死分支，agent-workspace 实际行为与文档不符（P2；trust-privacy）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/PRIVACY.md:9,22
- **证据**：PRIVACY.md:22「供 CLI 读取的任务工作目录（正文/附件符号链接与提示词组装）：~/.ai-page-dive/agent-workspace/……正文软链的本体临时文件随任务终局删除，软链自身残留为悬空链接，不含内容」；英文摘要 PRIVACY.md:9 同款「links to the temp body files remain as dangling links」。但正文软链唯一创建点是 packages/host/src/task.ts:225-228 的 `if (def.filePathInPrompt && agentCwd && !isResume)` 分支（linkIntoCwd，task.ts:561），而 grep 全仓 claudeDef/codexDef 均未定义 filePathInPrompt——opencode 2026-10-01 随 D5 修订删除后该分支成死代码，正文实际以 /tmp/pagedive 绝对路径直接进 prompt（buildPrompt 的 fileForPrompt=contentFile），从不软链进 workspace；「提示词组装」也不在 workspace——prompt 一律走 stdin（task.ts:249 stdinData，不落盘）。workspace 里真实存在的只有附件软链（materializeAttachments，task.ts:139）和作为 CLI 固定 cwd。
- **影响**：隐私政策整句描述一个不存在的机制（正文软链+悬空链接）。用户照文档去 ls ~/.ai-page-dive/agent-workspace/ 验证「悬空链接不含内容」时会发现根本没有正文软链，对政策其他更关键声明的可信度产生连带怀疑；同时 task.ts:214/260/450 的 mkdtemp-cwd 分支、spawn.ts:34 makeAgentCwd、linkIntoCwd 均为不可达死代码，白耗 host 2198/2200 的贴线额度。
- **修法**：PRIVACY.md:9/22 改写为事实：「正文以 /tmp/pagedive 绝对路径临时文件直供 CLI prompt，任务终局即删；agent-workspace 仅作 CLI 固定工作目录与附件软链（附件软链由下次任务启动时清扫重建）」，删除「提示词组装」「正文软链悬空残留」字样。代码侧顺手删 filePathInPrompt 死分支（agentdef.ts:23、task.ts:214/225-228/561、spawn.ts makeAgentCwd、task.ts:260 的 agentCwd!==stableCwd 分支），host 行数还能从贴线回落。
- **证伪记录**：两条 verdict 均 refuted=false：PRIVACY 中英文确有「正文软链悬空残留」机制描述；filePathInPrompt 在 claude.ts/codex.ts 均未定义（grep 证实，dist/agents/opencode.js 是过期构建产物），对现行双适配器为死分支；正文以 /tmp/pagedive 绝对路径直供 prompt、prompt 走 stdin。发现无法否决。

### #7 README 承诺的「npm uninstall -g 自动清理 NM 注册」在 npm ≥7 上是 no-op——preuninstall 钩子根本不会被触发，且已发布的 0.1.2 连钩子都没带（P2；lifecycle）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/README.md:96
- **证据**：README.md:96 向用户承诺「npm uninstall -g @aaione/ai-page-dive——preuninstall 钩子自动清理本机组件注册（NM manifest + wrapper）」；钩子定义在 packages/host/package.json scripts.preuninstall（调用 dist/index.js uninstall）。但实测（本机 npm 11.12.1）三组受控实验：①本地项目显式 npm un 带标记钩子的包——未运行；②--prefix 全局 uninstall——未运行；③husky 9 包重写 preuninstall 标记后 npm un --ignore-scripts=false --foreground-scripts——仍未运行（husky 9 自身已不附带任何 scripts，正是绕开此问题的旁证）。复演真实包：temp prefix 装 @aaione/ai-page-dive@0.1.2 再卸载，全程无任何 [ai-page-dive] 输出。且 `npm view @aaione/ai-page-dive@0.1.2 scripts` 显示已发布版本只有 build/prepack/postinstall——preuninstall 从未随任何已发布版本交付过。社区同证：npm 7+ 不执行被移除包的卸载生命周期脚本。
- **影响**：用户照 README 走主卸载路径后，Chrome NM manifest（~/Library/Application Support/Google/Chrome|Chrome for Testing/NativeMessagingHosts/com.pagedive.host.json）与 ~/.ai-page-dive/host-wrapper.sh 永久残留：若扩展还在，每次点击都 spawn 一个 exec 已删 npm 包的 wrapper 报「Native host has exited」；若扩展已删，manifest 作为死登记长期留在 Chrome 配置里。r52（review #5）专门为「本地最小 footprint」做的这个修复，在 npm 主路径上实际从未生效——与 README 的白纸黑字承诺直接矛盾，属信任损伤。
- **修法**：文档与产品双修：①README.md:96 把 npm 用户的主出口改成与 pnpm 同款顺序指引——「先跑 `ai-page-dive uninstall`（清 NM manifest + wrapper），再 `npm uninstall -g @aaione/ai-page-dive`（顺序不可反）」；②更稳妥的产品化修法：扩展侧在 probe 失败（host 消失/forbidden）且本机曾装过的场景下，把「ai-page-dive uninstall && npm uninstall -g @aaione/ai-page-dive」完整复制命令透出到面板（Onboarding 已有 forbidden/not-found 分支可挂）；③发 0.1.3 时保留 preuninstall 作为兜底但不得再作为文档化承诺。
- **证伪记录**：两条 verdict 均独立复核成立：三根支柱（README 原文承诺且特意只对 pnpm 提示钩子不执行；registry 实查 0.1.2 scripts 仅含 build/prepack/postinstall；npm 7+ 不执行被移除包的卸载脚本）全部为真。

### #8 host 升级只有下限握手、无任何升级触达：已装机用户的 host 永远收不到修复，而 Onboarding 承诺「仅此一次」（P2；lifecycle）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/apps/extension/src/background/sw.ts:15
- **证据**：sw.ts:15 `MIN_HOST_VERSION = '0.1.0'`，sw.ts:417-420 只在 hostVersion < 0.1.0 时弹横幅；注释明确「协议新增依赖消息时才抬高」——即 host 0.1.0 与 0.1.3 对扩展而言等价，永不提示。Onboarding.tsx:113 面板文案承诺「还差一步（仅此一次，约 1 分钟）」。host 无 daemon、无自更新检查（D3 定案 NM 薄壳），install.sh 又钉版本安装。而 PRIVACY.md:22-23 描述的终局删正文临时文件、异常残留兜底清扫等行为是 r55/r56 才进 host 的——装了 0.1.0/0.1.1 host 的用户读到的是 PRIVACY.md 的承诺，跑的是旧行为。
- **影响**：第二次体验（升级）缺位：CWS 扩展自动更新了，host 却永远停在安装当天。隐私清理类、崩溃收割类修复对存量用户不可达，且用户被「仅此一次」文案明确告知无需再管——文档承诺与装机现实的漂移会随每个 host 修复累积。零配置叙事下用户不会主动跑 npm 命令升级。
- **修法**：复用现成横幅机制加一条非阻断提示：panel-ready 握手时若 `versionLt(r.hostVersion, chrome.runtime.getManifest().version)` 且不相等，在 tips 区显示一行「本机组件有新版本（当前 x.y.z），建议升级」+ 可复制的两连命令（sw.ts:419 的命令现成，配合 r56 #14 修复制按钮）。不改 MIN_HOST_VERSION 语义（硬门槛起留作协议破坏），只加软提示；host 侧零改动、不破薄壳红线。
- **证伪记录**：三条 verdict 均 refuted=false：MIN_HOST_VERSION='0.1.0' + 下限握手语义、「仅此一次」文案逐字存在、host 零自更新逻辑、install.sh 钉版只保新装用户——全部亲验属实。

### #9 workflow-read 静默截断与设置页保存回写叠加：大 workflow 面临「读出来已被截断、又存不回去」的困境（359a308 #9 半截修复）（P2；r56-regression）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/packages/host/src/stdio.ts:159-164
- **证据**：stdio.ts:159-164 对 >1MB 的 WORKFLOW.md 帧内截断（尾部拼 '\n\n[... 已截断]'，无 truncated 标志）；apps/extension/src/sidepanel/Settings.tsx:158-172 收到 workflow-file 后 parseWorkflowMd 无截断检测直接灌进编辑器 body；Settings.tsx:269-296 saveWorkflow 把 editor.body 原样经 workflow-save 写回磁盘。截断后的 body 恰好收缩到 NM_MAX-1024 附近，即约 1MB——若低于 SW 帧限门禁（sw.ts:522 注释自述约 1MB 上限）则保存成功，磁盘上的 workflow 尾部被静默截掉；若压线超限则保存被拒，用户面对「读出来已被截断、又存不回去」的死局。
- **影响**：r56 #9 自己引用了真实发生的 1.1MB WORKFLOW.md 案例，说明该场景在野外可达。用户打开大 workflow 编辑（哪怕只改 description）点保存，超限部分永久丢失且无任何警告——唯一线索是正文末尾一行「[... 已截断]」，用户无从得知「保存会把截断状态固化」。workflow 是「深度总结质量」承诺的可插拔核心，静默破坏用户自建模式直接伤该承诺与信任。
- **修法**：host 侧 workflow-file 帧加 `truncated: true` 字段（或 panel 检测 '\n\n[... 已截断]' 尾标）；Settings.tsx 收到截断标记时编辑器置只读并在保存路径硬拦截，提示「该模式超过 1MB 传输上限，已只读展示——请在本机 ~/.ai-page-dive/workflows/ 直接编辑」，杜绝截断体回写磁盘。
- **证伪记录**：**分裂裁定（1 支持 / 1 反对，合并维持确认但降格表述）**。支持方：三处证据引用全部属实（stdio 截断拼尾标且无 truncated 标志、parseWorkflowMd 无检测直接灌入、saveWorkflow 原样回写），r56 #9 确为对齐 history-read 的半截修复。反对方：标题级主张「静默不可逆数据破坏」不成立，属严重夸大——host 截断循环（每步砍 64KB 至 JSON≤NM_MAX-1024=1047552）使截断体落在 (约981976, 1047552] 区间，而 SW 门禁阈值是 1MB-64KB=983040 即拒发，静默保存成功窗口仅约 1KB 宽。故真实主体风险是「读出截断 + 保存被拒的死局体验」而非「静默数据丢失」；修法（truncated 标志 + 只读拦截）对两种结局均有效，维持 P2。

### #10 扩展源码在 CI 无任何类型检查门禁，与 ci.yml 自述的「类型检查」承诺不符（P2；quality-standards）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/apps/extension/package.json
- **证据**：apps/extension/package.json 的 build 仅有 `vite build && vite build --config vite.content.config.ts`（esbuild 只转译不查类型）；仓库根 package.json 与 .github/workflows/ci.yml 的 22 腿步骤为 `pnpm -r build` / `pnpm test` / check-version / check-published，全程无一处 `tsc --noEmit` 针对扩展源码。ci.yml 头注释宣称「本 workflow 把『行数红线 + 类型检查 + 全量测试』变成 main/PR 的硬门禁」，但类型检查实际只覆盖 host/shared（host build = `tsc -p tsconfig.json`）。本机实测 `cd apps/extension && npx tsc --noEmit` 当前为绿（exit 0），即此刻无 latent 错误，但门禁缺位。
- **影响**：扩展是产品最大代码面（App.tsx 1031 行 + sw.ts 900+ 行），当前任何 PR 引入类型错误都能绿色合入 main，等价于 shared 里精心维护的 protocol 类型（protocol.ts 324 行）对 panel/SW 一侧只靠自觉。用户侧短期无感，但这是「流式渲染/会话恢复静默回归」的温床——类型错误在这类状态机代码里往往就是运行时 bug。
- **修法**：在 apps/extension/package.json 加 `"typecheck": "tsc --noEmit"`，并进 ci.yml 22 腿（`pnpm --filter @ai-page-dive/extension typecheck`）。成本秒级，无新依赖；顺带把 ci.yml 头注释与事实对齐。
- **证伪记录**：两条 verdict 均 refuted=false：证据链全部亲验属实（build 仅两段 vite build 且两个 vite config 均无 checker 插件；ci.yml 22 腿无 typecheck；头注释承诺与实不符；本机 tsc --noEmit 当前绿）。

### #11 三份 e2e 脚本硬编码个人机器绝对路径且不在 CI——UI/全链路回归网实质是单机手工脚本（P2；quality-standards）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/scripts/e2e.mjs:16
- **证据**：scripts/e2e.mjs、scripts/e2e-ui.mjs、e2e-runtime.mjs 均硬编码 `const EXT = '/Users/apple/work/hs/ai-feature/ai-page-dive/apps/extension/dist-e2e'`，且三脚本均硬编码 chromium-1217 可执行路径（'/Users/apple/Library/Caches/ms-playwright/chromium-1217/.../Google Chrome for Testing.app'）。ci.yml 无任何 e2e 步骤。同时 sidepanel 六个组件（App.tsx 1031 行、SummarizeView、StreamMarkdown、HistoryView、Settings、Onboarding）零组件测试——自动化仅覆盖 sw.test.ts（chrome shim 回归网，441 行）、historyTurns/workflow-labels 单测与 content/extract jsdom 测试。
- **影响**：e2e 实质是「只能在 tj 的 Mac 上手工跑的个人脚本」：换机器、换 chromium 版本（1217 缓存被清即失效）或 tj 之外任何贡献者都无法执行。叠加 UI 组件零测试，核心承诺②「深度总结质量」的呈现层（流式 markdown、追问、历史查看/删除闭环）回归防护完全依赖手眼，CWS 审核中改 UI 的每一轮都在裸奔。
- **修法**：最小修：e2e 三脚本用 `fileURLToPath(new URL('..', import.meta.url))` 推 repo 根（check-host-lines.mjs 已有同款先例），chromium 路径走 lib/playwright.mjs 的 loadChromium 解析或 env 注入；进阶：ci.yml 加 macos-runner 的 nightly e2e job（NM host 本就 macOS-only，v1 范围内天然匹配）。UI 组件测试可用 dev harness（chrome-mock.ts 已是现成 mock 层）做 jsdom 渲染冒烟。
- **证伪记录**：**分裂裁定（1 支持 / 1 反对，合并维持确认但影响面按反对方收窄）**。支持方：三脚本硬编码路径亲读属实、CI 无 e2e 属实。反对方：核心指控属文档化取舍且影响面夸大——DECISIONS.md:28 明确拍板「扩展侧手动验证」，e2e 不进 CI 与 playwright 不进 devDeps 的既定 ponyfill 取舍（scripts/lib/playwright.mjs r53 #17 注释）配套一致；「其他贡献者无法执行」在单人仓库 + v1 macOS-only 范围下无现实受害者。维持确认的理由：即便接受手动验证取舍，「换 chromium 缓存版本即失效」对唯一的执行者（tj 本人）也是真实的回归网脆断风险，路径参数化的 3 行修法成本远低于风险。UI 组件零测试部分无争议。

### #12 追问轮可能重读已删除且已出白名单的正文文件：无 prompt 预防，模型侧工具失败噪声直接伤追问质量（P2；user-walkthrough）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/packages/host/src/task.ts:237-238
- **证据**：task.ts:448-453（r55）终局即删 contentFile；task.ts:237-238 resume 轮 prompt 仅 attachSection + instruction，未告知源文件已清理；claude.ts:106/113 resume 轮白名单显式跳过 contentFile 根。而首轮 prompt（prompt.ts:114-116）明确指示「请读取该文件全文后再作答，不要只读开头」——该指令持久留在 claude 会话历史里。
- **影响**：persona (a)（重视深度与追问）的典型动作「回到第 X 节展开讲」「那段数据原始数字是多少」会诱导模型复用首轮的 Read 策略：路径要么已被删（file not found）要么已出白名单（permission denied）。轻则模型致歉并凭上下文降质作答，重则把工具错误复述进答案（「我无法读取文件……」）。面板侧 PageTips「追问不重读页面」只说明面板不重提取，用户无从预期模型侧也会扑空——这是「深度总结质量」承诺在追问半场的静默缺口。
- **修法**：resume 轮 prompt 尾部追加一行固定指令：「正文源文件已按隐私策略在任务结束时清理，请仅基于会话内已有上下文作答，勿尝试重新读取原路径」——一行纯函数改动（task.ts:238），零行数红线压力，把隐私决策的质量代价从用户侧移回模型侧兜住。
- **证伪记录**：两条 verdict 均 refuted=false，四项证据逐条亲码核实全部属实（终局即删、resume prompt 零字告知、claude.ts buildArgs 注释亲口承认 resume 轮跳过白名单根、首轮 Read 指令留在会话历史）。

### #13 任务硬超时 10 分钟不可配置，深度档超长文超时后重试双重烧穿订阅额度（P3；pain-fit）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/packages/host/src/task.ts:18
- **证据**：task.ts:18 `TASK_TIMEOUT_MS = Number(process.env.PAGEDIVE_TASK_TIMEOUT_MS) || 10*60_000`——host 由 Chrome spawn（install.ts wrapper），用户无法注入环境变量，该 env 仅测试注释自认可用（:17）；apps/extension/src/sidepanel/App.tsx:998 超时文案「你的问题已放回输入框…可直接重发」。
- **影响**：deep/paper 档在 200k 字符正文上要求 agent 多段 Read + 结构化研读，慢模型/高峰期完全可能逼近或超过 10 分钟；超时收割后用户唯一的出路（重发）会让 CLI 从头再读全量正文，一次失败的深读 = 两倍订阅用量消耗。对以「复用已有订阅、零边际成本」为核心卖点（承诺③）的产品，这是可感知的信任损耗。
- **修法**：最小改法：设置页暴露任务超时档位（如 5/10/20 分钟，经 NM 帧传给 host 覆盖缺省值，协议已有 historyLimit 同款先例 sw.ts:871）；或至少对 deep/paper 档把缺省抬到 15-20 分钟、quick 维持 10 分钟（按 workflow 分档，改动集中在 task.ts 一处常量）。
- **证伪记录**：verdict refuted=false：核心事实全部核实属实（env 仅 r47-audit 测试钩子、host 经 Chrome NM spawn 不继承用户 shell 环境、非用户配置面）。

### #14 content-mismatch 终局帧无 tabId 邮戳：双窗口下空闲面板凭空收到他页签的「正文传输不完整」错误（P3；eng-correctness）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/apps/extension/src/background/sw.ts:616-618
- **证据**：对账失败时 chrome.runtime.sendMessage 直发 task-error，无 tabId 字段，也不走下方 :668-671 的统一盖戳路径——因为该帧在 stamp 逻辑之前 return/直发。对照同文件 cancelCurrent 的合成帧带 tabId（:556），且 r54#3 已确立「非 currentTask 的迟到帧也经 tabOf 盖邮戳」的全帧不变式。
- **影响**：双窗口（或面板重开后 React 态清零的未绑定窗口）场景：窗口 1 的 A 页签总结正文 NM 丢片触发 content-mismatch，无邮戳帧广播；窗口 2 的 B 面板空闲（taskId=null）时 App.tsx:161 的 foreignAdopt 判据要求 `typeof m.tabId === 'number'` 才拒收——undefined 邮戳走「旧裸发放行」→ B 面板凭空插入「正文传输不完整（NM 丢片），已取消——请重试」错误气泡。触发需 NM 丢片（本身罕见）+ 第二面板空闲，概率低，但属于已确立邮戳不变式的唯一缺口。
- **修法**：sw.ts:616 的直发帧补 `tabId: currentTask.tabId`（此刻 currentTask 仍非 null，在 :619 置 null 之前取值），并复用 sendToPanel 统一出口；理想情况下该帧同样写入 lastTerminals（与 #4 同族同修）。补回归：mismatch 帧 panel 侧 foreignAdopt 拒收断言。
- **证伪记录**：verdict refuted=false：引用属实，undefined 邮戳帧确实穿透空闲面板，是 r53/r54 已确立全帧盖戳不变式的真缺口。

### #15 markdown 代码块复制按钮：剪贴板写入失败仍显示「已复制 ✓」，与自家 Onboarding 修过的同类问题（r31-a11y）口径相反（P3；ux-professionalism）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/apps/extension/src/sidepanel/StreamMarkdown.tsx:19-25
- **证据**：`await navigator.clipboard.writeText(...)` 的 `catch { /* 剪贴板权限被拒：静默 */ }` 后无条件 `setCopied(true)`，图标变 ✓（:27-30 渲染 ✓ SVG，aria-label 也切成「已复制」）。对照 Onboarding.tsx:24-26/85-88（r31-a11y）：主安装命令的复制失败专门给了 `copyFail` 可见提示「复制失败——请手动选中上方命令行复制」，注释明确写着「静默失败会让用户以为复制成功」。
- **影响**：剪贴板写入被拒（面板失焦/权限策略）时，代码块复制按钮照样打 ✓「已复制」，用户去粘贴得到空/旧内容——同一产品内，Onboarding 承诺「复制失败必有可见反馈」，代码块复制却静默造假，属于自破口径的专业度瑕疵。
- **修法**：与 Onboarding 同谱：catch 里维持原图标并给短暂错误态（如图标变「!」+ title/aria-label 提示「复制失败——请手动选中代码复制」），或至少失败时不置 copied=true 让状态如实。
- **证伪记录**：verdict refuted=false：逐行核对成立（catch 静默 + 无条件 setCopied(true) + 1.5s ✓ 图标 + aria-label「已复制」）。

### #16 storage 权限表只写「session 域，不落盘」，但 storage 权限实际同时驱动跨重启持久化的 storage.local 键，面板偏好另写 localStorage（均为持久落盘），存储位置清单未列（P3；trust-privacy）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/PRIVACY.md:43
- **证据**：PRIVACY.md:43 权限表「storage | 恢复追问会话状态（session 域，不落盘）」、PRIVACY.md:24/英文摘要「follow-up session state stays in Chrome session storage (cleared on browser restart)」。但 apps/extension/src/background/sw.ts:91-96（r55 #10）在跑任务指针写 `chrome.storage.local.set({ pdRunningTask: { taskId, tabId } })`——local 域落扩展 profile 磁盘、跨浏览器重启存活（靠下次 SW 冷启动 restoreSession 折算清理，sw.ts:140-146）；另外 Settings.tsx:126 / SummarizeView.tsx:132 / Settings.tsx:702 等把 pd-default-cli、pd-sum-lang、pd-workflow、pd-reading-size 等偏好写入 localStorage（扩展 origin、浏览器会话间永久落盘）。
- **影响**：「不落盘」「重启即清」的字面承诺与 storage 权限实际写盘面不符。残留内容仅为 taskId/tabId/用户偏好，无正文、无 URL，实际隐私伤害接近零，但隐私政策的存储位置清单（自称枚举「全部在本机」落盘面）漏列两处持久化点，口径不完整。
- **修法**：PRIVACY.md 权限表 storage 行补「另含跨重启的在跑任务指针（storage.local，仅 taskId/页签号，终局即清）」；存储位置清单补一条「扩展面板偏好（默认 CLI/语言/档位等）：浏览器扩展本地存储（localStorage），无内容数据」。
- **证伪记录**：verdict refuted=false：evidence 全部属实（sw.ts setRunningTask 确写 storage.local、localStorage 偏好键确存、PRIVACY 两处表述与实然不符）。

### #17 host 读取用户 CLI 配置文件（~/.claude/settings.json、~/.codex/config.toml）未在 PRIVACY 披露，「零凭证接触」边界少说了一类文件访问（P3；trust-privacy）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/packages/host/src/agents/claude.ts:94-99
- **证据**：claude.ts probeModel：`JSON.parse(readFileSync(join(homedir(), '.claude/settings.json'), 'utf8'))` 读 model 与 env.ANTHROPIC_MODEL；codex.ts:76-79 probeModel：readFileSync `~/.codex/config.toml` 正则抽 model 行。PRIVACY.md「数据处理」「我们不做的」两节均未提及 host 会读取用户 CLI 的配置文件（全文无 settings.json/config.toml 字样，grep 确认）。
- **影响**：行为本身 best-effort、只抽 model 字段、不出本机、确未碰凭证（settings.json 的 model/env 非机密），但「零凭证接触=只子进程调起官方 CLI」的叙述让用户以为 host 不读 CLI 目录下任何文件。隐私敏感用户审计时会发现实际文件访问面比政策披露的大一类，属披露缺位而非实质伤害。
- **修法**：PRIVACY.md「数据处理」AI CLI 条目补一句：「为在界面下拉显示你配置的默认模型，host 会只读解析 ~/.claude/settings.json 与 ~/.codex/config.toml 的 model 字段（best-effort，读取失败即跳过），不读取其中任何凭证或其他字段」；英文摘要同步补「we read only the model field of your CLI's config file to display your configured default model」。
- **证伪记录**：verdict refuted=false：证据全部属实且场景可达（registry.ts:105 在 Agent 探测路径实际调用，非死代码；PRIVACY 全文无配置文件读取披露）。

### #18 ai-page-dive uninstall 的「已清理 N 处」计数恒等于 3——干净机器上也报告清了 3 处（P3；lifecycle）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/packages/host/src/scripts/uninstall.ts:11-22
- **证据**：两个 macOSManifestDirs 各一次 rmSync(join(dir, HOST_NAME+'.json'), {force:true}) + 一次删 host-wrapper.sh，每次后无条件 n++。rmSync 带 force 对不存在的文件不抛错（catch 分支实际不可达），所以 n 恒为 3，与是否真的删了东西无关。
- **影响**：手动跑 `ai-page-dive uninstall` 的用户（README 现在要求 pnpm/npm 用户都先跑它）在本来就没登记的机器上也会看到「[ai-page-dive] 已清理 3 处本机注册」——反馈失真，排障时误导（用户以为确实曾有 3 处残留被清掉）。
- **修法**：删除前 existsSync 判定，仅对真实存在且删除成功的文件计数；一个都没删时改报「未发现本机注册，无需清理」。3 行改动，可顺带在 uninstall 输出里列出被清的具体路径（排障友好）。
- **证伪记录**：verdict refuted=false：事实核查成立（rmSync force:true 对不存在文件不抛错故 n 恒 3，catch 仅 EPERM 类权限异常可达）。

### #19 ctxAnchor 快照不跨面板重开——#12 修的错标场景在「关面板→页签导航→重开」路径原样复发（df8a869 #12）（P3；r56-regression）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/apps/extension/src/sidepanel/SummarizeView.tsx:249-254
- **证据**：捕获效应用当时的 pageMeta 快照，firstId 变化即置空重捕；而面板重开时 restore 帧带回的 page 来自 sw.ts:440 `page: pageMeta()`，pageMeta()（sw.ts:767-772）读的是活 target（锚定页签当前 url/title）。SW 每 30s 回收、面板常态关闭重开，重开后 ctxAnchor 立即用「导航后的新页」重新快照——恰是 #12 注释自述要修的「页签内导航后 tips 把对话上下文错标成新页标题」。
- **影响**：用户关掉面板、同页签导航到新页、再开面板继续追问：tips「对话上下文」显示新页标题，而 CLI --resume 的实际内容仍是快照页。仅误导性标签，不影响 resume 内容本身，且仅限重开路径（面板常开的原场景已修好），故 P3。
- **修法**：SW 侧 sessions 表随会话持久化来源页 title/url（task-start 的 page 即顶层锚，sw.ts:857 已有），restore 帧增 sess.page 字段带回；panel 捕获效应优先用 restore 带回的会话来源页，活 pageMeta 仅作无会话数据时的兜底。
- **证伪记录**：verdict refuted=false：所有 evidence 引用属实（唯一瑕疵：sw.ts 实际路径为 apps/extension/src/background/sw.ts，行号均对得上；面板重开时 props 来自 probe 响应 resp.page，App.tsx:265）。

### #20 host 行数红线余量仅 2 行，续命路径（删注释）有约 500 行空间但从未执行（P3；quality-standards）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/scripts/check-host-lines.mjs
- **证据**：实测 `2198 < 2200（17 个文件，余量 2）`。历史趋势为每修复轮 +43 行（脚本头注释自述 1849→1902→1956→2039→2262 后靠删 opencode 回到 2198）。计数含注释行：host/src 计入文件中纯注释/文档行约 500+（task.ts 108/565 ≈ 19%），其中「r4x/r5x 轮号考古注释」59 处——内容与 git blame/commit message 重复（如 task.ts:212-217 三段 opencode 残迹注释、stdio.ts:220 关停注释里的历史考据）。
- **影响**：下一个 >2 行的 hotfix（安全修复最典型）就让 main CI 红，逼 maintainer 在修 bug 与守红线间做即时取舍，容易出现「先抬阈值再说」的红线腐蚀开头——这正是脚本头注释自己警告的「阈值被反复上调的红线等于没有红线」。用户侧暂无感，但红线失效的终局是 host 薄壳承诺（启动速度、攻击面）缩水。
- **修法**：主动做一次「注释瘦身」恢复余量：把 r 轮号考据从代码注释迁到 CHANGELOG/commit（保留「为什么」、删「哪一轮谁说的」），预计可回收 100-150 行，恢复到 ~2050 的健康余量；同时明确下个功能的进位规则——运行时逻辑进 host 必须先等价删行，纯 UI/panel 侧功能不受限。scripts/install.ts（161 行）+ postinstall.ts（118 行）豁免于计数是有文档的一次性安装器口径，不算后门。与 #6 删 filePathInPrompt 死分支同做可叠加回收。
- **证伪记录**：verdict refuted=false：脚本实测输出逐字一致且为 ci.yml/根 test 第一步，余量 2 意味着任何 >2 行的 host/src 增加即 CI 红；注释行统计核实成立。

### #21 packages/shared/src/index.d.ts 是无人引用的僵尸声明文件，版本停在 0.1.0（P3；quality-standards）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/packages/shared/src/index.d.ts
- **证据**：全文一行：`export declare const SHARED_VERSION = "0.1.0";`——与同目录 index.ts（`export * from './page.js'` 等三行）并存。全仓 grep `SHARED_VERSION` 仅此一处定义、零使用。check-version.mjs 的 spots 清单覆盖 extension/host/manifest/install.sh/README×2/chrome-mock，不含 shared，故 shared 的 0.1.0 与钉版 0.1.3 的 skew 无门禁也无告警。
- **影响**：读者会误以为 shared 有版本常量契约（且已漂到 0.1.0），实际是无人消费的死声明；手写 .d.ts 与 tsc 生成的声明并存也埋着「改了 index.ts 但声明没跟」的未来陷阱。无运行时影响。
- **修法**：直接删除 packages/shared/src/index.d.ts（一行 git rm）；若想保留版本信号，不如把 shared/package.json version 并入 check-version.mjs 的 spots。
- **证伪记录**：verdict refuted=false 且指出比发现所述还略严重（.d.ts 与 index.ts 完全脱节、全仓零引用、版本 skew 无门禁）。

### #22 SW/panel 消息路径仍大量 as any，与 protocol.ts 自述「panel 侧不再 as any 消费」的直接承诺相悖（P3；quality-standards）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/packages/shared/src/protocol.ts:324
- **证据**：protocol.ts:324 注释宣称「r33：收窄消息面，panel 侧不再 as any 消费」，但 apps/extension/src/sidepanel/App.tsx:160 `const foreignAdopt = (m: any, ...)`、App.tsx:683 `if ((m as any).code === 'read-fail' ...)` 仍在 as any 消费合成帧；sw.ts:374 `handleMessage(msg: any)` 未用 shared 已定义的 ExtToHost 判别联合，sw.ts:511 `(msg.msg as any)?.t === 'list-agents'`、sw.ts:581 `const msg = m as any`。源码（非测试）any/as 共 31 处，其中 catch(e:any) 与 chrome shim 约 15 处属可接受惯例，剩余 ~16 处集中在消息消费路径。
- **影响**：消息帧类型是 host↔SW↔panel 三方的核心契约，契约类型已写好却被绕过，等于 protocol.ts 324 行类型资产对最复杂的数据流（NM 直通帧、read-fail 恢复、agents 缓存 merge）不生效；拼写错字段名（如 `ref` vs `path`）编译期不报、运行时静默失联。r33 立的标准被后续 r5x 修复轮侵蚀，属自我纪律漂移。
- **修法**：分两步：①handleMessage 参数改 `ExtToHost`，switch 判别收窄删掉 374/511 两处 any；②为 host→panel 合成帧在 protocol.ts 补判别联合（read-fail 等），替换 App.tsx:160/683 与 sw.ts:581。约半天工作量，配 #10 的 typecheck 门禁后不再回退。
- **证伪记录**：verdict refuted=false：引用逐条亲读属实（protocol.ts:324 注释存在、五处 as any 消费点逐一核实）。

### #23 CLI 登录态在面板侧零前置信号：未登录用户的首次总结必经一轮完整失败才知道要登录（P3；user-walkthrough）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/packages/host/src/agents/registry.ts:91-108
- **证据**：探测仅 `--version`（无需登录）即标 available；SummarizeView.tsx:1256-1265 Placeholder 文案「终端安装并登录」仅一行，装完点「重试检测」即绿；登录缺失只能在首次 spawn 后靠 App.tsx:1026-1031 authHint 归一化提示兜底；install.ts:147 的 💡 登录提示只覆盖终端侧输出。
- **影响**：persona (b)（CLI 概念模糊）从 Placeholder 复制 claude 安装命令装完、点重试检测看到 available、点「深度总结本页」，然后等一个完整 CLI 冷启周期才收到错误气泡——首次啊哈时刻被推迟一整轮，且失败发生在最脆弱的首旅程。
- **修法**：低成本：在 ModelDropdown 的 note（SummarizeView.tsx:508-515 已有机制）对探测到但未确认登录态的 CLI 标「登录态未确认」；或 Placeholder「安装后点重试检测」旁补一句「装完先在终端跑一次 claude/codex 完成登录再点」。高成本可选：list-agents 探测时顺带检查 ~/.claude/.credentials.json 等凭据文件存在性。
- **证伪记录**：verdict refuted=false：证据全部属实（探测只 resolveBin + --version、二进制存在即 available:true、Placeholder 命令均不完成登录、「装完点重试检测即绿」成立）。

### #24 历史默认保留 200 条对日 30 次用户约一周触顶，prune 永久删除且触顶提示只在历史页可见（P3；user-walkthrough）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/apps/extension/src/sidepanel/SummarizeView.tsx:69-72
- **证据**：默认 200（<10 回落 200）；task.ts:556 每次首轮落盘后 pruneHistory（注释明确失败静默，返回值被丢弃）；history.ts:240-256 对超限最旧文件 unlink 永久删除且返回 removed 计数；触顶提示「已达保留上限…更早的已自动清理」确仅在 HistoryView.tsx:318-326（用户主动进历史页才可见）；Settings.tsx:752 只警告「调低会清理」，无「正在逼近上限」感知。
- **影响**：persona (c)（日 30 次总结+追问、历史回查频繁）第 7 天起最旧记录在下一次保存时被无提示永久删除；用户若不常开历史页，两周后回查三周前的总结会发现根本不存在，且不知道这是可调的——「历史回查」这一重度核心动作的信任被静默侵蚀。
- **修法**：SW 侧在 pruneHistory 实际删掉文件（返回 removed>0，host 已有该返回值）且属首次触顶时，随 task-done 带一次性标志，面板在完成气泡下方给一条可点击跳设置的单次提示「已达保留上限 200 条，最早的部分已被清理——可调大」；或直接把默认提到 500（落盘是本地 md，成本仅磁盘）。
- **证伪记录**：verdict refuted=false：证据逐条属实（默认值/回落逻辑、prune 失败静默、unlink 永久删除、触顶提示仅历史页可见）。

---

## 已否决（对抗核实未通过）

### ×host wrapper 钉死 node 绝对路径，nvm 用户升级/卸载旧版本后 NM 静默死亡且引导绕远路（pain-fit）

否决理由：引用属实但推理链断裂——nvm 卸旧版时 npm 全局树（~/.nvm/versions/node/vX.Y.Z/lib/node_modules）整体删除，不仅 wrapper 钉死的 node 死链，hostEntry（install.ts:68 由 import.meta.url 解析）与 ai-page-dive 二进制同时死亡。「实际只需重建 wrapper」不成立：fix ① 的候选修复路径在 nvm 卸载场景下无差别失效，发现描述的「轻量自愈」前提不存在，剩余场景（仅换默认 node 版本）与已文档化的安装器行为重叠。

### ×面板重开补发的错误终局气泡（missedErrBubble）仍拼接 host 原始英文 message，与 r52 修过的实时 task-error 分支口径不一致（ux-professionalism）

否决理由：核心前提不成立。发现声称 missedErrBubble 与实时 task-error 分支「口径不一致」，但亲读 App.tsx 证实：实时分支只有 timeout 一个 code 做了英文原文移入 console.debug 的特殊处理（:584/:601-604），其余所有 code 走的兜底是 `:610` 的 `${ERROR_LABEL[...]}${message 拼接}` 同款模板——两条路径对非 timeout code 的口径本就一致，不存在「一处修了一处没修」的分裂。

---

## 本轮盲区（完整性批判，下轮该看）

1. r56 盲区第 1 条（install.sh 换 ID/升级再入幂等性）本轮仍未被任何维度覆盖——扩展 ID 变更后 NM manifest allowed_origins 更新路径依旧是空白。
2. workflows.ts/skills.ts 的名称→磁盘路径映射（`../` 穿越、绝对名）与内容直接拼进 prompt 的第二注入面：r56 盲区第 2 条，本轮仍无人对账。
3. codex 适配器对称性依旧未证伪：本轮发现仍集中在 claude 路径（#12 resume 白名单、#2 prompt 断言），codex 侧同构路径（运行内失败信号、终局清理、resume 白名单语义）连续第三轮处于「未验证」状态。
4. optional_host_permissions「始终允许读取网页」开关授予/回收的提取路径行为（r56 盲区第 4 条）未被本轮任何发现触及。
5. #4/#14 修法落地后的 lastTerminals 收件箱语义需要一次整体设计复核（哪些终局入箱、owner 如何定、双写幂等边界）——本轮只按缺陷逐条给修法，未做收件箱不变式的全局规约。
6. dev harness（chrome-mock.ts）与真实 SW 语义的漂移锚定（r56 盲区第 3 条）依旧无测试网。

---

## 处置建议（修复顺序）

1. **用户动作（立刻）**：`npm publish` 0.1.3——解除 #1 的新用户 ETARGET 与 main CI 恒红；这是连续第二轮把「发版」列为第一优先级，发版流程应改为「先 publish 再合钉版提交」。
2. **host 批**：#12 resume prompt 加一行「源文件已清理」指令（一行改动，收益大）；#9 workflow-file 帧加 truncated 标志；#2 buildPrompt 贯通 truncated 条件文案；#6 删 filePathInPrompt 死分支（与 #20 注释瘦身同做，host 行数从贴线回落）；#18 uninstall existsSync 计数修正；#21 git rm shared/index.d.ts。
3. **ext 批**：#4 cancelCurrent/onDisconnect 终局入箱 + SW 回归测试；#14 mismatch 帧补 tabId 邮戳（与 #4 同族同修）；#5 StreamMarkdown 截断文案如实化；#15 复制失败反馈对齐 Onboarding；#3 shadow-DOM 双启发式兜底；#8 host 升级软提示横幅；#19 ctxAnchor 随 sessions 持久化来源页；#24 prune 触顶单次提示；#13 超时档位（可延后）。
4. **docs 批**：#6 PRIVACY agent-workspace 如实化（与 host 批死分支删除配套）；#16 storage 权限表/localStorage 落盘面补全；#17 CLI 配置文件读取披露；#7 README 卸载指引改顺序优先（先 `ai-page-dive uninstall` 再 npm uninstall）。
5. **门禁批**：#10 extension typecheck 进 CI（先于 #22 落地防回退）；#22 消息路径 as any 分两步收窄；#11 e2e 脚本路径参数化（chromium 缓存失效即回归网断）；#20 注释瘦身恢复行数余量。
