# Changelog

本项目的所有显著变更记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本管理遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

（0.1.4 已发 npm（registry latest 同版）并 push 147 commits + tag v0.1.4，r81 critical C1 发布链断裂（第 15 轮续计）闭合；下轮发版自此起记）

### Fixed（r82 修批①——上架审 P1/P2：v0.1.4 待上传 zip 重打前提）

- 版本横幅复制命令修复（P1，high）：E404 提示前置于命令（sw.ts outdated/upgrade 两横幅）——r76 尾置时提示内含两个全角冒号，panel 复制按钮按 lastIndexOf('：') 切片命中提示内部，复制出 issues URL 而非 npm 命令（node 重放 + 待上传 zip 解包双实锤，已进 v0.1.4 实物）；切片抽 terminal.ts bannerCmd 三用例直测（含尾置反例钉形——该形状不得回归）+ sw.test.ts 两横幅端到端钉字序与切片结果（变异自证：尾置还原即红）
- 商店门面限定语（P2，medium=F22 残留升级）：manifest description「内容不出本机」改「正文直达本机 CLI、不经 PageDive 服务器」（对齐 PRIVACY.md/README 限定口径——正文实交 CLI 厂商云端；git 考古：r71 压字符时把准确表述挤成失实表述）；Settings.tsx 分享文案同步限定
- 292 → 295 用例，README/AGENTS 同步

### Docs（r77 双终审迟到收割——发起于 r76 后、收割于 r82 后）

- 双 workflow 19 agents/693k tokens（code 6 维 + product 5 维，报告 reports/2026-10-16-r77-dual-audit-post-hoc.md）：收割时仓库已被并行推进至 r82（HEAD 03bd069），审计员实测抓获基线漂移并按现状出账。正面：r76 批 7 项修复全部验证成立、发布链闭合亲测（registry 0.1.4 = install.sh 钉版 = tag）、9 决策零违背、r76 批入账措辞可逐字导出。新立案 medium×1：vitest 偶发红未定位（复核员修正嫌疑到 terminal.test.ts stampTerminal/UNDELIVERED_CODES 族，六跑三红单文件跑绿；本机磁盘 92% 满为已证放大器——红跑日志真实 ENOSPC）。新立案 low×8：send 回调先到不记 finished 台账（双气泡第三路径，一行修）/runtime-error·parse 失败轮历史零错误痕迹（r76-B 修全性缺口）/timeout 路径先发终局后落盘（三终局路径时序不齐）/errorText UTF-16 截断可切半代理对（stdio.ts 范式未对齐）/「未知错误（码 X）」格式三拷贝（三轮缺键债同域）/E404_HINT Issues URL 不可点击/注释 14 键 vs 实 15 键/产物级声明与发版 tag·zip 两步无 runbook 制度盲区。交叉确认 r82 P1（复制命令 bug 三 workflow 独立撞车 + zip 哈希亲验未修未重打）；剔除 1 low（「升级提示指向 npm 无 0.1.4」前提已随发布失效）；遗留观察：raw.githubusercontent CDN 暂态缓存钉 0.1.3 旧 install.sh（下轮复查）、本机磁盘 92% 建议清理。tests 变异 5/5 全红自证、收割后工作区干净亲测

## [0.1.4] - 2026-10-15

r59 起至 r76 的全部审计批次均发生在 0.1.4 三处钉版未发布期间，同属 0.1.4 实物（r71 e5161b8 首次归位至 r70 批，r73 product C8 把 r71/r72/r73 批次一并并入；日期为并入封版日，发布时如跨日顺手更新）。

### Fixed（r81 修批⑤——escapeYaml 码点 + 两处口径账面）

- escapeYaml 补 U+2028/U+2029（C4）：YAML 双引号标量里裸行/段分隔符与 C0 同罪（重解析当换行），页面可控 title 可借它伪造 frontmatter 键——并进既有替空格字符类，单测钉死（变异自证删码点必红）；注释折进行内守红线（2199/2200，余量 1）
- AGENTS.md 授权入口口径对齐 D3 r63（F23）：optional_host_permissions 的「始终允许读取网页」实装位为 no-permission 出错气泡而非设置页——硬约束①原描述停在 r47 前
- Onboarding E404 归因对齐 install.sh:47-48 单一口径（F7）：「扩展刚更新、本机组件还没跟上」→「扩展与本机组件同版本发布，可能刚更新还未推送」——三处（sw.ts 横幅/README/Onboarding）归因一致
- 钉版 CI「install.sh ∈ npm versions」核验闭合：check-version（install.sh 钉版 == 仓库版本）+ check-published（仓库版本 == registry latest）传递成立，无需第四道闸（ci.yml:44/46 双腿在跑）
- 291 → 292 用例，README/AGENTS 同步

### Fixed（r81 修批④——迟到回调守卫纯函数化直测）

- App.tsx send 错误分支三重迟到守卫纯函数化（C6）：dropLateError 抽入 terminal.ts（r74 先例路径），App onStartResult 消费语义逐字不变——此前闭包内联全仓零直测（r81 审计变异实证：删守卫后 116 测试全绿，r75 挂账四轮未清）。四用例参数化直测（台账命中丢/顶替 cancelled 丢/清场空会话丢/正常路径不丢），变异自证删守卫①必红；287 → 291 用例，README/AGENTS 同步

### Fixed（r81 修批③——快照指纹持久化 + 会话维度化）

- 快照指纹并入 storage.session（M1）：lastSnap 值从快照全文改 FNV 双 32 位 + 长度指纹（全文曾数百 KB 驻留 SW 内存），随 persistSession 持久化、restoreSession 恢复——此前 SW 回收即失，「页面无变化零附件」承诺只在 SW 不回收时成立（主场景 30s 回收恰是最常见路径）
- 指纹会话维度化（M2）：resume-history/new-session 顶替会话时清指纹——历史会话没看过本页当前快照，残留指纹假命中「无变化」会漏发快照，追问落在没见过本页的会话上
- SW 回收跨世代命中 / resume-history 同文照附两条单测变异自证（删持久化/删清理必红）；285 → 287 用例，README/AGENTS 同步

### Fixed（r81 修批②——captureShot await 窗口所有权复检）

- sw.ts 发送段补单点复检（C1）：captureShot（含 tabs.get + jpeg 编码，数十至上百 ms）是 startSummarize 发送段唯一 await，窗口内任务易主（双面板/双击二发）后旧管道恢复会发第二个 task-start 并把新任务 expectedChars 覆写成旧 total → 新任务 content-received 对账错配被误判 content-mismatch 假终局（r56 #4 同族第三个漏网点）；复检折算 cancelled 后到 return 全程同步（单线程无竞态），窗口一次封死。双击时序单测变异自证（删守卫必红）；284 → 285 用例，README/AGENTS 同步

### Fixed（r81 修批①——watchdog flaky + 两表键域互锁 + timeout 文案）

