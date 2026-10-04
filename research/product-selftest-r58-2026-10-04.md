# r58 功能自测报告（2026-10-04）

范围：host CLI / NM 协议 / install.sh / 构建门禁 / dev server / 单测+e2e 六轨道。全程安全护栏遵守：HOME=mktemp 隔离、假 CLI 前置 PATH、未碰真实 `~/Library`、`~/.ai-page-dive` 与全局 node_modules、repo 源码零修改（补丁全打在 /tmp 副本，事后还原、git status 干净）、临时目录与自起进程全部清理。

## 一、测试矩阵（轨道 × 状态 × 实跑命令）

| 轨道 | 状态 | 实跑命令清单 |
|---|---|---|
| host-cli | partial | `pnpm -C packages/shared build && pnpm -C packages/host build`；`node packages/host/dist/index.js --version`；隔离 HOME 裸跑 `install --ext-id`（红）；npm registry 拉 0.1.2 tarball 核对布局；`PAGEDIVE_HOST_ENTRY` 注入后干净/预建目录 install、manifest JSON 断言、重复 install 幂等、uninstall + find 残留核验；源码核对 uninstall.ts 计数逻辑 |
| nm-protocol | partial | NM 协议全链路对打（spawn `dist/index.js --stdio`，4B 小端长度前缀+JSON 分帧，隔离 HOME+假 CLI，两轮，第 2 轮 31 断言 27 过）：(a) 正常总结全帧序 + 历史落盘 frontmatter/0600 + stdin 实证；(b) is_error:true；(c) task-cancel；(d) history-list/read/delete、workflow-list/read；dist probeAgents 直调；spawn.ts reap 源码核对；孤儿进程组击杀清理 |
| install-sh | partial | `npm view @aaione/ai-page-dive versions dist-tags --json`；双隔离实跑 `sh install.sh --ext-id fakeextid123`（新装场景 → ETARGET）；隔离 prefix 装 0.1.2 后重跑 install.sh（已装场景 → 同 ETARGET）；清理 |
| build-gates | pass | `pnpm build`（两段）；dist 产物核验；`node scripts/check-host-lines.mjs`；`node scripts/check-published.mjs`（预期红）；`pnpm -C apps/extension exec tsc --noEmit`；`pnpm vitest run`（隔离 HOME） |
| dev-server | pass | `npx vite --port 5199` 后台起；curl `/dev.html`、`/src/dev/main-dev.tsx`、`/src/dev/chrome-mock.ts`、`/src/sidepanel/main.tsx`、`App.tsx`、`index.css` 全 200；服务端日志 grep error 零命中；kill 自起 PID |
| units-e2e | partial | 读五脚本判定依赖；实跑 `node scripts/e2e-ui.mjs`（崩）；`dist/index.js install --ext-id test`（崩）；/tmp 副本打 3 处补丁后 e2e-ui / e2e.mjs / e2e-runtime.mjs；手动 NM 验证（wrapper ping→pong 0.1.3、chrome 拉起 host list-agents） |

汇总：2 pass / 4 partial。新 bug 5 个（全部复现确认 holds=true）、r57-known 4 个、blocked-by-design 1 个、env-artifact 2 个。

## 二、新发现（复现确认的 new-bug，带 file:line）

### N1. install hostPath 解析断链——裸跑 install 必败（发布链路级故障）

- 位置：`packages/host/src/scripts/install.ts:68`（编译产物 `dist/scripts/install.js:57-60`）
- 现象：隔离 HOME 下 `node packages/host/dist/index.js install --ext-id <id>` → `Error: host entry not found: .../dist/scripts/index.js`，exit 1，零 manifest 写入。
- 根因：`resolve(dirname(fileURLToPath(import.meta.url)), 'index.js')` 假设入口与 install.js 同目录；tsconfig rootDir=src 的产物布局是 `dist/index.js + dist/scripts/install.js`。npm 已发布 0.1.2 tarball 布局相同、install.js:57 同款代码 → **真实用户 install.sh 路径（`ai-page-dive install --ext-id`）同样必败**。vitest 绿是因注入 `PAGEDIVE_HOST_ENTRY` 掩盖断链；e2e 三脚本也未设该变量。
- 复现：holds=true，100% 稳定。修复：`resolve(..., '..', 'index.js')`（或以 package root 定位），并补一条不注入 `PAGEDIVE_HOST_ENTRY` 的 dist 级 install 冒烟进 CI。
- 两轨道（host-cli / units-e2e）独立撞到同一 bug，交叉确认。

### N2. pgid 收割漏洞——组长速死后抗 SIGTERM 孙进程永久逃逸

