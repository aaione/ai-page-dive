# 产品多维严苛 Review — r56（2026-10-03）

## 执行摘要

r55 十五项修完后的复盘轮。原始发现 26 → 对抗核实确认 24 / 否决 2 → 跨维去重合并 **16 项：P1×2 / P2×3 / P3×11**。最扎眼的结构性事实：**16 项里 9 项是「r55 修而未尽」或 r55 修复本身引入**——上轮修复批在收尾质量上出了系统性问题，而不是新领域出了新问题：

- **#1**：发版动作（`npm publish` 0.1.3）至今未做——新用户主安装路径照旧 E404，且 b2ecf83 新加的 check-published 是 push main 硬门禁，main 的 CI 自 10-01 起恒红，「CI 绿=可合」信号已废（这是用户手动动作，门禁设计如此）。
- **#2**：「终局即删」漏了 is_error 与「超时但已交付」两条终局——is_error（配额超限/鉴权失败/context 超长）恰是 claude 最高频失败通道，PRIVACY 同批强化的「任务结束即删」在主失败路径上为假。
- **#3**：r55 #7 的 PRIVACY 文案把「永不删除的 resume 锚点」反写成「任务结束清理」，四个维度同时命中。

新独立发现里最要紧：**#4**（startSummarize 注入/提取失败路径无条件置 currentTask=null，跨窗口并发清他人句柄，r55 #10 的 ext-restarted 会误报已完结任务）与 **#5**（readFmHead 只读 4KB 无回退——页面可控的超长 title/url 撑爆 frontmatter 后追问轮静默不落盘、删历史连带删附件静默失效）。

## 方法与规模

Workflow 编排（r56-deep-review，35 agents / 308 次工具调用 / 146 万 tokens / 11 分钟）：8 维并行查找（host 核心 / SW 后台 / 侧边栏 UI / 内容提取+shared+manifest / 安全隐私 / 文档一致性 / CI 打包 / r55 四提交回归）→ 每项发现独立怀疑论者对抗核实（场景不可达 / 调用方已守护 / DECISIONS.md 已拍板即否决，severity 就地校准）→ 完整性批判找盲区。核实确认 24 / 否决 2；主会话跨维去重（同一问题被 2-4 个维度同时命中）合并为 16 项，severity 取组内最高，证据取最详。

---

## 确认缺陷清单（按严重度）

### #1 r55 #12「修而未尽」：钉版门禁落地但 npm publish 至今未做——@0.1.3 在 registry 仍不存在，新用户主安装路径照旧 E404，且 check-published 是 push main 硬门禁、main 的 CI 自 b2ecf83 起必红（P1；多维交叉命中：docs-accuracy + security-privacy + ci-packaging）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/scripts/check-published.mjs:1
- **证据**：本机实跑 `node scripts/check-published.mjs` 输出「✗ 仓库钉 0.1.3 未发布（registry latest = 0.1.2）」exit 1；`npm view @aaione/ai-page-dive versions` = ["0.1.2"]，0.1.3 从未发布。r55 #12 的修复是 commit b2ecf83 加 CI 门禁（.github/workflows/ci.yml:48 `node scripts/check-published.mjs`，push main 必跑），但配套的 `npm publish 0.1.3` 两天后（今日 2026-10-03）仍未执行——门禁自己红了：b2ecf83 之后的每次 main push（含 49f4985）该步必失败，main 处于红 CI 状态。用户操作序列：新用户照 README.md:33 跑 `curl ... | sh -s -- <扩展ID>` → install.sh:43 `npm i -g @aaione/ai-page-dive@0.1.3` → E404 → install.sh:48 exit 1「npm 全局安装失败」——README:36「钉版本安装（@0.1.3），不追 latest」这句信任卖点此刻 install 出的是空气。门禁脚本自己的注释都写明后果：「install.sh 此刻装出旧 host，扩展恒报组件过旧」——实际更糟，是装不出任何 host。
- **修法**：立即 `npm publish` 0.1.3（版本内容已钉死四处于 check-version 门禁，发布零风险）；以后发版流程改为「先 publish 再合钉版提交」，让 check-published 红灯只出现在发版 PR 上而非 main。
- **证伪记录**：全部实证成立：(1) packages/host/package.json:3 钉 0.1.3，npm registry 实查 `npm view @aaione/ai-page-dive versions dist-tags` 仅 ["0.1.2"]、latest=0.1.2，0.1.3 从未发布；(2) 本机实跑 scripts/check-published.mjs 输出「✗ 仓库钉 0.1.3 未发布」exit 1；(3) .github/workflows/ci.yml 22 腿在 push main 与所有 PR 均执行该脚本（r55 #12 注释自述为硬门禁），故 b2ecf83 后每次 main push（含 49f4985）该步必红；(4) install.sh 的 `npm i -g @aaione/ai-page-dive@0.1.3` 对不存在的版本必 E404 并走 exit 1「npm 全局安装失败」分支——README.md:36/45/72 的钉版安装信任卖点对新用户装出的是空气；(5) 非设计取舍：脚本注释自认此态为故障并指示「先 npm publish 再合」，DECISIONS.md 无「先合钉版后补发」的拍板。唯一可辩点（老用户不受影响、门禁变红正是其设计目的——把问题前移到 CI）不改变新用户主安装路径硬失败 + main CI 持续红的事实，P1 校准准确。

### #2 r55 #8「终局即删」修而未尽：claude is_error 与超时已交付两个终局仍漏删正文临时文件，PRIVACY 新承诺「任务结束即删」在这些路径为假（P1；多维交叉命中：host-core + r55-regression）

- **文件**：packages/host/src/task.ts:379
- **证据**：grep 全量枚举 rm(contentFile) 调用点仅 5 处：task.ts:261（spawn 失败）、:270（spawn 窗口取消）、:321（timeout 未交付分支）、:345（child error）、:464（finish）。但 handleEvent 的 is_error 终局（task.ts:379-401：reap→cleanupCwd→persist→onDone，全程无 rm(contentFile)）与 timeout 分支的 gotResultOk 已交付子路径（task.ts:287-309：reap→cleanupCwd→return，同样无 rm）均未覆盖——commit a35d671 信息宣称「5 个终局位（…timeout/运行内错误/正常 finish）补 rm(contentFile)」，其中「运行内错误」在代码里并不存在。用户操作序列：对敏感页面跑 deep 总结 → claude 配额超限/鉴权失败/context 超长 → result.is_error=true 走 379-401 终局 → host 删了 cwd 却留下 /tmp/pagedive/<taskId>-<uuid>.md 全页正文 → SW 断连、短命 host 退出，11min unref timer 跑不到（tmpfile.ts:24-26 自认）→ 若用户此后不再总结，正文无限期留存（仅靠 macOS ~3 天 /tmp 周期）。而同批 docs 提交 49f4985 把 PRIVACY.md:23 强化成绝对化承诺「任务结束即删」（英文版 :9 「deleted the moment the task ends」）——错误终局恰是高频路径（quota/auth），隐私优先产品的正面承诺在主失败通道上为假。
- **修法**：在 is_error 终局（handleEvent）与 timeout gotResultOk 子路径各补一处 if (contentFile) rm(contentFile, {force:true}).catch(()=>{})，并考虑把 rm 收敛进一个终局公共函数防再漏；同时给两条路径补「终局后 /tmp 无残留」锚测试（现有锚测试只覆盖 finish 路径）。
- **证伪记录**：逻辑链每一环经实读代码核实成立。(1) rm(contentFile) 全仓确仅 5 处（task.ts:261/270/321/345/464）；(2) is_error 终局（task.ts:379-401）reap→cleanupCwd→persist→onDone 全程无 rm，且 :381 置 doneSent=true 后，进程 close 事件在 :327 被 finished/doneSent 守卫挡回，finish() 的 :464 rm 永不可达——contentFile 就在 handleEvent 参数（:353）里，属可及而未补；(3) timeout 分支 gotResultOk 已交付子路径 :287-308 提前 return，跳过 :321 的 rm；(4) 兜底时间界：11min unref timer 在短命 host 下失效（tmpfile.ts:24-26 自认），实际靠下次任务 sweep（tmpfile.ts:50，清 >1h 旧文件）或 macOS ~3 天 /tmp 周期，用户停用则正文无限期留存；(5) PRIVACY.md:23「任务结束即删」/ 英文版「deleted the moment the task ends」为同批 49f4985 强化的绝对化承诺，在主失败通道（claude quota/auth/context 超长→is_error，高频路径）为假，commit a35d671 宣称的「运行内错误」终局补删在代码中不存在；(6) 非设计取舍：DECISIONS.md 无相关拍板，测试（task.test.ts:260 is_error 用例、task-timeout.test.ts gotResultOk 用例）均无 /tmp 残留断言。反驳不成立。severity 校准为 P1：rubric 明列「隐私承诺违背」为 P1——隐私是本产品第一卖点，刚强化的公开承诺在最高频失败路径上为假，文件含全页正文留存可达 ~3 天（停用用户无限期）；虽文件 0600/目录 0700 无跨用户暴露、且继续使用时 ≤1h 会被 sweep 回收，但这些只缓释留存时长，不改变「承诺为假」的本质。

