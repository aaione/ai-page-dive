# Changelog

本项目的所有显著变更记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本管理遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

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
