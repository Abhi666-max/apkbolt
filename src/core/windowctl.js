'use strict';
/**
 * Android Emulator Qt window"appwindow". 
 *
 * :  SurfaceFlinger VSYNC( screenrecord 3 2 ), 
 * CPU. windowemulator 60fps + mouse, 
 * " / / / " Win32 , . 
 *
 * PowerShell Windows ,  ASCII,  UTF-8 JSON , 
 * Windows PowerShell 5.1 ANSI .ps1 . 
 * failurefallback: window, /. 
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const SCRIPT = path.join(__dirname, 'win', 'windowctl.ps1');
const TIMEOUT = 8000;

function parseOut(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** @param {object} params { pid, action, title, icon, bounds } */
function call(params) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !fs.existsSync(SCRIPT) || !params || params.pid === undefined) {
      resolve(null);
      return;
    }
    const json = path.join(os.tmpdir(),
      `apkbolt-wctl-${crypto.randomBytes(4).toString('hex')}.json`);
    try {
      fs.writeFileSync(json, JSON.stringify(params), 'utf8');
    } catch (_) { resolve(null); return; }

    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, json,
    ], { timeout: TIMEOUT, windowsHide: true, maxBuffer: 1024 * 64 }, (err, stdout) => {
      try { fs.unlinkSync(json); } catch (_) { /* ignore */ }
      if (err) { resolve(null); return; }
      const r = parseOut(stdout);
      resolve(r.OK === '1' ? r : null);
    });
  });
}

/** window, "appwindow" */
async function getBounds(pid) {
  const r = await call({ pid, action: 'get' });
  if (!r || !Number(r.W) || !Number(r.H)) return null;
  return {
    x: Number(r.X) || 0, y: Number(r.Y) || 0,
    w: Number(r.W), h: Number(r.H),
    maximized: r.MAX === '1',
  };
}

/**
 * runtimewindowapp. 
 * @param {object} o { pid, label, icon, mode:'window'|'fullscreen', bounds, screen }
 */
async function present(o) {
  const { pid, label, icon, mode, bounds, screen } = o || {};
  // pid=0 : emulator, window
  if (pid === undefined || pid === null) return null;
  return call({
    pid,
    action: mode === 'fullscreen' ? 'fullscreen' : 'window',
    title: label || '',
    icon: icon && fs.existsSync(icon) ? icon : '',
    bounds: bounds || null,
    screen: mode === 'fullscreen' ? (screen || null) : null,
  });
}

async function focus(pid) { return call({ pid, action: 'focus' }); }

/** /shortcut, desktop F5 */
async function refreshShell() { return call({ pid: 0, action: 'refresh' }); }

module.exports = { call, getBounds, present, focus, refreshShell, SCRIPT };
