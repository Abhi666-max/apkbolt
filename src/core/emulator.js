'use strict';
/**
 * Emulator : driver Google Android Emulator ApkBolt runtime. 
 *
 * : "parameters". 
 * 1. doctor.chooseProfile() memory/CPU/disk//versionparameters; 
 * 2. launchfailure planVariants() fallbackretry(GPU → software emulation → memorycold boot); 
 * 3. ,  AVD , pathpath, system imagesnapshot; 
 * 4. quickboot snapshot + data partition, "", . 
 *
 * probe (Runtime),  Android . 
 */
const { spawn, spawnSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { Provisioner } = require('./provision');
const doctor = require('./doctor');
const drivers = require('./drivers');
const userdata = require('./userdata');

const AVD_NAME = 'apkbolt';
const SNAPSHOT_NAME = 'apkbolt';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Windows emulator/qemu exit. 
 * 0xC0000005(3221225477): , 
 * driver / Vulkan guest launch, . 
 */
function describeExitCode(code) {
  // code null(Windows taskkill / adb emu kill ), 
  // 0 "exit", , . 
  if (code == null) return '';
  switch (Number(code)) {
    case 0: return 'Normal exit';
    case 1: return 'Startup arguments or environment error';
    case 3221225477: return '0xC0000005 Access violation, rendering backend crashed';
    case 3221225725: return '0xC00000FD Stack overflow';
    // 0xC0000135 " DLL success",  VC++
    // : store version WindowsApps directory. 
    // DLL,  WER FaultingModuleName,  UI . 
    case 3221225781: return '0xC0000135 Dependent DLL failed to load';
    case 3221225506: return '0xC0000022 Access denied (driver or permission issue)';
    case 3221225595: return '0xC000007B Binary architecture mismatch or corrupted DLL';
    default: return '';
  }
}

class EmulatorEngine {
  constructor(appRoot) {
    this.appRoot = appRoot;
    this.provisioner = new Provisioner(appRoot);
    this.proc = null;
    this._log = [];
    this.port = 5554;
    this.adbPort = Number(process.env.ANDROID_ADB_SERVER_PORT) || 5044;
    this.profile = null;
    this.attempts = [];
    this.lastDiagnosis = null;
    this.lastExitCode = null;
    /**
 * bootdriver(patch), driver. 
 * start() _resolveDrivers() ; buildArgs / env / ensureAvd . 
     */
    this._driverEffect = null;
    this._driversApplied = [];
    // snapshot ram.bin ≈ memory(2-4GB). 
    // cold boot GB disk, "". 
    this.snapshotWorthSaving = null;
  }

  log(line) {
    this._log.push({ t: Date.now(), line });
    if (this._log.length > 600) this._log.shift();
  }

  get settings() { return store.getSettings(); }

  /**
 * "launchfailure". 
 * memory(this.attempts), restart ApkBolt diagnose, 
 * attempts: [], bootLog: [] , log -- 
 * issue #20/#25 "". 
   */
  _persistFailure(extra = {}) {
    try {
      const dir = path.join(store.DATA_DIR, 'logs');
      fs.mkdirSync(dir, { recursive: true });
      const data = {
        at: new Date().toISOString(),
        exitCode: this.lastExitCode,
        exitMeaning: describeExitCode(this.lastExitCode),
        diagnosis: this.lastDiagnosis,
        attempts: this.attempts,
        ...extra,
      };
      fs.writeFileSync(path.join(dir, 'last-failure.json'), JSON.stringify(data, null, 2), 'utf8');
    } catch (_) { /* failure */ }
  }

 /** failure(diagnose / boothint) */
  lastFailure() {
    try {
      return JSON.parse(fs.readFileSync(path.join(store.DATA_DIR, 'logs', 'last-failure.json'), 'utf8'));
    } catch (_) { return null; }
  }

  _clearFailure() {
    try { fs.rmSync(path.join(store.DATA_DIR, 'logs', 'last-failure.json'), { force: true }); } catch (_) { /* ignore */ }
  }

  get serial() { return `emulator-${this.port}`; }

 /** emulator.exe system imagedirectory(runtimedirectory,  engine/) */
  locate() {
    const p = this.provisioner.paths();
    const emuCandidates = [p.emulatorExe, path.join(this.appRoot, 'engine', 'emulator', 'emulator.exe')];
    const emulatorExe = emuCandidates.find((c) => fs.existsSync(c)) || '';
    const img = this.provisioner.systemImageInfo();
    return { emulatorExe, sysImgDir: img.dir, sysImgOk: img.ok, root: emulatorExe ? path.dirname(path.dirname(emulatorExe)) : p.root };
  }

 /** system image: system image(API 34 Play), "" */
  imageChoice() {
    const play = this.provisioner.playImageInfo();
    const base = this.provisioner.systemImageInfo();
    if (play.ok) {
      return { compat: true, api: play.api, tag: play.tag, dir: play.dir, abi: 'x86_64' };
    }
    return { compat: false, api: base.api, tag: base.tag, dir: base.dir, abi: base.abi || this.provisioner.paths().sysAbi };
  }

  /**
 * quickboot snapshot. 
 * snapshotmemorydisksystem image, app/snapshot, 
 * "apprestart". 
   */
  invalidateSnapshot() {
    this.cancelSnapshotSave();
    this._snapSaved = false;
    try {
      const snapDir = path.join(this.provisioner.paths().avdHome, `${AVD_NAME}.avd`, 'snapshots');
      fs.rmSync(snapDir, { recursive: true, force: true });
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
 * exit. 
 * note hardware-qemu.ini.lock **directory**, bsdtar rmSync(force) , 
 * emulator "Running multiple emulators with the same AVD" 
 * (), . 
   */
  clearLocks(avdDir) {
    try {
      for (const f of fs.readdirSync(avdDir)) {
        if (!/\.lock$/i.test(f)) continue;
        try {
          fs.rmSync(path.join(avdDir, f), { recursive: true, force: true });
        } catch (_) { /* ,  */ }
      }
    } catch (_) { /* ignore */ }
  }

  /**
 * AVD directory**** quickboot snapshot. 
 * "directory":  12 snapshot.pb , 
 * emulator , failure(log "does not have the requested snapshot")cold boot, 
 * . verify,  default_boot( 3GB). 
   */
  hasSnapshot() {
    const base = path.join(this.provisioner.paths().avdHome, `${AVD_NAME}.avd`, 'snapshots', SNAPSHOT_NAME);
    const size = (p) => { try { return fs.statSync(p).size; } catch (_) { return 0; } };
    const pb = size(path.join(base, 'snapshot.pb'));
    // emulator(37.x) ram.bin, version ram.img. 
    // ram.img :  3GB snapshot, 
    // -no-snapshot-load, cold boot -- "". 
    const ram = Math.max(size(path.join(base, 'ram.bin')), size(path.join(base, 'ram.img')));
    if (pb > 1024 && ram > 1024 * 1024) return true;
    if (pb === 0 && ram === 0) return false;   // directory, 
    try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    this._cleanLegacySnapshots();
    return false;
  }

 /** /failuresnapshotdirectory(default_boot ram.img 3GB) */
  _cleanLegacySnapshots() {
    const dir = path.dirname(path.join(this.provisioner.paths().avdHome, `${AVD_NAME}.avd`, 'snapshots', SNAPSHOT_NAME));
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { return; }
    for (const name of names) {
      if (name === SNAPSHOT_NAME) continue;
      if (/^default_boot$|\.stale-\d+$/i.test(name)) {
        try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); } catch (_) { /* ignore */ }
      }
    }
  }

  /**
 * AVD emulator. 
 * emulator.exe launch,  qemu spawn (detached), 
 * kill proc multiinstance.lock, 
 * launch FATAL "Running multiple emulators with the same AVD". 
 * "AVD pid"+" AVD qemu/emulator". 
   */
  /**
 * AVD . 
   *
 * : landscape**** -- `wm size` , 
 * 90°; `adb emu rotate` , portrait. 
 * `hw.lcd.width/height` + restart.  config.ini bootsettings, 
 * ****orientation. 
   *
 * @returns {boolean|null} true=landscape, false=portrait, null=
   */
  panelLandscape() {
    try {
      const avdDir = path.join(this.provisioner.paths().avdHome, `${AVD_NAME}.avd`);
      const cfg = fs.readFileSync(path.join(avdDir, 'config.ini'), 'utf8');
      const w = Number((/^hw\.lcd\.width=(\d+)$/m.exec(cfg) || [])[1]);
      const h = Number((/^hw\.lcd\.height=(\d+)$/m.exec(cfg) || [])[1]);
      if (!w || !h) return null;
      return w > h;
    } catch (_) {
      return null;
    }
  }

  async killOrphanProcesses({ onLog = () => {} } = {}) {
    if (process.platform !== 'win32') return 0;
    const avdDir = path.join(this.provisioner.paths().avdHome, `${AVD_NAME}.avd`);

    // path(cold boot): 
    // - .lock → emulator AVD, ; 
    // - lock → directory, . 
    // wmic(1~3 ,  CPU), cold boot. 
    let locks = [];
    try { locks = fs.readdirSync(avdDir).filter((f) => /\.lock$/i.test(f)); } catch (_) { locks = []; }
    if (!locks.length) return 0;
    if (!(await this._anyEmulatorPortAlive())) {
      this.clearLocks(avdDir);
      return 0;
    }

    const pids = new Set();
    // 1) lock file emulator pid()
    try {
      const f = path.join(avdDir, 'hardware-qemu.ini.lock', 'pid');
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        const pid = parseInt(fs.readFileSync(f, 'utf8').trim(), 10);
        if (pid) pids.add(pid);
      }
    } catch (_) { /* ignore */ }
    // 2) fallback:  + qemu(tasklist/netstat wmic )
    try {
      const [tl, ns] = await Promise.all([
        new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 3000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (e, o) => res(e ? '' : String(o || '')))),
        new Promise((res) => execFile('netstat', ['-ano', '-p', 'TCP'], { timeout: 3000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (e, o) => res(e ? '' : String(o || '')))),
      ]);
      const qemuPids = new Set();
      for (const line of tl.split('\n')) {
        const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
        if (m && /qemu|emulator/i.test(m[1])) qemuPids.add(m[2]);
      }
      for (const line of ns.split('\n')) {
        const m = /:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(line);
        if (m && qemuPids.has(m[2])) pids.add(Number(m[2]));
      }
    } catch (_) { /* lock file pid */ }
    pids.delete(process.pid);
    if (!pids.size) {
      this.clearLocks(avdDir);
      return 0;
    }
    onLog(`Cleaned up ${pids.size} stale emulator process(es)`);
    await Promise.all([...pids].map((pid) => new Promise((r) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => r());
    })));
    await sleep(1200);
    this.clearLocks(avdDir);
    return pids.size;
  }

 /** 5554~5620 emulator (, ) */
  async _anyEmulatorPortAlive() {
    const net = require('net');
    const probe = (port) => new Promise((resolve) => {
      const sock = net.connect({ host: '127.0.0.1', port });
      let done = false;
      const fin = (v) => { if (done) return; done = true; try { sock.destroy(); } catch (_) { /* ignore */ } resolve(v); };
      sock.setTimeout(120, () => fin(false));
      sock.once('connect', () => fin(true));
      sock.once('error', () => fin(false));
    });
    for (let port = 5554; port <= 5620; port += 2) {
      // eslint-disable-next-line no-await-in-loop
      if (await probe(port)) return true;
    }
    return false;
  }

  /**
 * /diagnosedriver: boot, , . 
   * @returns {{ applied:Array, effect:object|null, errors:Array, host:object|null }}
   */
  driverReport() {
    const pick = (d) => ({
      id: d.id, name: d.name, version: d.version, author: d.author || '',
      description: d.description || '', priority: d.priority, hits: d.hits || [],
      dir: d.dir || '', file: d.file || '',
    });
    return {
      applied: (this._driversApplied || []).map(pick),
      effect: this._driverEffect ? {
        gpuMode: this._driverEffect.gpuMode,
        forceTcg: this._driverEffect.forceTcg,
        notes: this._driverEffect.notes || [],
        ini: this._driverEffect.ini || {},
        env: this._driverEffect.env || {},
        args: (this._driverEffect.args || []).map((a) => (a.value ? `${a.flag}=${a.value}` : a.flag)),
      } : null,
      errors: this._driverErrors || [],
      host: this._driverHost || null,
    };
  }

  /**
 * driver config.ini defaultconfiguration. 
 * (), . 
 * drivers.js whitelist, verify. 
   */
  _iniWithDrivers(text) {
    const over = (this._driverEffect && this._driverEffect.ini) || {};
    const keys = Object.keys(over);
    if (!keys.length) return text;
    const seen = new Set();
    const out = String(text).split('\n').map((line) => {
      const m = /^([A-Za-z0-9_.]+)=/.exec(line);
      if (!m || !(m[1] in over)) return line;
      seen.add(m[1]);
      return `${m[1]}=${over[m[1]]}`;
    });
    for (const k of keys) if (!seen.has(k)) out.push(`${k}=${over[k]}`);
    return out.join('\n');
  }

  /**
 * driverdirectory, , boot. 
   *
 * directory: (, default enabled:false), driver, 
 * id directory -- , installdirectory. 
   *
   * @returns {{ applied:Array, skipped:Array, errors:Array } | null}
   */
  _resolveDrivers({ accel, emulatorVersion }) {
    const s = this.settings || {};
    const disabled = (s.drivers && s.drivers.disabled) || [];
    const state = (s.drivers && s.drivers.state) || {};
    let gpuName = '';
    let osBuild = 0;
    try {
      const release = require('os').release() || '';
      const m = /(\d+)\s*$/.exec(release);
      osBuild = m ? Number(m[1]) : 0;
    } catch (_) { /* 0,  osBuild driver */ }
    const host = drivers.hostContext({
      info: { ...doctor.hostInfo(), cpuVendor: (require('os').cpus() || [])[0]?.model || '' },
      gpuVendor: doctor.detectGpuVendor(),
      gpuName,
      osBuild,
      accel: accel && accel.ok ? (accel.kind || 'whpx') : 'none',
      emulatorVersion,
    });
    const loaded = drivers.loadAll([
      drivers.bundledDir(this.appRoot),
      drivers.userDir(store),
    ]);
    const r = drivers.resolve({ drivers: loaded.drivers, host, disabled, state });
    this._driverEffect = r.effect;
    this._driversApplied = r.applied;
    this._driverErrors = loaded.errors;
    this._driverHost = host;
    return { ...r, errors: loaded.errors, host };
  }

  /**
 * AVD:  config.ini. launchconfiguration, fallbackretry. 
   */
  ensureAvd({
    memoryMB = 2048, cores = 2, gpu = 'software', dataMB = 4096,
    heapMB = 256, accel = 'auto', snapshot = true, wipe = false, lcd = null,
  } = {}) {
    const p = this.provisioner.ensureDirs();
    const home = p.avdHome;
    const avdDir = path.join(home, `${AVD_NAME}.avd`);
    fs.mkdirSync(avdDir, { recursive: true });
    this.clearLocks(avdDir);

    // : hardware acceleration 720x1280@320 , ; 
    // software emulation 540x960, ( 56%, ). 
    const screen = lcd || doctor.lcdFor({ accelOk: this.profile ? this.profile.accelOk : accel !== 'off' });

    const choice = this.imageChoice();
    const tag = choice.tag;
    const api = choice.api;
    const tagDisplay = choice.compat ? 'Google Play (ARM compatible)' : 'AOSP';

    fs.writeFileSync(
      path.join(home, `${AVD_NAME}.ini`),
      `avd.ini.encoding=UTF-8\npath=${avdDir.replace(/\\/g, '/')}\ntarget=android-${api}\n`,
    );

    const cfgPath = path.join(avdDir, 'config.ini');
    const wantImg = choice.dir
      ? `${choice.dir.replace(/\\/g, '/')}/`
      : `system-images/android-${api}/${tag}/${choice.abi}/`;
    this.wipePending = false;
    if (fs.existsSync(cfgPath)) {
      const prev = fs.readFileSync(cfgPath, 'utf8');
      const prevTag = /tag\.id=(.+)$/m.exec(prev);
      const prevImg = /image\.sysdir\.1=(.+)$/m.exec(prev);
      // "system image"path: system image/directorysystem image, 
      // runtimedirectoryapp( doctor.imageIdentity ). 
      const prevId = prevImg ? doctor.imageIdentity(prevImg[1].trim()) : '';
      const wantId = doctor.imageIdentity(wantImg);
      if ((prevTag && prevTag[1].trim() !== tag) || (prevId && prevId !== wantId)) {
        // userdata system image(APEX ), 
        this.wipePending = true;
      }
    }

    // configuration → quickboot snapshotfailureblack screen, . 
    // note: **snapshot**,  -wipe-data -- app. 
    const key = `${doctor.snapshotKey({
      dataMB, emulatorVersion: this._emuVersion || '', api, tag,
    }, choice.dir)}|${screen.w}x${screen.h}@${screen.dpi}`;
    const keyFile = path.join(avdDir, 'snapshot.key');
    let prevKey = '';
    try { prevKey = fs.readFileSync(keyFile, 'utf8').trim(); } catch (_) { /*  */ }
    const snapshotStale = !!(prevKey && prevKey !== key);
    if (this.wipePending || snapshotStale || wipe) {
      // /(snapshotdirectory GB). 
      // failure emulator , cleanfailurelaunch. 
      const snapDir = path.join(avdDir, 'snapshots');
      try {
        fs.rmSync(snapDir, { recursive: true, force: true });
      } catch (_) {
        try { fs.renameSync(snapDir, `${snapDir}.stale-${Date.now()}`); } catch (__) { /* ignore */ }
      }
    }
    // "system image"(tag / sysdir ) -wipe-data:  userdata system image
    // APEX , . capacity / / . 
    fs.writeFileSync(keyFile, key, 'utf8');

    // hw.cpu.arch ABI (x86_64 x86)
    const cpuArch = choice.abi === 'arm64-v8a' ? 'arm64'
      : choice.abi === 'armeabi-v7a' ? 'arm' : choice.abi;

    const cfg = [
      `AvdId=${AVD_NAME}`,
      'avd.ini.displayname=ApkBolt',
      'avd.ini.encoding=UTF-8',
      `abi.type=${choice.abi}`,
      `hw.cpu.arch=${cpuArch}`,
      `hw.cpu.ncore=${cores}`,
      `hw.ramSize=${memoryMB}`,
      `vm.heapSize=${heapMB}`,
      `image.sysdir.1=${wantImg}`,
      `tag.id=${tag}`,
      `tag.display=${tagDisplay}`,
      // 16G, /boot
      `disk.dataPartition.size=${dataMB}M`,
      'hw.gpu.enabled=yes',
      `hw.gpu.mode=${gpu}`,
      'hw.keyboard=yes',
      // Wi-Fi . API 34 Play Store system image
      // wlan0(netsim ),  eth0. config.ini , 
      // emulator wlan0 -- wlan0 NO-CARRIER, 
      // `dumpsys connectivity` Active default network: none, app
      // "networkerror, ".  -netdelay/-netspeed/-dns-server
      // QEMU NAT parameters,  guest . 
      'hw.wifi=yes',
      'hw.lcd.width=' + screen.w,
      'hw.lcd.height=' + screen.h,
      'hw.lcd.density=' + screen.dpi,
      'hw.mainKeys=no',
      'ShowDeviceFrame=no',
      `PlayStore.enabled=${choice.compat}`,
      // snapshot -snapshot apkbolt : , 
      // default_boot( API30 system imagememory, ). 
      'hw.sdCard=no',
      'hw.audioInput=none',
      'hw.camera.back=none',
      'hw.camera.front=none',
      'hw.gps=no',
      // orientation/: , Android rotate, portrait
      // ( 90°, , ). 
      // wm density( smallestWidth), . 
      'hw.sensors.orientation=no',
    ].join('\n') + '\n';
    fs.writeFileSync(cfgPath, this._iniWithDrivers(cfg));

    // /data "", ( ensureDataPartition )
    const data = this.ensureDataPartition(avdDir, dataMB);

    return {
      home, avdDir, ini: path.join(home, `${AVD_NAME}.ini`), image: choice,
      wipePending: this.wipePending, screen, data,
    };
  }

  /**
 * userdata **** ext4 -- "app 30 desktop". 
   *
 * (): 
 * 1. system image userdata.img 1MB ,  avdmanager SDK 
 * mke2fs. ApkBolt config.ini emulator,  → /data →
 * "Invalid ext4 superblock on /dev/block/vdc" → guest recovery restart →
 * adbd → probe pending,  240s timeout. : . 
 * 2. emulator e2fsck/resize2fs cygwin e2fsprogs 1.42.12, ** encrypt
 * **,  exit 8 , "". 
 * 3. ≥ :  64MB , APEX extract + dexopt , 
 * setxattr ENOSPC → SELinux → netd/media/tombstoned
 * exit 1 → bootlaunch, adb offline. 
   */
  ensureDataPartition(avdDir, dataMB = 4096) {
    const emulatorExe = this.locate().emulatorExe;
    if (!emulatorExe || !fs.existsSync(emulatorExe)) return { ok: false, reason: 'no-emulator' };
    try { fs.mkdirSync(avdDir, { recursive: true }); } catch (_) { /* ignore */ }
    const emuDir = path.dirname(emulatorExe);
    const img = path.join(avdDir, 'userdata-qemu.img');
    const wantBytes = Math.max(1024, Math.round(dataMB || 4096)) * 1024 * 1024;
    let size = 0;
    try { size = fs.statSync(img).size; } catch (_) { /*  */ }

    if (size > 0 && userdata.hasExt4Superblock(img)) {
      // + , "". 
      // : qemu-img , resize2fs failure, 
      // 6GB, Android 64MB -- "space". 
      const fsBytes = userdata.fsBytes(img);
      const fsOk = fsBytes >= Math.min(size, wantBytes) * 0.95;
      if (size >= wantBytes && fsOk) return { ok: true, created: false, size, fsBytes };
      // capacityconfiguration(): , , app
      try {
        userdata.clearEncryptFlag(img);
        if (size < wantBytes) this._qemuImg('resize', img, wantBytes);
        this._resize2fs(img);
        userdata.setEncryptFlag(img);
        const grown = userdata.fsBytes(img);
        this.log(`Expanding userdata: file ${size} → ${wantBytes}, fs ${fsBytes} → ${grown}`);
        return { ok: true, created: false, grown: true, size: wantBytes, fsBytes: grown };
      } catch (e) {
        this.log(`Failed to expand userdata (continuing with existing partition): ${e.message}`);
        // , "", settingssuccess
        return { ok: false, created: false, size, fsBytes, error: e.message };
      }
    }

    // / / system image: 
    try {
      fs.rmSync(img, { force: true });
      fs.rmSync(`${img}.qcow2`, { force: true });
      // encrypt ( e2fsck/resize2fs )
      fs.writeFileSync(img, userdata.buildEmptyExt4({ sizeMB: 64, encrypt: false }));
      this._qemuImg('resize', img, wantBytes);
      this._resize2fs(img);
      userdata.setEncryptFlag(img);
      this.log(`Rebuilt userdata: ${(wantBytes / 1024 / 1024 / 1024).toFixed(1)}GB ext4 (4K block, FBE supported)`);
      return { ok: true, created: true, size: wantBytes };
    } catch (e) {
      // : failure,  encrypt ,  FBE ()
      try { userdata.setEncryptFlag(img); } catch (_) { /* ignore */ }
      this.log(`Failed to rebuild userdata: ${e.message}`);
      return { ok: false, created: true, error: e.message };
    }
  }

 /** emulator qemu-img.exe: system image(, complete)
 * noteparameters: `qemu-img <> -f raw <> <>`. 
 * -f parameters unrecognized option.  */
  _qemuImg(op, ...rest) {
    const exe = path.join(path.dirname(this.locate().emulatorExe), 'qemu-img.exe');
    const r = spawnSync(exe, [op, '-f', 'raw', ...rest], {
      cwd: path.dirname(exe), windowsHide: true, encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`qemu-img ${op} failed: ${(r.stderr || '').trim() || r.status}`);
  }

 /** emulator resize2fs.exe(cygwin ,  bin64 directory DLL) */
  _resize2fs(img) {
    const bin = path.join(path.dirname(this.locate().emulatorExe), 'bin64');
    const exe = path.join(bin, 'resize2fs.exe');
    if (!fs.existsSync(exe)) throw new Error('resize2fs.exe not found');
    const r = spawnSync(exe, [img], {
      cwd: bin, windowsHide: true, encoding: 'utf8', timeout: 180000,
    });
    if (r.status !== 0) throw new Error(`resize2fs failed: ${(r.stderr || '').trim() || r.status}`);
  }

 /** emulator SDK / AVD; path 8.3 path */
  env(root, plan = {}) {
    const safeRoot = doctor.shortPath(root);
    // AVD directory provisioner.paths().avdHome : bundled runtime(EXE
    // resources/runtime) root/avd , AVD directory. 
    const avdHome = doctor.shortPath(this.provisioner.paths().avdHome);
    const adbPort = String(plan.adbPort || process.env.ANDROID_ADB_SERVER_PORT || '5044');
    return {
      ...process.env,
      ANDROID_SDK_ROOT: safeRoot,
      ANDROID_HOME: safeRoot,
      ANDROID_AVD_HOME: avdHome,
      ANDROID_EMULATOR_HOME: avdHome,
      ANDROID_ADB_SERVER_PORT: adbPort,
      ANDROID_EMULATOR_USE_SYSTEM_LIBS: '',
      ...(plan.accel === 'off' ? { ANDROID_I_WANT_MY_TCG: 'yes' } : {}),
      // driver:  ANDROID_/QEMU_/LIBGL_/MESA_/EMUGL_ ( drivers.js)
      ...((this._driverEffect && this._driverEffect.env) || {}),
    };
  }

  /**
 * . default; settings(engine.locale), 
 * 'en-US' 'off' system image. 
   */
  _guestLocale() {
    const v = String(this.settings?.engine?.locale || 'zh-CN').trim();
    if (!v || v === 'off' || /^false$/i.test(v)) return '';
    return v;
  }

  buildArgs({
    headless = true, accel = 'auto', port = 5554,
    gpu = 'software', memoryMB = 2048, cores = 2,
    snapshot = true, wipe = false, lcd = null,
  } = {}) {
    // driver / software emulation.  gpu/accel, 
    // (-accel off, config.ini hw.gpu.mode). 
    const eff = this._driverEffect || null;
    const drvGpu = eff ? drivers.gpuModeToArg(eff.gpuMode) : '';
    if (drvGpu) gpu = drvGpu;
    if (eff && eff.forceTcg) accel = 'off';
    const args = [
      '-avd', AVD_NAME,
      '-port', String(port),
      // : default(Androidapphint/).  // settings -no-audio CPU. 
      ...(this.settings?.engine?.audio === false ? ['-no-audio'] : []),
      '-no-boot-anim',
      '-no-metrics',
      // : , emulator "", 
      // , boot(log Showing crashdialog to get consent). 
      '-crash-report-mode', 'disabled',
      '-gpu', gpu,
      // AMD + emulator 37.x: host Vulkan failure, 
      // exit 1, "host " swangle(), 
      // /.  Vulkan GL, hardware acceleration. 
      // Vulkan, ,  host . 
      ...(gpu === 'host' && process.platform === 'win32' && doctor.detectGpuVendor() === 'amd'
        ? ['-feature', '-Vulkan'] : []),
      '-memory', String(memoryMB),
      '-cores', String(cores),
    ];
    // network: AOSP emulatordefault QEMU NAT(-netdev user), Android
    // 10.0.2.x ,  NAT . 
    // [] Windows /
    // ( -netdev tap , ). 
    // Androidapp" NAT ", network, 
    // driver, network. 
    // : default full,  -gpu / -net
    // emulatorconfiguration, app(, ). 
    args.push('-netdelay', 'none', '-netspeed', 'full');
    // : default. 
    // `-prop persist.sys.locale=zh-CN` -- emulator persist.sys.*
    // , ro.product.locale system image build.prop ; guest getprop
    // .  -change-locale: restart framework, 
    // /data, snapshot. 
    // settings locale (engine.locale='off'). 
    const locale = this._guestLocale();
    if (locale) args.push('-change-locale', locale);
    // DNS: Androiddefault 10.0.2.3( DNS).  VPN / /
    // , , "". 
    // DNS , failure. settings(). 
    if (this.settings?.engine?.fastDns !== false) {
      args.push('-dns-server', '223.5.5.5,119.29.29.29');
    }
    if (lcd) args.push('-skin', `${lcd.w}x${lcd.h}`);
    if (headless) {
      args.push('-no-window');
    } else {
      // note: ** -no-skin**.  -skin, 
      // config.ini -- "settingslandscape, portrait", 
      // "".  -skin . 
      // (ShowDeviceFrame=no + style parameters). 
      // note:  -qt-hide-window. emulator**** Qt window, 
      // window SetParent windowappwindow --
      // probe window, appwindow. 
      // windowwindowresidentcomplete( win/agent.ps1 QuietSweep). 
    }
    // snapshot -snapshot:  AVD(snapshot), 
    // qemu memory, boot--
    // "boottimeout", parametersretry,  AVD
    // "Running multiple emulators with the same AVD". 
    // snapshotparameters"boot 8 90 ", : 
    // "snapshot -no-snapshot",  -no-snapshot **exit**, 
    // cold bootsnapshot, . 
    // -no-snapshot-load: (snapshot), 
    // exitmemory apkbolt, . 
    // snapshot 2~3GB ram.bin(disk, launch)
    const wantSnapshot = this.settings?.engine?.keepSnapshot !== false;
    if (wipe) {
      // snapshot(), **snapshot**: 
      // repairnetwork"boot → snapshot → ", 
      // -no-snapshot, , snapshot. 
      args.push('-no-snapshot-load');
    } else if (!wantSnapshot) {
      args.push('-no-snapshot');
    } else if (snapshot !== false) {
      args.push('-snapshot', SNAPSHOT_NAME);
      // networkself-healingcold boot: snapshot"", . 
      if (!this.hasSnapshot() || this._coldBoot) args.push('-no-snapshot-load');
    } else {
      args.push('-no-snapshot');
    }
    if (wipe) args.push('-wipe-data');
    if (accel === 'off') args.push('-accel', 'off');
    // driverparameters: -gpu / -accel gpu/accel , , 
    // parameters(emulator parametersversion). 
    for (const a of ((eff && eff.args) || [])) {
      if (a.flag === '-gpu' || a.flag === '-accel') continue;
      if (a.value === '') args.push(a.flag);
      else args.push(a.flag, a.value);
    }
    return args;
  }

 /** (boot, boot start() probe ) */
  spawnOnce(plan, { headless, onLog, logFile }) {
    const loc = this.locate();
    const env = this.env(loc.root, plan);
    const args = this.buildArgs({
      headless, accel: plan.accel, port: plan.port, gpu: plan.gpu,
      memoryMB: plan.memoryMB, cores: plan.cores,
      snapshot: plan.snapshot, wipe: plan.wipe, lcd: plan.lcd,
    });
    this._logWrite(logFile, `\n--- ${new Date().toISOString()} ${plan.label} ---\n${loc.emulatorExe} ${args.join(' ')}\n`);

    const proc = spawn(loc.emulatorExe, args, {
      cwd: path.dirname(loc.emulatorExe),
      env,
      windowsHide: true,
      // detached: emulator ApkBolt . 
      // Electron exit job , --
      // " ApkBolt cold boot 20 ". emulator, 
      // launch( Runtime.adoptExisting), . 
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = proc;
    try { proc.unref(); } catch (_) { /* ignore */ }

    const pipe = (stream) => {
      stream.setEncoding('utf8');
      let buf = '';
      stream.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const l of lines) {
          if (!l.trim()) continue;
          this.log(l.trim());
          this._logWrite(logFile, `${l.trim()}\n`);
        }
      });
    };
    pipe(proc.stdout);
    pipe(proc.stderr);
    proc.on('exit', (code) => {
      this.lastExitCode = code;
      const meaning = describeExitCode(code);
      this.log(`emulator exit ${code}${meaning ? `(${meaning})` : ''}`);
      this._logWrite(logFile, `emulator exit ${code}${meaning ? `(${meaning})` : ''}\n`);
      this.proc = null;
      onLog(`Runtime exited (code=${code}${meaning ? `, ${meaning}` : ''})`);
    });
    proc.on('error', (e) => {
      this.log(`spawn error: ${e.message}`);
      this._logWrite(logFile, `spawn error: ${e.message}\n`);
      this.proc = null;
    });

    // qemu detached , . 
    // 2~4 vCPU Normal Windows desktop CPU, 
    // " ApkBolt, mouse, ". 
    const perf = this.settings?.engine?.priorityMode === 'performance';
    setTimeout(() => {
      this.setPriority(perf ? 'normal' : 'below').catch(() => {});
    }, 3500).unref?.();
    return { proc, args };
  }

 /** emulatorlog: , disk */
  _logWrite(file, text) {
    const limit = Math.max(2048, Number(this.settings?.engine?.logLimitKB || 2048) * 4);
    require('./logfile').append(file, text, limit);
  }

 /** /data system image(settings, launchAndroid) */
  dataInfo() {
    const dir = path.join(this.provisioner.paths().avdHome, `${AVD_NAME}.avd`);
    const img = path.join(dir, 'userdata-qemu.img');
    let bytes = 0;
    try { bytes = fs.statSync(img).size; } catch (_) { /*  */ }
    let fsBytesNow = 0;
    try { fsBytesNow = userdata.fsBytes(img); } catch (_) { /*  */ }
    const configuredGB = Number(this.settings?.engine?.dataPartitionGB || 0);
    const fsGB = fsBytesNow ? Number((fsBytesNow / 1073741824).toFixed(1)) : 0;
    return {
      avdDir: dir,
      imageBytes: bytes,
      imageGB: bytes ? Number((bytes / 1073741824).toFixed(1)) : 0,
      // (≠ system image): system image resize2fs
      fsGB,
      configuredGB,
      // , 
      pendingGB: configuredGB && fsGB ? Math.max(0, configuredGB - fsGB) : 0,
      // quickboot userdata qcow2 , guest , system image
      overlay: this._hasDataOverlay(img),
    };
  }

 /** userdata quickboot qcow2 (, ) */
  _hasDataOverlay(img) {
    try { return fs.existsSync(`${img}.qcow2`); } catch (_) { return false; }
  }

  /**
 * /data (emulator, system image). 
   *
 * path, : 
 * - quickboot : (qemu-img resize + resize2fs), app; 
 * - : guest `userdata-qemu.img.qcow2`,  8GB, 
 * 8GB, guest `df /data` 5.7GB(), 
 * root . "", 
 * success -- ,  50GB failure. 
   */
  resizeDataPartition(dataMB) {
    const dir = path.join(this.provisioner.paths().avdHome, `${AVD_NAME}.avd`);
    const img = path.join(dir, 'userdata-qemu.img');
    const wantGB = Math.max(1, Math.round(Number(dataMB || 0) / 1024));
    if (this._hasDataOverlay(img)) {
      return {
        ok: false,
        needsReset: true,
        fsGB: this.dataInfo().fsGB,
        error: `Android is using a quickboot diff disk; live expansion cannot be applied directly (target ${wantGB} GB). Reset Android data to rebuild /data at new size (installed apps and data will be cleared).`,
      };
    }
    const r = this.ensureDataPartition(dir, dataMB);
    // ensureDataPartition resize2fs failure ok:false; , 
    // ", "success(space). 
    let fsAfter = 0;
    try { fsAfter = userdata.fsBytes(img); } catch (_) { /* ignore */ }
    const wantBytes = Math.max(1024, Math.round(Number(dataMB || 0))) * 1048576;
    if (r && r.ok && fsAfter < wantBytes * 0.95) {
      return {
        ok: false,
        ...r,
        fsGB: Number((fsAfter / 1073741824).toFixed(1)),
        error: `Image expanded to ${wantGB} GB, but filesystem is at ${(fsAfter / 1073741824).toFixed(1)} GB (resize2fs was unsuccessful). Click Expand Now again, or free up disk space and retry.`,
      };
    }
    return r;
  }

  /**
 * qemu/emulator ( AVD ). 
 * level: idle()| below(app)| normal(). 
   */
  setPriority(level = 'below') {
    if (process.platform !== 'win32') return Promise.resolve(0);
    const script = path.join(__dirname, 'win', 'priority.ps1');
    if (!fs.existsSync(script)) return Promise.resolve(0);
    return new Promise((resolve) => {
      execFile('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', script, '-Avd', AVD_NAME, '-Level', level,
      ], { windowsHide: true, timeout: 15000 }, (_err, out) => {
        const m = /CHANGED=(\d+)/.exec(String(out || ''));
        resolve(m ? Number(m[1]) : 0);
      });
    });
  }

 /** ( qemu ) */
  async killAttempt() {
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      try { proc.kill(); } catch (_) { /* ignore */ }
      if (process.platform === 'win32' && proc.pid) {
        try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch (_) { /* ignore */ }
      }
    }
    await sleep(800);
    // proc (emulator.exe launchexit, qemu detached ), 
    // fallback,  AVD FATAL. 
    await this.killOrphanProcesses().catch(() => {});
  }

  /**
 * adb server. 
   *
 * "app",  kill-server : 
 * emulator launch ANDROID_ADB_SERVER_PORT adb daemon, 
 * **** -- adb devices emulator-5554, 
 * offline(log "Unable to connect to adb daemon on port: 5044"). 
 * probe sys.boot_completed,  3 timeoutretry, 
 * retrycold boot, snapshot"", . 
   *
 * kill() start, . 
   */
 /** adb (offline / unauthorized)restart server */
  async resetAdbServer() {
    const port = Number(process.env.ANDROID_ADB_SERVER_PORT) || this.adbPort || 5044;
    return this._resetAdbServer(port);
  }

  async _resetAdbServer(adbPort) {
    let adb = 'adb';
    try { adb = this.provisioner.adbVersionPath() || 'adb'; } catch (_) { /* PATH */ }
    const env = { ...process.env, ANDROID_ADB_SERVER_PORT: String(adbPort) };
    const run = (args, timeout) => new Promise((resolve) => {
      try {
        execFile(adb, args, { timeout, windowsHide: true, env }, () => resolve());
      } catch (_) { resolve(); }
    });
    await run(['kill-server'], 6000);
    await run(['start-server'], 12000);
    // adb start-server ,  listen, 
    // ( ~3 , ). 
    const net = require('net');
    for (let i = 0; i < 25; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const alive = await new Promise((resolve) => {
        const sock = net.connect({ host: '127.0.0.1', port: Number(adbPort) });
        let done = false;
        const fin = (v) => { if (done) return; done = true; try { sock.destroy(); } catch (_) { /* ignore */ } resolve(v); };
        sock.setTimeout(150, () => fin(false));
        sock.once('connect', () => fin(true));
        sock.once('error', () => fin(false));
      });
      if (alive) return true;
      // eslint-disable-next-line no-await-in-loop
      await sleep(120);
    }
    return false;
  }

  /**
 * "spawn ". 
 * parameterserror/DLL emulator 1 ; , 
 * 2.5 -- snapshotboot. 
   */
  _waitSpawnSettled(ms = 900) {
    const proc = this.proc;
    if (!proc) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const onExit = () => fin(true);
      const fin = (exited) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { proc.removeListener('exit', onExit); } catch (_) { /* ignore */ }
        resolve(exited);
      };
      const timer = setTimeout(() => fin(false), ms);
      proc.once('exit', onExit);
    });
  }

  /**
 * "launch"cold boot(launchsnapshot). 
   *
 * snapshot: snapshot"", 
 * . networkself-healingcold bootsnapshot. 
   */
  forceColdBootOnNextStart() { this._coldBoot = true; }

  /**
 * "launch" -wipe-data("repairnetwork"failure). 
 * " userdata system image" emulator `-wipe-data` , . 
   */
  forceWipeOnNextStart() { this._forceWipe = true; }

  /**
 * checkup. 
   *
 * : Android Wi-Fi configuration /data , (
 * `cmd wifi list-networks` AndroidWifi , network id ), 
 * wlan0 NO-CARRIER,  IP. ""app
 * black screen -- "black screen",  GPU/. 
   *
 * @param {string} [adbPath] adb (Runtime )
   * @returns {Promise<{ok:boolean, reason:string, gateway?:string, ip?:string}>}
   */
  async checkNetwork(adbPath = '', { waitMs = 0, interval = 3000 } = {}) {
    const fs = require('fs');
    const path = require('path');
    // repairWifi: "path"error
    let adb = typeof adbPath === 'function' ? adbPath() : (adbPath || '');
    if (!adb) {
      try { adb = this.provisioner.adbVersionPath() || ''; } catch (_) { adb = ''; }
    }
    if (!adb) {
      // adbVersionPath() "version", install; 
      // runtimedirectory bundled platform-tools . 
      try { adb = path.join(this.locate().root, 'platform-tools', 'adb.exe'); } catch (_) { adb = ''; }
    }
    if (!adb || !fs.existsSync(adb)) adb = 'adb';
    const port = Number(process.env.ANDROID_ADB_SERVER_PORT) || this.adbPort || 5044;
    const env = { ...process.env, ANDROID_ADB_SERVER_PORT: String(port) };
    const sh = (cmd, timeout = 8000) => new Promise((resolve) => {
      try {
        execFile(adb, ['-s', this.serial, 'shell', cmd], { timeout, windowsHide: true, env }, (e, out) => {
          resolve(e ? '' : String(out || ''));
        });
      } catch (_) { resolve(''); }
    });
    // Android `ip route` (default per-interface ), 
    // shell uid app network , `ping` "Network is unreachable", 
    // Wi-Fi , app. " IPv4 ", 
    // `cmd wifi status` ,  ping . 
    const addr = await sh('ip -o addr');
    const ips = [];
    const re = /inet ((?:\d{1,3}\.){3}\d{1,3})\//g;
    let m = re.exec(addr);
    while (m) {
      const ip = m[1];
      if (!/^127\./.test(ip)) ips.push(ip);
      m = re.exec(addr);
    }
    const wifi = await sh('cmd wifi status');
    const connected = /Wifi is connected/i.test(wifi);
    if (!ips.length) {
      // Wi-Fi + DHCP sys.boot_completed complete. 
      // waitMs , "network". 
      if (waitMs > 0) {
        const t0 = Date.now();
        while (Date.now() - t0 < waitMs) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, interval));
          // eslint-disable-next-line no-await-in-loop
          const again = await this.checkNetwork(adbPath, { waitMs: 0 });
          if (again.ok) return again;
        }
      }
      return { ok: false, reason: connected ? 'no-ip-address' : 'wifi-not-connected', addrs: ips };
    }
    const ip = ips[0];
    const gw = /^10\.0\.2\./.test(ip) ? '10.0.2.2' : ip.replace(/\.\d+$/, '.1');
    // IP .  10.0.2.16 DNS/, app
    // "networkerror", network.  HTTP probe. 
    // nc 80 ping: QEMU NAT ICMP, ping . 
    // "network"path(waitMs>0), -- 3
    // 4 probe, launch.  reachable,  ok:  IP
    // app,  DNS launch. 
    let reachable = null;
    if (waitMs > 0) {
      const probe = await sh(
        "echo -e 'GET /generate_204 HTTP/1.0\\r\\nHost: connect.rom.miui.com\\r\\n\\r\\n' "
        + "| nc -w 4 connect.rom.miui.com 80 2>/dev/null | head -1",
        7000,
      );
      reachable = /HTTP\/1\.[01]\s+204/.test(probe);
    }
    return { ok: true, reason: '', gateway: gw, ip, wifiConnected: connected, reachable };
  }

  /**
 * "" AndroidWifi . 
   *
 * : emulator AndroidWifi configuration
 * (open + owe), 
   *   "Saved / Won't automatically connect"
 * boot wlan0 NO-CARRIER, appnetworkerror. 
   *
 * shell(uid 2000) NETWORK_SETTINGS , 
 * `cmd wifi connect-network` SecurityException, . 
 * Wi-Fi settings, network--. 
   *
 * @returns {Promise<boolean>} 
   */
  async repairWifi(adbPath = '') {
    const fs = require('fs');
    const path = require('path');
    // : (rt.adbPath ). 
    let adb = typeof adbPath === 'function' ? adbPath() : (adbPath || '');
    if (!adb) {
      try { adb = path.join(this.locate().root, 'platform-tools', 'adb.exe'); } catch (_) { adb = ''; }
    }
    if (!adb || !fs.existsSync(adb)) adb = 'adb';
    const port = Number(process.env.ANDROID_ADB_SERVER_PORT) || this.adbPort || 5044;
    const env = { ...process.env, ANDROID_ADB_SERVER_PORT: String(port) };
    const sh = (cmd, timeout = 10000) => new Promise((resolve) => {
      try {
        execFile(adb, ['-s', this.serial, 'shell', cmd], { timeout, windowsHide: true, env }, (e, out) => {
          resolve(e ? '' : String(out || ''));
        });
      } catch (_) { resolve(''); }
    });
    // ""probe. 
    // Androiddefault connectifitycheck.gstatic.com "", , 
    // network"!"(). app
    // , .  204 endpoint. 
    const tune = async () => {
      await sh('settings put global captive_portal_http_url http://connect.rom.miui.com/generate_204');
      await sh('settings put global captive_portal_https_url https://connect.rom.miui.com/generate_204');
      await sh('settings put global captive_portal_mode 0');
    };
    // Note
    if (/Wifi is connected/i.test(await sh('cmd wifi status'))) {
      await tune();
      return true;
    }
    // ( / -svc wifi disable)
    await sh('svc wifi enable');
    await new Promise((r) => setTimeout(r, 1500));

    // Wi-Fi settings,  uiautomator AndroidWifi . 
    // :  / . 
    await sh('am start -a android.settings.WIFI_SETTINGS');
    await new Promise((r) => setTimeout(r, 2500));
    await sh('uiautomator dump /sdcard/ui.xml');
    const xml = await new Promise((resolve) => {
      try {
        execFile(adb, ['-s', this.serial, 'shell', 'cat', '/sdcard/ui.xml'],
          { timeout: 10000, windowsHide: true, env, maxBuffer: 8 * 1024 * 1024 },
          (e, out) => resolve(e ? '' : String(out || '')));
      } catch (_) { resolve(''); }
    });
    // <node text="AndroidWifi" ... bounds="[x1,y1][x2,y2]" />
    const re = /<node[^>]*\btext="([^"]*)"[^>]*\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
    let m = re.exec(xml);
    while (m) {
      const label = m[1];
      if (/AndroidWifi/i.test(label)) {
        const cx = Math.round((Number(m[2]) + Number(m[4])) / 2);
        const cy = Math.round((Number(m[3]) + Number(m[5])) / 2);
        await sh(`input tap ${cx} ${cy}`);
        await new Promise((r) => setTimeout(r, 6000));
        if (/Wifi is connected/i.test(await sh('cmd wifi status'))) {
          await tune();
          return true;
        }
      }
      m = re.exec(xml);
    }
    // fallback: (version dump text,  content-desc)
    await sh('svc wifi disable');
    await new Promise((r) => setTimeout(r, 1500));
    await sh('svc wifi enable');
    await new Promise((r) => setTimeout(r, 6000));
    const ok = /Wifi is connected/i.test(await sh('cmd wifi status'));
    if (ok) await tune();
    return ok;
  }

  /**
 * launch + retry. 
 * @param {Function} probe ,  'ok' | 'pending' | 'fatal'
   */
  async start({ headless = false, onLog = () => {}, probe = null, maxAttempts = 4 } = {}) {
    if (this.proc && !this.proc.killed) {
      // : emulator.exe launch, spawn qemu exit,  proc
      // (killed false). ""
      // -- restart ensure() : start()
      // reused,  serial adb,  `device not found`, 
      // "apporientation App failure". 
      // , . 
      if (await this._consoleAlive()) {
        return { ok: true, reused: true, serial: this.serial, port: this.port };
      }
      onLog('Previous emulator instance has exited; restarting...');
      this.proc = null;
    }

    const loc = this.locate();
    if (!loc.emulatorExe) throw new Error('Runtime engine not installed. Please set up the engine in Runtime settings first.');
    const choice = this.imageChoice();
    if (choice.compat ? !this.provisioner.playImageInfo().ok : !this.provisioner.systemImageInfo().ok) {
      throw new Error('System image not ready. Please download an Android system image first.');
    }

    const s = this.settings;
    // bootdisk: emulator AVD(data partition + snapshot,  GB), 
    // diskboot; runtimedirectorylog, . 
    // , "directory D , C 400MB"
    // disk -- . 
    const avdHome = this.provisioner.paths().avdHome;
    const avdFreeMB = doctor.freeDiskMB(avdHome);
    const diskMB = doctor.freeDiskMB(loc.root);
    const needMB = 2500;
    if (avdFreeMB && avdFreeMB < needMB) {
      const msg = `Insufficient disk space: Android data drive (${avdHome}) has only ${(avdFreeMB / 1024).toFixed(1)} GB free, ` + `runtime requires at least ${(needMB / 1024).toFixed(1)} GB. Move it to a drive with more space in Settings or free up disk space. Installed apps and data are preserved.`;
      this.log(msg);
      onLog(msg);
      return { ok: false, error: msg, needsSpace: true, attempts: [] };
    }
    if (diskMB && diskMB < 300) {
      const msg = `Runtime directory (${loc.root}) has only ${(diskMB / 1024).toFixed(1)} GB free, insufficient for logs and temp files. Please free up space or relocate the runtime directory.`;
      this.log(msg);
      onLog(msg);
      return { ok: false, error: msg, needsSpace: true, attempts: [] };
    }
    const adbPort = await doctor.freeAdbPort(Number(process.env.ANDROID_ADB_SERVER_PORT) || 5044);
    // adb emulator server
    process.env.ANDROID_ADB_SERVER_PORT = String(adbPort);
    this.adbPort = adbPort;

    // , : " → version → → adb server", 
    // cold boot 3~5 , app. 
    // adb server (emulator offline), 
    // server , . 
    const [accelInfo, verInfo, startPort] = await Promise.all([
      this.provisioner.emulatorAccel(),
      this.provisioner.emulatorVersion(),
      doctor.freePortPair(5554),
      this._resetAdbServer(adbPort),
    ]);
    const emuVersion = verInfo.version || '';
    this._emuVersion = emuVersion;

    // driver(patch): , patch. 
    // JSON, ; , . 
    let drv = { applied: [], skipped: [], errors: [], effect: null };
    try {
      drv = this._resolveDrivers({ accel: accelInfo, emulatorVersion: emuVersion });
    } catch (e) {
      this.log(`Driver failed to load: ${e.message}`);
      onLog(`Driver failed to load (ignored, starting with defaults): ${e.message}`);
    }
    if (drv.applied.length) {
      onLog(`Applied driver(s): ${drv.applied.map((d) => `${d.name} v${d.version}`).join(', ')}`);
      for (const n of (this._driverEffect.notes || []).slice(0, 4)) onLog(` -  ${n}`);
    } else {
      onLog('No matching driver found, starting with default parameters');
    }
    if (drv.errors && drv.errors.length) {
      onLog(`${drv.errors.length} driver file(s) failed to load (check Settings → Drivers for details)`);
    }

    // settings / diagnose, """"
    const profile = doctor.autoProfile({
      settings: s, accel: accelInfo, emulatorVersion: emuVersion, diskMB,
      port: startPort, adbPort,
    });
    this.profile = profile;
    let variants = doctor.planVariants(profile).slice(0, maxAttempts);
    // driver / software emulation, : 
    // driver"", . 
    if (drv.applied.length && this._driverEffect) {
      const gpuFixed = drivers.gpuModeToArg(this._driverEffect.gpuMode);
      if (gpuFixed) {
        variants = variants.map((v) => ({ ...v, gpu: gpuFixed }));
        onLog(`Driver fixed rendering backend to ${gpuFixed}`);
      }
      if (this._driverEffect.forceTcg) {
        variants = variants.map((v) => ({ ...v, accel: 'off', label: `${v.gpu} / Driver requires software emulation` }));
        onLog('Driver requires disabling hardware acceleration (software emulation)');
      }
    }

    // "" GPU , . 
    // : AMD Radeon 780M `-gpu host` emulator , 
    // VM exit 1(log "AEHD is operational"), 
    // 20 swangle. key emulator version, 
    // upgraderuntime. 
    const badGpuKey = this.settings.engine.badGpu || '';
    const [badVer, badGpu] = badGpuKey.includes('|') ? badGpuKey.split('|') : ['', ''];
    // Vulkan host :  emulator versionretry, 
    // (""). 
    const vulkanRetried = String(this.settings.engine.badGpuVulkanTried || '');
    const retryHostWithoutVulkan = badGpu === 'host' && badVer === emuVersion && vulkanRetried !== emuVersion;
    if (retryHostWithoutVulkan) {
      store.saveSettings({ engine: { badGpu: '', badGpuVulkanTried: emuVersion } });
      onLog('Previous host render crash may be Vulkan-related; retrying hardware acceleration with -feature -Vulkan');
    } else if (badGpu && badVer === emuVersion) {
      const rank = (v) => (v.gpu === badGpu ? 1 : 0);
      variants.sort((a, b) => rank(a) - rank(b));
      if (variants[0] && variants[0].gpu === badGpu && variants.length > 1) {
        onLog(`Previous ${badGpu} rendering backend crashed on startup; trying ${variants[1].gpu} instead`);
      }
    }

    const logFile = path.join(store.DATA_DIR, 'logs', 'emulator.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    this._logWrite(logFile, `\n\n=== ${new Date().toISOString()} START ${doctor.describeProfile(profile)} ===\n`);
    this._logWrite(logFile, `drivers: ${drv.applied.length ? drv.applied.map((d) => `${d.id}@${d.version}`).join(', ') : '(none)'}\n`);

    // launch, retrysnapshot. 
    // doctor profile(settings""), auto . 
    const screen = (profile && profile.lcd) || doctor.lcdFor({ accelOk: accelInfo.ok });
    this.attempts = [];
    this.lastDiagnosis = null;
    let lastError = '';

    // :  qemu AVD , 
    // FATAL "Running multiple emulators with the same AVD". 
    // eslint-disable-next-line no-await-in-loop
    await this.killOrphanProcesses({ onLog }).catch(() => {});

    for (let i = 0; i < variants.length; i += 1) {
      const base = variants[i];
      // failure, retryprobe
      // eslint-disable-next-line no-await-in-loop
      const port = i === 0 ? startPort : await doctor.freePortPair(startPort + (i * 2));
      const plan = { ...base, port, adbPort, lcd: screen };
      this.port = port;
      // exit:  0xC0000005 diagnose
      this.lastExitCode = null;
      // log: memorylog,  1 , 
      // 2 (). 
      const logStart = this._log.length;
      onLog(`Starting runtime (attempt ${i + 1}/${variants.length}: ${plan.label})...`);

      // eslint-disable-next-line no-await-in-loop
      const avd = this.ensureAvd({
        ...plan,
        // _forceWipe "snapshot": snapshotfailure
        // ( Failed to load snapshot cold boot), . 
        wipe: plan.wipe || !!this.wipePending || !!this._forceWipe,
      });
      // : (main)emulator****. 
      // window spawn , , 
      // , . 
      if (this.onBeforeSpawn) {
        // eslint-disable-next-line no-await-in-loop
        try { await this.onBeforeSpawn(); } catch (_) { /* ignore */ }
      }
      // eslint-disable-next-line no-await-in-loop
      const forceWipe = !!this._forceWipe;
      this._forceWipe = false;
      // _coldBoot spawn , bootcold boot
      this.spawnOnce({ ...plan, wipe: plan.wipe || avd.wipePending || forceWipe }, { headless, onLog, logFile });
      this._coldBoot = false;

      // parameterserror / DLL exit
      // eslint-disable-next-line no-await-in-loop
      const dead = await this._waitSpawnSettled(2200);
      if (dead || !this.proc) {
        const d = doctor.diagnose(this._attemptLines(logStart, 60));
        this.attempts.push({ plan: plan.label, diagnosis: d.code, exitCode: this.lastExitCode });
        this.lastDiagnosis = d;
        lastError = `${d.title}: ${d.hint}`;
        // disk"parameters": retryfailure, 
        // parameters wipe, . , error. 
        if (d.code === 'DISK_FULL') {
          onLog('Insufficient disk space; retry stopped (installed apps and data are untouched).');
          this._persistFailure({ profile, why: 'disk-full' });
          return { ok: false, error: lastError, needsSpace: true, attempts: this.attempts, exitCode: this.lastExitCode };
        }
        // /system imagecache, , launchprobe
        if (['ACCEL', 'GPU_INIT', 'GPU_MODE', 'IMAGE', 'DLL', 'ACCESS_VIOLATION'].includes(d.code)) {
          try { this.provisioner.invalidateEnvCache(); } catch (_) { /* ignore */ }
        }
        onLog(`${d.title}; retrying automatically with alternative parameters...`);
        this._noteGpuFailure(plan);
        continue;
      }

      if (!probe) {
        return { ok: true, serial: this.serial, port, accel: accelInfo, logFile, profile, attempts: this.attempts };
      }

      const started = Date.now();
      const timeout = plan.bootTimeoutMs || 240000;
      let ok = false;
      let fatal = false;
      let sawBooting = false;
      // snapshot,  3 1.5 ""
      // .  200ms 1.2 : boot, 
      // CPU . 
      let interval = 200;
      let lastNotice = 0;
      // eslint-disable-next-line no-await-in-loop
      while (Date.now() - started < timeout) {
        if (!this.proc) { fatal = true; break; }
        let state = 'pending';
        try {
          // eslint-disable-next-line no-await-in-loop
          state = await probe({ serial: this.serial, port, adbPort });
        } catch (_) { state = 'pending'; }
        if (state === 'ok') { ok = true; break; }
        if (state === 'fatal') { fatal = true; break; }
        // adb shell, , log Vulkan/EGL failure
        if (state === 'booting') sawBooting = true;
        // 45 , logerror → ,  4
        if (!sawBooting && Date.now() - started > 45000) {
          const d = doctor.diagnose(this._attemptLines(logStart, 80));
          if (['GPU_INIT', 'ACCEL', 'GPU_MODE', 'IMAGE', 'DLL', 'MEMORY', 'ACCESS_VIOLATION'].includes(d.code)) {
            this.lastDiagnosis = d;
            try { this.provisioner.invalidateEnvCache(); } catch (_) { /* ignore */ }
            fatal = true;
            break;
          }
        }
        // 15 : "", 
        if (Date.now() - lastNotice > 15000) {
          lastNotice = Date.now();
          onLog(`Booting... ${Math.round((Date.now() - started) / 1000)}s`);
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(interval);
        interval = Math.min(1200, Math.round(interval * 1.6));
      }

      if (ok) {
        const bootMs = Date.now() - started;
        // : failure, "diagnose"
        this._clearFailure();
        // quickboot snapshot: emulator ApkBolt exit(Electron
        // job ), snapshot 25 7 . 
        // app installer snapshot, "restartapp". 
        this.snapshotWorthSaving = true;
        onLog(`Runtime ready (${Math.round(bootMs / 1000)}s, ${plan.label})`);
        // bootsuccess: checkupnetwork. , black screen, 
        // "appblack screen", network. . 
        //
        // "": Wi-Fi + DHCP sys.boot_completed
        // 5~20 ,  checkNetwork() , **cold boot**
        // "⚠ network, Android",  5 network --
        // app.  12 window(), timeouthint, 
        // . 
        let network = null;
        try {
          network = await this.checkNetwork('', { waitMs: 12000, interval: 3000 });
        } catch (_) { /* checkupfailurelaunchfailure */ }
        if (network && !network.ok) {
          onLog('⚠ Android VM currently has no internet connection (Wi-Fi not connected or IP not obtained). '
            + 'Network-dependent apps may show a black screen; reopen them once connected; '
            + 'if connection issues persist, use Settings → Repair Network (will not delete installed apps).');
        }
        return {
          ok: true, serial: this.serial, port, accel: accelInfo, logFile,
          profile, attempts: this.attempts, bootMs, quickBoot: true, network,
        };
      }

      const attemptLines = this._attemptLines(logStart, 80);
      const d = fatal ? (this.lastDiagnosis || doctor.diagnose(attemptLines)) : doctor.diagnose(attemptLines);
      this.attempts.push({ plan: plan.label, diagnosis: d.code, timeout: !fatal, exitCode: this.lastExitCode });
      this.lastDiagnosis = d;
      lastError = fatal ? `${d.title}: ${d.hint}` : 'Boot timeout (initial boot may take longer or hardware acceleration is inactive)';
      onLog(`${lastError}; retrying automatically with alternative parameters...`);
      // ,  GPU "launch"blacklist, 
      // launch. 
      if (d.code !== 'ADB_UNAUTHORIZED') this._noteGpuFailure(plan);
      // eslint-disable-next-line no-await-in-loop
      await this.killAttempt();
    }

    const d = this.lastDiagnosis || doctor.diagnose(this.recentLog(120));
    const report = doctor.writeReport({
      dataDir: store.DATA_DIR, profile, logLines: this.recentLog(300),
      extra: {
        attempts: this.attempts,
        diagnosis: d,
        image: choice,
        exitCode: this.lastExitCode,
        exitMeaning: describeExitCode(this.lastExitCode),
      },
    });
    const err = new Error(
      `Runtime failed to start after multiple attempts (${d.title}).\n${d.hint}\n\n`
      + `Attempts: ${this.attempts.map((a) => `${a.plan} → ${a.diagnosis}`).join('; ')}\n`
      + `Diagnostic report: ${report.file}`,
    );
    err.diagnosis = d;
    err.report = report.file;
    err.attempts = this.attempts;
    this._persistFailure({ profile, why: 'boot-failed', report: report.file });
    throw err;
  }

  running() { return !!(this.proc && !this.proc.killed); }

  /**
 * quickboot snapshot(bootmemory,  WSA/applaunch). 
   *
 * : boot 6 , appdisk I/O
 * (snapshot 1~3GB), . "",  Runtime 
 * appwindow; shutdown, . 
   */
  async saveSnapshotNow(adbPath, { timeout = 45000 } = {}) {
    if (!adbPath) return false;
    const ok = await this._saveViaAdb(adbPath, { timeout });
    // emulator save OK, , 
    // snapshot.pb (failure). 
    if (!ok) return false;
    return this.hasSnapshot();
  }

  /**
 * "snapshot". 
 * ; app, . 
   */
  scheduleSnapshotSave(adbPath, { delay = 20000, isIdle = () => true } = {}) {
    if (!adbPath) return;
    if (this._snapTimer) clearTimeout(this._snapTimer);
    const arm = (ms) => {
      this._snapTimer = setTimeout(async () => {
        this._snapTimer = null;
        if (!this.running()) return;
        if (!isIdle()) { arm(15000); return; }
        // disksnapshot(memory + 1GB ): disk, 
        // bootfailure. snapshotlaunch, . 
        const freeMB = require('./doctor').freeDiskMB(store.DATA_DIR);
        const needMB = Math.round(Number(this.profile?.memoryMB || 3072) * 1.15) + 1024;
        if (freeMB && freeMB < needMB) {
          this.log(`Skipping snapshot save: free disk ${(freeMB / 1024).toFixed(1)}GB < required ${(needMB / 1024).toFixed(1)}GB`);
          return;
        }
        await this.saveSnapshotNow(adbPath).catch(() => false);
        this._snapSaved = true;
      }, ms);
      if (this._snapTimer.unref) this._snapTimer.unref();
    };
    arm(delay);
  }

  cancelSnapshotSave() {
    if (this._snapTimer) clearTimeout(this._snapTimer);
    this._snapTimer = null;
  }

 /** :  quickboot snapshot, shutdown,  */
  async stop({ adbPath } = {}) {
    if (!this.proc) {
      // proc , ,  true
      if (!(await this._anyEmulatorPortAlive())) return true;
    }
    this.cancelSnapshotSave();
    const serial = this.serial;
    // shutdown guest ,  adb: 
    // - → snapshot(path, ); 
    // - (adb unauthorized / bootcomplete)→ , **exitsnapshot**: 
    // `adb emu kill` emulator quickboot memory, 
    // . , "boottimeout"snapshot. 
    const healthy = adbPath ? await this._adbGuestHealthy(adbPath) : false;
    if (adbPath && this.snapshotWorthSaving !== false && healthy) {
      // 3GB memory, timeout, snapshot kill . 
      await this._saveViaAdb(adbPath, { timeout: 60000 });
    }
    if (!healthy && this.snapshotWorthSaving !== false) {
      this.log('Guest unauthorized/not ready during shutdown: invalidating snapshot; will inject debug auth on next cold boot');
    }
    if (adbPath) {
      await new Promise((resolve) => {
        execFile(adbPath, ['-s', serial, 'emu', 'kill'],
          { timeout: 10000, windowsHide: true }, () => resolve());
      });
    }
    // " → exit".  6 , 
    // snapshot,  ram.img snapshot.pb . 
    //
    // note this.proc: emulator.exe launch, spawn qemu , 
    // exit "shutdowncomplete". . 
    for (let i = 0; i < 100 && (await this._consoleAlive()); i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(300);
    }
    await this.killAttempt();
    // launch.  running() true, 
    // start() ( start() ). 
    this.proc = null;
    // exit, exitsnapshot. : 
    // emu kill + , snapshot. 
    if (!healthy && this.snapshotWorthSaving !== false) {
      try { this.invalidateSnapshot(); } catch (_) { /* ignore */ }
    }
    return true;
  }

  /**
 * "" GPU , launch. 
 * auto : , . 
   */
  _noteGpuFailure(plan) {
    try {
      const gpu = plan && plan.gpu;
      if (!gpu) return;
      // fallback, /, 
      if (/software|swiftshader|swangle/.test(gpu)) return;
      if ((this.settings.engine.gpuMode || 'auto') !== 'auto') return;
      store.saveSettings({ engine: { badGpu: `${this._emuVersion || ''}|${gpu}` } });
    } catch (_) { /* ignore */ }
  }

 /** (5554) -- "" */
  _consoleAlive() {
    const net = require('net');
    const port = this.port || 5554;
    return new Promise((resolve) => {
      const sock = net.connect({ host: '127.0.0.1', port });
      let done = false;
      const fin = (v) => { if (done) return; done = true; try { sock.destroy(); } catch (_) { /* ignore */ } resolve(v); };
      sock.setTimeout(200, () => fin(false));
      sock.once('connect', () => fin(true));
      sock.once('error', () => fin(false));
    });
  }

  /**
 * guest "snapshot": adb authorized + boot complete. 
 * cold boot" USB ?", state unauthorized -- 
 * memory + disk, guest host adbkey.pub,  unauthorized, 
 * probe shell ,  240s /. 
   */
  async _adbGuestHealthy(adbPath) {
    if (!adbPath) return false;
    try {
      const { AdbClient } = require('./adb');
      const probe = new AdbClient({ adbPath, serial: this.serial });
      const state = await probe.deviceState();
      const out = await probe.shell('getprop sys.boot_completed', { timeout: 6000 }).catch(() => '');
      return state === 'device' && String(out).trim() === '1';
    } catch (_) {
      return false; // 
    }
  }

  /**
 * adb snapshot(failure false, ). 
 * guest , cold boot 20 , "bootfailure"snapshot. 
   */
  async _saveViaAdb(adbPath, { timeout = 45000 } = {}) {
    if (!adbPath) return false;
    if (!(await this._adbGuestHealthy(adbPath))) {
      this.log('Skipping snapshot save: guest unauthorized or boot incomplete (avoiding corrupted snapshot)');
      return false;
    }
    return new Promise((resolve) => {
      execFile(adbPath, ['-s', this.serial, 'emu', 'avd', 'snapshot', 'save', SNAPSHOT_NAME],
        { timeout, windowsHide: true }, (err) => resolve(!err));
    });
  }

  recentLog(n = 40) { return this._log.slice(-n).map((x) => x.line); }

  /**
 * "launch"log. 
 * memorylog(diagnose), diagnose: 
 * 1 `emulator exit 3221225477` 2 failure. 
 * log(), . 
   */
  _attemptLines(from, max = 80) {
    const lines = this._log.slice(Math.max(0, from || 0)).map((x) => x.line);
    return lines.length ? lines.slice(-max) : this.recentLog(max);
  }

  /**
 * emulator.log n (memory). 
 * restart ApkBolt diagnose, memory this._log , 
 * UNKNOWN -- log. 
   */
  tailLogFile(n = 300) {
    try {
      const file = path.join(store.DATA_DIR, 'logs', 'emulator.log');
      const size = fs.statSync(file).size;
      const take = Math.min(size, 2 * 1024 * 1024);
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.alloc(take);
        fs.readSync(fd, buf, 0, take, size - take);
        const lines = buf.toString('utf8').split(/\r?\n/);
        // , 
        if (take < size) lines.shift();
        return lines.slice(-n);
      } finally { fs.closeSync(fd); }
    } catch (_) { return []; }
  }
}

module.exports = { EmulatorEngine, AVD_NAME, SNAPSHOT_NAME };
