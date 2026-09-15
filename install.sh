#!/bin/sh
# PageDive 一键安装：Node>=18 探测 → npm i -g @aaione/ai-page-dive → ai-page-dive install
# 用法：curl -fsSL https://raw.githubusercontent.com/aaione/ai-page-dive/main/install.sh | sh -s -- <扩展ID>
# 托管在仓库本身（raw.githubusercontent）——零基建；内部仍走 npm（registry 自带完整性校验，
# 脚本不下载任何二进制，无需附加 checksum 机制）。
set -e

EXT_ID="${1:-}"

say() { printf '\033[1;32m%s\033[0m\n' "$*"; }
die() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. Node >= 18 探测（nvm 用户：sh 非交互不加载 nvm，PATH 上的 node 即用户日常 node）──
NODE_VER="$(node --version 2>/dev/null || true)"
if [ -z "$NODE_VER" ]; then
  say "未检测到 Node.js。尝试 Homebrew 安装（首次可能需先装 Xcode 命令行工具，约 5-15 分钟）…"
  if command -v brew >/dev/null 2>&1; then
    brew install node || die "brew install node 失败——请到 https://nodejs.org 手动安装 Node >= 18 后重跑本命令"
  else
    die "未检测到 Node.js 且无 Homebrew。请先安装其一：
  • Node.js:  https://nodejs.org（下载 LTS 安装包）
  • Homebrew: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"
装好后重跑本命令即可。"
  fi
  NODE_VER="$(node --version 2>/dev/null || true)"
  [ -n "$NODE_VER" ] || die "Node 安装后仍不可用——请重开终端（刷新 PATH）后重跑"
fi
MAJOR="${NODE_VER#v}"; MAJOR="${MAJOR%%.*}"
[ "$MAJOR" -ge 18 ] 2>/dev/null || die "Node 版本过低（$NODE_VER < 18）——请升级：https://nodejs.org"

say "✅ Node $NODE_VER"

# ── 2. npm 全局安装（捕获常见失败给指引）──
if ! npm i -g @aaione/ai-page-dive; then
  printf '\033[1;33m%s\033[0m\n' "npm 全局安装失败。常见原因：
  • EACCES 权限错误 → 改用 nvm/Homebrew 的 Node（推荐，免 sudo；勿用 sudo npm——会写坏 NM 注册属主）
  • nvm 切过版本 → 全局包按版本隔离，重装一次即可
  • 网络问题 → 检查代理或换 registry" >&2
  exit 1
fi

# ── 3. 注册 NM host + 探测本机 CLI（幂等，origins 追加不覆盖）──
if ! command -v ai-page-dive >/dev/null 2>&1; then
  die "npm 安装完成但 ai-page-dive 命令不可用——请重开终端（刷新 PATH）后重跑本命令"
fi
# 退出码语义：0=完全就绪 / 2=组件就绪但零可用 CLI / 其他=硬失败（install 已打印原因）
set +e
if [ -n "$EXT_ID" ]; then
  ai-page-dive install --ext-id "$EXT_ID"
else
  ai-page-dive install
fi
RC=$?
set -e
case "$RC" in
  0) say "🎉 安装完成——回到浏览器，面板通常会自动进入；若 1 分半内未进入，请完全退出 Chrome（⌘Q）后重开。" ;;
  2) say "✅ 本机组件已装好，但未检测到 AI CLI——装好并登录 claude 或 codex 后，回到浏览器即可使用（无需重跑本命令）。" ;;
  *) die "安装未完全成功（exit $RC）——请按上方 ⚠️ 提示处理后重跑；仍卡住请携输出反馈到 GitHub Issues" ;;
esac
