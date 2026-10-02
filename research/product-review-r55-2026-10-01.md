# 产品多维严苛 Review — r55（2026-10-01）

## 执行摘要

确认 15 项：P1×2 / P2×2 / P3×11。最要紧的一件事：**全部安装入口钉死的 @0.1.3 在 npm registry 不存在——新用户照文档主路径安装必然 E404，首跑失败直接打脸「钉版本」这一头号信任动作**（#12；伴生 P1 #15：r53/r54 待提交批击穿 host 行数红线，`pnpm test` 门禁当场红，修复批自身失去验证通道）。另两条 P2 均为隐私/可靠性叙事缺口（PRIVACY 落盘清单漏 ~/.claude/projects 会话留档、扩展自动更新 mid-task 零交代）。

## 方法与规模

r54 之后的增量深审：五维度（定位与竞品 / 核心使用流 / 隐私叙事 / 可靠性 / 文档与支持面 + v1 边界架构债），逐发现单怀疑者对抗驳斥 + 主会话亲核（源码行号、npm registry 实查、本机 ~/.claude 与 ~/.ai-page-dive 目录实测、check-host-lines 实跑）。原始发现 15 → 确认 15 / 驳回 0（证伪记录见 verdict，全部 refuted=false、severity keep）。

---

## 确认缺陷清单

### 维度一：产品定位与竞品（value）

#### #1 付费意愿锚只讲「不额外收费」，不讲「消耗订阅既有额度」——重度用户挤占编码 rate limit 的意外未在获客面披露（P3）
- **证据**：README.md:51-53 FAQ「会不会碰我的 CLI 凭证或订阅？」只答「不碰 token、不代理流量、不对 CLI 用量额外收费」，全文无「额度/rate limit/计入」任何表述。但一次 deep 档 ≈5 万 tokens（extract.ts MAX_CONTENT=200k 字符，r54 盲区③量化）、humanize ≈2 倍，全部计入 Claude Pro/Codex 的 5 小时/周 rate limit——目标用户（拿 CLI 写码的开发者）被 PageDive 烧掉编码额度时会觉得被误导。面板内已有披露（SummarizeView.tsx:1187-1188「≈X万 tokens（用量计入你的 CLI 订阅）」），但 README 是获客与预期管理主面，恰缺这一句。
- **修法**：该 FAQ 补一句「总结用量计入你 CLI 订阅的既有额度（rate limit），重度使用可能挤占编码配额——面板会实时显示每次估算 tokens」。
- **证伪记录**：证据全部属实且问题仍在；git log 确认 r51-r54 的 README 变更均未触及该 FAQ。面板内已有兜底，P3 恰当。

#### #2 「为什么是 PageDive」四条卖点无一把核心差异（深读质量）放首位——在自家最弱比较点上与免费原生方案对撞（P3）
- **证据**：README.md:16-21 四条卖点顺序为：开箱即用 / 只信本机 / 点到哪读到哪 / 持续可玩——前三条（零配置、隐私、轻量）恰是浏览器原生摘要免费占优的维度，真正的护城河「agent 式多步深读 + workflow 可插拔 + 多轮追问」只在第 4 条带过。而产品自身高频档之一 quick 是「抓要点约十几秒」（SummarizeView.tsx:1282），与原生浅摘要正面同质却烧付费 tokens。差异化主张在 README FAQ:71 有准确表述，但首屏「为什么装」的排序没有传达它——尝鲜用户会用 quick 档对比原生浅摘要然后流失。
- **修法**：「为什么是 PageDive」首条改为深读能力（agent 通读全文、可追问、workflow 可插拔、多引擎），零配置/隐私类卖点后置为支撑项，与 FAQ:71 同谱。
- **证伪记录**：三处证据核实属实。削弱因素：AGENTS.md v1 Priority 明文「零配置 + 深度总结质量」，零配置居首与项目自身拍板一致，且「用户流失」机制属推测——但不动摇「首屏未传达核心差异」这一可验证事实。P3 恰当。