### #3 r55 #7 修复引入新谎言：PRIVACY 声称 agent-workspace「任务结束清理」，代码显式豁免该目录永不删除（P2；多维交叉命中：docs-accuracy + host-core + security-privacy + r55-regression）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/PRIVACY.md:21
- **证据**：PRIVACY.md:21 写「供 CLI 读取的任务工作目录（正文/附件符号链接与提示词组装）：~/.ai-page-dive/agent-workspace/（任务结束清理）」，英文 Summary 同句「cleaned up at task end」。代码事实：task.ts:448-452 cleanupCwd 注释明写「固定工作区（stableCwd）不删（后续 resume 要用同 cwd）」，判据 `if (cwd && cwd !== stableCwd)` 把 agent-workspace 显式排除在一切清理之外；spawn 失败路径 task.ts:258-260 同样只删非 stableCwd。目录内仅有的清扫是 task.ts:113-122 的附件软链补扫，且仅在下一个带 agentCwd 的任务启动时触发、判据收窄到 `readlink(lp).startsWith(attRoot)`（指向 ~/.ai-page-dive/attachments 才删）——而 linkIntoCwd（task.ts:565-570）为每个任务在 agent-workspace 创建的正文软链指向 /tmp/pagedive，不在判据内，永不被清。本机实证：~/.ai-page-dive/agent-workspace 现存 12 条条目（9/18-9/22 的软链）。r55 #7 要求的修法是如实披露「会话恢复锚点、内容由 CLI 自行写入」，commit 49f4985 的「PRIVACY 落盘披露补全」却把它写成「任务结束清理」——消费者读隐私政策得出「任务结束该目录就被清掉」的错误结论，正是本轮维度要抓的文档-事实错位。
- **修法**：PRIVACY.md 中英文两处改为如实描述：「固定工作区（追问会话恢复锚点），目录长期保留、不随任务清理；其中的附件软链在下次任务时补扫，正文软链随任务累积」，或干脆在任务终局顺手清掉本轮正文软链后再作此声明。
- **证伪记录**：核心指控成立，但「无界累积」一环被高估。逐环核实：(1) PRIVACY.md:21 确写「任务结束清理」，英文 Summary 同句 "cleaned up at task end"；(2) 代码事实吻合——task.ts:448-452 cleanupCwd 判据 `if (cwd && cwd !== stableCwd)` 显式豁免 stableCwd（注释自认「后续 resume 要用同 cwd」），task.ts:258-260 spawn 失败路径同样只删非 stableCwd，目录永不随任务清理，文档与代码直接矛盾，且该句正是 49f4985「PRIVACY 落盘披露补全」新写进的（把 r55 #7 修成了新谎言）。(3) 但「正文软链无清扫无界累积」在 v1 是死路径：linkIntoCwd（task.ts:566-570）仅在 `def.filePathInPrompt` 存在时调用（task.ts:225-226），而 grep 证实 claude.ts/codex.ts 均未定义 filePathInPrompt（唯一使用者 opencode 已于 D5 删除）——现网每个任务在 agent-workspace 只创建附件软链，且 task.ts:113-122 的下次任务补扫判据 `readlink(lp).startsWith(attRoot)` 恰好覆盖它们。(4) 本机 12 条残留经 readlink 逐条核对全部指向 ~/.ai-page-dive/attachments/（非 /tmp/pagedive），是清扫逻辑落地（85f3dd2，2026-10-02）之前 9/18-9/22 的存量，下次任一任务启动即被补扫删除，且指向目标本就是 PRIVACY 已披露「持久化」的 attachments——无额外数据暴露。结论：真实问题是隐私文档实质不符（承诺清理实为永久保留的 resume 锚点 + 可能残留 CLI 自写内容），消费者会误以为任务结束即清；但无凭证/正文泄露放大情节，累积腿是死代码，残留腿自愈，故维持 P2 不升 P1。

### #4 startSummarize 注入/提取失败路径无条件置 currentTask=null（缺 :852 同 taskId 守卫）——跨窗口并发下清掉他人任务句柄，后续 pdRunningTask 指针既不清也不匹配，r55 #10 的 ext-restarted 折算会误报已完结任务（P2；ext-sw）

