# Runtime Engine Directory (Optional Manual Placement)

ApkBolt is completely self-contained. The adb binary, QEMU virtualization engine, and base Android system images are automatically downloaded and managed by the application inside:

```
%APPDATA%\apkbolt\runtime\
```

This directory is strictly optional and only needed in the following advanced scenarios:

---

## 1. Manual QEMU Placement

If you wish to use a custom or pre-existing QEMU build rather than the bundled automated download:

```
engine/qemu/
├── qemu-system-x86_64.exe
├── qemu-img.exe
└── ... (remaining QEMU runtime binaries and DLLs)
```

Official QEMU Windows builds: https://qemu.weilnetz.de/w64/

---

## 2. Manual ADB Placement

```
tools/platform-tools/
└── adb.exe
```

Official Android SDK Platform-Tools: https://developer.android.com/tools/releases/platform-tools

---

## 3. System Images

- **Default**: Android 14 (API 34) Google Play x86_64 system image with integrated ARM translation layer.
- **Custom Images**: You can import custom qcow2, raw, or vmdk disk images via Settings → General & Setup → Import.
- Once imported, ApkBolt boots directly from the virtual disk image with zero setup required.

---

## 4. Hardware Acceleration

ApkBolt uses Windows Hypervisor Platform (WHPX) or Android Emulator Hypervisor Driver (AEHD) for near-native hardware virtualization.
If hypervisor features are unavailable, ApkBolt automatically falls back to software emulation (TCG).
