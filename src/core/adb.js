'use strict';
/**
 * adb 
 * apkbolt : install / launch / / uninstall / / 
 */
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { autoRotateSetting } = require('./orientation');

/**
 * In-guest"rotate" guest ('1' / '0' ). 
 * orientation -- setOrientation / resetDisplayOverrides 
 * `wm user-rotation lock 0` + `wm set-ignore-orientation-request` orientation. 
 * settings"", app setting . 
 */
function guestAutoRotate() {
  try { return autoRotateSetting(store.getSettings()); } catch (_) { return '1'; }
}

/**
 * . 
 * 720 ÷ (190/160) = 606dp ≥ 600dp,  Android ; 
 * 320dpi(system imagedefault) 360dp, . 
 */
const TABLET_DENSITY = 190;
function tabletDensity() {
  try {
    return (store.getSettings().display || {}).tabletMode !== false ? String(TABLET_DENSITY) : 'reset';
  } catch (_) {
    return String(TABLET_DENSITY);
  }
}

/**
 * adb . ** Android SDK installdirectory**: 
 * emulator adb(MuMu / / ) -- adb 
 * server (, , offline ), "". 
 * adb runtimedirectory, ( engine.adbPath). 
 */
const COMMON_ADB_PATHS = [
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  'C:/Android/platform-tools/adb.exe',
  'C:/adb/adb.exe',
];

/**
 * Translates raw pm install failure codes into user-friendly English messages.
 * The original error code is preserved at the end for searchability.
 */
function friendlyInstallError(raw) {
  const code = /INSTALL_[A-Z_]+/.exec(raw);
  const tag = code ? code[0] : '';
  const table = {
    INSTALL_FAILED_NO_MATCHING_ABIS:
      'Install failed: This app only provides ARM native libraries (common for many apps). '
      + 'The current system image has no ARM translation layer. ApkBolt will automatically switch to the compatible image with a built-in translation layer and retry.',
    INSTALL_FAILED_OLDER_SDK:
      'Install failed: This app requires a higher Android version than the current runtime (a newer system image is needed).',
    INSTALL_PARSE_FAILED_NO_CERTIFICATES:
      'Install failed: The APK has no valid signature and cannot be installed.',
    INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES:
      'Install failed: The APK signature does not match the installed version. Please uninstall the old version first.',
    INSTALL_FAILED_VERSION_DOWNGRADE:
      'Install failed: A higher version is already installed. Downgrade installs are not allowed.',
    INSTALL_FAILED_INSUFFICIENT_STORAGE:
      'Install failed: The runtime is out of disk space. Please free up space and try again.',
    INSTALL_FAILED_INVALID_APK:
      'Install failed: The APK file is corrupted or incomplete (download may not have finished). Please re-download it.',
    INSTALL_FAILED_INVALID_URI: 'Install failed: The APK path contains special characters. Please move the file to a path with only English characters and try again.',
    INSTALL_FAILED_ALREADY_EXISTS: 'Install failed: An app with the same name but a different signature already exists. Please uninstall it first.',
    INSTALL_FAILED_UPDATE_INCOMPATIBLE: 'Install failed: The APK signature does not match the installed version. Please uninstall the old version first.',
    INSTALL_FAILED_DEPRECATED_SDK_VERSION:
      'Install failed: This app targets a very old Android version (targetSdk too low) and Android 14 blocks it by default. '
      + 'ApkBolt will automatically retry with the official bypass flag.',
    INSTALL_FAILED_TEST_ONLY: 'Install failed: This is a test-only package. Retrying automatically with the test package flag.',
    INSTALL_FAILED_MISSING_SHARED_LIBRARY: 'Install failed: The app depends on a device feature (such as a vendor-specific library) that is not present in the current runtime.',
    INSTALL_FAILED_USER_RESTRICTION: 'Install failed: The system has restricted installation. Please restart the runtime and try again.',
    INSTALL_FAILED_CONFLICTING_PROVIDER: 'Install failed: This app conflicts with an existing app\'s ContentProvider. Please uninstall the conflicting app.',
    INSTALL_FAILED_INTERNAL_ERROR: 'Install failed: Internal system error (often caused by insufficient storage or an incomplete boot). Please restart the runtime and try again.',
  };
  const msg = table[tag];
  return msg ? `${msg} (${tag})` : `Install failed: ${raw}`;
}

