# Privacy Policy / 隐私政策

*Last updated: 2026-09-16*

PageDive（"AI PageDive" Chrome 扩展及其本机组件）按以下方式处理数据。核心承诺：**你的网页内容与对话不离开你的电脑。**

## 数据处理

- **网页正文与元数据**：扩展在你点击总结时提取当前页正文（Readability），经 Chrome Native Messaging 传给本机组件，写入本机临时文件供本机 AI CLI 读取。全程在本机完成。
- **你的输入与附件**：同样只在本机处理（附件为文本文件，单个 ≤512KB）。
- **AI CLI**：PageDive 以子进程方式调用你本机已安装且已登录的官方 CLI（claude / codex / opencode）。CLI 与其模型服务之间的通信遵循该 CLI 自身的服务条款与隐私政策；PageDive 不接触、不存储、不代理任何凭证或流量，也永不对你的 CLI 用量收费。

## 存储位置（全部在本机）

- 总结历史 / workflow / 技能：`~/.ai-page-dive/`
- CLI 运行临时文件：系统临时目录（任务结束后定时清理）
- 追问会话状态：Chrome storage（session 域，浏览器重启即清）

## 我们不做的

- 没有 PageDive 服务器：无账号、无登录、无 API key
- 不收集任何遥测、分析数据或崩溃报告
- 不向任何第三方出售或传输你的数据

## 权限用途

| 权限 | 用途 |
|---|---|
| activeTab / scripting | 你点击时提取当前页正文（仅该页，不申请 `<all_urls>`） |
| sidePanel | 侧边栏界面 |
| nativeMessaging | 与本机组件进程间通信 |
| storage | 恢复追问会话状态（session 域，不落盘） |

## 联系

<https://github.com/aaione/ai-page-dive/issues>