#### #3 「开箱即用」bullet 标题是 r51 已定性的「零配置」名实不符残留（P3）
- **证据**：README.md:18 第一个卖点标题「**开箱即用**」。r51（commit e8c1880）已把首屏「零配置」改为「零账号·零 API key」并定性为 P1 名实相符问题（实际安装链：CWS 上线前需 git clone + pnpm build、curl|sh 装本机组件、无 Node 时 brew 兜底 5-15 分钟、装完须 ⌘Q 完全重启 Chrome——install.sh:65 实证）。tagline（README:12）已改口径，bullet 标题漏网，延续同一名实 gap。
- **修法**：bullet 标题改为「零账号 · 零 API key」与 tagline/e8c1880 口径统一，正文保留「一次终端命令装好本机组件」的如实描述。
- **证伪记录**：README:18 现存原文 + :12 tagline 已改双证；与 r51 已拍板的修复方向直接冲突，真实残留而非 speculative。P3 恰当（bullet 正文「无账号、无 API key」本身如实）。

### 维度二：核心使用流体验（core-ux）

#### #4 追问轮 tips 条「正在分享「页面标题」」是进行时谎言——追问不提取任何页面内容，页内导航后展示的是从未分享过的新页（P3）
- **证据**：追问轮零提取：sw.ts:671-681 startFollowUp 不走 extractBest，正文空串（'follow-up' extractor、approxTokens:0），上下文全在 CLI 会话里。但 PageTips 文案 `idle ? '已就绪' : '正在分享'「{title}」`（SummarizeView.tsx:1179）只要 messages 非空就宣称「正在分享」。r44-audit F3 只修了 idle 态，追问态同款谎言漏修。更尖锐的组合：锚定页签内导航（sw.ts:285-295 发 page-meta 刷新）后 tips 显示新页标题「正在分享」，追问实际继续的是旧页会话——用户问「这一章说了什么」期待当前页，得到旧页答案且无从察觉。同排技能 chip 有 resume 降透明 + 准确 title 解释，分享声明却没有任何限定。
- **修法**：hasSession 时文案改为非进行时（如「对话上下文：{title}（追问不重读页面）」），与技能 chip 的 dimmed+title 同谱。
- **证伪记录**：四点证据（startFollowUp 构造、:1179 原文、tabs.onUpdated 推新 page-meta、技能 chip 对照）逐条核实；r51-r54 修复未触及。违背「上下文透明」卖点但不泄数据不阻断功能，P3 恰当。

#### #5 全部 CLI 停用/未装且有草稿时，发送按钮可点但点击零反馈——键盘路径有提示，鼠标路径是死按钮（P3）
- **证据**：按钮 disabled 条件 `!running && ((pageUnsupported && !hasSession) || (!usableCount && !input.trim() && !attachCount))`（SummarizeView.tsx:1125）：usableCount=0 但有草稿时按钮启用。点击 → send() 首守卫直接 return（:289）——无气泡、无 hint、无状态变化。对照 Enter 路径同条件有 flashHint('先安装或启用一个 CLI，再开始总结')（:1100-1103），鼠标主路径反而静默。r46 收口「必败请求前置拦截」时只覆盖了键盘与 disabled 态的并集，漏了「enabled 但 send 守卫拦」的交集。
- **修法**：send() 守卫命中 `!usable.length` 时 return 前调 flashHint 同款文案（或把 disabled 条件对齐 Enter 拦截条件）。
- **证伪记录**：disabled 放行 + 裸 return + Enter 对照三处核实；场景边缘（全部 CLI 停用且留有草稿）、不伤核心价值，P3 恰当。

### 维度三：隐私与安全叙事一致性（privacy）