/** Translates a post-launch crash log into a readable English reason */
function friendlyLaunchError(raw, pkg) {
  const t = String(raw || '');
  if (/DoBadTrampoline|libndk_translation|houdini|SIGABRT.*arm/i.test(t)) {
    return `${pkg || 'App'} crashed after launch: ARM translation layer is incompatible with this app's signal handling. ` + 'ApkBolt will automatically switch to the Android 14 compatible image and retry.';
  }
  if (/UnsatisfiedLinkError|dlopen failed|couldn't find "lib|\.so.*not found/i.test(t)) {
    return `${pkg || 'App'} crashed after launch: Missing native library (this app may only provide ARM binaries). ` + 'Automatically switching to the compatible image with the ARM translation layer and retrying.';
  }
  if (/ClassNotFoundException|NoClassDefFoundError|AndroidRuntime/i.test(t)) {
    return `${pkg || 'App'} crashed immediately after launch (internal app exception - may be related to the emulator environment or missing Google services).`;
  }
  if (/java\.lang\.SecurityException|Permission Denial/i.test(t)) {
    return `${pkg || 'App'} failed to launch: The system denied the launch request (permission or signature issue).`;
  }
  return `${pkg || 'App'} failed to start${t ? `: ${t.slice(0, 240)}` : ' (process did not survive)'}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `adb devices` serial state . 
 * : unauthorized `get-state` 'device',  devices 
 * state authorized / unauthorized / offline -- bootprobeself-healing. 
 */
function parseDeviceState(text, serial) {
  const lines = String(text || '').split(/\r?\n/).slice(1);
  for (const line of lines) {
    const m = /^(\S+)\s+(unauthorized|offline|recovery|sideload|no\s+permissions|device)\b/i.exec(line.trim());
    if (!m) continue;
    if (serial && m[1] !== serial) continue;
    const st = m[2].toLowerCase().replace(/\s+/g, '');
    if (st === 'device') return 'device';
    if (st === 'unauthorized' || st === 'nopermissions') return 'unauthorized';
    return st; // offline / recovery / sideload
  }
  return 'no-device';
}

/** " USB " shell error unauthorized */
function isUnauthorizedError(raw) {
  return /\bunauthorized\b|no permissions|confirm.*(allow|debug)/i.test(String(raw || ''));
}

/** `pm path <pkg>` APK path */
function parsePmPaths(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => /^package:/.test(l)).map((l) => l.slice(8).trim()).filter(Boolean);
}

/** launch(adbPath|pkg → activity), 10 */
const LAUNCHER_CACHE = new Map();

/**
 * Windows adb ASCII path(/downloaddirectory). 
 * install APK ASCII temporarydirectory, . 
 */
function stageApk(apkPath) {
  const p = String(apkPath || '');
  if (/^[\x20-\x7e]*$/.test(p) && p.length < 200) return { path: p, staged: false };
  const dir = path.join(os.tmpdir(), 'apkbolt-install');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.createHash('sha1').update(p).digest('hex').slice(0, 12)}.apk`;
  const target = path.join(dir, name);
  fs.copyFileSync(p, target);
  return { path: target, staged: true };
}

function unstage(staged) {
  if (!staged) return;
  try { fs.rmSync(staged, { force: true }); } catch (_) { /* ignore */ }
}

/**
 * "Activity" am start -n . 
 * : 
 * - (version apps.json ): `MainActivity` / `.MainActivity` → `<pkg>/<activity>`
 * - (`cmd package resolve-activity` ): `com.a.b/.Main` → 
 * `${pkg}/${activity}`,  `pkg/pkg/class`, 
 * am start (result code=-92), "Androiddesktop". 
 */
function componentArg(pkg, activity) {
  const a = String(activity || '').trim();
  if (!a) return '';
  if (a.includes('/')) return a;
  return `${pkg}/${a}`;
}

/** `cmd package resolve-activity --brief` pkg (/priority ) */
function parseResolvedActivity(pkg, out) {
  const lines = String(out || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = /^([\w.]+)\/([.\w$]+)$/.exec(lines[i]);
    if (m && m[1] === pkg) return `${m[1]}/${m[2]}`;
  }
  return '';
}

/**
 * adb install timeout 240s,  2GB+ install
 * "push + install + dexopt" 4 : timeoutinstallfailure, 
 * "/failure". ,  20 . 
 */
function installTimeoutMs(bytes) {
  const mb = Math.max(1, Number(bytes || 0) / 1048576);
  return Math.min(1200000, Math.max(240000, Math.round(60000 + mb * 120)));
}

class AdbError extends Error {
  constructor(message, stderr, code) {
    super(message);
    this.stderr = stderr;
    this.code = code;
  }
}

/**
 * `find -exec stat -c '%Y|%s|%n'` . 
 * null stat (). 
 */
