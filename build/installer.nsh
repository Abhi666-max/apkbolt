; ApkBolt custom NSIS script
; Purpose: Before uninstall begins, terminate any remaining background runtime processes,
; otherwise they hold file locks in the install directory, preventing clean uninstall.
;
; ApkBolt may leave detached qemu instances (for instant warm start next time),
; so the uninstaller cleans them up completely.

!macro customInstall
  DetailPrint "Creating desktop shortcuts..."
  CreateShortcut "$DESKTOP\ApkBolt.lnk" "$INSTDIR\ApkBolt.exe" "" "$INSTDIR\ApkBolt.exe" 0 \
    SW_SHOWNORMAL "" "ApkBolt — High-Performance Android Desktop Launcher"
  CreateDirectory "$SMPROGRAMS\ApkBolt"
  CreateShortcut "$SMPROGRAMS\ApkBolt\ApkBolt.lnk" "$INSTDIR\ApkBolt.exe" "" "$INSTDIR\ApkBolt.exe" 0 \
    SW_SHOWNORMAL "" "ApkBolt — High-Performance Android Desktop Launcher"
!macroend

!macro customUnInstall
  Delete "$DESKTOP\ApkBolt.lnk"
  Delete "$SMPROGRAMS\ApkBolt\ApkBolt.lnk"
  RMDir "$SMPROGRAMS\ApkBolt"

  DetailPrint "Terminating residual ApkBolt processes..."
  nsExec::Exec 'taskkill.exe /F /T /IM ApkBolt.exe'
  nsExec::Exec 'taskkill.exe /F /T /IM qemu-system-x86_64.exe'
  nsExec::Exec 'taskkill.exe /F /T /IM qemu-system-i386.exe'
  nsExec::Exec 'taskkill.exe /F /T /IM emulator.exe'
  nsExec::Exec 'taskkill.exe /F /T /IM emulator-check.exe'
  nsExec::Exec 'taskkill.exe /F /T /IM adb.exe'
  nsExec::Exec 'taskkill.exe /F /T /IM netsimd.exe'
  Sleep 1500
!macroend
