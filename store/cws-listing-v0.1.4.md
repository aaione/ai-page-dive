# CWS Listing 素材成稿（v0.1.4 提审用）

> r82 上架审 P4 交付物：Dashboard 逐栏取用。措辞纪律——与 manifest/PRIVACY/README 同口径（P2 限定语已对齐），无绝对化承诺。
> 事实基线：零后端零遥测（r82 实测产物级扫描）· 历史落盘 0600/0700 · 正文经 CLI 至厂商云端（如实披露）。

## 1. 简介栏（manifest description，已随 zip）

用你已登录的 Claude/Codex 订阅深度总结网页——零账号零 API key，正文直达本机 CLI、不经 PageDive 服务器。Deep-summarize any page with your own Claude/Codex CLI.

## 2. 详细描述（Detailed description，粘贴用）

```
AI PageDive —— 用你自己的 Claude Code / Codex 订阅深度总结当前网页

【零账号 · 零 API key】
不需要注册账号，不需要 API key。扩展调用你本机已安装并登录的 AI CLI（Claude Code 或 Codex），消耗你自己的订阅额度，PageDive 永不收费、永不接触你的凭证。

【深度总结，不是摘录】
全文提取 + 可视区截图 + 页面快照三通道供 CLI 阅读，流式输出总结。支持追问（多轮会话）、总结历史（本地落盘、可搜索、可导出）、自定义 workflow 与技能。

【隐私边界】
- 正文经 Native Messaging 直达本机 CLI，不经 PageDive 任何服务器——本扩展零后端、零遥测、零统计 SDK
- 之后内容如何处理由你所选 CLI 自身的隐私政策决定（Claude → Anthropic，Codex → OpenAI）
- 总结历史落盘 ~/.ai-page-dive/history/（文件 0600 / 目录 0700），随时删除或整体备份
- 详见隐私政策链接

【使用前提（v1 仅支持 macOS + Chrome）】
1. 终端已安装并登录 Claude Code 或 Codex（官方安装器）
2. 首次点击扩展图标后，按侧边栏指引复制一条终端命令安装本机组件（一次性，约 1 分钟）

【权限说明】
- activeTab / scripting：点击时读取当前页正文，不申请常驻网站访问
- nativeMessaging：与本机组件（开源 npm 包 @aaione/ai-page-dive）通信
- sidePanel：在侧边栏展示总结
- storage：记住 CLI 偏好与进行中任务指针
- （可选）「始终允许读取网页」：默认关闭，仅当你主动授予后开启

完全开源：https://github.com/aaione/ai-page-dive
```

（英文段可按需追加同义翻译；当前中英混合与 manifest 一致，可只上中文。）

## 3. 权限理由栏（若触发声明表 / 问询预案）

| 权限 | 理由（粘贴用） |
|------|----------------|
| activeTab | 用户点击扩展图标时读取当前标签页正文做总结——不点击不读取，不常驻访问任何网站 |
| scripting | 将开源内容提取脚本注入当前页（本地打包，无远程代码），提取正文/标题供总结 |
| nativeMessaging | 与用户本机自行安装的开源组件（npm 包 @aaione/ai-page-dive）通信，唤起用户已登录的 Claude/Codex CLI 完成总结。扩展本身零网络后端 |
| sidePanel | 总结结果在浏览器侧边栏流式展示 |
| storage | 记住用户 CLI 偏好；进行中任务指针用于浏览器扩展进程回收后对账，不采集任何统计 |
| optional host: `<all_urls>` | **默认关闭**。仅当用户在出错气泡点「始终允许读取网页」时主动授予，用于免逐页重授权；可随时在 Chrome 站点权限设置收回。未授予时扩展仅凭 activeTab 逐页点击读取 |

### `<all_urls>` 答辩要点（人工复审问询时）

1. 默认零网站访问面（activeTab 点哪读哪）；`<all_urls>` 是 optional，安装时无警告、默认关闭
2. 授予入口不在设置页，而在「无权限读取页面」的出错气泡——用户遇到具体问题时才看到（设计文档 DECISIONS.md D3，三轮修订记录公开）
3. 授予后用途单一：读取用户正在总结的页面正文；无内容上送 PageDive 服务器（零后端）

