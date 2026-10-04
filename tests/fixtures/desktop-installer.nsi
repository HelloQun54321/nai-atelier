Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${ATELIER_TEST_EXE}"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "${ATELIER_PROJECT}\desktop\installer.nsh"

!macro ExpectRuntime EXPECT CODE
  Call AtelierCheckRuntime
  Pop $R4
  ${If} $R4 != "${EXPECT}"
    Call Cleanup
    SetErrorLevel ${CODE}
    Quit
  ${EndIf}
!macroend

Function Cleanup
  DeleteRegKey HKCU "${ATELIER_TEST_KEY}"
FunctionEnd

!ifdef ATELIER_TEST_MISSING
Function .onInit
  SetRegView 64
  !insertmacro customInit
FunctionEnd
!endif

Section
  SetRegView 64
  StrCpy $INSTDIR "${ATELIER_DLL_DIR}\自选 安装位置"
  ; 合成运行库状态，不接触 HKLM 或任何系统 DLL。
  !insertmacro ExpectRuntime 0 10
  WriteRegDWORD HKCU "${ATELIER_VC_KEY}" "Installed" 1
  WriteRegDWORD HKCU "${ATELIER_VC_KEY}" "Major" 14
  WriteRegDWORD HKCU "${ATELIER_VC_KEY}" "Minor" 44
  !insertmacro ExpectRuntime 0 11
  CreateDirectory "${ATELIER_DLL_DIR}"
  FileOpen $R5 "${ATELIER_DLL_DIR}\msvcp140.dll" w
  FileClose $R5
  FileOpen $R5 "${ATELIER_DLL_DIR}\msvcp140_1.dll" w
  FileClose $R5
  FileOpen $R5 "${ATELIER_DLL_DIR}\vcruntime140.dll" w
  FileClose $R5
  FileOpen $R5 "${ATELIER_DLL_DIR}\vcruntime140_1.dll" w
  FileClose $R5
  WriteRegDWORD HKCU "${ATELIER_VC_KEY}" "Minor" 43
  !insertmacro ExpectRuntime 0 12
  WriteRegDWORD HKCU "${ATELIER_VC_KEY}" "Minor" 44
  !insertmacro ExpectRuntime 1 13
  WriteRegDWORD HKCU "${ATELIER_VC_KEY}" "Minor" 51
  !insertmacro ExpectRuntime 1 14
  WriteRegDWORD HKCU "${ATELIER_VC_KEY}" "Installed" 0
  !insertmacro ExpectRuntime 0 15
  WriteRegDWORD HKCU "${ATELIER_VC_KEY}" "Installed" 1
  WriteRegDWORD HKCU "${ATELIER_VC_KEY}" "Major" 13
  !insertmacro ExpectRuntime 0 16
  WriteRegDWORD HKCU "${ATELIER_VC_KEY}" "Major" 14
  Delete "${ATELIER_DLL_DIR}\vcruntime140_1.dll"
  !insertmacro ExpectRuntime 0 17

  ; 他人的协议注册不受影响；自己的注册允许尾随实际回调地址。
  WriteRegStr HKCU "${ATELIER_PIXIV_KEY}\shell\open\command" "" '"D:\Other Atelier\node.exe" "%1"'
  !insertmacro customUnInstall
  ReadRegStr $R4 HKCU "${ATELIER_PIXIV_KEY}\shell\open\command" ""
  ${If} $R4 != '"D:\Other Atelier\node.exe" "%1"'
    Call Cleanup
    SetErrorLevel 20
    Quit
  ${EndIf}
  WriteRegStr HKCU "${ATELIER_PIXIV_KEY}\shell\open\command" "" '"$INSTDIR\resources\runtime\NODE.EXE" "$INSTDIR\resources\runtime\scripts\pixiv-scheme-handler.mjs" "%1" "http://127.0.0.1:3010"'
  !insertmacro customUnInstall
  ClearErrors
  ReadRegStr $R4 HKCU "${ATELIER_PIXIV_KEY}\shell\open\command" ""
  ${IfNot} ${Errors}
    Call Cleanup
    SetErrorLevel 21
    Quit
  ${EndIf}
  Call Cleanup
  SetErrorLevel 0
SectionEnd
