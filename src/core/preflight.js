'use strict';
/**
 * checkup + configuration. 
 *
 * : ApkStart ,  --
 * 1. CPU (VT-x / AMD-V) BIOS ; 
 * 2. Windows " / Hyper-V"(WHPX ); 
 * 3. (, , driverversion, ); 
 * 4. memory / disk 2~8GB Android. 
 *
 * "launchfailure → log → ". , 
 * (memory, , , ), ( / driver), 
 * BIOS , . 
 *
 * : 
 * - collect() -- probe(Windows PowerShell ), fallbackpath; 
 * - evaluate() -- : probe"checkup + configuration", ; 
 * - app main.js(settings / ), . 
 *
 * note: ** BIOS **. , . 
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

// ---------------- probe ----------------

/**
 * (Windows powershell.exe),  JSON; failure/timeout null. 
 *
 * execFile execFileSync: launch + CIM 1~2 , 
 * (), "checkup". 
 */
function psJson(script, timeout = 15000) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const { execFile } = require('child_process');
      execFile('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
      ], { encoding: 'utf8', windowsHide: true, timeout }, (err, stdout) => {
        if (err) { resolve(null); return; }
        const t = String(stdout || '').trim();
        if (!t) { resolve(null); return; }
        try { resolve(JSON.parse(t)); } catch (_) { resolve(null); }
      });
    } catch (_) {
      resolve(null);
    }
  });
}

const HW_SCRIPT = [
  '$ErrorActionPreference = "SilentlyContinue";',
  '$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name,NumberOfCores,NumberOfLogicalProcessors,VirtualizationFirmwareEnabled,VMMonitorModeExtensions,SecondLevelAddressTranslationExtensions;',
  '$cs = Get-CimInstance Win32_ComputerSystem | Select-Object -First 1 HypervisorPresent,TotalPhysicalMemory;',
  '$gpu = @(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,DriverDate,AdapterRAM,VideoProcessor,Status);',
  // AdapterRAM >4GB 4294967295;  qwMemorySize( 000N )
  '$vram = 0;',
  'Get-ChildItem "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}" -ErrorAction SilentlyContinue | ForEach-Object {',
  '  $v = (Get-ItemProperty $_.PSPath -Name "HardwareInformation.qwMemorySize" -ErrorAction SilentlyContinue)."HardwareInformation.qwMemorySize";',
  '  if ($v -and $v -gt $vram) { $vram = $v }',
  '};',
  '[pscustomobject]@{ cpu = $cpu; cs = $cs; gpu = $gpu; vram = $vram } | ConvertTo-Json -Depth 6 -Compress',
].join(' ');

const FEATURE_SCRIPT = [
  '$ErrorActionPreference = "SilentlyContinue";',
  '$o = [ordered]@{};',
  'foreach ($n in @("HypervisorPlatform","VirtualMachinePlatform","Microsoft-Hyper-V-All")) {',
  '  try { $o[$n] = (Get-WindowsOptionalFeature -Online -FeatureName $n -ErrorAction Stop).State } catch { $o[$n] = "unknown" }',
  '}',
  '$o | ConvertTo-Json -Compress',
].join(' ');

/** (probe WHPX API / AEHD driver / ) */
function fileExists(rel) {
  try {
    return fs.existsSync(path.join(process.env.SystemRoot || 'C:\\Windows', rel));
  } catch (_) {
    return false;
  }
}

