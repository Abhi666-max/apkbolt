'use strict';
/**
 * (memory / CPU / ). 
 *
 * : "Androidmemory" qemu (-memory / -cores), 
 * boot; """", 
 * electron, CI require . 
 *
 * (): 
 * 1. memory: Windows + 25%, , 
 * Androidblack screen, , "emulator". 
 * 2. "install × 1.8 + 2GB": 50GB 80~90GB, 
 * install, failure. 
 * 3. : default,  NaN. 
 */

const DEFAULT_STEP_MB = 512;
const MIN_MEM_MB = 1024;
/** (Windows + ) */
const HOST_RESERVE_RATIO = 0.25;
/** hint"" */
const TIGHT_RATIO = 0.8;
/** () */
const ABSOLUTE_MIN_MB = 768;

function toInt(v, fallback = 0) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * . parameters, ; . 
 * @returns {{ totalMB:number, cores:number }}
 */
function hostProfile(sys) {
  let totalMB = 0;
  let cores = 0;
  const src = sys || {};
  if (Number(src.totalMB) > 0) {
    totalMB = toInt(src.totalMB);
  } else if (Number(src.totalmem) > 0) {
    totalMB = Math.round(Number(src.totalmem) / 1048576);
  } else {
    try {
      // require('os') : 
      const os = require('os');
      totalMB = Math.round(os.totalmem() / 1048576);
      cores = os.cpus() ? os.cpus().length : 0;
    } catch (_) { totalMB = 0; }
  }
  if (Number(src.cores) > 0) cores = toInt(src.cores);
  return { totalMB, cores: Math.max(1, cores || 1) };
}

/**
 * memory. memory,  0. 
 * @returns {{ minMB:number, maxMB:number, stepMB:number, totalMB:number }}
 */
function memoryLimits(totalMB) {
  const total = toInt(totalMB);
  if (total <= 0) return { minMB: MIN_MEM_MB, maxMB: 8192, stepMB: DEFAULT_STEP_MB, totalMB: 0 };
  const usable = Math.floor((total * (1 - HOST_RESERVE_RATIO)) / DEFAULT_STEP_MB) * DEFAULT_STEP_MB;
  const maxMB = Math.max(MIN_MEM_MB, Math.min(usable, 65536));
  return { minMB: MIN_MEM_MB, maxMB, stepMB: DEFAULT_STEP_MB, totalMB: total };
}

/**
 * memory. 0 = ,  0(). 
 * @returns {{ mb:number, capped:boolean, reason:string }}
 */
function clampMemoryMB(mb, totalMB) {
  const want = toInt(mb);
  if (want <= 0) return { mb: 0, capped: false, reason: 'auto' };
  const lim = memoryLimits(totalMB);
  const rounded = Math.round(want / lim.stepMB) * lim.stepMB;
  if (rounded > lim.maxMB) {
    return {
      mb: lim.maxMB,
      capped: true,
      reason: `Host memory is ${Math.round(lim.totalMB / 1024)} GB; maximum allocation is ${Math.round(lim.maxMB / 1024)} GB (25% reserved for Windows)`,
    };
  }
  if (rounded < lim.minMB) return { mb: lim.minMB, capped: true, reason: `Android requires at least ${lim.minMB} MB to start` };
  return { mb: rounded, capped: rounded !== want, reason: rounded !== want ? 'Aligned to 512 MB boundary' : '' };
}

/**
 * CPU . 0 = . 
 * " - 1",  1 ;  1 . 
 */
function clampCores(n, hostCores) {
  const want = toInt(n);
  const total = Math.max(1, toInt(hostCores) || 1);
  const max = total > 1 ? total - 1 : 1;
  if (want <= 0) return { cores: 0, capped: false, reason: 'auto' };
  if (want > max) {
    return { cores: max, capped: true, reason: `This machine has ${total} cores; maximum allocation is ${max} (1 reserved for Windows)` };
  }
  return { cores: Math.max(1, want), capped: false, reason: '' };
}

/**
 * memory(hint + ). 
 * @returns {{ level:'ok'|'tight'|'insufficient'|'unknown', ratio:number, note:string }}
 */
