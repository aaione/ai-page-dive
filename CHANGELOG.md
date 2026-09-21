# Changelog

本项目的所有显著变更记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本管理遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

## [0.1.3] - 2026-09-21

### Added

- 第七氛围档「墨岩」：近黑月光底梯 + 冷白微蓝光斑，刻意低通量防黑底泛灰；档位网格改 4 列两行齐（`da984dc`）
- 本 CHANGELOG.md

### Fixed

- 图标点击开面板回归：`sidePanel.open` 恒同步执行以保住 user gesture，toggle 仲裁移 panel 侧（`2a68356`）
- 历史详情还原失效：history-file 读取 `.content` 字段修复（`2ecdcf3`）
- 附件超 NM 帧限：附件预算压回 1MB 分片以内（`2ecdcf3`）
- 安装引导防闪跳：probe 防 stale-port 误判（`2ecdcf3`）
- 无障碍五连：读屏洪泛收敛 / overlay 对话框语义 + Esc / 历史读取 loading + 5s 超时 / 图标按钮可访问名 / 复制失败兜底（`33b34c0`）
- 文案九连：删三重冗余引导、时限真实化（「秒级出稿」→「约十几秒」）、品牌名统一为 AI PageDive、术语统一（深度总结/本机组件/可自定义）（`4afdecb`）
- manifest 最低 Chrome 版本 114 → 116（`sidePanel.open()` 实际引入版本，114/115 下图标点击会静默失效）

### Changed

- 对比度与 token 卫生：snippet / chat 小字提亮一档、brightness 残留换 accent-hover、头注 blur 区间对齐实况（`f38c842`）

## [0.1.2] 及更早

未单独维护，见 git 历史（`git log --oneline`）。