function dateToISO(v) {
  if (!v) return '';
  // PowerShell DateTime → `/Date(1700000000000)/` ISO
  const m = /\/Date\((\d+)\)\//.exec(String(v));
  if (m) {
    try { return new Date(Number(m[1])).toISOString().slice(0, 10); } catch (_) { return ''; }
  }
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/**
 * probe. 
 *
 * null/0, **probefailure**: 
 * "", checkup"", . 
 *
 * @param {object} o { accel } accel provisioner.emulatorAccel() ,  emulator
 * @returns {object} hw
 */
async function collect({ accel = null } = {}) {
  const [raw, feats] = process.platform === 'win32'
    ? await Promise.all([psJson(HW_SCRIPT), psJson(FEATURE_SCRIPT)])
    : [null, null];
  const cpu = (raw && raw.cpu) || {};
  const cs = (raw && raw.cs) || {};
  const gpus = Array.isArray(raw && raw.gpu) ? raw.gpu : (raw && raw.gpu ? [raw.gpu] : []);

  // "":  Microsoft Basic Display /
  const usable = gpus.filter((g) => g && g.Name && !/microsoft basic|remote display|virtual display/i.test(g.Name));
  const gpu = (usable[0] || gpus[0]) || {};
  const name = String(gpu.Name || '');
  let vendor = 'unknown';
  if (/nvidia|geforce|rtx\s|gtx\s|quadro/i.test(name)) vendor = 'nvidia';
  else if (/(?<!virtual\s)(amd|radeon|rx\s\d)/i.test(name)) vendor = 'amd';
  else if (/intel|uhd\s|iris|arc\s/i.test(name)) vendor = 'intel';

  const ramBytes = Number(gpu.AdapterRAM) || 0;
  const qw = Number((raw && raw.vram) || 0);
  // AdapterRAM 32 , >4GB 4095MB, 
  const vramMB = Math.round((qw > 0 ? qw : (ramBytes > 0 && ramBytes < 4096 * 1024 * 1024 ? ramBytes : 0)) / 1048576);

  const hypervisor = cs.HypervisorPresent === true;
  const accelOk = !!(accel && accel.ok);
  /**
 * note WMI (): 
 * Hyper-V / VBS VT, `VMMonitorModeExtensions` 
 * `SecondLevelAddressTranslationExtensions` False -- hardware acceleration. 
 * "False"" Hypervisor, """, 
 * "", . 
   */
  const vmExt = cpu.VMMonitorModeExtensions;
  const slatRaw = cpu.SecondLevelAddressTranslationExtensions;
  let vtSupported = true;
  if (vmExt === false && !hypervisor && !accelOk) vtSupported = false;
  else if (vmExt !== true) vtSupported = 'unknown';
  const slat = slatRaw === true ? true : (slatRaw === false && !hypervisor && !accelOk ? false : 'unknown');
  // BIOS : , Hypervisor firmware
  let vtFirmware = null;
  if (cpu.VirtualizationFirmwareEnabled === true) vtFirmware = true;
  else if (cpu.VirtualizationFirmwareEnabled === false && !hypervisor && !accelOk) vtFirmware = false;
  const winHv = fileExists('System32\\WinHvPlatform.dll');
  const vmCompute = fileExists('System32\\vmcompute.exe');
  const aehd = fileExists('System32\\drivers\\aehd.sys');

  const state = (k) => {
    const v = feats && feats[k];
    return v ? String(v).toLowerCase() : 'unknown';
  };

  return {
    platform: process.platform,
    arch: process.arch,
    osBuild: (() => {
      const m = /(\d+)\s*$/.exec(os.release() || '');
      return m ? Number(m[1]) : 0;
    })(),
    cpu: {
      name: String(cpu.Name || '').trim(),
      cores: Number(cpu.NumberOfCores) || 0,
      threads: Number(cpu.NumberOfLogicalProcessors) || 0,
      vtSupported,
      vtFirmware,
      slat,
    },
    memory: {
      totalMB: Math.round((Number(cs.TotalPhysicalMemory) || os.totalmem()) / 1048576),
      freeMB: Math.round(os.freemem() / 1048576),
    },
    gpu: {
      name,
      vendor,
      vramMB,
      driverVersion: String(gpu.DriverVersion || ''),
      driverDate: dateToISO(gpu.DriverDate),
      status: String(gpu.Status || ''),
    },
    virtualization: {
      hypervisorPresent: hypervisor,
      hypervisorPlatform: state('HypervisorPlatform'),
      vmPlatform: state('VirtualMachinePlatform'),
      hyperV: state('Microsoft-Hyper-V-All'),
      winHvApi: winHv,
      vmCompute,
      aehdInstalled: aehd,
      accelOk,
      accelKind: accel && accel.ok ? String(accel.kind || 'whpx') : 'none',
    },
  };
}

// ---------------- () ----------------

/** recommended: memory / / . , .  */
function recommendResources({ totalMB = 0, cores = 0, accelOk = false, vramMB = 0 } = {}) {
  const mem = Number(totalMB) || 0;
  const n = Number(cores) || 1;
  // ,  1 Windows; 
  let memoryMB = 2048;
  if (mem >= 32768) memoryMB = 8192;
  else if (mem >= 16384) memoryMB = 6144;
  else if (mem >= 12288) memoryMB = 4096;
  else if (mem >= 8192) memoryMB = 3072;
  else memoryMB = 2048;
  if (mem && memoryMB > Math.floor(mem * 0.5 / 512) * 512) {
    memoryMB = Math.max(2048, Math.floor(mem * 0.5 / 512) * 512);
  }
  const wantCores = n >= 8 ? 4 : n >= 4 ? Math.max(2, n - 2) : 2;
  const c = Math.max(1, Math.min(wantCores, n - 1));
  // software emulation + :  540p, ( 56%)
  const renderSize = (!accelOk || (vramMB > 0 && vramMB < 512)) ? '540x960' : 'auto';
  return { memoryMB, cores: c, renderSize };
}

/** :  + + "" */
function recommendGpu({ vendor = 'unknown', accelOk = false, vramMB = 0 } = {}) {
  if (!accelOk) return { gpuMode: 'software', why: 'No hardware acceleration available; using software renderer' };
  if (vendor === 'unknown') return { gpuMode: 'auto', why: 'GPU model not identified; passing to fallback chain' };
  if (!vramMB || vramMB < 512) return { gpuMode: 'swangle', why: 'Low GPU VRAM detected; swangle is more stable' };
  if (vendor === 'nvidia') return { gpuMode: 'host', why: 'NVIDIA GPU detected; host pass-through is optimal' };
  if (vendor === 'amd') return { gpuMode: 'swangle', why: 'AMD graphics detected; swangle mode is recommended' };
  if (vendor === 'intel') return { gpuMode: 'swangle', why: 'Intel integrated graphics detected; swangle mode recommended' };
  return { gpuMode: 'auto', why: 'GPU model not identified; passing to fallback chain' };
}

/**
 * probecheckup. 
 *
 * @param {object} o { hw, settings, edition } edition: 'store' | 'installer'
 * @returns {{ level:string, items:Array, patch:object|null, driver:object|null, summary:string }}
 */
function evaluate({ hw = {}, settings = {}, edition = 'installer' } = {}) {
  const v = hw.virtualization || {};
  const cpu = hw.cpu || {};
  const gpu = hw.gpu || {};
  const mem = hw.memory || {};
  const items = [];

  const add = (item) => items.push(item);

  // ---- 1. CPU (BIOS) ----
  if (cpu.vtSupported === false) {
    add({
      key: 'vt-unsupported',
      level: 'bad',
      title: 'CPU does not support hardware virtualization',
      detail: 'Running in software mode (5-10x slower). Suitable for lightweight apps.',
      action: null,
    });
  } else if (cpu.vtFirmware === false) {
    add({
      key: 'vt-bios-off',
      level: 'bad',
      title: 'Hardware virtualization disabled in BIOS',
      detail: 'Reboot into BIOS and enable Intel VT-x or AMD SVM.'
        + 'Usually found under Advanced → CPU Configuration or Virtualization Technology.',
      action: { kind: 'manual', id: 'bios', label: 'Requires enabling in BIOS; cannot be automated' },
    });
  } else if (cpu.vtFirmware === true) {
    add({
      key: 'vt-ok',
      level: 'ok',
      title: 'Hardware virtualization enabled in BIOS',
      detail: cpu.name ? `${cpu.name}  -  ${cpu.cores || '?'} cores / ${cpu.threads || '?'} threads` : '',
      action: null,
    });
  } else {
    add({
      key: 'vt-unknown',
      level: 'warn',
      title: 'Cannot detect CPU virtualization status',
      detail: 'Verify in BIOS that VT-x / SVM is enabled if hardware acceleration is missing.',
      action: { kind: 'manual', id: 'bios', label: 'Verify Manually' },
    });
  }

  // ---- 2. Windows : WHPX / Hyper-V ----
  const hp = String(v.hypervisorPlatform || 'unknown');
  const hpxOn = hp === 'enabled' || (hp === 'unknown' && v.winHvApi && v.hypervisorPresent);
  if (hpxOn) {
    add({
      key: 'whpx-ok',
      level: 'ok',
      title: 'Windows Hypervisor Platform enabled',
      detail: v.hypervisorPresent
        ? 'Hypervisor is running; WHPX acceleration available.'
        : 'Feature enabled; if acceleration is unavailable, restart PC.',
      action: null,
    });
  } else if (edition === 'store') {
    add({
      key: 'whpx-off',
      level: 'bad',
      title: 'Windows Hypervisor Platform not enabled',
      detail: 'Store version cannot modify system features directly. Press Win+R → type optionalfeatures → check "Windows Hypervisor Platform" and "Virtual Machine Platform" → OK → Restart.',
      action: { kind: 'elevate', id: 'virtualization', label: 'Open Windows Features' },
    });
  } else {
    add({
      key: 'whpx-off',
      level: 'bad',
      title: 'Windows Hypervisor Platform not enabled',
      detail: 'Click below to enable HypervisorPlatform + VirtualMachinePlatform (requires admin confirmation), then restart PC.',
      action: { kind: 'elevate', id: 'virtualization', label: 'Enable All (Admin)' },
    });
  }

  // ---- 3. hardware acceleration ----
  if (v.accelOk) {
    add({
      key: 'accel-ok',
      level: 'ok',
      title: `Hardware acceleration available (${v.accelKind === 'aehd' ? 'AEHD' : 'WHPX'})`,
      detail: 'Boot will use hardware acceleration. Recommended configuration based on GPU and RAM.',
      action: null,
    });
  } else {
    add({
      key: 'accel-off',
      level: 'warn',
      title: 'Hardware acceleration unavailable',
      detail: edition === 'installer' && v.vtFirmware !== false
        ? 'Install the AEHD driver (requires admin) or enable "Windows Hypervisor Platform" and restart.'
        : 'Software emulation will be used meanwhile (5-10x slower).',
      action: edition === 'installer' && v.vtFirmware !== false
        ? { kind: 'elevate', id: 'accel', label: 'Install AEHD Driver (Admin)' }
        : null,
    });
  }

  // ---- 4. ----
  if (!gpu.name) {
    add({
      key: 'gpu-unknown',
      level: 'warn',
      title: 'Could not detect GPU information',
      detail: 'May be Remote Desktop, VM, or driver issue. Rendering backend will handle automatic fallback.',
      action: null,
    });
  } else {
    const integrated = /radeon\s+(graphics|vega)|uhd|iris|hd\s+graphics|vega/i.test(gpu.name);
    const vram = gpu.vramMB
      ? `${(gpu.vramMB / 1024).toFixed(1)} GB VRAM${integrated ? ' (Integrated GPU, rest shared)' : ''}`
      : 'VRAM unknown';
    add({
      key: 'gpu-info',
      level: 'ok',
      title: `${gpu.name}`,
      detail: `${vram}${gpu.driverVersion ? `  -  Driver ${gpu.driverVersion}` : ''}${gpu.driverDate ? `(${gpu.driverDate})` : ''}`,
      action: null,
    });
    const old = /^(19|20)\d{2}-\d{2}-\d{2}$/.test(gpu.driverDate || '')
      ? (Date.now() - new Date(gpu.driverDate).getTime()) / 31536000000 : 0;
    if (old > 3) {
      add({
        key: 'gpu-driver-old',
        level: 'warn',
        title: 'GPU driver is outdated',
        detail: `Driver date ${gpu.driverDate} (~${Math.floor(old)} year(s) old). Older drivers can cause black screens; update from vendor website.`,
        action: null,
      });
    }
  }

  // ---- 5. memory / disk / version ----
  const total = Number(mem.totalMB) || 0;
  if (!total) {
    add({ key: 'mem-unknown', level: 'warn', title: 'Physical memory unavailable', detail: '', action: null });
  } else if (total < 6144) {
    add({
      key: 'mem-low',
      level: 'warn',
      title: `Limited RAM (${(total / 1024).toFixed(1)} GB)`,
      detail: 'Android VM allocated max 2 GB and 2 cores with 540x960 resolution. Close browser tabs before running apps.',
      action: null,
    });
  } else {
    add({
      key: 'mem-ok',
      level: 'ok',
      title: `Physical RAM: ${(total / 1024).toFixed(0)} GB`, 
      detail: '',
      action: null,
    });
  }

  const build = Number(hw.osBuild) || 0;
  if (build && build < 19041) {
    add({
      key: 'os-old',
      level: 'warn',
      title: `Legacy Windows Version (build ${build})`, 
      detail: 'ApkBolt requires Windows 10 2004 (build 19041) or higher. Older versions may experience issues.',
      action: null,
    });
  }

  // ---- configuration ----
  const rec = recommendResources({ totalMB: total, cores: cpu.threads || cpu.cores, accelOk: !!v.accelOk, vramMB: gpu.vramMB });
  const gpuRec = recommendGpu({ vendor: gpu.vendor, accelOk: !!v.accelOk, vramMB: gpu.vramMB });
  const patch = {
    engine: {
      autoMemory: false,
      memoryMB: rec.memoryMB,
      cores: rec.cores,
      renderSize: rec.renderSize,
      // → software emulation, ;  auto fallback
      gpuMode: v.accelOk ? 'auto' : 'software',
      forceTcg: !v.accelOk,
    },
  };

  // driver: boot, checkup
  const vendor = gpu.vendor && gpu.vendor !== 'unknown' ? gpu.vendor : 'unknown';
  const driver = {
    format: 'apkbolt-driver/1',
    id: `auto-${vendor}-${build || 'x'}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-'),
    name: `Auto Config (${gpu.name || vendor})`,
    version: '1.0.0',
    author: 'ApkBolt Diagnostics',
    description: `Generated by Auto Config: ${gpuRec.why}. ${v.accelOk ? 'Hardware acceleration available.' : 'No hardware acceleration.'}`,
    priority: 5,
    match: {
      platform: [hw.platform || process.platform],
      arch: [hw.arch || process.arch],
      ...(vendor !== 'unknown' ? { gpuVendor: [vendor] } : {}),
      ...(build ? { osBuild: { min: build - 2000, max: build + 2000 } } : {}),
    },
    effect: {
      gpuMode: gpuRec.gpuMode,
      ...(v.accelOk ? {} : { forceTcg: true }),
      notes: [gpuRec.why],
    },
  };

  const bad = items.filter((i) => i.level === 'bad').length;
  const warn = items.filter((i) => i.level === 'warn').length;
  const level = bad ? 'bad' : warn ? 'warn' : 'good';
  const summary = bad
    ? `Found ${bad} issue(s) that must be addressed (${items.filter((i) => i.level === 'bad').map((i) => i.title).join(', ')})`
    : warn
      ? `Found ${warn} recommended optimization(s) (${items.filter((i) => i.level === 'warn').map((i) => i.title).join(', ')})`
      : 'Hardware acceleration ready. System is optimally configured.';

  return {
    level,
    items,
    patch,
    driver,
    recommended: { ...rec, ...gpuRec },
    summary,
  };
}

module.exports = {
  collect,
  evaluate,
  recommendResources,
  recommendGpu,
  psJson,
};
