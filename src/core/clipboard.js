'use strict';

/**
 * ApkBolt Bidirectional Clipboard Synchronization Service
 * Keeps Windows host clipboard and Android guest clipboard in sync.
 */

class ClipboardSync {
  constructor(adb, options = {}) {
    this.adb = adb;
    this.pollIntervalMs = options.pollIntervalMs || 2500;
    this.maxTextLength = options.maxTextLength || 65536;
    this.lastHostText = '';
    this.lastGuestText = '';
    this.timer = null;
    this.enabled = false;
    this._clipboardModule = options.clipboard || null;
  }

  getClipboard() {
    if (this._clipboardModule) return this._clipboardModule;
    try {
      const { clipboard } = require('electron');
      return clipboard;
    } catch (_) {
      return null;
    }
  }

  start() {
    if (this.enabled) return;
    this.enabled = true;
    this.timer = setInterval(() => this.sync(), this.pollIntervalMs);
  }

  stop() {
    this.enabled = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncHostToGuest() {
    const cb = this.getClipboard();
    if (!cb) return false;
    try {
      const hostText = cb.readText();
      if (!hostText || hostText === this.lastHostText || hostText === this.lastGuestText) {
        return false;
      }
      if (hostText.length > this.maxTextLength) return false;

      this.lastHostText = hostText;
      // Send text to Android guest clipboard via adb cmd clipboard set text
      // Base64 encode to safely transmit special characters and newlines
      const b64 = Buffer.from(hostText, 'utf8').toString('base64');
      await this.adb.shell([
        'sh', '-c',
        `echo "${b64}" | base64 -d | cmd clipboard set text`
      ]);
      return true;
    } catch (_) {
      return false;
    }
  }

  async syncGuestToHost() {
    const cb = this.getClipboard();
    if (!cb) return false;
    try {
      const out = await this.adb.shell(['cmd', 'clipboard', 'get']);
      const guestText = String(out || '').trim();
      if (!guestText || guestText === this.lastGuestText || guestText === this.lastHostText) {
        return false;
      }
      if (guestText.length > this.maxTextLength) return false;

      this.lastGuestText = guestText;
      this.lastHostText = guestText;
      cb.writeText(guestText);
      return true;
    } catch (_) {
      return false;
    }
  }

  async sync() {
    if (!this.enabled || !this.adb) return;
    const pushed = await this.syncHostToGuest();
    if (!pushed) {
      await this.syncGuestToHost();
    }
  }
}

module.exports = {
  ClipboardSync,
};

