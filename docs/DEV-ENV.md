# Developer Environment & Toolchain Guide

This document outlines the development workflow, build targets, and environment configurations for ApkBolt.

---

## 1. Toolchain Requirements

| Tool | Minimum Version | Purpose |
|---|---|---|
| Node.js | v20.0.0+ | Runtime environment & build scripts |
| npm | v10.0.0+ | Dependency management |
| Git | v2.40.0+ | Version control |
| Electron | v33.0.0+ | Desktop application framework |

---

## 2. Setting Up the Development Workspace

```powershell
# Clone the repository
git clone https://github.com/abhi666-max/apkbolt.git
cd apkbolt

# Install dependencies
npm ci

# Start application in development mode
npm start
```

---

## 3. Running Automated Tests

ApkBolt maintains comprehensive test coverage across all subsystems:

```powershell
# Run the entire test suite
npm test
```

Test breakdown:
- `test/run-tests.js`: Core offline parsers (ZIP, PNG, AXML, ARSC, APK).
- `test/engine-test.js`: Virtualization lifecycle, port discovery, and resource throttling.
- `test/auto-test.js`: Full system regression and self-adaptive configuration.
- `test/resources-test.js`: CPU, RAM, and disk partition convergence limits.

---

## 4. Building Distribution Packages

```powershell
# Build portable standalone distribution (.zip)
npm run pack

# Build Windows NSIS Setup Installer (.exe)
npm run build:exe

# Build Microsoft Store package (.msix)
npm run build:msix
```
