<div align="center">

<img src="./apps/extension/public/icon-128.png" width="96" alt="AI PageDive logo" />

# AI PageDive

**一键调用本机 AI CLI，深度总结当前网页的 Chrome 扩展。**

[![npm](https://img.shields.io/npm/v/@aaione/ai-page-dive.svg)](https://www.npmjs.com/package/@aaione/ai-page-dive)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: macOS + Chrome](https://img.shields.io/badge/platform-macOS%20%2B%20Chrome-blue)](#)
<!-- CWS 上线后替换为商店 badge：
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/<扩展ID>.svg)](https://chromewebstore.google.com/detail/<扩展ID>) -->

零配置 · 复用你已有的 CLI 订阅 · 内容不出本机

<!-- TODO: 补 demo GIF（侧边栏总结动线 3-5 秒），放此位 -->

</div>

## 为什么是 AI PageDive

- **零配置**——无账号、无 API key：直接用你终端里已登录的 CLI（claude / codex 全支持，opencode 实验档）
- **内容不出本机**——网页正文全程本机处理：Chrome → Native Messaging → 本机 CLI，无服务器、零遥测
- **零凭证接触**——只子进程调起官方 CLI 二进制，不碰 token、不代理流量、不额外收费
- **流式输出**——markdown 实时渲染，正文下方继续输入即可多轮追问
- **四种内置模式**——快速摘要 / 深度研读 / 论文阅读 / 去 AI 味（全文改写为自然人类口吻），并可在 `~/.ai-page-dive/workflows/` 自定义新增
- **本地历史**——自动保存在 `~/.ai-page-dive/history/`，面板内可恢复

## 快速开始（macOS + Chrome）

**① 安装扩展**（CWS 审核中，上线前先手动加载）：`chrome://extensions` 开启「开发者模式」→「加载已解压的扩展程序」→ 选本仓库 `apps/extension/dist/`（git clone 后先跑一次 `pnpm install && pnpm build` 生成）。
<!-- CWS 上线后反转：本步改为「Chrome Web Store 搜索 AI PageDive 一键安装」并启用顶部商店 badge -->

**② 安装本机组件**（一次性）：扩展面板会显示带扩展 ID 的完整命令，复制到终端执行；无 Node 时自动经 Homebrew 引导。

```bash
curl -fsSL https://raw.githubusercontent.com/aaione/ai-page-dive/main/install.sh | sh -s -- <扩展ID>
```

**③ 即用**：任意网页点工具栏图标 → 侧边栏选模式 → 总结。

<details>
<summary>终端走不通时的手动备选（npm）</summary>

```bash
# Node >= 18；勿用 sudo npm——会写坏本机组件注册属主
npm i -g @aaione/ai-page-dive && ai-page-dive install --ext-id <扩展ID>
```
</details>

## FAQ

<details>
<summary>会不会碰我的 CLI 凭证或订阅？</summary>

不会。AI PageDive 只以子进程方式调起你自己登录的官方 CLI 二进制（claude / codex），不碰 token、不代理流量、不对 CLI 用量额外收费。host 代码全开源（MIT），可自行审计。
</details>

<details>
<summary>网页内容会被上传到你们的服务器吗？</summary>

不会。没有服务器、零遥测。正文提取后全程在本机处理（Chrome → Native Messaging → 本机 CLI），详见 [PRIVACY.md](PRIVACY.md)。
</details>

<details>
<summary>支持哪些 CLI？支持 Windows 吗？</summary>

v1 支持 claude 与 codex（完整支持）+ opencode（实验档，无进程级工具围栏，UI 有标注）；v1 仅支持 macOS + Chrome，Windows / Edge / Brave 在路线图上（[DECISIONS.md](DECISIONS.md)）。
</details>

<details>
<summary>安装命令里的「扩展 ID」是什么？</summary>

是 Chrome 为扩展分配的唯一 ID（`chrome://extensions` 里可见）。本机组件需用它登记 Native Messaging 白名单，扩展面板会自动显示拼好的完整命令，直接复制即可。
</details>

<details>
<summary>模式（workflow）能自定义吗？</summary>

能。模式定义存于 `~/.ai-page-dive/workflows/`，目录即插件：新建目录 + `WORKFLOW.md` 即生效，同名目录可覆盖内置模式；也可在扩展设置页编辑。
</details>

## 开发者

<details>
<summary>架构、决策与贡献</summary>

- pnpm monorepo：`apps/extension`（Vite + React + TS + Tailwind v4）/ `packages/host`（纯 Node ≥18，运行时零依赖）/ `packages/shared`（类型与 NM 协议）
- 必读：[DECISIONS.md](DECISIONS.md)（已拍板决策）· [research/product-architecture-report.md](research/product-architecture-report.md)（架构报告）· [AGENTS.md](AGENTS.md)（贡献规范）
- 测试：vitest 覆盖 host 流解析器 + buildArgs 纯函数

```bash
pnpm install && pnpm build   # 构建后在 chrome://extensions 加载 apps/extension/dist/
```
</details>

## License

[MIT](LICENSE)