#### #6 PRIVACY「存储位置」清单漏掉最大一块落盘：claude CLI 在 ~/.claude/projects/ 下为每次总结留存完整会话 transcript（含整页正文副本），卸载指引删 ~/.ai-page-dive/ 后仍永不清理（P2）
- **证据**：PRIVACY.md:18-23「存储位置（全部在本机）」仅列 ~/.ai-page-dive/{history,workflows,skills,attachments}、系统临时目录、Chrome session storage。但 task.ts:22-26 把 CLI cwd 固定在 ~/.ai-page-dive/agent-workspace（stableCwd），claude -p 会按 cwd 在 ~/.claude/projects/<cwd-slug>/ 落会话 jsonl。本机实证：~/.claude/projects/-Users-apple--ai-page-dive-agent-workspace/ 存在，113 个会话文件共 9.4MB，抽样最大文件 4 行 >20k 字符、最大一行 131,001 字符的 user tool_result 内容即网页正文。README.md:89 卸载 FAQ 指引「历史记录与自定义 workflow 保留在 ~/.ai-page-dive/，不需要可手动删除」——用户照做删除后，每一页读过的正文完整副本仍留在 CLI 会话留档里，且 PageDive 无任何清理出口。PRIVACY.md:15 只兜了传输面，兜不住「本机落盘清单声称完整却不完整」的叙事缺口。
- **修法**：PRIVACY.md 存储清单补一行「CLI 自身会话留档：claude 会把每次会话（含完整正文）存入 ~/.claude/projects/ 下 agent-workspace 对应目录，生命周期由 CLI 决定、PageDive 不清理」；README 卸载 FAQ 同步提示；设置页「数据」tab 可加一键跳转该目录。
- **证伪记录**：PRIVACY grep 零命中 + getStableAgentCwd 直读 + 本机 113 文件 9.4MB 实证；r52「卸载链路」修的是 preuninstall NM 注册而非 CLI 留档。数据仍全在本机非外泄，P2 恰当。

#### #7 agent-workspace（stableCwd）未列入任何存储清单，host 对其内容零清理零上限——CLI 可写任意产物且用户不知此目录存在（P3）
- **证据**：task.ts:24-26 创建 ~/.ai-page-dive/agent-workspace 作为永不删除的 resume 锚点（cleanupCwd:445-450 显式豁免）；PRIVACY.md:18-23 存储清单不含它。本机实证其内残留 13 条附件软链（修复前产生，r53 #8 的清扫只在新任务带附件时触发）。该目录由不可信网页内容驱动的 CLI 进程作为 cwd 任意写入，PRIVACY 读者无从知晓其存在、用途与内容不可预测。
- **修法**：PRIVACY 存储清单补「agent-workspace：CLI 固定工作区（会话恢复锚点），内容由 CLI 自行写入」一句（可与 #6 合并修改）。
- **证伪记录**：mkdir + 显式豁免 + 清单不含 + 本机 13 条软链实证；r53 #8 只修了 symlink 累积重建。叙事透明度缺口而非凭证/外泄伤害，P3 恰当。

#### #8 「CLI 运行临时文件：任务结束后定时清理」名实不符——11 分钟 unref timer 在 host 常规退出下基本从不执行，实际清理是「下次使用时补扫 >1h 旧文件」，停用后正文无限期留存 /tmp/pagedive（P3）
- **证据**：PRIVACY.md:22 承诺「系统临时目录（任务结束后定时清理）」。tmpfile.ts:24-26 注释自认「host 常规退出远早于 11min unref timer——正文/附件 md 在 /tmp/pagedive 无限累积」；scheduleCleanup 的 timer 被 unref、host 是 per-connection 短命进程（SW 断连即退），timer 基本跑不到；真正生效的兜底是 sweep——仅在下次 host 启动且首次写文件时清理 >1h 旧文件。用户总结一次后停止使用，网页正文在 /tmp/pagedive 无限期留存（依赖 macOS 约 3 天的 /tmp 重启清理）。
- **修法**：PRIVACY 措辞收敛为「任务结束后清理；异常残留的旧文件在下次使用时补扫」；或干脆在任务终局即删正文文件——CLI 已读取完毕，11 分钟等待窗口的必要性本身就存疑。
- **证伪记录**：task.ts:193 调度 + tmpfile 注释自认 + sweep 机制三证核实；两文件最近改动停在 bdeba36，r51-r54 未触及。文件 0o600/目录 0o700，泄露面限同 uid 本机进程，不击穿「内容不出本机」，P3 恰当。

