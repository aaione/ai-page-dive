# PageDive 代码安全与质量终审报告（0.1.4 · r60 后第三轮）

> 审计日期：2026-10-07 · HEAD 75b5325（r60 三笔修复 75aac7e/2e4d9f2/cf61308 + 报告入库）
> 流程：6 维度审计 → 对抗核实 → 终审法官。本轮核心任务：r60 修复回执逐批验证、三轮分数轨迹对比、遗留账本出清状态盘点。
> 本机实测：pnpm test 24 文件 **213/213 全绿**（首跑 1 例失败系环境瞬态 ENOSPC——测试进程日志亲见 `history persist failed (): ENOSPC: disk full`，单文件重跑 37/37 绿、全量复跑 213/213 绿，非代码缺陷）；host 行数 **2199/2200（余量 1）**；check-version 含 sw.test.ts 钉点亲验在位。

## 头条裁决

**r60 是三轮中最干净的一轮修复：上轮开出的全部条件（唯一 medium 门禁缺口 + 三笔测试债 + 措辞修订中的门禁项）真落地，且上轮 Top5 五项全部真修。本轮存活 0 critical / 0 high / 0 medium / 25 low（含 3 条同根重复计入），被驳回 1 项——历史最佳账本。**

- **安全 = 是（无条件，第二轮维持）**。25 项 low 全部满足「需先攻陷别的组件 / 需同 uid / 需病态环境（NFS、chown root、17+ 任务单 SW 生命周期）/ 需未来改造」前提之一，默认配置下无任何可达的安全或正确性缺陷。nm 白名单（两轮遗留 medium）真关门，且经程序化比对 17/17 与 protocol.ts 精确一致。
- **质量 = 有条件是**。距「最高质量」还差三类活：① r60 三处新修复**零测试锚定**（pruneHistory 收敛、prevSeq 水位语义、task.test finally 半径）——修复本身经人工推演正确，但回归保护为零，CI 挡不住无声退化；② 一处**半开状态**（孤儿 task-done 帧已弃发但 ✓ 角标照打，终局三通道不一致）；③ 一处**回执措辞过实**（2e4d9f2 自称「形状校验」，实际仅 t 字段查表——与 r59 afaab84「杜绝影子面」同款水分，两轮连犯说明回执纪律需要制度化）。

**三轮轨迹**：medium 14（r58）→ 1（r59）→ **0（r60）**；条件清单从「安全三项 + 质量三项」收敛到「质量三类打磨」。修复速率与诚实度均在改善，但「修复零锚定」是新出现的债形态——修复正确性目前依赖审计人工推演，不可持续。

## r60 修复回执逐批验证（对照 2026-10-06 报告 Top5 + 条件）

