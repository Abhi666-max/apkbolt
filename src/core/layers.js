'use strict';
/**
 * : system image + runtime + reclaimtemporary
 *
 * ( Docker ): 
 * system-images/ = base layer, app, , 
 * avd/*.avd/ = thin layer(qcow2 + quickboot snapshot), 
 * _tmp/ snapshots = reclaim scratch layer
 *
 * """reclaim", default dryRun, . 
 */
const fs = require('fs');
const path = require('path');

function walk(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) walk(p, out, depth + 1);
    else {
      try { out.push({ path: p, size: fs.statSync(p).size }); } catch (_) { /* ignore */ }
    }
  }
  return out;
}

function dirSize(dir) { return walk(dir).reduce((n, f) => n + f.size, 0); }
const exists = (p) => { try { return fs.existsSync(p); } catch (_) { return false; } };

/**
 * runtime, "reclaim". 
 * @returns {{total:number, groups:Array, candidates:Array}}
 */
function analyze(root, { keepAvd = 'apkstart.avd', aggressive = false, keepSnapshots = false } = {}) {
  const groups = [];
  const candidates = [];
  if (!exists(root)) return { total: 0, groups, candidates };

  const groupOf = (name, dir) => {
    const size = dirSize(dir);
    groups.push({ name, size });
    return size;
  };
  const add = (p, size, reason, kind = 'file') => candidates.push({ path: p, size, reason, kind });

  groupOf('Emulator Engine', path.join(root, 'emulator'));
  groupOf('System Image (read-only base layer)', path.join(root, 'system-images'));
  groupOf('AVD writable layer / snapshots', path.join(root, 'avd'));
  groupOf('platform-tools', path.join(root, 'platform-tools'));

  // 1) QEMU x86_64 ;  7
  const qemuDir = path.join(root, 'emulator', 'qemu', 'windows-x86_64');
  if (exists(qemuDir)) {
    for (const f of walk(qemuDir)) {
      if (/qemu-system-(aarch64|armel|i386)/i.test(path.basename(f.path))) {
        add(f.path, f.size, 'Non-x86_64 QEMU target, unused by runtime');
      }
    }
  }

  // 2) system image / directory
  for (const f of walk(path.join(root, 'system-images'))) {
    if (/^(NOTICE\.txt|source\.properties)$/i.test(path.basename(f.path)) && f.size > 1024 * 1024) {
      add(f.path, f.size, 'Large readme file in image package');
    }
  }

  // 3) system image: API 34 Play system image, API 30 system image
  const play34 = path.join(root, 'system-images', 'android-34', 'google_apis_playstore', 'x86_64', 'system.img');
  if (exists(play34)) {
    const legacy = path.join(root, 'system-images', 'android-30');
    if (exists(legacy)) add(legacy, dirSize(legacy), 'Legacy API 30 image (outdated ARM translation layer)', 'dir');
  }
  const stray = path.join(root, 'x86_64');
  if (exists(stray)) add(stray, dirSize(stray), 'Duplicate image directory from misaligned extraction', 'dir');

  // 4) AVD:  apkstart ;  apkstart-arm / -houdini
  const avdHome = path.join(root, 'avd');
  if (exists(avdHome)) {
    for (const e of fs.readdirSync(avdHome, { withFileTypes: true })) {
      if (!e.isDirectory() || !e.name.endsWith('.avd') || e.name === keepAvd) continue;
      add(path.join(avdHome, e.name), dirSize(path.join(avdHome, e.name)),
        'Inactive AVD (contains 8-16 GB old userdata image)', 'dir');
    }
    // 5) lock file: "AVD is already running"
    for (const f of walk(avdHome)) {
      if (/\.lock$/i.test(f.path)) add(f.path, f.size, 'Lock file leftover from abnormal exit');
    }
    // 6) launchsnapshot: ram.img ≈ memory, configuration
    const activeAvd = path.join(avdHome, keepAvd);
    if (exists(activeAvd) && !keepSnapshots) {
      for (const e of fs.readdirSync(activeAvd, { withFileTypes: true })) {
        // snapshot + failuresnapshot, reclaim
        if (!e.isDirectory() || !/^snapshots(\.stale-\d+)?$/.test(e.name)) continue;
        const p = path.join(activeAvd, e.name);
        add(p, dirSize(p), 'Old quickboot snapshot (rebuilt automatically on config change)', 'dir');
      }
    }
  }

  // 7) downloadcache / QEMU ISO
  for (const d of ['_tmp', 'images']) {
    const p = path.join(root, d);
    if (exists(p)) {
      const size = dirSize(p);
      if (size > 0) add(p, size, d === '_tmp' ? 'Download temp files' : 'Legacy QEMU/ISO files', 'dir');
    }
  }

  // 8) : . 
  // note: Qt6WebEngineCoreAndroidEmu.dll qemu-system-x86_64.exe , 
  // , ; qsn/netsim snapshotnetwork, . 
  if (aggressive) {
    const extras = [
      ['emulator/crashreport.exe', 'Crash reporter (unused in headless mode)'],
    ];
    for (const [rel, reason] of extras) {
      const p = path.join(root, rel);
      if (exists(p)) add(p, fs.statSync(p).size, reason);
    }
  }

  const total = groups.reduce((n, g) => n + g.size, 0);
  return { total, groups, candidates };
}

