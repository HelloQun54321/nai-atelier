!macro customInit
  !ifndef BUILD_UNINSTALLER
    ${IfNot} ${AtLeastWin10}
      MessageBox MB_OK|MB_ICONSTOP "NAI Atelier 需要 Windows 10 或 Windows 11（64 位）。"
      Abort
    ${EndIf}
  !endif
!macroend

!macro customUnInstall
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\uninstall-integration.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  Pop $1
!macroend

!macro customInstall
  ; 原生图片与反推依赖微软运行库；仅缺失时由微软官方安装器补齐。
  DetailPrint "正在检查所需的 Windows 运行库…"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\install-prerequisites.ps1"'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "无法完成运行库准备。请连接网络、允许微软运行库安装后重新运行此安装包。$\r$\n程序文件已经安装；用户数据不会被删除。$\r$\n$1"
    ${EndIf}
    SetErrorLevel 1
    Abort
  ${EndIf}
!macroend