| 回执项 | 判定 | 验证证据 |
|---|---|---|
| ① check-version 补 sw.test.ts 钉点（上轮唯一 medium） | **真修，闭合** | scripts/check-version.mjs 亲验含 sw.test.ts spot（cf61308 +3 行）；上轮唯一 medium 销账 |
| ② nm 帧类型白名单（两轮遗留 medium #7） | **真修，但「形状校验」措辞过实** | sw.ts:586 亲验 `NM_FRAME_TYPES.has(t)` 三重防御（非对象/null/未知 t）在位，17 项与 protocol.ts:114-131 程序化比对精确一致；测试锚定通路本体（nmSent 全空 + 合法帧照发）。但 commit 2e4d9f2 自称「白名单+形状校验」——逐类型形状校验未做，`{t:'history-delete', path:12345}` 原样透传（host 侧 assertInRoot 兜底封死后果，纵深预期落空）。次级：白名单排在 frameTooLarge 全量序列化之后（sw.ts:584），重活先做才拒，两行对调即可 |
| ③ PDF 正则限定 path 段 | **真修，完整** | sw.ts:951 `/^[^?#]*\.pdf([?#]|$)/i` + sw.test.ts:724-727 query-带-.pdf 反例测试在位 |
| ④ pruneHistory 补收敛 + chmod 吞错留痕 | **代码层真修，双半径不完整** | history.ts:244 亲验 chmod+留痕在位（收敛闭合「从不打开历史页」缺口）；9 处 chmod catch 全部转 ENOENT 静默/其余 console.error，旧式吞错零残留。半径缺口：(a) **prune 侧收敛零测试锚定**（list/save 各有区分性用例，prune 无——history.test.ts grep 证实，cf61308 diff 不含该文件）；(b) 留痕 9 处文案相同**不带路径**，EACCES 场景失败点不可定位且随全树 walk 重复放大。另本机实测 20 个存量 0755 目录（整个 9 月树 + 年/月 + attachments/202609），history/2026 ctime==mtime 证明收敛路径**从未在本机真实触发**——代码正确、验收口径失实，开发机自身未装 r59/r60 版 host |
| ⑤ 孤儿帧守卫 + seq 水位 | **真修且设计优于处方，两处残余** | prevSeq 单点修（App.tsx:466-471 亲验）比上轮处方「四终局各清一次」更不可能漏——收养路径 prevSeq=undefined 直通、三处判定同源，逐路径推演全部正确；orphan 守卫（sw.ts:791）判据与 task-error 入箱 owner 同源，无错位象限，测试从 sent 通道锁死。残余：(a) **孤儿 task-done 仍无条件打 ✓ 角标**（sw.ts:797-798 亲验在 orphan 判定之外）——帧弃发但角标照打，「有通知无内容」半开态，且 task-error 侧完全静默（不入箱不广播），终局三通道不一致；(b) **App.tsx 状态机零测试**——`prevSeq|lastChunkSeq` 全仓 test 文件 0 命中，修复语义纯裸奔，是 r58 #37 UI 测试债在新代码上的延续 |
| 次优先：task.test finally / bare cancel / 措辞 | **1/3 落地** | task.test.ts finally 真加（半径不完整：仅清 cbs.done 已置位的 historyPath，run 中途失败时 persist('interrupted') 落盘不在清理面）；bare cancel 空闲分支无条件 send **未修**（sw.ts:651，端口已断时冷启动空 host 只为发一条空转 cancel，一行 `if (nmPort.connected)` 的事）；afaab84 措辞未修订，且 2e4d9f2 新增同款「形状校验」水分 |
| r59 三笔测试债（上轮质量条件②） | **真修** | task.test.ts finally 恢复 bin/buildArgs、workflows.test.ts origMode 还原、T5 正向区分用例（锚 6/源 11）——cf61308 全部落地，上轮条件②闭合 |
| 行数守门 | 通过但燃料耗尽 | 2199/2200 亲测通过，余量 1。task.ts:137 单行 300 字符双 catch 内联是红线张力的物证——下轮 host 任何修复必须先删功能腾挪，不能再走内联加码路线 |

**回执造假：无。半径不完整：④（测试锚定缺失 + 留痕无路径）、⑤（角标半开）、task.test finally。措辞过实：②「形状校验」。未兑现：bare cancel 一行（上轮已点名的顺手项）。**

## 维度得分表（三轮轨迹）

| 维度 | r60 | r59 | r58 | 变化 | 本轮确认 |
|---|---|---|---|---|---|
| NM 与进程边界 | 9.0 | 9.0 | 8.5 | = | 0 medium + 2 low（chmod 留痕无路径放大 / task.test finally 半径） |
| 文件系统安全 | 8.5 | 8.5 | 8.0 | = | 0 medium + 4 low（存量 20 目录实况 / prune 零锚定 / 旁支零触发 / 日志噪音） |
| 扩展端安全 | 9.0 | 8.5 | 8.5 | ↑ | 0 medium（白名单真落地）+ 6 low（措辞/顺序/角标/429 误档/注入固有/CSP） |
| 协议与竞态正确性 | 8.5 | 8.5 | 7.5 | = | 0 medium + 6 low（prevSeq 零锚定为主，余为理论面/已接受项） |
| 守门与测试真实度 | 8.5 | 8.0 | 8.5 | ↑ | 0 medium（sw.test.ts 钉点闭合）+ 低风险：r60 三处新修复零锚定 |
| 工程质量 | 8.5 | 8.5 | 8.5 | = | 0 medium + 7 low（readdir×4 / catch×6 / Set 无编译绑定 / bare cancel / content 无上限 / 内联可读性） |

