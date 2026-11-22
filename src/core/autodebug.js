'use strict';
/**
 * check( debug)
 *
 * , : 
 * 1) (src/core/autodebug-probe.js, ): snapshot obs; 
 * 2) (, ): evaluate(obs) → issues[]. 
 *
 * fs / child_process / electron, CI require 
 * ( 2026-11-17: CI require electron ). 
 * directory manual.js(), guide. 
 *
 * : obs "", probefailure. 
 * -- "check", 
 * check. 
 */

const manual = require('./manual');

/** (settings) */
const CATEGORIES = [
  { id: 'runtime', name: 'Runtime', hint: 'Android VM process, boot phase, snapshots and residual locks' },
  { id: 'device', name: 'Device Connection', hint: 'adb authorization status, online state' },
  { id: 'storage', name: 'Storage', hint: 'Disk free space, data partition, shared directory' },
  { id: 'settings', name: 'Settings', hint: 'Configuration conflicts' },
  { id: 'network', name: 'Network', hint: 'Android network and download source connectivity' },
  { id: 'logs', name: 'Logs', hint: 'Errors found in runtime logs' },
];

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/** :  */
const SEVERITY_RANK = { error: 3, warn: 2, info: 1 };

/** ,  UI */
function normalise(raw) {
  if (!raw || !raw.code) return null;
  const severity = SEVERITY_RANK[raw.severity] ? raw.severity : 'info';
  const item = {
    code: String(raw.code),
    category: CATEGORY_IDS.includes(raw.category) ? raw.category : 'runtime',
    severity,
    title: String(raw.title || raw.code),
    hint: String(raw.hint || ''),
    // fix "repair", ; 
    fix: raw.fix || '',
    // detail (path, ), 
    detail: raw.detail === undefined || raw.detail === null ? '' : String(raw.detail),
  };
  // 0.6.2: "guide", 
  item.help = manual.topicForIssue(item);
  return item;
}

/**
 * : snapshot
 * @param {object} obs snapshot()
 * @returns {Array<object>} 
 */
