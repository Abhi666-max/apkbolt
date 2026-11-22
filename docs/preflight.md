# Preflight Diagnostics & Hardware Self-Adaptation

ApkBolt features a built-in preflight diagnostic engine that profiles the host Windows machine and tunes system parameters before launching the Android subsystem.

---

## 1. Probed Host Metrics

| Metric | Inspection Method | Fallback Behavior |
|---|---|---|
| CPU Virtualization (VT-x / AMD SVM) | `Win32_Processor.VirtualizationFirmwareEnabled` | Marked as unknown; user guided to BIOS |
| Hypervisor Status | `Win32_ComputerSystem.HypervisorPresent` | Software simulation selected |
| Windows Hypervisor Platform (WHPX) | `Get-WindowsOptionalFeature -FeatureName HypervisorPlatform` | WHPX auto-enable prompt triggered |
| Acceleration Health | `emulator -accel-check` | Falls back to TCG mode |
| GPU & VRAM | `Win32_VideoController` | Optimal GPU backend selected |
| Host RAM & CPU Cores | `os.totalmem()`, `os.cpus()` | Automatic RAM & core clamping |

---

## 2. Automated Convergence Parameters

When the user selects **Apply Recommended Settings**, ApkBolt balances resources safely:

- **RAM (`memoryMB`)**:
  - 32 GB Host → 8 GB Android RAM
  - 16 GB Host → 6 GB Android RAM
  - 12 GB Host → 4 GB Android RAM
  - 8 GB Host → 3 GB Android RAM
  - < 8 GB Host → 2 GB Android RAM (never exceeds 50% of available physical RAM)
- **CPU Cores (`cores`)**:
  - 8+ Threads → 4 vCPUs allocated
  - 4-7 Threads → 2-3 vCPUs allocated
  - Always leaves at least 1 core dedicated to Windows.
- **Rendering Resolution (`renderSize`)**:
  - High-performance GPU → Native auto DPI
  - Software TCG mode or low VRAM (<512MB) → Downscales to 540x960 to maintain 60 FPS fluidity.
