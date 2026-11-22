'use strict';
/**
 * (backend driver)-- "Android" Runtime . 
 *
 * : ApkStart ( Google Android Emulator / QEMU), 
 * (boot, snapshot, reclaim, system imagedownload) core/engine.js . 
 * " APK , , appwindow", 
 * : 
 *
 * 1. adb ( / launch / / ); 
 * 2. HWND Androidwindow( SetParent window); 
 * 3. launch / . 
 *
 * 0.5.6 : builtin( emulator + system image). 
 * ,  engine.js "Android", 
 * runtime; 
 * **emulator / runtime**(MuMu / / / WSA ). 
 *
 * (): 
 * - , ;  ensure() . 
 * - failure { ok:false, error }, (hint). 
 * - adb server:  adb ,  connect. 
 */

/** : / */
const CAPS = {
 /** download/runtime(system image, emulator, adb) */
  provision: 'provision',
 /** launchsnapshot(boot) */
  snapshot: 'snapshot',
 /** data partition */
  resizeData: 'resizeData',
 /** Android(/data) */
  resetData: 'resetData',
 /** orientation(landscape, restart) */
  rotatePanel: 'rotatePanel',
 /** (app) */
  priority: 'priority',
 /** (uninstall/exit) */
  shutdown: 'shutdown',
 /** window, ""window(emulator) */
  sharedHost: 'sharedHost',
};

class Backend {
  /**
 * @param {object} appRoot directory( resources/app)
 * @param {object} deps : { store, log }
   */
  constructor(appRoot, deps = {}) {
    this.appRoot = appRoot || '';
    this.deps = deps || {};
 /** adb serial( emulator-5554 / 127.0.0.1:16384) */
    this.serial = '';
 /** adb.exe path */
    this.adbPath = '';
 /** error, diagnose */
    this.lastError = '';
  }

 /** id(settings, ) */
  static get id() { return 'base'; }

 /** */
  static get label() { return 'Unnamed Backend'; }

 /** , settings */
  static get summary() { return ''; }

 /** "window"( attach ) */
  static get embedCapable() { return false; }

  get id() { return this.constructor.id; }

  get label() { return this.constructor.label; }

 /** ,  CAPS */
  get caps() {
    return new Set();
  }

  has(cap) { return this.caps.has(cap); }

 /** ( adb) */
  running() { return false; }

  /**
 * probe: . 
 * "", (<1.5s). 
   * @returns {Promise<{ok:boolean, found:boolean, path?:string, detail?:string}>}
   */
  // eslint-disable-next-line class-methods-use-this
  async probe() { return { ok: true, found: false }; }

  /**
 * : app. 
   * @returns {Promise<{ok:boolean, reason?:string, needs?:string}>}
   */
  // eslint-disable-next-line class-methods-use-this
  async check() { return { ok: false, reason: 'Not implemented' }; }

 /** adb path(, ,  PATH) */
  async resolveAdb() { return ''; }

  /**
 * runtime: bootboot,  connect. 
   * @param {object} o { onLog }
   * @returns {Promise<{ok:boolean, serial?:string, adbPath?:string, reused?:boolean, error?:string}>}
   */
  // eslint-disable-next-line class-methods-use-this
  async ensure(o = {}) { return { ok: false, error: 'Not implemented' }; }

  /**
 * Androidwindow HWND(, ). 
 * (WinAgent) SetParent, success. 
   * @returns {Promise<string[]>}
   */
  // eslint-disable-next-line class-methods-use-this
  async windowTargets() { return []; }

  /**
 * window(/). 
 * default: window.  emulator window, 
 * default; hookruntime. 
   *
   * @param {object} o { isEmbedded?: () => boolean }
   * @returns {Promise<{ok:boolean, reason?:string}>}
   */
  async windowReady(o = {}) { // eslint-disable-line no-unused-vars
    const targets = await this.windowTargets().catch(() => []);
    return targets.length ? { ok: true } : { ok: false, reason: 'no-window' };
  }

  /**
 * window(boot / , emulator). 
 * window null. 
 * @returns {Promise<string|null>} HWND
   */
  async hideWindow() { return null; }

 /** runtime */
  // eslint-disable-next-line class-methods-use-this
  async stop(o = {}) { return { ok: false, error: 'Not implemented' }; }

 /** download/( CAPS.provision ) */
  // eslint-disable-next-line class-methods-use-this
  async install(component, onProgress) { return { ok: false, error: 'This backend does not support automatic provisioning' }; }

 /** (settings"runtime") */
  // eslint-disable-next-line class-methods-use-this
  usage() { return { total: 0, items: [] }; }

 /** data partition */
  // eslint-disable-next-line class-methods-use-this
  dataInfo() { return { ok: false }; }

 /** data partition */
  // eslint-disable-next-line class-methods-use-this
  async resizeData(mb) { return { ok: false, error: 'This backend does not support resizing the data partition' }; }

 /** Android */
  // eslint-disable-next-line class-methods-use-this
  async resetData() { return { ok: false, error: 'This backend does not support resetting data' }; }

 /** (ApkStart exit; default) */
  // eslint-disable-next-line class-methods-use-this
  dispose() {}

 /** diagnose() */
  // eslint-disable-next-line class-methods-use-this
  diagnose() { return {}; }
}

module.exports = { Backend, CAPS };
