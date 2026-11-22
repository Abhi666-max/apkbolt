'use strict';
/**
 * :  Google Android Emulator(QEMU )
 *
 * ApkStart default, "": 
 * adb / emulator / system image ApkStart download, 
 * emulator. 
 *
 * core/engine.js(Runtime) core/emulator.js(EmulatorEngine), 
 * , , 
 * . 
 *
 * note:  Runtime ,  deps.runtime . 
 */
const fs = require('fs');
const path = require('path');
const { Backend, CAPS } = require('./base');
const { freeDiskMB } = require('../doctor');
const { diskRequiredMB, diskVerdict, hostProfile, memoryLimits, memVerdict, diskLimits } = require('../resources');

class BuiltinBackend extends Backend {
  static get id() { return 'builtin'; }

  static get label() { return 'Built-in Runtime (Android Emulator + QEMU)'; }

  static get summary() {
    return 'Zero third-party dependencies: ApkBolt downloads and manages an Android 14 image, with built-in ARM translation layer. '
      + 'First boot takes ~25 seconds; subsequent boots use a quickboot snapshot for near-instant start.';
  }

  static get embedCapable() { return true; }

  constructor(appRoot, deps = {}) {
    super(appRoot, deps);
    this.rt = deps.runtime || null;
  }

  get caps() {
    return new Set([
      CAPS.provision, CAPS.snapshot, CAPS.resizeData,
      CAPS.resetData, CAPS.rotatePanel, CAPS.priority, CAPS.shutdown,
    ]);
  }

  // serial getter:  `this.serial = ''`, 
  // getter,  TypeError( getter ). 
  // ensure() Runtime . 
  syncSerial() {
    if (this.rt) this.serial = this.rt.emuSerial || '';
    return this.serial;
  }

  running() { return !!(this.rt && this.rt.emuRunning); }

  async probe() {
    if (!this.rt) return { ok: false, found: false, detail: 'Runtime not initialized' };
    const p = this.rt.provisioner.paths();
    const found = fs.existsSync(p.emulatorExe) || fs.existsSync(p.adbExe);
    return { ok: true, found, path: p.emulatorExe, detail: p.root };
  }

  async check() {
    if (!this.rt) return { ok: false, reason: 'Runtime not initialized' };
    const env = await this.rt.provisioner.checkEnv().catch(() => null);
    if (!env) return { ok: false, reason: 'Runtime probe failed' };
    if (!env.adb.ok) return { ok: false, reason: 'adb not found', needs: 'adb' };
    if (!env.emulator.ok) return { ok: false, reason: 'Android Emulator not found', needs: 'emulator' };
    if (!env.sysimg.ok) return { ok: false, reason: 'System image not found', needs: 'sysimg' };
    return { ok: true, env };
  }

  async resolveAdb() { return this.rt ? this.rt.adbPath() : ''; }