function evaluate(obs) {
  const o = obs || {};
  const runtime = o.runtime || {};
  const device = o.device || {};
  const storage = o.storage || {};
  const settings = o.settings || {};
  const network = o.network || {};
  const logs = o.logs || {};
  const accel = o.accel || {};
  const out = [];

  const push = (raw) => {
    const it = normalise(raw);
    if (it) out.push(it);
  };

 /* ---------------- runtime ---------------- */

  // bootfailure: , 
  const bootError = runtime.error || (runtime.lastFailure && runtime.lastFailure.error) || '';
  if (bootError) {
    push({
      code: 'runtime.bootFailed',
      category: 'runtime',
      severity: 'error',
      title: 'Android runtime startup failed previously',
      hint: 'Diagnostic error captured. Resolving this issue usually restores runtime.',
      detail: bootError,
      fix: 'restartRuntime',
    });
  }

  // :  ready, snapshotsystem image
  if (runtime.running && runtime.phase && runtime.phase !== 'ready' && runtime.bootMs > 150000) {
    push({
      code: 'runtime.stuckBoot',
      category: 'runtime',
      severity: 'warn',
      title: 'Android boot stuck in boot phase',
      hint: 'Booting took longer than 2.5 minutes. Common cause is a corrupt snapshot. Restarting the engine (cold boot) usually resolves this.',
      detail: `Phase: ${runtime.phase}`, 
      fix: 'restartRuntime',
    });
  }

  // lock file: launch"AVD " FATAL
  if (Number(runtime.locks) > 0) {
    push({
      code: 'runtime.staleLocks',
      category: 'runtime',
      severity: 'warn',
      title: `Detected ${runtime.locks} leftover lock file(s)`, 
      hint: 'Residual lock files cause the next boot to fail with "AVD in use". Click Fix to remove them.', 
      fix: 'lock',
    });
  }

  // : emulator.exe launch, qemu detached , 
  // launch multiinstance.lock( 2026-11-13). 
  if (Number(runtime.orphans) > 0) {
    push({
      code: 'runtime.orphanProcesses',
      category: 'runtime',
      severity: 'warn',
      title: `${runtime.orphans} orphan emulator process(es) detected`, 
      hint: 'Uncleanly shut down processes are holding locks. Click Fix to terminate them safely without affecting your data.', 
      fix: 'orphans',
    });
  }

  // snapshot: verify, boot"failurecold boot",  GB
  if (runtime.snapshotStale) {
    push({
      code: 'runtime.staleSnapshot',
      category: 'runtime',
      severity: 'warn',
      title: 'Fast-boot snapshot corrupted',
      hint: 'Snapshot file failed verification. Deleting it reclaims disk space and creates a clean snapshot.', 
      fix: 'snapshots',
    });
  }

 /* ---------------- ---------------- */

  // unauthorized: Android" USB "( 2026-11-17 )
  if (device.state === 'unauthorized') {
    push({
      code: 'device.unauthorized',
      category: 'device',
      severity: 'error',
      title: 'Android device unauthorized',
      hint: 'USB debugging authorization prompt was missed. Restarting the engine will re-prompt for authorization.', 
      fix: 'restartRuntime',
    });
  } else if (device.state === 'offline') {
    push({
      code: 'device.offline',
      category: 'device',
      severity: 'warn',
      title: 'Android device is offline',
      hint: 'adb sees the device but cannot connect. Wait a moment or restart the engine if it persists.', 
      fix: 'restartRuntime',
    });
  } else if (runtime.running && device.checked && device.state === 'no-device') {
    push({
      code: 'device.missing',
      category: 'device',
      severity: 'warn',
      title: 'Runtime running but adb cannot find device',
      hint: 'The Android process is active but adb cannot locate it. Common reason is port conflict or incomplete boot.', 
      fix: 'restartRuntime',
    });
  }

 /* ---------------- ---------------- */

  const freeMB = Number(storage.freeMB) || 0;
  if (freeMB > 0 && freeMB < 2048) {
    push({
      code: 'storage.diskCritical',
      category: 'storage',
      severity: 'error',
      title: 'Runtime disk space critically low',
      hint: 'Less than 2 GB remaining. Installing apps or saving snapshots will fail. Click Clean to reclaim space.', 
      detail: `Free: ${freeMB} MB`, 
      fix: 'disk',
    });
  } else if (freeMB > 0 && freeMB < 8192) {
    push({
      code: 'storage.diskLow',
      category: 'storage',
      severity: 'warn',
      title: 'Runtime disk space running low',
      hint: 'Less than 8 GB remaining. We recommend cleaning up old snapshots and temporary files.', 
      detail: `Free: ${freeMB} MB`, 
      fix: 'disk',
    });
  }

  // data partitioncapacityconfiguration → hint"space"
  if (storage.needsReset) {
    push({
      code: 'storage.dataNeedsReset',
      category: 'storage',
      severity: 'warn',
      title: 'Data partition resize not applied',
      hint: 'Overlay disk prevented in-place expansion. Reset Android Data to recreate the partition with full capacity.', 
      detail: `Configured ${storage.configuredGB} GB  -  Actual ${storage.actualGB} GB`, 
      fix: 'dataReset',
    });
  } else if (Number(storage.configuredGB) > 0 && Number(storage.actualGB) > 0
    && Number(storage.configuredGB) > Number(storage.actualGB)) {
    push({
      code: 'storage.dataMismatch',
      category: 'storage',
      severity: 'error',
      title: 'Android data partition smaller than configured',
      hint: 'Actual available storage is less than configured. Expand partition size in Settings if needed.', 
      detail: `Configured ${storage.configuredGB} GB  -  Actual ${storage.actualGB} GB`, 
      fix: 'dataReset',
    });
  }

  if (storage.sharedOk === false) {
    push({
      code: 'storage.sharedBroken',
      category: 'storage',
      severity: 'warn',
      title: 'Shared folder unavailable',
      hint: 'The shared folder does not exist or lacks write permissions. Please select a valid folder.', 
      detail: storage.sharedPath || '',
      fix: 'shared',
    });
  }

 /* ---------------- settings ---------------- */

  // orientation → Androidapp( 2026-11-18 )
  const mode = String(settings.orientationMode || 'auto');
  if (mode === 'portrait' && settings.landscape === true) {
    push({
      code: 'settings.orientationConflict',
      category: 'settings',
      severity: 'warn',
      title: 'Screen orientation mismatch',
      hint: 'Display policy is portrait but physical panel is landscape. Rotate orientation in Settings.', 
      fix: 'orientation',
    });
  } else if (mode === 'landscape' && settings.landscape === false) {
    push({
      code: 'settings.orientationConflict',
      category: 'settings',
      severity: 'warn',
      title: 'Screen orientation mismatch',
      hint: 'Display policy is landscape but physical panel is portrait. Rotate orientation in Settings.', 
      fix: 'orientation',
    });
  }

  if (settings.windowEmbed === false && settings.autoFullscreen) {
    push({
      code: 'settings.detachedFullscreen',
      category: 'settings',
      severity: 'info',
      title: 'Auto-fullscreen not applicable in native window mode',
      hint: 'Native window mode handles display directly. Press F11 in window or switch to embedded mode in Settings.', 
    });
  }

  if (settings.keepSnapshot === false && freeMB > 0 && freeMB < 4096) {
    push({
      code: 'settings.snapshotOffLowDisk',
      category: 'settings',
      severity: 'info',
      title: 'Low disk space: fast-boot snapshots disabled',
      hint: 'Free space is under 4 GB. Opening apps will take a cold boot. Enable snapshots once disk space is freed.', 
      fix: 'settings',
    });
  }

 /* ---------------- ---------------- */

  // 0.6.2 : "app", , 
  // (-no-audio) Windows Audio . 
  const audio = o.audio || {};
  if (audio.checked && audio.enabled === false) {
    push({
      code: 'audio.disabled',
      category: 'settings',
      severity: 'warn',
      title: 'Android audio disabled in settings',
      hint: 'The runtime was launched with audio disabled. Click Fix to re-enable sound and restart the engine.', 
      fix: 'audio',
    });
  }
  if (audio.checked && audio.serviceRunning === false) {
    push({
      code: 'audio.windowsServiceStopped',
      category: 'settings',
      severity: 'warn',
      title: 'Windows Audio service (Audiosrv) is not running',
      hint: 'System audio service is stopped. Open services.msc and start Windows Audio, or run net start Audiosrv.', 
      fix: 'audioService',
    });
  }

 /* ---------------- network ---------------- */

  if (network.ok === false) {
    push({
      code: 'network.guestDown',
      category: 'network',
      severity: 'warn',
      title: 'No network connection in Android',
      hint: 'Android network or DNS resolution failed. Video and news apps will keep loading. Use "Repair Network" to reset Android network state (app list is preserved).',
      detail: network.reason || '',
      fix: 'repairNetwork',
    });
  }

  const badSources = Array.isArray(network.sources) ? network.sources.filter((s) => s && s.ok === false) : [];
  if (badSources.length) {
    push({
      code: 'network.sourcesDown',
      category: 'network',
      severity: 'warn',
      title: `${badSources.length} download source(s) unreachable`,
      hint: 'Update checks query multiple sources simultaneously. One failure is fine; if all fail, check your network or proxy settings.',
      detail: badSources.map((s) => s.name).join(', '),
      fix: 'settings',
    });
  }

 /* ---------------- log ---------------- */

  const errLines = Array.isArray(logs.errors) ? logs.errors.filter(Boolean) : [];
  if (errLines.length) {
    push({
      code: 'logs.errors',
      category: 'logs',
      severity: 'warn',
      title: `${errLines.length} error(s) found in runtime log`,
      hint: 'The last session left error entries. Expand the diagnostic report for full context.',
      detail: errLines.slice(-1)[0],
      fix: 'report',
    });
  }

 /* ---------------- ---------------- */

  if (accel.checked && accel.ok === false) {
    push({
      code: 'accel.softwareEmulation',
      category: 'runtime',
      severity: 'warn',
      title: 'Hardware acceleration unavailable',
      hint: 'Running on software emulation only. Boot may take several minutes and frame drops may occur. Enable "Windows Hypervisor Platform" and restart to fix this.',
      detail: accel.note || '',
      fix: 'virtualization',
    });
  }

  return dedupe(out);
}