#### #9 ~/.ai-page-dive 根目录与 agent-workspace 创建不带 mode（落成 0755）——历史/附件文件名（含页面 slug）可被同机其他用户列读，与 workflows/skills 子目录特意 0o700 的口径分裂（P3）
- **证据**：task.ts:25 mkdir 无 mode；history.ts:314 mkdirSync(ROOT) 无 mode；而同仓 history.ts:95（注释明确 r10 0700 防 slug 枚举）、task.ts:133（附件目录）、workflows.ts:120、skills.ts:68 均显式 mode:0o700。本机实测 ~/.ai-page-dive 及其 history/agent-workspace/attachments 子目录全部 drwxr-xr-x（755）。文件内容已有 0600 保护，但历史 md 文件名含时间戳+页面 slug、附件名含用户命名，755 目录下同机其他 uid 可全量列读。
- **修法**：task.ts:25 与 history.ts:314（及 history 首写路径的各级 mkdir）补 mode:0o700，与 workflows/skills 对齐；顺手对本机既有目录 chmod 收敛。
- **证伪记录**：无 mode 的两处 + 同仓四处有 mode 的口径分裂 + 本机 755 实测；git log 与 r51-r54 报告均无修复记录。内容已有 0600、威胁模型限同机多用户边缘场景，P3 恰当。

### 维度四：可靠性与故障恢复（reliability）

#### #10 扩展自动更新/SW 崩溃 mid-task 是升级矩阵中唯一零交代的通道：面板重开后任务凭空蒸发、追问会话同灭（P2）
- **证据**：sw.ts:30-42 currentTask 纯内存、从不进 persistSession（:83 序列化清单无它）；sw.ts:660-669 onDisconnect 只广播 __host-disconnected，不写 lastTerminals（:60 收件箱类型只有 task-error）。ext/host/CLI 三方升级里 host 更新有 MIN_HOST_VERSION 横幅、CLI 更新有 unrecognized 计数链，唯独扩展自身更新（CWS 自动推送，深度任务 2-10 分钟窗口内必然渐次命中全量用户）路径是：SW 被杀 → NM port 关 → host shutdown（persist('interrupted') 落盘）→ host 侧 cancel 链发出的 task-error('cancelled') 因 port 已死不可达 → 旧 SW 已死无人写收件箱 → storage.session 随扩展 reload 被 Chrome 清空。用户侧：正在流的对话页整页 reload，重开 panel-ready 无 missedTerminal/activeTask/sessions 任何痕迹，追问再发即 session-lost。磁盘上历史是 interrupted 记录，但面板零指路。
- **修法**：任务起跑时把 {taskId, tabId, startedAt} 写 storage.local（跨扩展更新存活），SW 冷启动 restoreSession 时发现孤儿 runningTask 且新 NM 连接无此任务 → 合成 lastTerminals 条目「扩展已更新/重启，上一轮任务中断——完整进度见历史」，终局时清除该指针。
- **证伪记录**：五点证据逐条核实（persistSession 清单、onDisconnect 行为、收件箱类型、storage.session 生命周期、面板重开路径全空）。r53/r54 修的 lastTerminals 收件箱与冷启动竞态均以 storage.session 为载体——恰是扩展更新时被整体清空的层，未覆盖本通道。CWS 推送 + 2-10 分钟窗口会渐次命中全量用户但每次发版一轮，P2 合理。

