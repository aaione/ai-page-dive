# PageDive 第三轮安全与发布维度严苛 Review（2026-09-12，R3 终态）

- **基线**：HEAD = d39cbce（`fix(host,ext): v3 深度分析七项修复…`），工作树 clean
- **Reviewer 立场**：防御性发布前审计——假设前两轮修复全部失效，逐锚点复核；新入参面（originalName / confirm / pendingPathRef）按新攻击面审
- **前轮基线**：review-2026-09-11-sec.md、review-2026-09-11-r2-ux-sec.md、deep-analysis-2026-09-12.md 等六份——已覆盖项不重复计分，仅复核在位性

---

## Verdict

**代码安全面：可发布（GO）。** 零 blocker、零 major；2 minor（均为防御纵深/健壮性，非可触发漏洞）+ 4 info（理论风险/已入债册）。

**发布整体：仍 NO-GO——三条运营阻塞全部在「发布链路」而非代码**：① main 落后本地 10 个提交未推送 + raw URL HTTP 404 复测成立（install.sh 主路径对用户是死的）；② npm 包未 publish（E404 复测成立，`npm i -g ai-page-dive` 必失败）；③ CWS 素材四件套缺三（截图/商店文案/隐私政策文件均不存在，仅 icon 四尺寸齐全）。三项合计清除约 1 天 + CWS 审核等待期。

| 维度 | 结论 |
|---|---|
| 代码安全（NM 消毒/路径/文件面） | GO——前两轮全部修复锚点在位，新增面（originalName rm）验证安全 |
| 权限最小化 / 零遥测 | GO——5 权限逐项正当，全仓零网络调用 grep 复测通过 |
| 供应链（install.sh / npm） | GO（代码面）——引号/eval/格式串三面干净 |
| 发布运营链路 | NO-GO——三阻塞，见 §五 |

**Findings 计数：blocker 0 / major 0 / minor 2 / info 4；运营阻塞 3。**

---

## 一、既往修复在位性复核（d39cbce 锚点验证）

| 防线 | 锚点 | 状态 |
|---|---|---|
| history 路径穿越 | `assertInRoot` history.ts:28-33（resolve + `ROOT + sep` 前缀） | ✅ 在位，readHistory:203 / deleteHistory:208 / revealInFinder:213 / appendHistoryTurn:122 四处全覆盖 |
| tmpfile UUID+wx | tmpfile.ts:13-15（dir 0o700 + randomUUID 后缀 + `flag:'wx', mode:0o600`） | ✅ 在位 |
| outline 消毒 | task.ts:492-494（标题行过 `sanitizeMeta(m[2].trim(), 200)`，注释明言「唯一旁路」） | ✅ 在位 |
| sanitizeMeta 全覆盖 | task.ts:435 定义；447-452（title/url/byline/publishedTime/siteName/lang）、470-471、494、518（workflow fallback）、554 | ✅ 在位，七个注入点全过消毒 |
| ext-id 校验 | install.ts:82 `/^[a-p]{32}$/`（畸形 id 跳过并告警，不进 allowed_origins） | ✅ 在位 |
| rootguard | rootguard.ts:4-10（getuid===0 拒绝 + 重装指引），install/postinstall 共享 | ✅ 在位 |
| npm dist 零 shared 运行时依赖 | packages/host/package.json：dependencies 无、shared 仅 devDependencies `workspace:*`；files 白名单 dist/builtins/builtins-skills | ✅ 在位（ffed99b 修复未回退） |
| workflow name 校验（读路径） | workflows.ts:83 / 98（getWorkflow/readWorkflow 也过 assertValidWorkflowName） | ✅ 在位 |
| skills reveal 校验 | skills.ts:48 / 70 复用 assertValidWorkflowName | ✅ 在位 |
| history frontmatter 转义（title/url） | history.ts:58-61 escapeYaml（引号包裹 + 反斜杠/引号转义 + 换行压平） | ✅ 在位（残 agent/workflow/sessionId 三字段，见 R3-i1） |

**结论：前两轮 10 项安全修复在 d39cbce 全部在位，无回退。**

---

## 二、本轮新面审计

