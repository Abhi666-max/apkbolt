'use strict';
/**
 * / diagnose(configuration)
 *
 * : parameters. 
 * - chooseProfile() memory, CPU, disk, , emulator versionlaunchparameters; 
 * - planVariants() "launchfailurefallback"retry(GPU → → memory → cold boot); 
 * - diagnose() emulator stderr repair; 
 * - shortPath() /installpath(emulator QEMU ASCII path). 
 *
 * + probe, settings,  Android, . 
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { memoryLimits } = require('./resources');

const ASCII = /^[\x20-\x7e]*$/;
const isAsciiPath = (p) => ASCII.test(String(p || ''));

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/** (, ) */
function hostInfo() {
  const totalMB = Math.round(os.totalmem() / 1048576);
  const freeMB = Math.round(os.freemem() / 1048576);
  const cores = Math.max(1, (os.cpus() || []).length || 2);
  const home = os.homedir();
  return {
    platform: process.platform,
    arch: process.arch,
    totalMB,
    freeMB,
    cores,
    home,
    homeAscii: isAsciiPath(home),
    tmp: os.tmpdir(),
    rdp: /RDP/i.test(String(process.env.SESSIONNAME || '')) || !!process.env.CLIENTNAME,
  };
}

/** directoryspace(MB);  0 */
function freeDiskMB(dir) {
  try {
    let d = path.resolve(dir || '.');
    for (let i = 0; i < 6 && !fs.existsSync(d); i += 1) d = path.dirname(d);
    const st = fs.statfsSync(d);
    return Math.floor((st.bavail * st.bsize) / 1048576);
  } catch (_) {
    return 0;
  }
}

function versionNumbers(v) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/**
 * check GPU (NVIDIA / AMD / Intel), . 
 * Windows WMI;  'unknown'. 
 * cache 10 ,  chooseProfile spawn wmic. 
 */
