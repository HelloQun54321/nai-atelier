!include "${__FILEDIR__}\protocol-cleanup.nsh"
!ifndef BUILD_UNINSTALLER
  !include "${__FILEDIR__}\runtime-check.nsh"
!endif

!macro customInit
  !ifndef BUILD_UNINSTALLER
    ${IfNot} ${AtLeastWin10}
      MessageBox MB_OK|MB_ICONSTOP "NAI Atelier 需要 Windows 10 或 Windows 11（64 位）。"
      Abort
    ${EndIf}
    ; 在解包或卸载旧版本之前检查，避免留下半安装状态。
    Call AtelierCheckRuntime
    Pop $0
    ${If} $0 != "1"
      ${IfNot} ${Silent}
        MessageBox MB_OKCANCEL|MB_ICONINFORMATION "需要 Microsoft Visual C++ x64 运行库（14.44 或更新版本）。$\r$\n请在微软官方下载页面选择 X64，安装完成后重新运行此安装包。$\r$\n点击「确定」打开微软页面，点击「取消」退出。" IDCANCEL atelier_runtime_cancel
        ExecShell "open" "https://learn.microsoft.com/zh-cn/cpp/windows/latest-supported-vc-redist"
        atelier_runtime_cancel:
      ${EndIf}
      SetErrorLevel 2
      Quit
    ${EndIf}
  !endif
!macroend

!macro customUnInstall
  !insertmacro AtelierUnregisterPixiv
!macroend

!macro customInstall
  ; 修复旧版半安装目录时，移除已经停用的程序辅助脚本。
  Delete "$INSTDIR\resources\install-prerequisites.ps1"
  Delete "$INSTDIR\resources\uninstall-integration.ps1"
!macroend