function memVerdict(allocMB, hostMB) {
  const alloc = toInt(allocMB);
  const host = toInt(hostMB);
  if (!alloc || !host) return { level: 'unknown', ratio: 0, note: '' };
  if (alloc < ABSOLUTE_MIN_MB) {
    return { level: 'insufficient', ratio: alloc / host, note: `Only ${alloc} MB allocated - Android may not start` };
  }
  const ratio = alloc / host;
  if (ratio > 1 - HOST_RESERVE_RATIO) {
    return {
      level: 'insufficient',
      ratio,
      note: `Using ${Math.round(ratio * 100)}% of host memory - Windows will start paging and the emulator will slow down`,
    };
  }
  if (ratio > TIGHT_RATIO * (1 - HOST_RESERVE_RATIO)) {
    return { level: 'tight', ratio, note: `Using ${Math.round(ratio * 100)}% of host memory - consider closing browser tabs` };
  }
  return { level: 'ok', ratio, note: '' };
}

/** installdata partitionspace(update) */
function diskRequiredMB(packageBytes, ratio = 1.8, reserveMB = 2048) {
  const bytes = Math.max(0, Number(packageBytes) || 0);
  if (!bytes) return reserveMB;
  return Math.ceil((bytes / 1048576) * ratio) + reserveMB;
}

/**
 * data partition. disk 64GB failure. 
 * @returns {{ maxGB:number, warnGB:number, freeMB:number }}
 */
function diskLimits(freeMB) {
  const free = Math.max(0, toInt(freeMB));
  // system imagespace(system image),  20%
  const maxGB = Math.max(0, Math.floor((free / 1024) * 0.8));
  return { maxGB, warnGB: Math.max(0, maxGB - 8), freeMB: free };
}

/**
 * data partition(GB). 0 = . 
 * @returns {{ gb:number, capped:boolean, reason:string }}
 */
function clampDataGB(gb, freeMB) {
  const want = toInt(gb);
  if (want <= 0) return { gb: 0, capped: false, reason: 'auto' };
  const lim = diskLimits(freeMB);
  if (!lim.freeMB) return { gb: want, capped: false, reason: '' };
  if (want > lim.maxGB) {
    return {
      gb: Math.max(0, lim.maxGB),
      capped: true,
      reason: `The drive has only ${(lim.freeMB / 1024).toFixed(1)} GB free; maximum partition size is ${lim.maxGB} GB`,
    };
  }
  return { gb: want, capped: false, reason: '' };
}

/**
 * . 
 * @returns {{ ok:boolean, needMB:number, freeMB:number, shortMB:number, note:string }}
 */
function storageVerdict(freeMB, packageBytes) {
  const need = diskRequiredMB(packageBytes);
  const free = Math.max(0, toInt(freeMB));
  if (!free) return { ok: true, needMB: need, freeMB: 0, shortMB: 0, note: 'Could not read available disk space; skipping pre-check' };
  if (free >= need) return { ok: true, needMB: need, freeMB: free, shortMB: 0, note: '' };
  const short = need - free;
  return {
    ok: false,
    needMB: need,
    freeMB: free,
    shortMB: short,
    note: `Requires ~${(need / 1024).toFixed(1)} GB, but only ${(free / 1024).toFixed(1)} GB available (short by ${(short / 1024).toFixed(1)} GB)`,
  };
}

/**
 * diskspace(50GB failure). 
 * storageVerdict : "", install. 
 * @returns {{ ok:boolean, unknown?:boolean, freeMB:number, requiredMB:number, message:string }}
 */
function diskVerdict(freeMB, requiredMB) {
  const free = Math.max(0, toInt(freeMB));
  const need = Math.max(0, toInt(requiredMB));
  if (!free) return { ok: true, unknown: true, freeMB: 0, requiredMB: need, message: '' };
  if (free >= need) return { ok: true, freeMB: free, requiredMB: need, message: '' };
  return {
    ok: false,
    freeMB: free,
    requiredMB: need,
    message: `Insufficient disk space: requires ~${Math.ceil(need / 1024)} GB, but the drive containing the ApkBolt runtime only has ${(free / 1024).toFixed(1)} GB free. ` + 'Move the runtime directory to a larger drive in Settings, or free up space and try again.',
  };
}

module.exports = {
  DEFAULT_STEP_MB,
  MIN_MEM_MB,
  HOST_RESERVE_RATIO,
  hostProfile,
  memoryLimits,
  clampMemoryMB,
  clampCores,
  memVerdict,
  diskRequiredMB,
  diskVerdict,
  diskLimits,
  clampDataGB,
  storageVerdict,
};
