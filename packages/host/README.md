# ai-page-dive (host)

PageDive 的本机组件（Native Messaging host）：桥接 Chrome 扩展与本机已装的 AI CLI（claude / codex），零依赖纯 Node 薄壳。内容只在本机处理，不经过任何服务器。

## 安装

需要 macOS + Chrome + Node.js >= 18，以及本机已装并登录的 [claude](https://claude.com/claude-code) 或 [codex](https://github.com/openai/codex) CLI。

```sh
npm i -g ai-page-dive && ai-page-dive install --ext-id <扩展ID>
```

`install` 幂等：写 NM host manifest（`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`）+ 探测本机 CLI。扩展端的 Onboarding 页会给出完整命令（含扩展 ID）。

## 用法

装好后打开 Chrome 扩展 [AI PageDive](https://github.com/aaione/page-dive) 的侧边栏即可，无需再管本包。

- 总结模式（workflow）：`~/.ai-page-dive/workflows/<name>/WORKFLOW.md`（内置 deep / paper / quick，用户目录可 shadow 同名内置）
- 技能（skill）：`~/.ai-page-dive/skills/<name>/SKILL.md`
- 历史记录：`~/.ai-page-dive/history/`

## 开发

本包是 [page-dive monorepo](https://github.com/aaione/page-dive) 的 `packages/host`。`pnpm build` 后 `node dist/index.js --stdio` 直接可跑。