function parseStatList(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const rows = [];
  for (const l of lines) {
    const m = /^(\d{9,})\|(\d+)\|(.+)$/.exec(l);
    if (!m) continue;
    const rel = m[3].replace(/^\.\//, '');
    if (!rel || rel.endsWith('/')) continue;
    rows.push({ rel, size: Number(m[2]), mtime: Number(m[1]) * 1000 });
  }
  // → stat
  if (!rows.length) return null;
  return rows;
}

class AdbClient {
  constructor({ adbPath, serial }) {
    this.adbPath = adbPath || 'adb';
    this.serial = serial || '';
    this._input = null;        // resident `adb shell`
    this._inputSeq = 0;
    this._waiters = new Map(); // id -> { resolve, reject, timer, token }
  }

  static resolveAdb(explicit, appRoot) {
    const candidates = [
      explicit,
      appRoot && path.join(appRoot, 'tools', 'platform-tools', 'adb.exe'),
      ...COMMON_ADB_PATHS,
    ].filter(Boolean);
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch (_) { /* ignore */ }
    }
    return 'adb'; // PATH
  }

  _args(args, withSerial = true) {
    const a = [];
    if (withSerial && this.serial) a.push('-s', this.serial);
    return a.concat(args);
  }

  _adbEnv() {
    const env = { ...process.env, ANDROID_ADB_SERVER_PORT: process.env.ANDROID_ADB_SERVER_PORT || '5044' };
    // Play system image ADB : host adb server guest adbd
    // adbkey.  adb/emulator %USERPROFILE%\.android\adbkey{,.pub}, 
    // emulator launch adbkey.pub guest /data/misc/adb/adb_keys. 
    // adb server :  ANDROID_SDK_HOME / runtime
    // adb key, cold boot" USB "→ device unauthorized. 
    if (!env.ADB_VENDOR_KEYS) {
      const home = process.env.USERPROFILE || process.env.HOME || '';
      const keyDir = path.join(home, '.android');
      try { if (home && fs.existsSync(keyDir)) env.ADB_VENDOR_KEYS = keyDir; } catch (_) { /* ignore */ }
    }
    return env;
  }

  exec(args, { timeout = 30000, withSerial = true, binary = false } = {}) {
    return new Promise((resolve, reject) => {
      const finalArgs = this._args(args, withSerial);
      execFile(this.adbPath, finalArgs, {
        timeout,
        maxBuffer: 64 * 1024 * 1024,
        encoding: binary ? 'buffer' : 'utf8',
        windowsHide: true,
        // runtimeemulator adb server (default 5044),  5037
        // WSA / emulator adb ,  offline
        env: this._adbEnv(),
      }, (err, stdout, stderr) => {
        if (err) {
          // adb install failure stdout exit 0; 
          // stderr, "failure". 
          const text = [stdout, stderr, err.message].filter(Boolean).join('\n').trim();
          const e = new AdbError(`adb ${finalArgs.join(' ')} failed: ${text}`, stderr, err.code);
          e.stdout = stdout;
          e.raw = text;
          return reject(e);
        }
        resolve({ stdout, stderr });
      });
    });
  }

  async shell(cmd, opts = {}) {
    const { stdout } = await this.exec(['shell', cmd], opts);
    return typeof stdout === 'string' ? stdout.trim() : stdout;
  }

  /**
 * resident. 
 * wheel/: wheel execFile adb , 
 * desktop.  `adb shell`, , 
 * echo -- , , 
 * shell . 
   */
  _inputSession() {
    const old = this._input;
    if (old && old.exitCode === null && !old.killed && old.stdin && old.stdin.writable) return old;
    if (old) this.disposeInput();

    const p = spawn(this.adbPath, this._args(['shell'], true), {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: this._adbEnv(),
    });
    this._input = p;
    let buf = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        for (const [id, w] of this._waiters) {
          // :  shell , 
          // contains """", . 
          if (line === w.token) {
            this._waiters.delete(id);
            clearTimeout(w.timer);
            w.resolve(true);
            break;
          }
        }
      }
    });
    p.stderr.on('data', () => { /* ignore: fallback */ });
    p.stdin.on('error', () => { /* exit clean */ });
    p.on('error', () => { this._failWaiters(new Error('adb shell failed to start')); });
    p.on('exit', () => {
      if (this._input === p) this._input = null;
      this._failWaiters(new Error('adb shell exited'));
    });
    return p;
  }

  _failWaiters(err) {
    for (const [, w] of this._waiters) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    this._waiters.clear();
  }

 /** whitelist input ; failurereclaim,  adb */
  async input(cmd, { timeout = 4000 } = {}) {
    const { isInputCommand } = require('./pointer');
    if (!isInputCommand(cmd)) throw new Error('Invalid input command');
    const p = this._inputSession();
    const id = ++this._inputSeq;
    const token = `__APKBOLT_${id}__`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._waiters.delete(id);
        this.disposeInput();
        reject(new Error('Input command timed out'));
      }, timeout);
      this._waiters.set(id, { resolve, reject, timer, token });
      try {
        p.stdin.write(`${cmd}; echo ${token}\n`);
      } catch (e) {
        this._waiters.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  disposeInput() {
    const p = this._input;
    this._input = null;
    for (const [, w] of this._waiters) {
      clearTimeout(w.timer);
      w.reject(new Error('Input channel closed'));
    }
    this._waiters.clear();
    if (p) {
      try { p.stdin.end(); } catch (_) { /* ignore */ }
      try { p.kill(); } catch (_) { /* ignore */ }
    }
  }

  async version() {
    const { stdout } = await this.exec(['version'], { withSerial: false });
    const m = /version\s+([\d.]+)/i.exec(stdout);
    return m ? m[1] : stdout.trim();
  }

  async connect() {
    if (!this.serial.includes(':')) return true;
    try {
      await this.exec(['connect', this.serial], { withSerial: false, timeout: 15000 });
    } catch (_) { /*  */ }
    return this.isOnline();
  }

  async isOnline() {
    try {
      const { stdout } = await this.exec(['get-state'], { timeout: 8000 });
      return stdout.trim() === 'device';
    } catch (_) {
      // get-state serial ,  devices
      try {
        const { stdout } = await this.exec(['devices'], { withSerial: false, timeout: 8000 });
        return stdout.split('\n').some((l) => l.startsWith(this.serial) && l.includes('device'));
      } catch (_) {
        return false;
      }
    }
  }

  /**
 * serial `adb devices` : device / unauthorized / offline / no-device. 
 * isOnline() get-state authorized unauthorized( 'device'), 
 * bootprobe""self-healing. 
   */
  async deviceState() {
    try {
      const { stdout } = await this.exec(['devices'], { withSerial: false, timeout: 8000 });
      return parseDeviceState(stdout, this.serial);
    } catch (_) {
      return 'no-device';
    }
  }

  async devices() {
    const { stdout } = await this.exec(['devices', '-l'], { withSerial: false });
    return stdout.split('\n').slice(1)
      .map((l) => l.trim())
      .filter((l) => l && l.includes('device') && !l.startsWith('*'))
      .map((l) => {
        const parts = l.split(/\s+/);
        return { serial: parts[0], state: parts[1], model: (l.match(/model:(\S+)/) || [])[1] || '' };
      })
      .filter((d) => d.state === 'device');
  }

  /**
 * install APK, fallback: 
 * - default -g(system image PermissionController ); 
 * - --bypass-low-target-sdk-block,  Android 14 install targetSdk app; 
 * - adb versionparameters / path / errorretry; 
 * - NO_MATCHING_ABIS code error, system image. 
   */
  async install(apkPath) {
    if (!fs.existsSync(apkPath)) throw new Error(`APK not found: ${apkPath}`);
    const staged = stageApk(apkPath);
    const file = staged.path;
    const variants = [
      // -g runtime, app; system imagefallback
      ['install', '-r', '-t', '-g', '--bypass-low-target-sdk-block', file],
      ['install', '-r', '-t', '--bypass-low-target-sdk-block', file],
      ['install', '-r', '-t', file],
      ['install', '-r', file],
    ];
    let last = '';
    let timeout = 240000;
    try { timeout = installTimeoutMs(fs.statSync(file).size); } catch (_) { /* default */ }
    try {
      for (const args of variants) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const { stdout } = await this.exec(args, { timeout });
          if (/Failure|Error/i.test(stdout) && !/Success/i.test(stdout)) {
            throw new Error(String(stdout).trim());
          }
          return stdout.trim();
        } catch (e) {
          const raw = String(e.raw || e.stdout || e.message || '');
          last = raw;
          const tag = (/INSTALL_[A-Z_]+/.exec(raw) || [])[0] || '';

          if (tag === 'INSTALL_FAILED_NO_MATCHING_ABIS') {
            const err = new Error(friendlyInstallError(raw));
            err.code = 'NO_MATCHING_ABIS';
            err.raw = raw;
            throw err;
          }
          // adb parameters / →
          if (/Unknown option|unrecognized option|Unknown command/i.test(raw)) continue;
          if (tag === 'INSTALL_FAILED_TEST_ONLY' || tag === 'INSTALL_FAILED_DEPRECATED_SDK_VERSION') continue;
          // error(, adb server restart)retry
          if (/device (not found|offline)|closed|protocol fault|no devices/i.test(raw)) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(1500);
            continue;
          }
          if (tag) {
            const err = new Error(friendlyInstallError(raw));
            err.code = tag;
            err.raw = raw;
            throw err;
          }
          // error: 
        }
      }
      const err = new Error(friendlyInstallError(last || 'Install failed (no specific reason provided)'));
      err.code = (/INSTALL_[A-Z_]+/.exec(last) || [])[0] || 'INSTALL_UNKNOWN';
      err.raw = last;
      throw err;
    } finally {
      unstage(staged.staged ? file : null);
    }
  }

 /** APK(.apks / .xapk split) install-multiple */
  async installMultiple(apkPaths) {
    if (!apkPaths || !apkPaths.length) throw new Error('No split APKs found to install');
    const staged = apkPaths.map((p) => stageApk(p));
    const files = staged.map((s) => s.path);
    const totalBytes = staged.reduce((n, s) => n + (fs.existsSync(s.path) ? fs.statSync(s.path).size : 0), 0);
    const timeout = installTimeoutMs(totalBytes);
    try {
      for (const extra of [['-r', '-t', '--bypass-low-target-sdk-block'], ['-r', '-t']]) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const { stdout } = await this.exec(['install-multiple', ...extra, ...files], { timeout });
          if (/Failure|Error/i.test(stdout) && !/Success/i.test(stdout)) throw new Error(stdout);
          return stdout.trim();
        } catch (e) {
          const raw = String(e.raw || e.stdout || e.message || '');
          if (/Unknown option|unrecognized option/i.test(raw)) continue;
          if (/INSTALL_FAILED_NO_MATCHING_ABIS/.test(raw)) {
            const err = new Error(friendlyInstallError(raw));
            err.code = 'NO_MATCHING_ABIS';
            throw err;
          }
          throw new Error(friendlyInstallError(raw));
        }
      }
      throw new Error('Split APK installation failed');
    } finally {
      staged.forEach((s) => unstage(s.staged ? s.path : null));
    }
  }

  async uninstall(pkg) {
    try {
      await this.exec(['uninstall', pkg], { timeout: 60000 });
    } catch (e) {
      // user
      await this.exec(['shell', 'pm', 'uninstall', '--user', '0', pkg], { timeout: 60000 });
    }
  }

  /**
 * -- PackageManager . 
   *
 * snapshotdata partition, `pm path` packages.xml 
 * `package:/data/app/.../base.apk`(installed=true),  APK 
 * .  `am start` failure.  `test -f/-s` pm 
 * path, ()"install", . 
   *
   * @returns {Promise<boolean>}
   */
  async isInstalled(pkg) {
    const out = await this.shell(`pm path ${pkg}`);
    const paths = parsePmPaths(out);
    if (!paths.length) return false;
    // split APK ; launch.  shell,  adb . 
    const checks = paths.map((p) => `[ -s "${p}" ]`).join(' && ');
    const probe = await this.shell(`${checks} && echo __APKBOLT_PRESENT__`, { timeout: 10000 }).catch(() => '');
    return /__APKBOLT_PRESENT__/.test(String(probe));
  }

  async listPackages() {
    const out = await this.shell('pm list packages -3');
    return out.split('\n').map((l) => l.replace('package:', '').trim()).filter(Boolean);
  }

 /** launch Activity(fallback) */
 /** appupgrade, cache */
  clearLauncherCache(pkg) {
    if (!pkg) { LAUNCHER_CACHE.clear(); return; }
    LAUNCHER_CACHE.delete(`${this.adbPath}|${pkg}`);
  }

  async resolveLauncher(pkg) {
    // Activity adb (~200-400ms), launch. 
    // cache, app; 10 , app. 
    const key = `${this.adbPath}|${pkg}`;
    const hit = LAUNCHER_CACHE.get(key);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;
    try {
      const out = await this.shell(
        `cmd package resolve-activity --brief ${pkg}`, { timeout: 10000 },
      );
      const comp = parseResolvedActivity(pkg, out);
      if (comp) {
        LAUNCHER_CACHE.set(key, { value: comp, at: Date.now() });
        return comp;
      }
    } catch (_) { /* monkey */ }
    return null;
  }

 /** app: am start success ≠ */
  async waitAppAlive(pkg, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // eslint-disable-next-line no-await-in-loop
      const pid = await this.shell(`pidof ${pkg}`, { timeout: 6000 }).catch(() => '');
      if (String(pid).trim()) return { ok: true };
      // 350ms ( 1000ms): , launch. 
      // pidof shell, , "". 
      // eslint-disable-next-line no-await-in-loop
      await sleep(350);
    }
    let crash = '';
    try {
      crash = await this.shell(
        `logcat -d -t 250 -v brief AndroidRuntime:E DEBUG:E libc:E 2>/dev/null | `
        + `grep -i -E '${pkg}|FATAL|ndk_translation|SIGABRT|SIGSEGV|UnsatisfiedLink' | tail -n 30`,
        { timeout: 12000 },
      );
    } catch (_) { /* ignore */ }
    const text = String(crash || '').trim();
    // logfailure: applaunch 20-40
    return { ok: false, crash: text, uncertain: !text };
  }

  /**
 * launchapp, fallback: 
 * freeform window → → monkey fallback; 
 * ,  logcat code errorsystem image. 
   */
  async startApp(pkg, activity, { freeform = true, bounds = null, forceStop = false } = {}) {
    if (forceStop) await this.forceStop(pkg);
    // LAUNCHER ,  APK Activity: 
    // app()launch,  Activity
    // "had you called RpcService.init", . 
    const resolved = (await this.resolveLauncher(pkg).catch(() => '')) || activity;
    // resolved (pkg/class), ( apps.json); 
    // am start -n ,  pkg/pkg/class . 
    const comp = componentArg(pkg, resolved);
    const intent = comp
      ? ['-n', comp]
      : ['-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', pkg];
    const modes = freeform
      ? [['--windowingMode', '5'], []]
      : [[]];
    let lastError = '';

    for (const mode of modes) {
      const parts = ['am', 'start', ...mode, '--activity-clear-top', ...intent];
      let out = '';
      try {
        // eslint-disable-next-line no-await-in-loop
        out = await this.shell(parts.join(' '), { timeout: 20000 });
      } catch (e) {
        lastError = String(e.message || e);
        continue;
      }
      if (/Error|Exception/i.test(out)) { lastError = out; continue; }

      if (bounds) this.resizeTaskOfPackage(pkg, bounds).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      const alive = await this.waitAppAlive(pkg, 6000);
      if (alive.ok) return out;
      if (alive.uncertain) return `${out}\n(App is still loading)`;
      lastError = alive.crash || lastError;
      // log ARM retry, system image
      if (/DoBadTrampoline|libndk_translation|UnsatisfiedLinkError|dlopen failed/i.test(alive.crash || '')) {
        const err = new Error(friendlyLaunchError(alive.crash, pkg));
        err.code = 'APP_CRASHED';
        err.crash = alive.crash;
        throw err;
      }
    }

    // monkey fallback: system image am start -a/-c/-p launcher
    try {
      const out = await this.shell(
        `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`, { timeout: 20000 },
      );
      const alive = await this.waitAppAlive(pkg, 12000);
      if (alive.ok || alive.uncertain) return out;
      lastError = alive.crash || lastError;
    } catch (e) {
      // , launcherror
      if (!lastError) lastError = String(e.message || e);
    }

    if (!lastError) return 'started';
    const err = new Error(friendlyLaunchError(lastError, pkg));
    err.code = 'APP_CRASHED';
    err.crash = lastError;
    throw err;
  }

  async forceStop(pkg) {
    try { await this.shell(`am force-stop ${pkg}`); } catch (_) { /* ignore */ }
  }

  async runningPackages() {
    try {
      const out = await this.shell('dumpsys activity activities | grep -E "mResumedActivity|ResumedActivity"');
      const pkgs = [...out.matchAll(/([a-zA-Z][\w.]+\/[.\w$]+)/g)].map((m) => m[1].split('/')[0]);
      return [...new Set(pkgs)];
    } catch (_) {
      return [];
    }
  }

  async taskIdOfPackage(pkg) {
    try {
      const out = await this.shell('dumpsys activity recents');
      const blocks = out.split('Recent #');
      for (const b of blocks) {
        if (!b.includes(pkg)) continue;
        const m = /taskId=(\d+)/.exec(b) || /^\d+/.exec(b);
        if (m) return Number(m[1] || m[0]);
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  async resizeTaskOfPackage(pkg, bounds) {
    const id = await this.taskIdOfPackage(pkg);
    if (!id) return false;
    await this.shell(`am task resize ${id} ${bounds.left} ${bounds.top} ${bounds.right} ${bounds.bottom}`);
    return true;
  }

 /** freeform(window), failure */
  async ensureFreeform() {
    // adb shell: 4 execFile Windows 600ms+, 
    // "app". 
    const out = await this.shell(
      'settings put global enable_freeform_support 1 ; '
      + 'settings put global force_resizable_activities 1 ; '
      + 'settings put global development_settings_enabled 1 ; '
      + 'settings get global enable_freeform_support',
      { timeout: 12000 },
    ).catch(() => '0');
    return String(out).trim().split(/\r?\n/).pop().trim() === '1';
  }

  async wmSize() {
    const out = await this.shell('wm size');
    const m = /(\d+)x(\d+)/.exec(out.split('\n').pop() || out);
    return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
  }

  async androidVersion() {
    return (await this.shell('getprop ro.build.version.release').catch(() => '')).trim();
  }

  async sdkInt() {
    const v = await this.shell('getprop ro.build.version.sdk').catch(() => '0');
    return Number(v.trim()) || 0;
  }

  async screenshot() {
    const { stdout } = await this.exec(['exec-out', 'screencap', '-p'], { binary: true, timeout: 20000 });
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  }

  async push(local, remote) {
    await this.exec(['push', local, remote], { timeout: 180000 });
  }

  async pull(remote, local) {
    await this.exec(['pull', remote, local], { timeout: 180000 });
  }

  async shellMkdir(remote) {
    await this.shell(`mkdir -p "${remote}"`);
  }

  async listRemote(remote) {
    const out = await this.shell(`ls -l "${remote}" 2>/dev/null`);
    return String(out).split('\n').map((line) => {
      const l = line.trim();
      if (!l || l.startsWith('total ')) return null;
      // Android ls -l " group"" group", 
      // "2026-11-12 18:52" "Nov 12 18:52", . 
      // 2 , . 
      const parts = l.split(/\s+/);
      if (parts.length < 6 || !/^[\-dl]/.test(parts[0])) return null;
      const sizeIdx = parts.findIndex((p, i) => i >= 2 && /^\d+$/.test(p)
        && /(\d{4}-\d{2}-\d{2}|^[A-Za-z]{3}$)/.test(parts[i + 1] || ''));
      if (sizeIdx < 0) return null;
      const size = Number(parts[sizeIdx]);
      // ":"token ( 2-3 token, )
      const timeIdx = parts.findIndex((p, i) => i > sizeIdx && /^\d{1,2}:\d{2}(:\d{2})?$/.test(p));
      const name = parts.slice((timeIdx >= 0 ? timeIdx : sizeIdx + 2) + 1).join(' ');
      return name ? { isDir: parts[0][0] === 'd', size, name } : null;
    }).filter(Boolean);
  }

  /**
 * mtime (toybox stat). 
 * ls -l " :", , "". 
 * null stat,  listRemote. 
   */
  async listRemoteStat(remote) {
    let out = '';
    try {
      out = await this.shell(`cd "${remote}" 2>/dev/null && find . -type f -exec stat -c '%Y|%s|%n' {} + 2>/dev/null`);
    } catch (_) {
      return null;
    }
    const rows = parseStatList(out);
    if (!rows) return null;
    return rows;
  }

 /** app */
  async clearData(pkg) {
    await this.shell(`pm clear ${pkg}`);
    // , launch,  permGranted cache
    try { store.upsertApp({ package: pkg, permGranted: false }); } catch (_) { /* ignore */ }
  }

 /** app(Windows/ run-as;  adb backup fallback) */
  async exportAppData(pkg, localTarPath) {
    const remote = `/sdcard/apkbolt-tmp-${pkg}.tar`;
    const cmd = `run-as ${pkg} tar -cf ${remote} . 2>/dev/null || (cd /data/data/${pkg} && tar -cf ${remote} .)`;
    await this.shell(cmd);
    await this.pull(remote, localTarPath);
    await this.shell(`rm -f ${remote}`).catch(() => {});
    return localTarPath;
  }

  async batteryOptimizeOff(pkg) {
    try { await this.shell(`dumpsys deviceidle whitelist +${pkg}`); } catch (_) { /* ignore */ }
  }

  /**
 * appruntime. 
 * : ① launch, "app"; 
 * ② (pm clear), app. 
   *
 * : `dumpsys package` guest app_process( 1~3s), 
 * `pm grant` / `cmd appops set` . app, 
 * 20 (log permissions granted +18s +42s). 
 * ,  pm clear , 
 * apps.json , launch; /. 
   */
  async grantRuntimePermissions(pkg) {
    try {
      const rec = store.getApp(pkg);
      if (rec && rec.permGranted === true) return [];
    } catch (_) { /*  */ }
    let dump = '';
    try {
      dump = await this.shell(`dumpsys package ${pkg}`, { timeout: 20000 });
    } catch (_) {
      return [];
    }
    const lines = String(dump).split(/\r?\n/);
    let inRuntime = false;
    const denied = [];
    for (const line of lines) {
      if (/^\s*runtime permissions:/.test(line)) { inRuntime = true; continue; }
      if (!inRuntime) continue;
      if (/^\s{0,6}\S/.test(line)) break; // runtime permissions
      const m = /^\s+([A-Za-z0-9_.]+):\s*granted=(\w+)/.exec(line);
      if (m && m[2] === 'false') denied.push(m[1]);
    }
    const granted = [];
    // : pm grant Windows 150ms+, 
    // 1 , . 
    const cmds = [];
    for (const p of denied) cmds.push(`pm grant ${pkg} ${p}`);
    // appops, 
    const ops = ['MANAGE_EXTERNAL_STORAGE', 'SYSTEM_ALERT_WINDOW', 'REQUEST_INSTALL_PACKAGES', 'WRITE_SETTINGS'];
    for (const op of ops) cmds.push(`cmd appops set ${pkg} ${op} allow`);
    if (cmds.length) {
      await this.shell(cmds.join(' ; '), { timeout: 20000 }).catch(() => '');
      granted.push(...denied);
    }
    // : failureretry, ""
    try { store.upsertApp({ package: pkg, permGranted: true }); } catch (_) { /* ignore */ }
    return granted;
  }

  /**
 * "app": 
 * - , bootapp; 
 * - (, mouse/); 
 * - , . 
 * settings , , . 
   */
  async prepareForeground() {
    // 7 ,  adb (Windows 150~250ms), 
    // 1~1.7 , "app".  shell . 
    const cmds = [
      'wm dismiss-keyguard',
      'settings put global policy_control immersive.status=*',
      'settings put secure immersive_mode_confirmations confirmed',
      'settings put global window_animation_scale 0',
      'settings put global transition_animation_scale 0',
      'settings put global animator_duration_scale 0',
      'settings put system screen_off_timeout 2147483647',
      // taskbar:  Pixel Launcher resident Taskbar, 
      // app, key("key"). 
      // disableLauncherTaskbar(): launch, . 
      'settings put global enable_taskbar 0',
      // : Androiddefault connectivitycheck.gstatic.com "", 
      // , network"!"(), 
      // app, .  204 endpoint. 
      // launch(,  shell , ), snapshot
      // , settings, . 
      'settings put global captive_portal_http_url http://connect.rom.miui.com/generate_204',
      'settings put global captive_portal_https_url https://connect.rom.miui.com/generate_204',
      'settings put global captive_portal_mode 0',
      // note:  wm user-rotation / accelerometer_rotation. 
      // orientation setOrientation / resetDisplayOverrides portrait, 
      // lock 0 landscapeorientationportrait(). 
    ];
    await this.shell(cmds.join(' ; '), { timeout: 15000 }).catch(() => {});
    return true;
  }

 /** mouse / side buttons / : resident,  100ms */
  async _key(code) {
    try {
      await this.input(`input keyevent ${code}`);
    } catch (_) {
      // runtimerestart, resident shell ,  adb, 
      await this.shell(`input keyevent ${code}`, { timeout: 6000 }).catch(() => {});
    }
  }

  async keyBack() { return this._key(4); }
  async keyForward() { return this._key(125); }

  /**
 * " / ". 
   *
 * : ** wm size**.  wm size guest framebuffer 
 * (720x1280 -> 1280x720),  Qt window/orientation, 
 * 90°, mouse.  wm size 
 * /data , restart -- " / / "
 * . 
   *
 * (wm density), framebuffer 720x1280 : 
 * - 320dpi -> smallestWidth 360dp -> 
 * - 190dpi -> smallestWidth 606dp(>=600dp)-> / 
 * , orientation, , , , . 
   */
  async setOrientation(landscape) {
    try {
      // rotatedefault(0.5.9):  guest accelerometer_rotation=1, 
      // settings"". orientation wm user-rotation lock 0
      // + set-ignore-orientation-request , , . 
      // settings →"system imagerotate",  0 . 
      await this.shell(`settings put system accelerometer_rotation ${guestAutoRotate()}; wm size reset`, { timeout: 15000 });
      // orientation **0**( 1). orientation hw.lcd.width/height
      // ( doctor.lcdFor),  1 space, 
      // 90° -- "landscape". 
      await this.shell('wm user-rotation lock 0', { timeout: 15000 });
      // : app portrait, , 
      // init=1280x720 cur=720x1280 space, . 
      // "ignoreapporientation", orientation. 
      // portrait, landscape true portrait
      // landscape. API < 31 , failureignore. 
      await this.shell(`wm set-ignore-orientation-request ${landscape ? 'true' : 'false'}`, { timeout: 15000 });
      // freeform / ignoreorientation, Android"See and do more"
      // ("Double-tap outside an app to reposition it..."). app, 
      // . , fallback. 
      await this.shell('settings put secure freeform_mode_confirmations confirmed', { timeout: 10000 });
      if (landscape) await this.shell('input keyevent KEYCODE_BACK', { timeout: 8000 });
      await this.shell(`wm density ${tabletDensity()}`, { timeout: 15000 });
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
 * taskbar(Android 12L+ Taskbar). 
   *
 * :  density 190dpi, 720 ⇒ sw606dp, 
 * Android 600dp . Pixel Launcher resident
 * NAVIGATION_BAR_PANEL taskbar: , app, 
 * // -- "key". 
   *
 * (gestural overlay ),  policy_control immersive
 * ,  global enable_taskbar;  Launcher launch, 
 * restart. launch,  Play AOSP . 
   */
  async disableLauncherTaskbar() {
    try {
      await this.shell('settings put global enable_taskbar 0', { timeout: 10000 });
      // grep -c 0 exit 1,  || true failure
      const out = await this.shell(
        'dumpsys window windows | grep -c "Window #.*Taskbar" || true',
        { timeout: 12000 },
      ).catch(() => '0');
      const alive = parseInt(String(out).trim(), 10) || 0;
      if (alive > 0) {
        await this.shell(
          'am force-stop com.google.android.apps.nexuslauncher; am force-stop com.android.launcher3',
          { timeout: 12000 },
        ).catch(() => '');
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
 * app. 
   *
 * "window""": Application , 
 * Android 12+ Splash(app + ), Activity completefirst frame
 * . boot, , 
 * -- launch Splash window. 
   *
 * : window "Splash Screen" , . 
 * timeout false, (failure). 
   */
  async waitForAppFirstFrame(pkg, { timeoutMs = 12000, intervalMs = 350 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      // `dumpsys window`(WINDOW MANAGER ), 
      // `dumpsys window windows`: window, ** mCurrentFocus **, 
      // focusOnApp false, timeout -- app
      // , boot 12 . 
      const out = await this.shell(
        'dumpsys window | grep -E "Splash Screen|mCurrentFocus" | head -8',
        { timeout: 8000 },
      ).catch(() => '');
      const s = String(out);
      if (s.trim()) {
        const splashAlive = /Splash Screen/.test(s);
        const focusOnApp = s.indexOf(pkg) >= 0;
        if (!splashAlive && focusOnApp) return true;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

 /** launchversion wm size / density ( /data, ) */
  async resetDisplayOverrides(landscape = false) {
    try {
      // density **applaunch**. 
      // `wm density reset`,  _healOrientation(app
      // 1.8 / 60 ) 190 -- "app"configuration. 
      // cache DisplayMetrics app() dp, 
      // , , "window". 
      // size , launchpath. 
      await this.shell(`wm size reset; wm density ${tabletDensity()}`, { timeout: 15000 });
      await this.shell(`settings put system accelerometer_rotation ${guestAutoRotate()}`, { timeout: 15000 });
      // setOrientation : orientation, orientation 0. 
      await this.shell('wm user-rotation lock 0', { timeout: 15000 });
      await this.shell(`wm set-ignore-orientation-request ${landscape ? 'true' : 'false'}`, { timeout: 15000 });
      // , Launcher taskbar(sw>=600dp). launch
      // enable_taskbar, , restart. 
      await this.disableLauncherTaskbar();
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
 * guest IME. 
   *
 * system image(Google Play ) LatinIME(), Gboard 
 * download, emulator.  AOSP pinyinIME
 * (assets/PinyinIME.apk,  x86_64 ), boot. 
   *
 * : install, defaultIME. 
   *
 * @param {string} apkPath PinyinIME.apk path
 * @param {object} [o] { setDefault } defaultIME(default true)
   * @returns {Promise<{ok:boolean, installed?:boolean, ime?:string, reason?:string}>}
   */
  async ensureChineseIme(apkPath, { setDefault = true } = {}) {
    const IME_PKG = 'com.android.inputmethod.pinyin';
    const IME_ID = IME_PKG + '/.PinyinIME';
    // verify: ime list -s ****IME, 
    // ""install"",  ime enable. 
    // pkg install,  ime list -a . 
    const pkgInstalled = async () => {
      const out = await this.shell(`pm list packages ${IME_PKG}`, { timeout: 10000 }).catch(() => '');
      return String(out).indexOf('package:' + IME_PKG) >= 0;
    };
    const findEnabledIme = async () => {
      const out = await this.shell('ime list -s', { timeout: 10000 }).catch(() => '');
      return String(out).split('\n').map((s) => s.trim()).find((s) => s.indexOf(IME_PKG) === 0) || '';
    };
    try {
      let installed = await pkgInstalled();
      let justInstalled = false;
      if (!installed) {
        if (!apkPath || !fs.existsSync(apkPath)) {
          return { ok: false, reason: 'IME APK missing' };
        }
        await this.install(apkPath);
        installed = true;
        justInstalled = true;
        // Note
        for (let i = 0; i < 6; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          installed = await pkgInstalled();
          if (installed) break;
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      if (!installed) return { ok: false, justInstalled, reason: 'IME package not registered' };
      // + default(secure settings ,  root). 
      // : snapshot enabled , defaultIME. 
      const cmds = [`ime enable ${IME_ID}`];
      if (setDefault) cmds.push(`settings put secure default_input_method ${IME_ID}`);
      await this.shell(cmds.join(' ; '), { timeout: 12000 }).catch(() => '');
      const ime = await findEnabledIme();
      return { ok: !!ime, installed: justInstalled, ime: ime || IME_ID };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  /**
 * . 
 * persist.sys.locale SELinux , runtime(
 * "Failed to set property"),  emulator launch -prop . 
 * : app locale , , . 
   */
  async ensureChineseLocale(locale = 'zh-CN') {
    const cmds = [
      'settings put system system_locales ' + locale,
      'setprop persist.sys.timezone Asia/Shanghai',
      // 24 +
      'settings put system time_12_24 24',
    ];
    await this.shell(cmds.join(' ; '), { timeout: 12000 }).catch(() => '');
    return true;
  }

 /** (landscapewindow) */
  async displaySize() {
    try {
      const out = await this.shell('wm size', { timeout: 8000 });
      const o = /Override size:\s*(\d+)x(\d+)/.exec(out);
      if (o) return { w: Number(o[1]), h: Number(o[2]) };
      const p = /Physical size:\s*(\d+)x(\d+)/.exec(out);
      if (p) return { w: Number(p[1]), h: Number(p[2]) };
    } catch (_) { /* ignore */ }
    return null;
  }

 /** (self-healing),  */
  async dismissPermissionDialog() {    try {
      const top = await this.shell('dumpsys activity activities', { timeout: 12000 });
      if (/GrantPermissionsActivity|permissioncontroller/i.test(String(top))) {
        await this.shell('input keyevent 4', { timeout: 6000 }).catch(() => {});
        return true;
      }
    } catch (_) { /* ignore */ }
    return false;
  }

  /**
 * :  Android (), 
 * windowportrait. wm runtime, restart Android. 
   */
  async setDisplaySize(width, height, density) {
    const w = Math.max(320, Math.round(Number(width) || 0));
    const h = Math.max(480, Math.round(Number(height) || 0));
    await this.shell(`wm size ${w}x${h}`);
    if (density) await this.shell(`wm density ${Math.max(120, Math.min(640, Math.round(density)))}`);
    return { w, h };
  }

  async resetDisplaySize() {
    await this.shell('wm size reset').catch(() => {});
    await this.shell('wm density reset').catch(() => {});
  }
}

module.exports = {
  AdbClient, AdbError, parseStatList, friendlyInstallError, friendlyLaunchError,
  componentArg, parseResolvedActivity, parseDeviceState, isUnauthorizedError, parsePmPaths,
};