/** code (check) */
function dedupe(issues) {
  const map = new Map();
  for (const raw of issues || []) {
    const it = normalise(raw);
    if (!it) continue;
    map.set(it.code, it);
  }
  return Array.from(map.values());
}

/** */
function bySeverity(a, b) {
  const d = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
  if (d) return d;
  return String(a.code).localeCompare(String(b.code));
}

/** : , settings */
function summarize(issues) {
  const list = dedupe(issues).sort(bySeverity);
  const errors = list.filter((i) => i.severity === 'error').length;
  const warns = list.filter((i) => i.severity === 'warn').length;
  const infos = list.filter((i) => i.severity === 'info').length;
  const byCategory = CATEGORIES.map((c) => {
    const items = list.filter((i) => i.category === c.id);
    return {
      id: c.id,
      name: c.name,
      count: items.length,
      errors: items.filter((i) => i.severity === 'error').length,
    };
  });
  return {
    total: list.length,
    errors,
    warns,
    infos,
    byCategory,
    // ""
    health: errors ? 'error' : (warns ? 'warn' : (infos ? 'info' : 'ok')),
  };
}

/** , settings */
function groupByCategory(issues) {
  const list = dedupe(issues).sort(bySeverity);
  return CATEGORIES.map((c) => ({
    ...c,
    items: list.filter((i) => i.category === c.id),
  })).filter((g) => g.items.length);
}

/**
 * check: """". 
 * check,  --
 * " 3 ". 
 */
function diff(prevIssues, nextIssues) {
  const prev = new Map((prevIssues || []).map((i) => [i.code, i]));
  const next = new Map((nextIssues || []).map((i) => [i.code, i]));
  const added = [];
  const resolved = [];
  for (const [code, it] of next) {
    const before = prev.get(code);
    if (!before || before.severity !== it.severity) added.push(it);
  }
  for (const [code, it] of prev) {
    if (!next.has(code)) resolved.push(it);
  }
  return { added, resolved };
}

module.exports = {
  CATEGORIES,
  CATEGORY_IDS,
  SEVERITY_RANK,
  normalise,
  evaluate,
  dedupe,
  summarize,
  groupByCategory,
  diff,
  bySeverity,
};
