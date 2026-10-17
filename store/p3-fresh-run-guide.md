# P3 新机空跑主线实测——一步步操作指引（用户真机执行）

> r82 终裁 P3 / r83 后唯一剩余提审闸门。执行者：用户本人（activeTab 手势无法自动化，r83 实测定论）。
> 前置事实（2026-10-17 已核）：远端 main `install.sh` 与本地零 diff（跑远端即当前代码）；npm 已发布 `0.1.2` / `0.1.4` 两版；zip `apps/extension/pagedive-cws-v0.1.4.zip`（213KB，含 r82 P1/P2 修复）。
> 预计耗时 15–20 分钟。**全程录屏**（阶段 0 开始录，证明干净起点）。

## 阶段 0：开录屏

`Cmd+Shift+5` → 选「录制整个屏幕」→ 开始录制。录屏文件路径记下来，收尾入账用。

## 阶段 1：轻量清理（还原「新机近似态」）

> 原则：只清 PageDive 自己的东西；claude/codex CLI 本体与登录态**不动**（新机定义里 CLI 是用户预装前提，与商店测试说明 §4 口径一致）。

```bash
# 1. 卸载本机组件（npm 全局包）
npm uninstall -g @aaione/ai-page-dive

# 2. 删真机 NM 注册（正式 Chrome 读的路径）
rm "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.pagedive.host.json"

# 3. 清 e2e 时代悬空残留（注意：是「Google Chrome」平级目录，不是「Google/Chrome」嵌套路径）
ls "$HOME/Library/Application Support/Google Chrome"   # 先确认里面只有 NativeMessagingHosts/com.pagedive.host.json（201B，path 指向已删除的 /tmp/pd-e2e/nm-wrapper.sh）
rm -rf "$HOME/Library/Application Support/Google Chrome"

# 4. 历史目录改名备份（不删——保留恢复能力）
mv ~/.ai-page-dive ~/.ai-page-dive.bak-$(date +%m%d%H%M)
```

浏览器侧：`chrome://extensions` → 移除已加载的「PageDive (Unpacked)」解压版（`…/apps/extension/dist`）。

**验收**：`npm ls -g @aaione/ai-page-dive` 报空；`ls ~/.ai-page-dive` 报不存在。

## 阶段 2：装扩展（走 zip——商店审核员实际拿到的形态）

1. `chrome://extensions` → 右上角开「开发者模式」
2. 把 `apps/extension/pagedive-cws-v0.1.4.zip` **直接拖进** extensions 页面
3. **验收**：卡片显示 PageDive · 版本 `0.1.4` · ID `nclbhhhmgcabjlgmlbkoblipogajajgn`
   （若拖 zip 被拒，等价备选：解压 zip 到临时目录 → 「加载已解压的扩展程序」——内容同包）
4. 工具栏拼图图标 → 给 PageDive 点钉固定

## 阶段 3：Onboarding → 远端 install.sh 主线

1. 随便开一个正常网页（任意新闻/文章），点工具栏 PageDive 图标 → 侧栏出**安装指引**
2. 点指引的**复制按钮**，粘贴到终端检查：命令应含本扩展 ID
   `curl -fsSL https://raw.githubusercontent.com/aaione/ai-page-dive/main/install.sh | sh -s -- nclbhhhmgcabjlgmlbkoblipogajajgn`
3. 回车执行（Node≥18 探测 + npm i -g + NM 注册；预期十几秒）
4. **验收**：回到浏览器侧栏——指引应翻页消失、面板进入就绪态（host 握手成功；若未翻，重开侧栏一次）

## 阶段 4：主线三连（总结 → 追问 → 历史）

1. **总结**：开一篇长文页 → 点图标 →「总结本页」→ 流式输出 → 完成态（agent 徽标 + 用时）
2. **追问**：底部输入框问一句（如「第三节讲了什么」）→ 续轮回答追加进同一对话
3. **历史**：切「历史」页 → 刚才两条都在 → 点开可读全文
4. **落盘抽查**（终端）：
   ```bash
   ls ~/.ai-page-dive/history/2026/10/        # 有今天的新文件
   head -15 ~/.ai-page-dive/history/2026/10/<最新文件>   # frontmatter 九字段：title/url/agent/status/ts/usage/duration_ms/session_id/content_chars
   ```

## 阶段 5：P1 横幅复制复验（r82 修批①回归）

```bash
# 1. 降级到 0.1.2（旧版）
npm i -g @aaione/ai-page-dive@0.1.2
```

2. 回浏览器：重开侧栏（或新标签页重新点图标）触发版本握手 → 应出现**版本过旧横幅**
3. 点横幅**复制按钮** → 粘贴到任意文本框 → **验收**：贴出的是完整升级命令本体，无截断错切（r82 P1 修复点）
4. 升回新版：
   ```bash
   npm i -g @aaione/ai-page-dive@0.1.4
   ```
5. 重开侧栏 → **验收**：横幅消失（同版静默）；再跑一次总结确认链路无恙

## 阶段 5½：顺带补验（可选，约 5 分钟——r85 九维验证的三个盲区）

> 来源：r85 终审完备性批判（`reports/2026-10-18-r85-multidim-validation.md`）——三项自动化与主线均未覆盖、真机顺手可验。

1. **键盘快捷键**：任意正常网页直接按 `Cmd+Shift+D` → 应等效点图标（打开侧栏并可开始总结）
2. **分享真链路**：完成一次总结后点分享按钮任选目标（如 X/微博）→ 应新开标签页到对应 intent 页（内容不出本机，仅打开预填链接）
3. **「始终允许读取网页」授予流**：找一个无权限读取的页面场景触发出错气泡 → 点「始终允许读取网页」→ Chrome 弹权限确认 → 授予后免逐页点击即可总结；再到 `chrome://extensions` → PageDive → 站点权限确认可随时收回

三项每步截图即可（通过/异常都截）。

## 阶段 6：收尾与入账

1. `Cmd+Shift+5` → 停止录屏
2. 把结果告诉 Claude（路径 + 各阶段通过/异常），由 Claude 写 r84 验收入账报告 + 勾掉 `store/cws-listing-v0.1.4.md` §8 的 P3
3. 历史目录去留自定：可保留测试新数据，也可 `rm -rf ~/.ai-page-dive && mv ~/.ai-page-dive.bak-<时间戳> ~/.ai-page-dive` 还原
4. 之后按 `store/cws-listing-v0.1.4.md` §7 checklist 上 CWS Dashboard 提审

## 异常时的取证口径

任一步不符预期：截屏 + 终端 `tail -50` 相关输出（install 报错则贴全文），不要自行重试超过一次——原始失败现场比通过更有价值。
