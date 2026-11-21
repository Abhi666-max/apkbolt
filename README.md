# ApkBolt

<p align="center">
  <img src="docs/images/logo.png" alt="ApkBolt Logo" width="160" />
</p>

<p align="center">
  <strong>High-Performance Android Application Launcher & Native Windows Desktop Container</strong><br />
  <em>Run Android packages as standalone Windows desktop software with sub-second resumption and zero bloat.</em><br /><br />
  <strong>Architected & Maintained by <a href="https://github.com/abhi666-max">Abhijeet Kangane</a></strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-amber.svg?style=flat-square" alt="License: MIT" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011%20x64-0078D6.svg?style=flat-square" alt="Platform" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Runtime-Android%2014%20(API%2034)-3DDC84.svg?style=flat-square" alt="Android 14" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Architecture-x86__64%20%2B%20ARM%20Translation-orange.svg?style=flat-square" alt="Architecture" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Tests-16%20Suites%20Passing-brightgreen.svg?style=flat-square" alt="Tests" /></a>
</p>

---

## 1. Executive Overview

**ApkBolt** is an enterprise-grade Windows desktop container designed to execute Android applications natively on Microsoft Windows 10 and 11. Unlike conventional Android emulators that bundle intrusive advertisements, heavy background telemetry, and monolithic virtual machine frames, ApkBolt isolates every Android application into its own independent Windows desktop window.

### Key Capabilities

* **Standalone Window Management**: Each Android application runs within an independent top-level Windows frame with dedicated titlebars, minimize/maximize controls, and taskbar grouping.
* **Instant Drag-and-Drop Ingestion**: Install and launch `.apk`, `.apks`, and `.xapk` packages directly by dropping them onto the dashboard or double-clicking them in Windows Explorer.
* **Sub-Second Warm Start**: An optimized, background Android 14 container keeps the execution layer hot. Subsequent app launches execute in under 1.8 seconds.
* **Direct GPU Acceleration**: Native passthrough for NVIDIA, AMD Radeon, and Intel graphics via ANGLE (DirectX 11/12) and Swangle fallbacks for steady 60 FPS performance.
* **Bidirectional Clipboard Synchronization**: Transparent real-time synchronization between Windows and Android guest clipboards.
* **Package Backup & Export**: Pull installed applications from guest storage back to the host filesystem as verified `.apk` archives.
* **Zero Telemetry & Zero Bloat**: Built purely with open-source virtualization primitives (QEMU, WHPX, ADB). Contains no miners, bundled adware, or background network miners.

---

## 2. System Architecture

ApkBolt divides responsibility between a lightweight Node.js/Electron host orchestration layer and an isolated Android 14 guest runtime.

```
+-------------------------------------------------------------------------------+
|                           WINDOWS HOST SUBSYSTEM                              |
|                                                                               |
|  +--------------------+   +---------------------+   +----------------------+  |
|  |   ApkBolt UI Shell |   |  Windows Explorer   |   |   Start Menu / Lnk   |  |
|  |  (Electron Main)   |   | (File Association)  |   |  (Isolated Taskbar)  |  |
|  +---------+----------+   +----------+----------+   +----------+-----------+  |
|            |                         |                         |              |
|            +-------------------------+-------------------------+              |
|                                      |                                        |
|                       +--------------v--------------+                         |
|                       |  ApkBolt Core Engine Bridge |                         |
|                       |   - Window Geometry & Frame |                         |
|                       |   - AXML / ARSC Parser      |                         |
|                       |   - Hardware Doctor & Fix   |                         |
|                       +--------------+--------------+                         |
+--------------------------------------|----------------------------------------+
                                       | ADB / WHPX IPC
+--------------------------------------v----------------------------------------+
|                      QEMU HYPERVISOR VIRTUALIZATION                           |
|                                                                               |
|   Windows Hypervisor Platform (WHPX)  /  Android Emulator Hypervisor Driver   |
|   +------------------------------------------------------------------------+  |
|   |                        ANDROID 14 (API 34) GUEST                       |  |
|   |                                                                        |  |
|   |   +----------------------------------------------------------------+   |  |
|   |   |                Freeform Multi-Window Manager                   |   |  |
|   |   |                                                                |   |  |
|   |   |   +----------------------+          +----------------------+   |   |  |
|   |   |   |  Android App Window  |          |  Android App Window  |   |   |  |
|   |   |   |  (e.g., WhatsApp)    |          |  (e.g., Spotify)     |   |   |  |
|   |   |   +----------------------+          +----------------------+   |   |  |
|   |   +----------------------------------------------------------------+   |  |
|   |                                                                        |  |
|   |   +-----------------------+   +------------------------------------+   |  |
|   |   |  libndk_translation   |   |   Persistent Userdata Partition    |   |  |
|   |   |  (ARM64 -> x86_64)    |   |        (Sparse QCOW2 Delta)        |   |  |
|   |   +-----------------------+   +------------------------------------+   |  |
|   +------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------+
```

