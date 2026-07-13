#!/bin/sh
set -e

echo ""
echo "=== NaiPromptManager 本地部署 ==="
echo ""

# Termux 环境检测与依赖安装
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

# 检查构建产物
if [ ! -d "dist" ] || [ ! -f "dist/index.html" ]; then
    printf "\033[33m正在构建前端...\033[0m\n"
    npm run build || {
        printf "\033[31m构建失败\033[0m\n"
        exit 1
    }
fi

# 检查 wrangler
if ! npx wrangler --version >/dev/null 2>&1; then
    printf "\033[33mwrangler 未安装，正在安装...\033[0m\n"
    npm install wrangler --save-dev || {
        printf "\033[31mwrangler 安装失败\033[0m\n"
        exit 1
    }
fi

printf "\033[32m启动本地服务 (端口 3000)...\033[0m\n"
printf "\033[90m数据存储位置: ./local-data/\033[0m\n"
printf "\033[90m访问地址: http://localhost:3000\033[0m\n"
echo ""

npx wrangler pages dev dist \
    --persist-to ./local-data \
    --port 3000 \
    --compatibility-date 2024-04-01