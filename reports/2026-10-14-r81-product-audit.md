# r81 产品功能严苛审（2026-10-14）

**HEAD** `f3dbc44`（工作区干净）· **方法** 7 维 finder → 主编去重 → 逐条对抗复核（三分收集）→ 终裁 · 18 agents / 602k tokens

## 审前自查（主编实测基线，注入全部审计员 prompt）

- npm registry `dist-tags.latest=0.1.2`（0.1.3/0.1.4 均从未发布）；本地三包 0.1.4，origin/main 落后 139 commits
- 测试 279 用例：首轮 2 红（r80 双闸看门狗时序类），复跑 ×2 全绿 → 判 flaky，与 F21 互证后按真实可靠性缺陷计入
- **远端 install.sh 钉 0.1.3 / 本地钉 0.1.4 双钉不一致**（审计员实测 `origin/main:install.sh` + raw.githubusercontent.com 双通道确认）

## 三分对账

| 项 | 值 |
|---|---|
| 维度交卷 | **7/7**（无缺维度，总分无虚高风险） |
| 原始发现 | 27 → 去重 27（代码去重零吞并；同根跨维重复由终裁人工合并） |
| confirmed / rejected / unfetched | **10 / 0 / 0**（复核全确认零驳回零未决） |
| low 直通 | 17 |

## 终裁

**score 4.5 / 10 · isHighQuality: 否。**

扣分账：8 − 2.5（发布链 critical 同根合并计一次）− 1.0（四 medium：F12 −0.4 / F11 −0.25 / F18 −0.2 / F19 −0.15）− 0.5（low 面信号）+ 0.3（未发布态诚实披露回补）≈ 4.5。

裁决要点：核心总结流（core-ux 自评 8）与隐私姿态（trust 自评 8）确有专业水准，但从严口径下「新用户零通路 + 追问轮承诺与实态背离 + 同型错误处理缺陷三犯」不足以称高质量专业产品。**发布链修复（publish 0.1.4 + push）可快速回升至 6+；追问轮快照与错误文案补齐后可达 8 门槛。**

## 维度分

| 维度 | 分 | 一句话 |
|---|---|---|
| value 产品定位与价值锐度 | 7 | 主张在代码层逐项验证成立（零遥测实测、stdin 正文、深读兑现）；被交付面拖累 |
| onboarding 安装链路 | 3 | 设计层质量很高，但今天对新用户 100% 断裂（E404 + 指引对不上真因） |
| core-ux 总结主流程 | 8 | 三段 phase + 心跳 + 双闸 + 流式降级 + 终局三戳，成熟度高；仅 3 条 nit |
| followup 追问与附件 | 7 | 主链可靠披露诚实，但零膨胀承诺在主场景失效（F12）+ 一处假如实披露（F11） |
| errors 错误处理与可靠性 | 6.5 | 体系扎实（双表三戳单一事实源），但 r75/r76 同型缺陷第三犯（F18）+ 文案与双闸脱节（F19） |
| trust 权限隐私与信任 | 8 | manifest/存储/零凭证/无遥测逐项对得上，PRIVACY.md 披露粒度罕见地诚实 |
| docs 文档与可发现性 | 4 | 本地口径高度咬合；要害在远端（README 无 E404 条目、钉 0.1.3、&& 吞错） |

## confirmed（同根合并后 7 个独立根因）

### 🔴 C1（critical）发布链断裂——新用户安装 100% E404（F1+F4+F24 同根，第 15 轮续计）

- 远端 install.sh（raw.githubusercontent.com，用户 curl 到的）钉 `@0.1.3`，registry 仅有 0.1.2 → `npm i` 必 E404；远端失败指引只有 EACCES/nvm/网络三条，对不上真因，用户无法自救
- 本地 139 commits 未 push：E404 出路文案（install.sh:47-49）、README FAQ 条目均已写好但「对真实用户不存在」
- **push 之后、publish 之前依旧 E404**（本地钉 0.1.4 亦未发布）——必须 publish 先行或同批
- 修复：任务 #2 既定链路（npm publish 0.1.4 → push → tag v0.1.4 → check-published 绿）；建议补 CI 断言「install.sh 钉版 ∈ npm versions」

### 🟠 M1（medium）r77b 指纹不持久化——零膨胀承诺打不中目标场景（F12）