- **文件**：apps/extension/src/background/sw.ts:835
- **证据**：代码证据：sw.ts:834-847 两处失败路径（injectErr 块 :835 `currentTask = null`、extract 错误块 :846 `currentTask = null`）都是无条件清空，不校验 currentTask 是否仍属本 taskId；而紧随其后的 :852 `if (!currentTask || currentTask.taskId !== taskId) return { error: 'cancelled', taskId }` 证明代码作者明知该竞态并在此处设防，前两处漏防。r55 新增的 setRunningTask/clearRunningTask 只按「自己任务的生命周期」成对（:559/:620/:693/:702/:731/:906/:876），全部假设 currentTask 归属未变。
逻辑链（用户操作序列）：双窗口各开面板（代码自认的合法形态，:239/:494 注释均按跨窗口双面板设防）——①窗口 A 面板点「总结」，startSummarize 在 :810 占位 currentTask=A 后 await executeScript 注入（重页面可悬停数秒）；②窗口 B 面板点「总结」，:777 cancelCurrent 收割 A、:810 设 currentTask=B，继续自己的注入/提取 await；③A 的注入失败回调此时 resolve（activeTab 过期/页面无法注入等），:835 无条件 currentTask=null——把 B 的句柄清掉。两种结局：(a) B 尚未过 :852 检查 → B 直接收到 error:'cancelled'，用户刚点的总结凭空「已取消」；(b) B 已过 :852 并发出 task-start、:876 setRunningTask(B) → B 任务在 host 真实运行但 SW 侧句柄丢失：心跳门禁 :597-608 `if (currentTask)` 不再转译 task-alive，面板看门狗（App.tsx:968 连丢 6 次心跳判 host/SW 死）在 CLI 实际仍在跑、持续烧订阅额度时误报死亡；cancelCurrent 变 no-op 无法取消，CLI 空跑至超时；pdRunningTask(B) 残留不清，下次 SW 冷启动 restoreSession（:142-145）因 currentTask=null 判 B 为孤儿，折算一条 ext-restarted 终局进收件箱——一个实际已跑完并落盘历史的任务，重开面板时被报「扩展已重启，上一轮任务中断」。这正是「修而未尽」：r55 #10 的指针清理点位没有覆盖「currentTask 被他人路径清空」这一新增竞态面，sw.test.ts 16 个用例也无并发 summarize 场景锚定。
- **修法**：:835/:846 两处在置 null 前补与 :852 同款身份守卫（`if (currentTask?.taskId === taskId) currentTask = null`，仅属自己才清并相应 clearRunningTask；不属自己则只返回自己的错误）；补一个跨窗口并发 summarize 的回归用例（A 注入失败晚于 B 起跑时不得清 B 的句柄、不得残留 pdRunningTask）。
- **证伪记录**：成立。sw.ts:834-847 两处失败路径（:835 injectErr 块、:846 extract 错误块）确为无条件 currentTask = null，而紧随的 :852 `if (!currentTask || currentTask.taskId !== taskId)` 证明作者对同一竞态在别处设防、此处漏防。并发链可达：startSummarize（:774）在 :788/:826/:844 多个 await 点让出，双窗口双面板是代码自认合法形态（:239「跨窗口双面板互不劫持」、:270「双窗口各自开面板是合法形态」），B 窗口 summarize 可在 A 注入 await 期间并发执行 :777 cancelCurrent + :810 置 currentTask=B，A 迟到的注入失败随即清掉 B 的句柄。下游后果逐环核实：①心跳门禁 :597-608 仅在 currentTask 非空时转译 task-alive，句柄丢失后面板看门狗断粮误判 host/SW 死亡；②cancelCurrent（:538-561）以 currentTask 为准，null 时 no-op，B 的 CLI 空跑烧额度至超时；③restoreSession :140-146 因 currentTask=null 且 pdRunningTask 残留，折算 ext-restarted 进收件箱——实际已跑完落盘的任务被误报中断，正是 r55 #10 新增指针机制未覆盖的竞态面。排除设计取舍反驳：:496 cancel 的 taskId 守卫与 :852 均为对同类竞态的主动设防，属修而未尽而非拍板豁免。severity 维持 P2：触发需双窗口并发 summarize + 一方注入/提取延迟失败的窄竞态窗口，非普遍路径破坏，但有烧额度 + 误报终局的用户可感后果。

### #5 readFmHead 只读 4KB 且无全量回退：页面可控的长 title/url 撑爆 frontmatter 头后，追问轮 append 被静默跳过、「删除历史」的附件连带删静默失效（P2；host-core）

- **文件**：packages/host/src/history.ts:142
- **证据**：历史 frontmatter 的 title/url 取原始值落盘（task.ts:535-536 `title: this.input.page.title`，未经 sanitizeMeta——对比 prompt.ts:12 对同一字段的 300/2000 截断；extract.ts:126 `article?.title || document.title` 无上限，document.title 页面完全可控），escapeYaml（history.ts:72-75）还会把引号/反斜杠翻倍膨胀。readFmHead（history.ts:142-151）只读 4KB，splitFrontmatter（frontmatter.ts:5-6）在 4KB 内找不到闭合 `\n---` 即返回 undefined → fm=null。对照 listHistory 路径的 readFrontmatter 有「≤256KB 全量读回退」（history.ts:264-270，注释明言 4KB 内没闭合要兜底），append/delete 共用的 readFmHead 恰恰没有这个回退。后果链：① appendHistoryTurn（history.ts:164-169）把 null 判为「无效历史文件」→ console.error 后 return——首轮标题/URL 合计 >4KB 的页面，后续所有追问轮正文都不落盘，用户多轮对话在历史里只剩首轮，且无任何 UI 信号；② deleteHistory（history.ts:303）attachments 正则匹配不到 → r53 #7 承诺的「删除历史连带删附件正文」静默失效，附件正文在 ~/.ai-page-dive/attachments 永久残留，用户「内容一起删」的心智落空。触发序列：总结一个 document.title 含数千字符（或 URL 超长且高引号密度）的页面 → 追问几轮 → 打开历史发现追问轮缺失 / 删除该历史后附件仍留盘。
- **修法**：给 readFmHead 补与 readFrontmatter 同款的 ≤256KB 全量读回退；或在 task.ts persist 落盘前对 title/url 过 sanitizeMeta 截断（与 prompt 层同信任边界），双保险。
- **证伪记录**：逻辑链全部成立：① extract.ts:126 title 取 document.title 无上限，扩展侧无截断（仅通知标题 slice(0,24)，sw.ts:548）；② task.ts:535-536 saveHistory 取原始 title/url，未经 prompt.ts:24-25 同款的 sanitizeMeta 300/2000 截断，escapeYaml（history.ts:72-75）还会翻倍膨胀；③ readFmHead（history.ts:142-151）只读 4KB 且无回退——对照同文件 readFrontmatter（history.ts:264-270）注释明言「4KB 内没闭合要兜底」并有 ≤256KB 全量读回退，append/delete 共用的 readFmHead 恰好缺失；④ appendHistoryTurn（history.ts:164-169）把 null 判为无效文件后 return，追问轮静默不落盘且无 UI 信号；⑤ deleteHistory（history.ts:303）attachments 正则只作用于 4KB 头，attachments 行排在 title/url 之后（writeNew 顺序 history.ts:119-128），头超限时正则不命中，r53 #7 承诺的附件连带删静默失效，正文残留在 ~/.ai-page-dive/attachments。非设计取舍：r8-review 专门为列表路径补了回退，说明超大 frontmatter 是已知风险，append/delete 属遗漏；测试（history.test.ts）无超大 frontmatter 用例覆盖。修复方向（补回退或 persist 前过 sanitizeMeta）均合理。severity 从 P3 上调至 P2：触发需页面可控的 title/url frontmatter 表示超 4KB（特定场景），但后果是多轮追问静默丢失 + 「删除历史内容一起删」的用户心智/隐私承诺静默违背，超出文案/小体验层级。

