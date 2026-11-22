'use strict';
/**
 * keyruntime
 *
 * appwindow， → app → adb input 。
 * pointer.js（mousehook）：mouse Qt + /wheelhook，
 * 。。
 *
 * ：
 * - Node ， Electron BrowserWindow（）；
 * - adb `execInput(cmd)` ， AdbClient；
 * - （default 50ms）， adb shell ；
 * - app，app。
 */

const { lookup, toCommand } = require('./keymap');

class KeymapEngine {
  /**
   * @param {object} opts
 * @param {Function} opts.execInput (cmd) => Promise — adb shell input 
 * @param {Function} opts.getSize () => {width, height} — LCD 
 * @param {number} [opts.minInterval=50] （ms）
   */
  constructor({ execInput, getSize, minInterval = 50 } = {}) {
    this._exec = execInput || (() => Promise.resolve());
    this._getSize = getSize || (() => ({ width: 720, height: 1280 }));
    this._minInterval = minInterval;
    this._lastExec = 0;
    this._enabled = false;
    // pkg → mappings[]
    this._maps = new Map();
  }

 /** settingsapp */
  setMap(pkg, mappings) {
    if (!pkg) return;
    if (!mappings || !mappings.length) { this._maps.delete(pkg); return; }
    this._maps.set(pkg, mappings);
  }

 /** app */
  getMap(pkg) { return this._maps.get(pkg) || []; }

 /** / */
  enable(on) { this._enabled = !!on; }
  get enabled() { return this._enabled; }

  /**
 * 。
   * @param {string} key Electron KeyboardEvent.key
 * @param {string} pkg app
 * @returns {Promise<boolean>} key（true = ）
   */
  async handleKey(key, pkg) {
    if (!this._enabled || !pkg) return false;
    const mappings = this._maps.get(pkg);
    if (!mappings || !mappings.length) return false;
    const hit = lookup(mappings, key);
    if (!hit) return false;
    const { width, height } = this._getSize();
    const cmd = toCommand(hit, width, height);
    if (!cmd) return false;
    // ： adb shell
    const now = Date.now();
    const wait = Math.max(0, this._minInterval - (now - this._lastExec));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this._lastExec = Date.now();
    try { await this._exec(cmd); } catch (_) { /* failure */ }
    return true;
  }
}

module.exports = { KeymapEngine };