`sw.ts:67` 注释自认「SW 回收后 Map 即空 → miss 照附」；`persistSession(:104-108)` 不含 lastSnap。任务 done 后 ~30s SW 回收，「读完总结隔一分钟追问」主场景冷启动 → 未变页面仍全量重附（上限 480KB 双份正文），面板还披露「已附快照」误导。修复：指纹（或 hash+会话标识）并入 storage.session。

### 🟠 M2（medium）指纹 Map 只键 tabId，跨会话假命中（F11）

`sw.ts:68` `lastSnap = Map<tabId>`；`:635` resume-history 不清 lastSnap。同 SW 生命周期内总结页 P 后恢复旧会话再追问 → 指纹全文相等假命中「页面无变化」零附件，CLI 拿旧版正文作答、tips 失实——违反 r57/r71 如实原则。修复：resume-history/new-session 时 `lastSnap.delete(anchor)` 或指纹键加 sessionId 维度。

### 🟠 M3（medium）host-not-found 族：缺文案表键 + 四 return 缺 taskId（F18，r75/r76 同型第三犯）

`sw.ts:989/1000/1280/1314` 四落点 `return { error: 'host-not-found' }` 均无 taskId（对照 r76-E 补账的 :1231-1241 均带）；`START_FAIL_LABEL`/`ERROR_LABEL` 两表均无此键 → 帧通道落「未知错误（码 host-not-found）」、回调通道落英文裸码，同一失败双气泡。SW 明明备好中文重试指引（message 字段）却没被用上。修复：补键 + 四处补 taskId + 键全集断言 + 双通道单测。

### 🟠 M4（medium）timeout 文案「上限 10 分钟」与 r80 双闸语义脱节（F19）

`terminal.ts:14` 仍写 r52 旧口径；`task.ts:302` 硬上限 = 10min × 3，idle 闸续命下任务可合法跑 30min，被强收的用户读到假信息。修复：文案去具体分钟数或按硬上限口径改写。

### 🟠 M5（medium）远端 README 独立事实错误（F25，随 push 解决）

远端 README 无 E404 条目；第 44 行手动备选 `npm i …@0.1.3 && …` 单行 && 吞错且钉的版本不存在。本地均已修（README:43-46 两行 + :104 E404 出路）。

### 🟡 M6（medium，从轻）本地钉版 0.1.4 窗口期（F5+F27）

先 bump 后 publish 的窗口期（当前即处于此窗口）内跑 HEAD 脚本同样 E404，但有出路文案 + CHANGELOG 诚实交代，属可接受设计取舍。随发布链闭环自然消除。

## low（17 条，面信号归纳）

- **文档账陈旧**（F2+F26 同根）：README 开发者节 271 用例/26 文件，实数 279/28——AGENTS.md 已同步，README 漏更
- **披露口径不对称**：截图跳过零提示（F9）、图文混贴静默丢图（F13）、retina 自动截图易静默超预算（F8）、快照对半截断不回升浪费近半预算（F15）、预算回退丢快照时 tips 与实态不符（F17）
- **行为分裂/脆弱**：追问空输入行为随页面变化分裂（F14）、codex resume 识别绑死单英文正则（F16）
- **回归网自身温床**：session-lost 文案两表逐字重复无同步断言（F20）、双闸测试真时钟窄裕量负载敏感假红（F21，与审前自查互证）
- **叙事精度**：CWS 门面「内容不出本机」无限定语（F22）、AGENTS.md 授权入口描述停在 r47 前（F23）、README 称 codex「完整支持」未披露围栏弱一级（F3）、onboarding E404 归因口径与 install.sh 不一致（F7）、install.sh 无平台前置门（F6）、elapsed 计数 20s 一跳 40s 首现（F10）

## 修复优先级建议

1. **运维**（解锁一切）：publish 0.1.4 → push 139 commits → tag → check-published 绿 → 新机空跑主线实测
2. **代码批**（4 修）：M1+M2 指纹会话维度化/持久化、M3 host-not-found 补键补 taskId、M4 timeout 文案
3. **文档批**：README 测试数 279/28、AGENTS.md 授权入口口径、F7 归因口径
4. **测试加固**：F20 跨表断言、F21 fake clocks
