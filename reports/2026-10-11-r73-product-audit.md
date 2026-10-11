# r73 产品终审报告

- 轮次：r73（对 r72 修复批 6 commits）
- 日期：2026-10-11 · HEAD `4d344f4` · 骨架 `/tmp/pagedive-r73/product-audit-r73.js`（三分收集版）
- **结论：6.5 / 10 —— isHighQuality: 否**（与 r71 持平；判词「工程合格，产品不成立」「发布即可是高分产品，不发布就只是好代码」）
- 运行账：12+4 agents / 首轮 509k tokens / resume +477k · confirmed 10 / rejected 0 / unfetched 0 / lows 4
- 收割事件：release 维度首跑整丢（同 code 轮 tests），resume 补跑（5 分进账）后总分维持 6.5

## 维度分

| 维度 | 分 | 一句话 |
|---|---|---|
| decisions | 9 | D1-D7/D9 全部实证落实、多引擎诚实标未实施；r72 新文案与五档/概述口径无冲突 |
| install | 3.5 | 安装链工程质量高（幂等+原子写+root 守卫+四态退出码）但用户视角今天走必断——主线 E404 无出路，r72 三条出路是未推送的画饼 |
| ux | 8 | 主流程无死路；r72 三修复 UX 兑现全部验证成立；余留兜底文案断言过强与两处反馈态时序差 |
| docs | 7.5 | r72 六条中五条逐字可从 diff 导出、PRIVACY 中英逐键吻合；唯「16 处」实数 15（第五轮计数水分复发） |
| release | 5 | 本地工程就绪（双加固实测到位、CI 七步门禁）；发布链三断链第 12 轮未动 + 版本账复刻 r70 错位 + 深比较漏网 + P7 三件仍缺 |

## confirmed（10 条）

### critical ×1 + 同根因 high ×1

1. **发布链三断链第 12 轮**：registry dist-tags.latest=0.1.2 / 远端 install.sh:43 钉 0.1.3（E404 必中且旧提示无出路）/ 本地 0.1.4 未发布 + 105 commits 未推 + 零 tag——新用户 curl|sh 主线 100% 装机死路。fix：push + npm publish 0.1.4 一次闭环（用户凭证操作递延第 13 轮起计）。
2. **r72 E404 出路三条对真实用户是画饼**（high，同根因独立表述）：修复文案只存在于未推送的本地 commits；verify 实测远端脚本全文无「E404」字样。即使推送 install.sh，不发 npm 主线依旧断——闭环必须 push + publish 两步。

### medium ×5

3. **出路教装 latest=0.1.2 跨协议漂移无兼容警告**——0.1.2 之后 packages/shared 有 18 个协议相关 commit（协议健壮族/发送帧类型闸/帧锚收口），用户按指引自救可能进入消息形状不匹配的半坏状态，比 E404 更难排查；与 r33-sec 钉版本防扩散意图相悖。fix：加最低兼容版本下限或仅指引 Issues。
4. **Onboarding FAQ E404 指引指向零 release 死源**——「稍等几分钟重试，或到 GitHub releases 确认」：releases 页实测空（API 返回 []），且 E404 真实成因（版本未发布）不是几分钟窗口。fix：指到 Issues 或 CHANGELOG，去掉时间承诺。
5. **CHANGELOG r72「16 处 satisfies」实数 15**（第五轮计数水分复发，code/product 双 workflow 独立同抓）——第 16 个 grep 命中是 protocol.ts 闸注释行；commit 18fe375 message 同虚高。fix 已执行：CHANGELOG 计数修正 + 修正注记入账（本次 r73 批一并 commit）。
6. **package-cws 深比较六字段残余漏网**——content_scripts/commands/background 等不在清单，改这些字段后不重建 dist 旧值静默上架。fix：深比较键集扩面或改为整 manifest 深比较白名单排除 version。
7. **P7 CWS 材料三件第 12 轮核实仍缺**——商店描述/截图/隐私理由表零落地，即便发布链修复，上架流程在 zip 之外依然卡死。

### low ×3

8. install.sh:47 出路命令嵌全角括号+• 项目符号，整行复制必语法错误（同文件 PATH 指引遵循「命令单独成行可粘贴」惯例，此行偏离自家标准）——出路命令单独成行。
9. 探测 10s 兜底落「未检测到本机 AI CLI」假告示（首轮 medium，resume 后 verify 降 low）——r72 显式文档化的有意权衡（解决更硬的零按钮死局），自愈出口就在告示下方；优化向：超时独立态文案「检测超时——点重试检测」。
10. CHANGELOG 版本账复刻 r70 C7 错位——r71 归位后 r72 又开新 Unreleased 段 + 未发布的 0.1.4 段带日期。fix 已执行：r73 批入账时 r71/r72/r73 一并并入 0.1.4 段（本次 commit）。

## rejected 0 / unfetched 0 / lows 4

CHANGELOG 历史段「零配置」残留（留痕，发布 checklist 加「对外摘引禁用」即可）/ README 折叠区版本硬编码漂移风险（发版脚本统一替换）/ 重试检测按钮 probing 8s 硬清零与回帧脱钩 / C5 落级活跃页的 page-meta 纠偏迟到（提取窗口期 tips 显旧页标题——落级选定 tab 后立即下发占位帧）。

## r71→r73 产品面修复验证（P1-P6 全兑现）

| r71 product | r73 核验 |
|---|---|
| P4 description 143→98 | ✅ 实测吻合 + 断言双源 |
| P2 agentsLoaded 死路 | ✅ 兑现（伴生 low#9 假告示文案） |
| P3 PRIVACY 英文两路径 | ✅ 与 host 代码逐键吻合、中英对齐 |
| P1 E404 出路 | ✅ 本地文案落地（但对真实用户画饼——high#2） |
| P6 zip 先删 | ✅ rmSync 实测到位 |
| P7 CWS 三件 | ❌ 第 12 轮仍缺（medium#7） |

## 判词

「工程就绪不等于产品交付。r72 五条修复逐字兑现、决策落实 9 分、UX 8 分、239 测试全绿、主流程无死路——但新用户走公开承诺的 curl|sh 必撞 E404 且无出路。push + publish 一步可解大半却递延 12 轮；CHANGELOG 计数水分第五轮复发，伤审计公信。维持 6.5、否。」

## r74 修复批建议排序

1. 发布链（用户凭证操作——publish 三连递延第 13 轮，工程侧无可修项）
2. E404 出路跨代警告（medium#3：去掉「装 latest」指引或加兼容下限）+ FAQ 死源改指 Issues（medium#4）+ 出路命令可复制化（low#8）——install.sh/Onboarding 单文件小改
3. package-cws 深比较扩面（medium#6）
4. P7 CWS 材料三件（medium#7，与发布链同批做才有意义）
