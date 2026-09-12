# npm 分发必要性攻击报告（2026-09-13）

> 目的：攻击「npm（npm i -g + postinstall 注册 NM manifest）是 PageDive host 组件最优分发渠道」这一历三轮定案，寻找任何能让用户免装 npm 包的替代路径。
> 取证方式：WebSearch/WebFetch 主通道限流，改用浏览器直取官方页面原文（developer.chrome.com / support.apple.com / docs.brew.sh），全部结论附来源 URL。
> 取证日期：2026-09-13。

---

## 最终结论：部分推翻

**「npm 不可替代」不成立——npm 只是 convenient，不是 necessary。** 真正不可替代的是「本机必须装东西」（NM host 落盘 + 注册 manifest），这一点依然封死（见问题 1、2）；但**装什么、从哪装**有等价替代：GitHub Releases tarball + install.sh 完全自举在工程上成立，Homebrew tap 是次优备选。npm 的真实优势只剩「升级/卸载的包管理器人机工程」，而这些 install.sh 都能以约 100~200 行 shell 补齐。

**但注意**：项目当前的 install.sh 主路径（见 CLAUDE.md Install Flow）本来就是 `curl install.sh | sh`，其内部执行 `npm i -g`。所以真正的问题不是「npm vs tarball」，而是「install.sh 里那一步是调 npm 还是直接解 tarball」。结论是：**直接解 tarball 可行且有收益（免 Node 全局污染、免 npm 网络抖动、装到 ~/.ai-page-dive 自包含可卸载），npm 降级为备选而非必经**。

---

## 问题 1：CWS 政策是否仍禁止扩展携带/下载本机可执行文件？有无官方配套组件分发通道？

### 1.1 政策文本现状（2026-09 实测）

对当前 CWS Developer Program Policies 单页版全文（31,473 字符）做关键词扫描：

- `binary` / `binaries`：**0 次出现**
- `executable`：仅 1 次，且上下文是 **Chrome Apps（已废弃的 packaged/hosted apps）专属条款**："Packaged and hosted apps should not: Require a local executable, other than the Chrome runtime, to run... Download or execute scripts dynamically outside a sandboxed environment"
- 历史上的 "D10 Native Executables" 独立条款（"Extensions may not download or execute binaries..."）**已从现行政策页移除**；`Deceptive Installation Tactics` 子页（Last updated 2024-07-10）现只讲营销欺诈，无二进制条款；`Malicious and Prohibited Products` 子页（Last updated 2022-11-01）只讲恶意软件/挖矿/盗版。

来源：
- https://developer.chrome.com/docs/webstore/program-policies/policies （单页全文，实测无 binary 禁令）
- https://developer.chrome.com/docs/webstore/program-policies/deceptive-installation-tactics
- https://developer.chrome.com/docs/webstore/program-policies/malicious-and-prohibited

**解读（重要，勿误读）**：政策文本移除 ≠ 官方开绿灯。现行政策仍保留：
1. 远程代码禁令（MV3 一贯）：远程执行逻辑仅豁免 Debugger API / User Scripts API；
2. "Misleading or Unexpected Behavior"：扩展运行时静默下载并执行本机二进制，属于典型的 unexpected behavior，审核实践上会被拒（历史上大量 NM 类扩展被拒均援引旧 D10 或此条）；
3. 政策页面顶部明示 "these policies apply to the entire user experience"，审核有裁量空间。

**结论：封死（按审核实践），但封死的依据已从明文 D10 变为「远程代码 + 意外行为」的一般条款。扩展自己在运行时下载/执行 host 二进制仍不可行；必须由用户在扩展外完成安装。** 这对定案无影响——定案本就要求 host 用户侧安装。

### 1.2 有无官方「配套本机组件」分发通道？

核对 Native Messaging 官方文档（页面 Last updated 2023-02-27，2026-09 仍为最新）：