/**
 * reclaim.  apply:true; (UI/). 
 * :  root ,  root . 
 */
function prune(root, { apply = false, keepAvd, aggressive = false, keepSnapshots = false, onRemove = () => {} } = {}) {
  const report = analyze(root, { keepAvd, aggressive, keepSnapshots });
  const rootAbs = path.resolve(root);
  const removed = [];
  let saved = 0;
  for (const c of report.candidates) {
    const p = path.resolve(c.path);
    if (p === rootAbs || !p.startsWith(rootAbs + path.sep)) continue;
    if (!exists(p)) continue;
    if (apply) {
      try {
        fs.rmSync(p, c.kind === 'dir' ? { recursive: true, force: true } : { force: true });
        removed.push(c);
        saved += c.size;
        onRemove(c);
      } catch (_) { /* ,  */ }
    }
  }
  return { ...report, apply, removed, saved, after: apply ? report.total - saved : report.total };
}

/** settings */
function summary(root) {
  const a = analyze(root);
  const mb = (n) => (n >= 1048576 * 1024
    ? `${(n / 1073741824).toFixed(2)} GB`
    : `${(n / 1048576).toFixed(0)} MB`);
  // runtimedirectory, "": 
  // AVD(app + snapshot), APK cache, , log. 
  const store = require('./store');
  const extra = [
    { key: 'avd', label: 'Android Data (Apps + Snapshots)', path: path.join(store.DATA_DIR, 'avd') },
    { key: 'apk', label: 'APK Package Cache', path: store.APK_DIR },
    { key: 'icons', label: 'Desktop Icon Cache', path: store.ICON_DIR },
    { key: 'logs', label: 'Logs', path: path.join(store.DATA_DIR, 'logs') },
  ].map((g) => ({ ...g, size: dirSize(g.path) })).filter((g) => g.size > 0);

  const extraTotal = extra.reduce((n, g) => n + g.size, 0);
  const totalAll = a.total + extraTotal;
  return {
    total: totalAll,
    totalText: mb(totalAll),
    runtimeText: mb(a.total),
    groups: [
      { key: 'runtime', label: 'Runtime (Engine + System Images)', size: a.total, text: mb(a.total) },
      ...extra.map((g) => ({ ...g, text: mb(g.size) })),
    ],
    reclaimable: a.candidates.reduce((n, c) => n + c.size, 0),
    reclaimableText: mb(a.candidates.reduce((n, c) => n + c.size, 0)),
    count: a.candidates.length,
  };
}

module.exports = { analyze, prune, summary, walk, dirSize };
