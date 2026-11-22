'use strict';
/**
 * "": 
 * 1) APPDATA ApkStart(--smoke 6.5 exit); 
 * 2) app, ""--emulatorcold boot; 
 * 3) windowwindow: emulator / qemu / netsim ; 
 * 4) appexit 8 : desktop"" Android Emulator . 
 *
 * : node tools/check-quit-clean.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { WinAgent } = require('../src/core/agent');

const ROOT = path.join(__dirname, '..');
// runtimeAndroiddirectory, , 
// download 1.4GB runtime,  AVD. 
const ENGINE = path.resolve(process.env.APKSTART_RUNTIME || path.join(ROOT, 'engine'));
const AVD_DIR = process.env.APKSTART_AVD_HOME || '';
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bad = (w) => {
  const t = String(w.title || '').toLowerCase();
  const c = String(w.cls || '');
  const isConsole = c.indexOf('ConsoleWindowClass') >= 0 || c.indexOf('CASCADIA_HOSTING') >= 0;
  if (isConsole) return t.indexOf('emulator') >= 0 || t.indexOf('netsim') >= 0 || t.indexOf('qemu') >= 0;
  return t.indexOf('android emulator') >= 0;
};

(async () => {
  const sandbox = path.join(require('os').tmpdir(), `apk-quit-${Date.now()}`);
  const appData = path.join(sandbox, 'apkstart');
  fs.mkdirSync(appData, { recursive: true });
  fs.writeFileSync(path.join(appData, 'apps.json'), JSON.stringify({
    apps: [{ package: 'com.example.demo', label: 'Demo', installedAt: Date.now() }],
  }));
  fs.writeFileSync(path.join(appData, 'settings.json'), JSON.stringify({
    runtime: { dir: ENGINE, avdDir: AVD_DIR },
    engine: { prewarm: true },
  }));

  const agent = new WinAgent();
  await agent.ensure();
  await agent.scope([ENGINE]);
  console.log('agent ready, port=', agent.port);

  // ELECTRON_RUN_AS_NODE=1(Electron Node), 
  // ; "settings", . 
  const env = { ...process.env, APPDATA: sandbox };
  delete env.ELECTRON_RUN_AS_NODE;

  const proc = spawn(ELECTRON, ['.', '--smoke', path.join(sandbox, 'smoke.png')], {
    cwd: ROOT,
    env,
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (c) => { out += c; });
  proc.stderr.on('data', (c) => { out += c; });

  let leaked = 0;
  let exitedAt = 0;
  for (let i = 0; i < 70; i += 1) {
    await sleep(500);
    const r = await agent.call({ cmd: 'windows' }, 5000).catch(() => null);
    const hit = ((r && r.list) || []).filter(bad);
    if (hit.length) {
      leaked += hit.length;
      console.log(`[${((i + 1) * 0.5).toFixed(1)}s] :`, JSON.stringify(hit));
    }
    if (!exitedAt && proc.exitCode !== null) {
      exitedAt = i;
      console.log(`[${((i + 1) * 0.5).toFixed(1)}s] ApkStart ,  8 ...`);
    }
    if (exitedAt && i - exitedAt >= 16) break;
  }

  const after = ((await agent.call({ cmd: 'windows' }, 5000).catch(() => null)) || {}).list || [];
  const left = after.filter(bad);
  console.log(':', JSON.stringify(left));
  console.log('');
  const ok = leaked === 0 && left.length === 0;
  console.log(`: ${ok ? '()' : ''}`);
  if (out) console.log('--- app  ---\n' + out.trim().split('\n').slice(-6).join('\n'));

  try { proc.kill(); } catch (_) { /* ignore */ }
  agent.dispose();
  // AVD GB, (emulatorfailure, ignore)
  try { fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 3 }); } catch (_) { /* ignore */ }
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
