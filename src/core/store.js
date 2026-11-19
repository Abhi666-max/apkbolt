'use strict';
/**
 * ：app + settings
 * directory：%APPDATA%\apkstart（MSIX/store version STORE_BUILD ）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { safeFilePart } = require('./pkgname');

/**
 * Microsoft Store（MSIX / APPX）？
 *
 * MSIX full-trust app `%APPDATA%` / `%LOCALAPPDATA%` ****
 * `%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalCache\...`，
 * API 「path」。：
 * 1. %APPDATA%\apkstart spawn emulator/adb/qemu ，
 * path「」；
 * 2. 「directory」directory。
 * store versiondirectory AppData ****（%USERPROFILE%\ApkStart），
 * ，。
 *
 * process.windowsStore Electron MSIX/APPX （ node undefined）。
 */
const STORE_BUILD = (() => {
  try { return !!require('electron').app?.isPackaged && !!process.windowsStore; } catch (_) { return false; }
})();

const ROAMING = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const LEGACY_DIR = path.join(ROAMING, 'apkstart');
const BOLT_DIR = path.join(ROAMING, 'apkbolt');

const DATA_DIR = STORE_BUILD
  ? path.join(os.homedir(), 'ApkBolt', 'data')
  : BOLT_DIR;
const ICON_DIR = path.join(DATA_DIR, 'icons');
const APK_DIR = path.join(DATA_DIR, 'apks');
const APPS_FILE = path.join(DATA_DIR, 'apps.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  adbPath: '',
  device: '127.0.0.1:5555',
  /**
 * driver（patch）： JSON patchdirectory drivers/ 。
 * 「 id」——default，，。
   */
  drivers: { state: {}, disabled: [] },
  engine: {
    // runtime：runtime（builtin）。 settings.json ，
    // settings 'builtin'（ getSettings ）。
    mode: 'builtin',
    qemuPath: '',
    systemImage: '',
    memoryMB: 0,             // 0 = doctor memory
    cores: 0,                // 0 =
    autoMemory: true,        // configuration：memory//disk/parameters
    idleShutdownMinutes: 15,
    startVisible: true,
    // window： SurfaceFlinger VSYNC，app。
    // windowemulator 60fps + mouse，ApkStart appwindow。
    headless: false,
    gpuMode: 'auto',         // auto = emulator versionfallback
    // 「」（ `<emulatorversion>|<gpu>`）；auto ，
    // boot 20 。upgraderuntime。
    badGpu: '',
    forceTcg: false,         // ；path doctor
    audio: true,             // Androidapp（hint/）。 CPU
    // ---- （default，）----
    liteMode: true,          // vCPU ， qemu Windows
    // ：save（）/ balanced（）/ smooth（，·）。
    // ， liteMode / priorityMode / renderSize，
    // 。
    resourceMode: 'balanced',
    // data partitioncapacity（GB）：app、cacheupdate。
    // 0 = （disk 6/8GB）。Android****，app。
    dataPartitionGB: 0,
    // ：、；auto = 720x1280 / 540x960
    renderSize: 'auto',
    // network：emulator DNS。Androiddefault 10.0.2.3 DNS，
    // VPN / / ，app。
    fastDns: true,
    // ：boot emulator -prop （guest setprop SELinux ）。
    // default。 zh-CN 。
    locale: 'en-US',
    chineseIme: false,
    chineseImeDefault: false,
    // snapshot：quickboot memorysnapshotlaunch，disk 2~3GB
    // ram.bin。disk（launch，app）。
    keepSnapshot: true,
    // log（KB）：，disk
    logLimitKB: 2048,
    // mousekeymap：emulator「/」，。
    // wheelhook，appwindow，uninstall。
    mouseRightBack: true,    // = Android（ Qt default「」）
    mouseWheelMode: 'smooth', // smooth = | native = Qt | off =
    mouseSideButtons: false, // side buttons/：default，
    deepTrim: false,         // （Play /），default
    // balanced= | performance=qemu Normal | game=qemu High +
  priorityMode: 'balanced',
    // ：launch ApkStart Android，app。
    // resident 1GB memory（ WSA / app），。
    prewarm: true,
    // window（B ）：app、window。default，
    // 「」window；reclaim，。
    multiWindow: false,
    // windowapp（、）。
    // 0 = memory（），default 1。
    keepBackground: 1,
    // key（→）：default，settings
    keymapEnabled: true,
    // appkey：{ "com.example.game": [{key:'w',action:'tap',x:0.15,y:0.75}, ...] }
    keymaps: {},
  },
  runtime: {
    dir: '',                 // = %APPDATA%\apkstart\runtime
    qemuUrl: '',             // QEMU install
    isoUrl: '',              // system image
    isoPath: '',             // system image（ISO）path
    diskPath: '',            // installdisk
    diskSizeGB: 24,
    headless: false,         // window（）
    installMode: 'guided',   // guided（install） | auto（install）
    emulatorUrl: '',         // emulator （ = SDK ）
    sysimgUrl: '',           // system image
    compatImage: false,      // ARM ： Google Play system image（ native bridge， ARM-only app）
    deployFailedAt: 0,       // failure（0=failure）。failure 30
    // runtime：default GitHub Release download（「update」），
    // dl.google.com download。system image。
    preferGithubRuntime: true,
    runtimePackUrl: '',
    // GitHub system image（）。 GitHub Releases KB/s，
    // https://ghfast.top/ system image downloads 。
    // = （ 8 chunk，）。
    mirrorPrefix: '',
    // download：chunkdownload。default 8，/ 16。
    downloadConnections: 8,
    // update/download。auto = GitHub Gitee、download
    // 128KB ，；（network）。
    sourcePreference: 'auto',
    // GitHub system image（ghfast / gh-proxy）。 + custom。
    // ， release ，。
    autoMirror: true,
    // Gitee releases access_token（ token 404），
    // Gitee update token； GitHub + system image。
    giteeToken: '',
  },
  sharedDir: path.join(os.homedir(), 'ApkStartShared'),
  deviceSharedDir: '/sdcard/ApkStartShared',
  autoConnect: true,
  createShortcutOnInstall: true,
  createStartMenuShortcut: true, // shortcut = Windows app
  shortcutDir: '',           // = desktop
  freeform: false,           // runtimewindow， Android freeform
  hideAfterLaunch: false,    // resident，exit Android runtime
  notifyOnInstall: true,
  autoStart: true,           // boot，default，settings
  autoDeploy: true,          // complete， 1~5
  // launch：lastDate （），
  // disabled = 「」。
  welcome: { lastDate: '', disabled: false },
  /**
 * check（ debug）：，。
 * auto = ；intervalMin = （）；
 * notify = 「」（）。
   */
  debug: { auto: true, intervalMin: 10, notify: true },
  display: {
    mode: 'window',          // window（portraitwindow，） | fullscreen（）
    portrait: '900x1600',    // windowportrait，settings
    density: 0,              // 0 =
    rememberBounds: true,    // appwindow/
    autoFullscreenOnLaunch: false,
    // landscape = AVD 1280x720 restart（+）。
    // ，restart ApkStart orientationboot。
    landscape: false,
    // orientation：
    // auto = apporientation（recommended，window）
    // landscape = landscape
    // portrait = portrait
    // landscape auto 「orientation」，
    // restartForOrientation ，apporientation。
    orientationMode: 'auto',
    // ： guest 190dpi（720 → sw606dp ≥ 600dp，
    // Android ）。app，
    // 「」。system imagedefault（）。
    tabletMode: true,
    // window：false=emulatorwindow（Qt ，orientation//
    // ，）；
    // true=Android SetParent ApkStart window（，
    // rotate///）。
    // 0.6.0 defaultwindow：embedded modewindow，
    // 、rotate、app，// ——
    // ，window。
    // settings（display.windowEmbed）。
    windowEmbed: false,
    // In-guest「rotate」：default（ guest accelerometer_rotation=1），
    // orientation wm user-rotation lock + set-ignore-orientation-request ，
    // 。。
    autoRotate: true,
  },
};