### #6 vitest alias '@pagedive/shared' 是包改名前的死键：extension 测试实际加载 shared/dist 构建产物，「测试直接吃 TS 源码，不依赖先 build」承诺失效（P3；ci-packaging）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/vitest.config.ts:16
- **证据**：vitest.config.ts alias key 为 '@pagedive/shared'，全仓 grep 0 个文件 import 该名；真实 import 是 '@ai-page-dive/shared'（apps/extension/src/background/sw.test.ts:19 的 MAX_CHUNK 值导入）。alias 不命中时 vite resolver 走 node_modules symlink → packages/shared/package.json 的 main ./dist/index.js → 而 dist 是 gitignore 的构建产物（git check-ignore 确认）。两条后果链：① fresh clone 后 `pnpm install && pnpm test`（不先 build）vitest 解析失败——CI 22 腿先 `pnpm -r build` 掩盖了这一点，注释「测试直接吃 TS 源码，不依赖先 build」（vitest.config.ts:15）为假；② 更隐蔽的日常态：本地改 packages/shared/src/protocol.ts（如调 MAX_CHUNK）不重 build，跑测试加载的是 stale dist——静默测旧代码，改动不生效也不报错。
- **修法**：alias key 改为 '@ai-page-dive/shared' 指向 packages/shared/src/index.ts，兑现注释承诺；顺带删掉死键避免下个包名再漂。
- **证伪记录**：核实成立。vitest.config.ts:13 的 alias key 确为 '@pagedive/shared'，而全仓 23 个文件（apps/extension/src 与 packages/host/src 全部）import 的都是 '@ai-page-dive/shared'（packages/shared/package.json name 即 '@ai-page-dive/shared'，host/extension 的 workspace 依赖也声明该名）——旧名 0 引用，是包改名后的死键。alias 不命中时 vite resolver 走 node_modules symlink → package.json main ./dist/index.js，而 git check-ignore 确认 dist 是 gitignore 构建产物：后果链两环均成立——① fresh clone 后只跑 `pnpm install && pnpm test` 会解析失败（CI ci.yml:34 先 `pnpm -r build` 掩盖了这一点），vitest.config.ts:12 注释「测试直接吃 TS 源码，不依赖先 build」承诺为假；② 本地 dist 存在（ls 确认），改 shared/src 不重 build 时测试静默加载 stale dist。不是 DECISIONS.md 拍板的设计取舍（查无相关决策），纯属改名遗漏的死键。无用户可感影响、CI 也不被阻断，维持 P3。

### #7 test:smoke:opencode 僵尸脚本：opencode 适配器已删（D5），入口残留在 root package.json（P3；多维交叉命中：ci-packaging + docs-accuracy）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/package.json:9
- **证据**：package.json:9 `"test:smoke:opencode": "node packages/host/scripts/smoke.mjs opencode"`。9b112c9（10-01）删除 opencode 适配器时清了 scripts/e2e-opencode.mjs 并自述「脚本无宿主」，但漏了这个入口。smoke.mjs 全文无 opencode 分支——argv[0] 直接当 agent 名传给 host（smoke.mjs:12 `const [agent = 'claude', ...] = process.argv.slice(2)`），而 host agents registry 只剩 claude/codex。触发序列：贡献者照 scripts 清单跑 `pnpm test:smoke:opencode` → host 收到未知 agentId → 报错或空跑，得到与「opencode 已下架」这一决策相矛盾的困惑体验；DECISIONS.md D5 的恢复条件也没被这个残留入口反映。
- **修法**：删除 package.json 里的 test:smoke:opencode 一行（或在 D5 恢复 opencode 时再加回）。
- **证伪记录**：逻辑链每一环均成立：(1) /Users/apple/work/hs/ai-feature/ai-page-dive/package.json scripts 确有 `"test:smoke:opencode": "node packages/host/scripts/smoke.mjs opencode"`（scripts 块第 4 行，文件第 9 行附近）；(2) packages/host/scripts/smoke.mjs 无任何 opencode 分支——`const [agent = 'claude', mode, workflow = 'quick'] = process.argv.slice(2)` 把 argv 直接当 agentId 经 task-start 帧传给 host dist/index.js；(3) packages/host/src/agents/ 目录仅剩 claude.ts / codex.ts / registry.ts，registry.ts:14 `export const AGENTS: AgentDef[] = [claudeDef, codexDef]`——opencode 适配器确已按 D5 修订删除，src 中残留的只是注释性提及；(4) 无任何调用方守护或 CI 覆盖该入口，贡献者照 scripts 清单手跑即触发未知 agentId 报错。这不是设计取舍——9b112c9 删除 e2e-opencode.mjs 时的自述「脚本无宿主」同样适用于这个漏删的 smoke 入口，属同一清理的遗漏。严重度维持 P3：死代码/开发者体验问题，不影响用户功能、安全承诺或发版（不在 CI `pnpm test` 链路中）。附带一提：packages/host/dist/agents/opencode.js 是陈旧构建产物，同样是删除残留，可与该入口一并清理。

### #8 approxTokens 用 chars/4 估算对 CJK 正文系统性偏低 3-4 倍，且该数字已被 README 钉为「额度透明」机制并写进 host prompt（P3；content-shared-manifest）

- **文件**：apps/extension/src/content/extract.ts:133
- **证据**：extract.ts:133 `approxTokens: Math.ceil(markdown.length / 4)`（adapters.ts:31 同款）——chars/4 是英文启发式；中文每字符约 1-1.5 token，200k 中文字符实际消耗 20-30 万 tokens 而面板只报 ≈5 万。该数字有三条消费链：① SummarizeView.tsx:1199-1203 tips 条「≈X万 tokens」+ title「用量计入你的 CLI 订阅」；② r55 #1 修复后 README.md:60 明文向用户背书「面板 tips 条的 ≈N tokens 是正文体量估算」——低报 3-4 倍的数字成了官方额度披露口径；③ packages/host/src/prompt.ts:114 把它写进给 CLI 的 prompt（「完整正文……约 N tokens」），agent 对正文规模的认知同样偏差。用户操作序列：中文页面 → 点深度总结 → tips 显示「≈5.0万 tokens」→ 实际烧掉编码配额约 20 万 tokens，重度用户按面板数字规划用量时被误导——恰是 r55 #1 要保护的人群。修而未尽定性：#1 补了「计入订阅」的定性披露，量的估算却对主要用户群（中文 UI/中文页面）系统性偏低。
- **修法**：按正文 CJK 占比分段估算（CJK 字符 ×1.2 + 其余 /4），或至少对 CJK 占比高的正文切换系数并在 tips 标注「估算」；prompt.ts 的规模提示同步修正。
- **证伪记录**：逻辑链每一环均核实成立：① apps/extension/src/content/extract.ts:133 `approxTokens: Math.ceil(markdown.length / 4)` 确为纯 chars/4 英文启发式，无任何 CJK 加权（adapters.ts:31 同款，但 arxiv 适配器 lang='en'，该处合理）；② 消费链一：apps/extension/src/sidepanel/SummarizeView.tsx:1199-1201 将该数渲染为「≈X.X万 tokens」tips，title 声称「正文体量估算，用量计入你的 CLI 订阅」；③ 消费链二：README.md:60 明文向用户背书「面板 tips 条的 ≈N tokens 是正文体量估算」——低报数字成为官方额度披露口径；④ 消费链三：packages/host/src/prompt.ts:114 将其写入 CLI prompt「完整正文（markdown，约 N tokens）」。chars/4 对中文正文（约 1-1.5 token/字符）系统性偏低 3-6 倍属实，且本项目主要用户群即中文用户。DECISIONS.md 无任何拍板将 chars/4 定为设计取舍（grep 仅见无关的 daemon/多引擎决策），测试文件引用 approxTokens 但无 CJK 精度覆盖，场景完全可达。反驱失败：isReal 成立。severity 校准：功能不破坏、无安全隐私问题，tips 与 README 均已带「≈/估算」字样，属披露数字精度缺陷而非功能错误，维持 P3。

### #9 workflow-read 回帧无 history-read 同款的字节收缩处理，>1MB 的 WORKFLOW.md 让设置页编辑器打不开且错误错标 not-found（P3；content-shared-manifest）