### 2.1 saveWorkflow 的 originalName 路径（d39cbce 新增）— ✅ 验证安全，残一处非原子序

`packages/host/src/workflows.ts:110-129`：

```ts
assertValidWorkflowName(input.name)                      // 117
if (input.originalName && input.originalName !== input.name) {
  assertValidWorkflowName(input.originalName)            // 119 ← rm 前校验
  const clash = await readFile(join(USER_DIR, input.name, 'WORKFLOW.md')) ... // 120
  if (clash) throw ...                                    // 123 撞名拒绝
  await rm(join(USER_DIR, input.originalName), { recursive: true, force: true }) // 124
}
const dir = join(USER_DIR, input.name)
await mkdir(dir, { recursive: true }); await writeFile(...)  // 127-128
```

- **rm 路径可控性**：`originalName` 在 rm（124）**之前**过 `assertValidWorkflowName`（`/^[A-Za-z0-9_-]{1,64}$/`，19-23 行）——`..`、`/`、空串全被拒。rm 被钉死在 `~/.ai-page-dive/workflows/<安全名>` 内。**穿越不成立。**
- **stdio 入口**（stdio.ts:133-136）：`saveWorkflow(msg)` 整包传入，但 name/originalName 双双校验，description/category 仅入文件内容（buildWorkflowMd 换行压平，35-36 行），无命令面。
- **双层撞名防线**：host 侧 120-123 + 扩展侧 Settings.tsx:202 预检——一致。
- 残序问题 → **R3-m2**（见下）。

### 2.2 Settings confirm 逻辑 — ✅ 验证安全

`apps/extension/src/sidepanel/Settings.tsx`：

- 220 行：删除用户模式前 `confirm('删除模式「名」？该操作不可恢复。')`——rm -rf 不可恢复操作有确认门 ✅；内置模式按钮语义为「恢复默认」（366 行），删的是用户副本，无破坏面。
- 133-135：另存新名后 editor 的 originalName 同步切到新名，防二次保存再 rm 已改名目录 ✅。
- 185-210：保存链路 host 错误帧有消费（58 行注释 + 10s 自清提示）✅。

### 2.3 HistoryView pendingPathRef — ✅ 验证安全

`apps/extension/src/sidepanel/HistoryView.tsx`：

- 27 行 `pendingPathRef` + 43 行：历史详情帧按 path 对账，迟到/错配帧丢弃——防 A 文件内容渲染进 B 详情（d39cbce 新增守卫）✅。
- 46 行注释 + 175 行 `confirm('删除这条历史？')`：乐观删除失败回滚 ✅。
- 70 行：返回时清 viewing 与 pendingPathRef，无残留错配窗 ✅。
- 删除最终由 host `deleteHistory` → `assertInRoot`（history.ts:208）兜底，扩展侧 path 全部来自 host 的 history-list 帧，非页面可控 ✅。

### 2.4 NM 输入消毒面全量复查（stdio.ts handle 逐分支）

| 分支 | 字段去向 | 消毒锚点 | 判定 |
|---|---|---|---|
| ping / list-agents / list-workflows / list-skills | 无入参 | — | ✅ |
| task-start | task.{taskId,agentId,workflow,instruction,skills,lang,attachments,page,resumeSessionId} → Task | 正文只走 tmpfile（143）；附件名 `safe` 白名单替换（112）；agentId 查 registry 白名单（run() 138-141）；meta 全过 sanitizeMeta；spawn 数组形态无 shell | ✅（残 R3-m1 纵深） |
| task-content / task-cancel | taskId → Map 键 | 仅内存 Map | ✅ |
| history-list | query/limit | 只读扫描，目录名 `\d{4}`/`\d{2}` 白名单（134/139/141） | ✅ |
| history-read / history-delete / history-reveal | path | assertInRoot | ✅ |
| history-reveal-root | 无入参 | 定死 ROOT | ✅ |
| workflow-read / delete / reveal | name | assertValidWorkflowName（98/133/143）；reveal 双目录存在性验证（147-151） | ✅ |
| workflow-save | 见 §2.1 | 双名校验 | ✅ |
| skill-reveal | name | assertValidWorkflowName（skills.ts:70） | ✅ |

