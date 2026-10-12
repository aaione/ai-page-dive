# r75 产品终审报告

- 轮次：r75（对 r74 修复批 8 commits `99022dc…becaab6`）
- 日期：2026-10-12 · HEAD `becaab6` · 骨架 `/tmp/pagedive-r75/product-audit-r75.js`
- **结论：6.5 / 10 —— isHighQuality: 否**（与 r73 持平）
- 运行账：12 agents / 553k tokens / 74 tool uses · confirmed 6（去重后 5）/ rejected 0 / unfetched 0 / lows 7 · 一次成
- 主编实测基线（审前 fetch）：registry dist-tags.latest=0.1.2 / origin/main install.sh:43 钉 @0.1.3 / 本地 0.1.4 领先 114 commits / 零 tag

## 维度分

| 维度 | 分 | 一句话 |
|---|---|---|
| decisions | 9 | 9 决策全落实可逐行比对（D4 路径/D8 文案逐字一致）；多引擎诚实标「未实施」；r74 八 commits 零未入账漂移 |
| install | 3 | 安装代码与文档质量高（幂等/FAQ/r74 新文案可操作性达标），但主线+npm 双路线对新用户 100% 必败——维度实际可用性为零，根因发布递延 |
| ux | 6.5 | r74 三戳收敛/五态 tips/Onboarding 出路已兑现；扣分主因：SW 启动前失败族双通道竞态——首跑授权失败「未知错误+裸英文」叠双气泡（本轮 high#3） |
| docs | 9 | r74 批 CHANGELOG 全部能力描述经 diff/实跑逐字可导出（2199→2192/251/13 键全吻合）——第五轮计数水分惯性真好转；仅 E404 口径第三处（sw.ts）未同步 |
| release | 3 | 工程守门扎实（13 键并集深比较实测对齐/CI 七步链/check-published 机器执法），但就绪实况全断：主线 E404 第 14 轮 / CWS zip 陈旧 / 材料三件零产物 |

## confirmed（去重后 5 条；两条 critical 同根并账）

### critical ×1

1. **发布链三版本断链第 14 轮：新用户主线确定性 E404、老用户零升级通道**（双路线必败 + 三断链并账）——origin/main install.sh:43 钉 @0.1.3 而 registry 仅 [0.1.2]（npm view 实测）；Onboarding npmCmd 钉 manifest 0.1.4 同样不存在。README:33 引导的 curl 主线 100% 失败；已装 0.1.2 无升级通道。「零账号零 key 一键可用」公开承诺与实况全面违背。工程侧无可修项：publish 0.1.4 → push 114 commits（check-published 会立刻执法转绿）→ tag v0.1.4 三连是用户凭证操作，递延第 14 轮。

### high ×3

2. **远端 E404 旧文案主动误导**——真实用户撞 E404 时远端提示末条「网络问题 → 检查代理或换 registry」，对「版本不存在」是纯误导（必然无果白耗后流失）；本地 c11d535 新出路（Issues 反馈+跨代警告）在未推送的 114 commits 内对真实用户完全不可见。本地新文案本身可操作性已达标（stderr 可见/URL 独行可复制/重跑幂等诚实）。fix：随发布链一并推送。
3. **SW 启动前失败族双通道竞态：首跑授权失败渲染「未知错误+裸英文」叠双气泡**——sw.ts:1089 先发 reading 占位帧建流式气泡，注入失败时 emitTerminal 同码 task-error 后 return error 又走 onStartResult 定制文案——帧/回调双通道各渲染一次；no-permission 等 8 个真实可达码不在 ERROR_LABEL（帧路径落 `未知错误（码 no-permission）: 原始英文`）；onStartResult 不带 taskId，finished 台账守卫形同虚设；面板收起重开走 missedErrBubble 同落未知错误——引导全失。no-permission 是 activeTab 模式新用户首跑最高频失败路径。fix：ERROR_LABEL 补 8 码（或与 onStartResult 14 键文案表并入 terminal.ts 单一事实源）+ 启动前失败族 return 带 taskId 让台账幂等去重。
4. **CWS 上传 zip 是陈旧构建**——`pagedive-cws-v0.1.4.zip` mtime 2026-10-08（description 129 字符时代），dist 已于 10-12 重建（98 字符 + r72-r74 全部修复）但未重打包；解包实测 zip 内 manifest description 129 ≠ dist 现 98。按文件名信任直接上传即向商店分发含已删违规措辞、缺 r72-r74 修复的残缺物，且无机器执法覆盖。fix：`node scripts/package-cws.mjs` 重打包（一分钟）+ 可选 CI 钉 zip mtime 与 dist 对账。

### medium ×1

5. **P7 CWS 材料三件第 14 轮仍缺**——商店描述/截图/逐权限理由表全仓零产物（递归搜索 store|cws|screenshot|隐私理由 仅命中 PRIVACY.md 与打包脚本）；发布链即便收口，上架流程在 zip 之外依然卡死。

## lows 7 条

research/ 历史调研文档「零配置」残留（对外面已清零）/ DECISIONS D5 主表句尾 opencode 修订与下架记录靠后文覆盖 / README npm 命令版本双处硬编码与面板动态取值不同源 / host-shutting-down 同一气泡双称谓混用+「正在重启」不准 / **E404 出路口径第三处未同步：sw.ts 版本不匹配提示仍是「稍后几分钟重试」无 Issues 出路** / README 排障段零 E404 覆盖 / CHANGELOG 0.1.4 段预写发布日期 2026-10-12 而版本未发布。

## r73→r75 medium 清账映射（全真清）

| r73 confirmed | r75 核验 |
|---|---|
| E404 出路跨代漂移（medium#3） | ✅ 真清——本地新文案（Issues+发版后重跑+勿改装警告）可操作性达标；远端旧文案误导是发布链子症状（本轮 high#2） |
| FAQ 死源（medium#4） | ✅ 真清——改指 GitHub Issues |
| CHANGELOG 计数水分（medium#5） | ✅ 真清——docs 9 分，全部数字对 diff/实跑逐字可导出 |
| package-cws 深比较漏键（medium#6） | ✅ 真清——13 键并集深比较实测对齐 public |
| 发布链 critical 第 12 轮 | ❌ 第 14 轮续计（本轮 critical#1，用户凭证递延） |
| P7 三件（medium#7） | ❌ 第 14 轮零产物（本轮 medium#5） |

## 终审判词

「r74 修复批经对抗验证零水分：三条 medium 真清、测试 239→251、host 落盘真修复且反钉 r72 自身缺陷，工程侧无可指摘。但发布链第 14 轮续存使『一键可用』对新用户仍是空承诺：主线 100% E404、远端旧文案还误导查网络、CWS zip 是缺 r72-r74 修复的陈旧地雷、商店材料三件零产物。本轮新钉两条 high——首跑授权失败渲染『未知错误+裸英文』叠双气泡，恰打在最高频新用户路径上。代码离可发布差一步终端操作，产品离可安装差整个发布动作。」

## r76 修复批建议排序

1. **CWS zip 重打包**（high#4，一分钟立销）+ 可选 CI mtime 对账
2. **启动前失败族文案/双通道去重**（high#3，与 code 侧 terminal.ts/ERROR_LABEL 域交叉可并修——r76 code 建议#3 同批）
3. E404 口径第三处 sw.ts + README 排障段补 E404（纯文案，low 顺手清）
4. 发布链三连（用户凭证操作——第 15 轮续计则维持 critical）
5. P7 CWS 材料三件（与发布链同批做才有意义）

挂账续计：发布链（用户凭证）/ P7 三件 / codex 失败流 fixture（需真机）。