- host 注册仍是**唯一机制**：macOS 用户级 manifest 必须落在 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<name>.json`，且 manifest 中 `path` 在 macOS/Linux 上**必须是绝对路径**；
- 扩展侧 API 只有 `runtime.connectNative` / `sendNativeMessage`，**不存在**任何「扩展请求浏览器安装 host」「扩展写 manifest」的 API；
- 唯一新增的是 Chrome for Testing 的 manifest 目录区分（Chrome 146+），与分发无关。

来源：https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging

**结论：封死。2026 年 9 月为止，Chrome 没有任何类似 WebUSB 式豁免、官方 NM 安装器或新 API 让扩展自带/自装 native host。** WebUSB/WebSerial 豁免从未覆盖「分发本机可执行文件」。

---

## 问题 2：offscreen document / WASM 能否 spawn 子进程或等价调用本机 CLI？

### 2.1 offscreen document

`chrome.offscreen` 的 reason 枚举为封闭集合：AUDIO_PLAYBACK / BLOBS / CLIPBOARD / DISPLAY_MEDIA / DOM_PARSER / DOM_SCRAPING / IFRAME_SCRIPTING / LOCAL_STORAGE / MATCH_MEDIA / TESTING / USER_MEDIA / WORKERS / GEOLOCATION。它只是「给 SW 配一个隐藏 DOM 环境」，没有任何进程/文件系统执行能力。

来源：https://developer.chrome.com/docs/extensions/reference/offscreen

**结论：封死。** 与定案一致。

### 2.2 WASM 路线（wasm 版 CLI）

三层死因，无需进一步查证（属平台架构事实）：

1. **沙箱**：浏览器 WASM 无系统调用面（Chrome 未暴露 WASI filesystem/process）；offscreen/worker 中的 WASM 同样被锁在扩展源内。
2. **凭证不可达**：claude/codex CLI 的价值在于读取用户本机 `~/.claude` / `~/.codex` 登录态——浏览器任何上下文（含 WASM）都无法读这些路径，违反项目硬约束 3（零凭证接触）反过来也说明 wasm 版必须绕开凭证，绕开即失去「复用用户 CLI 订阅」的全部意义。
3. **二进制不可得**：claude / codex 官方 CLI 是原生二进制/含原生绑定，官方不发布浏览器可用的 wasm 构建；自行重写 CLI 协议 = 接触凭证 + 代理流量，双重违反硬约束。

**结论：封死。** 与定案一致。

---

## 问题 3：GitHub Releases tarball + install.sh 完全自举 vs npm i -g 的真实差距

这是本次攻击**唯一打得进去的口子**。逐项对比：

| 能力 | npm i -g | install.sh + GitHub Releases tarball | 差距判定 |
|---|---|---|---|
| 落盘文件 | 全局 node_modules | `~/.ai-page-dive/host/`（解 tarball，dist 已是纯 JS） | 等价；tarball 方案反而**自包含、rm -rf 即净卸载**，不污染全局 node_modules |
| NM manifest 注册 | postinstall（npm 钩子） | install.sh 直接 `cat > ~/Library/.../NativeMessagingHosts/com.aaione.ai_page_dive.json`，`path` 写绝对路径 | **等价**——官方只要求 manifest JSON 落在该目录 + 绝对路径（见问题 1.2 来源），不关心谁写的 |
| Node ≥18 探测 | npm 自带 node | install.sh `command -v node \|\| brew install node`（现行 install.sh 已实现） | 等价（两方案都依赖本机 Node） |
| 升级 | `npm update -g` / npm 自检 | `ai-page-dive upgrade`：GET `https://api.github.com/repos/aaione/ai-page-dive/releases/latest` 比对版本 → 下载 tarball → 原子替换目录 + 重写 manifest（扩展 ID 不变，manifest 的 allowed_origins 不变） | tarball 需自研 ~80 行；另可由扩展侧 SW 轮询 release 版本提示用户重跑 install.sh（**npm 路线同样没有自动升级**，`npm update -g` 也要用户手动敲）→ 实际人机工程打平 |
| 卸载 | `npm uninstall -g` + 手删 manifest | `ai-page-dive uninstall`：rm 目录 + rm manifest | tarball 需自研 ~20 行，等价 |
| 完整性校验 | npm 内置 integrity | tarball 提供 sha256（install.sh 校验）或直接对 release asset 签名 | tarball 需补，1 天工作量 |
| 可审计性（curl\|sh 信任问题） | 用户同样在跑我们的 postinstall 脚本，无本质差别 | 相同 | **打平**——npm postinstall 与 curl\|sh 的信任面完全一样，npm 并不更安全 |
| 网络可靠性 | npm registry（国内时常劣化） | GitHub Releases（raw.githubusercontent + objects.githubusercontent） | 各有劣化场景；可双源互备 |
| 已装 npm 但无全局装权限的环境 | 需 sudo 或改 prefix | 无此问题 | tarball 略优（本项目用户群 dev 为主，影响小） |

**结论：可行（部分推翻的主证据）。** install.sh 能完全自举安装/注册/升级/卸载，npm 无不可替代能力。**代价**：自研 upgrade/uninstall/sha256 约合计 1~2 天工作量 + 长期维护两条升级路径的成本。**收益**：安装链路少一层 npm 依赖与故障面；`~/.ai-page-dive` 完全自包含，卸载语义干净；与项目「host 薄壳」哲学一致。

**建议的落点**（若采纳）：install.sh 改为优先 tarball 直装（`~/.ai-page-dive/host/`），npm 两连命令保留为折叠备选——正好与 CLAUDE.md 现有叙事对调主次。

---

## 问题 4：macOS Sequoia+ Gatekeeper 对未签名 shell/node 脚本、quarantine 对 curl|sh 的影响

Apple 官方「Safely open apps on your Mac」（2026-09 现行版）：

- Gatekeeper 检查对象是"**Mac apps, plug-ins, and installer packages**"——即通过 Launch Services 打开的 .app/.pkg/.dmg 等束结构 + 公证（notarization）要求（Catalina+）；
- 警告与拦截均发生在「Finder/浏览器下载 → 双击打开」路径（quarantine xattr 由下载方 App 如 Safari 写入）。

