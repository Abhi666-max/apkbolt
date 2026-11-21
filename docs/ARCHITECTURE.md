# ApkBolt System Architecture

## Architecture Overview

ApkBolt is engineered with a strict layered architecture separating presentation, process orchestration, hardware virtualization, and offline parsing pipelines:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Presentation Layer: src/ui (HTML5, Vanilla CSS3, JavaScript)                │
│                     preload.js (Secure contextBridge isolation)             │
├─────────────────────────────────────────────────────────────────────────────┤
│ Orchestration Layer: src/main.js (Window lifecycle, Tray, CLI dispatch)    │
│                      installer.js (Package parsing & installation pipeline) │
├─────────────────────────────────────────────────────────────────────────────┤
│ Domain & Subsystems: engine.js (Android runtime management, lifecycle)      │
│                      adb.js (Guest OS control)  sharer.js (Bi-directional)  │
├─────────────────────────────────────────────────────────────────────────────┤
│ Offline Parsers:     zip.js → axml.js / arsc.js → apk.js                    │
│                      png.js / shortcut.js (Icon synthesis & .lnk generator) │
├─────────────────────────────────────────────────────────────────────────────┤
│ Virtualization:      QEMU x86_64 Engine (WHPX / AEHD / TCG)                 │
│                      Android 14 (API 34) System Image + ARM Translation     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Execution Workflows

### 1. Direct APK Installation Pipeline

```
Windows Explorer: User double-clicks .apk
  │
  ├── HKCU\Software\Classes\ApkBolt.apk\shell\open\command
  │   Invokes: ApkBolt.exe "C:\Path\To\app.apk"
  │
  └── main.js: parseArgs() → runInstall()
      │
      ├── 1. apk.js: Offline manifest parsing (Zip → AXML → ARSC label & icon)
      ├── 2. engine.ensure(): Verifies background Android runtime health
      ├── 3. adb.install(): Silent package installation via ADB daemon
      ├── 4. png.js / shortcut.js: Generates multi-size .ico & Windows desktop shortcut
      └── 5. store.upsertApp(): Persists metadata to local registry
```

### 2. Native Desktop Application Launch

```
User double-clicks <AppName>.lnk on Desktop or Start Menu
  │
  ├── Invokes: ApkBolt.exe --launch <package_name>
  │
  ├── Single-Instance Lock: IPC message routed to running ApkBolt instance
  │
  ├── ADB Launch: adb shell am start -n <package>/<launcher_activity>
  │
  └── Standalone Window Presentation:
      - Assigns authentic app icon & title
      - Exact device aspect ratio maintained
      - Smooth DPI scaling and F11 fullscreen toggle
```

### 3. Bi-Directional Host-Guest Synchronization

```
Host Windows Folder: %USERPROFILE%\ApkBoltShared
       │
       ▼ (Automatic background synchronization daemon)
       │
Android Guest Storage: /sdcard/ApkBoltShared
```

---

## Virtualization & Hypervisor Pipeline

1. **Hardware Virtualization (Preferred)**:
   - Intel VT-x or AMD SVM (enabled via BIOS/UEFI)
   - Windows Hypervisor Platform (WHPX) or Android Emulator Hypervisor Driver (AEHD)
   - Provides sub-millisecond hypercall execution and 60+ FPS native rendering.
2. **Software Emulation Fallback (TCG)**:
   - Activates automatically if hypervisor extensions are unavailable.
   - Guarantees execution compatibility across all legacy Windows PCs.
