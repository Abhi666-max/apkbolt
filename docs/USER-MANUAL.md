# ApkBolt User Manual & Troubleshooting Guide

**Version**: v0.6.3  -  **Platform**: Windows 10/11 x64  -  **Author**: Abhijeet Kangane

ApkBolt is a native Windows application launcher for Android apps. Install Android applications directly onto Windows, integrate them into your Start Menu and Desktop, and launch them instantly in standalone windows.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Installation & Setup](#2-installation--setup)
3. [Daily Usage](#3-daily-usage)
4. [Core Architectural Concepts](#4-core-architectural-concepts)
5. [Diagnostics & Self-Healing](#5-diagnostics--self-healing)
6. [Common Issues & Solutions](#6-common-issues--solutions)
   - [6.1 Acceleration / Slow Boot](#61-acceleration--slow-boot)
   - [6.2 Installation Failures](#62-installation-failures)
   - [6.3 ARM Translation Layer](#63-arm-translation-layer)
   - [6.4 ADB Authorization](#64-adb-authorization)
   - [6.5 App Window Presentation](#65-app-window-presentation)
   - [6.6 Audio Configuration](#66-audio-configuration)
   - [6.7 Visual C++ Runtime (0xC0000135)](#67-visual-c-runtime-0xc0000135)
7. [CLI Reference](#7-cli-reference)
8. [Directory Layout](#8-directory-layout)

---

## 1. System Overview

```
Windows Desktop Shortcut (.lnk with native app icon)
      │
      ▼ (Double-Click)
ApkBolt.exe --launch <package_name>
      │
      ▼ (Sub-second if background engine is active)
Resolves LAUNCHER Activity
      │
      ▼
Displays Standalone Native Window (Preserving Aspect Ratio, Title, and Icon)
```

- **Drag-and-Drop Installation**: Drag any `.apk`, `.apks`, or `.xapk` file directly onto the launcher window.
- **Native Desktop Shortcuts**: High-resolution icons are extracted offline to create authentic `.lnk` shortcuts.
- **Standalone Window Experience**: Apps run in dedicated windows with fullscreen support (`F11`) and orientation toggle (`Ctrl+Alt+R`).

---

## 2. Installation & Setup

1. **Download**: Download `ApkBolt-Setup.exe` from GitHub Releases.
2. **Setup**: Run the installer. Desktop and Start Menu shortcuts are created automatically.
3. **First Run**: On initial launch, ApkBolt verifies your hardware virtualization environment and prepares the Android 14 base system image.

---

## 3. Daily Usage

### Installing Applications
- **Home Screen Drop Zone**: Drag packages directly onto the main window.
- **Browse APK Button**: Click the button to select an APK from File Explorer.
- **File Association**: Double-click any `.apk` file directly in Windows Explorer.

### Window & Display Controls
- `F11`: Toggle Fullscreen mode.
- `Ctrl+Alt+R`: Rotate app orientation (Portrait / Landscape).
- Settings → Display & Window: Configure tablet mode (600dp breakpoint) or fixed window bounds.

---

## 4. Core Architectural Concepts

1. **Shared Runtime Subsystem**: Rather than spinning up a new emulator instance for each app, ApkBolt shares a unified background Android 14 runtime across all apps, enabling near-instant application switching.
2. **Hardware Acceleration**: Powered by Windows Hypervisor Platform (WHPX) or Android Emulator Hypervisor Driver (AEHD).
3. **Universal Compatibility**: Built-in ARM translation bridge (`libndk_translation`) allows both ARM64 and x86_64 apps to execute smoothly.

---

## 5. Diagnostics & Self-Healing

Navigate to **Settings → Diagnostics & Repair**:
- **Run Checkup**: Analyzes VT-x/SVM, WHPX, GPU drivers, and RAM allocation.
- **Apply Recommended Settings**: Automatically adjusts parameters to fit your host PC.
- **Export Diagnostic Report**: Generates an anonymized diagnostic summary for troubleshooting.

---

## 6. Common Issues & Solutions

### 6.1 Acceleration / Slow Boot
Ensure Intel VT-x or AMD SVM is enabled in BIOS/UEFI. Open PowerShell as Administrator and enable Windows Hypervisor Platform:
```powershell
dism /online /enable-feature /featurename:HypervisorPlatform /all /norestart
```
Then reboot your PC.

### 6.2 Installation Failures
- `INSTALL_FAILED_DEPRECATED_SDK_VERSION`: ApkBolt automatically applies bypass flags for legacy Android applications.
- `INSTALL_FAILED_NO_MATCHING_ABIS`: Automatically handled by switching to the compatible ARM translation image.
- `INSTALL_FAILED_INSUFFICIENT_STORAGE`: Expand the virtual data partition in Settings → General.

### 6.3 Visual C++ Runtime (0xC0000135)
Install the Microsoft Visual C++ 2015-2022 x64 Redistributable via Settings → Diagnostics → Install VC++ Redistributable.

---

## 7. CLI Reference

```powershell
ApkBolt.exe                          # Launch main dashboard window
ApkBolt.exe <path\to\app.apk>        # Install APK package directly
ApkBolt.exe --launch <package_name>  # Launch installed app by package identifier
```

---

## 8. Directory Layout

- Application Data: `%APPDATA%\apkbolt\`
- Shared Host Folder: `%USERPROFILE%\ApkBoltShared\`
- Log Files: `%APPDATA%\apkbolt\logs\`