- **文件**：packages/host/src/stdio.ts:155
- **证据**：stdio.ts:156-161 workflow-read 分支直接 `send({ t: 'workflow-file', name, content })` 无体积处理；content 超过 1MB 时 nm.ts:12-14 encodeFrame 同步 throw（「frame too large」），被链尾 .catch 捕获后错发 `code: 'not-found'` 帧——Settings.tsx:203-207 收到后展示为「not-found: frame too large: ...」。对照同文件 history-read（:110-135）r54 #10 已做「JSON 字节全量校验 + 档位回退 + 截断提示」的完备收缩。触发路径真实存在：r55 #11 只给 SW→host 的 workflow-save 加了 960KB 门禁（面板侧创建的文件安全），但产品卖点「目录即插件」明文鼓励用户直接在 ~/.ai-page-dive/workflows/<name>/WORKFLOW.md 落盘自编 workflow——长 prompt/多节 agent workflow 超 1MB 并不罕见，落盘后 list-workflows 正常出下拉、点选即触发：编辑器 10s 只读超时态 + 一条「not-found」错误，用户以为模式丢了。
- **修法**：workflow-read 复用 history-read 的收缩+截断逻辑（或超限时回带截断标记的 content），错误 code 单列为 frame-too-large 而非 not-found。
- **证伪记录**：核心成立，但有一处机制描述不准。成立部分：(1) packages/host/src/stdio.ts:155-161 workflow-read 确实直接 send 全量 content，无 history-read（同文件 :110-135，含 r54 #10 的字节全量校验+档位回退+截断提示）任何同款收缩；(2) packages/host/src/workflows.ts:96-105 readWorkflow 无体积上限，listWorkflows（:60-80）也只校验目录名不校验大小，>1MB 的手写 WORKFLOW.md 会正常进下拉；(3) 触发路径真实：sw.ts:525 的 frame-too-large 门禁（r55 #11）只拦 SW→host 方向的 workflow-save，用户按「目录即插件」直接落盘 ~/.ai-page-dive/workflows/<name>/WORKFLOW.md 完全绕过；(4) nm.ts:10-14 encodeFrame 对 >1MB 同步 throw，该 workflow-file 帧发不出去，Settings.tsx:235-236 的 10s 等待落为只读超时态——编辑器打不开属实。不准部分：发现称 throw 会被 :161 的 .catch 捕获错发 not-found 帧——实际 runNative 的 send（stdio.ts:203-211）内部 try/catch 包住 writeFrame，frame too large 被 send 自身吞掉只留 stderr 日志，promise 链的 .catch 根本不触发，用户看到的是 10s 超时只读态而非「not-found: frame too large」错误。即真实症状是静默丢帧+超时，比描述更不可诊断。核心缺陷（缺收缩处理、与 r54 #10 修 history-read 的标准不一致）成立且场景可达，非设计取舍（DECISIONS.md 无相关豁免）。

### #10 正文主体在 iframe 的页面：历史落盘的 url/title 是内嵌 frame 的 URL，与 tips 条展示的地址栏 URL 分裂，历史检索/回溯失锚（P3；content-shared-manifest）

- **文件**：apps/extension/src/background/sw.ts:854
- **证据**：extractPage 在胜出 frame 里返回 `url: location.href, title: article?.title || document.title`（extract.ts:124-126）；extractBest 取正文最长的 frame（sw.ts:760，sw.ts:823 注释明示豆包文档等 SPA 正文渲染在 iframe 是设计内场景）；startSummarize 把该 frame 的 meta 原样放进 task-start（sw.ts:854-865 `page: meta`，无 tab.url 覆盖）→ host history.ts:120 把 meta.url 写进历史 frontmatter。而同函数里 tips 条却用 `tab.url ?? meta.url`（sw.ts:859）展示地址栏 URL。用户操作序列：打开正文在 iframe 的文档页 → 总结 → tips 显示地址栏 URL，历史列表/历史详情显示的却是 `https://…/embed/xxx` 之类用户从未见过的 frame URL——按 URL 记忆检索历史查不到，resume 后也无从知道当时总结的是哪个页面；同一任务的 tips 与历史记录 URL 互相矛盾还破坏排障可信度。
- **修法**：startSummarize 组装 task-start 前用 tab.url/tab.title 覆盖 meta 的 url/title（frame 的真实来源可另存 sourceUrl 字段），使历史锚点与用户地址栏一致。
- **证伪记录**：逻辑链每环均经代码核实成立：(1) extract.ts:124-126 胜出 frame 返回 `url: location.href, title: article?.title || document.title`——即 iframe 自身 URL；(2) sw.ts extractBest（约 760 行）取 contentMarkdown 最长的 frame，注释明示「豆包文档等 SPA 正文渲染在 iframe」是设计内支持场景（allFrames 注入）；(3) sw.ts startSummarize 中 `const { contentMarkdown, ...meta } = page` 后 task-start 帧的 `page: meta` 原样透传，无 tab.url 覆盖；而同函数的 page-meta tips 帧却是 `url: tab.url ?? meta.url`（地址栏优先）——同一任务两处 URL 口径确不一致；(4) host 侧 task.ts:535-536 `title: this.input.page.title, url: this.input.page.url` 写入 HistoryMeta，history.ts:120 落进 frontmatter，且 history.ts:204 的历史搜索 `meta.url.toLowerCase().includes(q)` 以该字段匹配——按地址栏 URL 记忆检索确实命中不了。无任何测试/守护覆盖此场景，DECISIONS.md 亦无相关拍板取舍（iframe 提取是设计内场景而非豁免）。反驳不成立。severity 维持 P3：总结主功能不受影响、历史条目仍存在（title/slug 可部分检索），属特定页面形态下的元数据锚点分裂/检索体验缺陷，够不上 P2 的「功能出错」门槛。

### #11 卸载 FAQ 对 pnpm 用户的「preuninstall 自动清理」承诺与 host README 自述矛盾——pnpm 全局安装默认不执行生命周期钩子，照做后 NM 注册残留且事后无 CLI 出口可补清（P3；docs-accuracy）

- **文件**：/Users/apple/work/hs/ai-feature/ai-page-dive/README.md:96
- **证据**：README.md:96 卸载 FAQ：「终端执行 npm uninstall -g @aaione/ai-page-dive（当初用 pnpm 装的则 pnpm rm -g @aaione/ai-page-dive）——preuninstall 钩子自动清理本机组件注册（NM manifest + wrapper）」。但 packages/host/README.md:22 自述「pnpm 全局安装默认不执行安装钩子，请手动跑 install」——本仓自己承认 pnpm（本机版本 10.33.3，v10 默认拦生命周期脚本）不走钩子路径；安装侧 postinstall 不跑，卸载侧 preuninstall（packages/host/package.json scripts）同理不跑。用户操作序列：pnpm 用户照 README:96 跑 `pnpm rm -g` → NM manifest（~/Library/Application Support/Google/Chrome/NativeMessagingHosts/）与 wrapper 残留 → 此后想补清时包已删除，FAQ 同句给的 `ai-page-dive uninstall` 出口（host/src/index.ts:26，命令真实存在）也随 bin 一起消失，只剩手删文件一条无人指路的路。两份文档必有一份在撒谎，且撒谎方是面向消费者的 README。
- **修法**：README:96 pnpm 分支补一句「pnpm 不会执行卸载钩子——请先跑 `ai-page-dive uninstall` 再 `pnpm rm -g`（顺序不可反）」，与 host README 的 pnpm 钩子说明统一口径。
- **证伪记录**：逻辑链全部成立：README.md:96 卸载 FAQ 明确对 pnpm 用户承诺「pnpm rm -g 后 preuninstall 钩子自动清理 NM manifest + wrapper」，但 packages/host/README.md:17 本仓自述「pnpm 全局安装默认不执行安装钩子」——pnpm 拦生命周期脚本是同一机制，install 侧不跑则 preuninstall 侧同样不跑，两份文档口径直接矛盾且撒谎方是面向消费者的 README。preuninstall 钩子（packages/host/package.json）与 uninstall 命令（packages/host/src/index.ts:26 → scripts/uninstall.ts:10）均真实存在，即钩子路径本可工作，只是 pnpm 不执行它。后果链也成立：pnpm 用户照做后注册残留，且包已删除导致 README 同句给出的 `ai-page-dive uninstall` 补清出口随 bin 一起消失。反驳角度唯一缓解是官方安装路径（install.sh / README:45 手动命令）全走 npm、pnpm 用户属偏离路径受害面窄，但 README:96 明确把 pnpm 分支写入承诺，且非 DECISIONS.md 设计取舍。残留仅少量本机文件、无功能/隐私损害，属文档实质矛盾类，P3 定级准确。