let _gpuVendorCache = { vendor: 'unknown', at: 0 };
function detectGpuVendor() {
  if (process.platform !== 'win32') return 'unknown';
  if (Date.now() - _gpuVendorCache.at < 600000) return _gpuVendorCache.vendor;
  try {
    const { execFileSync } = require('child_process');
    // wmic Win11 24H2+ ,  PowerShell Get-CimInstance
    let names = '';
    try {
      names = execFileSync('powershell.exe', [
        '-NoProfile', '-Command',
        '(Get-CimInstance Win32_VideoController).Name -join "|"',
      ], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    } catch (_) {
      // wmic()
      try {
        names = execFileSync('wmic', ['path', 'win32_videocontroller', 'get', 'name', '/format:list'],
          { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      } catch (__) { /* ignore */ }
    }
    const lower = String(names).toLowerCase();
    let vendor = 'unknown';
    // (NVIDIA/AMD), 
    if (/nvidia|geforce|rtx\s|gtx\s/.test(lower)) vendor = 'nvidia';
    else if (/(?<!virtual\s)(amd|radeon|rx\s\d)/.test(lower)) vendor = 'amd';
    else if (/intel|uhd\s|iris|arc\s/.test(lower)) vendor = 'intel';
    _gpuVendorCache = { vendor, at: Date.now() };
    return vendor;
  } catch (_) {
    _gpuVendorCache = { vendor: 'unknown', at: Date.now() };
    return 'unknown';
  }
}

/**
 * emulator 36.4.9 swiftshader_indirect ,  -gpu software. 
 * 37.x swiftshader_indirect GL failure/exit(). 
 * version, . 
 *
 * GPU : 
 * NVIDIA: host (driver), swangle fallback
 * AMD: host driver(driver), swangle 
 * Intel: host OK,  swangle 
 * unknown: default
 */
function gpuCandidates(emulatorVersion) {
  const [major, minor, patch] = versionNumbers(emulatorVersion);
  const modern = major > 36 || (major === 36 && (minor > 4 || (minor === 4 && patch >= 9)));
  const base = modern
    ? ['host', 'swangle', 'software', 'swiftshader']
    : ['host', 'swiftshader_indirect', 'swiftshader'];
  const vendor = detectGpuVendor();
  if (vendor === 'amd' && modern) {
    // AMD driverversion host GL failure,  swangle
    return ['swangle', 'host', 'software', 'swiftshader'];
  }
  return base;
}

/** Windows 8.3 path:  / installdirectory emulator */
/**
 * . landscape=true landscape(1280x720). 
 *
 * runtime wm size: emulator LCD "", 
 * Qt window. runtime wm size Android 
 * ,  -- 90°, , 
 * , .  hw.lcd.width/height landscaperestart, 
 * " + "landscape. 
 */
function lcdFor({ accelOk = true, crisp = true, landscape = false } = {}) {
  const base = accelOk && crisp ? { w: 720, h: 1280, dpi: 320 } : { w: 540, h: 960, dpi: 240 };
  return landscape ? { w: base.h, h: base.w, dpi: base.dpi } : base;
}

function shortPath(p) {
  if (process.platform !== 'win32' || !p || isAsciiPath(p)) return p;
  try {
    const out = execFileSync('cmd.exe', ['/d', '/s', '/c', `for %I in ("${p}") do @echo %~sI`], {
      encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop();
    if (line && isAsciiPath(line) && fs.existsSync(line)) return line;
  } catch (_) { /* 8.3 path */ }
  return p;
}

/**
 * configurationlaunchparameters. 
 * settings engine.memoryMB / cores / gpuMode, /, 
 * "settings" 4G/4 memory. 
 */
/**
 * "":  -- vCPU . 
 *
 * 16 4 , qemu 4 vCPU , 
 * Windows desktop, mouse, , "". 
 * Android App 2 vCPU , . 
 *
 * memory, : memory 2~3G,  quickboot
 * snapshot, cold boot, . 
 *
 * , settings null null(/). 
 */
function liteProfile({ host = hostInfo(), engine = {} } = {}) {
  if (engine && engine.liteMode === false) return null;
  const cores = engine && engine.resourceMode === 'save'
    ? 2
    // floor(cores/4) 2~3 -- 8 2 vCPU, 
    // (/). ",  4": 
    // 8 4, 4 2, desktop, . 
    : clamp(Math.floor((host.cores || 2) / 2), 2, 4);
  return { cores, priority: 'below' };
}

function chooseProfile({
  host = hostInfo(), accel, emulatorVersion = '', diskMB = 0,
  port = 5554, adbPort = 5044, overrides = {}, settings = null,
} = {}) {
  const accelOk = !!(accel && accel.ok);
  // 3GB Android 14 app; memory quickboot snapshot
  let memoryMB = clamp(Math.floor((host.totalMB * 0.22) / 256) * 256, 2048, 3072);
  // "": / 3G,  2G. 
  // qemu residentmemory 1GB, quickboot snapshot 1GB(disk). 
  // memory, . 
  const rmode = settings && settings.engine && settings.engine.resourceMode;
  if (rmode === 'save' && !overrides.memoryMB) {
    memoryMB = clamp(memoryMB, 2048, 2048);
  }
  // memory; Android 14 2G,  TCG
  if (host.freeMB && host.freeMB < memoryMB + 1024) {
    memoryMB = Math.max(2048, Math.floor((host.freeMB * 0.5) / 256) * 256);
  }
  if (overrides.memoryMB) {
    // :  8192,  32GB 8GB, 
    // ()reclaim, stutter/black screen. 
    const lim = memoryLimits(host.totalMB);
    memoryMB = clamp(Number(overrides.memoryMB) || memoryMB, 1536, lim.maxMB);
  }

  let cores = clamp(Math.floor(host.cores / 2), 2, 4);
  if (overrides.cores) {
    // :  1 Windows,  1
    const maxCores = Math.max(1, (host.cores || 1) - 1);
    cores = clamp(Number(overrides.cores) || cores, 1, maxCores);
  }
  // cores, 
  const lite = settings ? liteProfile({ host, engine: settings.engine || {} }) : null;
  if (lite && !overrides.cores) cores = Math.min(cores, lite.cores);

  const disk = diskMB || freeDiskMB(host.tmp);
  // /data capacity: app, "update", 4GB
  // (appupdatehint"diskspace"). defaultdisk 6/8GB, 
  // settings(boot, ). 
  const wantGB = Number((settings && settings.engine && settings.engine.dataPartitionGB) || 0);
  // disk: 50GB 90GB,  16GB , 
  // "space". 
  const autoDataMB = disk && disk < 12288 ? 4096 : (disk && disk > 262144 ? 16384 : 6144);
  // "disk 80%":  128GB 20GB, failure
  const dataMaxMB = disk ? Math.max(2048, Math.floor((disk * 0.8) / 1024) * 1024) : 262144;
  const dataMB = wantGB > 0
    ? clamp(Math.round(wantGB * 1024), 2048, Math.min(262144, dataMaxMB))
    : autoDataMB;

  const gpus = gpuCandidates(emulatorVersion);
  const gpu = overrides.gpuMode && gpus.includes(overrides.gpuMode) ? overrides.gpuMode : gpus[0];

  // : auto (software emulation 540x960 )
  // landscape: landscape"",  AVD restart, 
  // settings.display.landscape orientation,  renderSize. 
  const wantLandscape = !!(settings && settings.display && settings.display.landscape);
  const wantLcd = String((settings && settings.engine && settings.engine.renderSize) || 'auto');
  const lcd = /^\d{3,4}x\d{3,4}$/.test(wantLcd)
    ? (() => {
      const [w0, h0] = wantLcd.split('x').map(Number);
      // orientation, orientation(landscape)
      const long = Math.max(w0, h0);
      const short = Math.min(w0, h0);
      const w = wantLandscape ? long : short;
      const h = wantLandscape ? short : long;
      return { w, h, dpi: short <= 540 ? 240 : (short <= 720 ? 320 : 420) };
    })()
    : lcdFor({ accelOk, landscape: wantLandscape });

  return {
    memoryMB,
    cores,
    heapMB: memoryMB >= 3072 ? 384 : 256,
    dataMB,
    lcd,
    gpu,
    gpuCandidates: gpus,
    accel: accelOk ? 'auto' : 'off',
    accelOk,
    port,
    adbPort,
    snapshot: true,
    lite: !!lite,
    // software emulation Windows ,  Android 14 cold boot 5-10
    bootTimeoutMs: accelOk ? 240000 : 600000,
    emulatorVersion,
    host,
  };
}

/**
 * "parameters"settings overrides. 
 * 0 / auto / settings"", ; 
 * memory. 
 */
function overridesFromSettings(engine = {}) {
  const e = engine || {};
  const manual = e.autoMemory === false;
  return {
    memoryMB: manual ? Number(e.memoryMB) || 0 : 0,
    cores: manual ? Number(e.cores) || 0 : 0,
    gpuMode: e.gpuMode && e.gpuMode !== 'auto' ? e.gpuMode : '',
  };
}

/**
 * / diagnose: launch Android bootparameters. 
 * settings chooseProfile()(version),  37.x 
 * error swiftshader_indirect / software emulation, parameters. 
 */
function autoProfile({ settings = {}, accel, emulatorVersion = '', diskMB = 0, port = 5554, adbPort = 5044, host = null } = {}) {
  return chooseProfile({
    // host : /diagnose"4 ". 
    // (runtimepath). 
    host: host || hostInfo(),
    accel, emulatorVersion, diskMB, port, adbPort, settings,
    overrides: overridesFromSettings(settings && settings.engine),
  });
}

/**
 * failureretry: """",  4 . 
 * GPU → hardware acceleration TCG → memorycold bootsnapshot. 
 */
function planVariants(profile) {
  const out = [];
  const gpus = profile.gpuCandidates || [];
  const firstGpu = profile.gpu || gpus[0] || 'software';
  const safeGpu = gpus.find((g) => /software|swiftshader/.test(g)) || firstGpu;
  const ordered = [firstGpu, ...gpus.filter((g) => g !== firstGpu && /swiftshader|swangle/.test(g))].slice(0, 2);
  for (const gpu of ordered) {
    out.push({ ...profile, gpu, label: `${gpu} / ${profile.accel === 'auto' ? 'Hardware Accel' : 'Software Mode'}`, wipe: false, snapshot: true });
  }
  out.push({
    ...profile,
    gpu: safeGpu,
    accel: 'off',
    label: 'Software simulation without acceleration (slow, max compatibility)',
    wipe: false,
    snapshot: true,
  });
  out.push({
    ...profile,
    gpu: safeGpu,
    accel: 'off',
    memoryMB: 2048,
    cores: 2,
    dataMB: Math.min(profile.dataMB, 2048),
    label: 'Conservative cold boot (minimal RAM + clear snapshot)',
    // **** wipe:  wipe:true, diskfailure, 
    // retryapp"snapshot + " --
    // "disk,  ApkBolt app". 
    // userdata ensureDataPartition (system image), 
    // launchparameters -wipe-data. 
    wipe: false,
    snapshot: false,
    lastResort: true,
  });
  // ( gpu/accel/wipe )--"": 
  // "snapshot", memoryparameters. 
  const seen = new Set();
  return out.filter((v) => {
    const k = `${v.gpu}|${v.accel}|${!!v.wipe}|${v.memoryMB}|${v.snapshot !== false ? 'snap' : 'nosnap'}|${v.lastResort ? 'last' : ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** check(emulator console + adb /) */
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function freePortPair(start = 5554) {
  for (let p = start; p <= start + 40; p += 2) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(p) && await isPortFree(p + 1)) return p;
  }
  return start;
}

/**
 * adb server : probe. 
 * " 5044 ",  adb server resident, , 
 * launch ApkBolt adb server( 6 ), 
 * , launchemulator. 
 * 5044 ApkBolt ( adb 5037), . 
 */
async function freeAdbPort(start = 5044) {
  return Number(process.env.APKBOLT_ADB_PORT) || start;
}

/**
 * configuration: "system image / data partition / version"snapshot. 
 * GPU, , memory -- retryparameters, 
 * retry -wipe-data, app. 
 */
/**
 * quickboot snapshot"configuration": snapshot(black screen/). 
 *
 * ** dataMB**: data partitionsnapshot(qemu 
 * ), ", snapshot + cold boot +
 * "-- , app. 
 */
function snapshotKey(plan, imageDir) {
  return crypto.createHash('sha1').update([
    imageIdentity(imageDir), plan.emulatorVersion || '', plan.api || '', plan.tag || '',
  ].join('|')).digest('hex').slice(0, 16);
}

/**
 * system image"":  `system-images/...` . 
 *
 * system image, system imagedirectory"system image"--
 * runtime C D (settings), 
 * AVD sysdir path → system image → -wipe-data → app. 
 * , (AVD configuration, snapshot)path. 
 */
function imageIdentity(dir) {
  const p = String(dir || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const i = p.indexOf('system-images/');
  if (i >= 0) return p.slice(i);
  return p.split('/').slice(-3).join('/');
}

const RULES = [
  {
    code: 'ACCESS_VIOLATION',
    // Windows emulator/qemu 0xC0000005( 3221225477)exit: 
    // "driver / Vulkan guest launch", 
    // CPU, memory, system image( -gpu software ). 
    // GPU_INIT : log, . 
    re: /emulator exit 3221225477|exit code 3221225477|0xC0000005|STATUS_ACCESS_VIOLATION/i,
    title: 'Renderer backend crash (0xC0000005 Access Violation)',
    hint: 'Switched to conservative renderer backend. This selection is saved.'
      + 'If this persists, update GPU drivers or lower render settings in Settings → Performance.',
  },
  {
    code: 'GPU_INIT',
    // "failure": log Vulkan/EGL/ANGLE , error
    re: /Failed to initialize GL emulation|Could not initialize (OpenGL|emulated framebuffer)|Failed to create .*GLES|EGL_(BAD|NOT_INITIALIZED|CONTEXT_LOST)|Failed to (load|initialize) .*vulkan|vulkan.*(failed|error)|ANGLE.*(fail|error)/i,
    title: 'GPU renderer backend initialization failed',
    hint: 'Switched to software rendering. If issue persists, please update graphics drivers.',
  },
  {
    code: 'GPU_MODE',
    re: /Unknown option|invalid .*-gpu|Unrecognized .*gpu|Unsupported gpu/i,
    title: 'Current runtime does not support this GPU mode',
    hint: 'Auto-selected compatible GPU mode for this runtime version.',
  },
  {
    code: 'ACCEL',
    re: /x86_64 emulation currently requires hardware acceleration|acceleration.*not (installed|available|supported)|WHPX.*(not|failed)|AEHD.*(not|failed)|ERROR_ACCESS_DENIED/i,
    title: 'Hardware acceleration unavailable',
    hint: 'Fell back to software mode (slow boot). Enable Hypervisor Platform in Windows Features for full speed.',
  },
  {
    code: 'MEMORY',
    re: /Cannot allocate memory|not enough memory|commit charge|Failed to allocate|out of memory/i,
    title: 'Memory allocation failed',
    hint: 'Lowered RAM and CPU allocation for Android. Please close memory-heavy apps.',
  },
  {
    code: 'PORT_BUSY',
    re: /port.*(in use|busy)|Address already in use|bind.*failed|Failed to (setup|bind) .*console/i,
    title: 'Emulator port in use',
    hint: 'Auto-selected free port. Close conflicting third-party emulators if issue persists.',
  },
  {
    code: 'AVD_LOCK',
    re: /already running|lock file|\.lock|AVD is in use|emulator is running/i,
    title: 'Leftover lock files from previous run',
    hint: 'Cleaned AVD lock files and restarted.',
  },
  {
    code: 'IMAGE',
    re: /system\.img.*(missing|not found|corrupt)|kernel-ranchu.*(missing|not found)|invalid magic|Failed to open .*\.img|APEX.*(fail|error|loop)|boot loop|verity.*fail/i,
    title: 'System image missing, corrupted, or incompatible with old data',
    hint: 'Rebooted with clean user data. Re-download image in Settings if issue persists.',
  },
  {
    code: 'DLL',
    re: /0xc0000135|STATUS_DLL_NOT_FOUND|missing DLL|Qt6.*not found|MSVCP140|VCRUNTIME|The code execution cannot proceed/i,
    // 0xC0000135 " DLL success", : 
    // (MSIX) WindowsApps directoryDLL , 
    // VC++ , runtime, . 
    // " / VC++"exit, . 
    // DLL WER FaultingModuleName; "". 
    title: 'Runtime DLL dependency failed to load',
    hint: 'Common causes: missing Visual C++ runtime or antivirus quarantine.'
      + 'Please refer to the User Guide for detailed diagnostic steps.',
  },
  {
    code: 'DISK_FULL',
    re: /No space left|disk full|not enough space/i,
    title: 'Insufficient disk space to start Android',
    hint: 'Move the runtime directory to a disk with sufficient free space,'
      + 'or disable fast-boot snapshots in Settings. Android data will be preserved.',
  },
  {
    code: 'NON_ASCII',
    re: /Unicode|non-ASCII|cannot find the path/i,
    title: 'Installation path contains non-ASCII characters',
    hint: 'Using 8.3 short paths. Move ApkBolt to an ASCII path if issue persists.',
  },
  {
    // AVD directory hardware-qemu.ini.lock / multiinstance.lock, 
    // emulatorlaunch,  CPU .  CPU . 
    code: 'AVD_LOCK',
    re: /Running multiple emulators with the same AVD|AVD .*is already running|hardware-qemu\.ini\.lock/i,
    title: 'Previous run did not exit cleanly, lock files remain',
    hint: 'ApkBolt cleared leftover locks and retried. Verify no other emulator is using the runtime.',
  },
  {
    code: 'CPU_FEATURE',
    re: /host doesn't support requested feature|CPUID.*not supported|unsupported CPU|missing.*(AVX|SSE4|xsave)/i,
    title: 'CPU missing required instruction set',
    hint: 'Instruction set warning. If boot fails, check virtualization support in BIOS.',
  },

  {
    code: 'SNAPSHOT',
    re: /snapshot|Quick Boot|ram\.img|Saving state/i,
    title: 'Fast-boot snapshot corrupted',
    hint: 'Discarded corrupted snapshot and performed cold boot. Clean snapshot will be generated on exit.',
  },
];

/** log {code,title,hint},  UI retry */
function diagnose(lines) {
  const text = (Array.isArray(lines) ? lines.join('\n') : String(lines || '')).slice(-24000);
  for (const r of RULES) {
    if (r.re.test(text)) return { code: r.code, title: r.title, hint: r.hint };
  }
  return {
    code: 'UNKNOWN',
    title: 'Runtime failed to complete boot',
    hint: 'Retried with fallback parameters. You can export a diagnostic report in Settings.',
  };
}

/** , settings */
function describeProfile(p) {
  return `Auto: ${(p.memoryMB / 1024).toFixed(1)}GB RAM  -  ${p.cores} cores  -  ${p.gpu} render  -  `
    + `${p.accelOk ? 'Hardware Accel' : 'Software Mode'}  -  ${p.snapshot ? 'Snapshots' : 'Cold Boot'}`
    + `${p.lite ? '  -  Lightweight' : ''}  -  Port ${p.port}`;
}

/** diagnose(, / issue) */
function writeReport({ dataDir, profile, logLines = [], extra = {} }) {
  const dir = path.join(dataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `diagnostic-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
  const d = diagnose(logLines);
  const body = [
    'ApkBolt Diagnostics Report',
    `Generated at: ${new Date().toLocaleString()}`,
    '',
    '== Host Machine ==',
    JSON.stringify(hostInfo(), null, 2),
    '',
    '== Auto Configuration ==',
    JSON.stringify(profile || {}, null, 2),
    describeProfile(profile || chooseProfile()),
    '',
    '== Diagnostics ==',
    `${d.code}: ${d.title}`,
    d.hint,
    '',
    '== Additional Info ==',
    JSON.stringify(extra, null, 2),
    '',
    '== Runtime Log (last 300 lines) ==',
    ...(Array.isArray(logLines) ? logLines.slice(-300) : String(logLines || '').split('\n')),
  ].join('\n');
  fs.writeFileSync(file, body, 'utf8');
  return { file, diagnosis: d };
}

/**
 * check VC++ 2015-2022 x64 install. 
 * Androidemulator(Qt6) qemu ; ""
 * ( 0xc0000135 / MSVCP140 ). install vc_redist.x64.exe, 
 * check, launchhintinstall. 
 */
function vcRedistOk() {
  if (process.platform !== 'win32') return true;
  // DLL: msvcp140 / vcruntime140 Qt6 qemu . 
  // reg.exe(,  60s ), 
  // clean"". 
  const sys = path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32');
  try {
    if (fs.existsSync(path.join(sys, 'msvcp140.dll'))
      && fs.existsSync(path.join(sys, 'vcruntime140.dll'))) return true;
  } catch (_) { /* fallback */ }

  const key = 'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64';
  for (const k of [key, key.replace('SOFTWARE\\', 'SOFTWARE\\WOW6432Node\\')]) {
    try {
      const out = execFileSync('reg', ['query', k, '/v', 'Installed'],
        { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      if (/Installed\s+REG_DWORD\s+0x1/i.test(out)) return true;
    } catch (_) { /* = */ }
  }
  return false;
}

module.exports = {
  hostInfo, freeDiskMB, isAsciiPath, shortPath, lcdFor, liteProfile,
  versionNumbers, gpuCandidates, detectGpuVendor, chooseProfile, planVariants,
  overridesFromSettings, autoProfile,
  freePortPair, freeAdbPort, snapshotKey, imageIdentity,
  diagnose, describeProfile, writeReport, vcRedistOk,
};