**结论：NM 面 18 个分支无未消毒字段直达 fs/spawn/网络。** 唯一纵深缺口为 R3-m1。

---

## 三、新 Findings

### [minor] R3-m1 — writeContentFile 的 `name` 参数未校验（taskId 直达文件名，防御纵深缺口）

- **位置**：`packages/host/src/tmpfile.ts:9-16`（`join(DIR, \`${name}-${randomUUID()}.md\`)`）；调用点 `task.ts:143`（`writeContentFile(this.taskId, …)`）与 `task.ts:113`（`${taskId}-att-${safe}` 前缀同样是未校验 taskId）。
- **触发路径（PoC 级）**：NM 帧task-start 的 taskId 为 `"../../evil"` → `join(tmpdir/pagedive, "../../evil-<uuid>.md")` → 解析为 `tmpdir/evil-<uuid>.md`，写出 pagedive 目录之外（`wx` 只拒绝已存在路径，不拦截新建于目录外）。足够多的 `../` 可达任意用户可写目录。
- **为什么只是 minor**：taskId 实际由我方 SW 生成（sw.ts:263-266 `newTaskId`：`t` + 时间戳36进制 + 4 位随机——纯字母数字），且 NM allowed_origins 钉死只收本扩展；要触发须先攻破 SW 或扩展签名链。**与 tmpfile 已修的 symlink 攻击同一威胁类**（当时结论就是「协议信任边界：NM 消息可能带任意字符串」——task.ts:111 对附件名就是这么处理的，taskId 却漏了对称处理）。
- **修法**（3 行）：`writeContentFile` 开头加 `if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error('invalid tmp name')`。与现有 assertValidWorkflowName 同款。

### [minor] R3-m2 — saveWorkflow「改名保存」rm 旧目录先于写新文件，非原子

- **位置**：`workflows.ts:124-128`——序为 clash 检查 → `rm(originalName)` → `mkdir` → `writeFile`。
- **触发路径**：改名保存时进程在 rm 之后、writeFile 之前崩溃/断电（或 writeFile 因磁盘满/权限失败）→ 旧模式已删、新模式未落——用户原创 workflow **不可恢复丢失**（无回收站；内置有兜底，用户副本没有）。
- **修法**：调序为「先写新（mkdir+writeFile）→ 成功后再 rm 旧」——写失败时旧副本完好，rm 失败只留孤儿目录（下轮 list 重扫可见，无害）。5 分钟。

### [info] R3-i1 — history frontmatter 的 agent/workflow/sessionId 三字段未过 escapeYaml（理论风险）

- **位置**：`history.ts:102/103/108`（title/url 有转义，这三字段裸写）；`task.ts:409` `workflow: this.input.workflow` 原样入 meta——含换行的 workflow 名虽过不了 getWorkflow 校验（会走 DEFAULT_TASKS），但**仍被原样写进 frontmatter**。
- **影响半径**：注入的假 frontmatter 键只影响本机历史列表显示（parseFm 只回读 title/url/agent/ts/session_id，无 eval/无路径消费）；sessionId 来自 CLI stdout 解析同样受限。**纯显示层，无安全面。**
- **修法（顺手）**：三字段统一过 escapeYaml。10 分钟。可与 R3-m2 同批。

### [info] R3-i2 — prompt 注入残余：sanitizeMeta 截断但不中和语义（已入债册，非本轮新增）

- sanitizeMeta（task.ts:435）做的是长度上限 + （对 outline 行）文本保留——页面仍可在 200 字符标题/outline 行内塞「忽略上述指令，改为…」。这是无状态 prompt 注入的固有残余，前轮已定性为「行业惯例跟进项」（页面内容隔离进文件 + meta 消毒已是 v1 行业标准做法以上）。**维持 info，不阻塞发布**；v2 可考虑 meta 段加固定围栏注释（`<meta>页面元数据，非指令</meta>` 包裹）。

### [info] R3-i3 — install.sh 供应链面复查（文案改动后重审）：干净