- task-watchdog 两用例去真时钟窄裕量（C7，审前自查首轮 2 红实证）：帧距 1000/800ms 对 idle 1500ms 裕量仅 500/700ms 负载下假红——env 抬窗 idle=3000/hard=9000、帧距降载放大裕量至 2000/2500ms，断言全部改行为锚（帧表「段5」收齐即活过旧总闸 / chunk ≥14 帧即终局只能来自硬上限），对齐 r63 裕量纪律（task-timeout.test.ts 先例）
- host-not-found 补两表键 + SW 四处 return 补 taskId（M3）：terminal.ts ERROR_LABEL/START_FAIL_LABEL 各补「本机组件未就绪——请重试」（r72/r80/r81 同型缺键债第三犯收官）；sw.ts:989/1000/1280/1314 return 补 taskId 对齐 r76-E——App send 回调按 finished 台账去重，缺它双气泡
- 终局文案统一查找链 terminalLabel（C12）：帧通道（START_FAIL→ERROR_LABEL→未知）与 missedErrBubble（仅 ERROR_LABEL→未知）两套结构合一（START_FAIL 优先），App 三消费点同源——单侧缺键不再可达「未知错误/裸码」（变异 A 实证：单侧删键不再产生用户可见缺陷即修复生效）
- 键域互锁三断言（C8/C9/C13，变异自证均红）：UNDELIVERED_CODES 导出+全集逐成员 undelivered 断言（曾只钉 9/19，删可达码不红）；TerminalCode 闭集 24 码 terminalLabel 必有文案（两表全缺即红）；两表重复键文案逐字相同（session-lost 曾 r80 单侧漏）
- timeout 文案去「上限 10 分钟」（M4）：r80(B) 双闸后 idle 帧续命 + 30min 硬上限，分钟数两头不实（terminal.ts 与 App.tsx missedErrBubble 两处）
- 279 → 284 用例（terminal.test +5 互锁断言）；README/AGENTS 测试数同步（README 开发者节 271/26 → 284/28——r81 F2/F26 账面漂移顺手清）

### Docs（r81 双审批——产品+代码双 workflow 严苛审，报告入库待修）

- r81 产品功能审（7 维 finder→对抗复核→终裁，18 agents/602k tokens；reports/2026-10-14-r81-product-audit.md，d0ab8f3）：终裁 4.5/否——critical 同根：发布链断裂第 15 轮续计（远端 install.sh 钉 0.1.3 而 registry 仅 0.1.2，新用户主线 100% E404 且失败指引对不上真因）；代码修 4 项立案：快照指纹并入 storage.session（M1，主场景 SW 回收后零膨胀承诺失效）、指纹 Map 会话维度化（M2，resume-history 假命中「页面无变化」）、host-not-found 补两表键+四处 return 补 taskId（M3，r75/r76 同型第三犯）、timeout 文案去「上限 10 分钟」口径（M4，r80 双闸硬上限 30min 脱节）；17 low（README 测试数 271/26 文件→实数 279/28、session-lost 文案两表重复无断言、watchdog 真时钟窄裕量等）
- r81 代码实现审（5 维；reports/2026-10-14-r81-code-audit.md，28b6e12）：终裁 6.0/否——基数 8.3（健壮性 8/安全 8/正确性 7.5）被质量体系扣穿：C6 high App.tsx 等 2619 行 view 层零变异网（变异实证删 App.tsx:839 迟到回调守卫后 116 测试全绿，r75 挂账四轮未清）、C7 high task-watchdog 双用例真时钟窄裕量 500/700ms（审前自查首轮 2 红实证，同仓 r63 裕量纪律二踩）；C1 medium captureShot await 窗口无所有权复检（r56 同族第三个漏网点，双击下 expectedChars 错配假终局）；C9+C12+C8 medium 两表键域对 TerminalCode 闭集无互锁+两查找链不一致+UNDELIVERED_CODES 19 成员只钉 9（变异实证删 5 可达码全绿）——r72/r80 同型债第三犯；host 红线余量实测 1 行（2199/2200）；C4 low escapeYaml 漏 U+2028/2029（页面可控 title 可伪造 frontmatter 键）。首轮 verify 段 429 限额打穿 4 员（重置 19:50），21:01 同 runId resume 缓存补缺一把成（净补 50k tokens）
- 审计方法入库（workflow-audit-discipline 记忆 #20/#21）：429 型验尸-resume-缓存三步法定型；变异授权+还原纪律+主编亲测三件套闭环生效

### Fixed（r80 审计批——严苛 review 实测修复）

- 收件箱补发通道 session-lost 补 ERROR_LABEL 键（high）：missedErrBubble 只查 ERROR_LABEL——r80(A) 运行期 session-lost 只进了 START_FAIL_LABEL，面板收起重开落「未知错误（码 session-lost）: 裸英文」自愈指引丢失（r72 host-disconnected 同型复发）；补键 + terminal.test 删键即红断言。顺带揪出 sw.test 对照用例隔离缺陷：上一段入箱 persist（delivered.then 异步）写共享 store 竞态顶掉下一段 seed，对照段从未真正跑过（followUp 被截断成启动前 session-lost）——拆独立 it + taskId 前提断言 + persists 非空钉死（for-of 空转 vacuous）+ 宏任务 flush（delivered 两层微任务单轮 await 排不到）
- hardTimer 各终局出口双闸齐清（medium）：onFire/负退出码/error 事件/isError/finish 五出口行内拼 clearTimeout（物理行零增量）；原靠 finished 守卫自然失效——正确性无恙但 onFire 闭包持有 Task 含 accText 全文累积，长会话多任务 host 累计 MB 级悬挂内存至多 30min；armIdle 重挂点只清 idle 闸（hard 闸不重置是双闸语义核心，双闸看门狗两用例钉住）

### Added（r80 批——OpenHands/open-design 对比优化）

- claude resume 目标丢失识别 + 全链自愈（A）：claude.ts 识别 CLI 本地失败形状（result 帧 `is_error` 且零轮次零 API 时间——真机实测非 UUID 假 ID 与合法 UUID 不存在两形状同型，零 token 消耗；有 API 时间/轮次的真失败不识别，防误杀活会话；对照 open-design #4275 教训选结构化形状而非随版本漂移的 stderr prose），TaskErrorMsg.code 闭集补 `session-lost`；task.ts 结合 resumeSessionId 走 onError('session-lost') 专属终局（非 resume 轮同形状仍 is_error onDone）；codex 侧真机实测（0.162）resume 目标丢失为 stdout 零帧 + exit 1 + stderr prose「no rollout found for thread id」（无 turn.failed 帧；非 UUID 假 id 静默开新 thread 无丢失形状）——finish 的 exit≠0 无 result 分支以 stderrTail 匹配走同码 session-lost，文案漂移回退 parse 码不劣于现状；SW task-error 分支清源页签会话句柄（historyPath 保留——历史还原仍可用，否则重开面板 get-state 恢复 resumable:true 再撞同一死会话）；面板 resumable:false——重发即全新总结；terminal.ts 启动前失败文案去「扩展服务重启」限定（同码现双触发）
- 10min 一次性总闸改双闸看门狗（B）：idle 闸每过程帧重挂（长产出任务不再被中途误杀——慢思考后持续吐流的全链总算活到终局）+ 硬上限 3× 不重置（idle 语义放宽后的配额保护，流式炸弹最迟 30min 强收）；终局后靠回调首行 finished 守卫自然失效；scheduleCleanup 11min → 31min 配套（硬上限期临时文件不得被删）
- 271 → 279 用例：claude-parser.test.ts resumeLost 形状（两丢失形状 → true / 有 API 时间 / 有轮次 → false + 存量 3 处补字段）；task-resume-lost.test.ts +3（resume 轮走 session-lost 不落 is_error done / 非 resume 轮同形状仍 is_error onDone——帧实抄真机 / codex 丢失形状 stdout 空 + stderr prose + exit 1 → session-lost——stderr 实抄真机 0.162）；task-watchdog.test.ts +2（帧续命活过旧总闸刻度 / 永续流硬上限强收）；sw.test.ts +2（session-lost 帧清源页签 sessionId 保 historyPath / timeout 码对照不清）

