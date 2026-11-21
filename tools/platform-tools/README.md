# Portable Platform-Tools (ADB)

Extract Android platform-tools into this directory so that `adb.exe` is present:

```
tools/platform-tools/
└── adb.exe
```

Download source: https://developer.android.com/tools/releases/platform-tools

When this directory is empty, ApkBolt searches for `adb.exe` in the following fallback order:

1. User-configured custom ADB path (Settings → General)
2. `%APPDATA%\apkbolt\runtime\platform-tools\adb.exe`
3. `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`
4. Existing third-party emulator installations
5. System `PATH`