来源：https://support.apple.com/en-us/102445

对 PageDive 各形态逐一判定：

| 形态 | 是否被 Gatekeeper 拦 | 原因 |
|---|---|---|
| `curl -fsSL ... \| sh` | **不拦** | 管道流从不落地为可执行文件；Gatekeeper 只在 Launch Services 打开时评估 |
| curl 下载的 install.sh / tarball | **不拦** | curl/terminal 不写 com.apple.quarantine（quarantine 由浏览器类下载 App 写入）；tar 解出的 .js/.sh 无 quarantine |
| `node ~/.ai-page-dive/host/dist/index.js` | **不拦** | 脚本是 node（已签名二进制）的数据，Gatekeeper 不评估 |
| 将来若发编译型单二进制（如 bun/pkg 打包）且经浏览器下载 | **会被拦**（未签名未公证 → "cannot be verified" 警告） | 唯一受影响形态；v1 不涉及 |

**结论：可行——v1 的纯 JS host + curl|sh 安装在 macOS Sequoia+ 上零 Gatekeeper 阻碍。** 与定案一致（定案中「编译二进制被 Gatekeeper 封死」仅指扩展携带二进制的路线，curl|sh 路线本身畅通）。这同时意味着：**问题 3 的 tarball 方案没有任何 macOS 侧额外阻力**。

---

## 问题 5：Homebrew 作为主分发渠道的成熟度

Formula Cookbook（2026-09 现行版）关键事实：

1. **formula 的 `url` 可以直接指向 GitHub Release tarball**（标准做法，配 `sha256`）；custom tap（`brew tap aaione/tap && brew install ai-page-dive`）无准入门槛，formula `depends_on "node"` 合法。
2. **postinstall 已被收紧**：现行规定「Formulae in all taps must represent post-install work with **post_install_steps**; new post_install methods are rejected... may only contain the supported step calls with **literal arguments**. It cannot call... arbitrary Ruby code.」——即 formula 内无法写「读取用户输入的扩展 ID → 生成 NM manifest JSON」这种带动态参数/任意逻辑的注册步骤。

来源：https://docs.brew.sh/Formula-Cookbook

**结论：部分可行但有结构性代价。** brew 能完成「把 host 文件放进 Cellar + 依赖 Node」，但 **NM manifest 注册必须仍由 `ai-page-dive install --ext-id <ID>` 完成**（brew 无法代劳）；另加：homebrew-core 正式收录门槛高（notability 要求），只能走自建 tap（信任与曝光弱于 npm/GitHub）；升级 `brew upgrade` 语义倒是现成。综合弱于问题 3 的 tarball 方案（后者单命令完成安装+注册）。

**定位建议**：brew tap 作为第三备选渠道（对 brew 重度用户友好），不值得做主渠道。

---

## 汇总：五条路径终局

| # | 路径 | 判定 | 一句话 |
|---|---|---|---|
| 1a | 扩展运行时下载/执行二进制 | 封死 | 明文 D10 已从政策移除，但远程代码 + 意外行为一般条款 + 审核实践仍封；无任何新豁免 |
| 1b | 官方 NM host 安装通道 | 封死 | NM 文档（2023-02 版沿用至今）无任何新机制；manifest 仍须本机进程写入固定目录 |
| 2 | offscreen / WASM 调本机 CLI | 封死 | offscreen reason 封闭集无执行能力；WASM 无文件系统/进程且够不到 ~/.claude 凭证 |
| 3 | GitHub tarball + install.sh 自举 | **可行** | 安装/注册/升级/卸载全可自举，npm 无不可替代能力；代价 1~2 天开发 + 双通道维护 |
| 4 | macOS Gatekeeper | 可行（不构成阻力） | curl\|sh 与 node 脚本完全不在 Gatekeeper 评估范围 |
| 5 | Homebrew tap | 部分可行 | 能装文件，不能注册 manifest（post_install_steps 仅限字面量步骤）；只配做第三备选 |

## 对定案的修订表述

> 「host 必须装到本机」——维持，证据更新（CWS 政策文本重构但实践不变；NM 机制 2026-09 零变化；offscreen/WASM 无新能力）。
> 「npm 是最优分发渠道」——**降级为「npm 是可用的分发渠道之一，tarball 直装等价且链路更短」**。建议 install.sh 主路径内部改为 tarball 直装，npm 降为折叠备选；brew tap 列入 v2 观察项。

## 附：本次取证局限

- WebSearch/WebFetch 主通道限流，CWS 政策为官方页面原文直读（非二手转述），但「审核实践」（拒审案例）无法从政策文本完全证实，问题 1.1 的判定含此推定成分——该推定方向对攻击者不利（即政策松动也不改变「host 须本机装」），不影响最终结论。
- 未发现（也未存在公开报道的）2025-2026 Chrome 版本新增 NM 分发特性；若 Chromium 源码有未上线实验 flag，官方文档不会体现，超出可查证范围。