### Added（r79 批）

- 图片附件超 500KB canvas 压缩重试（b14353d）：pickAttachments 对超限图片先走 shrinkImage——缩边 + jpeg 降质阶梯（边 2048→720 × 质 0.8→0.45），压进预算判据与帧内计量同口径（b64.length）；PNG 透明底垫白再转 jpeg；压不进（极端长图/噪声图）或解码失败落回跳过提示。host 落盘不消费 mime（b64 直写、CLI Read 按 magic bytes 认图）零下游错位。dev 浏览器实测 4.7MB 纯噪声 png 压进预算出 chip
- dev harness 补错误终局两场景参数（93ff645，r78 审计 harness 空洞#2/#3）：?taskfail=<code> 第 2 段 chunk 后 task-error(code) 终局（code 直传 ERROR_LABEL 分流 + refill 回填实测原文还原）；?hostdown=1 广播 __host-disconnected + task-error 双帧（镜像 sw.ts:947-953，落 cliFault 前缀终局气泡 + tips 已分享已送达分流）
- 270 → 271 用例：SummarizeView.test.tsx +1（超限图压缩链在 canvas 不可用环境降级——jsdom 无 URL.createObjectURL，不抛异常仍落跳过提示）

### Fixed（r78 批）

- readability 残缺产出对账降级——课程表类页面不再静默丢正文（真机反馈排查闭环）：cmu-agents 课程表页实证，Readability sibling 裁剪把 Sep–Oct 8 整块当低分兄弟裁掉，结构化产出 1334 字符仅为页面可见文本 5361 的 25%，CLI 快照从 Oct 13 开始、Lecture 1-4 全丢——「成功/失败」二态间没有「成功但残缺」检测，兜底链只在产出为空时触发。修复：degraded 判据（markdown 非空但不足 innerText 1/4 且 innerText 过 looksLikeProse 双启发式）即降级全文兜底，宁带噪声勿丢正文（误伤面=长评论区被正常剥除的文章页带上评论噪声；漏检的损失是 CLI 对页面四分之三内容视而不见）；降级分支绕开 article.textContent（产出已判不可信）；extractor 降级标 innertext、notice「结构解析失败」→「结构解析不可信」涵盖两态。真页复测闭环（构建产物注入真实页面）：修复前 1334 字符/Oct 13 起/无 Lecture，修复后 11458 字符/Aug 25 起全学期/Lecture 1-14 全在（98fec8c）
- 交互严苛自测（23 agents / 75 断言 / 14 findings → 4 确认缺陷全修，报告 research/interact-audit-r78.md）四修复：①StreamMarkdown StrictMode 流式锁死（high）——卸载清理只 clearTimeout 不置 null，生产入口 main.tsx StrictMode 模拟卸载后重挂载，主 effect 守卫 `if (timerRef.current) return` 只认引用不认死活，残留已清理引用让节流 flush 永久死锁：流式期间零渲染、done 才一次性上屏（单测裸 createRoot 无 StrictMode 测不到该形状）；修复：卸载 effect 一并置 null。②pd-page-tips 层叠拦截（medium）——悬浮条压在滚动区上方，未滚到底时与末条消息操作按钮（复制/下载/新对话）垂直重叠，elementFromPoint 实测命中 tips 文本而非按钮；修复：整体 pointer-events: none（backdrop-filter 磨砂绘制不受影响），notice 的 title 悬停单独恢复 auto。③首轮 done tips 误报降级文案（medium）——resume 分流只看 hasSession（首轮总结 done 即有 sessionId），resynced/unchanged 恒空落入「本轮未同步页面」，与刚分享成功的事实相反（违背 r71 如实原则）；修复：补 followedUp 判据（出现第二条 user 消息即追问已发出才走 resume 三分），首轮 done 如实「已分享」。④图文混合粘贴吞文本（low）——onPaste 只看 clipboardData.files 判纯图，真实混合形状是 image 文件 + text flavor（文本不在 .files），误判纯图接管 preventDefault 后文本静默丢失；修复：getData('text/plain') 有文本即走默认文本粘贴。浏览器回归四点全过：流式渐进上屏（0→2→33→70 during data-done="false"）、tips 非 notice 区 elementFromPoint 穿透命中下层、首轮 done「已分享」无降级文案、混合 defaultPrevented=false 零 chip 且纯图对照接管出 chip

### Added（r78 批）

- 264 → 266 用例：extract.test.ts +2（readability「成功但残缺」降级全文兜底——jsdom defineProperty 伪造 innerText own property、loadHtml 顺带清跨用例污染；反向锚——正常文章页剥导航后产出占比健康不误降级）；shadow 用例断言同步「结构解析不可信」新文案为存量改造
- 266 → 270 用例：StreamMarkdown.test.ts +1（StrictMode 模拟卸载不锁死节流——修复前红：单测复现流式零渲染）；SummarizeView.test.tsx +3（粘贴「image 文件 + text flavor」混合形状不接管、tips 首轮 done「已分享」不落降级文案、追问轮仍走 resume 分支对照；存量两粘贴用例 clipboardData 补 getData shim）

### Added（r77 批）

- 追问轮重抓页面快照 + 任务携带可视区截图（实时读取，eee8c70）：followUp 分支注入 content.js + allFrames 择优重提锚页签，压成 text 附件（480K 预算超限头部截断并在披露行注明比例）随 task-start 下发——host materializeAttachments/attachSection 既有链路落盘给路径，host 零改动（行数 2198 不动）；重抓失败降级纯文字追问不阻断；page-meta 增 resynced 字段、PageTips resume 态三分流；task 帧与 currentTask 的 page 在重抓成功时换真实锚（extractor=follow-up-resync）。截图：总结与追问轮 captureVisibleTab 截锚页签可视区（jpeg quality 75→50 两档压 280K 预算，kind:image 附件），锚页签非激活宁缺毋假跳过；帧超限逐级回退：丢截图→丢快照→保用户附件（attFrameOver 与 frameTooLarge 同 64K 安全边 + 4K 骨架余量估值）
- 输入框 Ctrl+V 粘贴剪贴板图片直入附件链（24d6b5f）：textarea 补 onPaste，剪贴板文件全为图片时接管并转 onPickFiles（→ pickAttachments 既有预算/上限/超限提示全复用）；纯文本与图文混合走默认文本粘贴不劫持
- 追问轮快照指纹复用（r77b，7f6ccc5）：SW 内存 lastSnap Map<tabId, 快照全文>，追问轮重抓后全文比对（URL 不变 ≠ 内容不变）——命中零附件零披露行零截图（CLI 会话里上轮正文还在，不再塞重复快照撑上下文），广播 unchanged page-meta；未命中照旧附最新并更新指纹（预算回退丢快照不记，宁多勿旧）；tab 关闭/SW 回收即失指纹 miss 照附；PageTips resume 态四分流
- 254 → 264 用例：sw.test.ts +8（重抓成功全链/重抓失败降级/首轮截图两档压预算/帧超限回退①丢截图保快照/回退②丢快照保截图/非激活跳过/两轮同文第二轮零附件+unchanged/内容变更附新并更新指纹第三轮才复用）；SummarizeView.test.tsx +2（纯图粘贴出 chip、纯文本/图文混合不接管）；dev harness 增 ?resync=0 降级场景

