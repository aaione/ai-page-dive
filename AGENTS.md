# AGENTS.md

## Project Overview

PageDive — Chrome 扩展（MV3）：一键调用本机已装的 AI CLI（claude / codex）深度总结当前网页。
零配置、复用用户已有 CLI 订阅、内容不出本机、可插拔总结 workflow。

### Repository

- Remote: `git@github.com:aaione/page-dive.git`（origin/main）

### Must Read

- **决策记录**：`DECISIONS.md` — 9 个已拍板决策 + 技术栈 + 既定技术决策 + v1 范围。任何实现不得违背
- **架构细节**：`research/product-architecture-report.md` — 架构图、AgentDef 接口、安装流程、风险清单、来源索引

## Project Structure & Module Organization

pnpm monorepo：

- `apps/extension` — Vite + React + TS + Tailwind v4 + react-markdown
- `packages/host` — 纯 Node >=18 + TS，运行时零依赖
- `packages/shared` — AgentDef 类型 / NM 消息协议

测试 vitest（host 流解析器 + buildArgs 纯函数）。

## Hard Constraints（违反即 bug）

1. 权限只有 `activeTab` + `scripting` + `nativeMessaging` + `sidePanel`，**不申请 `<all_urls>`**
2. CLI 的 prompt/正文**一律走 stdin**（argv 有长度上限）；正文写本地临时文件，prompt 给路径
3. **零凭证接触**：只子进程调起用户自己登录的未修改官方 CLI 二进制；不碰 token/OAuth、不代理流量、永不对 CLI 用量收费
4. claude 的运行内失败打在 stdout（`is_error`），不能只看退出码
5. host 是薄壳（目标 <2k 行 Node）：per-connection spawn、幂等、pgid 收割进程树、流归一化、≤1MB chunk 分片
6. v1 = macOS + Chrome；claude + codex 双适配器（AgentDef 接口按六家字段并集设计）
7. 历史落盘 `~/.pagedive/history/年/月/日/时间戳-slug.md`（frontmatter 元数据）；workflow 在 `~/.pagedive/workflows/`

## v1 Priority

**零配置 + 深度总结质量。** 其余一切（daemon、全文搜索、Windows、marketplace……）都是 v2+，见 DECISIONS.md。

## Install Flow（用户视角）

CWS 装扩展 → 首次点击提示 `npm i -g pagedive && pagedive install`（注册 NM host + 探测本机 CLI）→ 回浏览器即用。

## Commit & Pull Request Guidelines

Commits follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>[scope]: <description>
```

- **type** (required, lowercase) — `feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore`
- **scope** (optional) — `ext`（apps/extension）/ `host`（packages/host）/ `shared`（packages/shared）/ `repo`
- **description** (required) — imperative mood, lowercase, no trailing period
- **Breaking changes** — append `!` after type/scope (`feat!:`)

### Examples

```
feat(ext): sidePanel 渲染 markdown 流式输出
fix(host): pgid 收割遗漏子进程
```

### Author

- **Author** — every commit must be authored as `tj <tiejia0319@gmail.com>`. Use `git commit --author="tj <tiejia0319@gmail.com>"` (or set the author identity accordingly) so the recorded author is always `tj <tiejia0319@gmail.com>`, regardless of who runs the commit.
