@echo off
setlocal EnableDelayedExpansion

rem If PROJECT_DIR is not specified, default to this script's directory
if "%PROJECT_DIR%"=="" set "PROJECT_DIR=%~dp0"
for %%I in ("%PROJECT_DIR%") do set "PROJECT_DIR=%%~fI"

rem Strip trailing backslash if present
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

title NAI Atelier Launcher

cls
echo ========================================
echo   Start NAI Atelier
echo ========================================
echo.

if not exist "%PROJECT_DIR%\package.json" (
  echo Project was not found:
  echo %PROJECT_DIR%
  echo.
  pause
  exit /b 1
)

cd /d "%PROJECT_DIR%"

where git >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%B"
  if not "!CURRENT_BRANCH!"=="main" (
    echo Warning: current Git branch is "!CURRENT_BRANCH!", expected "main".
    echo.
    pause
    exit /b 1
  )
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please install Node.js first.
  echo.
  pause
  exit /b 1
)

echo Starting local server...
echo.
echo The browser will open automatically:
echo http://localhost:3000
echo.
echo Press Ctrl+C to stop the server.
echo.

powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://localhost:3000/api/lan/status' -TimeoutSec 2; if ($null -ne $r.authorized) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo NAI Atelier is already running. Opening the existing page...
  start "" "http://localhost:3000"
  exit /b 0
)

call npm run dev:local

echo.
echo NAI Atelier has stopped.
pause
endlocal
