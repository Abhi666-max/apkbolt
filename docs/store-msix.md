# Microsoft Store MSIX Packaging Guide

This guide covers building and validating standalone Windows MSIX packages for ApkBolt.

Package target: `dist/store/ApkBolt_0.6.3.0_x64.msix`

---

## 1. Prerequisites

- Windows 10 / 11 SDK (MakeAppx.exe, SignTool.exe)
- Self-signed code signing certificate or trusted commercial certificate

---

## 2. Building MSIX Package

```powershell
npm run build:msix
```

The script compiles the application, embeds assets, generates `AppxManifest.xml`, and packages the output into `dist/store/ApkBolt_0.6.3.0_x64.msix`.