#### #11 'nm' 通用转发无 frameTooLarge 门禁：>1MB workflow-save 触发 host 判失步自杀，连坐收割在跑任务（P3）
- **证据**：sw.ts:493 `return { ok: nmPort.send(msg.msg as ExtToHost) }` 对面板发来的任意帧直发，无体积检查；对照 task-start 三处均有 frameTooLarge 门禁（:543 定义、:684 追问轮、:828 首轮）。而 host 侧收帧是 createFrameReader(handle, NM_MAX, shutdown)——帧头声明长度 >1MB 即判协议失步、走 shutdown 收割全部在跑任务再退出。用户在 Settings 工作流编辑器（Settings.tsx:294 的 workflow-save 携带任意大小 editor.body，保存前无体积校验）粘贴超大正文点保存的瞬间，另一页签正在跑的深度总结被无交代收割。
- **修法**：handleMessage 的 'nm' 分支对含大体量字段的帧（至少 workflow-save 的 content）先过 frameTooLarge，超限回 { error: 'frame-too-large' } 由面板给「工作流正文过大」提示，不发往 host。
- **证伪记录**：直发无检查 + frameTooLarge 仅两处使用 + host 侧失步收割 + 触发入口真实四证核实。边缘操作 + 可重试自愈，P3 恰当。

### 维度五：文档与支持面（docs）

#### #12 全部安装入口钉死的 @0.1.3 在 npm registry 不存在——新用户照文档安装必然 E404（P1）
- **证据**：npm registry 实查（registry.npmjs.org/@aaione/ai-page-dive）：dist-tags latest=0.1.2，versions=["0.1.2"]，0.1.3 从未发布。而仓库四处钉 @0.1.3：README.md:35（curl|sh 信任卖点「钉版本安装（@0.1.3）」）、README.md:44（手动备选命令）、install.sh:43（`npm i -g @aaione/ai-page-dive@0.1.3`，curl|sh 主路径，:43-49 对安装失败硬 exit 1 无版本兜底）、packages/host/README.md:10；扩展面板命令与升级横幅也动态取 manifest 版本 0.1.3（Onboarding.tsx:11 npmCmd、sw.ts:390）。README:27 当前安装路径就是「手动加载 + 跑 install.sh」——任何新用户今天照文档走主路径即 E404 首跑失败，且恰好打脸「钉版本」这个被 FAQ 安全叙事反复引用的头号信任动作（README.md:65）。根因是 check-version 门禁只断言「文档钉版 == manifest 版本」，不断言「== registry 已发布版本」，本地 bump 后发布脱节即全绿通过。
- **修法**：立即 `npm publish` 0.1.3（或文档+manifest 整体回滚到 0.1.2），并在 scripts/check-version.mjs 加一条 registry 存在性断言（fetch dist-tags 比对钉版），把「钉版必须已发布」变成发版前 CI 红灯。
- **证伪记录**：registry 实查 + 四处钉版直读 + install.sh 硬 exit + 门禁断言缺口，全部实证。r51-r54 无 publish 或回滚动作，最近提交反而在扩大 @0.1.3 钉版面。主安装路径全量新用户阻断 + 打脸信任叙事，P1 成立。

#### #13 README 开发者节测试描述与实际测试面严重不符（P3）
- **证据**：README.md:99 写「测试：vitest 覆盖 host 流解析器 / buildArgs / 历史轮切分」；实际 AGENTS.md 自述 139 用例，已含 SW 回归网（chrome shim 锚 session-lost 竞态/断连清理）、pgid 收割链/runNative 关停集成、workflow-labels、extract 等（r52 128→139 落地，commit 157a229）。README 是贡献者第一入口，测试面描述停在 r51 之前的状态，低估了回归防护面（SW 回归网正是 r52 P1 竞态的防再犯资产）。
- **修法**：README:99 改为与 AGENTS.md 同口径一句（或直接「见 AGENTS.md 测试说明」引用，单源防再漂）。
- **证伪记录**：两文档口径漂移直读核实，commit 157a229 后 README 未同步。纯贡献者文档滞后，P3 恰当。

