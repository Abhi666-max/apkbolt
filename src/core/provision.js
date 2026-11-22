'use strict';
/**
 * runtime(Provisioning)
 *
 * ApkBolt emulator: adb, QEMU, system imagedownload/verify/. 
 * runtime %APPDATA%\apkbolt\runtime , install. 
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn, execFile } = require('child_process');
const store = require('./store');
const doctor = require('./doctor');
const { download, downloadAny, downloadAnyParallel, downloadMulti, head, discardPartial } = require('./download');
const { ZipArchive, ZipFile, resolveZipEntry } = require('./zip');
const { Sources } = require('./sources');
const { cmpVer } = require('./version');

const IS_WIN = process.platform === 'win32';

const SOURCES = {
  adb: [
    'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
  ],
  qemuIndex: 'https://qemu.weilnetz.de/w64/',
  qemuFallback: [
    'https://qemu.weilnetz.de/w64/qemu-w64-setup-20260811.exe',
  ],
  // Google SDK : emulator system image, version
  sdkIndex: 'https://dl.google.com/android/repository/repository2-3.xml',
  sysImgIndexes: [
    'https://dl.google.com/android/repository/sys-img/android/sys-img2-3.xml',
    'https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml',
  ],
  aehdFallback: 'https://dl.google.com/android/repository/aehd-windows_v2.2.zip',
  // fallback: version
  emulatorFallback: 'https://dl.google.com/android/repository/emulator-windows_x64-16847572.zip',
  sysimgFallback: 'https://dl.google.com/android/repository/sys-img/google_apis_playstore/x86_64-34_r14.zip',
  // ARM system image(Google Play ,  native bridge)
  playImgIndex: 'https://dl.google.com/android/repository/sys-img/google_apis_playstore/sys-img2-3.xml',
  playImgFallback: 'https://dl.google.com/android/repository/sys-img/google_apis_playstore/x86_64-34_r14.zip',
  // Android-x86 9.0-r2(x86_64):  ISO
  iso: [
    'https://master.dl.sourceforge.net/project/android-x86/Release%209.0/android-x86_64-9.0-r2.iso?viasf=1',
    'https://nchc.dl.sourceforge.net/project/android-x86/Release%209.0/android-x86_64-9.0-r2.iso',
    'https://phoenixnap.dl.sourceforge.net/project/android-x86/Release%209.0/android-x86_64-9.0-r2.iso',
    'https://downloads.sourceforge.net/project/android-x86/Release%209.0/android-x86_64-9.0-r2.iso',
  ],
  isoSizeHint: 900 * 1024 * 1024,
  // (runtime)"Runtime bundle":  GitHub Release. 
  // dl.google.com emulator / system image, network
  // KB/s 404;  + GitHub , downloadupdate
  // , . 
  ghReleaseApi: 'https://api.github.com/repos/abhi666-max/apkbolt/releases',
  ghReleasePage: 'https://github.com/abhi666-max/apkbolt/releases',
  // Gitee system image:  api.github.com , Gitee . 
  // , "Runtime bundleversion". 
  giteeReleaseApi: 'https://gitee.com/api/v5/repos/abhi666-max/apkbolt/releases',
  giteeReleasePage: 'https://gitee.com/abhi666-max/apkbolt/releases',
};

/**
 * SDK <url> path, directory: 
 *   repository2-3.xml      → https://dl.google.com/android/repository/
 *   sys-img/android/*.xml  → https://dl.google.com/android/repository/sys-img/android/
 * directory"directory".  URL Invalid URL. 
 */
const REPO_BASE = 'https://dl.google.com/android/repository/';

function baseOf(indexUrl) {
  const s = String(indexUrl || '');
  const i = s.lastIndexOf('/');
  return i > 0 ? s.slice(0, i + 1) : REPO_BASE;
}

function absUrl(u, base = REPO_BASE) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  return base + s.replace(/^\/+/, '');
}

/**
 * "system image". 
 * default AOSP API30 + API34 Play system image, : 
 * - ARM appfailure, system image(); 
 * - system image 0.6~3GB, runtimedirectory GB; 
 * - system image wipe-data, app. 
 * Android 14 Google Play x86_64: x86 app, ARM app, GMS , 
 * (), download. 
 */
const PLAY_SYSIMG = { api: '34', tag: 'google_apis_playstore', abi: 'x86_64' };
const DEFAULT_SYSIMG = PLAY_SYSIMG;

const MIN_SIZE = {
  adb: 5 * 1024 * 1024,
  qemu: 60 * 1024 * 1024,
  iso: 400 * 1024 * 1024,
  disk: 1024 * 1024,
  emulator: 200 * 1024 * 1024,
  sysimg: 300 * 1024 * 1024,
  aeHD: 64 * 1024,
};

function run(cmd, args, { timeout = 60000, cwd, windowsHide = true } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, cwd, windowsHide, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err });
    });
  });
}

function fileSize(p) {
  try { return fs.statSync(p).size; } catch (_) { return 0; }
}

/**
 * directoryprobe(directorycache). 
 *
 * fs.accessSync(dir, W_OK): Windows "", 
 * ACL,  C:\Program Files\WindowsApps\...(MSIX installdirectory)error
 * "",  .img.xz failure. probe. 
 */
const _dirWritableCache = new Map();
function provisionDirWritable(dir) {
  if (_dirWritableCache.has(dir)) return _dirWritableCache.get(dir);
  let ok = false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.apkbolt-wtest-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'x');
    fs.rmSync(probe, { force: true });
    ok = true;
  } catch (_) {
    ok = false;
  }
  _dirWritableCache.set(dir, ok);
  return ok;
}

/**
 * download. ****. 
 *
 * , ,  tmp zip. 
 * download() Range -- /, 
 * , failure, ...... "download". 
 */
function assertComplete(file, minBytes, label) {
  const size = fileSize(file);
  if (size >= minBytes) return size;
  discardPartial(file);
  throw new Error(`${label} download incomplete (${(size / 1048576).toFixed(1)} MB). Cleaned up, please retry.`);
}

/**
 * probecache. 
 *
 * `emulator -version` `emulator -accel-check` emulator , 
 * Windows 1~3 ; "/driver". 
 * memorycache 30 , cold boot, 
 * app. "exe + + AEHD driver + WHPX "
 * %APPDATA%, . 
 */
const ENV_CACHE_TTL = 6 * 60 * 60 * 1000;
const ENV_CACHE_NEG_TTL = 10 * 60 * 1000; // "" 10 : 

function envCacheFile() {
  return path.join(store.DATA_DIR, 'cache', 'env.json');
}

function statKey(p) {
  try {
    const s = fs.statSync(p);
    return `${s.size}:${Math.round(s.mtimeMs)}`;
  } catch (_) { return ''; }
}

class Provisioner {
  constructor(appRoot) {
    this.appRoot = appRoot;
    this._hypervisor = null;
    this._cache = { adbVersion: '', qemuVersion: '' };
    this._sources = new Sources(() => store.getSettings());
  }

 /** dual source/system image(cache, ) */
  get sources() {
    return this._sources;
  }