### Fixed（r76 批）

- sw.test.ts r74 两用例假网换真网（r75 code high#1：r74「补齐三条 high 测试缺口」实补两条半，sw 两用例经双重变异实证红条件虚假）：用例 1 补 onClicked 置位 target（还原「锚 tab 关 → 跳 target」竞态时序）；用例 2 重写为 `resolveContentTab(null, target)` 级 2 直测三断言矩阵（r76-A 顺带 resolveContentTab 参数化纯函数化——「anchor=null 且 target 有值」在消息路径只剩 onClicked 与 restoreSession 之间的冷启动竞态窗口，事件造态必踩时序赌注）
- host persist 零产出守卫单点 + is_error 正文入册（r75 code medium#2）：守卫 `!accText && !attachFiles.length && !errorText` 不落盘（空体文件污染历史列表；timeout/finish/运行期 error 调用点同守）；is_error 轮传 `errorText`（≤4000 字符）豁免守卫留排障痕迹——正文以 `> ⚠️` 前缀入册、resume 分支条件与首轮 body 同步收窄（r76-B）
- 运行期 error 拆码 `runtime-error`（r75 code medium#3）：spawn.ts 以 `child.pid == null` 判 spawn 窗口与运行期崩溃（resolve 在 IIFE 同步段无条件执行，ENOENT 的 reject 恒 no-op——pid 是现成窗口区分零新变量）；task.ts error handler 接 err 参数透传真实诊断；onError 签名补码（vitest 走 esbuild 无类型检查全测绿漏网，`pnpm build` tsc 首跑即红——r76-G 验证链前置抓获）；shared `TerminalCode` 24 → 25 项；panel 文案「CLI 运行中异常退出」不入未送达族（正文已过 stdin，tips 不误标「分享未成功」）（r76-C）
- host-disconnected 三路径三戳统一（r75 code medium#4）：App 断连路径改 `stampTerminal('host-disconnected')` 同值（原实时路径零三戳、收尾路径硬编码 undelivered:true 相异）；terminal.ts 注释点名不收编 UNDELIVERED_CODES（r76-D；App 零直测无独立变异网，挂账）
- 启动前失败族 14 键文案单一事实源 + 双通道去重（r75 product high#3）：`START_FAIL_LABEL` 从 App.tsx 内联拆进 terminal.ts（帧/回调双通道同查，首跑授权失败不再「未知错误（码 no-permission）: 裸英文」）；SW 启动前失败族四 return 补 taskId——帧已渲染并 push finished 台账，return 后迟到回调被 finished 守卫拦下不再叠双气泡（r76-E）
- 版本横幅 E404 出路口径对齐 + README 排障补 E404（r75 product low + high#4）：sw.ts outdated/upgrade 两横幅尾注抽 `E404_HINT` 单源——Issues 反馈出路 + 勿手改装其他版本（跨版本协议不匹配比 E404 更难排查），对齐 install.sh/Onboarding 口径（原「稍后几分钟重试」）；README 自查①步补同口径括注；CWS zip 以 r76 构建重打包（原 zip 为 10-08 陈旧构建、缺 r72-r75 修复，按文件名信任直传即向商店分发残缺物），`package-cws --check-only` 双绿（r76-F）

### Added（r76 批）

- 251 → 254 用例：task.test.ts 零产出 is_error 轮落盘豁免用例；terminal.test.ts runtime-error 三戳用例 + `START_FAIL_LABEL` 14 键全集用例（删键即红）；sw.test.ts r74 两用例修活与 r56#4 用例补 taskId 断言为存量改造（计数不变）

### Docs（r75 批——双终审报告入库）

- r75 双终审报告入库（`reports/2026-10-12-r75-*-audit.md`）：代码 7.5 否（与 r73 持平——r73 判词「补齐三条 high 测试缺口」实补两条半：error 用例变异实证有牙、terminal 9 直测确认真模块，但 **sw 两用例经双重变异实证红条件虚假**（守卫/级 2 删除均不红，high——r74 计数凑数）；新浮三条 medium：persist 零产出守卫分裂（timeout/finish 裸调落空体历史）+ is_error 正文不入册 / 运行期 error 复用 spawn-fail 码致已交付轮误标「未送达」/ host-disconnected 三路径三戳相异；对抗验证自身可靠——审计员变异测试残留曾被当 high 指控、复核员三连实测证伪）；产品 6.5 否（r73 三条 medium 全真清、r74 批零水分 docs 9 分；发布链 critical 第 14 轮续计 + 新钉两条 high：远端 E404 旧文案误导查网络 / **首跑授权失败渲染「未知错误+裸英文」叠双气泡**（8 个可达码不在 ERROR_LABEL + onStartResult 无 taskId 台账守卫失效）+ CWS zip 陈旧 4 天缺 r72-r74 修复；判词「代码离可发布差一步终端操作，产品离可安装差整个发布动作」）

### Fixed（r74 批）

- host 历史路径生成收敛进 `persist`（r73 code high#1 的用例钉出 r72 C8 修复自身缺陷）：child 运行期 error 终局此前不生成 `historyPath` 就调 `persist`——`saveHistory('')` 必败（`ENOENT open ''`），有产出轮静默丢失落盘；四处终局调用点的重复 `||=` 生成一并收敛进 persist 非 resume 分支（追问轮 append 语义不变；host 行数 2199 → 2192）
- App.tsx 终局三戳收敛 `terminal.ts`（r73 code high#2 + low#8）：过期帧/实时帧/missedErrBubble 三处内联判定拆为 `stampTerminal()`（cancelled / undelivered / cliFault 三戳，对齐 missed 版三排除——零行为变化）；`UNDELIVERED_CODES` 收编 `host-shutting-down`（收割窗拒收 = 正文从未过 stdin，tips 分流「分享未成功」）；`ERROR_LABEL` 键域改 `Partial<Record<TerminalCode, string>>` 与闭集编译期互锁（App.tsx 1159 → 1137 行）
- install.sh E404 出路去跨代漂移（r73 product medium#3）：去掉「`npm view` 查最新版改装」指引——新旧版本间消息协议可能不匹配；改为到 Issues 反馈、发版后重跑本命令（URL 单独成行可复制）
- Onboarding FAQ E404 死源改活（r73 product medium#4）：指向 GitHub Issues 而非零 release 的 releases 页，补跨版本协议不匹配警告

### Added（r74 批）

- 239 → 251 用例：task.test.ts 运行期 error 分支贯通用例（fake CLI 先吐帧后 error——标记文件轮询钉进 50ms 攒批窗内的时序：尾段靠 `flushDelta` 冲出 + 历史落 `status: interrupted` + spawn 即败零产出轮不落盘）；`terminal.test.ts` 9 直测（`UNDELIVERED_CODES` 生产逻辑首次被测试执行：三戳谱全覆盖 + `host-shutting-down` 收编钉 + 已送达/未送达族采样 + `ERROR_LABEL` 键域）；sw.test.ts `resolveContentTab` 落级链两用例（有锚但锚 tab 已关 → 跳 target 单例落级 3 活跃页 / 无锚 → target 单例兜底语义保持）
- shared 导出 `TerminalCode` 终局码闭集（24 项 union）：`TaskErrorMsg.code` 8 键 ∪ SW 盖戳 3 键（host-disconnected / ext-restarted / session-lost）∪ SW onStartResult 未送达族 13 键；协议帧 `code` 保持 `string`——跨进程边界诚实，闭集外迟到新码仍落 panel 兜底「未知错误」

