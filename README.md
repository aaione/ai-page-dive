<div align="center">

<img src="./apps/extension/public/icon-128.png" width="96" alt="PageDive logo" />

# AI PageDive

**一键调用本机 AI CLI，深度总结当前网页的 Chrome 扩展。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
<!-- CWS 上线后补商店 badge 并反转安装步骤① -->

零账号 · 零 API key · 复用你已有的 CLI 订阅 · 无服务器、零遥测

</div>

## 为什么是 PageDive

- **开箱即用**——无账号、无 API key：直接复用终端里已登录的 CLI（claude / codex 双引擎；opencode 适配器已就绪，暂因 macOS 上游问题下架，见 [DECISIONS.md](DECISIONS.md)）
- **只信本机**——正文经 Chrome Native Messaging 直交本机 CLI，无服务器、零遥测、不碰凭证（[PRIVACY.md](PRIVACY.md)）
- **点到哪读到哪**——安装时仅 5 项权限 + 1 项默认关闭的可选读取权限（用户主动开启），不申请 `<all_urls>`：默认 activeTab 点哪读哪，其余页面零访问面
- **持续可玩**——快速摘要 / 深度研读 / 论文阅读 / 去 AI 味多档模式（`~/.ai-page-dive/workflows/` 可自定义新增）、markdown 流式输出、多轮追问、历史本地可恢复

## 快速开始（macOS + Chrome）

**⓪ 前置**：终端已装并登录 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 或 [Codex](https://developers.openai.com/codex/cli)（跑一次 `claude` 或 `codex` 确认无鉴权提示）。

**① 安装扩展**（CWS 审核中，上线前先手动加载）：`chrome://extensions` 开启「开发者模式」→「加载已解压的扩展程序」→ 选本仓库 `apps/extension/dist/`（git clone 后先跑一次 `pnpm install && pnpm build` 生成）。

**② 安装本机组件**（一次性）：扩展面板会显示带扩展 ID 的完整命令（ID 即 Chrome 分配的扩展唯一标识，面板自动拼好），复制到终端执行；无 Node 时自动经 Homebrew 引导。

```bash
curl -fsSL https://raw.githubusercontent.com/aaione/ai-page-dive/main/install.sh | sh -s -- <扩展ID>
```

> 🔒 不想盲跑？脚本[源码同仓库、执行前可先读](./install.sh)（MIT）：钉版本安装（`@0.1.3`，不追 latest）、不下载任何二进制、无 sudo、只装 npm 包并注册 Chrome 本机组件。

**③ 即用**：任意网页点工具栏图标（或按快捷键 `Ctrl+Shift+D`，macOS 为 `⌘⇧D`）→ 侧边栏选模式 → 总结。快捷键若无效或想改键，去 `chrome://extensions/shortcuts` 查看/修改。

<details>
<summary>终端走不通时的手动备选（npm）</summary>

```bash
# Node >= 18；勿用 sudo npm——会写坏本机组件注册属主；钉版本与 install.sh 一致
npm i -g @aaione/ai-page-dive@0.1.3 && ai-page-dive install --ext-id <扩展ID>
```
</details>

## FAQ

<details>
<summary>会不会碰我的 CLI 凭证或订阅？</summary>

不会。PageDive 只以子进程方式调起你自己登录的官方 CLI 二进制（claude / codex），不碰 token、不代理流量、不对 CLI 用量额外收费。host 代码全开源（MIT），可自行审计。
</details>

<details>
<summary>网页内容会被上传到你们的服务器吗？</summary>

不会。PageDive 没有服务器、零遥测，正文经 Chrome Native Messaging 直达本机 CLI，不经任何 PageDive 中转。之后内容如何处理由你所选 CLI 自身的隐私政策决定（claude → Anthropic、codex → OpenAI），详见 [PRIVACY.md](PRIVACY.md)。
</details>

<details>
<summary>这条 <code>curl | sh</code> 安全吗？</summary>

三层防护：**① 钉版本**——脚本内部执行 <code>npm i -g @aaione/ai-page-dive@0.1.3</code>，不追 latest（npm tarball 自带 registry integrity 校验）；**② 不下载二进制**——只装 npm 包 + 注册 Chrome 本机组件，无 sudo、不写系统目录；**③ 全程可审**——脚本托管在本仓库（[install.sh](./install.sh)，MIT），执行前可先读源码。不额外发布 SHA256：哈希与脚本同仓库同信道，恶意 release 会同步改哈希，密码学上零增益。
</details>

<details>
<summary>和浏览器自带的页面摘要 AI 有什么区别？</summary>

浏览器原生摘要免费预装，但锁自家模型、多为单次浅摘要，页面数据经厂商云端处理。PageDive 复用你已有的 CLI 订阅做 agent 式多步深读（通读全文、workflow 可插拔、可追问），正文经 Native Messaging 直交本机 CLI，不经 PageDive 任何服务器。
</details>

<details>
<summary>和 Claude / ChatGPT 官方浏览器扩展有什么区别？</summary>

三点：**① 厂商中立**——官方扩展只接自家模型，PageDive 是多引擎（claude / codex，opencode 适配器待上游修复后回归），哪家订阅在用哪家，随时可换；**② 无云桥中转**——官方扩展的页面数据经厂商云端桥接服务处理，PageDive 正文直交本机 CLI，不经任何桥接域名；**③ 零凭证**——PageDive 不碰 OAuth/token，只子进程调起你已登录的 CLI，host 代码开源可审计。
</details>

<details>
<summary>支持哪些 CLI？支持 Windows 吗？</summary>

v1 支持 claude 与 codex 双引擎（完整支持）；opencode 适配器已就绪，暂因 macOS 上游 Gatekeeper 问题下架（详见 [DECISIONS.md](DECISIONS.md)）。追问能力：claude 支持多轮追问（复用 CLI 会话）；codex 暂不支持（CLI 不回传会话 id，每次新提问独立成轮）。v1 仅支持 macOS + Chrome，Windows / Edge / Brave 在路线图上（[DECISIONS.md](DECISIONS.md)）。
</details>

## 开发者

<details>
<summary>架构、决策与贡献</summary>

- pnpm monorepo：`apps/extension`（Vite + React + TS + Tailwind v4）/ `packages/host`（纯 Node ≥18，运行时零依赖）/ `packages/shared`（类型与 NM 协议）
- 必读：[DECISIONS.md](DECISIONS.md)（已拍板决策）· [research/product-architecture-report.md](research/product-architecture-report.md)（架构报告）· [AGENTS.md](AGENTS.md)（贡献规范）
- 测试：vitest 覆盖 host 流解析器 / buildArgs / 历史轮切分（host + extension 源码内单测）

```bash
pnpm install && pnpm build   # 构建后在 chrome://extensions 加载 apps/extension/dist/
```
</details>

## License

[MIT](LICENSE)