## 4. 审核测试说明（Testing instructions，粘贴用）

```
本扩展核心功能依赖两个商店外前置条件（审核环境默认不具备）：
(1) 本机组件：Native Messaging host，开源 npm 包 @aaione/ai-page-dive
(2) 终端已安装并登录 Claude Code 或 Codex（官方 CLI，需用户自己的订阅）

审核复现步骤（macOS + Chrome）：
1. 安装扩展，点击工具栏图标 → 侧边栏显示本机组件安装指引（Onboarding）
2. 按指引在终端执行安装命令（面板可一键复制，含本扩展 ID）：
   npm i -g @aaione/ai-page-dive && ai-page-dive install --ext-id <扩展ID>
3. 前置：终端先安装并登录任一 CLI（claude 或 codex，官方安装器）
4. 打开任意新闻/文章页 → 点击扩展图标 →「总结本页」
5. 侧边栏流式输出总结 → 可继续追问 → 历史记录在 ~/.ai-page-dive/history/

无 CLI / 未装本机组件时的预期行为：面板显示明确的中文错误指引（未安装/未登录/组件未就绪/版本不匹配各有人话文案与出路），不会静默失败或白屏。
权限最小化验证：chrome://extensions 中查看——仅 activeTab/scripting/nativeMessaging/sidePanel/storage 五项；「网站访问权限」显示「未授予任何站点」（optional 默认关闭）。
```

## 5. 截图清单（1280×800，建议 5 张）

1. 侧边栏总结进行中（流式输出 + 阶段提示）——主功能第一眼
2. 总结完成 + 追问对话（多轮气泡）
3. 首次安装指引 Onboarding（体现「本机组件一次性安装」而非账号注册）
4. 历史列表（本地记录、可搜索）
5. 设置页（CLI 选择/工作流，体现可插拔）

## 6. 演示视频脚本（30–60s，可选但强烈建议）

1. (0-5s) 打开一篇长文页面，点击扩展图标
2. (5-15s) 侧边栏出现「读取中 → 总结中」阶段流转
3. (15-30s) 流式输出总结；镜头切终端展示「ps」中真实 claude/codex 进程（证明走本机 CLI）
4. (30-40s) 输入追问「第三节讲了什么」→ 流式回答
5. (40-50s) 打开 ~/.ai-page-dive/history/ 展示本地落盘文件
6. (50-60s) 结尾字幕：零账号 · 零 API key · 不经 PageDive 服务器

## 7. Dashboard 填写 checklist

- [ ] 上传 `apps/extension/pagedive-cws-v0.1.4.zip`（213KB，2026-10-16 重打包，含 r82 P1/P2 修复）
- [ ] 类别：Productivity
- [ ] 语言：中文（简体）；详细描述见 §2
- [ ] 图标：zip 内 128px 已带（商店用同款）
- [ ] 截图：§5 五张
- [ ] 隐私政策 URL：`https://github.com/aaione/ai-page-dive/blob/main/PRIVACY.md`
- [ ] 支持网址：`https://github.com/aaione/ai-page-dive/issues`
- [ ] 统计：关闭（与「零遥测」承诺一致）
- [ ] 地区：全部（**注意：CWS 不支持按桌面 OS 定向**——macOS-only 无法配置，§2 已写明前提，install.sh 侧建议后续补 uname 门为 low 挂账 F6）
- [ ] 可见性：公开（首次提审过审后自动发布）

## 8. 提审前最终闸门（对照 r82 终裁）

- [x] P1 横幅复制修复进 zip（`0651e2b`，重打包已验）
- [x] P2 商店文案限定语进 zip（同上）
- [ ] P3 新机空跑主线实测（用户真机：干净环境跑 install.sh → 装扩展 → 总结 → 追问 → 历史恢复，录屏入账）
- [x] P4 本成稿
- [ ] Dashboard 按 §7 填写 + §4 测试说明一并提交
