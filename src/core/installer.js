'use strict';
/**
 * install / launch / uninstall 
 * 「 APK → installruntime → → desktopshortcut」。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { parseApk } = require('./apk');
const { ZipFile } = require('./zip');
const { iconToIco, writeShortcut, removeShortcut, safeFileName, shortcutExt } = require('./shortcut');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** APK ARM （ App ） */
function isArmOnly(meta) {
  return !!(meta && meta.abis && meta.abis.length && !meta.abis.some((a) => /x86/i.test(a)));
}

/**
 * 「」Android ARM 。
 * ：system imagedisk（playImageInfo().ok）emulator。
 * version / snapshotemulator，Play system image，abilist arm —— 
 * ARM-only app INSTALL_FAILED_NO_MATCHING_ABIS。 null probe，installfailure
 * retryfallback，「probe」install。
 */
async function runningHasArm(client) {
  try {
    const out = String(await client.shell('getprop ro.product.cpu.abilist', { timeout: 6000 }).catch(() => ''));
    if (!out.trim()) return null;
    return /arm/i.test(out);
  } catch (_) {
    return null;
  }
}

/**
 * install（.apks / .xapk）：split APK ASCII temporarydirectory。
 * ZIP + ： 2GB+，memoryfailure。
 * { meta, files, cleanup }；meta AndroidManifest base APK。
 */
async function parseBundle(filePath) {
  const zip = new ZipFile(filePath);
  const dir = path.join(os.tmpdir(), 'apkstart-bundle', crypto.createHash('sha1')
    .update(filePath).digest('hex').slice(0, 12));
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ } };
  try {
    const apkNames = zip.names().filter((n) => /\.apk$/i.test(n));
    if (!apkNames.length) throw new Error('No APK splits found in this package (may not be valid .apks/.xapk)');
    fs.mkdirSync(dir, { recursive: true });
    const files = [];
    for (let i = 0; i < apkNames.length; i++) {
      const target = path.join(dir, `split-${i}.apk`);
      // split MB：extract， Buffer
      // eslint-disable-next-line no-await-in-loop
      await zip.pipeTo(apkNames[i], fs.createWriteStream(target));
      files.push(target);
    }
    let meta = null;
    for (const f of files) {
      try { meta = parseApk(f); break; } catch (_) { /* split */ }
    }
    if (!meta) throw new Error('Failed to parse base APK of split package');
    return { meta, files, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  } finally {
    zip.close();
  }
}