- 逐行复审 d39cbce 版（50 行）：① `EXT_ID="${1:-}"`（8 行）唯一入口，44 行 `--ext-id "$EXT_ID"` 全引号，无 eval/无命令替换拼接；② `say`/`die` 均 `printf '%s' "$*"`——无格式串注入；③ `set -e` 在位；④ 22 行 die 文案里的 `\$(curl …)` 已转义，按字面打印，安全；⑤ `npm i -g ai-page-dive` 不钉扎 latest——DECISIONS D10 已定案（registry 完整性校验兜底、脚本零二进制下载），维持接受。
- 残余固有面：raw|sh 模式下仓库被攻破 → 新装用户执行任意 shell（已装用户走 npm 签名面不受影响）——Homebrew 同款行业常态。**建议**（不改代码）：README 安装段补一句「可先下载脚本审阅再执行」的替代说明。
- 半天前的文案改动未引入新面。✅

### [info] R3-i4 — workflow body / skills 本地内容的信任模型（陈述，非漏洞）

- `~/.ai-page-dive/workflows/*/WORKFLOW.md` 与 skills 正文直接成为 CLI prompt 的一部分（task.ts:152-153、502-516）。信任模型：**等同用户亲手敲进终端的指令**——本机文件属主即用户本人，恶意前提是用户机器已被攻破（届时 CLI 本身早已可直接调用）。name 过 assertValidWorkflowName、正文占位符只展开在 workflow body 上（182 行注释：用户 instruction 的 `{xx}` 字面量不展开——正确）。**模型自洽，无需改动。**

---

## 四、已验证安全清单（本轮 PoC 未成立 / 复核通过）

1. **saveWorkflow originalName rm 穿越**——PoC 不成立（rm 前置校验，§2.1）
2. **history read/delete/reveal 穿越**——assertInRoot 四覆盖（§一）
3. **tmpfile symlink/预测名攻击**——UUID+wx+0o700 在位（§一）
4. **outline/meta prompt 注入七注入点**——sanitizeMeta 全覆盖（§一）
5. **manifest 权限面**——恰 5 权限（activeTab/scripting/nativeMessaging/sidePanel/storage），无 host_permissions、无 `<all_urls>`、无宽 cookie/tabs；CWS 叙述见 §六
6. **零遥测复测**——全仓（ext+host+shared 源码）`fetch(|XMLHttpRequest|sendBeacon|webRequest|WebSocket` grep **零命中**；host 运行时零依赖（package.json dependencies 空）
7. **install.sh 注入面**——引号/eval/格式串三面干净（R3-i3）
8. **spawn 面**——全部数组形态 args + `open`/CLI 均无 shell:true（workflows.ts:152、history.ts:214/220、task.ts spawn 链）
9. **仓库无秘钥**——`*.pem` 扫描零命中；manifest key 为 CWS 打包公钥（非私钥），可提交
10. **npm 包面**——files 白名单 + prepublishOnly/prepack 双钩子 + 零运行时依赖（§一）
11. **扩展侧破坏性操作确认门**——Settings.tsx:220 / HistoryView.tsx:175 双 confirm；乐观删除失败回滚（HistoryView.tsx:46）
12. **附件文件名**——白名单替换 + 64 截断（task.ts:112）
13. **agentId**——registry 白名单查表，未知 id 报错不起进程（task.ts:138-141）
14. **history 大文件回传**——900KB 字节级截断 + UTF-8 边界回退（stdio.ts:94-101），无 NM 超限断连

---

## 五、发布运营阻塞清单（终态）

