; 只读取系统运行库状态；不下载或执行其他程序。测试可在编译时改用合成注册表和 DLL 目录。
!ifndef ATELIER_VC_HIVE
  !define ATELIER_VC_HIVE HKLM
!endif
!ifndef ATELIER_VC_KEY
  !define ATELIER_VC_KEY "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64"
!endif
!ifndef ATELIER_DLL_DIR
  ; NSIS 安装器为 32 位，Sysnative 访问实际的 64 位系统目录。
  !define ATELIER_DLL_DIR "$WINDIR\Sysnative"
!endif

Function AtelierCheckRuntime
  Push $R0
  Push $R1
  Push $R2
  StrCpy $R0 "0"
  ReadRegDWORD $R1 ${ATELIER_VC_HIVE} "${ATELIER_VC_KEY}" "Installed"
  StrCmp $R1 "1" 0 atelier_runtime_done
  ReadRegDWORD $R1 ${ATELIER_VC_HIVE} "${ATELIER_VC_KEY}" "Major"
  StrCmp $R1 "14" 0 atelier_runtime_done
  ReadRegDWORD $R2 ${ATELIER_VC_HIVE} "${ATELIER_VC_KEY}" "Minor"
  IntCmp $R2 44 atelier_runtime_dlls atelier_runtime_done atelier_runtime_dlls
  atelier_runtime_dlls:
    IfFileExists "${ATELIER_DLL_DIR}\msvcp140.dll" 0 atelier_runtime_done
    IfFileExists "${ATELIER_DLL_DIR}\msvcp140_1.dll" 0 atelier_runtime_done
    IfFileExists "${ATELIER_DLL_DIR}\vcruntime140.dll" 0 atelier_runtime_done
    IfFileExists "${ATELIER_DLL_DIR}\vcruntime140_1.dll" 0 atelier_runtime_done
    StrCpy $R0 "1"
  atelier_runtime_done:
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd
