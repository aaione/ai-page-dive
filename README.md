# PageDive

一键调用本机 AI CLI（claude / codex）深度总结当前网页的 Chrome 扩展。
零配置、复用你已有的 CLI 订阅、内容不出本机。

## 架构

```
Chrome MV3 扩展（Side Panel UI + SW 编排 + Content Script 提取）
  │ Native Messaging（4 字节长度前缀 JSON 帧）
  ▼
pagedive host（薄壳 Node，<2k 行，运行时零依赖）
  │ spawn（prompt 走 stdin，正文写临时文件）
  ▼
claude -p --output-format stream-json / codex exec --json
```

- 提取管线：Readability → DOMPurify → Turndown(GFM)，arXiv 适配器打样，innerText 兜底
- 历史：`~/.ai-page-dive/history/年/月/日/时间戳-slug.md`（frontmatter 元数据）
- workflow：`~/.ai-page-dive/workflows/<name>/WORKFLOW.md`（正文即 prompt，shadow 内置）

## 开发

```bash
pnpm i && pnpm -r build && pnpm test   # vitest：流解析器/buildArgs/NM 帧/history
node packages/host/scripts/smoke.mjs claude   # 真实 CLI 端到端冒烟（claude|codex [cancel]）
```

### 浏览器手动验收（开发期）

1. `chrome://extensions` 开发者模式 → 加载已解包 `apps/extension/dist/`
2. 复制扩展 ID → `node packages/host/dist/index.js install --ext-id <ID>`（origins 追加不覆盖）
3. 完全重启 Chrome → 打开任意文章页 → 点工具栏图标 → Side Panel「深度总结当前页」

## 安装（用户视角）

CWS 装扩展 → 首次打开面板，复制提示中的一条命令到终端执行（无 Node 会自动经 Homebrew 引导安装）：

```bash
curl -fsSL https://raw.githubusercontent.com/aaione/ai-page-dive/main/install.sh | sh -s -- <扩展ID>
```

装完回浏览器即用。终端走不通（代理/被墙/EACCES）时的手动备选：

<details>
<summary>npm 两连命令（手动备选）</summary>

```bash
# 需要 Node >= 18（nvm/Homebrew 安装的 Node 免 sudo；勿用 sudo npm——会写坏本机组件注册属主）
npm i -g @aaione/ai-page-dive && ai-page-dive install --ext-id <扩展ID>
```
</details>

## v1 范围

macOS + Chrome；claude + codex 双适配器（AgentDef 接口按六家字段并集设计）；
内置 quick / deep / paper 三个 workflow；历史列表/查看/删除/Finder 定位/搜索。
其余（daemon、追问对话、Windows、marketplace……）见 DECISIONS.md v2 路线图。
