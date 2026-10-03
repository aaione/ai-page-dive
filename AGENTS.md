# AGENTS.md

## Project Overview

PageDive — Chrome 扩展（MV3）：一键调用本机已装的 AI CLI（claude / codex）深度总结当前网页。
零配置、复用用户已有 CLI 订阅、内容不出本机、可插拔总结 workflow。

### Repository

- Remote: `git@github.com:aaione/ai-page-dive.git`（origin/main）

### Must Read

- **决策记录**：`DECISIONS.md` — 9 个已拍板决策 + 技术栈 + 既定技术决策 + v1 范围。任何实现不得违背
- **架构细节**：`research/product-architecture-report.md` — 架构图、AgentDef 接口、安装流程、风险清单、来源索引

## Project Structure & Module Organization

pnpm monorepo：

- `apps/extension` — Vite + React + TS + Tailwind v4 + react-markdown
- `packages/host` — 纯 Node >=18 + TS，运行时零依赖
- `packages/shared` — AgentDef 类型 / NM 消息协议

测试 vitest（host 流解析器 + buildArgs + 真实流 fixture 重放 + pgid 收割链/runNative 关停子进程集成 + 终局删收敛（is_error/超时已交付零 tmp 残留）/肥 frontmatter 头兜底/存量 0755 收敛 + extension 历史轮切分/SW 回归网（chrome shim 锚 session-lost 竞态/断连清理/丢片对账/分片上限）+ jsdom 内容提取三形状等单测，161 用例）。

## Dev Harness（UI 可视化自验）

chrome-extension:// 页面无法被自动化浏览器直接导航——`apps/extension/dev.html` + `src/dev/chrome-mock.ts`（chrome API shim + 场景参数 + mock 任务流）是 UI 自验路径：`cd apps/extension && npx vite` 起 dev server，自动化浏览器导航 `http://localhost:5173/dev.html`（场景开关 `?swcycle=claude` / `?unsupported=1` 等与 mock 能力见 chrome-mock.ts 头注释）。dev 入口不进生产构建（不在 rollupOptions.input）。⚠ harness 验证**只用 dev server，勿跑单段 `npx vite build`**——完整构建是两段（`pnpm build`，第二段 `vite.content.config.ts` 才产 `content.js`），单段会产出「manifest 动态注入声明存在但文件缺失」的残缺 dist 覆盖真机在用的加载目录，扩展报 `Could not load file: 'content.js'`。

## Hard Constraints（违反即 bug）

1. 权限只有 `activeTab` + `scripting` + `nativeMessaging` + `sidePanel` + `storage`，**不申请 `<all_urls>`**（`storage` 仅用 session 域——SW 30s 回收后恢复追问会话态，纯内存不落盘、零站点访问面，2026-09-08 修订加入；2026-09-23 修订：加 `optional_host_permissions` 供设置页「始终允许读取网页」开关用户主动授予，安装时零警告、默认关闭，见 DECISIONS.md D3）
2. CLI 的 prompt/正文**一律走 stdin**（argv 有长度上限）；正文写本地临时文件，prompt 给路径
3. **零凭证接触**：只子进程调起用户自己登录的未修改官方 CLI 二进制；不碰 token/OAuth、不代理流量、永不对 CLI 用量收费
4. claude 的运行内失败打在 stdout（`is_error`），不能只看退出码
5. host 是薄壳（运行时 <2.2k 行 Node，CI 断言 `scripts/check-host-lines.mjs`）：per-connection spawn、幂等、pgid 收割进程树、流归一化、≤1MB chunk 分片（2026-09-23 修订：原 <2k 被真实业务代码撑破，重校准到 2.2k 并把统计口径改成「host 进程跑的总代码量」——跨 workspace 包一并计入，拆包不再是绕过红线的后门。**再破线时删功能，不要再抬阈值**）
6. v1 = macOS + Chrome；claude + codex 双适配器（2026-09-16 曾入 opencode 实验档，2026-09-22 因 macOS 上游 Gatekeeper 死结下架，2026-10-01 适配器文件删除守行数红线——恢复条件与恢复路径见 DECISIONS.md D5 修订）
7. 历史落盘 `~/.ai-page-dive/history/年/月/日/时间戳-slug.md`（frontmatter 元数据）；workflow 在 `~/.ai-page-dive/workflows/`、技能在 `~/.ai-page-dive/skills/`

## v1 Priority

**零配置 + 深度总结质量。** 其余一切（daemon、全文搜索、Windows、marketplace……）都是 v2+，见 DECISIONS.md。

## Install Flow（用户视角）

CWS 装扩展 → 首次点击提示复制 `curl -fsSL https://raw.githubusercontent.com/aaione/ai-page-dive/main/install.sh | sh -s -- <扩展ID>`（仓库根 install.sh：Node≥18 探测 + brew 兜底 + npm i -g + NM 注册）→ 回浏览器即用。npm 两连命令（`npm i -g @aaione/ai-page-dive && ai-page-dive install --ext-id <ID>`）保留为折叠区手动备选。

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
