@echo off
setlocal EnableDelayedExpansion

echo.
echo === NaiPromptManager 本地部署 ===
echo.

REM 检查 wrangler
npx wrangler --version >nul 2>&1
if errorlevel 1 (
    echo wrangler 未安装，正在安装...
    call npm install wrangler --save-dev
    if errorlevel 1 (
        echo wrangler 安装失败
        exit /b 1
    )
)

REM 检查构建产物
if not exist "dist\index.html" (
    echo 正在构建前端...
    call npm run build
    if errorlevel 1 (
        echo 构建失败
        exit /b 1
    )
)

echo.
echo 启动本地服务 (端口 3000)...
echo 数据存储位置: ./local-data/
echo 访问地址: http://localhost:3000
echo.

npx wrangler pages dev dist ^
    --persist-to ./local-data ^
    --port 3000 ^
    --compatibility-date 2024-04-01

endlocal