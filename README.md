<div align="center">

<img src="./apps/extension/public/icon-128.png" width="96" alt="PageDive logo" />

# AI PageDive

**一键调用本机 AI CLI，深度总结当前网页的 Chrome 扩展。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
<!-- CWS 上线后补商店 badge 并反转安装步骤① -->

零账号 · 零 API key · 复用你已有的 CLI 订阅 · 无服务器、零遥测

</div>

## 为什么是 PageDive

- **深读，不是浅摘要**——复用你终端里的 CLI 做 agent 式多步精读（claude / codex 双引擎）：通读全文、markdown 流式输出、多轮追问，总结质量与终端同源
- **零账号 · 零 API key**——直接复用已登录的 CLI 订阅，无任何注册与配置
- **只信本机**——正文经 Chrome Native Messaging 直交本机 CLI，无服务器、零遥测、不碰凭证（[PRIVACY.md](PRIVACY.md)）
- **点到哪读到哪**——安装时仅 5 项权限 + 1 项默认关闭的可选读取权限（用户主动开启），不申请 `<all_urls>`：默认 activeTab 点哪读哪，其余页面零访问面
- **持续可玩**——快速摘要 / 深度总结 / 论文模式 / 去 AI 味改写 / 产品审计五档模式（`~/.ai-page-dive/workflows/` 可自定义新增）、历史本地可恢复

## 快速开始（macOS + Chrome）