### #12 r55 #4 修而未尽：页签内导航后，resume 态 tips 把新页标题标为「对话上下文」——实际 CLI 会话仍是旧页（P3；ext-ui）

- **文件**：apps/extension/src/sidepanel/SummarizeView.tsx:1189
- **证据**：修复文案 `dimmed === 'resume' ? \`对话上下文「${meta.title || host || meta.url}」（追问不重读页面）\``，但 meta 是活数据：sw.ts:320-325 tabs.onUpdated 在导航 complete 时推送新页 page-meta（target=tab 已指向新页），sw.ts:767-772 pageMeta() 返回 target.title（新页标题），App.tsx:370-375 无条件 setPageMeta。用户序列：总结页 A → 追问若干轮 → 在同一页签点链接导航到页 B → tips 变为「对话上下文「B」（追问不重读页面）」——宣称上下文是 B，实际 CLI --resume 会话的内容是 A；用户问「这一页讲了什么」得到 A 的答案且无从察觉。r55 #4 证据里点名的正是这个导航组合，修复只改了时态（进行时→非进行时），没把标题锚定到会话来源页。
- **修法**：hasSession 建立时快照会话来源页的 title/url（随 firstMsgId 重置），resume 态渲染快照而非活 pageMeta；或导航后（快照 url ≠ 当前 url）显式标「上下文来自另一页：X」。
- **证伪记录**：逻辑链全部核实成立：(1) SummarizeView.tsx:1189-1190 resume 态文案用活 meta 渲染「对话上下文「title」」，617 行传 App 的 pageMeta state 且 key={pageMeta.url} 随导航重挂，全代码无会话来源页快照；(2) sw.ts:320-325 onUpdated 在目标页签导航 complete 时 target=tab（新页）并推送 page-meta，767-772 pageMeta() 返回新页 title；(3) App.tsx:370-371 setPageMeta 无条件接收；(4) sw.ts:313-314 注释明确「锚定语义是页签而非 URL」——页签内导航不重置会话，hasSession 保持、CLI --resume 内容仍是旧页 A。故「总结 A → 页签内导航 B → tips 显示对话上下文「B”」成立且误导（括注「追问不重读页面」反而强化错觉）。r55 #4 修复注释自称「文案如实」但只改时态未锚定标题来源，修而未尽属实。反驳均不成立：非 DECISIONS.md 取舍（页签锚定是拍板，标题错标不是）、场景常规可达、无测试覆盖。纯文案/透明度问题，无功能破坏，P3 校准恰当。

### #13 r55 #10 修而未尽：missedTerminal 渲染不按 code 分流——ext-restarted 被「CLI 报告运行失败」错怪、timeout 文案假承诺 + 拼裸英文（P3；ext-ui）

- **文件**：apps/extension/src/sidepanel/App.tsx:340
- **证据**：四处 missedTerminal 渲染（App.tsx:294/340/393/692）共用同一模板 `` `${ERROR_LABEL[mt.code ?? ''] ?? mt.code ?? 'error'}${mt.message ? `: ${mt.message}` : ''}` `` 且恒 `cliFault: true`，而直收 task-error 分支（App.tsx:586-617）按 code 分流。三个症状：(a) ext-restarted（sw.ts:143 折算的孤儿指针）渲染成「CLI 报告运行失败：扩展更新或重启打断了进行中的任务」——CLI 没失败，违背 r46 拍板的「启动前/非 CLI 故障不得错怪 CLI」规则（App.tsx:53-56 注释自述）；(b) timeout 渲染「任务超时（上限 10 分钟）——你的问题已放回输入框（未覆盖已有草稿），可直接重发: task exceeded 10min」——missedTerminal 分支不构造 refill，重开面板后输入框是空的，「已放回输入框」是空承诺，且 host 原始英文 task exceeded 10min（host task.ts:310）拼进气泡正是 r52 #16 修掉的行为在此路径复发；(c) content-mismatch 会「正文传输不完整」文案复读（直收路径 App.tsx:609-610 特意避免）。用户序列：深度任务在跑时面板收起 → 任务超时或扩展自动更新 → 重开面板 → 收到上述错怪/假承诺气泡。
- **修法**：missedTerminal 四处渲染复用 task-error 分支的分流函数：cliFault 排除 ext-restarted/content-mismatch/timeout；timeout 不拼 message（走 console.debug 同谱）；考虑对可重试 code 一并构造 refill。
- **证伪记录**：逻辑链全部核实成立。(1) App.tsx:294/340/393/692 四处 missedTerminal 渲染确用同一模板 ERROR_LABEL[code] ?? code + 可选拼 message，且恒 cliFault:true，无按 code 分流；直收 task-error 分支（App.tsx:559-628）则分流：timeout 不拼 message（L602-605，r52 #16 注释自述原始英文走 console.debug）、content-mismatch 单用 message 防复读（L606-610）、cliFault 排除 cancelled/content-mismatch（L613）、构造 refill（L584/625）。(2) 症状 a 成立：sw.ts:143 折算 code='ext-restarted' 进收件箱，ERROR_LABEL['ext-restarted']（App.tsx:990）+ cliFault:true 使 SummarizeView.tsx:811 渲染「CLI 报告运行失败：扩展更新或重启打断了……」——扩展重启归咎 CLI，违背 r46 自述规则（App.tsx:53-56）。(3) 症状 b 成立：missedTerminal 分支不调 refillFor，输入框为空，但 ERROR_LABEL.timeout 文案承诺「已放回输入框」（App.tsx:982）；且模板把 host 英文 task exceeded 10min 拼进气泡，r52 #16 在直收路径修掉的行为此路径复发；sw.test.ts:321 证实 timeout 进 missedTerminal。(4) 症状 c 成立：sw.ts:139 注释表明已知 label+message 双份复读问题，仅对 ext-restarted 不设 message 规避，模板未修。(5) 场景可达：面板收起→超时/扩展更新→重开的序列无守卫，测试仅覆盖 SW 侧收件箱（sw.test.ts:372-379）不覆盖 App 渲染；亦非 DECISIONS.md 拍板取舍——代码注释自述意图与实际行为矛盾，属修而未尽。severity 维持 P3：三条症状均为错误气泡文案（错误归因前缀/假承诺/复读拼英文），不阻断功能，用户仍可手动重发。

### #14 host 版本过低的升级横幅命令无点击复制出口——含 32 位扩展 ID 的长命令要用户手动圈选抄录（P3；ext-ui）