 /** cache: driver key */
  _envKey(exe) {
    const aehd = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'aehd.sys');
    return [
      String(exe || '').replace(/\\/g, '/').toLowerCase(),
      statKey(exe),
      statKey(aehd),
      fs.existsSync('C:\\Windows\\System32\\WinHvPlatform.dll') ? '1' : '0',
    ].join('|');
  }

  envCacheGet(exe) {
    try {
      const j = JSON.parse(fs.readFileSync(envCacheFile(), 'utf8'));
      if (!j || j.key !== this._envKey(exe)) return null;
      return j;
    } catch (_) { return null; }
  }

  envCacheSet(exe, patch) {
    try {
      const key = this._envKey(exe);
      let cur = {};
      try { cur = JSON.parse(fs.readFileSync(envCacheFile(), 'utf8')) || {}; } catch (_) { /*  */ }
      const base = cur.key === key ? cur : { key, version: null, accel: null, accelAt: 0 };
      const next = { ...base, ...patch, key, at: Date.now() };
      fs.mkdirSync(path.dirname(envCacheFile()), { recursive: true });
      fs.writeFileSync(envCacheFile(), JSON.stringify(next));
    } catch (_) { /* cache */ }
  }

 /** bootfailure(/system image): launchprobe,  */
  invalidateEnvCache() {
    this._cache = { adbVersion: '', qemuVersion: '' };
    try { fs.rmSync(envCacheFile(), { force: true }); } catch (_) { /* ignore */ }
  }

  // ---------------- path ----------------

  get root() {
    const r = store.getSettings().runtime.dir;
    if (r && r.trim()) return r;
    const defaultRoot = path.join(store.DATA_DIR, 'runtime');
    if (fs.existsSync(path.join(defaultRoot, 'emulator', 'emulator.exe'))) return defaultRoot;
    // Auto-detect and reuse existing Android runtime on this PC (e.g. from apkbolt or Android SDK)
    const legacyRoot = path.join(process.env.APPDATA || '', 'apkbolt', 'runtime');
    if (fs.existsSync(path.join(legacyRoot, 'emulator', 'emulator.exe'))) return legacyRoot;
    const sdkRoot = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
    if (fs.existsSync(path.join(sdkRoot, 'emulator', 'emulator.exe'))) return sdkRoot;
    return defaultRoot;
  }

  paths() {
    const root = this.root;
    const sysTag = DEFAULT_SYSIMG.tag;
    const sysApi = DEFAULT_SYSIMG.api;
    const sysAbi = DEFAULT_SYSIMG.abi;
    // runtimedirectory?
    // (MSIX) emulator / platform-tools / system-images install
    // (C:\Program Files\WindowsApps\...), directory: 
    // - .img.xz,  _tmp,  qemu/ failure; 
    // - (, %APPDATA%
    // ). 
    // """": path, 
    // (system imagedirectory / AVD / temporarydirectory)directory. 
    const rootWritable = provisionDirWritable(root);
    // AVD(, app, quickboot snapshot)clean. 
    // runtimeextracttemporarydirectory,  AVD exitapp. 
    // runtimedirectory %APPDATA% ,  AVD directory. 
    // : settings"Androiddirectory"--
    // (6~24GB data partition + 2~3GB snapshot), runtime, , C . 
    const explicitAvd = String(store.getSettings().runtime.avdDir || '').trim();
    const writable = explicitAvd || path.join(store.DATA_DIR, 'avd');
    const insideData = root.toLowerCase().startsWith(store.DATA_DIR.toLowerCase());
    // system image: **runtimedirectory**. 
    // "directory", --runtimedirectory D C space, 
    // 1.4GB D , materializeImages 3.3GB system.img
    // C://Users//...//AppData//Roaming//apkbolt//system-images, C , 
    // system image( 1.2GB + 3.3GB ). 
    // : runtimedirectory system-images(extract); 
    // directory(version, ). 
    const rootImg = path.join(root, 'system-images');
    const dataImg = path.join(store.DATA_DIR, 'system-images');
    const legacyImg = path.join(process.env.APPDATA || '', 'apkbolt', 'system-images');
    const androidSdkImg = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'system-images');
    // : 
    // 1) runtimedirectorysystem image(extract)→ ; 
    // 2) /system imagedirectory → ; 
    // 3) install()→ runtimedirectory, directory
    // temporarydirectory(CI runtime, verifyfailure). 
    // 4) runtimedirectory(MSIX )→ directory,  .img.xz . 
    //
    // (0.6.0 repair): "system image". runtimedirectory
    // system-images( .img.xz), directory
    // 3.1GB system.img, extract -- compress(0.5.9
    // ), extractfailure, "app". 
    // : , download/extract. 
    const expandedImgDir = (base) => path.join(base, `android-${sysApi}`, sysTag, sysAbi, 'system.img');
    const hasExpanded = (base) => {
      try { return fs.statSync(expandedImgDir(base)).size > 100 * 1024 * 1024; } catch (_) { return false; }
    };
    let sysRoot;
    if (!rootWritable) sysRoot = dataImg;
    else if (hasExpanded(rootImg)) sysRoot = rootImg;
    else if (hasExpanded(dataImg)) sysRoot = dataImg;
    else if (hasExpanded(legacyImg)) sysRoot = legacyImg;
    else if (hasExpanded(androidSdkImg)) sysRoot = androidSdkImg;
    else if (fs.existsSync(rootImg)) sysRoot = rootImg;
    else if (fs.existsSync(dataImg)) sysRoot = dataImg;
    else if (fs.existsSync(legacyImg)) sysRoot = legacyImg;
    else sysRoot = rootImg;
    
    // Reuse legacy AVD if available and local AVD is not initialized
    const legacyAvd = path.join(process.env.APPDATA || '', 'apkbolt', 'avd');
    const defaultAvd = insideData ? path.join(root, 'avd') : writable;
    const finalAvd = fs.existsSync(defaultAvd) ? defaultAvd : (fs.existsSync(legacyAvd) ? legacyAvd : defaultAvd);
    
    return {
      root,
      // temporarydirectory/directory root , directory
      writeRoot: rootWritable ? root : path.join(store.DATA_DIR, 'runtime'),
      qemuDir: path.join(root, 'qemu'),
      qemuExe: path.join(root, 'qemu', 'qemu-system-x86_64.exe'),
      qemuImg: path.join(root, 'qemu', 'qemu-img.exe'),
      adbDir: path.join(root, 'platform-tools'),
      adbExe: path.join(root, 'platform-tools', 'adb.exe'),
      // emulator runtime(Google ): root ANDROID_SDK_ROOT
      emulatorDir: path.join(root, 'emulator'),
      emulatorExe: path.join(root, 'emulator', 'emulator.exe'),
      sysImgRoot: sysRoot,
      sysImgDir: path.join(sysRoot, `android-${sysApi}`, sysTag, sysAbi),
      avdHome: finalAvd,
      aehdDir: path.join(rootWritable ? root : path.join(store.DATA_DIR, 'runtime'), 'aehd'),
      imagesDir: path.join(rootWritable ? root : path.join(store.DATA_DIR, 'runtime'), 'images'),
      iso: path.join(root, 'images', 'android-x86.iso'),
      disk: path.join(root, 'images', 'android.qcow2'),
      tmp: path.join(rootWritable ? root : path.join(store.DATA_DIR, 'runtime'), '_tmp'),
      rootWritable,
      sysTag, sysApi, sysAbi,
    };
  }

  ensureDirs() {
    const p = this.paths();
    for (const d of [p.root, p.qemuDir, p.adbDir, p.imagesDir, p.tmp, p.avdHome]) {
      // : (MSIX) p.root install, , 
      // directorydirectory( paths()). 
      // launchpath. 
      try { fs.mkdirSync(d, { recursive: true }); } catch (_) { /* / */ }
    }
    return p;
  }

  /**
 * disk: download / extract, space. 
 * , extractfailure(). 
 * 1GB : emulator/system imageextractsnapshot, data partition. 
 * @param {string} component (space)
 * @param {string} targetDir directory()
   */
  async guardDisk(component, targetDir) {
    const need = {
      adb: 64, emulator: 600, sysimg: 1800, playimg: 1800, qemu: 320, iso: 1100, aehd: 64,
      // Runtime bundle: 1.5GB compress + ~3.3GB system image, 
      runtime: 5000,
    }[component] || 512; // MB
    const buf = 1024; // 1GB(snapshot / data partition / extract)
    const dir = targetDir || this.root;
    const free = doctor.freeDiskMB(dir);
    if (free && free < need + buf) {
      throw new Error(
        `Insufficient disk space: component requires ~${need + buf} MB, but drive "${dir}" has only ${free} MB free.\n`
        + 'Recommendation: Move Runtime Data Directory to a drive with more space in Settings.'
        + 'Or free up disk space and try again.',
      );
    }
    return free;
  }

  // ---------------- ----------------

  async hypervisor() {
    if (this._hypervisor !== null) return this._hypervisor;
    if (!IS_WIN) { this._hypervisor = { whpx: false, note: 'Non-Windows platform' }; return this._hypervisor; }
    // . "WHPX Availability" emulator -accel-check , 
    // PowerShell(cold boot 1-2 ). 
    const dll = fs.existsSync('C:\\Windows\\System32\\WinHvPlatform.dll');
    this._hypervisor = {
      whpx: false,          // emulatorAccel()
      dll,
      hypervisorPresent: false,
      note: dll
        ? 'Virtual machine platform present (availability checked by engine)'
        : 'Windows Hypervisor Platform not detected: enable in Windows Features and restart',
    };
    return this._hypervisor;
  }

  async adbVersion() {
    // 30s cache, 
    if (this._adbCache && Date.now() - this._adbCache.at < 30000) return this._adbCache.value;
    const { adbExe, adbDir } = this.paths();
    const candidates = [adbExe, path.join(this.appRoot, 'tools', 'platform-tools', 'adb.exe')];
    for (const c of candidates) {
      if (!fs.existsSync(c)) continue;
      const r = await run(c, ['version'], { timeout: 10000 });
      if (r.ok) {
        const m = /version\s+([\d.]+)/i.exec(r.stdout);
        const v = { ok: true, path: c, version: m ? m[1] : r.stdout.split('\n')[0].trim() };
        this._adbCache = { at: Date.now(), value: v };
        return v;
      }
    }
    this._adbCache = { at: Date.now(), value: { ok: false, path: '', version: '' } };
    return this._adbCache.value;
  }

  async qemuVersion() {
    if (this._qemuCache && Date.now() - this._qemuCache.at < 30000) return this._qemuCache.value;
    const p = this.paths();
    const candidates = [
      p.qemuExe,
      store.getSettings().runtime.qemuPath,
      'C:\\Program Files\\qemu\\qemu-system-x86_64.exe',   // winget defaultinstall
      path.join(this.appRoot, 'engine', 'qemu', 'qemu-system-x86_64.exe'),
    ].filter(Boolean);
    for (const c of candidates) {
      if (!fs.existsSync(c)) continue;
      const r = await run(c, ['--version'], { timeout: 15000 });
      if (r.ok || r.stdout) {
        const m = /QEMU emulator version\s+(\S+)/i.exec(r.stdout);
        const v = { ok: true, path: c, version: m ? m[1] : (r.stdout || '').split('\n')[0].trim() };
        this._qemuCache = { at: Date.now(), value: v };
        return v;
      }
    }
    this._qemuCache = { at: Date.now(), value: { ok: false, path: '', version: '' } };
    return this._qemuCache.value;
  }

 /** verify ISO9660 ( 0x8001 "CD001"), error/system image */
  inspectIso(file) {
    const size = fileSize(file);
    if (!size) return { ok: false, iso9660: false, size: 0, reason: 'Not downloaded' };
    let magic = '';
    try {
      const fd = fs.openSync(file, 'r');
      const b = Buffer.alloc(5);
      fs.readSync(fd, b, 0, 5, 0x8001);
      fs.closeSync(fd);
      magic = b.toString('latin1');
    } catch (_) { /* ignore */ }

    const iso9660 = magic === 'CD001';
    // raw/disksystem image ISO , 
    const rawImage = !iso9660 && /\.(img|raw|qcow2)$/i.test(file) && size > MIN_SIZE.iso;
    const ok = size > MIN_SIZE.iso && (iso9660 || rawImage);

    let reason = '';
    if (!ok) {
      reason = size <= MIN_SIZE.iso
        ? `File size only ${(size / 1048576).toFixed(1)} MB, download incomplete`
        : 'File is not a valid ISO image (corrupted or error page downloaded)';
    }
    return { ok, iso9660, rawImage, size, reason, magic };
  }

  async checkEnv() {
    const p = this.ensureDirs();
    const s = store.getSettings();
    const [adb, qemu, hv, emulator, accel] = await Promise.all([
      this.adbVersion(), this.qemuVersion(), this.hypervisor(),
      this.emulatorVersion(), this.emulatorAccel(),
    ]);

    const isoPath = s.runtime.isoPath || p.iso;
    const diskPath = s.runtime.diskPath || p.disk;
    const iso = this.inspectIso(isoPath);
    const diskSize = fileSize(diskPath);
    const sysimg = this.systemImageInfo();

    // (runtime) API 34 Google Play system image, system imagesystem image; 
    // compatImage , "system image, "
    const playImage = this.playImageInfo();
    const compatReady = playImage.ok;
    const emulatorReady = emulator.ok && (sysimg.ok || compatReady);
    const qemuReady = qemu.ok && diskSize > MIN_SIZE.disk;
    // .xz/.gz: system image"", . 
    // "download"-- system imagedownload, . 
    const needsExtract = !!(sysimg.compressed || (compatReady && playImage.compressed));

    return {
      adb: { ...adb, required: true },
      emulator: { ...emulator, required: true, note: emulator.ok ? emulator.version : 'Not installed' },
      sysimg: {
        ok: sysimg.ok || compatReady,
        dir: sysimg.dir,
        size: sysimg.ok ? sysimg.size : (compatReady ? playImage.size : 0),
        api: sysimg.ok ? sysimg.api : (compatReady ? PLAY_SYSIMG.api : sysimg.api),
        compressed: needsExtract,
        required: false,
        note: sysimg.ok
          ? `Android ${sysimg.api} (${(sysimg.size / 1073741824).toFixed(2)} GB${sysimg.compressed ? ', bundled compressed, auto-extracted on first launch' : ''})`
          : (compatReady
            ? `Android ${PLAY_SYSIMG.api} (${playImage.compressed ? ', bundled compressed, auto-extracted on first launch' : 'ARM Compatible Image'})`
            : (sysimg.note || 'Not downloaded')),
      },
      // true = system image(), ; ****download
      needsExtract,
      playImage,
      accel,
      qemu: { ...qemu, required: false },
      iso: {
        ok: iso.ok,
        path: isoPath,
        size: iso.size,
        iso9660: iso.iso9660,
        required: false,
        note: iso.size ? `${(iso.size / 1073741824).toFixed(2)} GB` : 'Not downloaded',
        reason: iso.reason,
      },
      disk: {
        ok: diskSize > MIN_SIZE.disk,
        path: diskPath,
        size: diskSize,
        required: false,
        note: diskSize ? `${(diskSize / 1073741824).toFixed(2)} GB` : 'Not yet created',
      },
      hypervisor: hv,
      ready: !!(adb.ok && (emulatorReady || qemuReady)),
      engine: emulatorReady ? 'emulator' : (qemuReady ? 'qemu' : 'none'),
      paths: p,
    };
  }

  // ---------------- adb ----------------

  async installAdb(onProgress = () => {}) {
    const p = this.ensureDirs();
    await this.guardDisk('adb', p.root);
    const zipPath = path.join(p.tmp, 'platform-tools.zip');
    onProgress({ stage: 'download', message: 'Downloading Android platform-tools (~8 MB)...', percent: 2 });

    await downloadAny(SOURCES.adb, zipPath, {
      onProgress: (pr) => onProgress({
        stage: 'download',
        message: `Downloading adb... ${(pr.got / 1048576).toFixed(1)} MB / ${(pr.total / 1048576).toFixed(1)} MB`,
        percent: pr.percent,
        speed: pr.speed,
      }),
    });

    assertComplete(zipPath, MIN_SIZE.adb, 'adb package');

    onProgress({ stage: 'extract', message: 'Extracting adb...', percent: 92 });
    await this.extractZip(zipPath, p.root);

    const v = await this.adbVersion();
    if (!v.ok) throw new Error('adb failed to run after extraction; check antivirus settings');

    fs.rmSync(zipPath, { force: true });
    store.saveSettings({ adbPath: v.path });
    this._cache.adbVersion = v.version;
    onProgress({ stage: 'done', message: `adb ${v.version} ready`, percent: 100 });
    return v;
  }

  /**
 * ZIP extract(extract)
 * (GB system.img), ,  Node Buffer . 
   */
  // ---------------- GitHub Runtime bundle() ----------------

  async _fetchJson(url) {
    const text = await this._fetchText(url).catch(() => '');
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  /**
 * "Runtime bundle"download. 
 * : ApkBolt-runtime-<tag>.zip( .github/workflows/release.yml , 
 * build/runtime : emulator/ + platform-tools/ + aehd/ + system-images/). 
 * GitHub Gitee , version; , 
 * Google download. 
   */
  async resolveRuntimePack() {
    const custom = String(store.getSettings().runtime.runtimePackUrl || '').trim();
    if (custom) return { url: absUrl(custom), name: path.basename(custom.split('?')[0]), size: 0, tag: 'custom' };
    if (this._cache.pack) return this._cache.pack;

    const pref = String(store.getSettings().runtime.sourcePreference || 'auto');
    const apis = [];
    if (pref !== 'gitee') apis.push({ api: SOURCES.ghReleaseApi, page: SOURCES.ghReleasePage, name: 'GitHub' });
    if (pref !== 'github') apis.push({ api: SOURCES.giteeReleaseApi, page: SOURCES.giteeReleasePage, name: 'Gitee' });

    // ; failure
    const lists = await Promise.all(apis.map(async (a) => {
      const j = await this._fetchJson(`${a.api}?per_page=15`).catch(() => null);
      return { ...a, list: Array.isArray(j) ? j : null };
    }));

    const cands = [];
    for (const item of lists) {
      if (!item.list) continue;
      for (const rel of item.list) {
        if (!rel || rel.draft) continue;
        const hit = (rel.assets || []).find((x) => /^ApkBolt-runtime-.*\.zip$/i.test(x.name || ''));
        if (!hit) continue;
        cands.push({
          url: hit.browser_download_url || hit.url,
          name: hit.name,
          size: hit.size || 0,
          tag: String(rel.tag_name || rel.name || '').replace(/^v/i, ''),
          page: rel.html_url || item.page,
          from: item.name,
        });
      }
    }
    if (!cands.length) {
      const errs = lists.filter((x) => !x.list).map((x) => `${x.name} unreachable`).join(', ');
      throw new Error(`No Runtime bundle found on either source${errs ? ` (${errs})` : ''}`);
    }
    cands.sort((a, b) => cmpVer(b.tag, a.tag));
    this._cache.pack = cands[0];
    return this._cache.pack;
  }

  /**
 * :  GitHub downloadRuntime bundleextract. 
 * system image .xz, boot materializeImages() (). 
   */
  async installRuntimePack(onProgress = () => {}) {
    const p = this.ensureDirs();
    // : version + , hint"". 
    onProgress({ stage: 'download', message: 'Fetching runtime release information...', percent: 1 });
    const pack = await this.resolveRuntimePack();
    await this.guardDisk('runtime', p.root);
    const zip = path.join(p.tmp, 'runtime-pack.zip');
    const total = pack.size || 0;
    const s = store.getSettings().runtime || {};
    const conn = Math.max(1, Math.min(16, Number(s.downloadConnections) || 8));

    onProgress({ stage: 'download', message: `Selecting fastest download source (${pack.from || 'GitHub'}  -  ${pack.tag})...`, percent: 1 });
    // = + system image.  128KB : 
    // "" -- 30KB/s,  5MB/s. 
    const urls = await this.sources
      .rank(this._downloadUrls(pack.url), { onProgress: (pp) => onProgress({ stage: 'download', message: pp.message, percent: 1 }) })
      .catch(() => this._downloadUrls(pack.url));

    onProgress({ stage: 'download', message: `Downloading runtime (~1.5 GB, one-time, ${conn} threads)...`, percent: 2 });
    // chunk(8 ): GitHub , 
    // KB/s, 8 . . 
    await downloadMulti(urls, zip, {
      connections: conn,
      onProgress: (pr) => {
        const pct = pr.percent != null ? pr.percent : (total ? Math.round((pr.got / total) * 100) : 0);
        const mb = `${(pr.got / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''}`;
        const sp = Number(pr.speed) > 0 ? `  -  ${(pr.speed / 1048576).toFixed(2)} MB/s` : '';
        const eta = Number(pr.eta) > 0 ? `  -  ~${Math.ceil(pr.eta / 60)} min remaining` : '';
        onProgress({
          stage: 'download',
          message: `Downloading runtime ${mb}${sp}${eta}`,
          percent: Math.max(1, Math.min(90, Math.round(pct * 0.9))),
          speed: pr.speed,
        });
      },
    });
    assertComplete(zip, 200 * 1024 * 1024, 'Runtime bundle');

    onProgress({ stage: 'extract', message: 'Extracting runtime (~1 min)...', percent: 91 });
    await this.extractZip(zip, p.root, {
      onEntry: (name, done, all) => {
        if (done % 50 === 0) {
          onProgress({ stage: 'extract', percent: Math.min(99, 91 + Math.round((done / all) * 8)), message: `Extracting ${done}/${all}` });
        }
      },
    });
    try {
      fs.writeFileSync(path.join(p.root, '.runtime-pack.json'), JSON.stringify({
        name: pack.name, tag: pack.tag, at: new Date().toISOString(), from: pack.url,
      }));
      fs.rmSync(zip, { force: true });
    } catch (_) { /*  */ }

    // system.img .xz compress(install). , 
    // checkEnv() "system image",  Google 1.4 GB. 
    // failurefailure:  catch 0, 
    // 99% "",  1.4GB. 
    onProgress({ stage: 'extract', message: 'Extracting system image (~1 min, one-time)...', percent: 99 });
    await this.materializeImages((m) => onProgress({ stage: 'extract', message: m, percent: 99 }));

    onProgress({ stage: 'done', message: 'Runtime ready', percent: 100 });
    return { ok: true, name: pack.name, tag: pack.tag };
  }

  /**
 * download: , system image. 
 * Sources , "system image(ghfast / gh-proxy)"custom
 * , downloadcache. 
   */
  _downloadUrls(url) {
    return this.sources.candidates(url);
  }

  async extractZip(zipPath, destDir, opts = {}) {
    // (emulator / system image):  1.5GB zip memory, 
    // memoryextract; memory, . 
    const big = fileSize(zipPath) > 64 * 1024 * 1024;
    const zip = big ? new ZipFile(zipPath) : new ZipArchive(fs.readFileSync(zipPath));
    const STREAM_THRESHOLD = 64 * 1024 * 1024;
    const total = zip.names().length;
    let done = 0;

    try {
      for (const name of zip.names()) {
        // zip-slip (issue #2 P0-4): runtimenetwork, . 
        // directory destDir path. 
        const target = resolveZipEntry(destDir, name);
        if (!target) {
          if (opts.onUnsafeEntry) opts.onUnsafeEntry(name);
          continue;
        }
        if (name.endsWith('/')) {
          fs.mkdirSync(target, { recursive: true });
          continue;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const e = zip.entries.get(name);
        if (e.uncompSize > STREAM_THRESHOLD) {
          // eslint-disable-next-line no-await-in-loop
          await zip.pipeTo(name, fs.createWriteStream(target));
        } else {
          fs.writeFileSync(target, zip.read(name));
        }
        done += 1;
        if (opts.onEntry) opts.onEntry(name, done, total);
      }
    } finally {
      if (zip.close) zip.close();
    }
    return destDir;
  }

  // ---------------- Emulator(Google runtime) ----------------

 /** XML (,  400KB) */
  async _fetchText(url, limit = 2 * 1024 * 1024) {
    const { openStream } = require('./download');
    const res = await openStream(url);
    // issue #2 P1-1:  destroy() 'end', error, 
    // Promise settle, "". 
    // settle + timeout, path. 
    return new Promise((resolve) => {
      let d = '';
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(d);
      };
      const timer = setTimeout(() => { try { res.destroy(); } catch (_) {} finish(); }, 30000);
      res.on('data', (c) => {
        if (done) return;
        d += c;
        if (d.length > limit) {
          d = '';                       // , 
          try { res.destroy(); } catch (_) {}
          finish();
        }
      });
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', finish);
    });
  }

 /** SDK Windows emulator */
  async resolveEmulatorUrl() {
    const cached = store.getSettings().runtime.emulatorUrl;
    if (cached && cached.trim()) return absUrl(cached);
    if (this._cache.emulatorUrl) return this._cache.emulatorUrl;
    try {
      const xml = await this._fetchText(SOURCES.sdkIndex);
      const block = /<remotePackage path="emulator"[\s\S]*?<\/remotePackage>/.exec(xml);
      if (block) {
        const base = baseOf(SOURCES.sdkIndex);
        const urls = [...block[0].matchAll(/<url>([^<]+)<\/url>/g)].map((m) => absUrl(m[1], base));
        const win = urls.find((u) => /windows_x64.*\.zip$/i.test(u));
        if (win) {
          this._cache.emulatorUrl = win;
          return win;
        }
      }
    } catch (_) { /* fallback */ }
    this._cache.emulatorUrl = SOURCES.emulatorFallback;
    return SOURCES.emulatorFallback;
  }

 /** sys-img default AOSP system image */
  async resolveSysimgUrl() {
    const cached = store.getSettings().runtime.sysimgUrl;
    if (cached && cached.trim()) return absUrl(cached, baseOf(SOURCES.sysImgIndexes[0]));
    if (this._cache.sysimgUrl) return this._cache.sysimgUrl;
    const want = `system-images;android-${DEFAULT_SYSIMG.api};${DEFAULT_SYSIMG.tag};${DEFAULT_SYSIMG.abi}`;
    for (const idx of [SOURCES.playImgIndex, ...SOURCES.sysImgIndexes]) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const xml = await this._fetchText(idx);
        const re = new RegExp(`<remotePackage path="${want.replace(/[;]/g, ';')}"[\\s\\S]*?</remotePackage>`);
        const block = re.exec(xml);
        if (block) {
          const base = baseOf(idx);
          const urls = [...block[0].matchAll(/<url>([^<]+)<\/url>/g)].map((m) => absUrl(m[1], base))
            .filter((u) => /x86_64.*\.zip$/i.test(u));
          if (urls.length) {
            this._cache.sysimgUrl = urls[urls.length - 1];
            return this._cache.sysimgUrl;
          }
        }
      } catch (_) { /*  */ }
    }
    this._cache.sysimgUrl = SOURCES.sysimgFallback;
    return SOURCES.sysimgFallback;
  }

  async emulatorVersion() {
    if (this._cache.emulatorVersion && this._cache.emulatorVerAt && Date.now() - this._cache.emulatorVerAt < 30000) {
      return this._cache.emulatorVersion;
    }
    const p = this.paths();
    const candidates = [p.emulatorExe, path.join(this.appRoot, 'engine', 'emulator', 'emulator.exe')];
    for (const c of candidates) {
      if (!fs.existsSync(c)) continue;
      // probe, : ( 1s+ )
      const cached = this.envCacheGet(c);
      if (cached && cached.version && cached.version.ok && Date.now() - (cached.at || 0) < ENV_CACHE_TTL) {
        this._cache.emulatorVersion = cached.version;
        this._cache.emulatorVerAt = Date.now();
        return cached.version;
      }
      // eslint-disable-next-line no-await-in-loop
      const r = await run(c, ['-version'], { timeout: 20000 });
      const text = `${r.stdout}${r.stderr}`;
      const m = /Android emulator version\s+([\d.]+)/i.exec(text);
      if (m) {
        this._cache.emulatorVersion = { ok: true, path: c, version: m[1] };
        this._cache.emulatorVerAt = Date.now();
        this.envCacheSet(c, { version: this._cache.emulatorVersion });
        return this._cache.emulatorVersion;
      }
    }
    return { ok: false, path: '', version: '' };
  }

  /**
 * launchcompresssystem imagedirectory(). 
 * system.img .gz(3.1GB→580MB ), emulator. 
 * %APPDATA% : portable versionruntimedirectorylaunchtemporarydirectory, 
 * bootextract. 
   */
  async materializeImages(onLog = () => {}) {
    const srcRoot = path.join(this.root, 'system-images');
    // paths().sysImgRoot , 
    // " D , system image C APPDATA"( 1.2GB + 3.3GB). 
    const destRoot = this.paths().sysImgRoot;
    const jobs = [];
    const copies = []; // compresssystem image(kernel-ranchu / ramdisk / compress .img )directory
    const found = new Map(); // dest -> job(system image .xz/.gz .xz)
    const walk = (dir, rel = '') => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p, path.join(rel, e.name)); continue; }
        // .img.xz(LZMA2,  .gz ~25%) .img.gz
        if (/\.img\.(xz|gz)$/i.test(e.name)) {
          const dest = path.join(destRoot, rel, e.name.replace(/\.img\.(xz|gz)$/i, '.img'));
          const job = { src: p, dest, xz: /\.xz$/i.test(e.name) };
          const prev = found.get(dest);
          if (!prev || (job.xz && !prev.xz)) found.set(dest, job);
        } else {
          copies.push({ src: p, dest: path.join(destRoot, rel, e.name) });
        }
      }
    };
    walk(srcRoot);
    jobs.push(...found.values());
    if (!jobs.length && !copies.length) return 0;

    // system image(emulator kernel-ranchu /, "System image missing")
    for (const c of copies) {
      try {
        if (path.resolve(c.src) === path.resolve(c.dest)) continue;   // , 
        const have = fileSize(c.dest);
        if (have > 0 && have === fileSize(c.src)) continue;
        fs.mkdirSync(path.dirname(c.dest), { recursive: true });
        fs.copyFileSync(c.src, c.dest);
      } catch (e) { onLog(`Failed to copy image components: ${e.message}`); }
    }

    let done = 0;
    const failures = [];
    for (const j of jobs) {
      const have = fileSize(j.dest);
      // "" 32MB:  .part, 
      // MB system image, complete, bootsystem image. 
      // system imageextractcompress, "compress"= . 
      const srcSize = fileSize(j.src);
      if (have > 32 * 1024 * 1024 && (srcSize <= 0 || have >= srcSize)) continue;
      // .part, success: extract( / / disk)
      // "complete" system.img, , 
      // bootsystem image, . 
      const part = `${j.dest}.part`;
      try { fs.rmSync(part, { force: true }); } catch (_) { /* ignore */ }
      fs.mkdirSync(path.dirname(j.dest), { recursive: true });
      onLog(`First launch: extracting system image ${path.basename(j.dest)} (~1 min, one-time)`);
      try {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve, reject) => {
          const { pipeline, Readable } = require('stream');
          if (j.xz) {
            // LZMA2 extract:  index.js. 
            // default main.js / xz.js require('stream-polyfill.mjs'), 
            // Electron Node 20 require(ESM) ;  exports
            // '@napi-rs/lzma/index.js',  require.resolve directorypath. 
            const path0 = require('path');
            let lzmaDir;
            try {
              lzmaDir = path0.dirname(require.resolve('@napi-rs/lzma'));
            } catch (_) {
              // node_modules/@napi-rs . 
              // "Cannot find module '@napi-rs/lzma'"+ require stack, 
              // , "app". 
              // install, . 
              const e2 = new Error('Incomplete package: missing @napi-rs/lzma extractor. Please redownload full package.');
              e2.code = 'LZMA_MISSING';
              throw e2;
            }
            const { xz } = require(path0.join(lzmaDir, 'index.js'));
            const webIn = Readable.toWeb(fs.createReadStream(j.src));
            const webOut = xz.decompressStream(webIn);
            pipeline(Readable.fromWeb(webOut), fs.createWriteStream(part), (err) => (err ? reject(err) : resolve()));
          } else {
            pipeline(
              fs.createReadStream(j.src),
              zlib.createGunzip(),
              fs.createWriteStream(part),
              (err) => (err ? reject(err) : resolve()),
            );
          }
        });
        fs.renameSync(part, j.dest);
        done += 1;
      } catch (e) {
        try { fs.rmSync(part, { force: true }); } catch (_) { /* ignore */ }
        // : ( / boot)system imagesuccess, 
        // " 1.4GB"bootfailure. 
        failures.push(`${path.basename(j.dest)}: ${e.message}`);
        onLog(`Image extraction failed: ${e.message}`);
      }
    }
    if (failures.length) {
      const err = new Error(`System image extraction failed (${failures.join('; ')})`);
      err.code = 'MATERIALIZE_FAILED';
      err.failed = failures;
      throw err;
    }
    return done;
  }

  /**
 * system image. 
   *
 * "": 
 * 1. `system.img`(cache / settingsruntimedirectory); 
 * 2. ** `system.img.xz` / `.gz`** -- (MSIX)install
 * , boot materializeImages() . 
   *
 * 2 ok,  checkEnv().ready false, autoDeploy 
 * "system image",  1.5GB -- "system image, 
 * download".  compressed "". 
   */
  systemImageInfo() {
    const p = this.paths();
    const roots = [p.sysImgRoot, path.join(this.root, 'system-images'), path.join(this.appRoot, 'engine', 'system-images')];
    // default(API34 Play), "system image". 
    // AOSP system image,  API34
    // system image"Not downloaded", download. 
    const preferred = [p.sysImgDir,
      path.join(this.appRoot, 'engine', 'system-images',
        `android-${DEFAULT_SYSIMG.api}`, DEFAULT_SYSIMG.tag, DEFAULT_SYSIMG.abi)];
    const candidates = [...preferred];
    for (const root of roots) {
      let apis = [];
      try { apis = fs.readdirSync(root).filter((d) => /^android-\d+$/.test(d)); } catch (_) { continue; }
      apis.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
      for (const api of apis) {
        let tags = [];
        try { tags = fs.readdirSync(path.join(root, api)); } catch (_) { continue; }
        for (const tag of tags) {
          let abis = [];
          try { abis = fs.readdirSync(path.join(root, api, tag)); } catch (_) { continue; }
          for (const abi of abis) candidates.push(path.join(root, api, tag, abi));
        }
      }
    }
    let missing = null;
    let packed = null;   // compress: "", 
    for (const dir of candidates) {
      const kernel = path.join(dir, 'kernel-ranchu');
      const m = /system-images[\\/]android-(\d+)[\\/]([^\\/]+)[\\/]([^\\/]+)$/.exec(dir);
      const api = m ? Number(m[1]) : DEFAULT_SYSIMG.api;
      const tag = m ? m[2] : DEFAULT_SYSIMG.tag;
      const abi = m ? m[3] : DEFAULT_SYSIMG.abi;
      // Note
      const size = fileSize(path.join(dir, 'system.img'));
      if (size > MIN_SIZE.sysimg && fs.existsSync(kernel)) {
        return { ok: true, dir, size, api, tag, abi, compressed: false };
      }
      // compress(system image)
      if (fs.existsSync(kernel)) {
        for (const name of ['system.img.xz', 'system.img.gz']) {
          const cs = fileSize(path.join(dir, name));
          if (cs > MIN_SIZE.sysimg) {
            if (!packed) packed = { ok: true, dir, size: cs, api, tag, abi, compressed: true, file: name };
            break;
          }
        }
      }
      if (!missing && fs.existsSync(dir)) {
        missing = { ok: false, dir, size, api, tag, abi, note: size ? 'Image incomplete' : 'system.img not found' };
      }
    }
    // compress: , **system image**, download
    if (packed) return packed;
    if (missing) return missing;
    return { ok: false, dir: p.sysImgDir, size: 0, api: DEFAULT_SYSIMG.api, tag: DEFAULT_SYSIMG.tag, note: 'Not downloaded' };
  }

  /**
 * hardware acceleration. 
 * emulator Windows : WHPX(, restart) AEHD(Google driver, ). 
   */
  async emulatorAccel() {
    // ,  -accel-check emulator , cache
    if (this._cache.accel && this._cache.accelAt && Date.now() - this._cache.accelAt < 30000) {
      return this._cache.accel;
    }
    const p = this.paths();
    const exe = fs.existsSync(p.emulatorExe) ? p.emulatorExe
      : path.join(this.appRoot, 'engine', 'emulator', 'emulator.exe');
    if (!fs.existsSync(exe)) return { ok: false, kind: 'none', note: 'Not installed emulator' };

    // cache: cold boot emulator . 
    // "" 10 -- / AEHD, . 
    const cached = this.envCacheGet(exe);
    if (cached && cached.accel) {
      const ttl = cached.accel.ok ? ENV_CACHE_TTL : ENV_CACHE_NEG_TTL;
      if (Date.now() - (cached.accelAt || 0) < ttl) {
        this._cache.accel = cached.accel;
        this._cache.accelAt = Date.now();
        return cached.accel;
      }
    }

    const aehdSys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'aehd.sys');
    const hasAehdFile = fs.existsSync(aehdSys) || fs.existsSync(path.join(p.aehdDir, 'aehd.sys'));
    const hv = await this.hypervisor();

    const r = await run(exe, ['-accel-check'], { timeout: 30000 });
    const text = `${r.stdout}${r.stderr}`;
    const usable = /accel:\s*\n?0\b/.test(text) && !/ERROR_ACCESS_DENIED|not installed/i.test(text);

    let result;
    if (usable) {
      const kind = hasAehdFile && /aehd/i.test(text) ? 'aehd' : 'whpx';
      result = { ok: true, kind, note: kind === 'whpx' ? 'WHPX hardware acceleration enabled' : 'AEHD hardware acceleration enabled' };
    } else if (/can't find the emulator-check|corrupted tools installation/i.test(text) && hasAehdFile) {
      // runtime emulator-check.exe,  -accel-check . 
      // AEHD driverinstall, "": launch emulator driver, 
      // -accel off(software emulation). 
      result = { ok: true, kind: 'aehd', note: 'AEHD hardware acceleration enabled (emulator-check missing; determined from driver)' };
    } else if (hasAehdFile && /aehd/i.test(text) && !/ERROR_ACCESS_DENIED/i.test(text)) {
      result = { ok: true, kind: 'aehd', note: 'AEHD hardware acceleration enabled' };
    } else if (hv.dll && /whpx/i.test(text) && !/error|denied/i.test(text)) {
      result = { ok: true, kind: 'whpx', note: 'WHPX hardware acceleration enabled' };
    } else {
      result = {
        ok: false,
        kind: 'none',
        whpx: hv.whpx,
        aehdInstalled: hasAehdFile,
        viaTcg: true,
        note: 'Hardware acceleration not available: falling back to software emulation (works but slow). Install the AEHD driver or enable "Windows Hypervisor Platform".',
      };
    }
    this._cache.accel = result;
    this._cache.accelAt = Date.now();
    this.envCacheSet(exe, { accel: result, accelAt: Date.now() });
    return result;
  }

 /** downloadinstall emulator(zip emulator/,  SDK root) */
  async installEmulator(onProgress = () => {}) {
    const p = this.ensureDirs();
    await this.guardDisk('emulator', p.root);
    const url = await this.resolveEmulatorUrl();
    const zip = path.join(p.tmp, 'emulator.zip');
    onProgress({ stage: 'download', message: 'Downloading runtime engine (~440 MB from Google official source)...', percent: 1 });

    await downloadAnyParallel(this._downloadUrls(url), zip, {
      connections: 8,
      minChunk: 4 * 1024 * 1024,
      onProgress: (pr) => onProgress({
        stage: 'download',
        message: `Downloading runtime engine ${(pr.got / 1048576).toFixed(0)} MB / ${(pr.total / 1048576).toFixed(0)} MB`
          + (pr.speed ? ` (${(pr.speed / 1048576).toFixed(1)} MB/s)` : ''),
        percent: Math.round(pr.percent * 0.85),
        canResume: true,
      }),
    });
    assertComplete(zip, MIN_SIZE.emulator, 'Runtime Engine');

    onProgress({ stage: 'extract', message: 'Extracting runtime engine...', percent: 88 });
    await this.extractZip(zip, p.root);
    fs.rmSync(zip, { force: true });

    // SDK root platform-tools,  emulator launch
    this.ensurePlatformTools();

    const v = await this.emulatorVersion();
    if (!v.ok) throw new Error('emulator failed to launch after extraction; check antivirus');
    this._cache.emulatorVersion = v.version;
    onProgress({ stage: 'done', message: `Runtime engine ${v.version} ready`, percent: 100 });
    return v;
  }

 /** emulator SDK root platform-tools directory,  FATAL */
  ensurePlatformTools() {
    const p = this.paths();
    fs.mkdirSync(p.adbDir, { recursive: true });
    if (fs.existsSync(p.adbExe)) return true;
    const src = [
      path.join(this.appRoot, 'engine', 'platform-tools'),
      path.join(this.appRoot, 'tools', 'platform-tools'),
      path.dirname(this.adbVersionPath() || ''),
    ].find((d) => d && fs.existsSync(path.join(d, 'adb.exe')));
    if (!src) return false;
    for (const f of ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll']) {
      const from = path.join(src, f);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(p.adbDir, f));
    }
    return fs.existsSync(p.adbExe);
  }

  adbVersionPath() {
    try {
      const s = store.getSettings();
      if (s.adbPath && fs.existsSync(s.adbPath)) return s.adbPath;
    } catch (_) { /* ignore */ }
    return '';
  }

 /** downloadsystem image(Android 14 Play x86_64), "/" */
  async installSystemImage(onProgress = () => {}) {
    if (this.playImageInfo().ok) return this.playImageInfo();
    return this.installPlayImage(onProgress);
  }

 /** ARM system image(Google Play ) */
  playImageInfo() {
    const p = this.paths();
    const rel = `android-${PLAY_SYSIMG.api}/${PLAY_SYSIMG.tag}/${PLAY_SYSIMG.abi}`;
    // : (directory). 
    // /install system.img.xz, boot --
    // ,  installSystemImage / autoDeploy . 
    const dirs = [path.join(p.sysImgRoot, rel), path.join(this.root, 'system-images', rel)];
    let packed = null;
    for (const dir of dirs) {
      if (!fs.existsSync(path.join(dir, 'kernel-ranchu'))) continue;
      const size = fileSize(path.join(dir, 'system.img'));
      if (size > MIN_SIZE.sysimg) {
        return { ok: true, dir, size, api: PLAY_SYSIMG.api, tag: PLAY_SYSIMG.tag, compressed: false };
      }
      if (!packed) {
        for (const name of ['system.img.xz', 'system.img.gz']) {
          const cs = fileSize(path.join(dir, name));
          if (cs > MIN_SIZE.sysimg) {
            packed = { ok: true, dir, size: cs, api: PLAY_SYSIMG.api, tag: PLAY_SYSIMG.tag, compressed: true, file: name };
            break;
          }
        }
      }
    }
    if (packed) return packed;
    const size = fileSize(path.join(dirs[0], 'system.img'));
    return { ok: false, dir: dirs[0], size, note: size ? 'Image incomplete' : 'Not downloaded' };
  }

 /** Google Play system image(<url> directory) */
  async resolvePlayUrl() {
    if (this._cache.playUrl) return this._cache.playUrl;
    try {
      const xml = await this._fetchText(SOURCES.playImgIndex);
      const want = `system-images;android-${PLAY_SYSIMG.api};${PLAY_SYSIMG.tag};${PLAY_SYSIMG.abi}`;
      const block = new RegExp(`<remotePackage path="${want}"[\\s\\S]*?</remotePackage>`).exec(xml);
      if (block) {
        const base = baseOf(SOURCES.playImgIndex);
        const urls = [...block[0].matchAll(/<url>([^<]+)<\/url>/g)].map((m) => absUrl(m[1], base))
          .filter((u) => /x86_64.*\.zip$/i.test(u));
        if (urls.length) {
          this._cache.playUrl = urls[urls.length - 1];
          return this._cache.playUrl;
        }
      }
    } catch (_) { /* fallback */ }
    this._cache.playUrl = SOURCES.playImgFallback;
    return this._cache.playUrl;
  }

 /** downloadinstall ARM system image(Google Play ,  1.5GB) */
  async installPlayImage(onProgress = () => {}) {
    const p = this.ensureDirs();
    await this.guardDisk('playimg', p.sysImgRoot);
    const url = await this.resolvePlayUrl();
    const zip = path.join(p.tmp, 'play-sysimg.zip');
    onProgress({ stage: 'download', message: 'Downloading ARM compatible image (Android 14, ~1.5 GB)...', percent: 1 });
    await downloadAnyParallel(this._downloadUrls(url), zip, {
      connections: 8,
      minChunk: 4 * 1024 * 1024,
      onProgress: (pr) => onProgress({
        stage: 'download',
        message: `Downloading compatible image ${(pr.got / 1048576).toFixed(0)} MB / ${(pr.total / 1048576).toFixed(0)} MB`
          + (pr.speed ? ` (${(pr.speed / 1048576).toFixed(1)} MB/s)` : ''),
        percent: Math.round(pr.percent * 0.8),
        canResume: true,
      }),
    });
    assertComplete(zip, MIN_SIZE.sysimg, 'Compatible Image');

    const dest = path.join(p.sysImgRoot, `android-${PLAY_SYSIMG.api}`, PLAY_SYSIMG.tag);
    fs.mkdirSync(dest, { recursive: true });
    onProgress({ stage: 'extract', message: 'Extracting compatible image (~10-20 seconds)...', percent: 82 });
    await this.extractZip(zip, dest, {
      onEntry: (_n, i, total) => onProgress({
        stage: 'extract',
        message: `Extracting compatible image ${i}/${total}`,
        percent: 82 + Math.round((i / Math.max(1, total)) * 15),
      }),
    });
    fs.rmSync(zip, { force: true });

    const info = this.playImageInfo();
    if (!info.ok) throw new Error('Compatible image extraction verification failed');
    // (API 30)system image, successcleanspace
    for (const old of ['android-30']) {
      const legacy = path.join(p.sysImgRoot, old, 'google_apis_playstore');
      if (fs.existsSync(legacy)) fs.rmSync(legacy, { recursive: true, force: true });
    }
    onProgress({ stage: 'done', message: 'ARM compatible image ready; restart runtime to take effect', percent: 100 });
    return info;
  }

 /** download AEHD driver(); install,  */
  async installAehd(onProgress = () => {}) {
    const p = this.ensureDirs();
    await this.guardDisk('aehd', p.aehdDir);
    const zip = path.join(p.tmp, 'aehd.zip');
    onProgress({ stage: 'download', message: 'Downloading AEHD driver...', percent: 10 });
    await downloadAnyParallel(this._downloadUrls(SOURCES.aehdFallback), zip, { connections: 2 });
    fs.mkdirSync(p.aehdDir, { recursive: true });
    await this.extractZip(zip, p.aehdDir);
    fs.rmSync(zip, { force: true });
    const has = fs.existsSync(path.join(p.aehdDir, 'aehd.Sys')) || fs.existsSync(path.join(p.aehdDir, 'aehd.sys'));
    if (!has) throw new Error('AEHD driver extraction error');
    this._cache.accel = null;
    this._cache.accelAt = 0;
    onProgress({ stage: 'done', message: 'AEHD driver ready; admin elevation required', percent: 100 });
    return { ok: true, dir: p.aehdDir, installer: path.join(p.aehdDir, 'silent_install.bat') };
  }

  // ---------------- QEMU ----------------

 /** directoryinstall(version) */
  async resolveQemuUrl() {
    const configured = store.getSettings().runtime.qemuUrl;
    if (configured && configured.trim()) return configured.trim();
    try {
      const { openStream } = require('./download');
      const res = await openStream(SOURCES.qemuIndex);
      const html = await new Promise((resolve, reject) => {
        let d = '';
        res.on('data', (c) => { d += c; if (d.length > 512 * 1024) res.destroy(); });
        res.on('end', () => resolve(d));
        res.on('error', reject);
      });
      const files = [...html.matchAll(/href="([^"]*qemu-w64-setup-(\d+)\.exe)"/g)]
        .map((m) => ({ file: m[1], ver: Number(m[2]) }))
        .sort((a, b) => b.ver - a.ver);
      if (files.length) {
        const f = files[0].file.replace(/^.*\//, '');
        return new URL(f, SOURCES.qemuIndex).href;
      }
    } catch (_) { /*  */ }
    return SOURCES.qemuFallback[0];
  }

  async installQemu(onProgress = () => {}) {
    const p = this.ensureDirs();
    await this.guardDisk('qemu', p.root);
    const setup = path.join(p.tmp, 'qemu-setup.exe');

    onProgress({ stage: 'resolve', message: 'Checking latest QEMU release...', percent: 1 });
    const url = await this.resolveQemuUrl();
    onProgress({ stage: 'download', message: `Downloading QEMU (~200 MB)...`, percent: 2, url });

    await download(url, setup, {
      resume: true,
      onProgress: (pr) => onProgress({
        stage: 'download',
        message: `Downloading QEMU... ${(pr.got / 1048576).toFixed(0)} MB / ${(pr.total / 1048576).toFixed(0)} MB`
          + (pr.speed ? ` (${(pr.speed / 1024).toFixed(0)} KB/s)` : ''),
        percent: pr.percent,
        canResume: true,
      }),
    });
    assertComplete(setup, MIN_SIZE.qemu, 'QEMU installer package');

    onProgress({ stage: 'install', message: 'Installing QEMU silently...', percent: 96 });
    // qemu-w64-setup NSIS install: /S , /D directory()
    const target = p.qemuDir;
    fs.mkdirSync(target, { recursive: true });
    await new Promise((resolve) => {
      const proc = spawn(setup, ['/S', `/D=${target}`], { windowsHide: true, stdio: 'ignore' });
      proc.on('exit', () => resolve());
      proc.on('error', () => resolve());
      setTimeout(() => { try { proc.kill(); } catch (_) {} resolve(); }, 600000);
    });

    const v = await this.qemuVersion();
    if (!v.ok) {
      throw new Error('qemu-system-x86_64.exe not found after install');
    }
    fs.rmSync(setup, { force: true });
    this._cache.qemuVersion = v.version;
    onProgress({ stage: 'done', message: `QEMU ${v.version} ready`, percent: 100 });
    return v;
  }

  // ---------------- system image ----------------

  async downloadIso(onProgress = () => {}) {
    const p = this.ensureDirs();
    const s = store.getSettings();
    const dest = s.runtime.isoPath || p.iso;
    await this.guardDisk('iso', path.dirname(dest));
    const custom = s.runtime.isoUrl && s.runtime.isoUrl.trim();
    const urls = custom ? [custom, ...SOURCES.iso] : SOURCES.iso;

    onProgress({ stage: 'download', message: 'Downloading Android-x86 9.0-r2 (~900 MB)...', percent: 1 });
    const r = await downloadAnyParallel(urls, dest, {
      connections: 8,
      onProgress: (pr) => onProgress({
        stage: 'download',
        message: `Downloading system image... ${(pr.got / 1048576).toFixed(0)} MB / ${(pr.total / 1048576).toFixed(0)} MB`
          + (pr.speed ? ` (${(pr.speed / 1024).toFixed(0)} KB/s)` : ''),
        percent: pr.percent,
        canResume: true,
      }),
    });

    const info = this.inspectIso(dest);
    if (!info.ok) {
      throw new Error(`System image unavailable: ${info.reason}${info.size && info.size < MIN_SIZE.iso ? ' (resume supported)' : ''}`);
    }

    store.saveSettings({ runtime: { isoPath: dest } });
    onProgress({ stage: 'done', message: `System image ready (${(info.size / 1073741824).toFixed(2)} GB)`, percent: 100, path: dest });
    return { ...r, ...info };
  }

 /** verifysystem image/ISO */
  inspectImage(file) {
    const size = fileSize(file);
    if (!size) throw new Error('File does not exist or is empty');
    const fd = fs.openSync(file, 'r');
    const head4 = Buffer.alloc(4);
    fs.readSync(fd, head4, 0, 4, 0);
    fs.closeSync(fd);
    const magic = head4.toString('hex');
    let kind = 'unknown';
    if (magic === '514649fb') kind = 'qcow2';
    else if (head4.toString('ascii', 0, 4) === 'KDMV') kind = 'vmdk';
    else if (size > 400 * 1024 * 1024 && magic !== '00000000') kind = 'raw-or-iso';
    return { kind, size, path: file };
  }

  importIso(file) {
    const info = this.inspectIso(file);
    if (!info.ok) {
      const e = new Error(info.reason || 'Image file unavailable');
      e.invalidIso = true;
      throw e;
    }
    store.saveSettings({ runtime: { isoPath: file } });
    return { ok: true, ...info };
  }

  importDisk(file) {
    const info = this.inspectImage(file);
    store.saveSettings({ runtime: { diskPath: file } });
    return { ok: true, ...info };
  }

  // ---------------- disk ----------------

  async createDisk(sizeGB = 24, onProgress = () => {}) {
    const p = this.ensureDirs();
    const s = store.getSettings();
    const dest = s.runtime.diskPath || p.disk;
    if (fileSize(dest) > MIN_SIZE.disk) return { ok: true, path: dest, existed: true };

    onProgress({ stage: 'disk', message: `Creating ${sizeGB}GB virtual disk...`, percent: 40 });
    const qemuImg = fs.existsSync(p.qemuImg)
      ? p.qemuImg
      : path.join(path.dirname(store.getSettings().runtime.qemuPath || ''), 'qemu-img.exe');

    const tool = fs.existsSync(qemuImg) ? qemuImg : null;
    if (tool) {
      const r = await run(tool, ['create', '-f', 'qcow2', dest, `${sizeGB}G`], { timeout: 120000 });
      if (!r.ok) throw new Error(`qemu-img failed to create virtual disk: ${r.stderr || r.stdout}`);
    } else {
      throw new Error('qemu-img.exe not found; please install QEMU');
    }
    store.saveSettings({ runtime: { diskPath: dest } });
    onProgress({ stage: 'done', message: 'Virtual disk created', percent: 100, path: dest });
    return { ok: true, path: dest, size: fileSize(dest) };
  }

  // ---------------- system image ----------------

  async probeSources() {
    const [adb, qemu, iso] = await Promise.all([
      head(SOURCES.adb[0]),
      head(SOURCES.qemuFallback[0]),
      head(SOURCES.iso[0]),
    ]);
    return { adb, qemu, iso };
  }
}

module.exports = { Provisioner, SOURCES, MIN_SIZE, absUrl, baseOf };