#### #14 用户主文档零排障/反馈入口——支持闭环只藏在 Settings 深处（P3）
- **证据**：grep 实证 README.md 全文 0 处 issues/排障/反馈字样；反馈渠道只存在于 Settings 页底部（Settings.tsx:828 GitHub Issues 按钮）与 PRIVACY.md:43；install.sh:69 仅硬失败分支提一句。README FAQ 覆盖了隐私/对比/卸载，唯独没有「装完重启 Chrome 仍连不上 / 总结失败怎么办」的排障条目（install.sh:65 的「完全退出 Chrome（⌘Q）后重开」这一最常见卡点在 README 完全缺席）——新用户在最易流失的安装受挫时刻，主文档无路可走。
- **修法**：README FAQ 末尾补一条「遇到问题？」：指到 GitHub Issues + 两条最常见排查（完全退出 Chrome 重开、install 命令幂等可重跑），与 Settings/PRIVACY 的出口形成闭环。
- **证伪记录**：README grep 零命中 + FAQ 七条无排障 + 卡点只在 install.sh:65，全部核实；当前 HEAD 157a229 仍是此状态。补一条 FAQ 即修，P3 恰当。

### 维度六：v1 边界与架构债（roadmap）

#### #15 硬约束 5 红线已被待提交的 r53/r54 修复批击穿：host 运行时 2262 ≥ 2200，`pnpm test` 门禁当场红，任务 #22（提交）无法绿着落地（P1）
- **证据**：实跑 `node scripts/check-host-lines.mjs` 输出 ⛔ 2262 ≥ 2200；HEAD（已提交 main@157a229）为 2161（git ls-tree 逐文件 wc 复核，剔除 src/scripts/），即红线余量仅 39 行，而本批 host 侧净增 ~101 行（git diff --numstat：history.ts +41、task.ts +26、stdio.ts +11、codex.ts +11）。CI 两条腿（.github/workflows/ci.yml:36,47）都把该脚本设为硬门禁，且 package.json:7 `test` 脚本里它排在 vitest 之前——红线红 = 139 个测试都无法经 `pnpm test` 运行，修复批自身失去验证通道。更结构性的是：破线来源全是 r53/r54 的防御性加固（删历史连带附件、stdio default 回帧、MCP 封死），没有一行是新功能——DECISIONS.md:35 的处方「再破线时删功能或删注释」与「每轮深审必然 +50~100 行加固」的现实直接冲突，且行数趋势 1849→1956→2039→2161→2262 每轮净增约 40-100，这条线在下一个修复轮还会再破。
- **修法**：立即做架构决策而非临时绕过：按既定处方在本批内兑现「删或移」——把 host/src 中一次性/非 NM 主循环代码继续下沉 scripts/（沿用 install.ts 先例）、压缩 task.ts/history.ts 的多行叙事注释为单行（r52-r54 每修一处留一段事故注解是行数大头），并给红线加「余量 < 50 行时 CI 提前黄线警告」的缓冲机制。
- **证伪记录**：git stash 前后实跑对照（2262 ⛔ / 2161 ✅）实锤破线由待提交批造成；AGENTS.md 硬约束 5 明文「违反即 bug」「再破线删功能不抬阈值」。项目自我定义的架构红线击穿 + 修复批失去验证通道，P1 成立。

---

## 证伪剔除

本轮 15 项原始发现经单怀疑者对抗驳斥后全部存活（refuted=false、severity keep），无剔除项。各确认项的证伪核查摘要已附于条目内（证据核实路径：源码行号直读 / npm registry 实查 / 本机目录实测 / check-host-lines 实跑 / git log 与 r51-r54 报告 grep 交叉）。

## 建议行动顺序

1. **P1 两项立即**：#12 npm publish 0.1.3（或回滚钉版）+ check-version 加 registry 断言；#15 本批内兑现「删或移」让红线回绿——二者共同解锁「修复批可提交、可验证」的前提
2. **P2 两项**：#6+#7 PRIVACY 存储清单一并补全（claude transcript + agent-workspace，一次修改）；#10 storage.local 孤儿任务指针 + restoreSession 合成提示
3. **P3 文案族一批摘**：#1/#2/#3（README 获客面三处）、#4（tips 文案）、#13/#14（README 开发者节 + 排障 FAQ）
4. **P3 机制族**：#5（send 守卫 flashHint）、#8（PRIVACY 措辞或终局即删）、#9（mkdir 补 0o700）、#11（'nm' 分支过 frameTooLarge）