合计：**0 critical / 0 high / 0 medium / 25 low（其中孤儿角标一条三维度重复计入，去重后约 22 项）/ 被驳回 1 项**。

## 确认问题清单

**Critical / High / Medium：无。**（三轮首次 medium 清零。）

**Low（按主题归并，全部经对抗核实存活）**

- **r60 修复半径残余（4 项）**：孤儿 task-done 角标半开（sw.ts:797，终局三通道不一致）；pruneHistory 收敛零测试锚定（history.ts:244 若被重构无声移除 CI 不可检）；prevSeq 修复零测试锚定（App.tsx 无测试 harness，改回旧写法 CI 全绿）；task.test finally 仅覆盖 done 已置位路径（interrupted 残留真实 HOME）。
- **r60 回执可信度（1 项）**：2e4d9f2「形状校验」措辞过实——仅 t 字段查表，畸形字段帧原样进 NM（host 侧兜底封死，纵深残缺 + 与 r59 afaab84 两轮连犯）。
- **文件系统验收与旁支（4 项）**：本机 20 个存量 0755 目录实况（收敛路径从未在真实 HOME 触发过，ctime==mtime 铁证；被 0700 根掩蔽、利用前提同 uid、暴露面实际为零）；attachments/YYYYMM 与 skills 根两条零触发装机路径（纯文本任务早退 / 不点开技能目录）；chmod 留痕无路径上下文且随 walk 重复放大；持久 EACCES 下日志噪音。
- **扩展端打磨（4 项）**：白名单排在 frameTooLarge 全量序列化之后（顺序效率）；authHint `/429/` 未加词边界（`ETIMEDOUT after 4290ms` 误判为限流档，原始信息保留故仅误导排障）；prompt 注入固有威胁（缓解三件套在位，维持「有缓解非零缓解」裁定，r60 未扰动）；manifest 未显式声明 CSP（MV3 缺省即安全，文档化纵深）。
- **协议理论面与已接受项（4 项）**：同 taskId 重注册水位吞头（被 SW newTaskId 实际杜绝，仅记 DECISIONS 防 multi-入口改造踩坑）；host 侧 task-content seq 零校验（chars 对账实质兜底，上轮已预告接受）；T4「任意 listener ≠ owner」双窗口盲区（r60 孤儿守卫反而收窄了同族暴露面，panel 心跳属 v2 架构升级）；NM_FRAME_TYPES 手抄 Set 无编译期绑定（改 `Set<ExtToHost['t']>` 一行可得拼写保护）。
- **三轮遗留未动（5 项）**：readdir 静默吞错 4 处（与 r60 刚建立的 chmod 留痕口径同文件自相矛盾——「口径半边工程」）；6 处 `catch (e: any)`（零成本删 6 字符，三轮未动）；bare cancel 空闲分支拉空 host（两轮点名未修）；task-content host 侧累积无上限（白名单挡类型不挡体积）；task.ts:137 300 字符内联行可读性（红线张力物证，需腾挪后 helper 化）。

## 被驳回发现（1 项）

1. **「NM_FRAME_TYPES 与 protocol.ts 无单一事实源、无 parity 门禁——未来加帧忘更白名单即静默功能回归」**——证据全部属实但程序化比对确认当前 17/17 精确一致、diff 为空；触发条件是「未来某 commit」的假设性事件，漂移失败模式显性（帧被拒、面板可感知）、非静默安全洞。定性为 ~10 行维护性加固建议，不是现存 bug。存活清单中「Set 无编译期绑定」已按此口径降级收录。

