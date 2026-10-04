!ifndef ATELIER_PIXIV_KEY
  !define ATELIER_PIXIV_KEY "Software\Classes\pixiv"
!endif

!macro AtelierUnregisterPixiv
  ; 仅注销仍指向本安装位置的协议，不处理其他程序或源码工坊的注册。
  Push $R0
  Push $R1
  Push $R2
  ReadRegStr $R0 HKCU "${ATELIER_PIXIV_KEY}\shell\open\command" ""
  StrCpy $R1 '"$INSTDIR\resources\runtime\node.exe" "$INSTDIR\resources\runtime\scripts\pixiv-scheme-handler.mjs" "%1"'
  StrLen $R2 $R1
  StrCpy $R0 $R0 $R2
  ${If} $R0 == $R1
    DeleteRegKey HKCU "${ATELIER_PIXIV_KEY}"
  ${EndIf}
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