- **文件**：apps/extension/src/sidepanel/App.tsx:944
- **证据**：App.tsx:944-948 把 outdated 渲染为纯文本 `<span>{outdated}</span>`；命令在 sw.ts:418-420 拼装：`npm i -g @aaione/ai-page-dive@0.1.3 && ai-page-dive install --ext-id <32字符扩展ID>`，约 110 字符。Onboarding 对同族命令（Onboarding.tsx:136-142、165-179）已建立「点击复制 + 已复制反馈 + 复制失败提示 + r33-ux 手抄长命令易错」的交互基线，且 r53 #1 特意把命令做成两段长命令——横幅却让用户在 ~360px 宽 side panel 里跨行拖选复制，ID 抄错一位 install 就 forbidden。用户序列：host 落后版本 → 面板顶部出现横幅 → 用户切到终端照横幅手抄/圈选复制，中途换行断裂或漏字符 → 登记失败再排障。
- **修法**：抽 Onboarding 的点击复制命令组件（含复制失败反馈）供横幅复用，或横幅内嵌一个「复制升级命令」按钮。
- **证伪记录**：核实成立。(1) 消息拼装：apps/extension/src/background/sw.ts:417-420——probe 返回 ok 且 versionLt(hostVersion, MIN_HOST_VERSION) 时构造 outdated 字符串，内容含完整两段命令 `npm i -g @aaione/ai-page-dive@<manifest版本> && ai-page-dive install --ext-id <chrome.runtime.id 32位ID>`，场景真实可达（host 装了旧版即触发）。(2) 渲染：App.tsx:944-948 确为纯文本 `<span>{outdated}</span>`，整个 App.tsx 不含任何 clipboard 调用，无复制出口。(3) 基线对比：Onboarding.tsx:136-148 对同族安装/登记命令已实现「点击复制 + 已复制 ✓ + 复制失败提示」完整交互，165-179 的 npm 备选命令也做了 role=button 可点复制（r33-ux 注释明言「手抄长命令易错」），sw.ts:415-416 注释还表明 r53 #1 特意把命令做成钉版本的两段长命令——更长却更难复制，矛盾成立。(4) DECISIONS.md 无「横幅不提供复制」的拍板取舍，sw.test.ts 仅覆盖消息拼装不覆盖 UI 交互。反驳不成立。severity 校准：功能可用性未破坏（用户仍可拖选/手抄），属小体验缺口，P3 恰当。

### #15 r55 #9「全树 0700 收敛」只收敛了根链一层：存量装机的 history/年/月子目录仍 755，时间戳-slug 文件名枚举面原样保留（P3；host-core）

- **文件**：packages/host/src/history.ts:100
- **证据**：a35d671 在 saveHistory 只对 ~/.ai-page-dive 根做了 chmod（history.ts:100-102 `const root = dirname(historyRoot()); chmod(root, 0o700)`），getStableAgentCwd 对 agent-workspace 做了 chmod（task.ts:27）。但 ~/.ai-page-dive/history 本身及既存的 年/ 月/ 日/ 目录只在新建时拿 mode:0o700（history.ts:103 mkdir 对已存在目录是 no-op——这正是 commit 自己指出的机制），全仓无任何代码 chmod 它们：revealHistoryRoot（history.ts:322）也只 mkdirSync mode 无 chmod。本机实测（a35d671 落地后）：~/.ai-page-dive、agent-workspace、attachments、history 顶层已是 700，但 /Users/apple/.ai-page-dive/history/2026 仍 drwxr-xr-x（755），月/日层同。r55 #9 点名的风险恰是「历史 md 文件名含时间戳+页面 slug 可被同机其他 uid 列读」——文件躺在 755 的 年/月/日 目录里，枚举面分毫未减，直到未来新月份目录以 0700 创建才渐近收敛。用户序列：老用户升级到 0.1.3 后照常总结 → 新历史写入既有 2026/10（755）目录 → slug 依旧可枚举，与「已修」认知相悖。
- **修法**：saveHistory 建目录时对 path 的整个父链（history/年/月/日 逐级）补 chmod 0o700（与根同谱），或一次性对 historyRoot 子树做受限深度的 chmod 收敛；锚测试从「fresh fakeHome 全树 0700」加一条「预置 755 存量目录后保存历史 → 父链被收敛」。
- **证伪记录**：发现成立，无法反驳。逐环核实：(1) packages/host/src/history.ts:100-102 的 saveHistory 只对 dirname(historyRoot())（~/.ai-page-dive 根）做 chmod 0o700，第 103 行 mkdir(join(path,'..'), {mode:0o700}) 的 mode 仅对新建目录生效、对已存在目录 no-op——该机制正是 history.ts:98 代码注释自认的（「recursive mkdir 对已存在目录 no-op」），但修复只罩住根链一层；(2) 全仓 grep chmod 仅 history.ts:102 与 task.ts:27（agent-workspace）两处，history/年/月/日 存量链无任何收敛代码，revealHistoryRoot（history.ts:322）也只有 mkdirSync mode 无 chmod；(3) 测试 packages/host/test/task.test.ts:159-167 只断言 fresh fakeHome 全新树逐层 0700，全新树下 mkdir mode 天然生效，测不出存量 755 不收敛；(4) 本机实测（a35d671 落地后）：~/.ai-page-dive、history、history/2026/10 均 700，但 history/2026 与 history/2026/09 仍 drwxr-xr-x（755），存量目录里时间戳-slug 文件名枚举面原样保留，直到月份自然滚入新目录才渐近收敛。反驳理由均不成立：场景可达（老用户升级后新历史写入既有 755 目录）；非 DECISIONS.md 设计取舍（a35d671 commit 意图就是「全树 0700 收敛」，属修复不完整）。severity 维持 P3：PRIVACY.md/README 未对外承诺 0700 数字，缺口是同机多 uid 下文件名枚举（非内容泄露），macOS 默认单用户且单用户下 HOME 通常 700 已整体兜底，属安全加固不彻底+复盘口径与实际不符，非 P1/P2。

### #16 PRIVACY 英文「crash leftovers are swept within about an hour」是无触发条件的时间保证：sweep 只在用户下一次总结时才跑，停用后残留永不清（P3；多维交叉命中：r55-regression + security-privacy）

- **文件**：PRIVACY.md:9
- **证据**：tmpfile.ts:28-50：sweep 是 `if (!swept) await sweep(dir)` 内联在 writeContentFile 里——只有下一次任务真的写正文文件时才扫一遍 >1h 的旧文件，没有任何定时机制；11min timer 是 unref 的且 host 是 per-connection 短命进程。因此英文「swept within about an hour」给读者的是「最多约一小时后自动消失」的明确保证，实际是「如果你之后再总结一次、且距今超过一小时，才顺带清掉」；PRIVACY.md:23 中文「1 小时兜底清扫回收」语义模糊尚可辩解，英文句是硬错位。用户操作序列：英文读者遇到一次 claude is_error（发现一的漏删路径）或一次扩展更新打断（task-done 未达、host 被 SIGKILL 类崩溃）后停用扩展，一小时后检查 /tmp/pagedive 发现正文仍在——隐私政策的英文承诺与实然不符（内容仍限本机 0600/0700，不击穿「不出本机」，故 P3）。
- **修法**：英文句改为「crash leftovers are swept the next time you run a task (files older than an hour)」，与中文「异常退出的残留由……兜底清扫回收」对齐为条件式表述；中文可顺手补「下次使用时」三个字消除歧义。
- **证伪记录**：核实成立。代码链每一环均证实：(1) packages/host/src/tmpfile.ts:50 `if (!swept) await sweep(dir)` 是 writeContentFile 内联的惰性清扫，模块级 `let swept` 单例（tmpfile.ts:27）意味着每个 host 进程生命周期内只在首次写正文文件时扫一次；(2) 全仓库非测试代码中 sweep 仅此一处调用（grep 佐证：task.ts:463 注释「scheduleCleanup+sweep 留作崩溃残留兜底」），无任何 setInterval/cron/定时机制——scheduleCleanup（tmpfile.ts:53-58）是 60s unref setTimeout 只管本任务自己那个文件，且 host 是 per-connection 短命进程，unref timer 随进程退出失效（tmpfile.ts:21-23 代码注释自己写明「host 常规退出远早于 11min unref timer……首次写文件时清一遍 >1h 的旧文件」）；(3) PRIVACY.md:9 英文「crash leftovers are swept within about an hour」在自然英语里是「最多约一小时内被清掉」的时间上限承诺，而实际语义是「下次使用时顺带清掉超过 1 小时的旧文件」——用户停用扩展后残留永不清（macOS 系统级 /tmp 清理是 3 天周期，也救不了「about an hour」的表述）；(4) 测试 save-sweep.test.ts:45-55 只覆盖「下一次 writeContentFile 会清旧文件」，恰恰印证清扫是条件触发而非时间保证。反驳角度均不成立：这不是 DECISIONS.md 拍板的设计取舍（拍板的是「惰性清扫」实现，不是英文文案的表述），也不是场景不可达（is_error 漏删/扩展更新打断/host 崩溃均是真实路径）。唯一可辩的是「within about an hour」或可曲解为「超过约一小时后才可被清」，但普通英文读者不会这样读，且即便如此也仍缺「需要再次使用」这一前提。severity 校准：维持 P3——文案与实然不符但内容仍限本机 0600/0700 文件、不击穿「不出本机」硬约束，无功能破坏，属隐私政策措辞级别的小修（改条件式表述即可）。

---

## 已否决（对抗核实未通过）

### ×check-host-lines 按「路径段名为 scripts」豁免：把 NM 运行时代码挪进 packages/host/src/scripts/ 即免计红线，且文档宣称的跨包口径与实现不符（ci-packaging）

逻辑链逐环核实后不成立或属设计取舍：(1) 技术事实部分正确——scripts/check-host-lines.mjs:24 的 SKIP=/(^|\/|\\)scripts($|\/|\\)/ 确实豁免任何 scripts 路径段，当前 2192/2200 余量 8 行也属实（实跑脚本验证）。(2) 但「把运行时代码挪进 src/scripts/ 绕红线」是脚本明文背书的设计而非隐患：脚本的破线处方自己就写着「请删功能、精简注释或**移入 scripts/**」（check-host-lines.mjs:69），头注释亦言明豁免理由「装机一次性安装器，不在 NM 主循环里」（:21）。src/scripts/ 下现存的 install.ts/uninstall.ts/postinstall.ts 确实只被 index.ts 的 CLI 子命令动态 import（index.ts:13,28），不在 NM 主循环。挪 task.ts 进 scripts/ 需要贡献者蓄意改 import 并通过 code review——有 commit 权的人同样可以直接改 LIMIT 或删脚本，任何 CI 门禁都不防御蓄意的内部绕过，这不是「特定场景出错」的 bug。(3) 「文档与实现两套说法」不成立：AGENTS.md「拆包不再是绕过红线后门」的承诺由双重机制实质兑现——脚本断言 host……

### ×check-version 漏了 sw.test.ts 两处硬编码 '0.1.3'：升版时门禁全绿、vitest 反红，制造「版本一致却测试挂」的困惑（ci-packaging）

事实层面部分属实但核心危害链不成立。属实部分：sw.test.ts:84 mock `getManifest: () => ({ version: '0.1.3' })` 与 :342 `expect(st.outdated).toContain('@aaione/ai-page-dive@0.1.3')` 确为硬编码，check-version.mjs:10-20 spots 清单也确实未含 sw.test.ts。但发现描述的故障场景不可达：sw.ts:419 的 outdated 文案拼的是 `chrome.runtime.getManifest().version`，在 vitest 里 `chrome` 是 sw.test.ts 文件内自建的 mock（:84），返回的永远是该文件自己硬编码的 0.1.3，根本不读真实 apps/extension/public/manifest.json。因此升版到 0.1.4 后：mock 喂 0.1.3 → sw.ts 拼出 '@aaione/ai-page-dive@0.1.3' → :342 期望也是 0.1.3，两处在同一文件内自洽，测试依旧全绿。「门禁绿、vitest 反红、贡献者在矛盾信号里排查」这一整条危害链不会发生。MIN_HOST_VERSION（sw.ts:15='0.1.0'）是与仓库版本脱钩的独立常量，不引入额外……

---

## 本轮盲区（完整性批判，下轮该看）

1. install.sh / `ai-page-dive install`（packages/host/src/index.ts）的再入与换 ID 场景：用户重装扩展导致扩展 ID 变更后，NM manifest 的 allowed_origins 是否被更新、钉版 npm 包升级后旧注册指向是否失效——首装一次性引导之后没有任何文档或代码路径覆盖「换 ID / 升级后重跑 install」的幂等性，属于安装链路的真空白。
2. packages/host/src/workflows.ts 与 skills.ts：用户自建 workflow/skill 的名称到磁盘路径的映射（`../` 穿越、绝对名）未在安全维度被点名，且这些文件内容会直接拼进 CLI prompt——是页面不可控但用户可写的第二个注入面，与「正文走 stdin」的信任边界论述互不覆盖。
3. apps/extension/src/dev/chrome-mock.ts + dev.html：整个 UI 自验 harness 是手工维护的 chrome API 副本，没有任何锚定测试守护 mock 行为与真实 manifest/SW 语义不漂移——harness 全绿而真机行为分叉时，唯一自验路径本身失真且无人报警。
4. optional_host_permissions「始终允许读取网页」开关（D3 修订新增）授予后的提取路径：授权后 content script 的注入时机、注入失败重试、用户回收授权后的降级表现没有任何测试网覆盖，而这是全产品唯一扩大站点访问面的开关，恰是权限最小化叙事的最脆一环。
5. codex 适配器对称性：本轮与 r55 的发现几乎全部落在 claude 路径（is_error 打 stdout、超时终局、临时文件清理、missedTerminal 文案），codex 侧的同构路径——运行内失败信号形式、退出码语义、终局清理——没有一条被单独对账，双适配器中一半处于「未证伪」而非「已验证」状态。

---

## 处置建议（修复顺序）

1. **用户动作（立刻）**：`npm publish` 0.1.3——解除 #1 的新用户 E404 与 main CI 恒红，其余全是代码/文案侧。
2. **host 批**：#2 补 is_error 与 timeout 已交付两条终局的 rm（建议收敛成终局公共函数防再漏）+ 锚测试扩展到错误终局；#5 readFmHead 补 ≤256KB 全量读回退（与 readFrontmatter 同谱）；#15 存量 history/年/月 父链 chmod 收敛；#9 workflow-read 补字节收缩。
3. **ext 批**：#4 startSummarize 失败路径补 taskId 守卫（对齐 :852）+ sw.test 并发锚；#13 missedTerminal 按 code 分流；#12 resume 态 tips 不展示新页标题。
4. **文案批**：#3/#16 PRIVACY 三处措辞如实化（agent-workspace 常驻 + sweep 触发条件）；#11 pnpm 卸载 FAQ 补手动出口。
5. **清理批**：#7 删 test:smoke:opencode；#6 删 vitest alias 死键（或改指 TS 源兑现承诺）；#8 approxTokens CJK 校正；#10 iframe meta 用地址栏 URL；#14 升级横幅加复制。