### Changed（r74 批）

- `package-cws.mjs` manifest 一致性改双侧键集并集全量深比较（r73 product medium#6）：原六键枚举漏了 background / side_panel / action 等——新键自动纳入零维护（实测 dist / public 键集恒同 13 键，构建原样拷贝不注入键）

### Docs（r73 批——双终审报告入库）

- r73 双终审报告入库（`reports/2026-10-11-r73-*-audit.md`）：代码 7.5 否（运行时 0 critical / 0 high；r71 六条 confirmed 修复经当前代码实读全部真清、五入口攻击链不可达、七硬约束全 PASS、C1 接收端 sender 闸实测销账——但 tests 维度 5.5：r72 唯一数据丢失级修复（task.ts error 分支 flushDelta+persist）零测试钉住（high）、undelivered 四落点全落零直测的 App.tsx 1159 行（high，tips 测试手搓 props 非贯通）、resolveContentTab 防跨窗错页分支零用例、双侧无失败流 fixture、UNDELIVERED_CODES 与协议 code 类型零联动（C7 续账）——判词「补齐三条 high 级测试缺口后可复审冲 8+」；首轮 tests 维度 agent 未交付整丢、评分虚高 8.0/是，同 runId resume 补跑后重裁 7.5/否）；产品 6.5 否（发布链 critical 第 12 轮 + 同根因 high：r72 E404 出路三条对真实用户是画饼——修复封存在未推的 105 commits，远端用户拿到的是无出路旧文案；medium：出路教装 0.1.2 跨协议漂移无警告 / Onboarding FAQ 指向零 release 死源 / CHANGELOG「16 处 satisfies」实数 15（第五轮计数水分复发，见下行修正）/ package-cws 深比较漏 content_scripts/commands/background / P7 CWS 材料三件第 12 轮仍缺）
- 计数修正（r73 product C6 + code quality 同抓）：r72 批「三文件 16 处发送帧补 `satisfies PanelToSw`」实数 15 处——第 16 个 grep 命中是 protocol.ts 闸注释行而非发送帧（Settings 10 + HistoryView 4 + Onboarding 1）；commit 18fe375 message 同虚高（git 历史不可改，以本条为准）

### Fixed（r72 批）

- task.ts error 终局分支补 `flushDelta` + `persist`（r71 code C8，全仓唯一数据丢失类）：child error 事件此前不冲流不落盘，运行期错误轮的已产出输出凭空消失；收紧为有产出（`accText` 非空）才落「interrupted」——零产出轮（spawn 即败）不写空历史，与 spawn-fail 路径同谱
- undelivered 四落点补齐（r71 code C2/C3/C6）：过期 task-error 收尾气泡补 `cancelled` 分流（取消终局此前漏盖「已停止」）/ `ERROR_LABEL` 补 `host-disconnected`（断连终局此前显示原始 code）/ `UNDELIVERED_CODES` 收编 `content-mismatch`（SW 侧该终局 = 正文对账超时即取消，spawn 前拦截，CLI 从未收到完整正文——按未送达计）/ 看门狗气泡与断连新气泡补 `undelivered` 落点
- `resolveContentTab` 级 2 加同窗约束（r71 code C5）：有帧锚但锚 tab 已关时跳过 target 单例兜底——target 可能是别窗面板 action 点击的 tab，静默错页跨窗；落级 3 活跃页（「用户正看」有 r46 安全论证 + page-meta 回显纠偏）；无锚保持 target 旧单例语义
- manifest description 143 → 98 字符（r71 product P4）：原文案超 Chrome manifest ≤132 上限，CWS 上传确定性打回 `Invalid value for 'description'` 而三道守门零拦截
- agentsLoaded 10s 超时兜底（r71 product P2）：r71 门禁引入的「正在检测」永久死路（探测响应丢失则重试按钮永不出现）解除

### Changed

- Settings / HistoryView / Onboarding 三文件 15 处发送帧补 `satisfies PanelToSw`（r71 code C11，r71 C3 收口余波；计数 r73 修正——原记 16 处系把 protocol.ts 闸注释行计入）：App/SummarizeView 之外的 panel → SW 裸发字面量此前在类型闸外，字段拼错零编译错；protocol.ts 闸注释口径同步扩到四文件
- `package-cws.mjs` 双加固：description ≤132 断言（超限 exit 1，堵 P4 同类回流）+ 打包前删旧 zip（`zip -r` 增量更新会残留上一版已删条目，r71 product P6）

### Docs

- PRIVACY 英文 Summary 默认模型读取补两路径（r71 product P3）：claude `settings.json` 的 `model` 或 `env.ANTHROPIC_MODEL`、codex `config.toml` 的 `model`——与中文段及实现对齐（此前英文只写泛称）
- install.sh E404 指引可操作化（r71 product P1）：钉住版本未发布时给三条出路——`npm view dist-tags` 查最新版 / 装最新已发布版 / GitHub Issues 反馈（此前只说「版本可能未发布」无出路）
- r72 批零新测试（239 维持）——C9/C10 测试债（UNDELIVERED_CODES 盖戳端 + App.tsx 直测）挂账 r71 报告



### Fixed

- startSummarize 链尾裸 `tabs.query` 补防（r70 code#1）：内容源三级回退（帧锚 → target → 活跃页）的最后一级此前无 catch，Chrome API 抖动时未捕获 rejection 白死；panel-ready 异窗锚解析独立 `resolveRespAnchor`——query 空结果/异常静默回退单例锚（r69 修复目标场景不再无声退化）
- tips 终局语义分流（r70 product C9 + L3/L4）：「分享未成功」判定收敛为「页面未送达 CLI」终局 code 集（提取/注入/通道未起）——timeout / CLI 运行内失败 / 断连等正文已过 stdin 的生成阶段失败如实显示「已分享」（同屏错误气泡已陈述事实，说未成功会误导用户查提取/授权）；取消终局独立第五态「已停止」；过期 task-error 帧的收尾气泡 error 按 code 分流（此前硬编码「已取消」）
- `sudo npm uninstall -g` 时 preuninstall 钩子以 root 跑 rmSync——uninstall 补 `assertNotRoot` 守卫（install / postinstall 同款，对称防御）

### Changed

- panel → SW 全部 13 处发送帧 `satisfies PanelToSw` 类型闸（r70 code#3）：anchorTabId 等字段拼错从「零编译错即静默回退单例」变为发送侧编译红（此前仅 SW 消费端有闸）；protocol.ts 注释同步收窄口径
- CWS 打包守门断言扩面（r70 product C8）：dist↔public manifest 一致性从 version/description 两字段扩到 name / permissions / optional_host_permissions / icons（深比较），`action.default_icon` 补进产物完整性清单——改权限面后未重建 dist 时旧权限不再静默上架

### Docs