- 位置：`packages/host/src/spawn.ts:104 及 :109`（连带 `packages/host/src/task.ts:165` killNow 同守卫）
- 现象：task-cancel → 组 SIGTERM 杀死组长 → `child.signalCode !== null` 守卫短路 → 3s 后 SIGKILL 兜底永不触发 → 捕获 SIGTERM 的同组孙进程存活 >60s、PPID 重挂 1 成孤儿（ps 实证，两轮复现 + 最小复现脚本一轮即中）。
- 根因：reap() L104 守卫「组长已退即 return」防 pid 复用误杀，代价是整组残余免死。违反 spawn.ts 头部自述不变量「process.kill(-pid) 杀整树」；host 自己的注释（task.ts r9-review）称此形态为「detached 进程组永久泄漏烧配额」。既有单测只覆盖组长存活形态。
- 修复：SIGKILL 兜底不以组长未退为前提——用 spawn 时捕获的 pgid 做 `kill(-pgid, 0)` 探测组存活后补刀；killNow() 一并修；补「组长速死 + 孙进程抗 SIGTERM」用例。

### N3. e2e 全家启动即崩——loadChromium 解构契约不匹配

- 位置：`scripts/lib/playwright.mjs:19`（`if (c) return c` 返回实例本身）vs `scripts/e2e-ui.mjs:10/23`、`scripts/e2e.mjs:10`、`scripts/e2e-runtime.mjs:10`、`scripts/verify-panel-open.mjs:13`（均 `const { chromium } = await loadChromium()` 解构得 undefined）
- 现象：`node scripts/e2e-ui.mjs` → `TypeError: Cannot read properties of undefined (reading 'launchPersistentContext')`。r53 #17（commit 85f3dd2）引入，此后 e2e 全家无人跑过。
- 修复：lib 改 `return { chromium: c }`，或四个调用方改 `const chromium = await loadChromium()`（一行×4）。

### N4. sw.ts 消息守卫误伤 tab-hosted 自家页面——e2e harness 形态整体失效

- 位置：`apps/extension/src/background/sw.ts:365`
- 现象：`if (sender.tab != null || sender.id !== chrome.runtime.id) return` 静默丢弃一切来自「开在 tab 里的扩展页面」的消息。SW 注入探针实测：`hasTab:true, id===runtimeId`——同扩展 ID 但带 tab，被 `sender.tab != null` 分支命中；面板永远「正在连接本机组件…」。直连 sendNativeMessage 正常（pong 0.1.3），证明 host/manifest 层无殁。dist-e2e 产物中中和 `t.tab==null&&` 后 e2e-ui 断言 0 立即转绿。
- 修复：守卫只保留 `sender.id !== chrome.runtime.id`（tab 与否不影响来源身份）；真 sidePanel 环境不受影响。

### N5. e2e-ui.mjs 选择器漂移

- 位置：`scripts/e2e-ui.mjs:75`（等 `'选择总结模式'`）vs `apps/extension/src/sidepanel/SummarizeView.tsx:722`（aria-label=`"选择模式"`，commit 513b7a2 改版）
- 现象：30s 超时。dev harness DOM 级实锤：按钮 aria-label 列表含「选择模式」，新选择器 count=1 可点击；dist-e2e 产物 grep 旧文案 0 命中。
- 修复：选择器同步，或给关键控件加 data-testid 稳定锚。

## 三、r57 已知项现场实锤情况

1. **install.sh ETARGET（复现成立，双场景）**：install.sh 钉版 0.1.3 但 registry 仅有 0.1.2（dist-tags.latest=0.1.2）。双隔离实跑：
   - 新装用户：`npm error code ETARGET / No matching version found for @aaione/ai-page-dive@0.1.3`，EXIT=1，全链路断。且黄字指引只列 EACCES/nvm/代理三类，无一对应 ETARGET——用户三个自救选项全部无效，且无「发版延迟稍后重试」提示。
   - 已装 0.1.2 老用户重跑（换扩展 ID 重新登记场景）：同样死在钉版步骤，NM 登记不可达；无「已装检测/跳过 npm/降级手动登记」分支。
   - 修复：发布 0.1.3 并让 dist-tag 跟上（check-published.mjs 门禁即为此设）；补 ETARGET 专属文案；加已装版本降级分支。单一根因两个侧面，稳定复现。
2. **check-published.mjs 门禁红（预期）**：仓库钉 0.1.3 / registry latest=0.1.2，exit 1——发版前门禁的正常行为，非缺陷。`npm publish` 后重跑即绿。
3. **uninstall「已清理 N 处」计数（复验成立）**：本轮数字恰好如实（2 manifest + 1 wrapper，find 残留=0）。但 `uninstall.ts:12-20` 对 `rmSync(..., {force:true})` 无条件 n++ → 无 Chrome for Testing / 未安装过的机器上仍报 3，属虚报。修复：先 existsSync 判存再删并计数。
4. **e2e 硬编码个人机器路径（成立）**：chromium-1217 executablePath、EXT/PROFILE 绝对路径四处。**并修正 r57 一处误判：chromium-1217 二进制本机实际存在**（`ls ~/Library/Caches/ms-playwright` 确认、实跑加载成功）——三条 e2e 轨道红的真因是 N3 解构 bug 而非缺浏览器。

## 四、失败清单（按分类）

