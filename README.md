# PageDive

[![CI](https://github.com/aaione/ai-page-dive/actions/workflows/ci.yml/badge.svg)](https://github.com/aaione/ai-page-dive/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@aaione/ai-page-dive.svg)](https://www.npmjs.com/package/@aaione/ai-page-dive)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一键调用本机 AI CLI 深度总结当前网页的 Chrome 扩展。

**零配置 · 复用你已有的 CLI 订阅 · 内容不出本机**

- 无账号、无 API key——直接用你终端里已登录的 claude / codex
- 网页正文全程在本机处理：Chrome → Native Messaging → 本机 CLI，无服务器、零遥测
- 流式 markdown 渲染、多轮追问、本地历史、可插拔 workflow

## 安装

**① 安装扩展**：Chrome Web Store 搜索 *AI PageDive*（审核中，上线前可先在 `chrome://extensions` 加载已解包的 `apps/extension/dist/`）。

**② 安装本机组件**（一次性）：扩展面板会显示带扩展 ID 的完整命令，复制到终端执行；无 Node 时自动经 Homebrew 引导。

```bash
curl -fsSL https://raw.githubusercontent.com/aaione/ai-page-dive/main/install.sh | sh -s -- <扩展ID>
```

装完回到浏览器即用。v1 支持 macOS + Chrome。

<details>
<summary>终端走不通时的手动备选（npm）</summary>

```bash
# Node >= 18；勿用 sudo npm——会写坏本机组件注册属主
npm i -g @aaione/ai-page-dive && ai-page-dive install --ext-id <扩展ID>
```
</details>

## 支持的 CLI

| CLI | 总结 | 追问 | 进程级围栏 |
|---|---|---|---|
| claude | ✅ | ✅ `--resume` | `--allowedTools=Read` |
| codex | ✅ | ✅ `exec resume` | `--sandbox read-only` |
| opencode | ✅ 实验 | — | 无（实验标注的原因） |

## 工作原理

```
Chrome MV3（Side Panel UI · SW 编排 · Content Script 提取）
  │ Native Messaging（长度前缀 JSON 帧，≤1MB）
  ▼
pagedive host（Node ≥18 薄壳，运行时零依赖）
  │ spawn——prompt 走 stdin，正文写本地临时文件
  ▼
claude / codex / opencode（官方 CLI，你自己的登录态）
```

- 提取管线：Readability → DOMPurify → Turndown(GFM)；站点适配器 + innerText 兜底
- 隐私边界：零凭证接触（只子进程调起未修改的官方 CLI）、零流量代理、无服务器
- workflow：`~/.ai-page-dive/workflows/<name>/WORKFLOW.md`，目录即插件、用户目录可 shadow 内置
- 历史：`~/.ai-page-dive/history/年/月/日/`，markdown + frontmatter 元数据

决策记录见 [DECISIONS.md](DECISIONS.md)，数据处理细节见 [PRIVACY.md](PRIVACY.md)。

## 开发

```bash
pnpm i && pnpm -r build && pnpm test         # vitest：流解析器 / NM 帧 / history / 终局状态机
node packages/host/scripts/smoke.mjs claude   # 真实 CLI 端到端冒烟（claude|codex [cancel]）
```

monorepo：`apps/extension`（Vite + React + TS）· `packages/host`（NM host）· `packages/shared`（协议与类型）。

## 路线图

v1.x：审校模式（第二引擎审校总结）→ v2：Windows / Edge / workflow marketplace / 常驻 daemon。详见 [DECISIONS.md](DECISIONS.md)。

## License

[MIT](LICENSE)
