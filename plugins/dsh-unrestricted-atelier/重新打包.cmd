@echo off
setlocal
pushd "%~dp0..\.." || exit /b 1
node scripts\package-atelier-adapter.mjs "%~dp0dist\dsh-unrestricted-atelier.zip"
set "atelier_pack_result=%errorlevel%"
if not defined ATELIER_PACK_NO_PAUSE pause
popd
exit /b %atelier_pack_result%