function ensureDirs() {
  const isFirstRun = !fs.existsSync(DATA_DIR);
  for (const d of [DATA_DIR, ICON_DIR, APK_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  if (isFirstRun && fs.existsSync(LEGACY_DIR)) {
    try {
      const legacyApps = path.join(LEGACY_DIR, 'apps.json');
      const legacySettings = path.join(LEGACY_DIR, 'settings.json');
      if (fs.existsSync(legacyApps) && !fs.existsSync(APPS_FILE)) {
        fs.copyFileSync(legacyApps, APPS_FILE);
      }
      if (fs.existsSync(legacySettings) && !fs.existsSync(SETTINGS_FILE)) {
        fs.copyFileSync(legacySettings, SETTINGS_FILE);
      }
      const legacyIcons = path.join(LEGACY_DIR, 'icons');
      if (fs.existsSync(legacyIcons)) {
        for (const f of fs.readdirSync(legacyIcons)) {
          const src = path.join(legacyIcons, f);
          const dst = path.join(ICON_DIR, f);
          if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
        }
      }
    } catch (_) {}
  }
}

function readJson(file, fallback) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    // UTF-8 BOM。 BOM JSON.parse ，configuration
    // default —— 「settings」，。
    // settings、、， BOM。
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDirs();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * → 。
 * save ：2 vCPU + + 540x960， / ；
 * balanced ：vCPU （2~4）+ + 720x1280；
 * smooth ： vCPU + + 720x1280，。
 * 1080p：quickboot snapshot，cold boot， 720p
 * window，。
 */
function resourcePreset(mode) {
  switch (String(mode || '')) {
    case 'save':
      return { resourceMode: 'save', liteMode: true, priorityMode: 'balanced', renderSize: '540x960' };
    case 'smooth':
      return { resourceMode: 'smooth', liteMode: false, priorityMode: 'game', renderSize: '720x1280' };
    case 'balanced':
    default:
      return { resourceMode: 'balanced', liteMode: true, priorityMode: 'balanced', renderSize: 'auto' };
  }
}

const store = {
  DATA_DIR, ICON_DIR, APK_DIR,
  // （MSIX）：main.js update、driverinstall
  STORE_BUILD,

  getSettings() {
    const s = deepMerge(DEFAULT_SETTINGS, readJson(SETTINGS_FILE, {}));
    /**
 * 0.5.6 ：configuration mode=mumu / fydeos / attach，
 * ， builtin ，。
     *
 * memory，disk：settings，
 * settings；「 ApkStart settings.json」。
     */
    s.engine.mode = 'builtin';
    for (const k of ['mumuPath', 'mumuIndex', 'mumuRenderProfile', 'mumuMemoryGB', 'mumuCores', 'fydeosHost']) {
      delete s.engine[k];
    }
    // versiondefault：appwindow，「」。
    // window，configuration。
    s.engine.headless = false;
    // versionexit Android runtime，desktop。
    s.hideAfterLaunch = false;
    // version Android freeform ，emulatorwindowappwindow，
    // app，「window」。
    s.freeform = false;

    /**
 * Final decision on window hosting mode：**defaultemulatorwindow**。
     *
 * 0.5.9 embedded mode，（SetParent + 
 * SetWindowPos window）/rotate/app，、
 * 、，。windowemulator
 * ，，default。
     *
 * 「」：**settings**
 * （windowEmbedChosen settings），，disk。
 * windowEmbedMigrated2 true ，configuration
 * windowEmbed:true —— upgradelaunchwindow，
 * 「defaultsettings」。「」，。
     */
    try {
      const raw = readJson(SETTINGS_FILE, {});
      const d = (raw && raw.display) || {};
      // Final verdict on window hosting mode
      if (d.windowEmbedChosen !== true && d.windowEmbed !== false) {
        s.display.windowEmbed = false;
        s.display.windowEmbedMigrated2 = true;
        // ，configuration；。
        writeJson(SETTINGS_FILE, {
          ...raw,
          display: { ...d, windowEmbed: false, windowEmbedMigrated2: true },
        });
      }
    } catch (_) { /* failurelaunch， */ }

    return s;
  },

  saveSettings(patch) {
    const next = deepMerge(this.getSettings(), patch);
    // 「」，，configuration
    if (patch && patch.engine && patch.engine.resourceMode) {
      Object.assign(next.engine, resourcePreset(next.engine.resourceMode));
    }
    writeJson(SETTINGS_FILE, next);
    return next;
  },

  getApps() {
    const data = readJson(APPS_FILE, { apps: [] });
    return Array.isArray(data.apps) ? data.apps : [];
  },

  saveApps(apps) {
    writeJson(APPS_FILE, { apps });
  },

  upsertApp(app) {
    const apps = this.getApps();
    const i = apps.findIndex((a) => a.package === app.package);
    if (i >= 0) apps[i] = { ...apps[i], ...app };
    else apps.push(app);
    this.saveApps(apps);
    return app;
  },

  removeApp(pkg) {
    const apps = this.getApps().filter((a) => a.package !== pkg);
    this.saveApps(apps);
  },

  getApp(pkg) {
    return this.getApps().find((a) => a.package === pkg) || null;
  },

  iconPath(pkg) {
    // ：pkg APK / apps.json，directory。
    // version， ICON_DIR path（issue #2 P0-1）。
    return path.join(ICON_DIR, `${safeFilePart(pkg)}.png`);
  },

  apkPath(pkg, version = 'cur') {
    const v = /^[A-Za-z0-9_-]+$/.test(String(version)) ? version : 'cur';
    return path.join(APK_DIR, `${safeFilePart(pkg)}-${v}.apk`);
  },

  ensureDirs,
  DEFAULT_SETTINGS,
};

module.exports = store;
