#!/bin/sh
set -e

echo ""
echo "=== NAI Atelier 本地部署 (Linux / macOS / Termux) ==="
echo ""

# 完整服务（media-gateway、局域网 PIN、Agent、Pixiv、st-chatu8 桥、备份、Tag 更新服务）
# 统一由 scripts/local-server.mjs 编排：网关 3000 + worker 3001。
# 此前本脚本自行直启 wrangler（缺网关与全部绑定，端口布局也与 .mjs 冲突），
# 现在委托给同一编排器，保证各平台行为一致。
if [ -n "$TERMUX_VERSION" ] || [ -d "/data/data/com.termux" ]; then
    printf "\033[36m[Termux]\033[0m 检测到 Termux 环境\n"
    if ! command -v node >/dev/null 2>&1; then
        printf "\033[33m[Termux]\033[0m 正在安装 nodejs-lts...\n"
        pkg install nodejs-lts -y || {
            printf "\033[31m[Termux]\033[0m 安装失败，请手动执行: pkg install nodejs-lts\n"
            exit 1
        }
    fi
fi

if ! command -v node >/dev/null 2>&1; then
    printf "\033[31m未检测到 Node.js，请先安装 Node.js 18+。\033[0m\n"
    exit 1
fi

exec node "$(dirname "$0")/local-server.mjs" "$@"