- CHANGELOG 版本账归位（r70 product C7）：r59 之后至 r70 的修复从 Unreleased 并入 0.1.4 段（三处钉版 0.1.4 未发布，这些修复本就属于 0.1.4 实物）；r67 批测试计数补账（229→232 三例此前从未入账，r69 行曾误吞为 229→235）
- AGENTS.md v1 Priority「零配置」→「零账号·零 API key」（D1 r59 修订第二轮漏网，r69 只改了概述行）；PRIVACY CLI 配置读取表述对齐实现（claude 默认模型取 `settings.json` 的 `model` 或其中 `env.ANTHROPIC_MODEL` 两路径，codex 取 `config.toml` 的 `model`）
- 测试 235 → 239 用例：tips 终局五态分流 ×3（未送达 → 「分享未成功」 / 已送达失败 → 仍「已分享」 / 取消 → 「已停止」）+ 异窗锚 query 空结果/异常 → 回退单例 ×1；sw.test shim `tabs.query` 语义保真（queryReject 注入 / active 过滤 / 空结果如实返回 [] 不再谎报默认活跃页——r70 code#2「shim 无法表达 query 失败/空结果」解除）
- r71 low 批（B 批剩余四条）：workflow-read 截断点回退代理对边界（对齐 history-read，task.ts 分片谱保持并注明刻意不同）；Settings/HistoryView 两步确认补 sr-only 播报（对齐 SummarizeView confirmNew 谱）；重试检测按钮补 agentsLoaded 门禁（探测在途不再与「正在检测」并存）；foreignAdopt 收窄暴露并补齐 PanelMsg 的 SW 盖戳声明（tabId 邮戳进类型面）
- 测试数字三处同步 235 → 239（README ×2 + AGENTS.md）：r71 批 +4 用例时漏更，审计前置自查抓出先修后审
- r71 双终审报告入库（`reports/2026-10-11-r71-*-audit.md`）：代码 7.4 否（0 critical / 0 high / confirmed 11——r70 四条判「三真清一假清」：C1/C2/C9 逐字核实收口、C3 satisfies 只盖 App/SummarizeView 半边（Settings/HistoryView/Onboarding 约 15 处裸发在闸外）；新账：task.ts child error 终局分支不 flushDelta 不 persist（全仓唯一数据丢失类）/ panel 帧接收端零 sender 校验 / undelivered 四落点破口（missed 缺 cancelled、host-disconnected 与 content-mismatch 漏收）/ resolveContentTab 二级 target 跨窗错页 / UNDELIVERED_CODES 盖戳端零测试 + App.tsx 1142 行零直测）；产品 6.5 否（发布链 critical 第 11 轮维持——registry 0.1.2 / 远端 install.sh 0.1.3 / 本地 0.1.4 / 98 commits 未推 / 零 tag；新发现：manifest description 实测 143 字符超 Chrome 132 上限，CWS 上传确定性打回而三道守门零拦截；r71 门禁引入「正在检测」永久死路；PRIVACY 英文 Summary 漏改两路径）；双 workflow 骨架三分收集（confirmed/rejected/unfetched）落地，unfetched 0——r70 verify 静默丢失坑未复现

（r59–r70 批）r59 审计修复批（产品 + 代码双终审报告见 `reports/2026-10-05-*.md`）+ r60–r63 审计修复批 + r64/r66 双终审报告入库（`reports/2026-10-07-*-audit.md`、`reports/2026-10-08-*-audit.md`、`reports/2026-10-09-r64-*-audit.md`、`reports/2026-10-09-r66-*-audit.md`）+ r67 修复批（r66 code 可修 medium 3 项（#1/#2/#3）+ low 批，见 Fixed 尾部 r67 条目）+ r69 修复批（r68 code 帧锚半边口收口 + 产品 medium/low 批，见 Fixed 尾部 r69 条目）+ r70 双终审报告入库（`reports/2026-10-11-r70-*-audit.md`）。

### Added

- `pnpm package:cws`：构建 + CWS zip 打包守门一条命令封死顺序；随 r62 入库的 `scripts/package-cws.mjs` 守门脚本与 DECISIONS 破线应急清单当轮漏入账，此处补账
- `scripts/package-cws.mjs --check-only` + CI 步骤：CWS dist 完整性断言（manifest 声明产物逐一在盘）从手工前置变机器执法——残缺 dist 打进上架包即「装到点总结必死」（r64 产品#6）

### Fixed

- 面板 → 本机组件的消息只放行协议已知帧（nm 白名单，防面板被注入后任意调用本机原语）；孤儿终局帧不再误标完成角标；跨任务分片序号水位防串写
- 追问发送后 15 秒无确认自动取消并提示重试——此前本机通道丢帧时追问会永久转圈且无自动收敛
- CLI 输出异常形状（版本漂移导致 result 变对象）不再引发本机组件退出、殃及其他在跑任务，降级为单任务失败；终局字段单源构造，杜绝三处手写漂移
- 历史目录权限收敛补齐 prune 清扫路径；chmod 失败留痕可排障
- `install.sh` 安装失败（E404）时给出 GitHub releases 确认版本的人工排障出口
- 限流类错误（rate limit / 429）不再误报为「额度耗尽」——限流档判定前置并覆盖 snake_case 变体，指引改为稍后重试
- 授权弹窗被拒绝或失败时不再静默——按钮旁显式提示可重试或改用逐页授权
- 双窗口防误杀：面板「停止」与历史降级路径的取消消息带 taskId 定向取消——此前 B 窗历史页降级路径的裸 cancel 会连坐砍掉 A 窗在跑任务（SW 侧裸帧语义保留，仍承担 SW 回收后的收割恢复路径）
- task-timeout 测试去真实时钟依赖（超时裕量 1500→5000ms、终局链改事件驱动轮询替代固定睡眠）——产品/代码双终审同日各自独立观测到的负载敏感假红根因
- claude 流畸形 `text_delta.text`（非字符串）不再污染增量累积；网页元数据消毒补 C1 控制符区间（U+0080–U+009F）
- 安装 FAQ 补「npm 装成功但 command not found」排障条目（自定义 npm 前缀的 PATH 出口——`&&` 短路后登记不发生且面板无自愈提示）
- 双窗生命周期收口（r64 code#1/#2）：面板「继续对话 / 新对话」在 SW 侧只收割本锚页签的在跑任务——此前无条件收割连坐别窗在跑任务白烧订阅额度；换锚广播带 windowId，双窗双面板各只认自己窗的换锚，共享锚架空收养守卫（foreignAdopt）的窗口关闭
- CLI 输出 assistant 消息 content 非数组或元素畸形（版本漂移 / hook 污染）不再引发本机组件退出殃及其他在跑任务，也不再把 "undefined" 拼进正文（对齐 text_delta / result 同族形状闸）
- SW 回收后重开面板的自动还原剥离历史文件 frontmatter 头——此前 title / url / ts 元数据被渲染成对话首条标题（HistoryView 详情路径已有同款剥离，自动还原路径漏）
- r67（r66 code#1）：面板「总结 / 继续对话 / 新对话 / 历史还原」帧携带 anchorTabId——SW 收割、sessions 记账、任务戳全路径用发起面板的锚页签，单例被别窗面板覆盖后误杀/漏杀双向闭合（帧无锚时回退 panelTabId 单例，r65 用例语义不变）
- r67（r66 code#2）：历史「继续对话」传原文——frontmatter 剥离唯一收口 parseHistoryTurns 入口，此前已剥 body 被二剥、正文首行恰为 --- 水平线时丢首段；负对照用例钉单剥语义
- r67（r66 code#3）：双窗不拆台契约钉入测试——他窗 onActivated/onCreated 不 disable 不扰动、同窗照收且预 disable 只扫锚窗口、panelWindowId 缺失宁可收起，此前该分支零测试
- r67（r66 low 批）：sr-only 终局性质分流（取消/错误不再播「已完成」）、tips 三态（取消后/codex 还原不再显示进行时「正在分享」）、Settings CLI 开关 a11y 反转修正（name 改陈述状态）、manifest 删「免费」（与订阅额度事实矛盾）、README/install.sh 拆 `&&` 拼接命令、DECISIONS 行数口径对齐实测 2196/余量 4
- r69（r68 code#1/#2，帧锚半边口）：panel-ready 帧带 myWindowId，SW 面板锚播种按发起窗解析真锚（异窗面板的活跃页签，回包 panelTabId 同锚）——双窗下拉重开不再击穿单例；「总结 / 继续对话 / 新对话」内容源同帧锚（anchorTabId 优先，缺锚回退单例 → target → 活跃页）——错页 + 会话错乱双向闭合
- r69（r68 code#3）：SW 回归网 chrome.tabs.query mock 参数化（windowId 过滤 tabsDb / queryTab 注入任务源）——帧锚用例补误杀向鉴别力（此前 mock 恒返 11，seed 22 + 帧 22 零 cancel 对回退路径无鉴别力）
- r69（r68 code#5）：面板 → SW 帧协议收敛 `PanelToSw`（`AnchorCarrying` 可选锚 + 五帧联合类型）——anchorTabId 拼错从「零编译错即静默回退单例」变为编译错，协议 any 第三例封口
- r69（r68 low 批 + 产品 medium#5/#7）：安装命令 npmCmd 拆两行（`npm i -g …@version` / `install --ext-id …`，`white-space: pre-line`）；复制按钮 aria-label 随 copied/copyFail 变化；tips 补失败第四态（终局 isError 且未取消显示「分享未成功」）；过期 task-error 帧补 cancelled 标记；技能开关 aria-label 改状态名谱；AGENTS.md 概述「零配置」对齐 D1 r59 修订；`package-cws --check-only` 加 dist↔public manifest version/description 一致性断言（陈旧 dist 带旧文案上架的守门缺口）
- 额度耗尽类错误（usage limit / quota / insufficient credits）给出中文指引：等待额度重置、升级套餐或切换账号后重试
- PDF 页面不再给出「滚动到底触发懒加载」的无效指引，改为专项提示：转存 HTML 或复制正文粘贴为附件后追问
- 设置页 host 错误码中文化（读取失败 / 名称不合法 / 删除失败 / 打开目录失败），未知码兜底「未知错误（码 X）」；面板错过终局后的复读气泡同样过 authHint 归一
- 修复带 taskId 的取消在扩展端无句柄时退化为「取消最近任务」、误杀其他窗口在途任务的竞态——改为拒收
- 修复面板在线时 host 原生错误仍入收件箱导致的重开复读（对齐「有接收端不入箱」判据）
- 修复多标签页下迟到终局帧串台归档——改按任务源页签台账路由，别页签绝不捡会话
- 修复重复流式分片导致正文二次 append（panel 侧 seq 去重守卫）
- CLI 二进制按探测同源的绝对路径调起，消除 PATH 前置用户可写目录的影子二进制面

