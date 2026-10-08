!include "${__FILEDIR__}\protocol-cleanup.nsh"
!ifndef BUILD_UNINSTALLER
  !include "${__FILEDIR__}\runtime-check.nsh"
!endif

!ifndef BUILD_UNINSTALLER
!macro customHeader
LangString atelier_windows ${LANG_SIMPCHINESE} "NAI Atelier 需要 Windows 10 或 Windows 11（64 位）。"
LangString atelier_windows ${LANG_TRADCHINESE} "NAI Atelier 需要 Windows 10 或 Windows 11（64 位元）。"
LangString atelier_windows ${LANG_ENGLISH} "NAI Atelier requires Windows 10 or Windows 11 (64-bit)."
LangString atelier_windows ${LANG_JAPANESE} "NAI Atelier には Windows 10 または Windows 11（64 ビット）が必要です。"
LangString atelier_windows ${LANG_KOREAN} "NAI Atelier에는 Windows 10 또는 Windows 11 (64비트)이 필요합니다."
LangString atelier_runtime ${LANG_SIMPCHINESE} "需要 Microsoft Visual C++ x64 运行库（14.44 或更新版本）。$\r$\n请在微软官方下载页面选择 X64，安装完成后重新运行此安装包。$\r$\n点击「确定」打开微软页面，点击「取消」退出。"
LangString atelier_runtime ${LANG_TRADCHINESE} "需要 Microsoft Visual C++ x64 執行階段（14.44 或更新版本）。$\r$\n請在微軟官方下載頁選擇 X64，安裝後重新執行此安裝程式。$\r$\n按「確定」開啟微軟頁面，按「取消」結束。"
LangString atelier_runtime ${LANG_ENGLISH} "Microsoft Visual C++ x64 Runtime (14.44 or newer) is required.$\r$\nChoose X64 on Microsoft's download page, install it, then run this installer again.$\r$\nClick OK to open the page or Cancel to exit."
LangString atelier_runtime ${LANG_JAPANESE} "Microsoft Visual C++ x64 ランタイム（14.44 以降）が必要です。$\r$\nMicrosoft の公式ページで X64 を選択してインストールし、このインストーラーを再実行してください。$\r$\n「OK」でページを開き、「キャンセル」で終了します。"
LangString atelier_runtime ${LANG_KOREAN} "Microsoft Visual C++ x64 런타임 (14.44 이상)이 필요합니다.$\r$\nMicrosoft 공식 다운로드 페이지에서 X64를 선택하여 설치한 후 이 설치 프로그램을 다시 실행하세요.$\r$\n확인을 누르면 페이지를 열고 취소를 누르면 종료합니다."

!macroend
!endif

!macro customInit
  !ifndef BUILD_UNINSTALLER
    ${IfNot} ${AtLeastWin10}
      MessageBox MB_OK|MB_ICONSTOP "$(atelier_windows)"
      Abort
    ${EndIf}
    ; 在解包或卸载旧版本之前检查，避免留下半安装状态。
    Call AtelierCheckRuntime
    Pop $0
    ${If} $0 != "1"
      ${IfNot} ${Silent}
        MessageBox MB_OKCANCEL|MB_ICONINFORMATION "$(atelier_runtime)" IDCANCEL atelier_runtime_cancel
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
