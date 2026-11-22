'use strict';
/**
 * window:  emulator, "desktopwindow". 
 *
 * window: 
 * 1. "Android Emulator - apkstart5554"(QWindowIcon, emulator)
 * -- embed windowwindow, desktop; 
 * 2. (conhost ConsoleWindowClass / CASCADIA_HOSTING_WINDOW_CLASS)
 * -- qemu, netsimd , launch exe path. 
 *
 * : node tools/check-windows.js [runtimeRoot]
 * runtimeRoot default engine/(downloadruntime), installdirectory
 *   resources/runtime. 
 */
const path = require('path');
const { spawn } = require('child_process');
const { WinAgent } = require('../src/core/agent');

// runtimedirectory: parameters > > engine/
const ROOT = path.resolve(process.argv[2] || process.env.APKSTART_RUNTIME || path.join(__dirname, '..', 'engine'));
const EMU = path.join(ROOT, 'emulator', 'emulator.exe');
// AVD (settings runtime.avdDir), ; 
const AVD_HOME = process.env.APKSTART_AVD_HOME
  || path.join(process.env.APPDATA || '', 'apkstart', 'avd');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bad = (w) => {
  const t = String(w.title || '').toLowerCase();
  const c = String(w.cls || '');
  const isConsole = c.indexOf('ConsoleWindowClass') >= 0 || c.indexOf('CASCADIA_HOSTING') >= 0;
  if (isConsole) return t.indexOf('emulator') >= 0 || t.indexOf('netsim') >= 0 || t.indexOf('qemu') >= 0;
  return t.indexOf('android emulator') >= 0;
};

(async () => {
  const agent = new WinAgent();
  await agent.ensure();
  console.log('agent ready, port=', agent.port);

  const windows = async () => {
    const r = await agent.call({ cmd: 'windows' }, 5000).catch(() => null);
    return (r && r.list) || [];
  };

  // "runtimedirectory"window: , 
  await agent.scope([ROOT]);
  await agent.bootHide();
  console.log('');

  const proc = spawn(EMU, [
    '-avd', 'apkstart', '-port', '5554', '-no-boot-anim', '-no-metrics',
    '-crash-report-mode', 'disabled', '-gpu', 'swangle', '-memory', '3072',
    '-cores', '3', '-no-skin', '-snapshot', 'apkstart', '-no-snapshot-load',
  ], {
    cwd: path.dirname(EMU),
    env: {
      ...process.env,
      ANDROID_SDK_ROOT: ROOT, ANDROID_HOME: ROOT,
      ANDROID_AVD_HOME: AVD_HOME, ANDROID_EMULATOR_HOME: AVD_HOME,
      ANDROID_ADB_SERVER_PORT: '5044',
    },
    windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.unref();
  proc.stderr.on('data', () => {});
  proc.stdout.on('data', () => {});

  let leaked = 0;
  const ticks = Math.max(24, Number(process.env.CHECK_SECONDS || 0) * 2 || 24);
  for (let i = 0; i < ticks; i += 1) {
    await sleep(500);
    const list = await windows();
    const hit = list.filter(bad);
    if (hit.length) {
      leaked += hit.length;
      console.log(`[${((i + 1) * 0.5).toFixed(1)}s] :`, JSON.stringify(hit));
    }
  }

  const probe = await agent.probe().catch(() => null);
  console.log('probe():', JSON.stringify(probe));

  const left = (await windows()).filter(bad);
  console.log(':', JSON.stringify(left));

  const okProbe = !!(probe && Number(probe.emu) !== 0);
  // " 400ms ",  0
  const ok = left.length === 0 && okProbe;
  console.log('');
  console.log(`: ${ok ? '' : ''}( ${leaked} ,  ${left.length} )`);

  try { proc.kill(); } catch (_) { /* ignore */ }
  agent.dispose();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
