# Hardware Driver Compatibility Profiles

ApkBolt supports declarative **Driver Profiles**: JSON definitions that specify machine-matching criteria and corresponding runtime configuration overrides.

---

## 1. Problem Solved

Hardware environments differ significantly across Windows machines:
- Older integrated GPUs (Intel HD Graphics) with limited GLES support require `software` or `swangle` rendering.
- Machines without Hyper-V / WHPX require automatic fallback to software TCG emulation.
- Certain AMD GPU driver versions exhibit Vulkan instability and run better with Angle/D3D11.

Driver profiles allow these hardware-specific optimizations to be configured without modifying core application code.

---

## 2. Directory Locations

| Directory | Scope |
|---|---|
| `%APPDATA%\apkbolt\drivers\*.json` | User-defined custom hardware overrides |
| `src/drivers/*.json` | Built-in baseline driver profiles (read-only) |

User-defined drivers override built-in drivers with matching IDs.

---

## 3. Driver Profile Schema

```json
{
  "format": "apkbolt-driver/1",
  "id": "amd-igpu-swangle",
  "name": "AMD Radeon Graphics Swangle Profile",
  "version": "1.0.0",
  "author": "Abhijeet Kangane",
  "description": "Switches rendering backend to swangle for AMD hardware with older drivers.",
  "priority": 5,
  "match": {
    "platform": ["win32"],
    "gpuVendor": ["amd"],
    "totalMB": { "min": 8192 },
    "accel": ["whpx"]
  },
  "effect": {
    "gpuMode": "swangle",
    "forceTcg": false,
    "emulatorArgs": ["-feature=Vulkan"]
  }
}
```
