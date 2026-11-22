'use strict';
/**
 * runtime: ApkBolt QEMU + Android-x86 
 *
 * : 
 * - default(builtin): adb / QEMU / system image ApkBolt , emulator
 * - Android adb, 
 * - launch, reclaim; launchresident, /app
 */
const { spawn, execFile } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { AdbClient, isUnauthorizedError } = require('./adb');
const store = require('./store');
const { Provisioner } = require('./provision');
const { EmulatorEngine } = require('./emulator');
const doctor = require('./doctor');
const container = require('./container');
const backends = require('./backends');

const LOG_DIR = path.join(store.DATA_DIR, 'logs');
const MONITOR_PORT = 5556;
const EMU_PORT = 5554;
const EMU_SERIAL = `emulator-${EMU_PORT}`;

/** TCP (emulator) */
function portAlive(port, timeout = 150) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const fin = (v) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (_) { /* ignore */ }
      resolve(v);
    };
    sock.setTimeout(timeout, () => fin(false));
    sock.once('connect', () => fin(true));
    sock.once('error', () => fin(false));
  });
}

class Runtime {
  constructor(appRoot) {
    this.appRoot = appRoot;
    this.provisioner = new Provisioner(appRoot);
    this.emulator = new EmulatorEngine(appRoot);
    this.vmProc = null;
    this.vmStarting = false;
    this.installing = false;
    this.lastActivity = Date.now();
    this._watchdog = null;
    this._freeformReady = false;
    this._client = null;
    this._bootLog = [];
    this._activeApps = new Set();  // : appwindow
    // window(force-stop )app; . 
    this._tombstoned = new Set();
    // networkcheckup. "network/", , 
    // guest shell; cache, (>5 ). 
    this._lastNetwork = null;
    this.emuSerial = EMU_SERIAL;   // , serial
    /**
 * : "Android". 
     *
 * 0.5.6 ****: builtin( emulator + system image). 
 * mumu / fydeos / attach -- , settings, configuration
 * runtime,  ApkBolt , emulator. 
     */
    this._backend = null;
    this._backendId = '';
    store.ensureDirs();
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  /**
 * (: builtin). 
   * @returns {import('./backends/base').Backend}
   */
  get backend() {
    if (!this._backend) {
      const made = backends.create({
        appRoot: this.appRoot, settings: this.settings, runtime: this, store, log: (l) => this.log(l),
      });
      this._backend = made.backend;
      this._backendId = made.id;
    }
    return this._backend;
  }

  /**
 * settings. 
   *
 * runtime, (system image provision , ""). 
 * . 
   */
  async backendAvailable() {
    return { ok: true, id: 'builtin' };
  }

 /** id,  'builtin'; log */
  get backendId() { return this.backend.id; }

 /** (runtimedirectory, ) */
  resetBackend() {
    if (this._backend && this._backend.dispose) {
      try { this._backend.dispose(); } catch (_) { /* ignore */ }
    }
    this._backend = null;
    this._backendId = '';
  }

  get settings() { return store.getSettings(); }

 /** emulator */
  get emuRunning() { return this.emulator.running(); }

  // ---------------- ----------------

  adbPath() {
    const s = this.settings;
    const p = this.provisioner.paths();
    // adb :  adb ,  offline . 
    if (fs.existsSync(p.adbExe)) return p.adbExe;
    if (s.adbPath && fs.existsSync(s.adbPath)) return s.adbPath;
    const local = path.join(this.appRoot, 'tools', 'platform-tools', 'adb.exe');
    if (fs.existsSync(local)) return local;
    return AdbClient.resolveAdb('', this.appRoot);
  }

  client(serial) {
    const useSerial = serial || this.emuSerial;
    const adbPath = this.adbPath();
    if (!this._client || this._client.serial !== useSerial || this._client.adbPath !== adbPath) {
      // / adb resident adb shell
      if (this._client && this._client.disposeInput) this._client.disposeInput();
      this._client = new AdbClient({ adbPath, serial: useSerial });
    }
    return this._client;
  }

  touch() { this.lastActivity = Date.now(); }

  log(line) {
    this._bootLog.push({ t: Date.now(), line });
    if (this._bootLog.length > 300) this._bootLog.shift();
  }

  // ---------------- ----------------

  /**
 * networksnapshot(checkup). 
 * 5 : , "". 
   */
  _networkSnapshot() {
    const n = this._lastNetwork;
    if (!n) return null;
    if (Date.now() - n.at > 5 * 60 * 1000) return null;
    return { ok: n.ok, ip: n.ip, reason: n.reason };
  }

  /**
 * networkcheckup( status ). 
 * network,  status() ,  guest shell. 
 * (), cache _lastNetwork, . 
   */
  _probeNetworkInBackground() {
    if (this._netProbing) return;
    const n = this._lastNetwork;
    if (n && Date.now() - n.at < 60000) return;  // , 
    this._netProbing = true;
    this.emulator.checkNetwork(this.adbPath())
      .then((r) => {
        this._lastNetwork = { ok: !!(r && r.ok), ip: (r && r.ip) || '', reason: (r && r.reason) || '', at: Date.now() };
      })
      .catch(() => { /* ,  */ })
      .finally(() => { this._netProbing = false; });
  }

  async status() {
    const backend = this.backend;
    const env = await this.provisioner.checkEnv();
    const s = this.settings;
    const client = this.client();
    const result = {
      mode: s.engine.mode,
      backend: backend.id,
      backendLabel: backend.label,
      installed: !!s.runtime.installed,
      env,
      engineKind: env.engine,
      emulatorOk: env.emulator.ok,
      emulatorVersion: env.emulator.version,
      sysimgOk: env.sysimg.ok,
      sysimgNote: env.sysimg.note,
      accel: env.accel,
      vmRunning: this.emulator.running() || !!(this.vmProc && !this.vmProc.killed),
      vmStarting: this.vmStarting,
      installing: this.installing,
      adbOk: env.adb.ok,
      adbVersion: env.adb.version,
      qemuOk: env.qemu.ok,
      qemuVersion: env.qemu.version,
      deviceOnline: false,
      android: '',
      sdk: 0,
      freeform: false,
      ready: false,
      needsSetup: null,
      error: '',
      serial: this.emuSerial,
      network: this._networkSnapshot(),
      autoProfile: this.emulator.profile ? doctor.describeProfile(this.emulator.profile) : '',
      diagnosis: this.emulator.lastDiagnosis || null,
      attempts: this.emulator.attempts || [],
      // "": memory, settings/diagnose
      lastFailure: (this.emulator.lastFailure ? this.emulator.lastFailure() : null),
    };

    if (!env.adb.ok) {
      result.needsSetup = 'adb';
      result.error = 'adb missing: click One-Click Setup to install';
      return result;
    }

    try {
      result.deviceOnline = await client.isOnline();
      if (result.deviceOnline) {
        const [android, sdk, ff] = await Promise.all([
          client.androidVersion().catch(() => ''),
          client.sdkInt().catch(() => 0),
          client.shell('settings get global enable_freeform_support').catch(() => '0'),
        ]);
        result.android = android;
        result.sdk = sdk;
        result.freeform = String(ff).trim() === '1' || this._freeformReady;
        this._probeNetworkInBackground();
      }
    } catch (e) {
      result.error = e.message;
    }

    if (result.deviceOnline) result.ready = true;
    else if (!env.emulator.ok) result.needsSetup = 'emulator';
    else if (!env.sysimg.ok) result.needsSetup = 'sysimg';
    // "hardware acceleration": doctor software emulation, 
    // bootfailure GPU//memoryretry. 
    else result.needsSetup = 'boot';

    result.phase = result.deviceOnline
      ? 'ready'
      : this.installing
        ? 'installing'
        : result.vmRunning
          ? 'booting'
          : 'idle';

    return result;
  }

  /**
 * adb (diagnose). 
   *
 * 0.5.6 "runtime":  connect emulator, 
 * adb , " emulator-5554". 
   */
  async probe() {
    try {
      const devices = await this.client().devices();
      return devices
        .filter((d) => d.state === 'device')
        .map((d) => ({ name: d.serial, serial: d.serial }));
    } catch (_) {
      return [];
    }
  }

  // ---------------- launch / ----------------

  buildArgs({ install = false, headless = false } = {}) {
    const s = this.settings;
    const p = this.provisioner.paths();
    const hv = this._hv || { whpx: false };
    const disk = s.runtime.diskPath || p.disk;
    const iso = s.runtime.isoPath || p.iso;
    const accel = hv.whpx ? 'whpx' : 'tcg';

    const args = [
      '-name', 'ApkBolt Runtime',
      '-machine', `q35,accel=${accel}`,
      '-cpu', hv.whpx ? 'host' : 'max',
      '-smp', String(Math.max(2, s.engine.cores || 4)),
      '-m', String(s.engine.memoryMB || 4096),
      '-rtc', 'base=localtime',
      '-netdev', 'user,id=net0,hostfwd=tcp:127.0.0.1:5555-:5555',
      '-device', 'virtio-net-pci,netdev=net0',
      '-vga', 'std',
      '-usb', '-device', 'usb-tablet',
      '-monitor', `tcp:127.0.0.1:${MONITOR_PORT},server,nowait`,
    ];

    if (headless || s.runtime.headless) args.push('-display', 'none');

    if (install) {
      args.push('-boot', 'order=d');
      args.push('-cdrom', iso);
    } else {
      args.push('-boot', 'order=c');
    }
    args.push('-drive', `file=${disk},if=virtio,format=qcow2,cache=writeback`);
    return args;
  }

  async boot({ install = false, onLog = () => {} } = {}) {
    const env = await this.provisioner.checkEnv();
    this._hv = env.hypervisor;

    // :  emulator( GPU , )
    if (env.emulator.ok && env.sysimg.ok) {
      return this.bootEmulator({ env, onLog });
    }

    return this.bootQemu({ install, env, onLog });
  }

  /**
 * emulator launch Android. 
 * QEMU+ISO , "install": system image, launchboot. 
   */
  async bootEmulator({ env, onLog = () => {} } = {}) {
    if (this.vmStarting) {
      const started = Date.now();
      while (this.vmStarting && Date.now() - started < 300000) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 500));
      }
      const c = this.client();
      if (await c.isOnline()) {
        await this.prepare(c);
        return { ok: true, client: c, reused: true };
      }
    }

    const accel = env && env.accel ? env.accel : await this.provisioner.emulatorAccel();
    if (!accel.ok) {
      onLog('No hardware acceleration detected: falling back to software mode (slower boot)');
    }

    this.vmStarting = true;
    try {
      // probe EmulatorEngine boot: exit/logparametersretry
      // adb :  get-state + getprop + pm path , 
      // snapshot 300~500ms, "app". 
      let probeStart = Date.now();
      let errStreak = 0;
      let lastHeal = 0;
      let authHealed = false;  // start() ""snapshotcold boot
      const diagUnauthorized = () => ({
        code: 'ADB_UNAUTHORIZED',
        title: 'Android debugging authorization pending (click Allow)',
        // %USERPROFILE%\.android\adbkey -- ****: 
        // , , , 
        // (Android adb_keys ). emulatorwindow
        // "", Android. 
        hint: 'The emulator is showing "Allow USB debugging?". Please click "Allow" in that window.'
          + 'Check "Always allow from this computer" to prevent future prompts.'
          + 'If the window does not respond: go to Settings → Runtime → Reset Android Data'
          + '(resets installed apps, APK files are untouched).',
      });
      const probe = async ({ serial }) => {
        if (!this.emulator.running()) return 'fatal';
        if (!this._probeClient || this._probeClient.serial !== serial) {
          this._probeClient = new AdbClient({ adbPath: this.adbPath(), serial });
        }
        const c = this._probeClient;
        try {
          const out = String(await c.shell('getprop sys.boot_completed; pm path android', { timeout: 8000 }));
          const lines = out.split(/\r?\n/).map((l) => l.trim());
          const booted = lines[0] === '1' || /^1$/.test(lines[0] || '');
          const pmReady = lines.some((l) => /^package:/.test(l));
          errStreak = 0;
          if (booted && pmReady) return 'ok';
          return booted ? 'pending' : 'booting';
        } catch (e) {
          errStreak += 1;
          // : adb shell error"boot""". 
          // shell ,  offline: restart server
          // 240s×4 parameters, "runtimecompleteboot", /. 
          // error,  devices state (get-state authorized)
          // unauthorized, snapshotcold boot + diagnose, . 
          const raw = String((e && (e.raw || e.stdout || e.message)) || '');
          let unauthorized = isUnauthorizedError(raw);
          if (!unauthorized) {
            const st = await c.deviceState().catch(() => '');
            unauthorized = st === 'unauthorized';
          }
          if (unauthorized) {
            this.emulator.lastDiagnosis = diagUnauthorized();
            if (!authHealed) {
              authHealed = true;
              onLog('adb pending authorization: resetting snapshot to reinject public key...');
              try { this.emulator.invalidateSnapshot(); } catch (_) { /* ignore */ }
              this.emulator._coldBoot = true; // cold boot,  emulator adb
              await this.emulator.resetAdbServer().catch(() => {});
              this._probeClient = null;
            }
            // start() parametersretry; cold boot dialog
            return 'fatal';
          }
          // adb : restart server self-healing
          const now = Date.now();
          if (errStreak >= 6 && now - probeStart > 25000 && now - lastHeal > 30000) {
            lastHeal = now;
            onLog('adb connection anomaly; restarting adb server...');
            await this.emulator.resetAdbServer().catch(() => {});
            this._probeClient = null;
          }
          return 'pending';
        }
      };

      const st = await this.emulator.start({
        headless: this.settings.engine.headless !== false,
        onLog,
        probe,
      });
      // start() failure" {ok:false}"(disk, retryfailure). 
      // ,  ok:true -- "", 
      // adb device not found, "". 
      if (!st || st.ok === false) {
        return {
          ok: false,
          error: (st && st.error) || 'Android runtime failed to start',
          needsSpace: !!(st && st.needsSpace),
          attempts: (st && st.attempts) || [],
          diagnosis: this.emulator.lastDiagnosis,
          exitCode: st && st.exitCode,
        };
      }
      this.lastActivity = Date.now();
      this.emuSerial = st.serial || this.emulator.serial;
      const client = this.client(this.emuSerial);
      await this.prepare(client);
      // snapshot"":  1~3GB, appdisk I/O
      this._armSnapshotSave(20000);
      return { ok: true, client, engine: 'emulator', serial: this.emuSerial, profile: st.profile, network: st.network || null };
    } catch (e) {
      // retry/diagnose UI, "launchfailure"
      return { ok: false, error: e.message, diagnosis: e.diagnosis, report: e.report, attempts: e.attempts };
    } finally {
      this.vmStarting = false;
    }
  }

  // ---------------- ( WSA resident) ----------------

 /** quickboot snapshot: appwindow, applaunch I/O */
  _armSnapshotSave(delay = 20000) {
    if (!this.emulator.running()) return;
    this.emulator.scheduleSnapshotSave(this.adbPath(), {
      delay,
      isIdle: () => this._activeApps.size === 0,
    });
  }

 /** install: appsnapshot, boot */
  scheduleSnapshotSave(delay = 12000) { this._armSnapshotSave(delay); }

  /**
 * snapshot, ****. 
   *
 * : network, launchapp. 
 * scheduleSnapshotSave appwindow, app, 
 * "network" -- bootsnapshot
 * , . , . 
   */
  forceSnapshotSave(delay = 3000) {
    if (!this.emulator.running()) return;
    this.emulator.scheduleSnapshotSave(this.adbPath(), { delay, isIdle: () => true });
  }

  /**
 * : app, Android. 
 * WSA / app -- resident,  am start. 
 * - : , error, failureapp; 
 * - : boot Promise, ; 
 * - : bootcomplete qemu . 
   */
  prewarm({ onLog = () => {} } = {}) {
    if (this._prewarmPromise) return this._prewarmPromise;
    if (this._activeApps.size > 0) return Promise.resolve({ ok: true, skipped: 'busy' });
    const t0 = Date.now();
    const p = (async () => {
      try {
        const env = await this.provisioner.checkEnv();
        if (!(env.adb.ok && env.emulator.ok && env.sysimg.ok)) return { ok: false, skipped: 'not-ready' };
        const r = await this.ensure({ onLog: (m) => onLog(`Prewarm: ${m}`) });
        if (r && r.ok) {
          // app:  idle
          if (this._activeApps.size === 0) await this.emulator.setPriority('idle').catch(() => {});
          const ms = Date.now() - t0;
          this.log(`Prewarm complete (${Math.round(ms / 1000)}s)`);
          return { ok: true, bootMs: ms };
        }
        return { ok: false, error: r && r.error };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })();
    this._prewarmPromise = p;
    const clear = () => { if (this._prewarmPromise === p) this._prewarmPromise = null; };
    p.then(clear, clear);
    return p;
  }

  async bootQemu({ install = false, env, onLog = () => {} } = {}) {
    if (!env.qemu.ok) throw new Error('QEMU not installed. Please deploy runtime first.');
    if (install && !env.iso.ok) throw new Error('System image (ISO) not ready');

    const p = this.provisioner.paths();
    const disk = this.settings.runtime.diskPath || p.disk;
    if (!install && !fs.existsSync(disk)) throw new Error('Android system not yet installed to virtual disk');

    this.vmStarting = true;
    const args = this.buildArgs({ install });
    const logFile = path.join(LOG_DIR, install ? 'qemu-install.log' : 'qemu.log');
    const out = fs.openSync(logFile, 'a');
    fs.writeSync(out, `\n\n=== ${new Date().toISOString()} ${install ? 'INSTALL' : 'BOOT'} ===\n${env.qemu.path} ${args.join(' ')}\n`);

    onLog(`Starting runtime (${env.hypervisor.whpx ? 'WHPX Hardware Acceleration' : 'Software Simulation'})...`);
    if (!env.hypervisor.whpx) onLog(env.hypervisor.note);

    const proc = spawn(env.qemu.path, args, {
      cwd: path.dirname(env.qemu.path),
      windowsHide: true,
      stdio: ['ignore', out, out],
    });
    this.vmProc = proc;
    this.installing = install;
    this.lastActivity = Date.now();

    proc.on('error', (e) => {
      this.log(`spawn error: ${e.message}`);
      onLog(`Launch failed: ${e.message}`);
      this.vmProc = null;
      this.vmStarting = false;
    });
    proc.on('exit', (code) => {
      this.log(`qemu exit ${code}`);
      onLog(`Runtime exited (code=${code})`);
      this.vmProc = null;
      this.vmStarting = false;
      this.installing = false;
    });

    await new Promise((r) => setTimeout(r, 1500));
    this.vmStarting = false;
    if (!this.vmProc) throw new Error(`QEMU failed to start. See log: ${logFile}`);

    // : ISO Linux install,  adb, " adb"
    if (install) {
      onLog('Installer started. Complete setup in VM window.');
      return { ok: true, install: true, needsManualInstall: true };
    }

    const client = this.client('127.0.0.1:5555');
    const timeout = env.hypervisor.whpx ? 180000 : 900000;
    const linked = await this.waitAdb(client, timeout, onLog);
    if (!linked) {
      return {
        ok: false,
        error: 'VM started but adb cannot connect. Enable "ADB over network" in Developer Options.',
      };
    }
    const ready = await this.waitAndroidReady(client, Math.max(60000, timeout / 2), onLog);
    if (!ready.ok) {
      return {
        ok: false,
        error: ready.stage === 'kernel'
          ? 'Android kernel boot incomplete. Check runtime log.'
          : 'Android booted but system services not ready. Complete wizard in VM window if prompted.',
      };
    }
    await this.prepare(client);
    return { ok: true, client };
  }

  /**
 * Android : adb ≠ . 
 * sys.boot_completed=1 ,  am start failure. 
   */
  async waitAndroidReady(client, timeoutMs, onLog = () => {}) {
    const start = Date.now();
    let bootCompleted = false;
    let lastNotice = 0;
    while (Date.now() - start < timeoutMs) {
      /* eslint-disable no-await-in-loop */
      const online = await client.isOnline();
      if (!online) {
        await client.connect().catch(() => false);
      } else {
        if (!bootCompleted) {
          const v = await client.shell('getprop sys.boot_completed').catch(() => '');
          if (String(v).trim() === '1') {
            bootCompleted = true;
            onLog(`Android kernel booted, waiting for system services... (${Math.round((Date.now() - start) / 1000)}s)`);
          }
        }
        if (bootCompleted) {
          const pm = await client.shell('pm path android').catch(() => '');
          if (/package:/.test(pm)) {
            onLog(`Android ready (${Math.round((Date.now() - start) / 1000)}s)`);
            return { ok: true, ms: Date.now() - start };
          }
        }
      }
      if (Date.now() - lastNotice > 15000) {
        lastNotice = Date.now();
        onLog(bootCompleted
          ? `Waiting for system services... ${Math.round((Date.now() - start) / 1000)}s`
          : `Booting Android... ${Math.round((Date.now() - start) / 1000)}s`);
      }
      /* eslint-enable no-await-in-loop */
      await new Promise((r) => setTimeout(r, 2000));
    }
    return { ok: false, stage: bootCompleted ? 'services' : 'kernel', ms: Date.now() - start };
  }

  async waitAdb(client, timeoutMs, onLog = () => {}) {
    const start = Date.now();
    let lastNotice = 0;
    const needConnect = String(client.serial || '').includes(':')
      && !/^emulator-/.test(client.serial);
    while (Date.now() - start < timeoutMs) {
      // emulator-5554 emulator ,  adb connect
      if (needConnect) {
        // eslint-disable-next-line no-await-in-loop
        await client.connect().catch(() => false);
      }
      // eslint-disable-next-line no-await-in-loop
      if (await client.isOnline()) return true;
      if (Date.now() - lastNotice > 20000) {
        lastNotice = Date.now();
        onLog(`Waiting for Android to boot... ${Math.round((Date.now() - start) / 1000)}s`);
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  async prepare(client) {
    if (!this._freeformReady) {
      try { this._freeformReady = await client.ensureFreeform(); } catch (_) { /* ignore */ }
    }
    // ( + IME)**boot**. 
    // emulator -prop (SELinux , runtime), 
    // app locale / , pinyinIME. 
    // settingsconfiguration(engine.chineseIme=false). 
    if (!this._chineseReady && this.settings.engine.chineseIme !== false) {
      try {
        const locale = this.settings.engine.locale || 'zh-CN';
        await client.ensureChineseLocale(locale);
        const path = require('path');
        const apk = path.join(this.appRoot, 'assets', 'PinyinIME.apk');
        const r = await client.ensureChineseIme(apk, {
          setDefault: this.settings.engine.chineseImeDefault !== false,
        });
        // success. failure prepare() retry --
        // adb IME. 
        if (r && r.ok) this._chineseReady = true;
        this.log(`Chinese IME: ${r.ok ? (r.installed ? 'installed & active' : 'ready') : (r.reason || 'not ready')}`);
        // -change-locale ""restart framework;  quickboot snapshot
        // . snapshot, checksnapshot, 
        // bootcold boot( -change-locale). snapshot, 
        // restart. marker . 
        await this._ensureSystemLocale(client, locale);
      } catch (e) {
        this.log(`Chinese environment initialization skipped: ${e.message}`);
      }
    }
    this.startWatchdog();
  }

  /**
 * UI (). 
   *
 * (): -change-locale **** persist.sys.locale, 
 * ro.product.locale system image en-US; 
 * `settings system system_locales`(settings"()",  UI ). 
 * "" system_locales,  getprop. 
   *
 * -change-locale ""restart framework;  quickboot snapshot
 * . snapshot, checksnapshot, bootcold boot. 
 * snapshot, restart. marker . 
   */
  async _ensureSystemLocale(client, locale) {
    const fs = require('fs');
    const path = require('path');
    const want = String(locale || 'zh-CN');
    if (want === 'off' || want === 'en-US') return;
    // (system_locales , )
    const cur = await client.shell('settings get system system_locales', { timeout: 8000 }).catch(() => '');
    const s = String(cur).trim();
    if (s === want || s.indexOf(want) === 0 || /^zh[-_]/.test(s)) return;
    const marker = path.join(store.DATA_DIR, 'locale-' + want.replace(/[^a-zA-Z0-9_-]/g, '_') + '.done');
    if (fs.existsSync(marker)) return;
    try {
      fs.writeFileSync(marker, String(Date.now()));
      this.log(`System language is still ${s || '(empty)'}; invalidating snapshot, will cold-boot to ${want} next time`);
      this.emulator.invalidateSnapshot();
      this.emulator.forceColdBootOnNextStart();
    } catch (e) {
      this.log(`System language calibration skipped: ${e.message}`);
    }
  }

 /** : emulator shutdown, QEMU monitor */
  async stop({ graceful = true } = {}) {
    // runtime, cache guest network. rotate/restart
    // , waitForNetwork 8 cache ok, appblack screen. 
    this._lastNetwork = null;
    const adbPath = this.adbPath();
    if (this.emulator.running()) {
      await this.emulator.stop({ adbPath });
      return true;
    }
    // emulator(adoptExisting) proc , 
    // return false -- ,  CPU/memory. 
    // path adb shutdown, fallback. 
    //
    // note: emulator.exe launch, spawn qemu , ""
    // . shutdown saveSnapshotNow, snapshot, 
    // cold boot(25 vs 8 ). 
    let online = false;
    try { online = await this.client().isOnline(); } catch (_) { /* ignore */ }
    if (online && this.emuSerial) {
      if (adbPath && this.emulator.snapshotWorthSaving !== false) {
        await this.emulator.saveSnapshotNow(adbPath, { timeout: 60000 }).catch(() => false);
      }
      await this.client().exec(['emu', 'kill'], { timeout: 8000 }).catch(() => {});
      for (let i = 0; i < 10; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 400));
        // eslint-disable-next-line no-await-in-loop
        const still = await this.client().isOnline().catch(() => false);
        if (!still) break;
      }
      const still = await this.client().isOnline().catch(() => false);
      if (still) {
        const m = /:(\d+)$/.exec(this.emuSerial);
        const port = m ? Number(m[1]) - 1 : this.emulator.port;
        const pid = await this.pidOnPort(port);
        if (pid) {
          await new Promise((resolve) => {
            execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
          });
        }
      }
      this._activeApps.clear();
      return true;
    }
    if (!this.vmProc) return false;
    if (graceful) {
      try { await this.monitorCmd('system_powerdown'); } catch (_) { /* ignore */ }
      for (let i = 0; i < 16; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 500));
        if (!this.vmProc) return true;
      }
      try { await this.monitorCmd('quit'); } catch (_) { /* ignore */ }
      await new Promise((r) => setTimeout(r, 800));
    }
    if (this.vmProc) {
      try { this.vmProc.kill(); } catch (_) { /* ignore */ }
      this.vmProc = null;
    }
    return true;
  }

  // ---------------- QEMU monitor ----------------

  monitorCmd(cmd, { timeout = 4000 } = {}) {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: MONITOR_PORT });
      let buf = '';
      let sent = false;
      const done = (err, data) => {
        try { sock.destroy(); } catch (_) { /* ignore */ }
        if (err) reject(err); else resolve(data);
      };
      sock.setTimeout(timeout, () => done(new Error('monitor timeout')));
      sock.on('error', (e) => {
        // QEMU quit (ECONNRESET/EPIPE), 
        if (sent && /ECONNRESET|EPIPE/i.test(e.code || String(e))) done(null, buf);
        else done(e);
      });
      sock.on('data', (c) => {
        buf += c.toString();
        if (!sent && buf.includes('(qemu)')) {
          sent = true;
          sock.write(`${cmd}\n`);
          setTimeout(() => done(null, buf), 300);
        }
      });
      sock.on('connect', () => {
        if (!cmd) setTimeout(() => done(null, buf), 250);
      });
    });
  }

  async sendKey(keys, delay = 140) {
    for (const k of keys) {
      // eslint-disable-next-line no-await-in-loop
      await this.monitorCmd(`sendkey ${k}`);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // ---------------- installdisk ----------------

  async startInstaller({ onLog = () => {} } = {}) {
    const env = await this.provisioner.checkEnv();
    if (!env.iso.ok) {
      throw new Error(env.iso.reason || 'Please download or import an Android system image (ISO)');
    }
    if (!env.disk.ok) await this.provisioner.createDisk(this.settings.runtime.diskSizeGB || 24, () => {});
    this.installing = true;
    const r = await this.boot({ install: true, onLog });
    if (!r.ok) throw new Error(r.error || 'Failed to launch installer environment');
    return r;
  }

 /** installcomplete: install → → disklaunch */
  async markInstalled() {
    if (this.installing) {
      try { await this.stop({ graceful: true }); } catch (_) { /* ignore */ }
    }
    store.saveSettings({ runtime: { installed: true } });
    this.installing = false;
    return true;
  }

  // ---------------- ensure ----------------

  /**
 * emulator. 
 * emulator(5554/5556/...), adb +1. 
 * system boot_completed, runtime, 
 * " ApkBolt app", . 
   */
  /**
 * emulator. 
 * " 5554 ": launch(5554→5556→5558...), 
 * , . 
 * qemu TCP , . 
   */
  async emulatorPorts() {
    const run = (cmd, args) => new Promise((resolve) => {
      const { execFile } = require('child_process');
      execFile(cmd, args, { timeout: 3000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
        resolve(err ? '' : String(out || ''));
      });
    });
    const ports = new Set();
    try {
      const tl = await run('tasklist', ['/FO', 'CSV', '/NH']);
      const pids = new Set();
      for (const line of tl.split('\n')) {
        const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
        if (m && /qemu|emulator/i.test(m[1])) pids.add(m[2]);
      }
      if (!pids.size) return [];
      const ns = await run('netstat', ['-ano', '-p', 'TCP']);
      for (const line of ns.split('\n')) {
        const m = /:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(line);
        if (m && pids.has(m[2])) ports.add(Number(m[1]));
      }
    } catch (_) { /* probe */ }

    if (ports.size) {
      // () adb (+1), 
      const all = [...ports].sort((a, b) => a - b);
      const consoles = all.filter((p) => ports.has(p + 1));
      return consoles.length ? consoles : all;
    }
    // fallback:  qemu , probe(, )
    const found = [];
    for (let port = 5554; port <= 5620; port += 2) {
      // eslint-disable-next-line no-await-in-loop
      if (await portAlive(port, 120)) found.push(port);
    }
    return found;
  }

  async adoptExisting({ onLog = () => {} } = {}) {
    const alive = await this.emulatorPorts();
    if (!alive.length) {
      onLog('No existing runtime detected, preparing cold boot');
      return null;
    }
    onLog(`Detected ${alive.length} existing runtime instance(s) (ports ${alive.join(', ')}), attempting takeover`);

    // adb server offline (emulatorrestart adbd ), 
    // ,  get-state offline, "". 
    await this.client().exec(['kill-server'], { withSerial: false, timeout: 8000 }).catch(() => {});

    for (const port of alive) {
      const serial = `127.0.0.1:${port + 1}`;
      const c = this.client(serial);
      let booted = '';
      for (let i = 0; i < 6 && booted !== '1'; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await c.connect().catch(() => false);
        // eslint-disable-next-line no-await-in-loop
        const state = (await c.exec(['get-state'], { timeout: 5000 }).then((r) => r.stdout).catch(() => '')).trim();
        if (state === 'device') {
          // eslint-disable-next-line no-await-in-loop
          booted = (await c.shell('getprop sys.boot_completed', { timeout: 6000 }).catch(() => '')).trim();
        }
        if (booted !== '1') await new Promise((r) => setTimeout(r, 700));
      }
      if (booted !== '1') {
        onLog(`Found previous instance (${serial}) but not ready; terminating before restarting`);
        // AVD directory: exit, "". 
        // adb , . 
        const pid = await this.pidOnPort(port);
        if (pid) {
          await new Promise((resolve) => {
            const { execFile } = require('child_process');
            execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
          });
        }
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      this.emuSerial = serial;
      this.emulator.port = port;
      store.saveSettings({ device: serial });
      onLog(`Adopted running runtime instance (${serial})`);
      // eslint-disable-next-line no-await-in-loop
      await this.prepare(c);
      return { ok: true, client: c, engine: 'emulator', reused: true };
    }
    return null;
  }

 /** TCP (emulator) */
  async pidOnPort(port) {
    return new Promise((resolve) => {
      const { execFile } = require('child_process');
      execFile('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return resolve(0);
        const line = stdout.split('\n').find((l) => new RegExp(`:${port}\\s`).test(l) && /LISTENING/i.test(l));
        const m = line && /(\d+)\s*$/.exec(line.trim());
        return resolve(m ? Number(m[1]) : 0);
      });
    });
  }

  /**
 * clean, emulator. 
 * ApkBolt emulator detached , qemu ; launch AVD , 
 * FATAL "Running multiple emulators with the same AVD". 
 * EmulatorEngine, retrypath(killAttempt). 
   */
  async killOrphanEmulators({ onLog = () => {} } = {}) {
    return this.emulator.killOrphanProcesses({ onLog });
  }

  /**
 * : ,  Promise, 
 * ""emulator(AVD + memory). 
   */
  async ensure({ onLog = () => {} } = {}) {
    if (this._ensurePromise) return this._ensurePromise;
    const p = this._ensureInner({ onLog });
    this._ensurePromise = p;
    const clear = () => { if (this._ensurePromise === p) this._ensurePromise = null; };
    p.then(clear, clear);
    return p;
  }

  async _ensureInner({ onLog = () => {} } = {}) {
    const client = this.client();
    if (await client.isOnline()) {
      /**
 * """". 
       *
 * emulatorexit, restart, adb 
 * `-s emulator-5554 get-state` `device`. 
 * returned reused, orientationlaunch --
 * `device 'emulator-5554' not found`( ensure
 * 0.2 "", applaunch). 
       *
 * :  getprop ( 0 
 * boot, , ); failure, 
 * . 
       */
      const probe = await client.shell('getprop sys.boot_completed', { timeout: 5000 })
        .then((v) => String(v == null ? '' : v).trim())
        .catch(() => null);
      if (probe !== null) {
        await this.prepare(client);
        return { ok: true, client, engine: 'builtin', reused: true };
      }
      onLog('adb reports device online but unresponsive; restarting runtime...');
    }

    // ApkBolt exitemulator(), 
    // , adb server restart-- isOnline() "runtime", 
    // . emulator, bootmemory. 
    const adopted = await this.adoptExisting({ onLog });
    if (adopted) return adopted;

    // / emulator: , 
    try {
      const devices = await client.devices();
      const running = devices.find((d) => /^emulator-\d+$/.test(d.serial) && d.state === 'device');
      if (running) {
        this.emuSerial = running.serial;
        const m = /(\d+)$/.exec(running.serial);
        if (m) this.emulator.port = Number(m[1]);
        const c2 = this.client(running.serial);
        await this.prepare(c2);
        return { ok: true, client: c2, engine: 'emulator', reused: true };
      }
    } catch (_) { /*  */ }

    // (): , 
    if (this.emulator.running()) {
      onLog('Stalled runtime detected, restarting...');
      await this.emulator.stop({ adbPath: this.adbPath() });
    }

    const s = this.settings;

    // path: runtime
    // system imagecompress, (). 
    // failureerror:  checkEnv() "system image", 
    // download, extractfailure(disk / ). 
    await this.provisioner.materializeImages(onLog).catch((e) => {
      onLog(`System image extraction failed: ${e.message}`);
      this.log(`materialize failed: ${e.message}`);
    });
    const env = await this.provisioner.checkEnv();

    // emulator path: system image, "installdisk"
    if (env.emulator.ok && env.sysimg.ok) {
      // ApkBolt emulator(detached qemu ), 
      // AVD ,  FATAL "Running multiple emulators with the same AVD". 
      // failure, , "". 
      await this.killOrphanEmulators({ onLog }).catch(() => {});
      try {
        const r = await this.boot({ onLog });
        if (r.ok) return { ok: true, client: r.client, engine: 'emulator', profile: r.profile, network: r.network || null };
        return {
          ok: false, error: r.error, env,
          diagnosis: r.diagnosis, report: r.report, attempts: r.attempts, exitCode: r.exitCode,
        };
      } catch (e) {
        return { ok: false, error: e.message, env };
      }
    }

    // QEMU path( ISO disk)
    if (!s.runtime.installed) {
      return {
        ok: false,
        needsSetup: env.emulator.ok ? 'sysimg' : 'provision',
        error: env.emulator.ok
          ? 'System image missing: click Download System Image'
          : 'Runtime components not yet fully deployed',
        env,
      };
    }

    try {
      const r = await this.boot({ onLog });
      if (r.ok) return { ok: true, client: r.client, engine: 'builtin' };
      return { ok: false, error: r.error };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ---------------- app ----------------

  /**
 * "": 
 * Android resident(quickboot snapshot + adoptExisting ), 
 * App am start + window, . 
 * : 
 * - App ,  App ; 
 * - window qemu ""; 
 * - window / ( onActive UI ). 
   */
  async beginApp(pkg, { onActive = () => {} } = {}) {
    const first = this._activeApps.size === 0;
    this._activeApps.add(pkg);
    this.touch();
    const s = this.settings;
    const mode = (s.engine && s.engine.priorityMode) || 'balanced';
    // app. balanced normal( below): 
    // below qemu , ,  --
    // "". normal desktop,  CPU/memory/GPU. 
    const level = mode === 'game' ? 'game' : 'normal';

    if (first) {
      // app: "snapshot", applaunchdisk
      this.emulator.cancelSnapshotSave();
    }
    // /app: endApp qemu idle, 
    // ,  → . setPriority , 
    // , . 
    await this.emulator.setPriority(level).catch(() => {});
    if (first) {
      try { onActive(true); } catch (_) { /* launchfailureapp */ }
    }

    // window(B ): app**** force-stop app, . 
    // reclaim"", , memory. 
    // multiWindow "", . 
    if (s.engine && s.engine.multiWindow) {
      const roles = container.sessionRoles([...this._activeApps], pkg);
      const { tombstone } = container.planTombstones({
        background: roles.background,
        keepRecent: Number(s.engine.keepBackground) >= 0 ? Number(s.engine.keepBackground) : 1,
      });
      const cmds = container.buildTombstoneCommands(tombstone);
      if (cmds.length) {
        await this.client().shell(cmds.join(' ; '), { timeout: 20000 }).catch(() => '');
        for (const p of tombstone) this._tombstoned.add(p);   // , 
        this.log(`Multi-window: foreground ${pkg}, background ${roles.background.length - tombstone.length}, tombstoned ${tombstone.length}`);
      } else {
        this.log(`Multi-window: ${roles.count} apps coexisting, no reclamation needed`);
      }
      return { ...roles, plan: { commands: cmds, stopped: tombstone } };
    }

    const installed = store.getApps().map((a) => a && a.package).filter(Boolean);
    const state = container.nextSessionState([...this._activeApps], 'open', pkg);
    const plan = container.buildSessionCommands({
      pkg,
      installed,
      deep: !!(s.engine && s.engine.deepTrim),
      // App am start , ; clean endApp
      killBackground: false,
    });
    if (plan.commands.length) {
      await this.client().shell(plan.commands.join(' ; '), { timeout: 20000 }).catch(() => '');
    }
    this.log(container.describeSession(state, plan));
    return { ...state, plan };
  }

  /**
 * appwindow: ; window, 
 * "resident"( + Android idle + qemu ). 
 * shutdown,  AVD -- . 
   */
  async endApp(pkg, { onIdle = () => {} } = {}) {
    this._activeApps.delete(pkg);
    await this.client().forceStop(pkg).catch(() => {});
    const state = container.nextSessionState([...this._activeApps], 'close', pkg);
    if (state.idle) {
      const s = this.settings;
      const cmds = container.buildIdleCommands({ deep: !!(s.engine && s.engine.deepTrim) });
      await this.client().shell(cmds.join(' ; '), { timeout: 15000 }).catch(() => '');
      // game appwindow, 
      // , . 
      const keepHigh = (s.engine && s.engine.priorityMode) === 'game';
      await this.emulator.setPriority(keepHigh ? 'normal' : 'idle').catch(() => {});
      // : memorysnapshot, bootcold boot
      this._armSnapshotSave(8000);
      try { onIdle(true); } catch (_) { /* ignore */ }
      this.log('Container parked (Android resident, 0 app processes, qemu lowest priority)');
    }
    return state;
  }

  get activeApps() { return [...this._activeApps]; }
  get containerIdle() { return this._activeApps.size === 0; }

 /** settings"" */
  async restoreSystemApps() {
    const cmds = container.buildRestoreCommands();
    await this.client().shell(cmds.join(' ; '), { timeout: 20000 }).catch(() => '');
    return true;
  }

  setGuestPriority(level) { return this.emulator.setPriority(level); }

  // ---------------- reclaim ----------------

  /**
 * orientationself-healing: "space"""orientation. 
   *
 * ( dumpsys window displays): 
 * init=1280x720 ... cur=1280x720 → (landscape + landscape)
 * init=1280x720 ... cur=720x1280 → : spacerotate 90°
 * cur init , app/orientation, 
 * orientationignoreapporientation, restart. 
   *
 * settings,  60 shell. 
   */
  async _healOrientation() {
    if (!this.emulator || !this.emulator.running()) return;
    const wantLand = !!this.settings.display.landscape;
    const panelLand = typeof this.emulator.panelLandscape === 'function'
      ? this.emulator.panelLandscape() : null;
    // orientationsettings → restart, (runLaunch.beforeStart )
    if (panelLand !== null && panelLand !== wantLand) return;
    const c = this.client();
    const out = await c.shell('dumpsys window displays', { timeout: 12000 }).catch(() => '');
    const init = /init=(\d+)x(\d+)/.exec(out);
    const cur = /cur=(\d+)x(\d+)/.exec(out);
    if (!init || !cur) return;
    const initLand = Number(init[1]) > Number(init[2]);
    const curLand = Number(cur[1]) > Number(cur[2]);
    if (initLand !== curLand) {
      // : orientation + ignoreapporientation + density
      this.log(`Orientation self-healing: init=${init[1]}x${init[2]} cur=${cur[1]}x${cur[2]} collapsed, reconverging`);
      await c.resetDisplayOverrides(wantLand).catch(() => {});
      await c.setOrientation(wantLand).catch(() => {});
      return;
    }
    // ≠ . runtime: 
    // - mSetIgnoreOrientationRequest(landscape true, apporientation)
    // - wm density 190(720 → sw606dp ≥ 600dp )
    // ,  -- "". 
    // verify, (, ). 
    const densityWanted = (this.settings.display || {}).tabletMode !== false ? 190 : null;
    let ignoreOk = true;
    if (wantLand) {
      const win = await c.shell('dumpsys window | grep -oE "mSetIgnoreOrientationRequest=(true|false)"', { timeout: 8000 }).catch(() => '');
      ignoreOk = /mSetIgnoreOrientationRequest=true/.test(String(win));
    }
    let densityOk = true;
    if (densityWanted) {
      const dens = await c.shell('wm density', { timeout: 6000 }).catch(() => '');
      // "Override density: N"
      const m = /Override density:\s*(\d+)/.exec(String(dens));
      densityOk = !!m && Number(m[1]) === densityWanted;
    }
    if (!ignoreOk || !densityOk) {
      this.log(`Display state convergence: ignore-orientation=${ignoreOk} density=${densityOk} → aligned`);
      if (!ignoreOk) await c.shell('wm set-ignore-orientation-request true', { timeout: 8000 }).catch(() => {});
      // density **app**. 
      // configuration + Activity , cache DisplayMetrics app
      // () dp, ,  --
      // "window". applaunchpath, 
      // installer.launch resetDisplayOverrides am start . 
      if (!densityOk) {
        if (this._activeApps.size === 0) {
          await c.shell(`wm density ${densityWanted}`, { timeout: 8000 }).catch(() => {});
        } else {
          this.log(`density=${densityWanted} missing but app in foreground: skipping, will set on next launch`);
        }
      }
    }
  }

  startWatchdog() {
    if (this._watchdog) return;
    this._watchdog = setInterval(async () => {
      const s = this.settings;
      // orientationself-healing: applaunch / Activity / user-rotation
      // "ignoreapporientation". , landscape 90°
      // (" 90 "). , 
      // ****, . 
      await this._healOrientation().catch(() => {});
      const limit = (s.engine.idleShutdownMinutes || 0) * 60000;
      if (!limit) return;
      // emulator proc , vmRunning false: 
      // return, reclaim.  adb . 
      if (!this.vmRunning) {
        const online = await this.client().isOnline().catch(() => false);
        if (!online) return;
      }
      if (this._activeApps.size > 0 || Date.now() - this.lastActivity < limit) return;
      try {
        const running = await this.client().runningPackages();
        const alive = running.filter((p) => !/launcher|systemui|settings|inputmethod|android\.systemui/i.test(p));
        if (alive.length === 0) await this.stop();
        else this.lastActivity = Date.now();
      } catch (_) { /* ignore */ }
    }, 60000);
    if (this._watchdog.unref) this._watchdog.unref();
  }

  get vmRunning() { return this.emulator.running() || !!(this.vmProc && !this.vmProc.killed); }

  // ---------------- diagnose / slim( UI ) ----------------

  async diagnostics() {
    const env = this.provisioner.paths();
    const checked = await this.provisioner.checkEnv();
    const profile = this.emulator.profile || doctor.autoProfile({
      settings: this.settings,
      accel: checked.accel,
      emulatorVersion: checked.emulator.version || '',
      diskMB: doctor.freeDiskMB(store.DATA_DIR),
    });
    // memory attempts ; restart. 
    // failure,  emulator.log --
    // UNKNOWN, (issue #20/#25 ). 
    const persisted = this.emulator.lastFailure ? this.emulator.lastFailure() : null;
    const liveAttempts = this.emulator.attempts || [];
    const attempts = liveAttempts.length ? liveAttempts : ((persisted && persisted.attempts) || []);
    const diagnosis = this.emulator.lastDiagnosis || (persisted && persisted.diagnosis) || null;
    const exitCode = this.emulator.lastExitCode != null ? this.emulator.lastExitCode
      : (persisted ? persisted.exitCode : null);
    let logLines = this.emulator.recentLog(300);
    if (!logLines.length && this.emulator.tailLogFile) logLines = this.emulator.tailLogFile(300);
    return doctor.writeReport({
      dataDir: store.DATA_DIR,
      profile,
      logLines,
      extra: {
        attempts,
        diagnosis,
        exitCode,
        exitMeaning: persisted && persisted.exitMeaning ? persisted.exitMeaning : '',
        lastFailure: persisted,
        runtimeDir: env.root,
        serial: this.emuSerial,
        bootLog: this.bootLog,
      },
    });
  }

  usage() { return require('./layers').summary(this.provisioner.paths().root); }

  /**
 * reclaimruntimesystem image / AVD / lock file / snapshot. 
 * "clean": runtime keepSnapshots AVD 
 * launchsnapshot(≈ GB ram.img),  AVD . 
 * includeSnapshots: runtime, snapshotreclaim. 
   */
  async cleanup({ apply = false, aggressive = false, includeSnapshots = false } = {}) {
    let stoppedVm = false;
    if (includeSnapshots && this.vmRunning) {
      await this.stop().catch(() => {});
      stoppedVm = true;
    }
    const report = require('./layers').prune(this.provisioner.paths().root, {
      apply, aggressive, keepSnapshots: !includeSnapshots && this.vmRunning,
    });
    // , hint: restartruntime
    return { ...report, apply, stoppedVm };
  }

  /**
 * Android( /data + app + launchsnapshot), 
 * AVD ",  app". 
 * 8-16GB system image, (UI ), 
 * AVD(apkbolt.avd), system image,  AVD. 
 * config.ini / hardware-qemu.ini, AVD , appcold boot. 
   * @returns {{ok:boolean, reclaimed:number, avdDir:string, error?:string}}
   */
  async resetAndroidData() {
    const fs = require('fs');
    const path = require('path');
    try {
      if (this.vmRunning) await this.stop().catch(() => {});
      const avdDir = path.join(this.provisioner.paths().avdHome, 'apkbolt.avd');
      let reclaimed = 0;
      if (fs.existsSync(avdDir)) {
        for (const e of fs.readdirSync(avdDir, { withFileTypes: true })) {
          const p = path.join(avdDir, e.name);
          // : system image( qcow2 + ), launchsnapshot, lock file/directory. 
          // : config.ini / hardware-qemu.ini / AVD.conf / cache.img / encryptionkey* / initrd /
          // modem_simulator / *.ini / *.txt / *.cache -- AVD , 
          // AVD boot. app, emulator -wipe-data /data. 
          const isUserdata = /^userdata(-qemu)?(-[0-9]+)?\.img(\.qcow2)?$/.test(e.name)
            || /^userdata\.img(\.qcow2)?\.\d+$/.test(e.name);
          const isSnapshot = /^snapshots(\.stale-\d+)?$/.test(e.name);
          const isLock = /\.lock$/.test(e.name);
          if (!e.isDirectory() && !isUserdata && !isLock) continue;
          if (e.isDirectory() && !isSnapshot && !isLock) continue;
          try {
            if (e.isDirectory()) {
              const s = require('./layers').dirSize(p);
              fs.rmSync(p, { recursive: true, force: true });
              reclaimed += s;
            } else {
              const s = fs.statSync(p).size;
              fs.rmSync(p, { force: true });
              reclaimed += s;
            }
          } catch (_) { /* ,  */ }
        }
      }
      // system image, "install app", 
      // desktop/launch app. 
      try { store.saveApps([]); } catch (_) { /* ignore */ }
      return { ok: true, reclaimed, avdDir };
    } catch (e) {
      return { ok: false, reclaimed: 0, avdDir: '', error: e.message };
    }
  }

  /**
 * "" AndroidWifi (, restart, ). 
 * emulator.repairWifi. 
   *
 * @returns {Promise<boolean>} 
   */
  async repairWifi(adbPath = '') {
    const adb = adbPath || (typeof this.adbPath === 'function' ? this.adbPath() : '');
    return this.emulator.repairWifi(adb).catch(() => false);
  }

  /**
 * . 
   *
 * : `sys.boot_completed` , Wi-Fi + DHCP 
 * 10.0.2.16. app, 
 * (), 
 * "black screen". appnetwork. 
   *
   * @returns {Promise<{ok:boolean,reason:string,ip?:string,gateway?:string}>}
   */
  async waitForNetwork({ timeoutMs = 90000, onLog = () => {}, adbPath = '' } = {}) {
    const done = (r) => {
      this._lastNetwork = { ok: !!(r && r.ok), ip: (r && r.ip) || '', reason: (r && r.reason) || '', at: Date.now() };
      return r;
    };
    // : launch / rotaterestart, launchpath
    // (restartForOrientation , installer.launch ). 
    // network, 8 ,  adb
    // ( isOnline + checkNetwork shell,  1 ). 
    // window 8 : , . 
    // note stop() _lastNetwork, restartshutdown. 
    const cached = this._lastNetwork;
    if (cached && cached.ok && Date.now() - cached.at < 8000) return cached;
    const t0 = Date.now();
    let last = null;
    let lastNotice = 0;
    let offlineSince = 0;
    let notConnectedStreak = 0;
    while (Date.now() - t0 < timeoutMs) {
      const online = await this.client().isOnline().catch(() => false);
      if (!online) {
        // restart adb ,  offline
        // (:  device-offline, "repairfailure"). 
        if (!offlineSince) offlineSince = Date.now();
        if (Date.now() - offlineSince > 45000) return done({ ok: false, reason: 'device-offline' });
      } else {
        offlineSince = 0;
        // eslint-disable-next-line no-await-in-loop
        last = await this.emulator.checkNetwork(adbPath || this.adbPath()).catch(() => null);
        if (last && last.ok) return done(last);
        // `wifi-not-connected` "Wi-Fi ", " DHCP". 
        // timeout: boot( AndroidWifi
        // ""). , 
        // ,  20 . 
        // 3 (≈9 ) 2 : boot Wi-Fi , 
        // settings, . 
        if (last && last.reason === 'wifi-not-connected') {
          notConnectedStreak += 1;
          if (notConnectedStreak >= 3) return done(last);
        } else {
          notConnectedStreak = 0;
        }
      }
      if (Date.now() - lastNotice > 10000) {
        lastNotice = Date.now();
        onLog(`Waiting for Android VM network connection... ${Math.round((Date.now() - t0) / 1000)}s`);
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 3000));
    }
    return done(last || { ok: false, reason: 'timeout' });
  }

  /**
 * repair"Androidnetwork". 
 * Wi-Fi bootcomplete, restart, 
 * ****; timeouthint"Android". 
   *
   * @returns {Promise<{ok:boolean, network?:object, boot?:boolean, error?:string}>}
   */
  /**
 * : , cold boot(""snapshot). 
 * "black screen": appnetworklaunch. 
   *
   * @returns {Promise<{ok:boolean,reason?:string,ip?:string,gateway?:string}>}
   */
  async ensureNetwork({ onLog = () => {}, firstWaitMs = 25000, secondWaitMs = 90000 } = {}) {
    let net = await this.waitForNetwork({ onLog, timeoutMs: firstWaitMs });
    if (net && net.ok) return net;
    // : "" AndroidWifi . 
    // cold boot, --restart, . 
    // ""( emulator.repairWifi ). 
    if (!this._wifiRepairTried) {
      this._wifiRepairTried = true;
      onLog('VM unable to connect to Wi-Fi; attempting reconnect...');
      try {
        const fixed = await this.emulator.repairWifi(this.adbPath());
        if (fixed) {
          net = await this.waitForNetwork({ onLog, timeoutMs: 15000 });
          if (net && net.ok) {
            onLog(`Network restored (${net.ip || ''}); saving state for next launch.`);
            try { await this.emulator.saveSnapshotNow(this.adbPath(), { timeout: 90000 }); } catch (_) { /* ignore */ }
            return net;
          }
        }
      } catch (_) { /* repairfailurepath */ }
    }
    // cold boot(), : app, 
    // "". 
    if (this._netColdBootTried) return net;
    this._netColdBootTried = true;
    onLog('Network still offline; cold-booting VM to retry...');
    try {
      await this.stop({ graceful: false }).catch(() => {});
      this.emulator.forceColdBootOnNextStart();
      const boot = await this.ensure({ onLog });
      if (!boot || !boot.ok) return { ok: false, reason: 'boot-failed' };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
    net = await this.waitForNetwork({ onLog, timeoutMs: secondWaitMs });
    if (net && net.ok) {
      // networksnapshot, 
      try { await this.emulator.saveSnapshotNow(this.adbPath(), { timeout: 90000 }); } catch (_) { /* ignore */ }
    }
    return net;
  }

  /**
 * repair"Androidnetwork". 
 * : cold boot()→ network → (app). 
   *
   * @returns {Promise<{ok:boolean, network?:object, boot?:boolean, wiped?:boolean, error?:string}>}
   */
  async repairNetwork({ onLog = () => {} } = {}) {
    try {
      // repair, , : 
      // 1) Wi-Fi(restart, )
      // 2) cold boot(snapshot, )
      // 3)
      onLog('Repairing VM network: attempting Wi-Fi reconnect (data preserved)...');
      if (!this.vmRunning) {
        const boot0 = await this.ensure({ onLog });
        if (!boot0 || !boot0.ok) {
          return { ok: false, error: (boot0 && boot0.error) || 'VM failed to boot', boot: false };
        }
      }
      this._wifiRepairTried = true;
      let fixed = false;
      try { fixed = await this.emulator.repairWifi(this.adbPath()); } catch (_) { fixed = false; }
      if (fixed) {
        const net1 = await this.waitForNetwork({ onLog, timeoutMs: 30000 });
        if (net1 && net1.ok) {
          try { await this.emulator.saveSnapshotNow(this.adbPath(), { timeout: 90000 }); } catch (_) { /* ignore */ }
          onLog(`Network restored (${net1.ip || ''}); saved snapshot.`);
          return { ok: true, network: net1, boot: true, wiped: false };
        }
      }
      // 2 : cold boot, ""snapshot
      onLog('Reconnect unsuccessful; cold-booting VM (data preserved)...');
      await this.stop({ graceful: false }).catch(() => {});
      await new Promise((r) => setTimeout(r, 2500));
      this.emulator.forceColdBootOnNextStart();
      const boot = await this.ensure({ onLog });
      if (!boot || !boot.ok) {
        return { ok: false, error: (boot && boot.error) || 'VM failed to boot', boot: false };
      }
      let network = await this.waitForNetwork({ onLog, timeoutMs: 90000 });
      if (network && network.ok) {
        try { await this.emulator.saveSnapshotNow(this.adbPath(), { timeout: 90000 }); } catch (_) { /* ignore */ }
        onLog(`Network restored (${network.ip || ''}); saved snapshot.`);
        return { ok: true, network, boot: true, wiped: false };
      }
      // 3 : , (app)
      onLog('Still offline; resetting Android data and rebooting (app list preserved)...');
      if (this.vmRunning) await this.stop({ graceful: false }).catch(() => {});
      // qemu / netsimd ,  -wipe-data AVD
      await new Promise((r) => setTimeout(r, 2500));
      this.emulator.forceWipeOnNextStart();
      const boot2 = await this.ensure({ onLog });
      if (!boot2 || !boot2.ok) {
        return { ok: false, error: (boot2 && boot2.error) || 'VM failed to boot', boot: false, wiped: true };
      }
      network = await this.waitForNetwork({ onLog, timeoutMs: 240000 });
      if (network && network.ok) {
        // "network"snapshot: , 
        // . 
        try { await this.emulator.saveSnapshotNow(this.adbPath(), { timeout: 90000 }); } catch (_) { /* ignore */ }
        onLog(`Network restored (${network.ip || ''}, gateway reachable); saved snapshot.`);
      } else {
        onLog('Offline after reset. Please check host firewall/proxy settings for loopback traffic.');
      }
      return { ok: !!(network && network.ok), network, boot: true, wiped: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  dispose() {
    if (this._watchdog) clearInterval(this._watchdog);
    if (this._client && this._client.disposeInput) this._client.disposeInput();
    // runtime; dispose clean, emulator
    if (this._backend && this._backend.dispose) {
      try { this._backend.dispose(); } catch (_) { /* ignore */ }
    }
    this.emulator.cancelSnapshotSave();
    // [] qemu: 
    // 1) quickboot snapshot,  GB ram.img , 
    // bootfailure → cold boot, ""; 
    // 2) ,  ApkBolt , app(WSA / app). 
    // uninstall(app:removeSelf clean). 
    if (this.vmProc) {
      try { this.vmProc.kill(); } catch (_) { /* ignore */ }
      this.vmProc = null;
    }
  }

  get bootLog() { return this._bootLog.slice(-60); }
}

module.exports = { Runtime, MONITOR_PORT };