| # | 项 | 当前状态（本轮实测） | 清除路径 | 预计耗时 |
|---|---|---|---|---|
| OP-1 | 仓库未推送 + 疑似 private | `origin/main..HEAD` = **10 个提交未推送**；`https://raw.githubusercontent.com/aaione/ai-page-dive/main/install.sh` 实测 **HTTP 404**（gh CLI 本机沙箱不可用，public 化状态无法直接确认；09-09 审计记录为 private） | `git push origin main` + GitHub Settings → General → Danger Zone → Change visibility → Public → 复测 raw URL 200 | **5 分钟** |
| OP-2 | npm 包未发布 | `npm view ai-page-dive` 实测 **E404**——install.sh 第 34 行 `npm i -g` 必失败，整条安装链死 | `cd packages/host && npm pack --dry-run`（核对 dist/builtins/builtins-skills 清单）→ `npm publish --access public` → 干净环境 `npm i -g ai-page-dive` 验证 bin 可执行 | **15 分钟**（含验证） |
| OP-3 | CWS 素材四件套 | 仅 icon 四尺寸齐全（apps/extension/public/icon-16/32/48/128.png ✅）；**截图零张、商店文案（描述/截图说明）零文件、隐私政策零文件、宣传图缺**（store/ cws/ 目录不存在） | ① 建 `store/`：1280×800 截图 1-5 张（sidepanel 总结流/Onboarding/历史/设置四场景）；② 隐私政策：复用「零遥测/零凭证/内容不出本机」三承诺成文（可挂 GitHub Pages 或仓库 PRIVACY.md 作 URL）；③ 商店短描述 ≤132 字符 + 详细描述 | **0.5-1 天**（截图+文案） |

**顺序依赖**：OP-1 → OP-2 → 干净 mac 全链路验证（curl 安装 → CWS dev 版连通 → 一次真实总结）→ OP-3 素材 → CWS 提审（审核等待期吸收 R3-m1/m2/i1 三处小修 + bump 0.1.2）。

---

## 六、manifest 五权限的 CWS 审核叙述（一句话/项）

1. **activeTab**——用户点击工具栏图标/快捷键时才读取当前标签页，实现「总结当前页」的唯一取数动作；不申请 `<all_urls>`，零常驻站点访问。
2. **scripting**——向当前活动标签注入内容提取脚本（extract.ts），把页面正文/markdown 化后经本机 native messaging 交给用户自己的 AI CLI；注入只在用户显式触发总结时发生。
3. **nativeMessaging**——与本机已安装的开源 host（`ai-page-dive`，npm 分发、代码公开）通信，唯一目的是子进程调起用户自己已登录的官方 CLI（claude/codex）；不传输凭证、不代理流量。
4. **sidePanel**——总结结果的流式 markdown 渲染界面（产品的全部 UI 即此面板）。
5. **storage**——仅 session 域（内存级，浏览器关闭即失）保存 SW 30 秒回收后恢复追问会话所需的会话态；不落盘、不跨站、无浏览历史。

配套事实（供审核质询时引用）：零网络权限（源码 grep 零 fetch/XHR/sendBeacon/webRequest）、零远程代码（无 eval、CLI 二进制为用户自装官方版）、历史落盘仅本机 `~/.ai-page-dive/`。

---

## 七、host 行数与攻击面（清单第 8 项）

- **2029 行**（src 全量，含 postinstall.ts 107）——**符合 <2k 薄壳目标**（CLAUDE.md 硬约束 #5）。
- 攻击面集中度：task.ts 562 行是唯一复杂体（缓冲/prompt 组装/进程收割），全部高危原语（rm/writeFile/spawn）分布在 workflows/history/skills/tmpfile 四个小文件且**每一处前置 name/path 校验**（§一、§二）。d39cbce 新增的 originalName rm 逻辑（+6 行）已验证不扩面。R3-m1 修复后，tmpfile 也闭环。

---

## 八、结论与行动清单

**安全面：可发布。** 前两轮修复零回退、新面三处全部验证安全或降级为纵深加固；剩余 2 minor + 4 info 无一可在 NM 信任模型（origin 钉死本扩展）内被外部触发。

**发布前必做（顺序执行）**：
1. `git push origin main` + 仓库 public 化 + 复测 raw URL → 200（5 min）
2. `npm publish --access public` + 干净环境全链路验证（15 min）
3. R3-m1（tmpfile name 校验，3 行）+ R3-m2（save-first-rm-later，调序）+ R3-i1（escapeYaml 三字段，顺手）——同一小批次，bump 0.1.2（30 min）
4. CWS 素材四件套（0.5-1 天）→ 提审

**发布后一周内**：README 补「先下载审阅再执行」替代安装说明（R3-i3 建议）；prompt meta 围栏包裹（R3-i2，v2）。
