# Changelog

本项目的所有显著变更记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本管理遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

r65 审计修复批（r64 双终审 Top5 必修：代码侧 2 项已修——收割定向化经 r66 复审为半边残留；发布链三连/CWS 材料/守门 CI 首跑 3 项属运营待办未动）+ r60–r63 审计修复批 + r64/r66 双终审报告入库（`reports/2026-10-07-*-audit.md`、`reports/2026-10-08-*-audit.md`、`reports/2026-10-09-r64-*-audit.md`、`reports/2026-10-09-r66-*-audit.md`）+ r67 修复批（r66 code 全部 4 项可修 medium + low 批，见 Fixed 尾部 r67 条目）。

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

### Changed

- 扩展构建挂 `tsc --noEmit` 类型门禁（vite 转译不查类型导致的历史假绿根因）

### Docs

- 测试 210 → 219 用例：CLI 真实流 fixture 重采（claude 2.1.162 / codex 0.156.1）+ 重放断言从「unrecognized 计数」单锚升级为「累积正文 === 采录终稿」双向锚
- 测试 224 → 229 用例（r65）：assistant content 形状闸 / frontmatter 入口剥离 / SW 收割定向化 / 停止按钮 cancel 帧契约 ×2（r63 M1 修复钉住）；README 五档名对齐 workflow-labels 实名（论文模式 / 去 AI 味改写）、测试数字 25 文件口径补齐
- 宪法同步：DECISIONS D3 权限清单补记 `storage`、「始终允许读取网页」开关实装位对齐授权气泡；README 档位列举补第五档「产品审计」；PRIVACY activeTab 行表述理顺；测试 219 → 224（C1 消毒 / 畸形 text_delta 闸 / SummarizeView 授权开关冒烟 ×3——UI 组件测试设施第一锹，`@testing-library/react`）
- r66 双终审报告入库：代码 7.8（0 critical / 0 high / 7 medium——收割定向化半边残留、frontmatter 双剥丢首段新洞、测试债在涨）；产品 6.0 否（发布链第 7 轮 critical 维持、实驱 9 场景全绿）；本行上方 Unreleased 头措辞同步如实化（Top5 必修 2/5 → 如实分列，r66 产品#5）
- r68 双终审报告入库（`reports/2026-10-10-r68-*-audit.md`）：代码 7.6 否（0 critical / 0 high / 7 medium——r67 帧锚修复「只收半边口」：面板锚播种与内容源 target 仍读单例）；产品 6.0 否（发布链第 9 轮 critical 维持、断口 74→81、远端 install.sh 钉 0.1.3 双版本 E404 补强；r66 low 批四项 + 两条 code medium 产品面实驱全部关账；新账 3 medium：面板 npmCmd 裸 && / dist 滞后守门不查一致性 / CHANGELOG 计数措辞）

## [0.1.4] - 2026-10-06

r59 审计修复批（产品 + 代码双终审报告见 `reports/2026-10-05-*.md`）。

### Fixed

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

### Docs

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