## 必须修复 Top 5（风险 × 投入排序；全部为 low，按价值排序）

1. **孤儿 task-done 角标并入 `!orphan` 分支**（sw.ts:797-798 一行 + sw.test.ts:618 用例补一行角标断言）——拆掉「有通知无内容」半开态，终局三通道对齐，r60 修复的自然收尾。
2. **pruneHistory 收敛测试锚定**（history.test.ts 约 10 行，仿 :326 用例：fakeHome 造 0755 旧树 + pruneHistory + 断言 stat 0o700）——r60 修复语义目前裸奔，这是最低成本的锚定；同批顺手钉 prevSeq 三象限（残值收养/同任务去重/跳变）需先搭 App 测试骨架（约半天，r58 #37 的账终归要还）。
3. **authHint 数字词边界**（App.tsx:1076 一行改 `/\b429\b|\b529\b/` 或两档对调）——消除网络故障被指引成「稍等重试」的误导。
4. **修订 2e4d9f2 回执措辞（删「形状校验」三字）或补 5 个高危原语最小形状断言**（path/workflow name 为 string、task-start.task 为 object，约 5 行）——两轮连犯的回执水分需要一次制度性纠正；建议在 DECISIONS 或 AGENTS 加一条「回执措辞必须可从 diff 逐字导出」。
5. **chmod 留痕带路径 + 按进程去重**（logChmodFail(path, e) 工具函数约 8 行，需先腾挪行数——可与 task.ts:137 内联 helper 化合并为一笔：抽 chmodQuiet(path) 既消 10 处重复又带路径，净增行数约等于删掉的重复，再删 bare cancel 无用 send 抵扣）——同时消化「无路径不可定位」「重复噪音」「300 字符行」三个 low。

（次优先顺手：bare cancel `if (nmPort.connected)` 一行；readdir 4 处照抄 chmod 表达式留痕（行数余量约束下与 Top5#5 同批腾挪）；catch(e:any) 删 `: any` 零行数变化；白名单两行对调前置。）

## 7 条红线符合性

| # | 红线 | 结论 | 证据 |
|---|---|---|---|
| 1 | 权限五项、不申请 `<all_urls>` | **符合** | manifest 亲验：activeTab+scripting+nativeMessaging+sidePanel+storage；optional_host_permissions 默认关闭（D3）；r60 三笔 ext 提交均未扩权 |
| 2 | prompt/正文走 stdin、正文写临时文件 | **符合** | spawn.ts stdin 写完即 end；tmpfile.ts 三层防御（lstat 属主 + randomUUID + wx 0600）r60 后完好未扰动 |
| 3 | 零凭证接触 | **符合** | 全链未修改官方 CLI 子进程；r60 host diff 仅 chmod catch + install.sh，无任何凭证面新增 |
| 4 | is_error 不能只看退出码 | **符合** | claude.ts + task.ts 硬判定在位，r60 未触碰 |
| 5 | host 薄壳 <2.2k（CI 断言） | **符合（余量 1）** | 2199/2200 亲测通过，未抬阈值；但燃料耗尽——task.ts:137 300 字符内联行是红线张力物证，下轮 host 修复必须先删功能腾挪（红线自述「再破线删功能不抬阈值」） |
| 6 | v1 = macOS+Chrome、claude+codex 双适配器 | **符合** | opencode 无残留（D5），r60 未新增适配器 |
| 7 | 历史落盘结构 + frontmatter | **符合** | 路径结构实测一致；存量 0755 为部署惰性残留（被 0700 根掩蔽、暴露面为零）非路径违约，代码层收敛三重触发已在位 |

## 终审一句话

**三轮审下来，这份代码已经没有「安全」上可挑的刺了——0/0/0 的严重度账本、五条红线全绿、白名单关门；剩下的全部是「质量最后一公里」：三处零锚定的修复在等测试、一个半开的角标在等一行代码、两轮注水的回执在等一次措辞纪律——修完这三件事，「最高质量」四个字才配得上写进发布说明。**