  async ensure({ onLog = () => {} } = {}) {
    if (!this.rt) return { ok: false, error: 'Runtime not initialized' };
    const r = await this.rt.ensure({ onLog });
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'Android runtime failed to start' };
    // serial ( syncSerial ), ensure success
    this.syncSerial();
    this.adbPath = this.rt.adbPath();
    return {
      ok: true, serial: this.serial, adbPath: this.adbPath, reused: !!r.reused, client: r.client, engine: 'emulator',
    };
  }

  /**
 * emulator window: directory WinAgent 
 * FindEmulator() ( core/win/agent.ps1), window. 
   */
  async windowTargets() { return []; }

  /**
 * window. 
 * isEmbedded WinAgent ( agent.ps1 _emu window), 
 * true: path, . 
   */
  async windowReady({ isEmbedded } = {}) {
    if (typeof isEmbedded !== 'function') return { ok: true };
    return { ok: !!isEmbedded };
  }

  async stop({ graceful = true } = {}) {
    if (!this.rt) return { ok: false, error: 'Runtime not initialized' };
    const ok = await this.rt.stop({ graceful }).catch((e) => ({ error: e.message }));
    return { ok: ok !== false };
  }

  async install(component, onProgress = () => {}) {
    if (!this.rt) return { ok: false, error: 'Runtime not initialized' };
    const prov = this.rt.provisioner;
    switch (component) {
      case 'runtime': return prov.installRuntimePack(onProgress);
      case 'adb': return prov.installAdb(onProgress);
      case 'emulator': return prov.installEmulator(onProgress);
      case 'sysimg': return prov.installSystemImage(onProgress);
      case 'playimg': return prov.installPlayImage(onProgress);
      case 'aehd': return prov.installAehd(onProgress);
      case 'qemu': return prov.installQemu(onProgress);
      default: return { ok: false, error: `Unknown component: ${component}` };
    }
  }

  usage() { return this.rt ? this.rt.usage() : { total: 0, items: [] }; }

  dataInfo() { return this.rt ? this.rt.emulator.dataInfo() : { ok: false }; }

  /**
 * settings:  + . 
 * runtimememory/CPU qemu , Android; 
 * data partition(resizeData), app. 
   */
  resources() {
    const info = this.dataInfo() || {};
    const host = hostProfile();
    const eng = (this.rt && this.rt.settings && this.rt.settings.engine) || {};
    const freeMB = info.avdDir ? freeDiskMB(info.avdDir) : 0;
    const memMB = Number(eng.memoryMB) || 0;
    return {
      backend: 'builtin',
      host,
      limits: { ...memoryLimits(host.totalMB), ...diskLimits(freeMB) },
      wanted: { memoryGB: memMB ? Math.round((memMB / 1024) * 2) / 2 : 0, cores: Number(eng.cores) || 0 },
      current: {
        memoryGB: memMB ? Math.round((memMB / 1024) * 2) / 2 : 0,
        cores: Number(eng.cores) || 0,
        dataGB: Number(info.configuredGB) || 0,
        imageGB: Number(info.imageGB) || 0,
      },
      freeMB,
      pending: false,
      verdict: memVerdict(memMB, host.totalMB),
      note: 'Built-in runtime: memory/CPU changes take effect on the next Android start. After increasing the data partition, click "Expand Now" - if live expansion is possible, installed apps are preserved; if Android is using the quickboot diff disk, you will be prompted to reset and rebuild at the new size.',
    };
  }

  /**
 * : disk,  /data . 
 * 50GB downloadfailure,  userdata system image
 * default 6/8GB -- dexopt INSTALL_INSUFFICIENT_STORAGE. 
   */
  checkDiskFor(bytes) {
    const info = this.dataInfo() || {};
    const need = diskRequiredMB(bytes);
    const phys = diskVerdict(info.avdDir ? freeDiskMB(info.avdDir) : 0, need);
    if (!phys.ok) return phys;
    const capGB = Number(info.configuredGB) || 0;
    if (capGB && capGB * 1024 < need) {
      return {
        ok: false,
        message: `Android data partition too small: currently ${capGB} GB, this game needs at least ${Math.ceil(need / 1024)} GB. `
          + 'Increase the data partition size in Settings → Engine, then restart Android (live expansion - installed apps are preserved).',
      };
    }
    return { ok: true, requiredMB: need };
  }

  async resizeData(mb) { return this.rt ? this.rt.emulator.resizeDataPartition(mb) : { ok: false }; }

  async resetData() { return this.rt ? this.rt.resetAndroidData() : { ok: false }; }

  dispose() {
    // Runtime.dispose():  qemu , launch
  }

  diagnose() {
    const p = this.rt ? this.rt.provisioner.paths() : {};
    return {
      backend: 'builtin',
      serial: this.serial,
      root: p.root || '',
      emulator: p.emulatorExe || '',
      running: this.running(),
    };
  }
}

module.exports = { BuiltinBackend, BACKEND_ROOT: path.dirname(__dirname) };
