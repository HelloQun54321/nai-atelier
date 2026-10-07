@echo off
chcp 65001 >nul
cd /d "%~dp0"
title NAI Atelier 更新
node scripts\update-local.mjs
if errorlevel 1 pause