### Security

- 存量目录权限收敛补齐三缺口：attachments 根与年月目录、历史旧年月目录、workflows 根统一收敛 0700（原 0755，同机其他用户可枚举文件名）

### Changed

- 扩展构建挂 `tsc --noEmit` 类型门禁（vite 转译不查类型导致的历史假绿根因）

### Docs

- 测试 210 → 219 用例：CLI 真实流 fixture 重采（claude 2.1.162 / codex 0.156.1）+ 重放断言从「unrecognized 计数」单锚升级为「累积正文 === 采录终稿」双向锚
- 测试 224 → 229 用例（r65）：assistant content 形状闸 / frontmatter 入口剥离 / SW 收割定向化 / 停止按钮 cancel 帧契约 ×2（r63 M1 修复钉住）；README 五档名对齐 workflow-labels 实名（论文模式 / 去 AI 味改写）、测试数字 25 文件口径补齐
- 宪法同步：DECISIONS D3 权限清单补记 `storage`、「始终允许读取网页」开关实装位对齐授权气泡；README 档位列举补第五档「产品审计」；PRIVACY activeTab 行表述理顺；测试 219 → 224（C1 消毒 / 畸形 text_delta 闸 / SummarizeView 授权开关冒烟 ×3——UI 组件测试设施第一锹，`@testing-library/react`）
- r66 双终审报告入库：代码 7.8（0 critical / 0 high / 7 medium——收割定向化半边残留、frontmatter 双剥丢首段新洞、测试债在涨）；产品 6.0 否（发布链第 7 轮 critical 维持、实驱 9 场景全绿）；本行上方 Unreleased 头措辞同步如实化（Top5 必修 2/5 → 如实分列，r66 产品#5）
- r68 双终审报告入库（`reports/2026-10-10-r68-*-audit.md`）：代码 7.6 否（0 critical / 0 high / 7 medium——r67 帧锚修复「只收半边口」：面板锚播种与内容源 target 仍读单例）；产品 6.0 否（发布链第 9 轮 critical 维持、断口 74→81、远端 install.sh 钉 0.1.3 双版本 E404 补强；r66 low 批四项 + 两条 code medium 产品面实驱全部关账；新账 3 medium：面板 npmCmd 裸 && / dist 滞后守门不查一致性 / CHANGELOG 计数措辞）
- 测试 229 → 232 用例（r67 批，r70 产品审计 C7 补账——3 例此前从未入账，r69 行曾误吞为 229→235）：帧内 anchorTabId 对号收割双向闭合（`195aeac`）/ frontmatter 后 --- 水平线开头单剥（`feadfc7`）/ 双窗不拆台契约（`e0e9a66`）各 +1
- 测试 232 → 235 用例（r69）：帧锚三用例（panel-ready 异窗回包锚 / summarize 内容源帧锚优先 / 帧锚误杀向鉴别 + 对照）；README ×2 + AGENTS.md 测试数字同步
- r70 双终审报告入库（`reports/2026-10-11-r70-*-audit.md`）：代码 7.8 否（0 critical / 0 high / 4 medium——r69 帧锚收口经对抗验证确认、r68 核心否决点已解、硬约束 7/7 PASS；新账：startSummarize 链尾 tabs.query 裸奔无 catch / shim tabs.query 语义失真掩蔽空结果分支 / PanelToSw 收敛只做接收端半边 / 复杂度热点第五轮净升）；产品 6.5 否（发布链第 10 轮 critical 维持——registry 0.1.2 / 远端 install.sh 0.1.3 / 本地 0.1.4 三断链 + 85 commits 未推 + 零 tag；去重后独立新账 3 medium：CHANGELOG r69 测试计数增量归因失真（229→235 中 3 例实为 r67 批从未入账）+ 版本账错位（r66–r69 修复全堆 Unreleased 而 0.1.4 段仅 r59 批）+ tips 失败第四态矫枉过正（timeout/is_error/断连等正文已送达的失败终局也被标「分享未成功」——复核后补收：verify agent 未走结构化交付被 workflow 静默丢弃，按对账差额从 transcript 提取补录）；r69 四项 UX 修复经实驱 + 静态双路核实全部兑现）
- README 移除「CWS 审核中」失实表述，改为「准备提交 CWS，上架前先手动加载」；开发者节补 `pnpm test` 与 210 用例口径
- DECISIONS.md 三处修订同步（D10 install.sh 主线、v2 路线图移出已交付项、决策 #1「零账号 · 零 API key」口径）
- packages/shared 版本对齐 0.1.4（原脱轨 0.1.0）；测试 203 → 210 用例

