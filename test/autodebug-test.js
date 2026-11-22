'use strict';
/**
 * (src/core/autodebug.js)
 * ,  electron / adb /  -- CI . 
 * : 
 *   1) ""(); 
 *   2) , . 
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

const ROOT = path.join(__dirname, '..');
const ad = require(path.join(ROOT, 'src/core/autodebug'));

const codes = (issues) => issues.map((i) => i.code);

console.log('\n[  -  ]');
test('unit test verification', () => {
  const issues = ad.evaluate({});
  assert(issues.length === 0, `,  ${JSON.stringify(codes(issues))}`);
});

test('unit test verification', () => {
  // "", 
  const issues = ad.evaluate({ runtime: { running: true } });
  assert(issues.length === 0, `,  ${JSON.stringify(codes(issues))}`);
});

test('" "', () => {
  const issues = ad.evaluate({ runtime: { running: true }, device: { checked: false } });
  assert(!codes(issues).includes('device.missing'), 'assertion failed');
});

console.log('\n[  -  ]');
test(', ', () => {
  const issues = ad.evaluate({ runtime: { error: 'FATAL: cannot lock AVD' } });
  const it = issues.find((i) => i.code === 'runtime.bootFailed');
  assert(it, 'assertion failed');
  assert(it.severity === 'error', 'assertion failed');
  assert(it.detail.includes('cannot lock AVD'), 'assertion failed');
  assert(it.fix === 'restartRuntime', 'assertion failed');
});

test('2 ( )', () => {
  const soon = ad.evaluate({ runtime: { running: true, phase: 'booting', bootMs: 30000 } });
  assert(!codes(soon).includes('runtime.stuckBoot'), 'assertion failed');
  const stuck = ad.evaluate({ runtime: { running: true, phase: 'booting', bootMs: 200000 } });
  assert(codes(stuck).includes('runtime.stuckBoot'), 'assertion failed');
});

test('unit test verification', () => {
  const issues = ad.evaluate({ runtime: { locks: 2, orphans: 1 } });
  assert(codes(issues).includes('runtime.staleLocks'), 'assertion failed');
  assert(codes(issues).includes('runtime.orphanProcesses'), 'assertion failed');
});

test('unit test verification', () => {
  const issues = ad.evaluate({ runtime: { snapshotStale: true } });
  assert(codes(issues).includes('runtime.saleSnapshot') === false, 'code');
  assert(codes(issues).includes('runtime.staleSnapshot'), 'assertion failed');
});

console.log('\n[  -  ]');
test('unauthorized ( )', () => {
  const issues = ad.evaluate({ device: { checked: true, state: 'unauthorized' } });
  const it = issues.find((i) => i.code === 'device.unauthorized');
  assert(it, 'assertion failed');
  assert(it.severity === 'error', 'assertion failed');
  assert(it.category === 'device', 'assertion failed');
});

test('offline no-device , ', () => {
  const off = ad.evaluate({ device: { checked: true, state: 'offline' } });
  assert(codes(off).includes('device.offline'), 'offline');
  const none = ad.evaluate({ runtime: { running: true }, device: { checked: true, state: 'no-device' } });
  assert(codes(none).includes('device.missing'), 'assertion failed');
});

console.log('\n[  -  ]');
test('2GB , 8GB', () => {
  const crit = ad.evaluate({ storage: { freeMB: 1024 } });
  const ci = crit.find((i) => i.code === 'storage.diskCritical');
  assert(ci && ci.severity === 'error', '2GB');
  const warn = ad.evaluate({ storage: { freeMB: 5000 } });
  const wi = warn.find((i) => i.code === 'storage.diskLow');
  assert(wi && wi.severity === 'warn', '8GB');
});

test('unit test verification', () => {
  const issues = ad.evaluate({ storage: { needsReset: true, configuredGB: 16, actualGB: 6 } });
  const it = issues.find((i) => i.code === 'storage.dataNeedsReset');
  assert(it, 'assertion failed');
  assert(it.detail.includes('16') && it.detail.includes('6'), 'assertion failed');
});

test('unit test verification', () => {
  const issues = ad.evaluate({ storage: { configuredGB: 24, actualGB: 6 } });
  const it = issues.find((i) => i.code === 'storage.dataMismatch');
  assert(it && it.severity === 'error', 'assertion failed');
});

test('unit test verification', () => {
  const issues = ad.evaluate({ storage: { sharedOk: false, sharedPath: 'D:\\share' } });
  const it = issues.find((i) => i.code === 'storage.sharedBroken');
  assert(it, 'assertion failed');
  assert(it.detail.includes('share'), 'assertion failed');
});

console.log('\n[  -  ]');
test('--', () => {
  const issues = ad.evaluate({ settings: { orientationMode: 'portrait', landscape: true } });
  assert(codes(issues).includes('settings.orientationConflict'), 'assertion failed');
});

test('--', () => {
  const issues = ad.evaluate({ settings: { orientationMode: 'landscape', landscape: false } });
  assert(codes(issues).includes('settings.orientationConflict'), 'assertion failed');
});

test('+', () => {
  const a = ad.evaluate({ settings: { orientationMode: 'auto', landscape: true } });
  const b = ad.evaluate({ settings: { orientationMode: 'auto', landscape: false } });
  assert(!codes(a).includes('settings.orientationConflict'), 'auto');
  assert(!codes(b).includes('settings.orientationConflict'), 'auto');
});

console.log('\n[  -  (0.6.2)]');
test(', ', () => {
  const issues = ad.evaluate({ audio: { checked: true, enabled: false, serviceRunning: true } });
  const it = issues.find((i) => i.code === 'audio.disabled');
  assert(it, 'assertion failed');
  assert(it.category === 'settings' && it.fix === 'audio', 'assertion failed');
  assert(it.help && it.help.id === 'sound', 'assertion failed');
});

test('Windows', () => {
  const issues = ad.evaluate({ audio: { checked: true, enabled: true, serviceRunning: false } });
  const it = issues.find((i) => i.code === 'audio.windowsServiceStopped');
  assert(it, 'assertion failed');
  assert(it.fix === 'audioService', 'assertion failed');
});

test('unit test verification', () => {
  const issues = ad.evaluate({ audio: { checked: true, enabled: true, serviceRunning: null } });
  assert(!codes(issues).includes('audio.windowsServiceStopped'), 'assertion failed');
});

console.log('\n[  -  ]');
test(', ', () => {
  const issues = ad.evaluate({ network: { ok: false, reason: 'dns timeout' } });
  const it = issues.find((i) => i.code === 'network.guestDown');
  assert(it, 'assertion failed');
  assert(it.fix === 'repairNetwork', 'assertion failed');
});

test('unit test verification', () => {
  const issues = ad.evaluate({ network: { sources: [{ name: 'GitHub', ok: false }, { name: 'Gitee', ok: true }] } });
  const it = issues.find((i) => i.code === 'network.sourcesDown');
  assert(it, 'assertion failed');
  assert(it.detail.includes('GitHub'), 'assertion failed');
  assert(!it.detail.includes('Gitee'), 'assertion failed');
});

test('unit test verification', () => {
  const issues = ad.evaluate({ logs: { errors: ['2026-01-01 FATAL: cannot lock AVD'] } });
  const it = issues.find((i) => i.code === 'logs.errors');
  assert(it, 'assertion failed');
  assert(it.detail.includes('cannot lock'), 'assertion failed');
});

console.log('\n[  -  ]');
test(', ', () => {
  const s = ad.summarize(ad.evaluate({
    runtime: { error: 'boom' },
    storage: { freeMB: 1024 },
    device: { checked: true, state: 'unauthorized' },
  }));
  assert(s.total === 3, ` 3 ,  ${s.total}`);
  assert(s.errors === 3, ` 3 ,  ${s.errors}`);
  assert(s.health === 'error', 'error');
  assert(s.byCategory.length === 6, '6');
});

test('ok', () => {
  const s = ad.summarize([]);
  assert(s.total === 0 && s.health === 'ok', 'assertion failed');
});

test('dedupe retains higher severity issue with title', () => {
  const list = ad.dedupe([
    { code: 'x', severity: 'warn', title: 'Warn Title' },
    { code: 'x', severity: 'error', title: 'Error Title' },
  ]);
  assert(list.length === 1, 'assertion failed');
  assert(list[0].title === 'Error Title', 'assertion failed');
});

test('" " " "', () => {
  const prev = [{ code: 'a', severity: 'error' }, { code: 'b', severity: 'warn' }];
  const next = [{ code: 'b', severity: 'warn' }, { code: 'c', severity: 'error' }];
  const d = ad.diff(prev, next);
  assert(d.added.length === 1 && d.added[0].code === 'c', 'assertion failed');
  assert(d.resolved.length === 1 && d.resolved[0].code === 'a', 'assertion failed');
});

test('" "(error warn )', () => {
  const d = ad.diff([{ code: 'a', severity: 'warn' }], [{ code: 'a', severity: 'error' }]);
  assert(d.added.length === 1, 'assertion failed');
});

console.log('\n[  -  ]');
test(',  , ', () => {
  const issues = ad.evaluate({
    runtime: { error: 'x', locks: 1, orphans: 1, snapshotStale: true },
    device: { checked: true, state: 'offline' },
    storage: { freeMB: 100, needsReset: true, sharedOk: false },
    settings: { orientationMode: 'portrait', landscape: true },
    network: { ok: false },
    logs: { errors: ['err'] },
  });
  assert(issues.length > 0, 'assertion failed');
  for (const it of issues) {
    assert(it.code, 'code');
    assert(ad.CATEGORY_IDS.includes(it.category), `: ${it.category}`);
    assert(['error', 'warn', 'info'].includes(it.severity), `: ${it.severity}`);
    assert(it.title, 'assertion failed');
    assert(typeof it.hint === 'string', 'assertion failed');
  }
});

test('( DEBUG_CATS)', () => {
  const appJs = fs.readFileSync(path.join(ROOT, 'src/ui/app.js'), 'utf8');
  const m = appJs.match(/const DEBUG_CATS = \[([\s\S]*?)\];/);
  assert(m, 'app.js DEBUG_CATS');
  const ids = (m[1].match(/id:\s*'([a-z]+)'/g) || []).map((s) => s.replace(/id:\s*'|'/g, ''));
  assert(ids.length === ad.CATEGORIES.length, `:  ${ids.length} /  ${ad.CATEGORIES.length}`);
  for (const c of ad.CATEGORIES) {
    assert(ids.includes(c.id), ` ${c.id}`);
  }
});

console.log('\n[  -  ]');
test('IPC', () => {
  const mainJs = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
  for (const ch of ['autodebug:run', 'autodebug:state', 'autodebug:config', 'app:clearOrphans', 'app:clearSnapshot', 'runtime:restart']) {
    assert(mainJs.includes(`'${ch}'`), ` ${ch}`);
  }
  assert(mainJs.includes('scheduleAutodebug()'), 'assertion failed');
});

test('preload , ', () => {
  const p = fs.readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8');
  for (const fn of ['autodebugRun', 'autodebugState', 'autodebugConfig', 'clearOrphans', 'clearSnapshot', 'restartRuntime']) {
    assert(p.includes(fn), `preload  ${fn}`);
  }
  assert(p.includes("'autodebug:state'"), 'preload autodebug:state');
});

test('unit test verification', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/ui/index.html'), 'utf8');
  for (const id of ['setAutodebugAuto', 'setAutodebugInterval', 'setAutodebugNotify', 'btnAutodebugRun', 'autodebugList']) {
    assert(html.includes(`id="${id}"`), ` ${id}`);
  }
});

console.log(`\n: ${passed} , ${failed} `);
process.exit(failed ? 1 : 0);