---

## 3. The 1.45 GB Android Runtime Architecture

New users often wonder: *How can a ~96MB launcher execute full Android 14 packages?*

ApkBolt decouples the ultra-lightweight ~96MB host launcher from the guest OS system image:

```
[Clean PC: First Launch]
       │
       ▼
1. Local Storage Scan: Detects if Android SDK or previous image exists in %APPDATA%\apkbolt\runtime
       │
       ├─► [Found]: Instantly mounts existing image (0 MB downloaded).
       │
       └─► [Clean Machine]:
             │
             ▼
2. 8-Connection Parallel Chunked Downloader (`src/core/download.js`):
   Streams the verified Google Android 14 x86_64 system image archive (~1.45 GB compressed,
   unpacking to ~3.1 GB raw system.img) with automatic HTTP `Content-Range` chunk verification
   and auto-resume into `%APPDATA%\apkbolt\runtime`.
             │
             ▼
3. Zero-Copy Immutable Mount:
   The downloaded `system.img` remains read-only. All application data, caches, and modifications
   are written to a high-speed differential QCOW2 overlay (`userdata.img`), enabling instant snapshots.
```

For offline or enterprise environments where internet access is restricted, the full **NSIS Offline Installer** (`ApkBolt-Setup-0.6.3.exe`) bundles the entire runtime directly in the executable.

---

## 4. Repository & Directory Structure

```
apkbolt/
├── .github/
│   └── workflows/              # Automated CI test matrix & release build pipeline
├── assets/                     # Core system assets and auxiliary input utilities
├── build/                      # Build automation, installer scripts, and packaging
│   ├── installer.nsh           # Custom NSIS installation & uninstaller hooks
│   ├── msix.js                 # Microsoft Store MSIX packaging automation
│   ├── pack.js                 # Portable and full binary distribution packager
│   └── slim-runtime.js         # Runtime optimizer and dependency trimmer
├── docs/                       # Comprehensive technical and developer documentation
│   ├── ARCHITECTURE.md         # Deep-dive system architecture specification
│   ├── DEV-ENV.md              # Contributor environment setup instructions
│   └── USER-MANUAL.md          # End-user operations and troubleshooting handbook
├── src/                        # Production application source code
│   ├── core/                   # Virtualization core, ADB bridge, and hypervisor drivers
│   │   ├── adb.js              # High-throughput ADB client connection pool
│   │   ├── clipboard.js        # Bidirectional host/guest clipboard synchronization
│   │   ├── doctor.js           # Self-healing diagnostics and hardware profiling
│   │   ├── emulator.js         # QEMU process lifecycle supervisor
│   │   ├── installer.js        # Package installation, export, and desktop integration
│   │   └── store.js            # Persistent settings and application registry
│   ├── drivers/                # Hardware compatibility profiles (AMD, Intel, NVIDIA)
│   ├── main.js                 # Electron main entry point and lifecycle manager
│   ├── preload.js              # Secure IPC bridge for renderer process
│   └── ui/                     # Dark lightning desktop interface
│       ├── app.js              # Reactive UI state manager
│       ├── index.html          # Main application frame
│       └── style.css           # Obsidian & amber high-contrast design system
├── test/                       # 16-suite unit and regression test harness
│   ├── auto-test.js            # End-to-end container integration test suite
│   ├── clipboard-test.js       # Bidirectional clipboard synchronization tests
│   ├── drivers-test.js         # Hardware driver schema and resolution tests
│   └── run-tests.js            # Offline pure-Node unit test harness
├── web/                        # Production Vercel product landing page
│   ├── index.html              # Marketing and feature showcase page
│   ├── main.js                 # Interactive documentation and live metrics
│   ├── style.css               # Responsive dark cyber theme
│   └── vercel.json             # Vercel deployment configuration
└── package.json                # Project manifest and execution scripts
```