| # | 分类 | 摘要 | 位置 |
|---|---|---|---|
| N1 | new-bug | install hostPath 断链，裸跑/发布链路必败 | host src/scripts/install.ts:68 |
| N2 | new-bug | pgid 收割 SIGKILL 兜底被守卫短路，孙进程泄漏 | host src/spawn.ts:104,109 + task.ts:165 |
| N3 | new-bug | e2e 四脚本 loadChromium 解构崩溃 | scripts/lib/playwright.mjs:19 + 四调用方:10/13 |
| N4 | new-bug | sw.ts sender.tab 守卫误伤 tab-hosted 面板 | ext src/background/sw.ts:365 |
| N5 | new-bug | e2e-ui 选择器漂移超时 | scripts/e2e-ui.mjs:75 vs SummarizeView.tsx:722 |
| R1 | r57-known | install.sh 钉版 ETARGET，新装+老用户双断，文案指引真空 | install.sh:43 |
| R2 | r57-known | check-published 红（0.1.3 未发布，预期门禁行为） | scripts/check-published.mjs |
| R3 | r57-known | uninstall 计数无条件 n++ 虚报 | host src/scripts/uninstall.ts:12-20 |
| R4 | r57-known | e2e 硬编码机器路径；r57「chromium MISS」误判修正 | scripts/e2e*.mjs:25 等 |
| B1 | blocked-by-design | e2e 面板侧丢帧（host status:done 但面板「响应超时」）——tab 邮戳/foreignAdopt 定向路由是已知 v2 port 架构缺口 | sw.ts 定向路由 |
| E1 | env-artifact | NM 轨 a2/a12/d1-d4 首轮红为驱动脚本伪红（假 CLI 竞态/YAML 引号比对/选择器误选），第 2 轮全 PASS | 驱动脚本 |
| E2 | env-artifact | verify-panel-open 依赖 osascript GUI 键击 + 重写真机 dist，无法无人值守 | scripts/verify-panel-open.mjs |

## 五、盲区（本轮未测）

- **真浏览器交互**：未做真实浏览器里的 sidePanel 完整用户流（dev harness 仅 dev.html + HTTP 探测；e2e 因 N3/N4/N5 未能跑通完整断言）。
- **真实 CLI 总结质量**：全程假 CLI（1.0.0-pd-fake），真实 claude/codex 的总结质量、stream 分片节奏、大输出行为未验。
- **CWS 链路**：商店上传/审核/更新链路未测；install.sh 的 curl 一键安装真实端到端（含 0.1.3 发布后）未验。
- verify-panel-open（osascript ⌥⇧P 路径）未实跑——需 GUI 前台与辅助权限。
- e2e 面板侧收帧仅以「中和守卫 + /tmp 补丁」旁证，未在真 sidePanel 环境验证 N4 修复无回归。

## 六、给下一轮修复的输入（优先级序）

1. **N1 install hostPath**（发布链路级，最优先）：`resolve(..., '..', 'index.js')` + CI 补不带 `PAGEDIVE_HOST_ENTRY` 的 dist 级 install 冒烟——vitest 注入掩盖断链的教训要用人肉 CI 堵上。
2. **发布 0.1.3**：一并解 R1 ETARGET + R2 门禁红；ETARGET 专属文案 + 已装降级分支随发版修。
3. **N2 pgid 收割**：SIGKILL 兜底改按 spawn 时 pgid 探测补刀（`kill(-pgid, 0)` 先探活，兼顾 pid 复用）；killNow() 同修；补组长速死+孙进程抗 SIGTERM 用例。
4. **N3 e2e 解构契约**（一行×4，解锁 e2e 全家）：优先改调用方 `const chromium = await loadChromium()`。
5. **N4 sw.ts 守卫收窄**：只保留 `sender.id !== chrome.runtime.id`；修后 e2e harness 形态即活。
6. **N5 选择器 + data-testid**：关键控件加稳定锚，避免文案改版再打断 e2e。
7. **R3 uninstall 如实计数**、**R4 路径参数化 + 假 CLI 注入档**（本次实证 Chrome→NM host→spawn 全链继承 PATH/HOME，PATH 前置即可）、E2 verify-panel-open 改 CDP 可触发路径。
8. B1 定向帧路由维持 v2 port 架构规划；e2e 侧先改为断言历史落盘（host 终局真相）而非面板收帧。

## 七、正向发现（非 bug）

- content-received chars 与分片 total 对账准确；chunks seq 从 0 连续。
- 正文临时文件终局即删（/tmp/pagedive 两轮零残留，含 cancel 路径）；prompt 实证全走 stdin（argv 仅白名单 flags）。
- 历史文件 0600、cancel 落 interrupted 历史、is_error:true 走 task-done(errorText) 而非退出码——符合既定决策。
- build 两段产物齐全（content.js 73.2K 等）；check-host-lines 2198 < 2200（margin 2）；tsc 0 errors；vitest 164/164。
- 干净 HOME 无 Chrome 数据目录时 install 拒写 exit 1（设计行为）；32 位 a-p 小写 ID 校验生效；重复 install 幂等（manifest 无重复、origins 不重复追加）。
- install.sh 三段结构 + RC 0/2/3 语义清晰，除 R1 外无其他问题。
