<div align="center">

<img src="./apps/extension/public/icon-128.png" width="96" alt="AI PageDive logo" />

# AI PageDive

**一键调用本机 AI CLI，深度总结当前网页的 Chrome 扩展。**

[![npm](https://img.shields.io/npm/v/@aaione/ai-page-dive.svg)](https://www.npmjs.com/package/@aaione/ai-page-dive)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: macOS + Chrome](https://img.shields.io/badge/platform-macOS%20%2B%20Chrome-blue)](#)
<!-- CWS 上线后替换为商店 badge：
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/<扩展ID>.svg)](https://chromewebstore.google.com/detail/<扩展ID>) -->

零配置 · 复用你已有的 CLI 订阅 · 无服务器、零遥测

<!-- TODO: 补 demo GIF（侧边栏总结动线 3-5 秒），放此位 -->

</div>

## 为什么是 AI PageDive

- **零配置**——无账号、无 API key：直接用你终端里已登录的 CLI（claude / codex 全支持，opencode 实验档）
- **无服务器、零遥测**——网页正文经 Chrome → Native Messaging 直交本机 CLI，全程不经 PageDive 中转、零遥测（CLI 与其模型服务的通信遵循该 CLI 自身的隐私政策，见 [PRIVACY.md](PRIVACY.md)）
- **权限最小化**——只申请 5 项权限，不申请 `<all_urls>`：点哪读哪（activeTab），其余页面零访问面
- **不只总结，还能改写**——「去 AI 味」模式把 AI 生成文本改写为自然人类口吻（竞品均无的独占档）；另有快速摘要 / 深度研读 / 论文阅读，`~/.ai-page-dive/workflows/` 可自定义新增
- **零凭证接触**——只子进程调起官方 CLI 二进制，不碰 token、不代理流量、不额外收费
- **流式输出**——markdown 实时渲染，正文下方继续输入即可多轮追问
- **本地历史**——自动保存在 `~/.ai-page-dive/history/`，面板内可恢复

## 快速开始（macOS + Chrome）

**① 安装扩展**（CWS 审核中，上线前先手动加载）：`chrome://extensions` 开启「开发者模式」→「加载已解压的扩展程序」→ 选本仓库 `apps/extension/dist/`（git clone 后先跑一次 `pnpm install && pnpm build` 生成）。
<!-- CWS 上线后反转：本步改为「Chrome Web Store 搜索 AI PageDive 一键安装」并启用顶部商店 badge -->

**② 安装本机组件**（一次性）：扩展面板会显示带扩展 ID 的完整命令，复制到终端执行；无 Node 时自动经 Homebrew 引导。

```bash
curl -fsSL https://raw.githubusercontent.com/aaione/ai-page-dive/main/install.sh | sh -s -- <扩展ID>
```

**③ 即用**：任意网页点工具栏图标（或按快捷键 `Ctrl+Shift+D`，macOS 为 `⌘⇧D`）→ 侧边栏选模式 → 总结。快捷键若无效或想改键，去 `chrome://extensions/shortcuts` 查看/修改。

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

不会。PageDive 没有服务器、零遥测，正文经 Chrome Native Messaging 直达本机 CLI，不经任何 PageDive 中转。之后内容如何处理由你所选 CLI 自身的隐私政策决定（claude → Anthropic、codex → OpenAI），详见 [PRIVACY.md](PRIVACY.md)。
</details>

<details>
<summary>和 Claude / ChatGPT 官方浏览器扩展有什么区别？</summary>

三点：**① 厂商中立**——官方扩展只接自家模型，PageDive 是多引擎（claude / codex / opencode），哪家订阅在用哪家，随时可换；**② 无云桥中转**——官方扩展的页面数据经厂商云端桥接服务处理，PageDive 正文直交本机 CLI，不经任何桥接域名；**③ 零凭证**——PageDive 不碰 OAuth/token，只子进程调起你已登录的 CLI，host 代码开源可审计。
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