**⓪ 前置**：终端已装并登录 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 或 [Codex](https://developers.openai.com/codex/cli)（跑一次 `claude` 或 `codex` 确认无鉴权提示）。

**① 安装扩展**（准备提交 CWS，上架前先手动加载）：`chrome://extensions` 开启「开发者模式」→「加载已解压的扩展程序」→ 选本仓库 `apps/extension/dist/`（git clone 后先跑一次 `pnpm install && pnpm build` 生成）。

**② 安装本机组件**（一次性）：扩展面板会显示带扩展 ID 的完整命令（ID 即 Chrome 分配的扩展唯一标识，面板自动拼好），复制到终端执行；无 Node 时若装有 Homebrew 会自动经其安装（首次需先装 Xcode 命令行工具，可能较慢），否则给出手动安装指引。

```bash
curl -fsSL https://raw.githubusercontent.com/aaione/ai-page-dive/main/install.sh | sh -s -- <扩展ID>
```

> 🔒 不想盲跑？脚本[源码同仓库、执行前可先读](./install.sh)（MIT）：钉版本安装（`@0.1.4`，不追 latest）、不下载任何二进制、无 sudo、只装 npm 包并注册 Chrome 本机组件。

**③ 即用**：任意网页点工具栏图标（或按快捷键 `Ctrl+Shift+D`，macOS 为 `⌘⇧D`）→ 侧边栏选模式 → 总结。快捷键若无效或想改键，去 `chrome://extensions/shortcuts` 查看/修改。

<details>
<summary>终端走不通时的手动备选（npm）</summary>

```bash
# Node >= 18；勿用 sudo npm——会写坏本机组件注册属主；钉版本与 install.sh 一致
# 两条分开跑：&& 拼接时第一条失败会静默吞掉第二条（r66 low，拆行失败各自可见）
npm i -g @aaione/ai-page-dive@0.1.4
ai-page-dive install --ext-id <扩展ID>
```
</details>

## FAQ

<details>
<summary>会不会碰我的 CLI 凭证或订阅？</summary>

不会。PageDive 只以子进程方式调起你自己登录的官方 CLI 二进制（claude / codex），不碰 token、不代理流量、不对 CLI 用量额外收费。host 代码全开源（MIT），可自行审计。
</details>

<details>
<summary>总结会消耗我的 CLI 订阅额度吗？</summary>

会。每次总结/追问对该 CLI 而言就是一次正常调用，用量计入你自己的订阅（面板 tips 条的 ≈N tokens 是正文体量估算，深度档单页可达数万 tokens）。PageDive 不加价、不收费，也无法替你豁免——这正是「复用已有订阅」的本来含义。
</details>

<details>
<summary>网页内容会被上传到你们的服务器吗？</summary>

不会。PageDive 没有服务器、零遥测，正文经 Chrome Native Messaging 直达本机 CLI，不经任何 PageDive 中转。之后内容如何处理由你所选 CLI 自身的隐私政策决定（claude → Anthropic、codex → OpenAI），详见 [PRIVACY.md](PRIVACY.md)。
</details>

<details>
<summary>这条 <code>curl | sh</code> 安全吗？</summary>

三层防护：**① 钉版本**——脚本内部执行 <code>npm i -g @aaione/ai-page-dive@0.1.4</code>，不追 latest（npm tarball 自带 registry integrity 校验）；**② 不下载二进制**——只装 npm 包 + 注册 Chrome 本机组件，无 sudo、不写系统目录；**③ 全程可审**——脚本托管在本仓库（[install.sh](./install.sh)，MIT），执行前可先读源码。不额外发布 SHA256：哈希与脚本同仓库同信道，恶意 release 会同步改哈希，密码学上零增益。
</details>

<details>
<summary>和浏览器自带的页面摘要 AI 有什么区别？</summary>

浏览器原生摘要免费预装，但锁自家模型、多为单次浅摘要，页面数据经厂商云端处理。PageDive 复用你已有的 CLI 订阅做 agent 式多步深读（通读全文、workflow 可插拔、多轮追问），正文经 Native Messaging 直交本机 CLI，不经 PageDive 任何服务器。
</details>

<details>
<summary>和 Claude / ChatGPT 官方浏览器扩展有什么区别？</summary>

三点：**① 厂商中立**——官方扩展只接自家模型，PageDive 是多引擎（claude / codex，更多 CLI 见路线图），哪家订阅在用哪家，随时可换；**② 无云桥中转**——官方扩展的页面数据经厂商云端桥接服务处理，PageDive 正文直交本机 CLI，不经任何桥接域名；**③ 零凭证**——PageDive 不碰 OAuth/token，只子进程调起你已登录的 CLI，host 代码开源可审计。
</details>

<details>
<summary>支持哪些 CLI？支持 Windows 吗？</summary>

v1 支持 claude 与 codex 双引擎（完整支持）；曾实验性支持 opencode，因 macOS 上游 Gatekeeper 死结已移除（详见 [DECISIONS.md](DECISIONS.md)）。追问能力：claude 与 codex 均支持多轮追问——claude 复用 CLI 会话 id；codex 以 thread_id 续接会话（CLI 未回传 thread 信息的罕见降级下，该轮独立成新轮，其余轮次不受影响）。v1 仅支持 macOS + Chrome，Windows / Edge / Brave 在路线图上（[DECISIONS.md](DECISIONS.md)）。
</details>

<details>
<summary>如何卸载？</summary>

Chrome 移除扩展后，终端**先执行 `ai-page-dive uninstall`** 清理本机组件注册（NM manifest + wrapper），**再** `npm uninstall -g @aaione/ai-page-dive` 移除包本身（顺序不可反——包删掉后这个命令出口就没了）。⚠️ 不要指望 npm 卸载钩子自动清理：npm ≥7 默认不执行 preuninstall 钩子，直接 `npm uninstall -g` 会把 NM 注册残留在本机（早期版本包甚至未带钩子）。历史记录与自定义 workflow 保留在 `~/.ai-page-dive/`，不需要可手动删除；只想清注册保留 npm 包，跑到第一步即可。
</details>

<details>
<summary>遇到问题？</summary>

先走三步自查：**① 面板顶部有版本横幅** = 扩展与本机组件版本错位，复制横幅里的命令到终端重装即可对齐（若该命令报 **E404**：该版本尚未发布到 npm——勿手改装其他版本（跨版本消息协议可能不匹配），到 [issues](https://github.com/aaione/ai-page-dive/issues) 反馈或等发版后重跑）；**② 终端跑 `which claude` / `which codex`** 确认 CLI 在 PATH 且跑一次无鉴权提示；**③ 重装本机组件**（同②横幅命令，无脑可重复）。仍不行请到 [issues](https://github.com/aaione/ai-page-dive/issues) 搜索或新建（附上扩展版本号与横幅命令输出）。

**④ macOS 弹「无法验证开发者」安全窗**：先看弹窗指名的是哪个文件——本机组件是纯 npm 脚本（无二进制，不会触发），被拦的几乎总是 **CLI 本体**（claude / codex 官方安装器带的二进制，首次执行时 macOS 按隔离标记拦截，与从终端还是从扩展拉起无关）。出路：系统设置 → 隐私与安全性 → 底部「仍要打开」放行一次，或在终端跑 `xattr -d com.apple.quarantine <弹窗指名的文件路径>`；放行后回扩展重试即可。
</details>

## 开发者

<details>
<summary>架构、决策与贡献</summary>

- pnpm monorepo：`apps/extension`（Vite + React + TS + Tailwind v4）/ `packages/host`（纯 Node ≥18，运行时零依赖）/ `packages/shared`（类型与 NM 协议）
- 必读：[DECISIONS.md](DECISIONS.md)（已拍板决策）· [research/product-architecture-report.md](research/product-architecture-report.md)（架构报告）· [AGENTS.md](AGENTS.md)（贡献规范）
- 测试：vitest 295 用例——host 流解析器 / buildArgs / 真实流 fixture 重放 / pgid 收割链 / 历史轮切分 / SW 回归网（chrome shim 锚冷唤醒竞态、断连清理、丢片对账、分片上限、孤儿任务指针、resolveContentTab 落级链）/ 终局三戳直测 / jsdom 内容提取（与 [AGENTS.md](AGENTS.md) 同口径）

```bash
pnpm install && pnpm test    # 全量测试（28 文件 / 295 用例）
pnpm build                   # 构建后在 chrome://extensions 加载 apps/extension/dist/
```
</details>

## License

[MIT](LICENSE)