## [0.1.3] - 2026-10-05

### Added

- 第七氛围档「墨岩」：近黑月光底梯 + 冷白微蓝光斑，刻意低通量防黑底泛灰；档位网格改 4 列两行齐（`da984dc`）
- 本 CHANGELOG.md
- 设置页「数据」tab：历史条数（50/100/200/500，默认 200 + host 按条数落盘清理）、打开历史目录、落盘说明；历史列表常驻底栏直达设置（`1d62686` `819029b` `76f39a5` `08c4688` `0943110`）
- 设置「始终允许读取网页」开关：optional_host_permissions 用户主动授予后换页免重新授权；安装时零权限警告、默认关闭（`207063d`）
- 一键总结跟随记忆档：CTA 主按钮与空输入 Enter 均用上次所选 workflow，按钮名=实跑档；quick 为主档时次按钮提供深度入口（`fa4db49`）
- CLI 版本漂移感知：引擎下拉内联版本基线提示（低于解析器实测基线仅警告不拒跑，守零配置支柱）；失败气泡附未识别事件计数与重采样指引（`60b00b2` `060ff9e`）
- 内置技能 4→7：行动清单 / 时间线 / 断言审计；技能按任务注入，quick 档跳过保轻快（`a61e9f0` `91db090`）
- 分享改下拉渠道菜单（微博 / X / Reddit / HN / Bluesky，零新增权限）（`044814c` `6297fa3`）
- 全套进退场对称动效（hero / chip / 菜单 / 弹层，reduced-motion 全豁免）；mac 快捷键保持 ⌘⇧D（`0c09b8d` `648103c` `b339098` `b3d3946` `536b759` `7276b72`）
- 无障碍键盘全家桶：tablist / listbox / radiogroup 统一 roving 导航、overlay 焦点陷阱 + Esc 还焦、历史删除键盘可达（`017ce90` `0689adf` `20a9937`）

### Fixed

- 图标点击开面板回归：`sidePanel.open` 恒同步执行以保住 user gesture，toggle 仲裁移 panel 侧（`2a68356`）
- 历史详情还原失效：history-file 读取 `.content` 字段修复（`2ecdcf3`）
- 附件超 NM 帧限：附件预算压回 1MB 分片以内（`2ecdcf3`）
- 安装引导防闪跳：probe 防 stale-port 误判（`2ecdcf3`）
- 无障碍五连：读屏洪泛收敛 / overlay 对话框语义 + Esc / 历史读取 loading + 5s 超时 / 图标按钮可访问名 / 复制失败兜底（`33b34c0`）
- 文案九连：删三重冗余引导、时限真实化（「秒级出稿」→「约十几秒」）、品牌名统一为 AI PageDive、术语统一（深度总结/本机组件/可自定义）（`4afdecb`）
- manifest 最低 Chrome 版本 114 → 116（`sidePanel.open()` 实际引入版本，114/115 下图标点击会静默失效）
- 冷启动竞态根修；SW 合成终局入箱 / 迟到失败句柄守卫；对账回执被吞 15s 兜底终局（`5f6db4a` `cc5cb79` `df8a869` `e363fa4`）
- 终局收敛族：is_error / 超时 / 取消 / 崩溃路径零临时文件残留；spawn 失败带真实诊断（ENOENT 等，不再只报退出码）；exit→close 修 stdout 尾部 result 误判（`ad20bf5` `85f3dd2` `a35d671` `359a308` `72d3198`）
- 长文质量族：删「humanize」类物理不可达指令、大纲截断如实披露、不可信内容围栏翻转（`6c89bdf`）
- 正文跨 128K 切降级时的白屏（hooks 顺序）修复；吸底双轨冲突收敛（拖滚动条停不下来）；代码 / 全文复制失败显式态不再谎报；历史遮罩残影压灭（`d28f730` `6f79d31` `91db090` `bbb31d9`）
- 权限与错误归因：no-permission 误伤拆分（page-not-ready / extract-crash / tab-closed / inject-failed 各归位）、cliFault 区分启动前失败与 CLI 运行失败、错误终局不再触发 toggle 收起面板打断自救（`373eca8` `6111bb7` `b1464ab` `cd016eb`）
- 追问与 resume：codex 无 sessionId 也归档供重开还原；resume 防重读已删死文件；受限页只拦首轮发送，追问轮不受影响（`4c1e3a6` `03d2409` `5195de1`）
- 安装与卸载：安装脚本 PATH 探测死循环 / RC 优先级 / 尾部哨兵；卸载 hostPath 断链 / pgid 孙进程逃逸 / 虚报计数（`6185b8a` `fa29d32`）
- 细节族：CJK token 口径对齐、iframe 顶层锚定、附件 chip 布局回归、用量分隔符悬空、模型识别补读 env（`df8a869` `275e4ef` `5a7168e` `f96d01d`）

### Changed

- 对比度与 token 卫生：snippet / chat 小字提亮一档、brightness 残留换 accent-hover、头注 blur 区间对齐实况（`f38c842`）
- 默认模式正名「深度总结」；product-audit（产品审视）提为内置第五档（`f96d01d` `6297fa3` `b556cf8`）
- 对外叙事如实化：「零配置」→「零账号·零 API key」，PRIVACY / README / 分享文案全口径对齐（`e8c1880` `9337f47` `85f1249` `49f4985` `6d92af0`）
- host 提速：claude -p 跳过 MCP 连接段（CLI 冷启 10s+ → 1s）；NM 出口背压（`faa3021` `4569add`）
- 回归网扩到 203 用例（codex 端到端 / NmPort 直测 / SW 回归网 / StreamMarkdown 渲染）；CI 增版本一致 ×7 与已发布钉版门禁、host 行数红线（`157a229` `158abfa` `a7a6303` `b2ecf83` `d28f730`）

### Removed

- opencode 实验档：macOS Gatekeeper 对 Bun 运行时释放的 JIT dylib 必弹必杀（xattr / 豁免实测无效），上游修复打包形态后恢复，恢复路径见 DECISIONS.md D5（`5ed28f8` `85f3dd2` `9b112c9`）

### Security

- 远程 img 一律不渲染：`![](https://…)` 曾是绕过 CLI 网络围栏的泄出通道（查询参数外带）（`5f6db4a`）
- claude 侧权限收紧：`--permission-mode default` 防用户全局 bypassPermissions 拆掉拒绝面 + Read 收紧为路径白名单（正文 / agentCwd / 附件三根，realpath 双份）（`bbb31d9`）
- 历史分段标记写侧转义：正文伪造 `pd:user` / `pd:assistant` 不再注入假轮边界（`90db294`）
- 正文临时文件终局即删 + `~/.ai-page-dive` 全树 0700；sanitizeMeta 不可见字符区间补齐（防 bidi / tag 注入）；附件 symlink 穿链解析；同名 workflow 覆盖走 wx 守卫不再无条件 rename（`a35d671` `359a308` `72d3198` `1d21cb1`）
- 采样 fixture 脱敏：剔除 hook 帧 / cwd / session_id 等敏感键并重采样替换（`bdeba36`）

## [0.1.2] 及更早

未单独维护，见 git 历史（`git log --oneline`）。