function accentOf(pkg) {
  let h = 0;
  for (let i = 0; i < pkg.length; i++) h = (h * 31 + pkg.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 62% 52%)`;
}

class Installer {
  constructor(runtime, ctx) {
    this.runtime = runtime;
    this.ctx = ctx; // { launcherTarget, launcherArgs, cwd, isDev, desktopDir }
  }

  shortcutTarget() {
    const { launcherTarget, launcherArgs } = this.ctx;
    return { target: launcherTarget, baseArgs: launcherArgs || '' };
  }

  iconFile(pkg) { return store.iconPath(pkg); }

  icoFile(pkg) { return path.join(store.ICON_DIR, `${pkg}.ico`); }

  shortcutPath(app) {
    const s = store.getSettings();
    const dir = s.shortcutDir && s.shortcutDir.trim() ? s.shortcutDir : this.ctx.desktopDir;
    return path.join(dir, `${safeFileName(app.label)}${shortcutExt()}`);
  }

  /**
 * desktop + 。
 * Windows 「 \ 」 .lnk，desktop；
 * desktop OneDrive ，。
   *
 * Linux（FydeOS） freedesktop .desktop：
 * desktop，app ~/.local/share/applications 。
   */
  shortcutPaths(app) {
    const out = [this.shortcutPath(app)];
    if (this.ctx.startMenuDir && store.getSettings().createStartMenuShortcut !== false) {
      // directory： Windows ，appshortcut
      // （「」desktop）
      out.push(path.join(this.ctx.startMenuDir, 'ApkStart', `${safeFileName(app.label)}${shortcutExt()}`));
    }
    return [...new Set(out)];
  }

 /** system image「 ARM app」download， */
  async ensureCompatImage(onProgress) {
    const prov = this.runtime.provisioner;
    if (prov.playImageInfo().ok) return true;
    onProgress({ stage: 'runtime', message: 'First-time ARM app install: downloading compatible image (~1.5 GB, one-time)…' });
    await prov.installPlayImage((p) => onProgress({ stage: 'runtime', message: p.message, percent: p.percent }));
    if (!prov.playImageInfo().ok) throw new Error('Failed to download compatible image. Check connection and retry.');
    return true;
  }

 /** system imagerestartruntime；restartapp APK */
  async switchToCompat(onProgress) {
    const apps = store.getApps();
    store.saveSettings({ runtime: { compatImage: true } });
    onProgress({ stage: 'runtime', message: 'Switching to compatible image and restarting runtime…' });
    try { await this.runtime.stop(); } catch (_) { /* ignore */ }
    // adb ， ensure()
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const ds = await this.runtime.client().devices().catch(() => []);
      if (!ds.some((d) => /^emulator-\d+$/.test(d.serial))) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(1000);
    }
    // ：snapshot。snapshot「」memorydisk，
    // ，ensure() snapshot —— system image，
    // NO_MATCHING_ABIS，「」。
    try { this.runtime.emulator?.invalidateSnapshot(); } catch (_) { /* ignore */ }
    const rt = await this.runtime.ensure({ onLog: (m) => onProgress({ stage: 'runtime', message: m }) });
    if (!rt.ok) {
      const err = new Error(rt.error || 'Runtime unavailable after switching to compatible image');
      err.needsSetup = rt.needsSetup || 'provision';
      throw err;
    }
    for (const app of apps) {
      if (!app.apkPath || !fs.existsSync(app.apkPath)) continue;
      try {
        if (app.bundle) {
          // eslint-disable-next-line no-await-in-loop
          const b = await parseBundle(app.apkPath);
          // eslint-disable-next-line no-await-in-loop
          await rt.client.installMultiple(b.files);
          b.cleanup();
        } else {
          // eslint-disable-next-line no-await-in-loop
          await rt.client.install(app.apkPath);
        }
        onProgress({ stage: 'runtime', message: `Restoring installed app ${app.label}…` });
      } catch (_) { /* appfailure */ }
    }
    return rt;
  }

  async install(filePath, onProgress = () => {}) {
    onProgress({ stage: 'parse', message: 'Parsing APK…' });
    let meta;
    let bundle = null;
    if (/\.(apks|xapk)$/i.test(filePath)) {
      bundle = await parseBundle(filePath);
      meta = bundle.meta;
    } else {
      meta = parseApk(filePath);
    }
    onProgress({
      stage: 'parse-done',
      message: `Identified ${meta.label} (${meta.package})`,
      meta: { label: meta.label, package: meta.package, versionName: meta.versionName },
    });

    // 50GB ：emulatorspace，
    // INSTALL_INSUFFICIENT_STORAGE（「failure」）。
    try {
      const backend = this.runtime && this.runtime.backend;
      if (backend && typeof backend.checkDiskFor === 'function') {
        let bytes = 0;
        if (bundle && bundle.files) {
          for (const f of bundle.files) {
            try { bytes += fs.statSync(f).size; } catch (_) { /* ignoretemporary */ }
          }
        } else {
          try { bytes = fs.statSync(filePath).size; } catch (_) { /* 0 fallback */ }
        }
        const verdict = backend.checkDiskFor(bytes);
        if (!verdict.ok) {
          onProgress({ stage: 'error', message: verdict.message });
          const err = new Error(verdict.message);
          err.needsSetup = 'disk';
          throw err;
        }
      }
    } catch (e) {
      if (e && e.needsSetup === 'disk') throw e;
      // capacityprobefailureinstall
    }

    try {
      onProgress({ stage: 'runtime', message: 'Preparing Android runtime…' });
      let rt = await this.runtime.ensure({ onLog: (m) => onProgress({ stage: 'runtime', message: m }) });
      if (!rt.ok) {
        const err = new Error(rt.error || 'Runtime unavailable');
        err.needsSetup = rt.needsSetup || 'provision';
        throw err;
      }

      // configuration ARM ：「runtime」，system imagedisk。
      // version/snapshot、emulator，playImageInfo().ok true，
      // ， NO_MATCHING_ABIS。，。
      if (isArmOnly(meta) && await runningHasArm(rt.client) === false) {
        onProgress({ stage: 'runtime', message: 'App contains ARM libraries only; switching to compatible image…' });
        await this.ensureCompatImage(onProgress);
        rt = await this.switchToCompat(onProgress);
      }
      return await this.finishInstall(rt, meta, filePath, bundle, onProgress);
    } finally {
      if (bundle) bundle.cleanup();
    }
  }

 /** install + + shortcut；failurerepairretry */
  async finishInstall(rt, meta, filePath, bundle, onProgress) {
    const client = rt.client;
    const existing = store.getApp(meta.package);
    // quickboot snapshotdisk，「apprestart」
    try { this.runtime.emulator?.invalidateSnapshot(); } catch (_) { /* ignore */ }
    onProgress({ stage: 'install', message: existing ? 'Updating app…' : 'Installing app…' });
    try {
      if (bundle) await client.installMultiple(bundle.files);
      else await client.install(filePath);
    } catch (e) {
      // ABI ，「runtime ARM 」 ——
      // playImageInfo()。 `!playImageInfo().ok` ，system imagedisk
      // emulator，retry、，
      // 「system imageretry」，「installfailure + retry」。
      // ：errorretry。
      if (e.code === 'NO_MATCHING_ABIS') {
        onProgress({ stage: 'runtime', message: 'App contains ARM libraries only; reinstalling on compatible image…' });
        await this.ensureCompatImage(onProgress);
        const rt2 = await this.switchToCompat(onProgress);
        onProgress({ stage: 'install', message: 'Switched to compatible image, reinstalling…' });
        try {
          if (bundle) await rt2.client.installMultiple(bundle.files);
          else await rt2.client.install(filePath);
        } catch (e2) {
          // system imagefailure：，「retry」。
          const raw2 = (e2 && e2.message) || String(e2 || '');
          const err = new Error(
            `Switched to Android 14 compatible image, but installation of ${meta.label} failed (${raw2}).`
            + 'Please check disk space and network. If it persists, export a diagnostic report in Settings.',
          );
          err.code = e2 && e2.code ? e2.code : 'NO_MATCHING_ABIS';
          err.abiRetried = true;
          throw err;
        }
      } else {
        throw e;
      }
    }
    this.runtime.touch();

    // 。APK WebP，nativeImage ， +
    // fallback， .lnk （ icoPath null）。
    // iconFallback 「、」——warning，
    // desktop， ApkStart 。
    let iconPath = null;
    let icoPath = null;
    let iconFallback = '';
    if (meta.iconPng) {
      try {
        iconPath = store.iconPath(meta.package);
        fs.writeFileSync(iconPath, meta.iconPng);
      } catch (_) { /* ignore */ }
      try {
        const ico = await iconToIco(meta.iconPng, {
          decode: this.ctx.decodeIcon,
          onFallback: (why) => { iconFallback = why; },
        });
        if (ico) {
          icoPath = this.icoFile(meta.package);
          fs.writeFileSync(icoPath, ico);
        }
      } catch (_) { /* failureinstall */ }
    }

    // APK，/
    let apkCopy = null;
    try {
      apkCopy = store.apkPath(meta.package, meta.versionCode.toString(36));
      fs.copyFileSync(filePath, apkCopy);
    } catch (_) { /* ignore */ }

    // launch：APK 「 Activity」
    // LAUNCHER ，launchappcrash。
    let launchActivity = meta.launchActivity;
    try {
      client.clearLauncherCache?.(meta.package);
      const resolved = await client.resolveLauncher(meta.package);
      if (resolved) launchActivity = resolved;
    } catch (_) { /* APK */ }

    const app = {
      package: meta.package,
      label: meta.label,
      versionName: meta.versionName,
      versionCode: meta.versionCode,
      activity: launchActivity,
      abis: meta.abis,
      minSdk: meta.minSdk,
      sizeBytes: meta.sizeBytes,
      iconPath,
      icoPath,
      apkPath: apkCopy,
      bundle: !!bundle,
      accent: existing ? existing.accent : accentOf(meta.package),
      installedAt: existing ? existing.installedAt : Date.now(),
      updatedAt: Date.now(),
      launchCount: existing ? existing.launchCount || 0 : 0,
      lastLaunchAt: existing ? existing.lastLaunchAt || 0 : 0,
      shortcutPath: existing ? existing.shortcutPath || null : null,
      bounds: existing ? existing.bounds || null : null,
      // appportrait（ APK ）：
      // emulatororientation，orientationwindow。
      // orientationOverride ，「default」。
      orientation: meta.orientation || (existing ? existing.orientation || null : null),
      pinned: existing ? !!existing.pinned : false,
      // = ，「」cache，launch
      permGranted: false,
    };

    store.upsertApp(app);

    const settings = store.getSettings();
    if (settings.createShortcutOnInstall) {
      onProgress({ stage: 'shortcut', message: 'Creating desktop shortcut…' });
      try {
        app.shortcutPath = this.createShortcut(app);
        store.upsertApp({ package: app.package, shortcutPath: app.shortcutPath });
      } catch (e) {
        onProgress({ stage: 'shortcut-warn', message: `Failed to create shortcut: ${e.message}` });
      }
    }

    // hint： ARM ，x86 runtime
    const warnings = [];
    if (meta.minSdk && meta.minSdk > 34) {
      warnings.push(`This app requires Android ${meta.minSdk}+, which is higher than the current runtime version.`);
    }
    if (iconFallback === 'placeholder') {
      warnings.push('Could not parse app icon; using fallback icon for shortcut.');
    } else if (iconFallback === 'webp-decode-failed') {
      warnings.push('Failed to decode WebP icon; using fallback icon for shortcut.');
    }
    client.batteryOptimizeOff(meta.package).catch(() => {});
    // appsnapshot，：「app」，
    // bootcold boot（20 ）。
    try { this.runtime.scheduleSnapshotSave?.(12000); } catch (_) { /* ignore */ }

    onProgress({ stage: 'done', message: `${app.label} installed successfully`, app });
    return { app, warnings, engine: rt.engine };
  }

  createShortcut(app) {
    const { target, baseArgs } = this.shortcutTarget();
    const args = `${baseArgs ? baseArgs + ' ' : ''}--launch "${app.package}"`.trim();
    const ico = app.icoPath && fs.existsSync(app.icoPath) ? app.icoPath : undefined;
    // Linux .desktop PNG/SVG path，ICO —— path，
    // writeShortcut 。（Windows ico，FydeOS png）
    const png = app.iconPath && fs.existsSync(app.iconPath) ? app.iconPath : undefined;
    const paths = this.shortcutPaths(app);

    const write = (shortcutPath) => writeShortcut({
      shortcutPath,
      target,
      args,
      iconIcoPath: ico,
      iconPngPath: png,
      description: `${app.label} — Run by ApkBolt`,
      cwd: this.ctx.cwd,
      // app AUMID: Windows taskbar grouping and desktop notifications
      appUserModelId: `AbhijeetKangane.ApkBolt.${app.package}`.slice(0, 128),
    });

    let first = null;
    let startMenuPath = null;
    const errors = [];
    paths.forEach((p, i) => {
      try {
        write(p);
        if (!first) first = p;
        if (i === 1) startMenuPath = p;
      } catch (e) {
        errors.push(`${p}: ${e.message}`);
      }
    });

    // pathfailure（customshortcutdirectory / ）：
    // desktop——desktop，app。
    if (!first) {
      const fallback = path.join(this.ctx.desktopDir, `${safeFileName(app.label)}${shortcutExt()}`);
      try {
        write(fallback);
        first = fallback;
      } catch (e) {
        errors.push(`${fallback}: ${e.message}`);
      }
    }
    if (!first) throw new Error(errors.join('; ') || 'Failed to create shortcut');
    // path，uninstall
    if (startMenuPath || first) {
      store.upsertApp({ package: app.package, startMenuPath });
    }
    return first;
  }

 /** shortcut：versiondesktop， WebP success */
  async ensureShortcuts() {
    const made = [];
    // 「install」、app，
    // launch。
    const auto = store.getSettings().createShortcutOnInstall !== false;
    for (const app of store.getApps()) {
      if (!auto && !app.shortcutPath && !app.startMenuPath) continue;
      let dirty = false;
      if ((!app.icoPath || !fs.existsSync(app.icoPath)) && app.iconPath && fs.existsSync(app.iconPath)) {
        try {
          const ico = await iconToIco(fs.readFileSync(app.iconPath), { decode: this.ctx.decodeIcon });
          if (ico) {
            const p = this.icoFile(app.package);
            fs.writeFileSync(p, ico);
            store.upsertApp({ package: app.package, icoPath: p });
            app.icoPath = p;
            dirty = true;
          }
        } catch (_) { /* failure */ }
      }
      const missing = this.shortcutPaths(app).filter((p) => !fs.existsSync(p));
      if (!missing.length && !dirty) continue;
      try {
        // ， .lnk ，shortcutapp
        const madePath = this.createShortcut(app);
        store.upsertApp({ package: app.package, shortcutPath: madePath });
        made.push(app.label);
      } catch (_) { /* failurelaunch */ }
    }
    return made;
  }

  async uninstall(pkg, { removeShortcut: rm = true } = {}) {
    const app = store.getApp(pkg);
    const rt = await this.runtime.ensure();
    if (rt.ok) await rt.client.uninstall(pkg).catch(() => {});
    if (app && rm) {
      removeShortcut(app.shortcutPath);
      removeShortcut(app.startMenuPath);
    }
    if (app) {
      try { if (app.iconPath && fs.existsSync(app.iconPath)) fs.unlinkSync(app.iconPath); } catch (_) {}
      try { if (app.icoPath && fs.existsSync(app.icoPath)) fs.unlinkSync(app.icoPath); } catch (_) {}
      try { if (app.apkPath && fs.existsSync(app.apkPath)) fs.unlinkSync(app.apkPath); } catch (_) {}
    }
    store.removeApp(pkg);
    return true;
  }

  async launch(pkg, { onLog = () => {}, beforeStart = null, onMark = () => {}, onAppUp = null } = {}) {
    const app = store.getApp(pkg);
    // let：beforeStart 「orientationapporientation」restartruntime
    // rt（ client stop ）。 const，
    // restart "Assignment to constant variable."，launch ——
    // 「landscape/portraitappfailure」。
    let rt = await this.runtime.ensure({ onLog });
    onMark('ensure done');
    if (!rt.ok) {
      const err = new Error(rt.error || 'Runtime unavailable');
      err.needsSetup = rt.needsSetup;
      throw err;
    }
    // app， wm size configurationlaunch Activity
    if (beforeStart) {
      const replaced = await beforeStart(rt).catch((e) => { onLog(`Display adaptation skipped: ${e.message}`); return null; });
      // beforeStart rt（restartruntime client ），
      // 。。
      if (replaced && replaced.client) rt = replaced;
    }
    // version /data wm size / density rotatesettings。
    // ，cleanlaunch 90° 、、
    // mouse（「rotate / / 」）。
    await rt.client.resetDisplayOverrides(!!(store.getSettings().display || {}).landscape).catch(() => {});
    // cold bootnetworkcheckup：。「appblack screen」，
    // （）。
    // repair：Wi-Fi sys.boot_completed ，，
    // —— 「black screen」。
    // appnetwork（ 90 ），black screen。
    // network：**，restart**。
    // ensureNetwork()，network「 → cold boot」，
    // adb install，「」。
    // launchpath，launch，。
    if (rt.engine === 'emulator' || rt.engine === 'builtin') {
      let net = await this.runtime.waitForNetwork({ onLog, timeoutMs: 20000 }).catch(() => null);
      if (net && net.ok) {
        onLog(`VM network ready (${net.ip || ''})`);
      } else {
        // network，****：「」
        // AndroidWifi 。restart、，settings
        // ，launchpath。
        // 「」（ emulator.repairWifi）。
        onLog('VM unable to connect to Wi-Fi, retrying connection…');
        try {
          // note：repairWifi engine（this.runtime）， rt 。
          // rt ensure() { ok, client, engine, ... }， client；
          // rt.repairWifi undefined， TypeError catch ，
          // 「log， 1 」。
          const fixed = await this.runtime.repairWifi().catch(() => false);
          if (fixed) {
            net = await this.runtime.waitForNetwork({ onLog, timeoutMs: 15000 }).catch(() => null);
            if (net && net.ok) {
              onLog(`VM network restored (${net.ip || ''})`);
              // ：「network」snapshot。
              // boot「」snapshot，。
              // forceSnapshotSave launchapp，「」。
              try { this.runtime.forceSnapshotSave?.(3000); } catch (_) { /* launch */ }
            }
          }
        } catch (e) {
          // ：log「」。
          onLog(`Auto-reconnect Wi-Fi failed: ${e.message}`);
        }
        if (!net || !net.ok) {
          onLog('VM network not fully ready, launching app anyway…');
        }
      }
    }
    const settings = store.getSettings();
    const start = () => rt.client.startApp(app ? app.package : pkg, app ? app.activity : null, {
      freeform: settings.freeform,
      bounds: app ? app.bounds : null,
    });
    // appruntime（system image / / ），
    // "Invalid packageName"。cachelaunch，「app」，
    // ——「installapp」。
    // ： isInstalled()（pm path + APK ）
    // `pm list packages`。snapshotdata partition PackageManager installed=true，
    // /data/app —— am start failure。verify。
    if (app && app.apkPath && fs.existsSync(app.apkPath)) {
      let installed = false;
      try { installed = await rt.client.isInstalled(pkg); } catch (_) { /* install， */ }
      if (!installed) {
        onLog('App files missing, reinstalling from local backup…');
        // snapshot：snapshot packages.xml 「」，
        try { this.runtime.emulator?.invalidateSnapshot(); } catch (_) { /* ignore */ }
        await rt.client.install(app.apkPath).catch((e) => onLog(`Auto-reinstall failed: ${e.message}`));
      }
    }
    // 25 「 5 」launchsuccess。
    // ："Not yet ready""Process exited unexpectedly"。 pidof failure，
    // app（） force-stop restart，
    // ，"Takes up to 1 minute to launch"。
    const staysAlive = async () => {
      const t0 = Date.now();
      let aliveSince = 0;
      let seen = false;
      while (Date.now() - t0 < 25000) {
        // ：residentlaunch 1 ，
        // sleep 1 path。
        // eslint-disable-next-line no-await-in-loop
        const pid = await rt.client.shell(`pidof ${pkg}`, { timeout: 6000 }).catch(() => '');
        if (!String(pid).trim()) {
          if (seen) return false; // =
        } else {
          if (!seen && typeof onAppUp === 'function') {
            // （ 4 ）。
            // 4 「」，「」；
            // app， 4 。
            // fire-and-forget：failure。
            try { onAppUp(); } catch (_) { /* ignore */ }
          }
          seen = true;
          if (!aliveSince) aliveSince = Date.now();
          if (Date.now() - aliveSince >= 4000) return true;
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(700);
      }
      return seen; // failure
    };
    try {
      // runtime：install -g ，
      // app，「/」。
      await rt.client.grantRuntimePermissions(pkg).catch(() => {});
      onMark('permissions granted');
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt += 1) {
        if (attempt > 1) {
          // eslint-disable-next-line no-await-in-loop
          await rt.client.forceStop(pkg).catch(() => {});
          // ，app「」；
          // eslint-disable-next-line no-await-in-loop
          await rt.client.grantRuntimePermissions(pkg).catch(() => {});
          // eslint-disable-next-line no-await-in-loop
          await rt.client.dismissPermissionDialog().catch(() => {});
          // eslint-disable-next-line no-await-in-loop
          await sleep(600 * attempt);
        }
        let started = true;
        try {
          // eslint-disable-next-line no-await-in-loop
          await start();
        } catch (e) {
          // log（system image）；launch，retry
          if (e.code === 'APP_CRASHED' && e.crash) throw e;
          started = false;
        }
        onMark(`am start #${attempt} ${started ? 'ok' : 'fail'}`);
        // Activity orientation。applaunch
        // configuration（Activity ），launch user-rotation 0 ——
        // 0，landscape 90°（「」）。
        if (started) {
          // eslint-disable-next-line no-await-in-loop
          await rt.client.setOrientation(!!(store.getSettings().display || {}).landscape).catch(() => {});
        }
        // eslint-disable-next-line no-await-in-loop
        ok = started ? await staysAlive() : false;
        onMark(`alive #${attempt} ${ok}`);
        if (!ok && attempt < 3) onLog(`App exited after launch (attempt ${attempt}), retrying…`);
      }
      if (!ok) {
        // fallback：exit「」，。
        // app，success（settingscache）。
        onLog('App repeatedly exited; resetting app data and retrying…');
        await rt.client.shell(`pm clear ${pkg}`, { timeout: 20000 }).catch(() => '');
        await sleep(800);
        // pm clear runtime，，
        await rt.client.grantRuntimePermissions(pkg).catch(() => {});
        await start().catch((e) => {
          if (e.code === 'APP_CRASHED' && e.crash) throw e;
        });
        ok = await staysAlive();
        if (!ok) await rt.client.dismissPermissionDialog().catch(() => {});
      }
      if (!ok) {
        const err = new Error('App exited immediately on launch; retried and reset data but launch failed');
        err.code = 'APP_UNSTABLE';
        throw err;
      }
    } catch (e) {
      if (e.code === 'APP_CRASHED' && !this.runtime.provisioner.playImageInfo().ok) {
        // ARM ：system image、 APK、launch
        onLog('ARM translation crash detected; automatically switching to compatible image…');
        await this.ensureCompatImage(onLog ? (m) => onLog(m.message || '') : () => {});
        const rt2 = await this.switchToCompat((m) => onLog(m.message || ''));
        if (app && app.apkPath && fs.existsSync(app.apkPath)) {
          try { await rt2.client.install(app.apkPath); } catch (_) { /*  */ }
        }
        await rt2.client.startApp(app ? app.package : pkg, app ? app.activity : null, {
          freeform: settings.freeform,
          bounds: app ? app.bounds : null,
        });
      } else {
        throw e;
      }
    }
    this.runtime.touch();
    if (app) {
      store.upsertApp({
        package: app.package,
        launchCount: (app.launchCount || 0) + 1,
        lastLaunchAt: Date.now(),
      });
    }
    return { ok: true, engine: rt.engine };
  }
  /**
   * Export / Backup installed APK to host directory
   * @param {string} pkg - Package name
   * @param {string} destDir - Destination folder on host
   * @returns {Promise<{ok: boolean, path: string, size: number}>}
   */
  async exportApk(pkg, destDir) {
    if (!pkg) throw new Error('Package name is required for export');
    const outDir = destDir || path.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const app = store.getApp(pkg);
    const destPath = path.join(outDir, `${pkg}.apk`);

    // 1. If stored locally in APK_DIR or app.apkPath, copy directly
    const localCandidates = [
      app && app.apkPath,
      path.join(store.APK_DIR, `${pkg}.apk`),
    ].filter(Boolean);

    for (const src of localCandidates) {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, destPath);
        const st = fs.statSync(destPath);
        return { ok: true, path: destPath, size: st.size };
      }
    }

    // 2. Otherwise pull from guest device via ADB
    const rt = await this.runtime.ensureReady();
    const pmOut = await rt.client.shell(['pm', 'path', pkg]);
    const m = String(pmOut || '').match(/^package:(.+)$/m);
    if (!m) {
      throw new Error('Package ' + pkg + ' not found on Android device');
    }
    const remotePath = m[1].trim();
    await rt.client.pull(remotePath, destPath);
    const st = fs.statSync(destPath);
    return { ok: true, path: destPath, size: st.size };
  }
}

module.exports = { Installer, accentOf, parseBundle };
