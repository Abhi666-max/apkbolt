'use strict';
/**
 * Windows window:  src/core/win/agent.ps1 resident. 
 *
 * spawn PowerShell: windowmouse, 
 * powershell.exe 150~300ms, . 
 * launch,  TCP( JSON),  <2ms. 
 *
 * WH_MOUSE_LL mousehook:  / wheel / side buttons. 
 * hook, mouse, "appwindow"
 * install, uninstall;  7 . 
 * setHook(on, opts). 
 */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const SCRIPT = path.join(__dirname, 'win', 'agent.ps1');
const CALL_TIMEOUT = 6000;

class WinAgent extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.sock = null;
    this.port = 0;
    this.ready = null;
    this.buf = '';
    this.pending = [];
    this.dead = false;
    this.hooked = false;
    this.hookConf = null;
  }

  get available() { return process.platform === 'win32' && fs.existsSync(SCRIPT); }

 /** launch TCP () */
  ensure() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      if (!this.available) { reject(new Error('Window proxy unavailable')); return; }
      let out = '';
      let settled = false;
      const proc = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Port', '0',
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

      this.proc = proc;
      const fail = (e) => {
        if (settled) return;
        settled = true;
        this.ready = null;
        reject(e instanceof Error ? e : new Error(String(e)));
      };

      const onData = (chunk) => {
        out += chunk.toString('utf8');
        const m = /PORT=(\d+)/.exec(out);
        if (!m || settled) return;
        settled = true;
        this.port = Number(m[1]);
        this._connect().then(resolve).catch(fail);
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', (d) => { out += d.toString('utf8'); });
      proc.on('error', fail);
      proc.on('exit', () => {
        const wasReady = !!this.sock;
        this.proc = null;
        this.sock = null;
        this.ready = null;
        this.hooked = false;
        this.hookConf = null;
        this._failAll('Window proxy exited');
        if (wasReady) this.emit('exit');
        fail(new Error('Window proxy failed to start'));
      });
      setTimeout(() => { if (!settled) fail(new Error('Window proxy startup timed out')); }, 15000);
    });
    return this.ready;
  }

  _connect() {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: this.port }, () => resolve(this));
      sock.setEncoding('utf8');
      sock.setNoDelay(true);
      sock.on('data', (d) => this._onData(d));
      sock.on('error', (e) => { reject(e); });
      sock.on('close', () => {
        this.sock = null;
        this.ready = null;
        this._failAll('Window proxy connection lost');
      });
      this.sock = sock;
      this.buf = '';
    });
  }

  _onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg = null;
      try { msg = JSON.parse(line); } catch (_) { continue; }
      // (wheel dx/dy/nx/ny), ignoreparameters
      if (msg.ev) { this.emit(msg.ev, msg); continue; }
      const p = this.pending.shift();
      if (p) { clearTimeout(p.timer); p.resolve(msg); }
    }
  }

  _failAll(reason) {
    const list = this.pending;
    this.pending = [];
    for (const p of list) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
  }

 /** */
  async call(obj, timeout = CALL_TIMEOUT) {
    await this.ensure();
    if (!this.sock) throw new Error('Window proxy not connected');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Window proxy timeout: ${obj.cmd}`)), timeout);
      this.pending.push({ resolve, reject, timer });
      this.sock.write(`${JSON.stringify(obj)}\n`);
    });
  }

  // ---------------- ----------------

  /**
 * "directory". 
 * bootHide / embed : windowwindow. 
 * ()window -- , 
 * Qt app( 4.x Qt6, MuMu, )window. 
 * @param {string[]} dirs runtimedirectory / engine directory
 * @param {number} [appPid] pid: windowwindow, 
 * "mousewindow"(reclaim)
   */
  async scope(dirs, appPid) {
    /**
 * directory**path**. 
     *
 * "path"window,  Windows 
 * `Process.MainModule.FileName` junction / path. 
 * ApkStart directory(junction)launch( dist\ApkStart-win64-portable
 * build\_packout\...), path,  →
 * ""→ emulatorwindow(log emu:0)→
 * windowfailure → embedded mode, rotatewindow. 
 * path: path, pathpath. 
     */
    const raw = (Array.isArray(dirs) ? dirs : [dirs]).filter(Boolean);
    const list = [];
    for (const d of raw) {
      try {
        const real = fs.realpathSync.native ? fs.realpathSync.native(d) : fs.realpathSync(d);
        if (real) list.push(real);
      } catch (_) { /* directorypath */ }
      list.push(d);
    }
    const uniq = [...new Set(list.filter(Boolean))];
    const req = { cmd: 'scope', dirs: uniq.join(';') };
    if (Number(appPid) > 0) req.pid = Number(appPid);
    return this.call(req, 4000).catch(() => ({ ok: false, n: 0 }));
  }

  /**
 * windowwindow,  x,y,w,h(). 
   *
 * @param {number|string} hostHwnd window
   * @param {object} rect { x, y, w, h, clipTop }
 * @param {string[]} [targets] ("0x..."). 
 * = :  emulator window. 
 * = (MuMu / emulatorwindow). 
   */
  async embed(hostHwnd, rect, targets = null) {
    const req = {
      cmd: 'embed', host: String(hostHwnd),
      x: Math.round(rect.x), y: Math.round(rect.y),
      w: Math.round(rect.w), h: Math.round(rect.h),
    };
    if (Array.isArray(targets) && targets.length) {
      req.target = targets.map((t) => String(t)).join(',');
    }
    return this.call(req, 6000);
  }

 /** () */
  async windowReady(targets = []) {
    if (!Array.isArray(targets) || !targets.length) return { ok: false, alive: 0 };
    return this.call({ cmd: 'winready', target: targets.join(',') }, 3000)
      .catch(() => ({ ok: false, alive: 0 }));
  }

  async fit(rect) {
    return this.call({
      cmd: 'fit',
      x: Math.round(rect.x), y: Math.round(rect.y),
      w: Math.round(rect.w), h: Math.round(rect.h),
      // emulator Qt window LCD EMU_PAD , /
      // ; (). 
      clipTop: Math.round(rect.clipTop || 0),
    }, 3000);
  }

  async rotate(dir = 'left') { return this.call({ cmd: 'rotate', dir }, 8000); }
  async hide() { return this.call({ cmd: 'hide' }, 3000); }
  async show() { return this.call({ cmd: 'show' }, 3000); }
 /** : window,  CPU Android */
  async setPerformanceMode(on) { return this.call({ cmd: 'perf', on: on ? 1 : 0 }, 3000); }
 /** @param {boolean} keep true=window(emulatorwindow, ) */
  async detach(keep = false) { return this.call({ cmd: 'detach', keep: keep ? 1 : 0 }, 5000); }
 /** window: emulatorwindow() */
  async layout(rect) {
    return this.call({
      cmd: 'layout',
      x: Math.round(rect.x), y: Math.round(rect.y),
      w: Math.round(rect.w), h: Math.round(rect.h),
    }, 4000);
  }
  /**
 * emulatorwindow "Android Emulator - apkstart:5554" . 
 * default "ApkStart". (Qt ). 
   */
  async setTitle(text = 'ApkStart') {
    return this.call({ cmd: 'title', text: String(text || 'ApkStart') }, 4000);
  }
  /**
 * emulatorwindow(windowtaskbar/Alt+Tab app). 
 * @param {string} file PNG/ICO path
   */
  async setIcon(file) {
    return this.call({ cmd: 'icon', file: String(file || '') }, 4000);
  }
  async probe() { return this.call({ cmd: 'probe' }, 4000); }
 /** window(" / Androidappwindow") */
  async windows() { return this.call({ cmd: 'windows' }, 4000); }

  /**
 * window" + ". 
 * window: Windows windowwindowdesktop, 
 * -- desktop Android Emulator . 
 * ( C#),  700ms . 
   */
  async park(maxWaitMs = 700) {
    const call = this.call({ cmd: 'park' }, 2000).catch(() => ({ ok: false }));
    if (!maxWaitMs) return call;
    return Promise.race([
      call,
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, timeout: true }), maxWaitMs)),
    ]);
  }

  /**
 * "resident": emulator(QWindowIcon)+ + qemu / netsimd 
 * ,  embed window. 
 * "": emulator detached qemu / netsimd
 * , Node windowsHide , window. 
 * emulator -qt-hide-window(window), , . 
   *
 * maxWaitMs: launch(, ). 
 * "emulator", boot, . 
   * @param {number} maxWaitMs
   */
  async bootHide(maxWaitMs = 3000) {
    const call = this.call({ cmd: 'boothide', on: 1 }, 4000).catch(() => ({ ok: false }));
    if (!maxWaitMs) return call;
    return Promise.race([
      call,
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, timeout: true }), maxWaitMs)),
    ]);
  }

 /** resident(: window) */
  async bootShow() {
    return this.call({ cmd: 'boothide', on: 0 }, 4000).catch(() => ({ ok: false }));
  }

  /**
 * mousehook(). 
 * appwindow, install; opts , 
 * resident, window focus / settingshook. 
   * @param {boolean} on
   * @param {{rightBack?:boolean, wheel?:boolean, side?:boolean}} opts
   */
  async setHook(on, opts = {}) {
    const want = !!on;
    const conf = {
      right: !!(opts && opts.rightBack),
      wheel: !!(opts && opts.wheel),
      side: !!(opts && opts.side),
    };
    // default"" PowerShell (cold boot)
    if (!want && !this.hooked) return { ok: true, hooked: false };
    const sameConf = this.hookConf
      && this.hookConf.right === conf.right
      && this.hookConf.wheel === conf.wheel
      && this.hookConf.side === conf.side;
    if (want === this.hooked && sameConf) return { ok: true, hooked: this.hooked };
    const req = { cmd: 'hook', on: want ? 1 : 0, right: conf.right ? 1 : 0, wheel: conf.wheel ? 1 : 0, side: conf.side ? 1 : 0 };
    if (!want) {
      this.hooked = false;
      this.hookConf = null;
      return this.call(req, 3000).catch(() => ({ ok: false, hooked: false }));
    }
    const r = await this.call(req, 3000).catch(() => null);
    this.hooked = !!(r && r.hooked !== false);
    this.hookConf = this.hooked ? conf : null;
    return { ok: this.hooked, hooked: this.hooked };
  }

  dispose() {
    // uninstallhook: , hook
    if (this.hooked && this.sock) {
      try { this.sock.write('{"cmd":"hook","on":0}\n'); } catch (_) { /* ignore */ }
    }
    this.hooked = false;
    this.hookConf = null;
    try { this.sock?.end(); } catch (_) { /* ignore */ }
    try { this.sock?.destroy(); } catch (_) { /* ignore */ }
    // kill : ""( agent.ps1
    // _lingerUntil). emulatorboot, window; 
    // , desktop Android Emulator . emulator
    // exit,  3 . 
    this.sock = null;
    this.proc = null;
    this.ready = null;
  }
}

module.exports = { WinAgent, AGENT_SCRIPT: SCRIPT };
