'use strict';
/**
 * appwindow: Androidapp = Windows window. 
 *
 * window 38px (rotate / / / ), 
 * emulatorwindow(SetParent), Androiddesktop, 
 * emulator, taskbar. 
 */
const { BrowserWindow, screen, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { hookOptions } = require('./pointer');
const store = require('./store');
const { physicalRect } = require('./geometry');

const TITLEBAR_H = 38;
/**
 * emulatorwindow 8px (Qt ), 
 * LCD +8px . window 16px 8px, 
 * , . 
 */
const EMU_PAD = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function iconUrl(p) {
  if (!p || !fs.existsSync(p)) return '';
  return `file:///${p.replace(/\\/g, '/').replace(/ /g, '%20')}?v=${fs.statSync(p).mtimeMs}`;
}

class AppWindow {
  constructor({ agent, setOrientation, mouseHook = false, pointerConfig = null, windowTargets = null }) {
    this.agent = agent;
    this.setOrientation = setOrientation || null;
    // window: ,  null, 
    // window(window emulator ). 
    this.windowTargets = typeof windowTargets === 'function' ? windowTargets : null;
    // mousehook"appwindow + "install. 
    // pointerConfig : settings,  focus , restart. 
    this.mouseHook = mouseHook;
    this.pointerConfig = pointerConfig;
    this.win = null;
    this.pkg = null;
    this.state = { label: '', tip: '', ready: false, landscape: false };
    this._fitTimer = null;
    this._closedCb = null;
  }

  get isOpen() { return !!(this.win && !this.win.isDestroyed()); }

 /** portrait / landscapewindow() */
  static sizeFor(area, portrait, landscape) {
    const p = portrait || { w: 540, h: 960 };
    // :  38 + 24,  40
    const availH = Math.max(360, (area.h || 1040) - TITLEBAR_H - 48);
    const availW = Math.max(300, (area.w || 1920) - 80);
    const k = landscape
      ? Math.min(availW / p.h, availH / p.w)
      : Math.min(availH / p.h, availW / p.w);
    const w = Math.round((landscape ? p.h : p.w) * k);
    const h = Math.round((landscape ? p.w : p.h) * k);
    // : , , " / "
    return {
      w: Math.max(320, Math.min(w, Math.round(availW))),
      h: Math.max(360, Math.min(h, Math.round(availH))),
    };
  }

  _area() {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const a = d.workArea || d.bounds;
    // workArea DIP(). window per-monitor DPI-aware , 
    // SetWindowPos , window agent.layout
    // sf . sf area , . 
    return { x: a.x, y: a.y, w: a.width, h: a.height, sf: d.scaleFactor || 1 };
  }

  /**
 * emulatorwindow, . 
 * window w/h (), . 
 * windowwindow, bounds portraitdefault, 
 * orientation(landscape > ,  > 1). 
   */
  _panelRatio() {
    const b = this.win ? this.win.getBounds() : this._area();
    if (b && b.width > 0 && b.height > 0) {
      // landscape, window bounds (detached hide ), 
      // 0.56 (9:16),  16:9. 
      // portrait h/w (landscape = portraitrotate 90°)
      if (this.state.landscape && b.height > b.width) {
        return b.height / b.width;
      }
      return b.width / b.height;
    }
    return 0.5625; // portrait 9:16 fallback
  }

  _scale() {
    try {
      const b = this.win ? this.win.getBounds() : this._area();
      return screen.getDisplayMatching(b).scaleFactor || 1;
    } catch (_) {
      return 1;
    }
  }

  /**
 * DIP(), window SetWindowPos . 
 * Electron screen/BrowserWindow DIP;  agent.ps1 
 * per-monitor v2 DPI , Win32 SetWindowPos . 
 * 125%/150% "window / / "
 * (issue #99). _rect() sf, window. 
   */
  _physical(rect, sf) {
    return physicalRect(rect, sf || this._scale());
  }

  /**
 * ()appwindow. 
   * @param {object} o { pkg, label, iconPath, portrait, fullscreen, detached,
   *                     showWhileWaiting, onClosed }
 * detached=true "window": window, emulatorwindow. 
 * showWhileWaiting=true , ****window(hint), 
 * emulatorwindow openDetached() . apporientation App
 * restartruntime( 40 ), , . 
   */
  open(o) {
    const { pkg, label, iconPath, portrait, fullscreen, detached } = o;
    this.detachedMode = !!detached;
    this.waitingForRestart = false;
    this._showWhileWaiting = !!o.showWhileWaiting;
    this._closedCb = o.onClosed || null;
    if (this.isOpen && this.pkg === pkg) {
      // windowwindow(, ). 
      // app, "window", 
      // windowemulatorwindow. 
      if (this.detachedMode) this.agent.show().catch(() => {});
      else {
        this.win.show();
        this.win.focus();
      }
      return this.win;
    }
    this.close({ keepApp: true });

    this.pkg = pkg;
    // path: windowemulatorwindow(Win32
    // LoadImage path,  HTML data URL). 
    this.iconFilePath = iconPath || '';
    this.portrait = portrait || { w: 540, h: 960 };
    // window""emulatorwindow(, 
    // maximize window, openDetached ). 
    this._wantFullscreen = !!fullscreen;
    this.state = { label: label || 'App', tip: 'Starting Android runtime...', ready: false, landscape: false };

    const area = this._area();
    const size = AppWindow.sizeFor(area, this.portrait, false);
    const w = Math.max(320, size.w);
    const h = Math.max(420, size.h + TITLEBAR_H);

    const iconFile = iconPath && fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

    this.win = new BrowserWindow({
      width: w,
      height: h,
      minWidth: 320,
      minHeight: 420,
      x: Math.round(area.x + (area.w - w) / 2),
      y: Math.round(area.y + (area.h - h) / 2),
      show: false,
      frame: false,
      thickFrame: true,
      resizable: true,
      maximizable: true,
      backgroundColor: '#0b0c0e',
      title: label || 'ApkStart',
      icon: iconFile,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });

    this.win.loadFile(path.join(__dirname, '..', 'ui', 'shell.html'));
    // window shell.html <title>, taskbarapp, 
    // ,  OS app(taskbarhint, Alt+Tab ). 
    this.win.webContents.on('page-title-updated', (e) => {
      e.preventDefault();
      try { this.win.setTitle(label || 'ApkBolt'); } catch (_) { /* window */ }
    });
    this.win.once('ready-to-show', () => {
      // window, Androidemulatorwindow, , 
      // window. , (, /). 
      // : showWhileWaiting(appbootfallback)--
      // " xxx...", desktop 40 . 
      if (this.detachedMode && !this._showWhileWaiting) return;
      this.win.show();
      this._push();
    });

    // Electron window(OS , DPI ), 
    // 40ms fit , , 
    // -- "". 
    // ,  getContentBounds . 
    const refit = () => this.scheduleFit(6);
    this.win.on('resize', refit);
    this.win.on('move', refit);
    this.win.on('maximize', refit);
    this.win.on('unmaximize', refit);
    this.win.on('restore', () => {
      this.agent.show().catch(() => {});
      this.scheduleFit(6);
    });
    this.win.on('minimize', () => { this.agent.hide().catch(() => {}); });
    this.win.on('close', () => { this._closing = true; });
    this.win.on('closed', () => {
      if (this._selfClose) return;   // close() park complete
      this.win = null;
      const pkg = this.pkg;
      this.pkg = null;
      this._closing = false;
      // close() path(Alt+F4, taskbar, shutdown)Androidapp, 
      // emulatorwindow. windowapp, 
      // "", "". 
      if (pkg && this._onCloseApp) {
        try { this._onCloseApp(pkg); } catch (_) { /* ignore */ }
      }
      Promise.resolve(this.agent && this.agent.park()).catch(() => {}).then(() => {
        if (this._closedCb) this._closedCb(pkg);
      });
    });
    // "appwindow"mousehook; 
    // /uninstall,  ApkStart mouse. 
    this.win.on('focus', () => this._syncHook(true));
    this.win.on('blur', () => this._syncHook(false));

    // note: maximize() show:false window. 
    // windowemulatorwindow,  maximize
    // window -- "appwindow". 
    if (fullscreen && !this.detachedMode) this.win.maximize();
    return this.win;
  }

  _pointerOptions() {
    const getter = this.pointerConfig || this.mouseHook;
    const raw = typeof getter === 'function' ? getter() : getter;
    return hookOptions(raw);
  }

  _syncHook(active) {
    const opts = this._pointerOptions();
    // /mousehook: WH_MOUSE_LL desktopmouse
    // , ; FPS Qt window. 
    const game = !!(store.getSettings().engine && store.getSettings().engine.priorityMode === 'game');
    const on = !!active && opts.enabled && !game;
    if (this.agent && typeof this.agent.setHook === 'function') {
      this.agent.setHook(on, opts).catch(() => {});
    }
  }

 /** settingsmouse: (hook) */
  refreshPointer() {
    const focused = this.isOpen && !!this.win.isFocused();
    if (!focused) {
      // window: uninstall, hook
      if (this.agent && typeof this.agent.setHook === 'function') {
        this.agent.setHook(false).catch(() => {});
      }
      return;
    }
    this._syncHook(true);
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this._push();
  }

  /**
 * window"temporarywindow". 
   *
 * : portraitapprestartAndroidruntime( 40 ), 
 * emulatorwindow, window. window, 
 * -- exit. launch showWhileWaiting , 
 * pre-attach success; restart. 
   *
 * restart: hint, window
 * openDetached() hide() . 
   */
  showWaiting(tip) {
    if (!this.isOpen) return false;
    // "restart": launch pre-attach , 
    // openDetached() window hide , desktop. 
    this.waitingForRestart = true;
    if (tip) this.state = { ...this.state, tip, ready: false };
    this._push();
    try {
      this.win.show();
      this.win.moveTop();
    } catch (_) {
      return false;
    }
    return true;
  }

  _push() {
    if (!this.isOpen) return;
    try {
      this.win.webContents.send('shell:state', {
        ...this.state,
        iconUrl: this.iconUrl || '',
      });
    } catch (_) { /* window */ }
  }

  setIcon(p) { this.iconUrl = iconUrl(p); this._push(); }

  /**
 * emulatorwindowwindow, . 
 * resident: "window", window( qemu /
 * netsimd ) -- . 
 * emulatorwindow(snapshot), retry. 
   */
  /**
 * window: ****emulatorwindow, window. 
   *
 * : (SetParent),  --
 * Z , , , , Qt orientation. 
 * "windowwindow". 
   *
 * window, emulatorwindowwindow: orientation, , , 
 * . taskbar, . 
   *
 * @returns {Promise<boolean>} successwindow
   */
  async openDetached() {
    // window( / launch). 
    // : log "unknown", "window"
    // "emulatorwindow". 
    if (!this.isOpen) { this.lastEmbedError = 'shell-closed'; return false; }
    // , ( pre-attach retry)
    this.waitingForRestart = false;
    // window(, ). 
    // showWhileWaiting "hint", . 
    try { this.win.hide(); } catch (_) { /* ignore */ }
    // ( _emu window). 
    // keep=true: "window", ""--
    // emulatorwindow. 
    const dt = await this.agent.detach(true).catch((e) => ({ ok: false, error: e.message }));
    this._detachedDebug = `detach=${JSON.stringify(dt)}`;
    // show . 
    // resident, cache""(_ourTitle); emulatorwindow
    // show -- appwindow**app
    // ** 0.5 , launch "Android Emulator - apkstart:5554". 
    // show() → setTitle(), . 
    const title = this.state && this.state.label ? this.state.label : 'ApkStart';
    await this.agent.setTitle(title).catch(() => {});
    // window show : /, 
    // "setTitle 600ms + show + setIcon 300ms"
    // -- app 300ms(defaultwindow, ). 
    // taskbar/Alt+Tab,  Qt window,  show . 
    const icoForNative = this.iconFilePath
      ? this.iconFilePath.replace(/\.png$/i, '.ico')
      : '';
    if (icoForNative && fs.existsSync(icoForNative)) {
      try { await this.agent.setIcon(icoForNative); } catch (_) { /* ignore */ }
    } else if (this.iconFilePath) {
      try { await this.agent.setIcon(this.iconFilePath); } catch (_) { /* ignore */ }
    }
    await sleep(600);
    // emulatorwindow
    const shown = await this.agent.show().catch((e) => ({ ok: false, error: e.message }));
    this._detachedDebug += ` show=${JSON.stringify(shown)}`;
    if (!shown || shown.ok === false) { this.lastEmbedError = this._detachedDebug; return false; }
    // sizing. 
    // note: emulatorwindow(portrait 9:16), 
    // w/h, , " 1280
    // 400 ". , . 
    //
    // ("launch"); landscape
    // ,  -- landscapeportrait. 
    const area = this._area();
    const ratio = this._panelRatio();
    let w;
    let h;
    let x;
    let y;
    if (this._wantFullscreen) {
      // "". portrait(720x1280) 1920x1080 , 
      // window area.w × area.h, Qt , 
      // area -- , "". 
      // , landscape, . 
      const fitW = Math.min(area.w, Math.round(area.h * ratio));
      w = fitW;
      h = Math.round(fitW / ratio);
      x = Math.round(area.x + (area.w - w) / 2);
      y = Math.round(area.y + (area.h - h) / 2);
      // , """". 
      this._detachedFullscreen = true;
    } else {
      this._detachedFullscreen = false;
      const maxH = Math.min(area.h - 140, 1000);
      const maxW = Math.min(area.w - 80, 1280);
      w = maxW;
      h = Math.round(w / ratio);
      if (h > maxH) { h = maxH; w = Math.round(h * ratio); }
      x = Math.round(area.x + (area.w - w) / 2);
      y = Math.round(area.y + 60);
    }
    // area/x/y/w/h Electron DIP , window SetWindowPos
    // . 150% , window 2/3 -- issue #99
    // "". _rect()(embedded mode) sf, . 
    const lay = await this.agent.layout(this._physical({ x, y, w, h }, area.sf))
      .catch((e) => ({ ok: false, error: e.message }));
    this._detachedDebug += ` layout=${JSON.stringify(lay)}`;
    this.lastEmbedError = this._detachedDebug;
    this.lastEmbedOk = false;
    return !!(lay && lay.ok !== false);
  }

  async embed() {
    if (!this.isOpen) return false;
    let last = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (!this.isOpen) return false;
      const hwnd = this._hwnd();
      if (!hwnd) return false;
      // (,  null); 
      // -- boot, cachewindow. 
      let targets = null;
      if (typeof this.windowTargets === 'function') {
        // eslint-disable-next-line no-await-in-loop
        targets = await Promise.resolve(this.windowTargets()).catch(() => null);
        if (Array.isArray(targets) && !targets.length) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(attempt < 2 ? 400 : 1000);
          continue;
        }
      }
      // eslint-disable-next-line no-await-in-loop
      const r = await this.agent.embed(hwnd, this._rect(), targets).catch((e) => ({ ok: false, error: e.message }));
      last = r;
      if (r && r.ok) { this.lastEmbedOk = true; return true; }
      // eslint-disable-next-line no-await-in-loop
      await sleep(attempt < 2 ? 300 : 800);
    }
    // failure:  app.log, "emulatorwindow"
    // "SetParent failure", . 
    this.lastEmbedError = last ? (last.error || `emu=${last.emu}`) : 'no-response';
    return false;
  }

  async fitNow() {
    if (!this.isOpen) return;
    await this.agent.fit(this._rect()).catch(() => {});  }

 /** emulatorwindow(,  8px ) */
  _rect() {
    const sf = this._scale();
    const b = this.win.getContentBounds();
    const top = Math.round(TITLEBAR_H * sf);
    return {
      x: -EMU_PAD,
      y: top - EMU_PAD,
      w: Math.round(b.width * sf) + EMU_PAD * 2,
      h: Math.round((b.height - TITLEBAR_H) * sf) + EMU_PAD * 2,
      // -EMU_PAD , window( agent.fit clipTop)
      clipTop: EMU_PAD,
    };
  }

  /**
 * @param {number} rounds (window bounds)
   */
  scheduleFit(rounds = 1) {
    if (!this.isOpen) return;
    if (this._fitTimer) clearTimeout(this._fitTimer);
    const run = async (left) => {
      await this.fitNow().catch(() => {});
      if (left > 1) {
        this._fitTimer = setTimeout(() => run(left - 1), 160);
      } else {
        this._fitTimer = null;
      }
    };
    this._fitTimer = setTimeout(() => run(Math.max(1, rounds)), 40);
  }

  _hwnd() {
    try {
      const buf = this.win.getNativeWindowHandle();
      const v = buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
      return v.toString();
    } catch (_) {
      return null;
    }
  }

  /**
 * portrait(rotate)= ""landscapeportrait. 
   *
 * (): 
 * - wm size:  Android , emulator LCD , 
 * Qt -> 90°, , , ; 
 * - wm density: framebuffer , , ; 
 * - adb emu rotate: , portrait. 
 * " + "landscape,  hw.lcd.width/height 
 * 1280x720 restartemulator. restart 30~60 , , hint. 
   *
 * @param {(next:boolean)=>Promise<boolean>} [onRestart] restart
 * @param {boolean} [explicitNext] orientation. ,  --
 * rotateorientation, 
 * " apps.json ""orientation". 
   */
  async rotate(onRestart, explicitNext) {
    if (!this.isOpen) return this.state.landscape;
    const next = explicitNext === undefined || explicitNext === null
      ? !this.state.landscape : !!explicitNext;
    this.setState({ tip: next ? 'Switching to landscape (restarting Android runtime, ~30-60s)...' : 'Switching to portrait (restarting Android runtime, ~30-60s)...', ready: false });
    if (typeof onRestart === 'function') {
      const ok = await onRestart(next).catch(() => false);
      if (ok) {
        this.state.landscape = next;
        this._push();
        // , window; 
        for (let i = 0; i < 5; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(400);
          // eslint-disable-next-line no-await-in-loop
          await this.fitNow();
        }
        this.setState({ ready: true, tip: '' });
        return next;
      }
    }
    // restart(failure) density , 
    if (this.setOrientation) await this.setOrientation(next).catch(() => {});
    this.state.landscape = next;
    this.setState({ ready: true, tip: '' });
    return next;
  }

 /** orientation(=landscape, window=portrait) */
  async setLandscape(want) {
    if (!this.isOpen) return this.state.landscape;
    if (!!this.state.landscape === !!want) return this.state.landscape;
    return this.rotate();
  }

  async toggleMaximize() {
    if (!this.isOpen) return;
    // window: emulatorwindow, window -- maximize
    // window(""). 
    // emulatorwindow / . 
    if (this.detachedMode) {
      const area = this._area();
      if (this._detachedFullscreen) {
        // : (), default
        this._detachedFullscreen = false;
        if (this._preFullscreenRect) {
          await this.agent.layout(this._preFullscreenRect).catch(() => {});
          this._preFullscreenRect = null;
        } else {
          await this.openDetachedLayoutOnly(area);
        }
      } else {
        // window, 
        try {
          const probe = await this.agent.probe().catch(() => null);
          if (probe && probe.w > 0 && probe.h > 0) {
            this._preFullscreenRect = { x: probe.x, y: probe.y, w: probe.w, h: probe.h };
          }
        } catch (_) { /* default */ }
        this._detachedFullscreen = true;
        // openDetached: , portraitapp
        // Qt , . 
        const ratio = this._panelRatio();
        const fitW = Math.min(area.w, Math.round(area.h * ratio));
        const fitH = Math.round(fitW / ratio);
        await this.agent.layout(this._physical({
          x: Math.round(area.x + (area.w - fitW) / 2),
          y: Math.round(area.y + (area.h - fitH) / 2),
          w: fitW,
          h: fitH,
        }, area.sf)).catch(() => {});
      }
      return;
    }
    if (this.win.isMaximized()) this.win.unmaximize();
    else this.win.maximize();
    this.scheduleFit();
  }

  /**
 * emulatorwindow( detach/show), / openDetached
 * .  detach . 
   */
  async openDetachedLayoutOnly(area) {
    const maxH = Math.min(area.h - 140, 1000);
    const maxW = Math.min(area.w - 80, 1280);
    const ratio = this._panelRatio();
    let w = maxW;
    let h = Math.round(w / ratio);
    if (h > maxH) { h = maxH; w = Math.round(h * ratio); }
    await this.agent.layout(this._physical({
      x: Math.round(area.x + (area.w - w) / 2),
      y: Math.round(area.y + 60),
      w, h,
    }, area.sf)).catch(() => {});
  }

  minimize() {
    if (!this.isOpen) return;
    // window: emulatorwindow(agent.hide ), 
    // window. 
    if (this.detachedMode) { this.agent.hide().catch(() => {}); return; }
    this.win.minimize();
  }

  /**
 * window. defaultAndroidapp(memory), , . 
   *
 * : emulatorwindowwindow"", . 
 * Windows windowdesktop, , 
 * desktop "Android Emulator - apkstart5554" . 
   */
  close({ keepApp = false } = {}) {
    if (!this.isOpen) return;
    const win = this.win;
    const pkg = this.pkg;
    this._syncHook(false);
    this.lastEmbedOk = false;
    if (!keepApp && pkg && this._onCloseApp) this._onCloseApp(pkg);
    this._selfClose = true;
    this.win = null;
    this.pkg = null;
    const done = () => {
      try { win.destroy(); } catch (_) { /* ignore */ }
      this._selfClose = false;
      this._closing = false;
      if (this._closedCb) this._closedCb(pkg);
    };
    Promise.resolve(this.agent && this.agent.park()).catch(() => {}).then(done, done);
  }

  onCloseApp(cb) { this._onCloseApp = cb; }
}

module.exports = { AppWindow, TITLEBAR_H };