---

## 5. Technology Stack

| Layer | Component | Technology |
|---|---|---|
| **Host Application Shell** | Desktop Window & Lifecycle | Electron, Node.js 20+, HTML5, Vanilla ES6+ |
| **Virtualization Engine** | Hypervisor & CPU Emulation | QEMU (x86_64), WHPX (Windows Hypervisor Platform), AEHD |
| **Guest OS Layer** | Operating System | Android 14 (API Level 34), x86_64 AOSP |
| **Binary Translation** | ARM Compatibility | `libndk_translation` (ARM64 / ARMv7a to x86_64) |
| **Graphics Subsystem** | GPU Passthrough & Shaders | ANGLE (DirectX 11/12), Vulkan, Swangle (Software Fallback) |
| **Device Bridge** | IPC & Package Management | ADB (Android Debug Bridge), Native Named Pipes |
| **Packaging & CI/CD** | Installers & Automations | NSIS, MSIX / AppX, GitHub Actions |

---

## 6. Installation & Quick Start

### Hardware Requirements

* **Operating System**: Windows 10 (Build 19044+) or Windows 11 (64-bit).
* **Processor**: Intel Core i3 / AMD Ryzen 3 or higher with hardware virtualization enabled (VT-x / AMD-V).
* **Memory**: Minimum 4 GB RAM (8 GB recommended).
* **Storage**: 4 GB available disk space (SSD recommended).
* **Virtualization**: *Virtual Machine Platform* or *Hyper-V* enabled in Windows Features.

### Running from Pre-Built Releases

1. Download `ApkBolt-Setup-0.6.3.exe` from [GitHub Releases](https://github.com/abhi666-max/apkbolt/releases/latest).
2. Execute the installer. ApkBolt will automatically configure file associations for `.apk` files.
3. Drag any `.apk` file onto the ApkBolt home screen or double-click it in Windows Explorer.

---

## 7. Developer & Build Guide

### Prerequisites

* [Node.js](https://nodejs.org/) v20.x or v22.x LTS
* [Git](https://git-scm.com/)
* PowerShell 5.1 or PowerShell 7+

### Setup Local Environment

```powershell
# Clone the repository
git clone https://github.com/abhi666-max/apkbolt.git
cd apkbolt

# Install development dependencies
npm install

# Run the complete test suite (all 16 suites)
npm test

# Launch ApkBolt in development mode
npm run dev
```

### Build Distribution Packages

```powershell
# Build lightweight portable distribution
npm run pack

# Build full offline portable archive (with bundled runtime)
npm run pack:full

# Build Windows NSIS installer (.exe)
npm run build:exe

# Build Microsoft Store package (.msix)
npm run build:msix
```

---

## 8. Author & Maintainer

ApkBolt is designed, implemented, and maintained by:

**Abhijeet Kangane**
* GitHub: [@abhi666-max](https://github.com/abhi666-max)
* Repository: [https://github.com/abhi666-max/apkbolt](https://github.com/abhi666-max/apkbolt)

---

## 9. License

This project is distributed under the terms of the **MIT License**. See the [LICENSE](LICENSE) file for complete details.
