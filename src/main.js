'use strict';
/**
 * ApkBolt 
 * : window / / single instance / ( apk, desktopshortcutlaunch)/ IPC
 */
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, shell, nativeImage, screen, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');

const store = require('./core/store');
const { Runtime } = require('./core/engine');
const { Installer } = require('./core/installer');
const { Sharer } = require('./core/sharer');
const { parseApk } = require('./core/apk');
const { drawAppIcon } = require('./core/png');
const orientation = require('./core/orientation');

// Logo(build/render-logo.js ); 
const LOGO_DIR = path.join(__dirname, 'ui', 'assets');
const LOGO_FILE = path.join(LOGO_DIR, 'logo.png');
const APPICON_FILE = path.join(LOGO_DIR, 'appicon.ico');
function loadBrandIcon(size) {
  try {
    if (fs.existsSync(LOGO_FILE)) {
      const img = nativeImage.createFromPath(LOGO_FILE);
      return size ? img.resize({ width: size, height: size, quality: 'best' }) : img;
    }
  } catch (_) { /*  */ }
  return nativeImage.createFromBuffer(drawAppIcon(size || 256));
}

// "":  512 16px , 
function loadTrayIcon() {
  try {
    const p = path.join(LOGO_DIR, 'tray-16.png');
    if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  } catch (_) { /*  */ }
  return nativeImage.createFromBuffer(drawAppIcon(16));
}
const assoc = require('./core/assoc');
const windowctl = require('./core/windowctl');
const display = require('./core/display');
const { WinAgent } = require('./core/agent');
const pointer = require('./core/pointer');
const { KeymapEngine } = require('./core/keymap-engine');
const { PRESETS: KEYMAP_PRESETS } = require('./core/keymap');
const { AppWindow, TITLEBAR_H } = require('./core/appwin');
const { NotifyBridge } = require('./core/notify');
const { AndroidSettings } = require('./core/android');
const { Updater, findUninstaller } = require('./core/updater');
const leftovers = require('./core/leftovers');
const manual = require('./core/manual');

// Windows window capturePage , 
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

/**
 * ,  Chromium cache(Cache / GPUCache / Local Storage ...)
 * "Androiddirectory". 
 * defaultcache %APPDATA%\apkbolt -- C MB , launchfailure, 
 * Android, cache C . 
 * app ready settings, . 
 */
function relocateUserDataIfCrowded() {
  try {
    const doctor = require('./core/doctor');
    const freeMB = doctor.freeDiskMB(store.DATA_DIR);
    const avd = String(store.getSettings().runtime.avdDir || '').trim();
    if (!avd) return;
    const avdFree = doctor.freeDiskMB(avd);
    if (freeMB >= 2048 || avdFree <= freeMB * 2) return;
    const target = path.join(avd, 'appdata');
    fs.mkdirSync(target, { recursive: true });
    app.setPath('userData', target);
  } catch (_) { /* default, launch */ }
}
relocateUserDataIfCrowded();

// appwindowemulator SetParent window. Chromium default
// DirectComposition (Intermediate D3D Window /
// WS_EX_NOREDIRECTIONBITMAP),  DWM window, 
// window--"Screen is black but Android is running". 
// 38px launch, , 
// hardware acceleration Chromium HWND, window. 
// APKBOLT_HWACCEL=1 launch. 
if (process.env.APKBOLT_HWACCEL !== '1') app.disableHardwareAcceleration();

const APP_ROOT = path.join(__dirname, '..');
const IS_DEV = process.argv.includes('--dev');

/**
 * log: ,  app.log . 
 * , path. 
 */
function appLog(line) {
  try {
    const dir = path.join(store.DATA_DIR, 'logs');
    const limit = store.getSettings().engine.logLimitKB || 2048;
    require('./core/logfile').append(path.join(dir, 'app.log'), `${new Date().toISOString()} ${line}`, limit);
  } catch (_) { /* logfailure */ }
}
process.on('uncaughtException', (e) => appLog(`UNCAUGHT ${e && (e.stack || e.message)}`));
process.on('unhandledRejection', (e) => appLog(`REJECT ${e && (e.stack || e.message || e)}`));
// exitexit: exit(,  before-quit), 
// "exit""""shutdown". 
process.on('exit', (code) => appLog(`process exit code=${code}`));

/**
 * (runtime): 
 * ApkBolt.exe runtime/(emulator + platform-tools + AEHD + ARM system image). 
 * launch(settings.json ) runtime.dir , 
 * downloadsettings, . settings. 
 */
/**
 * installruntimedirectory( exe runtime/,  MSIX 
 * app\resources\runtime).  = emulatorsystem image: boot
 * "download", autoDeploy . 
 *
 * bootstrapBundledRuntime() : , 
 * `let` TDZ(,  catch , ). 
 */
let bundledRuntimeDir = null;

function bootstrapBundledRuntime() {
  try {
    const exeDir = path.dirname(process.execPath);
    // portable versionruntime exe ; electron-builder portable
    // resources/ ,  exe resources , . 
    const candidates = [
      path.join(exeDir, 'runtime'),
      path.join(path.dirname(exeDir), 'runtime'),
      path.join(process.resourcesPath || '', 'runtime'),
      path.join(process.resourcesPath || '', 'app', 'runtime'),
    ];
    // runtime" emulator + System Image",  API version: 
    // AOSP system image,  API34 runtime. 
    const hasImage = (dir) => {
      const root = path.join(dir, 'system-images');
      let apis = [];
      try { apis = fs.readdirSync(root); } catch (_) { return false; }
      for (const api of apis) {
        let tags = [];
        try { tags = fs.readdirSync(path.join(root, api)); } catch (_) { continue; }
        for (const tag of tags) {
          let abis = [];
          try { abis = fs.readdirSync(path.join(root, api, tag)); } catch (_) { continue; }
          for (const abi of abis) {
            const d = path.join(root, api, tag, abi);
            // system imagecompress(system.img.xz / .gz), extractlaunch. 
            // system.img "system image", download. 
            const hasSys = ['system.img', 'system.img.xz', 'system.img.gz']
              .some((f) => fs.existsSync(path.join(d, f)));
            if (hasSys && fs.existsSync(path.join(d, 'kernel-ranchu'))) return true;
          }
        }
      }
      return false;
    };
    const bundled = candidates.find((dir) =>
      fs.existsSync(path.join(dir, 'emulator', 'emulator.exe')) && hasImage(dir));
    if (!bundled) return;

    const s = store.getSettings();
    // settings.json : extract, 
    // "". runtimedirectory emulator . 
    const explicit = String(s.runtime.dir || '').trim();
    const current = explicit || path.join(store.DATA_DIR, 'runtime');
    // "installruntime": path <directory>/resources/runtime,  EXE directory. 
    // "extract, settings.json path"--
    // : launch, version emulator/system image/snapshot, 
    // upgradestutter, orientationparameters, . 
    // directory(D:\ApkBoltRuntime ). 
    const looksForeignBundle = /[\\/]resources[\\/]runtime$/i.test(current)
      && !path.resolve(current).toLowerCase().startsWith(path.resolve(exeDir).toLowerCase());
    if (looksForeignBundle && fs.existsSync(path.join(bundled, 'emulator', 'emulator.exe'))) {
      store.saveSettings({ runtime: { dir: bundled } });
      bundledRuntimeDir = bundled;
      appLog(`Runtime directory points to another package (${current}), using bundled runtime ${bundled}`);
      return;
    }
    const currentExe = path.join(current, 'emulator', 'emulator.exe');
    // portable version/upgrade(extractdirectory), settings path: 
    // " EXE directory runtime", 
    // (:  emulator emulator-check → probefailure → TCG software emulation). 
    const sameTree = path.resolve(current).toLowerCase()
      .startsWith(path.resolve(exeDir).toLowerCase());
    const currentOk = fs.existsSync(currentExe) && sameTree;
    // directory( EXE directory,  D:\ApkBoltRuntime )
    // :  C space, portable versionruntime. 
    // exe bundled runtime, 
    // "settingsruntimedirectory, directory / AppData"(issue #23). 
    if (explicit && !sameTree && fs.existsSync(currentExe)) {
      if (s.engine.gpuMode === 'swiftshader_indirect' || s.engine.memoryMB === 4096) {
        store.saveSettings({ engine: { gpuMode: 'auto', autoMemory: true, memoryMB: 0, cores: 0 } });
      }
      return;
    }
    // runtime(): AVD directory, 
    if (currentOk) {
      // runtime EXE directory = install( / store version)
      bundledRuntimeDir = current;
      // parameters, configuration 4G/4/ GPU
      if (s.engine.gpuMode === 'swiftshader_indirect' || s.engine.memoryMB === 4096) {
        store.saveSettings({ engine: { gpuMode: 'auto', autoMemory: true, memoryMB: 0, cores: 0 } });
      }
      return;
    }
    // Google Play system image; AOSP system image x86_64
    let playBundled = false;
    try {
      const root = path.join(bundled, 'system-images');
      for (const api of fs.readdirSync(root)) {
        for (const tag of fs.readdirSync(path.join(root, api))) {
          if (/playstore|google_apis/i.test(tag)) playBundled = true;
        }
      }
    } catch (_) { /* ignore */ }
    store.saveSettings({
      runtime: { dir: bundled, compatImage: playBundled },
      engine: { gpuMode: 'auto', autoMemory: true },
    });
    bundledRuntimeDir = bundled;
  } catch (_) { /* failurelaunch,  */ }
}
bootstrapBundledRuntime();

// probe( reg.exe)
const NO_SHELL_PROBE = process.argv.includes('--smoke') || process.env.APKBOLT_NO_SHELL_PROBE === '1';
const ICON_PNG = loadBrandIcon().toPNG();

let mainWindow = null;
let tray = null;
let runtime = null;
// "window" whenReady ( agentScope). 
// runLaunch / ,  const . 
let armAgent = async () => ({ ok: false });
let installer = null;
let sharer = null;
let quitting = false;
let winAgent = null;
let appWin = null;
let notifier = null;
let androidSet = null;
let updater = null;
let updateBusy = false;
let updateInfo = null;

/**
 * bootwindow. 
 *
 * app.whenReady() (const splashWin/splashDone), 
 * runLaunch() / autoDeploy() -- 
 * `typeof splashDone === 'function'` false, : 
 * - update("..."); 
 * - launchsuccess splash , 480x360 alwaysOnTop window
 * , Android. 
 * "appwindow": window/splash/appwindow. 
 * . 
 */
let splashWin = null;
let splashProgress = () => {};
let splashDone = () => {};

// ---------------- ----------------

function parseArgs(argv) {
  const args = argv.slice(IS_DEV ? 2 : 1).filter((a) => !a.startsWith('--allow-file-access'));
  const out = { apk: null, launch: null, silent: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--launch') {
      // Electron argv app path,  com.foo.bar
      const v = args.slice(i + 1).find((x) => x && /^[a-zA-Z][\w]*(\.[\w]+)+$/.test(x));
      if (v) { out.launch = v; out.silent = true; }
    } else if (a === '--silent' || a === '--autostart') out.silent = true;
    else if (/\.(apk|xapk|apks)$/i.test(a) && !a.startsWith('--')) out.apk = a;
  }
  return out;
}

/** Chromium WebP, nativeImage ; window APK PNG */
let decodeWindow = null;
async function decodeIcon(raw) {
  if (!decodeWindow || decodeWindow.isDestroyed()) {
    decodeWindow = new BrowserWindow({ show: false, width: 2, height: 2, skipTaskbar: true });
    await decodeWindow.loadURL('about:blank');
  }
  const mime = /^RIFF/.test(raw.toString('ascii', 0, 4)) ? 'image/webp' : 'image/png';
  const js = `(async () => {
    const img = new Image();
    img.src = 'data:${mime};base64,${raw.toString('base64')}';
    await img.decode();
    const s = Math.min(256, Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = s; c.height = s;
    c.getContext('2d').drawImage(img, 0, 0, s, s);
    return c.toDataURL('image/png');
  })()`;
  const url = await decodeWindow.webContents.executeJavaScript(js);
  return Buffer.from(String(url).split(',')[1] || '', 'base64');
}

/** boot: default, settings */
function applyAutoStart() {
  if (!app.isPackaged) return; // 
  const on = !!store.getSettings().autoStart;
  try {
    // name, launch "electron.app.Electron"
    app.setLoginItemSettings({
      openAtLogin: on,
      name: 'ApkBolt',
      path: process.execPath,
      args: ['--autostart'],
    });
    // Clean legacy entries
    app.setLoginItemSettings({ openAtLogin: false, name: 'electron.app.Electron' });
  } catch (_) { /* ignore */ }
}

// ---------------- Display Settings & Window Management ----------------

function displaySettings() { return store.getSettings().display || {}; }

/**
 * Windows Taskbar & AUMID management
 * Identifies ApkBolt processes cleanly for Windows taskbar grouping and notifications.
 */
const APP_AUMID = 'AbhijeetKangane.ApkBolt';
function setAumid(id) {
  try { app.setAppUserModelId(String(id || APP_AUMID).slice(0, 128)); } catch (_) { /* Windows version ignore */ }
}

/**
 * applandscapeportrait?
 *
 * emulator(hw.lcd)"", Android 
 * orientationapprotate -- app
 * , . "window": orientation = apporientation. 
 *
 * : settings > app > APK orientation
 * > orientation(apprestart). 
 */
function wantLandscapeFor(pkg) {
  const ds = displaySettings();
  const app = pkg ? store.getApp(pkg) : null;
  return orientation.resolveLandscape({
    mode: ds.orientationMode || 'auto',
    orientation: app && app.orientation,
    orientationOverride: app && app.orientationOverride,
    panelLandscape: !!ds.landscape,
  });
}

/**
 * rotateapp: orientation → per-app → restart. 
 *
 * , , Ctrl+R "orientation", 
 * ( display.landscape,  appWin.state.landscape). rotate, 
 * apps.json orientation, launch
 * wantLandscapeFor -- "". 
 * wantLandscapeFor(pkg) ,  + . 
 */
async function rotateCurrentApp() {
  const pkg = appWin && appWin.pkg;
  const current = pkg ? wantLandscapeFor(pkg) : !!displaySettings().landscape;
  const next = orientation.flipLandscape(current);
  if (pkg) {
    store.upsertApp({ package: pkg, orientationOverride: orientation.overrideValue(next) });
    appLog(`orientation override ${pkg} = ${orientation.overrideValue(next)}`);
  }
  // appWin.rotate updatewindow;  next orientation, 
  // restartForOrientation complete(restart). 
  if (appWin && appWin.isOpen) {
    await appWin.rotate((want) => restartForOrientation(want, { reloadApp: false }), next).catch(() => {});
  } else {
    await restartForOrientation(next, { reloadApp: false }).catch(() => {});
  }
  return { ok: true, landscape: next };
}

/**
 * ""apporientation. 
 *
 * AndroidManifest app( Activity portrait), 
 * app sensor / fullSensor, . 
 * Android(ActivityRecord requestedOrientation 
 * app).  apps.json, launch. 
 */
async function learnAppOrientation(pkg) {
  const app = store.getApp(pkg);
  if (!app || app.orientation || app.orientationOverride) return null;
  let out = '';
  try {
    out = await runtime.client().shell(
      'dumpsys activity activities | grep -m1 requestedOrientation', { timeout: 8000 });
  } catch (_) { return null; }
  const s = String(out || '');
  let value = null;
  if (/requestedOrientation=SCREEN_ORIENTATION_(PORTRAIT|SENSOR_PORTRAIT|REVERSE_PORTRAIT|USER_PORTRAIT)/.test(s)) value = 'portrait';
  else if (/requestedOrientation=SCREEN_ORIENTATION_(LANDSCAPE|SENSOR_LANDSCAPE|REVERSE_LANDSCAPE|USER_LANDSCAPE)/.test(s)) value = 'landscape';
  if (!value) return null;
  store.upsertApp({ package: pkg, orientation: value });
  appLog(`learned orientation ${pkg} = ${value}`);
  return value;
}

function screenRect() {
  const d = screen.getPrimaryDisplay();
  const a = d.workArea || d.bounds;
  return { x: a.x || 0, y: a.y || 0, w: a.width || 1920, h: a.height || 1080 };
}

let currentAppPkg = null;
let wheelRouter = null;
const deviceSize = { value: null };

/** wheel Android ; cache, /restartruntime */
async function getDeviceSize() {
  if (deviceSize.value) return deviceSize.value;
  try { deviceSize.value = await runtime.client().wmSize(); } catch (_) { /* runtime */ }
  if (!deviceSize.value || !deviceSize.value.width || !deviceSize.value.height) {
    const p = portraitSize();
    deviceSize.value = { width: p.w, height: p.h };
  }
  return deviceSize.value;
}

function portraitSize() {
  const d = displaySettings();
  return display.portraitSize(d.portrait || '540x960');
}

/** settingsmousekeymap, windowhookconfiguration */
function refreshPointerMapping() {
  if (appWin && appWin.isOpen) appWin.refreshPointer();
  else if (winAgent && winAgent.hooked) winAgent.setHook(false).catch(() => {});
}

/**
 * rotate = restartemulator. 
 *
 * " + "landscape(): 
 * - wm size: ,  LCD -> 90°, ; 
 * - wm density: framebuffer -> , ; 
 * - adb emu rotate: , portrait. 
 * hw.lcd.width/height landscaperestart, Qt landscapewindow, . 
 */
async function restartForOrientation(landscape, { reloadApp = true } = {}) {
  if (!appWin || !appWin.isOpen) return false;
  const pkg = appWin.pkg;
  store.saveSettings({ display: { landscape: !!landscape } });
  send('runtime:log', landscape ? 'Switching to landscape: restarting Android runtime...' : 'Switching to portrait: restarting Android runtime...');
  try {
    // restartemulatorwindow, . , 
    // windowhintwindow(window openDetached ). 
    try {
      appWin.showWaiting(landscape
        ? 'Switching to landscape (restarting Android runtime, ~40s, one-time)...'
        : 'Switching to portrait (restarting Android runtime, ~40s, one-time)...');
    } catch (_) { /* window */ }
    // window, restartdesktop
    try { await appWin.agent.detach(); } catch (_) { /* ignore */ }
    await runtime.stop({ graceful: false }).catch(() => {});
    /**
 * adb , . 
     *
 * emulatorexit adb update: 
 * `adb -s emulator-5554 get-state` "device".  ensure(), 
 * isOnline() "Runtime ready(reused)", 
 * adb `device 'emulator-5554' not found` --
 * orientationlaunch( 0.2 "", failure). 
     */
    try {
      const c = runtime.client();
      for (let i = 0; i < 14; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const online = await c.isOnline().catch(() => false);
        if (!online) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (_) { /* failure, ensure fallback */ }
    appLog(`rotate -> landscape=${landscape} restarting runtime`);
    const rt = await runtime.ensure({
      onLog: (m) => { send('runtime:log', m); appLog(`  rt ${m}`); },
    });
    if (!rt || !rt.ok) { appWin.waitingForRestart = false; return false; }
    // ****network. restartemulator WiFi 20 , 
    // (launcher beforeStart → installer.launch) waitForNetwork, 
    // : orientation 25 timeout,  23 , 
    // 100 125 .  launch . 
    if (reloadApp && pkg) {
      const app = store.getApp(pkg);
      if (app) {
        await rt.client.install(app.apkPath).catch(() => {});
        await rt.client.startApp(app.package, app.activity, {}).catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 1500));
      await attachAppWindow();
      appWin.scheduleFit(6);
    }
    // rt: beforeStart ( client stop )
    return rt;
  } catch (e) {
    appLog(`rotate restart failed: ${e && e.message}`);
    try { appWin.waitingForRestart = false; } catch (_) { /* window */ }
    return false;
  }
}

/**
 * Android. : 
 * - window(default): emulatorwindow, orientation, , , 
 * , , , ; 
 * - : SetParent window, , rotate. 
 * settings display.windowEmbed (true ). 
 */
async function attachAppWindow() {
  if (!appWin) return false;
  const embedMode = displaySettings().windowEmbed === true;
  if (!embedMode) {
    /**
 * windowretry. 
     *
 * emulatorwindow,  `am start` : 
 * cold boot, snapshot, orientation, Qt window
 * . , failure -- window"launch"
 * , "launchwindow", 
 * (log attach failed (detached): unknown). 
     */
    for (let i = 0; i < 4; i += 1) {
      if (!appWin.isOpen) {
        appLog(`attach detached: shell window closed (round ${i + 1})`);
        return false;
      }
      // eslint-disable-next-line no-await-in-loop
      const ok = await appWin.openDetached().catch((e) => {
        appWin.lastEmbedError = (e && e.message) || 'threw';
        return false;
      });
      if (ok) return true;
      appLog(`attach detached #${i + 1} failed: ${appWin.lastEmbedError || 'unknown'}`);
      // : window show/layout window
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 400 + i * 600));
    }
    // (desktop / driver / emulator --no-window ): 
    // , , 
    // fallback -- launchwindow. 
    appLog('attach detached: retries failed, falling back to embedded mode');
    const fallback = await appWin.embed().catch(() => false);
    if (fallback) {
      try {
        send('toast', { type: 'info', message: 'Native emulator window failed to show; temporarily falling back to embedded mode' });
      } catch (_) { /* window */ }
    }
    return fallback;
  }
  const ok = await appWin.embed().catch(() => false);
  if (!ok) {
    setTimeout(() => { if (appWin.isOpen) appWin.embed().catch(() => {}); }, 1500);
    setTimeout(() => { if (appWin.isOpen) appWin.embed().catch(() => {}); }, 4000);
  }
  return ok;
}

/**
 * ()"appwindow". 
 *
 * app****app, 
 * "app,  / ANR": 
 * - appWin.open() window close({keepApp:true}), window, 
 * ** endApp**, app force-stop, 
 * runtime._activeApps ; 
 * - app beginApp `first = _activeApps.size === 0` error, 
 * / snapshot; 
 * - appemulator → ANR. 
 * await app, window. 
 */
async function openAppWindow(pkg, tip) {
  // "app"; path, . 
  if (currentAppPkg && currentAppPkg !== pkg && appWin && appWin.isOpen) {
    const prev = currentAppPkg;
    try {
      // : windowemulatorwindow, 
      // park , desktop. 
      await appWin.close({ keepApp: true });
      await runtime.endApp(prev, { onIdle: onContainerActive }).catch(() => {});
      appLog(`switch: closed ${prev} before launching ${pkg}`);
    } catch (e) {
      appLog(`switch close ${prev} failed: ${e && e.message}`);
    }
  } else if (currentAppPkg && currentAppPkg !== pkg) {
    // window,  _activeApps , . 
    await runtime.endApp(currentAppPkg).catch(() => {});
  }
  const rec = store.getApp(pkg);
  const land = wantLandscapeFor(pkg);
  const p0 = portraitSize();
  const detached = displaySettings().windowEmbed === false;
  // orientationapporientation → beforeStart restartruntime( 40 ). 
  const willRestart = land !== !!displaySettings().landscape;
  // windowwindow, ****: 
  // - boot(launch); 
  // - (app)window, desktop 40 , 
  // . 
  const splashVisible = !!(splashWin && !splashWin.isDestroyed());
  const label = (rec && rec.label) || pkg;
  // app, window: taskbarshortcutapp
  setAumid(`${APP_AUMID}.${pkg}`);
  appWin.open({
    pkg,
    label,
    iconPath: rec && rec.icoPath,
    // landscapewindow, window
    portrait: land ? { w: p0.h, h: p0.w } : p0,
    // : "", "launch". 
    // (defaultsettings, ), . 
    fullscreen: displaySettings().mode === 'fullscreen'
      || displaySettings().autoFullscreenOnLaunch === true,
    detached,
    showWhileWaiting: detached && !splashVisible,
  });
  // launchapp PNG(iconPath,  192px+): ICO Chromium
  // <img> , , 64px "". 
  // window ICO(open() iconPath rec.icoPath, Win32 ). 
  appWin.setIcon(rec && (rec.iconPath || rec.icoPath));
  // orientation(orientation doctor.lcdFor )
  appWin.setState({
    // restart, ""hint,  40
    tip: willRestart
      ? `Switching orientation for "${String(label).slice(0, 20)}" to ${land ? 'landscape' : 'portrait'} (restarting runtime, ~40s)...`
      : (tip || 'Starting Android runtime...'),
    ready: false,
    landscape: land,
  });
  currentAppPkg = pkg;
}

async function toggleDisplayMode() {
  const next = store.saveSettings({
    display: { mode: displaySettings().mode === 'fullscreen' ? 'window' : 'fullscreen' },
  });
  const full = next.display.mode === 'fullscreen';
  if (appWin && appWin.isOpen) {
    // windowemulatorwindow, maximize window, 
    // appWin.toggleMaximize emulatorwindow/. 
    if (displaySettings().windowEmbed === false) {
      appWin.toggleMaximize().catch(() => {});
    } else if (full) appWin.win.maximize();
    else appWin.win.unmaximize();
    appWin.scheduleFit(6);
    // note: ****orientation. 
    // landscape: orientation"apporientation"
    // ( wantLandscapeFor).  F11 restartruntimelandscape, portraitapp
    // landscape → → "". 
  }
  return next.display.mode;
}

/** adb / emulator / System Image,  1~5 */
let deploying = false;
async function autoDeploy({ force = false } = {}) {
  if (deploying || !store.getSettings().autoDeploy) return { ok: false, error: 'skipped' };
  // downloadfailure:  checkEnv() , launch ApkBolt
  // 1.5GB runtime, "download". 
  // failure, 30 retry; ""
  // force=true retry. success. 
  const COOLDOWN_MS = 30 * 60 * 1000;
  const lastFail = Number(store.getSettings().runtime.deployFailedAt || 0);
  if (!force && lastFail && Date.now() - lastFail < COOLDOWN_MS) {
    appLog(`autoDeploy in cooldown (failed at ${new Date(lastFail).toISOString()}), skipping auto retry`);
    return { ok: false, error: 'cooldown', cooldown: true, until: lastFail + COOLDOWN_MS };
  }
  deploying = true;
  const progress = (p) => {
    send('provision:progress', { ...p, component: p.component || 'all' });
    // bootwindow
    if (typeof splashProgress === 'function') splashProgress(p);
  };
  let succeeded = false;
  try {
    const env = await runtime.provisioner.checkEnv();
    const needEngine = !env.emulator.ok || !env.sysimg.ok;
    // runtime(install / store version): ****. 
    // system image(compress), boot engine.ensure() ; 
    // 1.5GB , "system image". 
    if (bundledRuntimeDir && env.adb.ok && env.emulator.ok && env.sysimg.ok) {
      appLog(`autoDeploy skipped: bundled runtime detected (${bundledRuntimeDir}), no network needed`
        + (env.needsExtract ? ', system image will be extracted locally on first launch' : ''));
      // **success**, failure.  return succeeded, finally
      // failure deployFailedAt -- runtime 30
      // "failure", log"failure ...", 
      // settings"retry". 
      succeeded = true;
      return { ok: true, source: 'bundled', needsExtract: !!env.needsExtract };
    }
    if (bundledRuntimeDir && !env.emulator.ok) {
      appLog(`autoDeploy skipped download: runtime is bundled (${bundledRuntimeDir})`);
      // diagnose"downloadfailure", . 
      succeeded = true;
      return { ok: false, error: 'bundled', bundled: true };
    }
    // " GitHub runtime":  emulator + System Image, 
    // downloadupdate GitHub ( dl.google.com ). 
    // ( / / ). 
    if (needEngine && store.getSettings().runtime.preferGithubRuntime !== false) {
      try {
        progress({ message: 'Downloading runtime from GitHub...' });
        await runtime.provisioner.installRuntimePack(progress);
        const afterPack = await runtime.provisioner.checkEnv();
        if (afterPack.emulator.ok && afterPack.sysimg.ok) {
          succeeded = true;
          return { ok: true, source: 'github' };
        }
        progress({ message: 'Runtime bundle incomplete, fetching from official source...' });
      } catch (e) {
        progress({ message: `GitHub runtime unavailable (${e.message}), switching to official source...` });
      }
    }
    if (!env.adb.ok) {
      progress({ message: 'Preparing adb...' });
      await runtime.provisioner.installAdb(progress);
    }
    if (!env.emulator.ok) {
      progress({ message: 'Preparing Android runtime...' });
      await runtime.provisioner.installEmulator(progress);
    }
    if (!env.sysimg.ok) {
      progress({ message: 'Preparing Android system image...' });
      await runtime.provisioner.installSystemImage(progress);
    }
    const after = await runtime.provisioner.checkEnv();
    succeeded = !!(after.adb.ok && after.emulator.ok && after.sysimg.ok);
    return { ok: succeeded };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    // "failure"; successfailure. 
    try {
      store.saveSettings({ runtime: { deployFailedAt: succeeded ? 0 : Date.now() } });
    } catch (_) { /* settings */ }
    deploying = false;
  }
}

function launcherInfo() {
  if (app.isPackaged) {
    return { target: process.execPath, args: '', cwd: path.dirname(process.execPath) };
  }
  return { target: process.execPath, args: `"${APP_ROOT}"`, cwd: APP_ROOT };
}

/** directory(best-effort, ; directorypath) */
function copyDirContents(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    try {
      if (entry.isDirectory()) copyDirContents(s, d);
      else fs.copyFileSync(s, d);
    } catch (_) { /* failure */ }
  }
}

/** Windows ( VirtualMachinePlatform / HypervisorPlatform) */
/**
 * Windows . 
 *
 * { ok, cancelled, code, feature }: 
 * cancelled 1223(ERROR_CANCELLED)" UAC ""failure"--
 * ok:false, UI "", . 
 */
function enableWindowsFeature(feature) {
  return new Promise((resolve) => {
    const inner = `Enable-WindowsOptionalFeature -Online -FeatureName '${feature}' -NoRestart -All`;
    const ps = `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru `
      + `-ArgumentList @('-NoProfile','-NonInteractive','-Command',${JSON.stringify(inner)}); exit $p.ExitCode } `
      + 'catch { exit 1223 }';
    const { spawn } = require('child_process');
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.on('exit', (code) => resolve({
      ok: code === 0, cancelled: code === 1223, restart: true, code, feature,
    }));
    proc.on('error', () => resolve({ ok: false, feature, error: 'Failed to launch PowerShell' }));
  });
}

/**
 * WHPX(Windows Hypervisor Platform). 
 *
 * note:  Android emulator WHPX 
 * **"Windows "(HypervisorPlatform)**; 
 * ""(VirtualMachinePlatform) WSL2 ,  WHPX . 
 * , (). 
 *
 * WinHvPlatform.dll :  DLL Windows 
 * ( WinHvPlatform.dll ,  AEHD)--" WHPX"
 * . 
 */
async function enableWhpxFeatures() {
  const steps = [];
  for (const f of ['HypervisorPlatform', 'VirtualMachinePlatform']) {
    // eslint-disable-next-line no-await-in-loop
    steps.push(await enableWindowsFeature(f));
  }
  return { ok: steps.some((s) => s.ok), cancelled: steps.every((s) => s.cancelled), steps };
}

/** store version: MSIX mediumIL,  */
const MSIX_ACCEL_HINT = 'Store edition cannot elevate permissions. Please enable manually:'
  + 'Press Win+R → type optionalfeatures → check "Windows Hypervisor Platform"'
  + '(HypervisorPlatform), click OK and restart PC.';

// ---------------- window ----------------

function createWindow({ show = true } = {}) {
  mainWindow = new BrowserWindow({
    width: Number(process.env.APKBOLT_WIN_W) || 1140,
    height: Number(process.env.APKBOLT_WIN_H) || 740,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#f7f8fa',
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f7f8fa', symbolColor: '#2b3138', height: 44 },
    icon: nativeImage.createFromBuffer(ICON_PNG),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  if (show) mainWindow.once('ready-to-show', () => mainWindow.show());

  // error stdout: , , 
  // app.js id , . 
  if (process.argv.includes('--smoke')) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
      if (level >= 2) console.log(`[renderer] ${message} (${String(source).split('/').pop()}:${line})`);
    });
  }

  // (/GitHub ), appwindow
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file://')) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  mainWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWindow.hide();
    notify('ApkBolt is running in the background', 'Click the tray icon to restore; right-click to exit.');
  });

  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
  return mainWindow;
}

function showWindow() {
  // window = ApkBolt (taskbarapp)
  setAumid(APP_AUMID);
  if (!mainWindow) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------------- manual ----------------

let manualWindow = null;
const manualAutoAt = new Map();

/**
 * manual. payload "",  core/manual.js : 
 * issue code / installerror / topic id , directory. 
 * reason='fix-failed' :  60 , repair
 * installfailuremanualwindow. 
 */
function openManual(payload = {}) {
  const target = manual.resolve(payload);
  const now = Date.now();
  const last = manualAutoAt.get(target.id) || 0;
  if (target.reason === 'fix-failed' && now - last < 60000) {
    if (manualWindow && !manualWindow.isDestroyed()) {
      manualWindow.show();
      manualWindow.focus();
    }
    return target;
  }
  manualAutoAt.set(target.id, now);

  try {
    if (!manualWindow || manualWindow.isDestroyed()) {
      manualWindow = new BrowserWindow({
        width: 1080,
        height: 780,
        minWidth: 720,
        minHeight: 520,
        show: false,
        backgroundColor: '#ffffff',
        autoHideMenuBar: true,
        icon: nativeImage.createFromBuffer(ICON_PNG),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
          spellcheck: false,
        },
      });
      manualWindow.on('closed', () => { manualWindow = null; });
      // manual(GitHub/Gitee); window. 
      manualWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: 'deny' };
      });
      manualWindow.webContents.on('will-navigate', (e, url) => {
        if (url.startsWith('file://')) return;
        e.preventDefault();
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      });
    }
    manualWindow.setTitle(`ApkBolt Guide  -  ${target.title}`);
    manualWindow.loadFile(path.join(__dirname, 'ui', 'manual.html'), { hash: target.anchor });
    manualWindow.once('ready-to-show', () => {
      if (!manualWindow || manualWindow.isDestroyed()) return;
      manualWindow.show();
      manualWindow.focus();
    });
    // window loadFile ready-to-show
    if (manualWindow.isVisible()) manualWindow.focus();
    appLog(`manual open ${target.id}#${target.anchor} reason=${target.reason || 'manual'}`);
  } catch (e) {
    appLog(`manual open failed: ${e && e.message}`);
    // manualrepair: 
    shell.openExternal('https://github.com/abhi666-max/apkbolt#readme').catch(() => {});
  }
  return target;
}

function notify(title, body) {
  if (store.getSettings().notifyOnInstall === false) return;
  try {
    const { Notification } = require('electron');
    if (Notification.isSupported()) new Notification({ title, body, icon: nativeImage.createFromBuffer(ICON_PNG) }).show();
  } catch (_) { /* ignore */ }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// ---------------- check( debug)----------------

/**
 * check = , "". 
 *
 * (): 
 * 1) :  src/core/autodebug-probe.js(), 
 * src/core/autodebug.js(, ). 
 * 2) probefailure ≠ : , "", 
 * "". , . 
 * 3) "": hint, 
 * ; . 
 */
let autodebugState = { issues: [], summary: null, at: 0, running: false };
let autodebugTimer = null;
let autodebugBusy = false;

function autodebugConfig() {
  const d = (store.getSettings() || {}).debug || {};
  const intervalMin = Number(d.intervalMin);
  return {
    auto: d.auto !== false,
    intervalMin: [1, 5, 10, 30, 60].includes(intervalMin) ? intervalMin : 10,
    notify: d.notify !== false,
  };
}

async function runAutodebug({ force = false } = {}) {
  if (autodebugBusy) return autodebugState;
  const cfg = autodebugConfig();
  if (!force && !cfg.auto) return autodebugState;
  autodebugBusy = true;
  send('autodebug:state', { ...autodebugState, running: true });
  try {
    const autodebug = require('./core/autodebug');
    const probe = require('./core/autodebug-probe');
    const obs = await probe.collect({ runtime, store, doctor: require('./core/doctor') });
    const issues = autodebug.evaluate(obs);
    const summary = autodebug.summarize(issues);
    const { added } = autodebug.diff(autodebugState.issues, issues);
    autodebugState = { issues, summary, at: Date.now(), running: false };
    send('autodebug:state', autodebugState);
    if (cfg.notify) {
      // " error": warn/info settings, . 
      const fresh = added.filter((i) => i.severity === 'error');
      if (fresh.length) {
        const text = fresh.map((i) => i.title).join('; ');
        send('toast', { type: 'error', message: `Auto-diagnostics found issues: ${text} (Settings → Diagnostics)` });
        notify('Issues detected', `${text}. Open ApkBolt Settings → Diagnostics & Repair to resolve.`);
        appLog(`autodebug new issues: ${fresh.map((i) => i.code).join(',')}`);
      }
    }
    return autodebugState;
  } catch (e) {
    // checkfailure: log, . 
    appLog(`autodebug failed: ${e && e.message}`);
    autodebugState = { ...autodebugState, running: false, error: String((e && e.message) || e) };
    send('autodebug:state', autodebugState);
    return autodebugState;
  } finally {
    autodebugBusy = false;
  }
}

function scheduleAutodebug() {
  if (autodebugTimer) {
    clearInterval(autodebugTimer);
    autodebugTimer = null;
  }
  const cfg = autodebugConfig();
  if (!cfg.auto) return;
  autodebugTimer = setInterval(() => {
    runAutodebug().catch(() => {});
  }, cfg.intervalMin * 60 * 1000);
  if (autodebugTimer.unref) autodebugTimer.unref();
}

// ---------------- ----------------

function buildTray() {
  const icon = loadTrayIcon();
  try {
    tray = new Tray(icon);
  } catch (_) {
    return;
  }
  const refresh = () => {
    const apps = store.getApps().slice(0, 8);
    // window,  --
    // "app", app. 
    // "app" currentAppPkg runtime.activeApps: 
    // endApp activeApps ,  false. 
    // currentAppPkg app(endApp ), . 
    const hasRunning = currentAppPkg && runtime && runtime.activeApps
      ? runtime.activeApps.includes(currentAppPkg)
      : false;
    const runningLabel = currentAppPkg
      ? ((store.getApp(currentAppPkg) || {}).label || currentAppPkg)
      : '';
    const menu = Menu.buildFromTemplate([
      { label: 'Open ApkBolt', click: () => showWindow() },
      { label: 'User Guide', click: () => openManual({ topic: 'overview', reason: 'tray' }) },
      { type: 'separator' },
      ...(apps.length
        ? apps.map((a) => ({ label: a.label, click: () => runLaunch(a.package) }))
        : [{ label: 'No apps installed', enabled: false }]),
      { type: 'separator' },
      {
        label: hasRunning ? `Close Current App (${runningLabel})` : 'Close Current App',
        enabled: !!hasRunning,
        click: () => {
          const pkg = currentAppPkg;
          if (!pkg) return;
          // app:stop path, 
          stopApp(pkg).then(() => refresh());
        },
      },
      {
        label: wantLandscapeFor(currentAppPkg) ? 'Switch to Portrait (restarts runtime)' : 'Switch to Landscape (restarts runtime)',
        enabled: !!currentAppPkg,
        click: () => { rotateCurrentApp().catch(() => {}); },
      },
      {
        label: displaySettings().mode === 'fullscreen' ? 'Exit Fullscreen' : 'Fullscreen (Adaptive)',
        click: () => { toggleDisplayMode(); },
      },
      { label: 'Rebuild Desktop & Start Menu Shortcuts', click: () => { installer.ensureShortcuts().catch(() => {}); } },
      { label: 'Sync Shared Folder', click: () => sharer.sync() },
      { label: 'Settings', click: () => { showWindow(); send('ui:navigate', 'settings'); } },
      {
        label: updateInfo && updateInfo.hasUpdate ? `New Version Available (${updateInfo.tag})` : 'Check for Updates',
        click: async () => {
          showWindow();
          send('ui:navigate', 'settings');
          const info = await updater.check().catch(() => null);
          if (info) { updateInfo = info; send('update:state', info); }
          if (info && info.hasUpdate && info.asset) {
            const r = await dialog.showMessageBox(mainWindow || undefined, {
              type: 'question',
              title: 'Update Available',
              message: `ApkBolt ${info.tag} is available (current: v${app.getVersion()}). Update now?`,
              detail: (info.notes || '').slice(0, 600),
              buttons: ['Update Now', 'Later'],
              defaultId: 0,
              cancelId: 1,
            });
            if (r.response === 0) runUpdate();
          } else if (info && !info.hasUpdate) {
            notify('Already up to date', `ApkBolt v${app.getVersion()}`);
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: async () => {
          try { appWin.close({ keepApp: true }); } catch (_) { /* ignore */ }
          quitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
  };
  tray.setToolTip('ApkBolt - Fast Android Runtime');
  // Windows window(). 
  // double-click, , . 
  // ,  showWindow . 
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
  refresh();
  setInterval(refresh, 5000).unref?.();
}

// ---------------- ----------------

let installBusy = null;   // installpath:  APK second-instance, 
let lastInstallErr = { msg: '', at: 0 };

async function runInstall(filePath) {
  showWindow();
  // ( / )→ hint, install
  if (installBusy) {
    if (installBusy === filePath) {
      send('toast', { type: 'info', message: 'This APK is currently installing, please wait...' });
      return { ok: false, error: 'Installation already in progress' };
    }
    send('toast', { type: 'info', message: 'An installation is already running. Please wait for it to finish.' });
    return { ok: false, error: 'Installation already running' };
  }
  installBusy = filePath;
  send('install:start', { file: filePath });
  try {
    const result = await installer.install(filePath, (p) => send('install:progress', p));
    send('install:done', result);
    // desktop, "shortcut"
    windowctl.refreshShell().catch(() => {});
    notify('Installation Complete', `${result.app.label} is installed${result.app.shortcutPath ? ' (desktop shortcut created)' : ''}`);
    return result;
  } catch (e) {
    send('install:error', { message: e.message, file: filePath });
    if (e.needsSetup) send('ui:navigate', 'setup');
    // error 8 : retry
    const now = Date.now();
    if (e.message !== lastInstallErr.msg || now - lastInstallErr.at > 8000) {
      lastInstallErr = { msg: e.message, at: now };
      // windowhint, 
      if (!mainWindow || !mainWindow.isVisible() || mainWindow.isMinimized()) {
        notify('Installation Failed', e.message.slice(0, 120));
      }
    }
    throw e;
  } finally {
    installBusy = null;
  }
}

/**
 * downloadinstallversion,  update-apply " + restart". 
 * path. 
 */
async function runUpdate() {
  if (updateBusy) return { ok: false, error: 'Update in progress' };
  // (MSIX)update: installdirectory C:\Program Files\WindowsApps , 
  // exe failure, verify, app. 
  // update Microsoft Store(ms-windows-store: ). 
  if (store.STORE_BUILD) {
    shell.openExternal('ms-windows-store://downloadsandupdates').catch(() => {});
    return { ok: false, error: 'Store updates are handled by Microsoft Store', manual: true };
  }
  updateBusy = true;
  const sendProgress = (p) => send('update:progress', p);
  try {
    const info = updateInfo && updateInfo.hasUpdate ? updateInfo : await updater.check();
    updateInfo = info;
    if (!info.hasUpdate) return { ok: false, error: 'Already up to date' };
    if (!info.asset) {
      shell.openExternal(info.htmlUrl || Updater.repoUrl()).catch(() => {});
      return { ok: false, error: 'No direct installer package available, opened releases page', manual: true };
    }
    sendProgress({ stage: 'download', percent: 0, message: 'Preparing download...' });
    const job = await updater.prepare(info);
    sendProgress({ stage: 'apply', percent: 100, message: 'Updating files and restarting...' });
    updater.apply(job);
    // "restart", exit(before-quit emulatorwindow)
    setTimeout(() => { quitting = true; app.quit(); }, 900);
    return { ok: true, version: info.version, mode: job.mode };
  } catch (e) {
    sendProgress({ stage: 'error', percent: 0, message: e.message });
    return { ok: false, error: e.message };
  } finally {
    updateBusy = false;
  }
}

/**
 * launch. 
 *
 * launch 80 (restart + cold boot). app, 
 * ,  -- : 
 * openAppWindow launchapp(close + endApp), restart, 
 * failure, log `cmd: Can't find service: activity` / `device not found`, 
 * ", ". 
 *
 * : app → (); app → 
 * , runtime. 
 */
let launchInFlight = null;
// "software emulation", app
let accelWarned = false;

async function runLaunch(pkg) {
  if (launchInFlight) {
    if (launchInFlight.pkg === pkg) {
      appLog(`launch reused in-flight ${pkg}`);
      return launchInFlight.promise;
    }
    appLog(`launch queued ${pkg} (waiting for ${launchInFlight.pkg} to finish)`);
    await launchInFlight.promise.catch(() => {});
  }
  const entry = { pkg };
  entry.promise = launchOne(pkg).finally(() => {
    if (launchInFlight === entry) launchInFlight = null;
  });
  launchInFlight = entry;
  return entry.promise;
}

async function launchOne(pkg) {
  const t0 = Date.now();
  const mark = (s) => appLog(`launch ${pkg} ${s} +${Date.now() - t0}ms`);
  // "": , . 
  // , . 
  let attachDoneEarly = false;
  let earlyAttachOk = false;
  // launch:  splash window + appwindow boot . 
  // (onAppUp first frame / launch fallback / ), 
  // boot "appfirst frame",  Splash --
  // "Androidlaunch". 
  let bootAnimDone = false;
  let bootFuse = null;
  const finishBootAnimation = () => {
    if (bootAnimDone) return;
    bootAnimDone = true;
    if (bootFuse) { clearTimeout(bootFuse); bootFuse = null; }
    if (appWin && appWin.isOpen) appWin.setState({ ready: true, tip: '' });
    if (typeof splashDone === 'function') splashDone();
  };
  // : waitForAppFirstFrame 20 ,  4 . path(first frame
  // , onAppUp , launch ), 24 , 
  // launch. 
  bootFuse = setTimeout(finishBootAnimation, 24000);
  bootFuse.unref?.();
  appLog(`launch start ${pkg}`);
  try {
    // 0) window, appwindow. 
    // :  openAppWindow() , armAgent() hide(), 
    // armAgent windowcold boot(300~600ms), "window +
    // appwindow(+ boot)" -- window. 
    if (mainWindow && mainWindow.isVisible() && !IS_DEV) mainWindow.hide();
    // 1) "appwindow"launch: Androiddesktop, emulatorwindow
    await openAppWindow(pkg, 'Starting Android runtime...');
    /**
 * window: **, **emulatorwindow, 
 * "launch"window. 
     *
 * , window( + Logo + ), 
 * window am start -- cold boot / orientation 30 . 
 * "launchwindow". 
     *
 * cold boot Qt windowruntime, failure, 
 * :  1.5 , success( 30 ). orientationrestartruntime, 
 * windowruntime, window. 
     */
    if (displaySettings().windowEmbed === false && appWin && appWin.isOpen) {
      let tries = 0;
      let rounds = 0;
      const preAttach = async () => {
        if (!appWin || !appWin.isOpen) return;
        rounds += 1;
        // : failure,  45 ( 1 ), 
        // failure. 
        if (rounds > 45) return;
        // orientation, restartruntime: 
        // window, . , restartcomplete. 
        if (appWin.waitingForRestart) {
          setTimeout(preAttach, 1500);
          return;
        }
        tries += 1;
        // eslint-disable-next-line no-await-in-loop
        const ok = await appWin.openDetached().catch(() => false);
        if (ok) { appLog(`pre-attach detached ok (attempt ${tries})`); return; }
        if (tries < 20) setTimeout(preAttach, 1500);
      };
      preAttach();
    }
    // bootemulator + qemu / netsimd , . 
    // resident(embed window,  appwin.embed). 
    // await: , launch. 
    if (winAgent) { try { await armAgent(winAgent); } catch (_) { /* ignore */ } }

    const r = await installer.launch(pkg, {
      onLog: (m) => {
        send('runtime:log', m); appLog(`  rt ${m}`);
        // boot
        if (typeof splashProgress === 'function') splashProgress({ message: m });
      },
      onMark: mark,
      // app,  4 "". 
      // 4 , ""; app, 
      // ( 7.2s → 3s). 
      // await: , complete. 
      onAppUp: () => {
        attachDoneEarly = true;
        mark('app up (early attach)');
        attachAppWindow()
          .then(async (ok) => {
            earlyAttachOk = ok;
            mark(`early attach=${ok}`);
            if (!ok) return;
            // ≠ first frame: Android 12+ Activity first frame
            // Splash(app + ). boot, 
            // , .  Splash (first frame), 
            // timeout(failure). 
            let painted = true;
            try {
              const c = runtime.client();
              if (c && typeof c.waitForAppFirstFrame === 'function') {
                // app am start first frame 15 , 
              // 12 boot,  Splash . 
              // 20 ; , . 
              painted = await c.waitForAppFirstFrame(pkg, { timeoutMs: 20000 });
              }
            } catch (_) { /* failure */ }
            mark(`first frame=${painted}`);
            // first frame( 20 fallback):  splash windowappwindow
            // boot , applaunch Splash . 
            finishBootAnimation();
          })
          .catch(() => { earlyAttachOk = false; finishBootAnimation(); });
        // app Activity , orientation(portrait), 
        // orientation -- "/landscape 90 ". 
        // orientationself-healing( init/cur, ). 
        setTimeout(() => {
          runtime._healOrientation?.().catch(() => {});
          // apporientation( sensor app)
          learnAppOrientation(pkg).catch(() => {});
        }, 1800);
      },
      // launchorientationsettings. 
      // landscape(hw.lcd.width/height )+ restart, 
      // boot config.ini . "landscape"settings, portrait
      // (),  wm size / wm user-rotation . 
      // restart, reloadApp=false launchapp. 
      beforeStart: async (rt) => {
        mark('engine ready');
        // orientationapporientation,  Android
        // (). wantLandscapeFor "settings / app /
        // APK orientation", . 
        const wantLand = wantLandscapeFor(pkg);
        const cur = runtime.emulator && typeof runtime.emulator.panelLandscape === 'function'
          ? runtime.emulator.panelLandscape()
          : null;
        if (cur !== null && cur !== wantLand) {
          mark(`orientation mismatch (panel=${cur ? 'landscape' : 'portrait'}, want=${wantLand}) correcting via restart`);
          appWin.setState({ tip: wantLand ? 'Switching to landscape...' : 'Switching to portrait...' });
          // restartForOrientation restartruntime rt( client ). 
          // installer.launch,  resetDisplayOverrides / startApp
          // client, failure(catch , app). 
          const newRt = await restartForOrientation(wantLand, { reloadApp: false }).catch(() => null);
          mark('orientation fixed');
          if (newRt && newRt.ok) return newRt;
        }
        appWin.setState({ tip: 'Opening app...' });
        // + + : , launch
        await rt.client.prepareForeground().catch(() => {});
        mark('foreground ready');
        // restart null(installer rt)
        return null;
      },
    });
    mark('app started');

    // 2) app, (desktop/)
    // onAppUp (), "",  --
    // windowwindow/, . 
    let embedded;
    if (attachDoneEarly) {
      embedded = !!earlyAttachOk;
      mark(`early attached already (${embedded})`);
    } else {
      embedded = await attachAppWindow();
    }
    // log: window embedded=true
    // "(emulatorwindow)", "window". 
    // logsettings. 
    const attachMode = displaySettings().windowEmbed === false ? 'detached' : 'embed';
    if (!embedded) appLog(`attach failed (${attachMode}): ${appWin.lastEmbedError || 'unknown'}`);
    mark(`${attachMode}=${embedded}`);
    // completewindowwindow. window()Android, 
    // "black screen / ", mouseapp(window). 
    // topmost ,  Z , . 
    // window: emulatorwindow, window. 
    const detachedMode = displaySettings().windowEmbed === false;
    if (appWin.isOpen && !detachedMode) {
      try {
        appWin.win.show();
        appWin.win.setAlwaysOnTop(true);
        appWin.win.moveTop();
        appWin.win.focus();
        setTimeout(() => {
          if (appWin.isOpen) {
            try { appWin.win.setAlwaysOnTop(false); } catch (_) { /* window */ }
          }
        }, 700);
      } catch (_) { /* window */ }
    }
    // ""path.  onAppUp , 
    // first frame,  finishBootAnimation(first framecomplete/timeout/), 
    // Splash boot ,  Splash . 
    if (!attachDoneEarly) finishBootAnimation();
    // : , "app + ", 
    // App Android. mousekeymaphookwindow focus
    // settings, uninstall. 
    deviceSize.value = null;
    appWin.refreshPointer();
    await runtime.beginApp(pkg, { onActive: onContainerActive }).catch(() => {});
    // /: window, desktop EnumWindows stutter
    if (winAgent) {
      const game = store.getSettings().engine?.priorityMode === 'game';
      winAgent.setPerformanceMode(game).catch(() => {});
    }
    send('app:launched', { package: pkg, engine: r.engine });
    appLog(`launch ok ${pkg} ${attachMode}=${embedded}`);
    // software emulationlaunchapp: , /
    // settings, . appwindow, . 
    if (!accelWarned) {
      runtime.provisioner.emulatorAccel().then((a) => {
        if (!a || a.ok) return;
        accelWarned = true;
        notify('Running in software simulation mode (slow)', store.STORE_BUILD
          ? 'Enable Windows Hypervisor Platform and reboot for 5-10x faster performance.'
            + 'Open Settings → Diagnostics → Fix to open system configuration.'
          : 'Open Settings → Diagnostics → Fix to enable with one click (requires UAC), then restart PC.');
      }).catch(() => {});
    }
    // fallback:  early attach (embedded mode), . , . 
    finishBootAnimation();
    return { ok: true, embedded };
  } catch (e) {
    appLog(`launch failed ${pkg}: ${e && (e.stack || e.message)}`);
    try { appWin.close({ keepApp: true }); } catch (_) { /* ignore */ }
    // launchfailureemulatorwindow("emulatorwindow"), 
    // app → embed path. 
    if (winAgent) armAgent(winAgent).catch(() => {});
    showWindow();
    send('toast', { type: 'error', message: `Launch failed: ${e.message}` });
    return { ok: false, error: e.message };
  }
}

/**
 * /appwindow. 
 * 8 directory adb find/stat, ; 
 * ApkBolt launch,  Android app. 
 * app, window. 
 */
function onContainerActive(on) {
  if (on) {
    sharer?.start(8000);
    startNotifier();
  } else {
    sharer?.stop();
    notifier?.stop();
  }
}

/**
 * Androidapp -- path. 
 *
 * : 
 * 1. forceStop app(endApp )
 * 2. : embedded modewindow; emulatorwindow
 * (: windowemulatorwindowdesktop park)
 * 3. currentAppPkg, "app"
 *
 * @param {string} pkg app
 * @param {object} [opts] { keepWindow } keepWindow=true window
 * @returns {Promise<{ok:boolean, pkg?:string, error?:string}>}
 */
async function stopApp(pkg, opts = {}) {
  const target = pkg || currentAppPkg;
  if (!target) return { ok: false, error: 'No app is currently running' };
  const detached = displaySettings().windowEmbed === false;
  try {
    await runtime.endApp(target, { onIdle: (idle) => onContainerActive(idle) }).catch(() => {});
    appLog(`stop ${target}`);

    if (!opts.keepWindow) {
      // window: emulatorwindow, window. 
      // desktopemulatorwindow. 
      if (detached && appWin && appWin.isOpen) {
        try { await appWin.agent.hide(); } catch (_) { /* ignore */ }
      }
      if (appWin && appWin.isOpen) {
        appWin.close({ keepApp: true });
      }
    }

    // app: , "app"
    if (currentAppPkg === target) currentAppPkg = null;

    try { send('apps:changed'); } catch (_) { /* ignore */ }
    return { ok: true, pkg: target };
  } catch (e) {
    appLog(`stop failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/** : appwindow, window,  */
function startNotifier() {
  if (!notifier) {
    notifier = new NotifyBridge({
      getClient: () => runtime.client(),
      getAppLabel: (pkg) => (store.getApp(pkg) || {}).label || pkg,
      getAppIcon: (pkg) => (store.getApp(pkg) || {}).icoPath || '',
      onOpen: (pkg) => {
        if (appWin && appWin.isOpen && appWin.pkg === pkg) {
          appWin.win.show();
          appWin.win.focus();
        } else {
          runLaunch(pkg).catch(() => {});
        }
      },
    });
  }
  notifier.start();
}

// ---------------- IPC ----------------

function registerIpc() {
  ipcMain.handle('app:info', () => ({    version: app.getVersion(),
    isDev: IS_DEV,
    dataDir: store.DATA_DIR,
    runtimeDir: runtime.provisioner.paths().root,
    diskFreeMB: (() => {
      try { return require('./core/doctor').freeDiskMB(runtime.provisioner.paths().root); } catch (_) { return 0; }
    })(),
    exe: process.execPath,
    packaged: app.isPackaged,
  }));

  // launch(boot / ): 
  ipcMain.handle('app:startupInfo', () => {
    const a = parseArgs(process.argv);
    return {
      autostart: process.argv.includes('--autostart') || !!a.silent,
      launch: a.launch || null,
      smoke: process.argv.includes('--smoke'),
      version: app.getVersion(),
      isPackaged: app.isPackaged,
    };
  });

  // (runtime/system image/app)
  ipcMain.handle('dialog:openDir', async (_e, defaultPath) => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Data Directory',
      defaultPath: defaultPath || store.DATA_DIR,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('apps:list', async () => {
    const apps = store.getApps();
    const settings = store.getSettings();
    let running = [];
    try {
      const c = runtime.client();
      if (await c.isOnline()) running = await c.runningPackages();
    } catch (_) { /* runtimelaunchignore */ }
    return apps
      .map((a) => ({
        ...a,
        running: running.includes(a.package),
        iconUrl: a.iconPath && fs.existsSync(a.iconPath)
          ? `file:///${a.iconPath.replace(/\\/g, '/').replace(/ /g, '%20')}`
          : null,
        shortcutExists: a.shortcutPath ? fs.existsSync(a.shortcutPath) : false,
      }))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.lastLaunchAt || 0) - (a.lastLaunchAt || 0) || a.label.localeCompare(b.label, 'en'));
  });

  ipcMain.handle('apk:pick', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Select APK to Install',
      filters: [{ name: 'Android Packages', extensions: ['apk', 'apks', 'xapk'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (r.canceled) return [];
    return r.filePaths;
  });

  ipcMain.handle('apk:parse', async (_e, filePath) => parseApk(filePath));

  ipcMain.handle('apk:install', async (_e, filePath) => {
    const r = await runInstall(filePath);
    return { ok: true, app: r.app, warnings: r.warnings };
  });

  ipcMain.handle('app:launch', async (_e, pkg) => runLaunch(pkg));

  /**
 * Androidapp. 
   *
 * : endApp "appwindow", window
 * window, , app, 
 * exit ApkBolt(). 
   */
  ipcMain.handle('app:stop', async (_e, pkg, opts = {}) => stopApp(pkg, opts));

  ipcMain.handle('app:uninstall', async (_e, pkg) => {
    await installer.uninstall(pkg);
    return { ok: true };
  });

  ipcMain.handle('app:shortcut', async (_e, pkg) => {
    const appRecord = store.getApp(pkg);
    if (!appRecord) throw new Error('App does not exist');
    const p = installer.createShortcut(appRecord);
    store.upsertApp({ package: pkg, shortcutPath: p });
    return { ok: true, path: p };
  });

  ipcMain.handle('app:clearData', async (_e, pkg) => {
    const rt = await runtime.ensure();
    if (!rt.ok) throw new Error(rt.error);
    await rt.client.clearData(pkg);
    return { ok: true };
  });

  ipcMain.handle('app:pin', async (_e, { pkg, pinned }) => {
    store.upsertApp({ package: pkg, pinned: !!pinned });
    return { ok: true };
  });

  /**
 * appportrait(app). 
 * apps.json orientationOverride, restartruntime --
 * app wantLandscapeFor orientation. 
 * null ,  APK orientation. 
   */
  ipcMain.handle('app:setOrientation', async (_e, { pkg, orientation: value }) => {
    if (!pkg) return { ok: false, error: 'Missing package name' };
    const next = value === 'landscape' || value === 'portrait' ? value : null;
    store.upsertApp({ package: pkg, orientationOverride: next });
    appLog(`orientation override ${pkg} = ${next || '(Follow app)'}`);
    // orientation
    send('apps:changed');
    return { ok: true, orientation: next, landscape: wantLandscapeFor(pkg) };
  });

  ipcMain.handle('app:revealApk', async (_e, pkg) => {
    const a = store.getApp(pkg);
    if (a?.apkPath && fs.existsSync(a.apkPath)) shell.showItemInFolder(a.apkPath);
  });

  ipcMain.handle('apk:reveal', async () => {
    fs.mkdirSync(store.APK_DIR, { recursive: true });
    shell.openPath(store.APK_DIR);
  });

  /**
 * memory / CPU / data partition, , 
 * :  settings.json, version, 
 * boot qemu -memory 32 exit, disk. 
   */
  const sanitizeResourcePatch = (patch) => {
    if (!patch || !patch.engine) return patch;
    const res = require('./core/resources');
    const host = res.hostProfile();
    const eng = { ...patch.engine };
    if ('memoryMB' in eng) {
      const c = res.clampMemoryMB(eng.memoryMB, host.totalMB);
      eng.memoryMB = c.mb;
      if (c.mb > 0) eng.autoMemory = false;
    }
    if ('cores' in eng) eng.cores = res.clampCores(eng.cores, host.cores).cores;
    if ('dataPartitionGB' in eng) {
      eng.dataPartitionGB = Math.max(0, Math.min(256, Number(eng.dataPartitionGB) || 0));
    }
    return { ...patch, engine: eng };
  };

  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:set', (_e, rawPatch) => {
    const patch = sanitizeResourcePatch(rawPatch);
    const next = store.saveSettings(patch);
    if (patch && patch.autoStart !== undefined) applyAutoStart();
    if (patch && patch.display && appWin && appWin.isOpen) {
      // portrait: window, app
      appWin.portrait = portraitSize();
    }
    // "shortcut", install
    if (patch && (patch.createStartMenuShortcut === true || patch.createShortcutOnInstall === true)) {
      installer.ensureShortcuts().catch(() => {});
    }
    // mousekeymap: /uninstallhook, window
    if (patch && patch.engine && (
      'mouseRightBack' in patch.engine || 'mouseWheelMode' in patch.engine || 'mouseSideButtons' in patch.engine
    )) {
      refreshPointerMapping();
    }
    // update / system image / : "", cache; 
    // runtime / / system imagecache provisioner._cache , restart. 
    if (patch && patch.runtime && (
      'sourcePreference' in patch.runtime || 'mirrorPrefix' in patch.runtime
      || 'autoMirror' in patch.runtime || 'runtimePackUrl' in patch.runtime
      || 'emulatorUrl' in patch.runtime || 'sysimgUrl' in patch.runtime
    )) {
      try {
        updater?.sources?.reset();
        runtime?.provisioner?.sources?.reset();
        runtime?.provisioner?.invalidateEnvCache?.();
      } catch (_) { /* ignore */ }
    }
    return next;
  });

  /**
 * directory: directorydirectory(best-effort, ), 
 * settings. Sharer store.getSettings().sharedDir, restart. 
   */
  ipcMain.handle('settings:setSharedDir', async (_e, dir) => {
    if (!dir || !dir.trim()) return { ok: false, error: 'Directory cannot be empty' };
    const newDir = dir.trim();
    const oldDir = store.getSettings().sharedDir;
    try {
      if (oldDir && oldDir !== newDir) copyDirContents(oldDir, newDir);
      fs.mkdirSync(newDir, { recursive: true });
      store.saveSettings({ sharedDir: newDir });
      return { ok: true, oldDir, newDir };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ---------------- / shortcut / ----------------

  ipcMain.handle('display:state', () => ({
    ...displaySettings(),
    screen: screenRect(),
    current: currentAppPkg,
  }));

  ipcMain.handle('display:set', async (_e, patch) => {
    const next = store.saveSettings({ display: patch || {} });
    if (appWin && appWin.isOpen) {
      appWin.portrait = portraitSize();
      const full = next.display.mode === 'fullscreen';
      if (full && !appWin.win.isMaximized()) appWin.win.maximize();
      if (!full && appWin.win.isMaximized()) appWin.win.unmaximize();
      // = landscape( toggleDisplayMode )
      appWin.setLandscape(full).catch(() => {});
      appWin.scheduleFit();
    }
    return next.display;
  });

  ipcMain.handle('display:toggle', () => toggleDisplayMode());

  ipcMain.handle('shortcut:rebuild', async () => ({ ok: true, fixed: await installer.ensureShortcuts() }));
  // ""retry, failure
  ipcMain.handle('runtime:autoDeploy', (_e, opts = {}) => autoDeploy({ force: !!opts.force }));
  // "" pm disable-user
  ipcMain.handle('settings:restoreSystem', async () => runtime.restoreSystemApps());
  // mousekeymap: configuration, uninstall(/wheelhook)
  ipcMain.handle('settings:refreshPointer', async () => { refreshPointerMapping(); return true; });
  // : "settings"
  ipcMain.handle('settings:unhook', async () => { refreshPointerMapping(); return true; });

  // ---------------- checkup / configuration ----------------
  // probe(memory, , , ); 
  // ( Windows ,  AEHD);  BIOS . 

  ipcMain.handle('preflight:run', async () => {
    const preflight = require('./core/preflight');
    let accel = { ok: false, kind: 'none' };
    try { accel = await runtime.provisioner.emulatorAccel(); } catch (_) { /* runtime */ }
    const hw = await preflight.collect({ accel });
    const edition = store.STORE_BUILD ? 'store' : 'installer';
    const report = preflight.evaluate({ hw, settings: store.getSettings(), edition });
    return { ok: true, hw, report, edition };
  });

  /**
 * appcheckuprecommended: settings + patchdriver. 
 * preflight (memory / / / / software emulation). 
   */
  ipcMain.handle('preflight:apply', async () => {
    const preflight = require('./core/preflight');
    const drv = require('./core/drivers');
    let accel = { ok: false, kind: 'none' };
    try { accel = await runtime.provisioner.emulatorAccel(); } catch (_) { /* ignore */ }
    const hw = await preflight.collect({ accel });
    const edition = store.STORE_BUILD ? 'store' : 'installer';
    const report = preflight.evaluate({ hw, settings: store.getSettings(), edition });
    const patch = sanitizeResourcePatch(report.patch);
    const next = store.saveSettings(patch);

    // parametersdriver: boot, checkup. 
    // verify -- checkupwhitelist. 
    let driverFile = '';
    let driverError = '';
    try {
      const v = drv.validateDriver(report.driver);
      if (!v.ok) throw new Error(v.errors.join('; '));
      const dir = drv.userDir(store);
      fs.mkdirSync(dir, { recursive: true });
      driverFile = path.join(dir, `${v.driver.id}.json`);
      fs.writeFileSync(driverFile, `${JSON.stringify(report.driver, null, 2)}\n`, 'utf8');
      const prev = (next.drivers && next.drivers.state) || {};
      store.saveSettings({ drivers: { state: { ...prev, [v.driver.id]: true } } });
    } catch (e) {
      driverError = e.message;
    }

    appLog(`Diagnostics auto-config: ${JSON.stringify(patch.engine)} driver=${driverFile || '(not written)'}`);
    return {
      ok: true,
      settings: store.getSettings(),
      driverFile,
      driverError,
      summary: report.summary,
      recommended: report.recommended,
    };
  });

  // ---------------- driver(patch) ----------------
  // driver JSON: ""+"launchparameters". 
  // "directory / verify / / / / ", . 

 /** + driver + (settings) */
  async function driverOverview() {
    const drv = require('./core/drivers');
    const doctor = require('./core/doctor');
    const os = require('os');
    const s = store.getSettings();
    const disabled = (s.drivers && s.drivers.disabled) || [];
    const state = (s.drivers && s.drivers.state) || {};
    let accel = { ok: false, kind: 'none' };
    try { accel = await runtime.provisioner.emulatorAccel(); } catch (_) { /* runtime */ }
    let emulatorVersion = '';
    try { emulatorVersion = (await runtime.provisioner.emulatorVersion()).version || ''; } catch (_) { /* ignore */ }
    let osBuild = 0;
    try {
      const m = /(\d+)\s*$/.exec(os.release() || '');
      osBuild = m ? Number(m[1]) : 0;
    } catch (_) { /* ignore */ }
    const host = drv.hostContext({
      info: { ...doctor.hostInfo(), cpuVendor: (os.cpus() || [])[0]?.model || '' },
      gpuVendor: doctor.detectGpuVendor(),
      osBuild,
      accel: accel && accel.ok ? (accel.kind || 'whpx') : 'none',
      emulatorVersion,
    });
    const dirs = { user: drv.userDir(store), bundled: drv.bundledDir(APP_ROOT) };
    const loaded = drv.loadAll([dirs.bundled, dirs.user]);
    const resolved = drv.resolve({ drivers: loaded.drivers, host, state, disabled });
    const hit = new Map(resolved.applied.map((d) => [d.id, d]));
    return {
      host,
      dirs,
      errors: loaded.errors,
      effect: resolved.effect,
      drivers: loaded.drivers.map((d) => {
        const forced = typeof state[d.id] === 'boolean' ? state[d.id] : null;
        return {
          id: d.id,
          name: d.name,
          version: d.version,
          author: d.author,
          description: d.description,
          priority: d.priority,
          builtin: d.dir === dirs.bundled,
          file: d.file,
          enabled: forced !== null ? forced : d.enabled !== false,
          matched: hit.has(d.id),
          hits: (hit.get(d.id) || {}).hits || [],
        };
      }),
    };
  }

  ipcMain.handle('drivers:list', () => driverOverview());

  ipcMain.handle('drivers:openFolder', async () => {
    const dir = require('./core/drivers').userDir(store);
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return { ok: true, dir };
  });

  ipcMain.handle('drivers:import', async () => {
    const drv = require('./core/drivers');
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Driver File (.json)',
      filters: [{ name: 'Driver JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const out = drv.importDriver(r.filePaths[0], drv.userDir(store));
    if (out.ok) {
      // : patch, default
      const s = store.getSettings();
      store.saveSettings({ drivers: { state: { ...(s.drivers.state || {}), [out.driver.id]: true } } });
      send('runtime:log', `Driver imported: ${out.driver.name} v${out.driver.version}`);
    }
    return { ...out, overview: await driverOverview() };
  });

  ipcMain.handle('drivers:exportTemplate', async () => {
    const drv = require('./core/drivers');
    const overview = await driverOverview();
    const tpl = drv.templateFromHost(overview.host);
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Driver Template for This PC',
      defaultPath: path.join(drv.userDir(store), `${tpl.id}.json`),
      filters: [{ name: 'Driver JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.mkdirSync(path.dirname(r.filePath), { recursive: true });
    fs.writeFileSync(r.filePath, `${JSON.stringify(tpl, null, 2)}\n`, 'utf8');
    return { ok: true, file: r.filePath, template: tpl };
  });

  ipcMain.handle('drivers:setEnabled', async (_e, { id, enabled } = {}) => {
    const did = String(id || '');
    if (!did) return { ok: false, error: 'Missing driver ID' };
    const s = store.getSettings();
    const prev = (s.drivers && s.drivers.state) || {};
    store.saveSettings({ drivers: { state: { ...prev, [did]: !!enabled } } });
    return { ok: true, overview: await driverOverview() };
  });

  ipcMain.handle('runtime:status', async () => runtime.status());
  ipcMain.handle('runtime:probe', async () => runtime.probe());
  ipcMain.handle('runtime:start', async () => {
    const r = await runtime.ensure({ onLog: (m) => send('runtime:log', m) });
    return r.ok ? { ok: true, engine: r.engine } : { ok: false, error: r.error, needsSetup: r.needsSetup };
  });
  ipcMain.handle('runtime:stop', async () => {
    await runtime.stop();
    return { ok: true };
  });
  ipcMain.handle('runtime:log', () => runtime.bootLog);

  // ---------------- diagnose / slim ----------------

  ipcMain.handle('doctor:profile', async () => {
    const doctor = require('./core/doctor');
    // bootparameters; boot"version + ", 
    // settings swiftshader_indirect / software emulation, . 
    let p = runtime.emulator.profile;
    if (!p) {
      const env = await runtime.provisioner.checkEnv();
      p = doctor.autoProfile({
        settings: store.getSettings(),
        accel: env.accel,
        emulatorVersion: env.emulator.version || '',
        diskMB: doctor.freeDiskMB(store.DATA_DIR),
      });
    }
    return { profile: p, text: doctor.describeProfile(p) };
  });

  ipcMain.handle('doctor:report', async () => {
    const r = await runtime.diagnostics();
    shell.showItemInFolder(r.file);
    return r;
  });

  /**
 * verify: launch/", ", 
 * repair( + settings, repair). 
   */
  ipcMain.handle('doctor:selfCheck', async () => {
    const doctor = require('./core/doctor');
    const issues = [];
    // try ,  try , 
    let accel = { ok: false };
    let free = 0;
    try {
      if (!doctor.vcRedistOk()) {
        issues.push({
          code: 'vcRedist', severity: 'error', title: 'Missing VC++ Runtime (x64)',
          // dll , . : 0xC0000135
          // VC++--store version WindowsApps . 
          // , manual 6.8 , . 
          hint: 'System is missing Microsoft Visual C++ 2015-2022 (x64), which Android runtime requires.'
            + 'Can be installed automatically. If error 0xC0000135 persists, see User Guide.', fix: 'vcRedist',
        });
      }
      accel = await runtime.provisioner.emulatorAccel().catch(() => ({ ok: false }));
      if (!accel.ok) {
        // store versioninstallpath, hint: 
        // - (MSIX)driver,  →
        // " Windows ""Windows "; 
        // - install/portable version(failure AEHD driver). 
        // version, "install AEHD driver"--
        // store versiondriver, . 
        issues.push(store.STORE_BUILD
          ? {
            code: 'accel',
            severity: 'error',
            title: 'Enable Windows Hypervisor Platform',
            hint: 'Without it, runtime runs in software mode, taking minutes to boot.'
              + MSIX_ACCEL_HINT
              + '(Store edition cannot auto-elevate; enable manually and restart PC.)',
            fix: 'virtualization',
          }
          : {
            code: 'accel',
            severity: 'warn',
            title: 'Hardware Acceleration Not Enabled',
            hint: `${accel.note || 'Falling back to software simulation (functional but slow).'}`
              + 'Click Fix on the right to enable automatically (requires UAC, restart needed);'
              + 'Will attempt AEHD driver installation if WHPX fails.',
            fix: 'virtualization',
          });
      }
      free = doctor.freeDiskMB(runtime.provisioner.paths().root);
      if (free && free < 8192) {
        issues.push({
          code: 'disk', severity: free < 2048 ? 'error' : 'warn', title: 'Runtime Disk Space Running Low',
          hint: `"${runtime.provisioner.paths().root}"drive has only ${free} MB free; runtime and images require more space.`, fix: 'disk',
        });
      }
      const rtDir = runtime.provisioner.paths().root;
      if (!doctor.isAsciiPath(rtDir)) {
        issues.push({
          code: 'pathRuntime', severity: 'warn', title: 'Runtime Path Contains Non-ASCII Characters',
          hint: 'Some runtime components require ASCII paths. Moving to an English path is recommended.', fix: 'path',
        });
      }
      const env = await runtime.provisioner.checkEnv().catch(() => ({}));
      if (!env.adb || !env.adb.ok) {
        issues.push({ code: 'adb', severity: 'error', title: 'adb Toolchain Missing', hint: 'Cannot connect to Android runtime.', fix: 'deploy' });
      }
      if (!env.emulator || !env.emulator.ok) {
        issues.push({ code: 'emulator', severity: 'error', title: 'Runtime Engine Not Installed', hint: 'Runtime engine needs to be deployed (~440 MB).', fix: 'deploy' });
      }
      if (!env.sysimg || !env.sysimg.ok) {
        issues.push({ code: 'sysimg', severity: 'warn', title: 'System Image Not Ready', hint: 'Android system image needs to be downloaded (~1.5 GB).', fix: 'deploy' });
      }
      // lock file: launch"AVD " FATAL
      const avdHome = runtime.provisioner.paths().avdHome;
      let locked = false;
      try { for (const f of fs.readdirSync(avdHome)) { if (/\.lock$/i.test(f)) { locked = true; break; } } } catch (_) { /* ignore */ }
      if (locked) {
        issues.push({ code: 'lock', severity: 'warn', title: 'Residual Lock Files Detected', hint: 'May cause the next launch to fail with "AVD in use".', fix: 'lock' });
      }
    } catch (_) { /* failure */ }
    return { issues, accel, free };
  });

  // ---------------- check( debug)----------------

 /** check(settings"check" / ) */
  ipcMain.handle('autodebug:run', () => runAutodebug({ force: true }));

 /** (settings, ) */
  ipcMain.handle('autodebug:state', () => autodebugState);

 /** */
  ipcMain.handle('autodebug:config', (_e, patch = {}) => {
    const cur = autodebugConfig();
    const next = {
      auto: patch.auto === undefined ? cur.auto : !!patch.auto,
      intervalMin: patch.intervalMin === undefined ? cur.intervalMin : Number(patch.intervalMin) || cur.intervalMin,
      notify: patch.notify === undefined ? cur.notify : !!patch.notify,
    };
    store.saveSettings({ debug: next });
    scheduleAutodebug();
    if (next.auto) runAutodebug().catch(() => {});
    return next;
  });

 /** emulator(emulator.exe launch, qemu detached ) */
  ipcMain.handle('app:clearOrphans', async () => {
    try {
      const r = await runtime.killOrphanEmulators({ onLog: (m) => appLog(`orphan: ${m}`) });
      return { ok: true, note: r && r.note };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

 /** launchsnapshot(snapshotbootcold boot) */
  ipcMain.handle('app:clearSnapshot', async () => {
    try {
      const ok = runtime.emulator.invalidateSnapshot();
      return { ok: !!ok };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

 /** restartruntime: self-healing unauthorized / / */
  ipcMain.handle('runtime:restart', async () => {
    try {
      await runtime.stop({ onLog: (m) => appLog(`restart-stop: ${m}`) }).catch(() => {});
      const r = await runtime.ensure({ onLog: (m) => send('runtime:log', m) });
      return { ok: true, ready: !!r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // VC++ 2015-2022 x64 : Androidemulator(Qt6) qemu . 
  // ""(0xc0000135 / MSVCP140 ). 
  function vcRedistInstaller() {
    const p = runtime.provisioner.paths();
    const cands = [
      path.join(p.root, 'vc_redist.x64.exe'),
      path.join(process.resourcesPath || '', 'runtime', 'vc_redist.x64.exe'),
    ];
    return cands.find((c) => c && fs.existsSync(c)) || null;
  }
  ipcMain.handle('runtime:vcRedist', () => {
    const doctor = require('./core/doctor');
    return { ok: doctor.vcRedistOk(), path: vcRedistInstaller() };
  });
  ipcMain.handle('runtime:installVcRedist', async () => {
    const file = vcRedistInstaller();
    if (!file) return { ok: false, reason: 'no-installer' };
    const { spawn } = require('child_process');
    await new Promise((resolve) => {
      // RunAs install(VC++ , ); /quiet /norestart restart
      const ps = spawn('powershell.exe', ['-NoProfile', '-Command',
        `Start-Process -FilePath "${file}" -ArgumentList '/quiet','/norestart' -Verb RunAs -Wait`],
      { windowsHide: true, stdio: 'ignore' });
      ps.on('exit', () => resolve());
      ps.on('error', () => resolve());
    });
    const doctor = require('./core/doctor');
    return { ok: doctor.vcRedistOk() };
  });

  ipcMain.handle('runtime:usage', () => runtime.usage());

  // (,  dialog )
  ipcMain.handle('app:confirm', async (_e, opts = {}) => {
    const { response } = await dialog.showMessageBox(mainWindow || undefined, {
      type: opts.type || 'question',
      title: opts.title || 'Confirm',
      message: opts.message || '',
      detail: opts.detail || '',
      buttons: ['Cancel', opts.okLabel || 'OK'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    return { response };
  });

  /**
 * : , , . 
 * runtime resources() , . 
   */
  ipcMain.handle('engine:resources', async () => {
    try {
      const backend = runtime.backend;
      if (backend && typeof backend.resources === 'function') return await backend.resources();
      return { backend: backend ? backend.id : '', ok: false, note: 'Runtime not ready, resource allocation unavailable' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /**
 * (quickboot ): capacity /data. 
 * app -- . 
   */
  ipcMain.handle('runtime:resetAndResize', async (_e, gb) => {
    const res = require('./core/resources');
    const doctor = require('./core/doctor');
    const freeMB = doctor.freeDiskMB(runtime.provisioner.paths().root);
    const want = res.clampDataGB(gb, freeMB).gb;
    if (!want) return { ok: false, error: 'Invalid target capacity' };
    store.saveSettings({ engine: { dataPartitionGB: want } });
    await runtime.stop().catch(() => {});
    const r = await runtime.resetAndroidData().catch((e) => ({ ok: false, error: e.message }));
    appLog(`reset+resize -> ${want}GB: ${JSON.stringify(r)}`);
    return { ok: !!(r && r.ok), wantGB: want, ...r };
  });

  // data partition(/data)capacity: app, update. 
  // "updatehintspace", , . 
  ipcMain.handle('runtime:dataInfo', () => {
    const doctor = require('./core/doctor');
    const b = runtime.backend;
    const info = (b && typeof b.dataInfo === 'function') ? (b.dataInfo() || {}) : {};
    const freeDiskMB = Number(info.freeMB) || Number(info.freeDiskMB)
      || doctor.freeDiskMB(runtime.provisioner.paths().root);
    return { ...info, freeDiskMB };
  });

  ipcMain.handle('runtime:setDataSize', async (_e, gb) => {
    const res = require('./core/resources');
    const doctor = require('./core/doctor');
    const freeMB = doctor.freeDiskMB(runtime.provisioner.paths().root);
    const clamped = res.clampDataGB(gb, freeMB);
    const want = clamped.gb;
    store.saveSettings({ engine: { dataPartitionGB: want } });
    if (!want) {
      const info = runtime.emulator.dataInfo();
      return { ok: true, auto: true, ...info };
    }
    const mb = Math.round(want * 1024);
    // system image qemu , (appexit, )
    let stopped = false;
    try {
      const online = await runtime.client().isOnline().catch(() => false);
      if (runtime.emulator.running() || online) {
        await runtime.stop().catch(() => {});
        stopped = true;
      }
    } catch (_) { /* ignore */ }
    try {
      const r = runtime.emulator.resizeDataPartition(mb);
      appLog(`data partition -> ${want}GB: ${JSON.stringify(r)}`);
      if (r && r.ok) notify('Data partition resized', `Available space ~${want} GB${stopped ? ' (runtime restarted)' : ''}`);
      return { ok: !!(r && r.ok), stopped, ...r, ...runtime.emulator.dataInfo() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('runtime:cleanup', async (_e, opts = {}) => {
    // : , ; clean ApkBolt runtimedirectory
    const pass = { apply: false, aggressive: !!opts.aggressive, includeSnapshots: !!opts.includeSnapshots };
    if (!opts.apply) return runtime.cleanup(pass);
    const preview = await runtime.cleanup(pass);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', `Clean ${preview.candidates.length} items`],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirm Runtime Cache Cleanup',
      message: `Will free ~${(preview.candidates.reduce((n, c) => n + c.size, 0) / 1048576).toFixed(0)} MB`,
      detail: (opts.includeSnapshots
        ? 'Runtime will be stopped, then obsolete images, snapshots, locks, and inactive caches will be removed. Installed apps are preserved.'
        : 'Removes obsolete images, old snapshots, and locks. Installed apps will remain intact.')
        + 'This action cannot be undone.',
    });
    if (response !== 1) return { ...preview, cancelled: true };
    return runtime.cleanup({ apply: true, aggressive: !!opts.aggressive, includeSnapshots: !!opts.includeSnapshots });
  });

  // Android:  /data + app + launchsnapshot, 
  // AVD "".  GB , UI . 
  ipcMain.handle('runtime:resetData', async () => {
    try {
      const r = await runtime.resetAndroidData();
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, reclaimed: r.reclaimed, reclaimedMB: Math.round(r.reclaimed / 1048576) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // repairnetwork:  /data(app, app). 
  // : Androidblack screen,  wlan0 , default. 
  ipcMain.handle('runtime:repairNetwork', async () => {
    try {
      const r = await runtime.repairNetwork({
        onLog: (m) => send('toast', { message: m, kind: 'info', timeout: 6000 }),
      });
      return r;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // networkcheckup, (settings)
  ipcMain.handle('runtime:checkNetwork', async () => {
    try {
      const network = await runtime.emulator.checkNetwork(runtime.adbPath());
      return { ok: !!network.ok, network };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ---------------- version ----------------

 /** , : "",  */
  ipcMain.handle('leftovers:scan', () => {
    try {
      const installDir = path.dirname(app.getPath('exe'));
      const dataDir = store.DATA_DIR;
      let avdHome = '';
      try { avdHome = runtime.provisioner.paths().avdHome; } catch (_) { avdHome = ''; }
      return { ok: true, ...leftovers.scan({ installDir, dataDir, avdHome }) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('leftovers:clean', (_e, items) => {
    try {
      const installDir = path.dirname(app.getPath('exe'));
      const r = leftovers.clean(Array.isArray(items) ? items : [], { installDir });
      appLog(`leftovers cleaned: ${r.removed.length} removed, ${r.failed.length} failed`);
      return { ok: true, ...r, freedMB: Math.round(r.freedBytes / 1048576) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ---------------- runtime ----------------

  ipcMain.handle('provision:installEmulator', async () => {
    try {
      const r = await runtime.provisioner.installEmulator(
        (p) => send('provision:progress', { ...p, component: 'emulator' }),
      );
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('provision:installSysimg', async () => {
    try {
      const r = await runtime.provisioner.installSystemImage(
        (p) => send('provision:progress', { ...p, component: 'sysimg' }),
      );
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('provision:installPlayImage', async () => {
    try {
      const r = await runtime.provisioner.installPlayImage(
        (p) => send('provision:progress', { ...p, component: 'playimg' }),
      );
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('provision:installAehd', async () => {
    try {
      const r = await runtime.provisioner.installAehd(
        (p) => send('provision:progress', { ...p, component: 'aehd' }),
      );
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

 /** install AEHD driver:  UAC, install */
  ipcMain.handle('provision:enableAccel', async () => {
    try {
      const p = runtime.provisioner.paths();
      const bat = path.join(p.aehdDir, 'silent_install.bat');
      if (!fs.existsSync(bat)) {
        const r = await runtime.provisioner.installAehd(
          (x) => send('provision:progress', { ...x, component: 'aehd' }),
        );
        if (!fs.existsSync(bat)) throw new Error(r.error || 'AEHD driver package not ready');
      }

      await new Promise((resolve, reject) => {
        const { spawn: sp } = require('child_process');
        const esc = bat.replace(/'/g, "''");
        const ps = `try { $p = Start-Process -FilePath '${esc}' -WorkingDirectory '${path.dirname(bat).replace(/'/g, "''")}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { exit 2 }`;
        const proc = sp('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
          windowsHide: true,
        });
        proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(
          code === 2 ? 'UAC authorization cancelled (click Yes to install driver)' : `Driver installation failed (exit code ${code})`,
        ))));
        proc.on('error', (e) => reject(e));
      });

      const accel = await runtime.provisioner.emulatorAccel();
      return { ok: accel.ok, accel, error: accel.ok ? '' : accel.note };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /**
 * : "Windows ". 
 * ""(WHPX);  DLL (), 
 * install Google AEHD driver. . 
   */
  ipcMain.handle('provision:enableVirtualization', async () => {
    try {
      const accel = await runtime.provisioner.emulatorAccel();
      if (accel.ok) return { ok: true, already: true, accel, note: 'Hardware acceleration is already available' };

      // ---------------- (MSIX):  WHPX ----------------
      // MSIX AppX ,  mediumIL, driver(AEHD), 
      // .  WHPX, ""
      // -- Start-Process -Verb RunAs, 
      // failure, "Hardware Acceleration Not Enabled". 
      if (store.STORE_BUILD) {
        const whpx = await enableWhpxFeatures();
        runtime.provisioner.invalidateEnvCache?.();
        if (whpx.ok) {
          return {
            ok: true, restartNeeded: true, steps: whpx.steps,
            accel: await runtime.provisioner.emulatorAccel().catch(() => accel),
            note: 'Enabled Windows Hypervisor Platform. Hardware acceleration will take effect after rebooting.',
          };
        }
        return {
          ok: false,
          manual: true,
          settingsUri: 'ms-settings:optionalfeatures',
          steps: whpx.steps,
          accel,
          note: MSIX_ACCEL_HINT,
        };
      }

      // ---------------- install / portable version ----------------
      // WHPX(, download); failure( / ) AEHD driver. 
      // AEHD driver, . 
      const whpx = await enableWhpxFeatures();
      runtime.provisioner.invalidateEnvCache?.();
      if (whpx.ok) {
        return {
          ok: true, restartNeeded: true, steps: whpx.steps,
          accel: await runtime.provisioner.emulatorAccel().catch(() => accel),
          note: whpx.steps.some((s) => s.cancelled)
            ? 'Windows Hypervisor Platform enabled. Restart your PC to take effect.'
            : 'Windows Hypervisor Platform enabled. Restart your PC to take effect.',
        };
      }
      if (whpx.cancelled) {
        return {
          ok: false,
          cancelled: true,
          error: 'UAC was cancelled; hardware acceleration was not modified. Click Fix to try again or enable manually.',
        };
      }

      // WHPX :  Google AEHD driver(, restart)
      const ae = await runtime.provisioner.installAehd(
        (x) => send('provision:progress', { ...x, component: 'aehd' }),
      ).catch((e) => ({ ok: false, error: e.message }));
      if (!ae.ok) return { ok: false, error: ae.error || 'AEHD driver package preparation failed' };
      const bat = path.join(runtime.provisioner.paths().aehdDir, 'silent_install.bat');
      await new Promise((resolve, reject) => {
        const { spawn: sp } = require('child_process');
        const esc = bat.replace(/'/g, "''");
        const ps = `try { $p = Start-Process -FilePath '${esc}' -WorkingDirectory '${path.dirname(bat).replace(/'/g, "''")}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { exit 2 }`;
        const proc = sp('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
        proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(
          code === 2 ? 'UAC authorization cancelled (click Yes to install driver)' : `Driver installation failed (exit code ${code})`,
        ))));
        proc.on('error', (e) => reject(e));
      });
      runtime.provisioner.invalidateEnvCache?.();
      const after = await runtime.provisioner.emulatorAccel();
      return { ok: after.ok, accel: after, note: after.ok ? 'AEHD hardware acceleration enabled' : after.note };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('provision:installAdb', async () => {
    try {
      const r = await runtime.provisioner.installAdb((p) => send('provision:progress', { ...p, component: 'adb' }));
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('provision:installQemu', async () => {
    try {
      const r = await runtime.provisioner.installQemu((p) => send('provision:progress', { ...p, component: 'qemu' }));
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('provision:downloadIso', async () => {
    try {
      const r = await runtime.provisioner.downloadIso((p) => send('provision:progress', { ...p, component: 'iso' }));
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('provision:createDisk', async (_e, sizeGB) => {
    try {
      const r = await runtime.provisioner.createDisk(sizeGB || store.getSettings().runtime.diskSizeGB || 24,
        (p) => send('provision:progress', { ...p, component: 'disk' }));
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('provision:importIso', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Android-x86 / Bliss OS System Image',
      filters: [{ name: 'System Image', extensions: ['iso', 'img'] }],
      properties: ['openFile'],
    });
    if (r.canceled) return { ok: false, canceled: true };
    try {
      return { ok: true, ...runtime.provisioner.importIso(r.filePaths[0]) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('provision:importDisk', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Virtual Disk with Android',
      filters: [{ name: 'Virtual Disk', extensions: ['qcow2', 'img', 'vmdk', 'raw'] }],
      properties: ['openFile'],
    });
    if (r.canceled) return { ok: false, canceled: true };
    try {
      const info = runtime.provisioner.importDisk(r.filePaths[0]);
      store.saveSettings({ runtime: { installed: true } });
      return { ok: true, ...info };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('provision:check', async () => runtime.provisioner.checkEnv());
  ipcMain.handle('provision:probeSources', async () => runtime.provisioner.probeSources());

  ipcMain.handle('runtime:startInstaller', async () => {
    try {
      await runtime.startInstaller({ onLog: (m) => send('runtime:log', m) });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('runtime:markInstalled', async () => {
    await runtime.markInstalled();
    return { ok: true };
  });

  ipcMain.handle('runtime:resetInstall', async () => {
    store.saveSettings({ runtime: { installed: false } });
    return { ok: true };
  });

  ipcMain.handle('assoc:status', () => {
    // / shell : probe(reg.exe )
    if (NO_SHELL_PROBE) return { registered: false, skipped: true };
    const { execFileSync } = require('child_process');
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Software\\Classes\\.apk', '/ve'], { windowsHide: true, encoding: 'utf8' });
      return { registered: out.includes(assoc.PROGID) };
    } catch (_) {
      return { registered: false };
    }
  });

  ipcMain.handle('assoc:register', () => {
    const l = launcherInfo();
    const icoPath = path.join(store.ICON_DIR, 'apkbolt.ico');
    if (!fs.existsSync(icoPath)) {
      // ICO,  Logo PNG
      if (fs.existsSync(APPICON_FILE)) fs.copyFileSync(APPICON_FILE, icoPath);
      else {
        const { pngToIco } = require('./core/shortcut');
        const ico = pngToIco(ICON_PNG);
        if (ico) fs.writeFileSync(icoPath, ico);
      }
    }
    return assoc.registerAssociation(l.target, icoPath, l.args);
  });

  ipcMain.handle('assoc:unregister', () => assoc.unregisterAssociation());

  ipcMain.handle('share:sync', async () => sharer.sync({ onLog: (m) => send('runtime:log', m) }));
  ipcMain.handle('share:open', async () => {
    const dir = store.getSettings().sharedDir;
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });

 /** clean AVD lock file: launch"AVD " FATAL */
  ipcMain.handle('app:clearLocks', async () => {
    try {
      const avdHome = runtime.provisioner.paths().avdHome;
      let removed = 0;
      for (const f of fs.readdirSync(avdHome)) {
        if (/\.lock$/i.test(f)) {
          try { fs.rmSync(path.join(avdHome, f), { force: true }); removed++; } catch (_) { /* ignore */ }
        }
      }
      return { ok: true, removed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /**
 * uninstall ApkBolt : 
 * 1) .apk (uninstall APK )
 * 2) install: launch NSIS uninstall(/), exit
 * 3) portable version( / install):  uninstaller.exe, hintdirectory
   */
  ipcMain.handle('app:removeSelf', async () => {
    try {
      try { await assoc.unregisterAssociation(); } catch (_) { /* failureuninstall */ }
      const exeDir = path.dirname(process.execPath);
      // updater.flavor : electron-builder
      // "Uninstall ApkBolt.exe",  "uninstaller.exe", 
      // install"uninstall"portable version, hintuninstall(issue #51). 
      const unName = findUninstaller(exeDir);
      if (!unName) {
        return { ok: true, portable: true, dataDir: store.DATA_DIR, exeDir };
      }
      const uninstaller = path.join(exeDir, unName);
      const { spawn } = require('child_process');
      // uninstallresidentemulator: qemu resources\runtime exe/dll, 
      // NSIS installdirectory. "uninstall", exit. 
      try { await runtime?.emulator?.killOrphanProcesses(); } catch (_) { /* ignore */ }
      // exit,  2 uninstall: 
      // exe installdirectory, uninstall. 
      const cmd = `ping 127.0.0.1 -n 3 >nul & start "" "${uninstaller}"`;
      spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      setTimeout(() => app.quit(), 300);
      return { ok: true, portable: false };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('shell:open', (_e, url) => shell.openExternal(url));
  // manual: "/", 
  ipcMain.handle('manual:open', (_e, payload) => openManual(payload || {}));

  /**
 * " Windows ". 
   *
 * ms-settings:optionalfeatures: Win11 "", 
 * ****"Windows ", . 
 * optionalfeatures.exe (WHPX ). 
 * , "" UAC. 
   */
  ipcMain.handle('provision:openWindowsFeatures', () => {
    try {
      const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'optionalfeatures.exe');
      const { spawn } = require('child_process');
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    } catch (e) {
      // :  / . settings, 
      shell.openExternal('ms-settings:optionalfeatures').catch(() => {});
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:hide', () => mainWindow?.hide());

  // ---------------- appwindow( rotate / / / ) ----------------

  const winOf = (e) => BrowserWindow.fromWebContents(e.sender);

  ipcMain.handle('shell:state', () => ({ ...appWin.state, iconUrl: appWin.iconUrl || '' }));
  // windowemulatorwindow, window --
  // .  appWin , window maximize/minimize. 
  ipcMain.handle('shell:minimize', () => appWin.minimize());
  ipcMain.handle('shell:maximize', () => appWin.toggleMaximize());
  // appWin.close(): emulatorwindow, Androidapp. 
  // win.close(),  -- window, Android, 
  // "app". 
  ipcMain.handle('shell:close', () => {
    if (appWin && appWin.isOpen) { appWin.close(); return { ok: true }; }
    return { ok: false };
  });
  // rotate = "app/". 
  // rotateCurrentApp:  wantLandscapeFor(pkg) orientation, 
  // next per-app + .  appWin.rotate
  // ( display.landscape,  state.landscape), 
  // , "rotate → landscape → portrait → portrait", 
  // app. 
  ipcMain.handle('shell:rotate', () => rotateCurrentApp());

  ipcMain.handle('shell:back', async () => { await runtime.client().keyBack(); });
  ipcMain.handle('shell:forward', async () => { await runtime.client().keyForward(); });

  // ---------------- Androidsettings(Androiddesktop) ----------------

  ipcMain.handle('android:status', async () => {
    try { return { ok: true, ...(await androidSet.status()) }; } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('android:set', async (_e, { key, value }) => {
    try {
      switch (key) {
        case 'wifi': return { ok: true, ...(await androidSet.setWifi(!!value)) };
        case 'airplane': return { ok: true, ...(await androidSet.setAirplane(!!value)) };
        case 'volume': return { ok: true, ...(await androidSet.setVolume(value)) };
        case 'animations': return { ok: true, ...(await androidSet.setAnimations(!!value)) };
        case 'fontScale': return { ok: true, ...(await androidSet.setFontScale(value)) };
        case 'density': return { ok: true, ...(await androidSet.setDensity(value)) };
        default: return { ok: false, error: `Unknown setting ${key}` };
      }
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('android:open', async (_e, action) => {
    try { return { ok: true, ...(await androidSet.open(action)) }; } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('android:tune', async (_e, pkg) => {
    try { return { ok: true, ...(await androidSet.tune({ pkg })) }; } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('android:permissions', async (_e, pkg) => {
    try { return { ok: true, rows: await androidSet.permissions(pkg) }; } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('android:grantAll', async (_e, pkg) => {
    try { return { ok: true, ...(await androidSet.grantAll(pkg)) }; } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('app:foreground', () => {
    if (appWin && appWin.isOpen) { appWin.win.show(); appWin.win.focus(); return true; }
    return false;
  });

  // ---- key ----
  ipcMain.handle('shell:keyEvent', async (_e, key) => {
    if (!keymapEngine || !keymapEngine.enabled) return false;
    const pkg = currentAppPkg;
    if (!pkg) return false;
    return keymapEngine.handleKey(key, pkg);
  });
  ipcMain.handle('keymap:getPresets', () => {
    return Object.entries(KEYMAP_PRESETS).map(([id, p]) => ({ id, label: p.label, desc: p.desc }));
  });
  ipcMain.handle('keymap:getMap', (_e, pkg) => keymapEngine ? keymapEngine.getMap(pkg) : []);
  ipcMain.handle('keymap:setMap', (_e, pkg, mappings) => {
    if (!keymapEngine) return { ok: false };
    keymapEngine.setMap(pkg, mappings);
    // settings
    const maps = { ...(store.getSettings().engine.keymaps || {}) };
    if (mappings && mappings.length) maps[pkg] = mappings;
    else delete maps[pkg];
    store.saveSettings({ engine: { keymaps: maps } });
    return { ok: true };
  });
  ipcMain.handle('keymap:setEnabled', (_e, on) => {
    if (keymapEngine) keymapEngine.enable(!!on);
    store.saveSettings({ engine: { keymapEnabled: !!on } });
    return { ok: true };
  });
  ipcMain.handle('keymap:isEnabled', () => keymapEngine ? keymapEngine.enabled : false);
  ipcMain.handle('keymap:applyPreset', (_e, pkg, presetId) => {
    if (!keymapEngine || !KEYMAP_PRESETS[presetId]) return { ok: false };
    const mappings = KEYMAP_PRESETS[presetId].mappings;
    keymapEngine.setMap(pkg, mappings);
    const maps = { ...(store.getSettings().engine.keymaps || {}) };
    maps[pkg] = mappings;
    store.saveSettings({ engine: { keymaps: maps } });
    return { ok: true, mappings };
  });

  // ---------------- update ----------------

  ipcMain.handle('app:updateCheck', async (_e, opts = {}) => {
    try {
      // "update"→ cache, 
      const info = await updater.check({ force: opts.force !== false });
      updateInfo = info;
      return { ok: true, ...info };
    } catch (e) {
      return { ok: false, error: e.message, current: app.getVersion() };
    }
  });

  ipcMain.handle('app:updateOpen', (_e, url) => {
    // GitHub Gitee : updatefailure
    // download,  github.com . 
    const raw = String(url || '');
    const ok = /^https:\/\/(github\.com|gitee\.com)\//i.test(raw);
    const target = ok ? raw : Updater.repoUrl();
    shell.openExternal(target).catch(() => {});
    return { ok: true, target };
  });

  ipcMain.handle('app:updateApply', () => runUpdate());

  ipcMain.handle('app:updateCancel', () => { updateBusy = false; return { ok: true }; });

  ipcMain.handle('app:restart', () => {
    setTimeout(() => { quitting = true; app.quit(); }, 200);
    return { ok: true };
  });
}

// ---------------- ----------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_evt, argv) => {
    const args = parseArgs(argv);
    if (args.launch) { runLaunch(args.launch); return; }
    if (args.apk) { runInstall(args.apk).catch(() => {}); return; }
    showWindow();
  });

  app.whenReady().then(async () => {
    store.ensureDirs();
    /**
 * "runtime". 
     *
 * releaseRuntime(): app, 
 * exit(single instance), emulatorlaunchapp; 
 * runtime.dispose(),  `device 'emulator-5554' not found`. 
 * "app". launch, 
 * pid runtime. 
     */
    try { fs.writeFileSync(path.join(store.DATA_DIR, 'owner.pid'), String(process.pid)); } catch (_) { /* ignore */ }
    // Windows taskbar(AppUserModelID)
    // Windows exe path: taskbar, , 
    // "Electron" -- "/default". 
    // note"", Androidappapp
    // AUMID( openAppWindow), taskbarwindow, 
    // ApkBolt . 
    setAumid(APP_AUMID);
    runtime = new Runtime(APP_ROOT);
    // launch:  app.log versiondirectory
    appLog(`start v${app.getVersion()} data=${store.DATA_DIR} pid=${process.pid}`);

    // ---- bootwindow ----
    // DSH : Logo + + . 
    // installconfiguration; . 
    // Android, app. 
    const isFirstRun = !store.getSettings().runtime.installed;
    // splash :  fadeUp .95s ,  .85s,  1.8s . 
    // show , splashDone , "". 
    // "launchapp"path; cold boot >1.8s, . 
    let splashShownAt = Date.now();
    try {
      // Note
      const { screen: electronScreen } = require('electron');
      const disp = electronScreen.getPrimaryDisplay();
      const sw = disp.workAreaSize.width;
      const sh = disp.workAreaSize.height;
      const splashW = 480, splashH = 360;
      splashWin = new BrowserWindow({
        width: splashW, height: splashH,
        x: Math.round((sw - splashW) / 2),
        y: Math.round((sh - splashH) / 2),
        frame: false, transparent: false, resizable: false,
        alwaysOnTop: true, skipTaskbar: true,
        backgroundColor: '#0b0c0e',
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'splash-preload.js'),
          contextIsolation: true, nodeIntegration: false, sandbox: false,
        },
      });
      // screen-saver emulatorwindow( alwaysOnTop default level
      // agent SetForegroundWindow z-order,  splash )
      splashWin.setAlwaysOnTop(true, 'screen-saver');
      splashWin.loadFile(path.join(__dirname, 'ui', 'splash.html'));
      splashWin.once('ready-to-show', () => { splashShownAt = Date.now(); splashWin.show(); });
      // IPC: version, , 
      ipcMain.handle('splash:version', () => app.getVersion());
      ipcMain.handle('splash:isFirstRun', () => isFirstRun);
      // : boot, system image"download"
      ipcMain.handle('splash:bundled', () => !!bundledRuntimeDir);
      ipcMain.on('splash:close', () => {
        if (splashWin && !splashWin.isDestroyed()) splashWin.close();
        splashWin = null;
      });
    } catch (e) {
      appLog(`splash window failed: ${e.message}`);
      splashWin = null;
    }
    // splash / complete(, )
    splashProgress = (p) => {
      if (splashWin && !splashWin.isDestroyed()) splashWin.webContents.send('splash:progress', p);
    };
    // ; "": splash 2.5
    // ( / IPC ), launchdesktop. 
    let splashDoneSent = false;
    let splashDoneScheduled = false;
    const SPLASH_MIN_MS = 1800;   // 
    const doSplashDone = () => {
      if (splashDoneSent) return;
      splashDoneSent = true;
      if (!splashWin || splashWin.isDestroyed()) return;
      try { splashWin.webContents.send('splash:done'); } catch (_) { /* ignore */ }
      setTimeout(() => {
        try {
          if (splashWin && !splashWin.isDestroyed()) splashWin.close();
        } catch (_) { /* ignore */ }
        splashWin = null;
      }, 2500).unref?.();
    };
    splashDone = () => {
      if (splashDoneSent || splashDoneScheduled) return;
      const waited = Date.now() - splashShownAt;
      if (waited < SPLASH_MIN_MS) {
        // :  fadeUp , . 
        // , , . 
        splashDoneScheduled = true;
        setTimeout(doSplashDone, SPLASH_MIN_MS - waited).unref?.();
      } else {
        doSplashDone();
      }
    };
    // fallbacktimeout: path splashDone(launchfailure), 
    // splash -- "window". 
    setTimeout(() => { if (!splashDoneSent) splashDone(); }, 180000).unref?.();

    const l = launcherInfo();
    installer = new Installer(runtime, {
      launcherTarget: l.target,
      launcherArgs: l.args,
      cwd: l.cwd,
      isDev: IS_DEV,
      desktopDir: app.getPath('desktop'),
      // Windows .lnk, desktop"app"; 
      // Linux freedesktop appdirectory. 
      startMenuDir: process.platform === 'win32'
        ? path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
        : path.join(process.env.HOME || app.getPath('home'), '.local', 'share', 'applications'),
      decodeIcon,
    });
    sharer = new Sharer(runtime);
    androidSet = new AndroidSettings(runtime);

    // ---- key ----
    const keymapEngine = new KeymapEngine({
      execInput: (cmd) => runtime.client().shell(cmd, { timeout: 4000 }),
      getSize: () => {
        // (landscape 1280x720 / portrait 720x1280)
        const land = !!(store.getSettings().display || {}).landscape;
        return land ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
      },
    });
    // settingsapp
    const savedMaps = (store.getSettings().engine || {}).keymaps || {};
    for (const [pkg, mappings] of Object.entries(savedMaps)) {
      if (Array.isArray(mappings) && mappings.length) keymapEngine.setMap(pkg, mappings);
    }
    // default(settings)
    keymapEngine.enable(store.getSettings().engine.keymapEnabled !== false);

    updater = new Updater({
      currentVersion: app.getVersion(),
      exePath: process.execPath,
      isPackaged: app.isPackaged,
      dataDir: store.DATA_DIR,
      // incrementalupdate:  Electron version, 
      electronVersion: process.versions.electron,
      // update" GitHub / Gitee / "system imagesettings
      settings: () => store.getSettings(),
      onProgress: (p) => send('update:progress', p),
    });

    // wheel:  input swipe, resident adb shell. 
    wheelRouter = new pointer.WheelRouter({
      getSize: getDeviceSize,
      inject: (cmd) => runtime.client().input(cmd),
    });

    // window: emulatorwindow. mousehookappwindowconfigurationinstall. 
    winAgent = new WinAgent();
    appWin = new AppWindow({
      agent: winAgent,
      // rotate Android ,  adb
      setOrientation: async (landscape) => {
        deviceSize.value = null;
        return runtime.client().setOrientation(landscape);
      },
      // getter: settingskeymap, window focus / , restart
      pointerConfig: () => pointer.pointerOptions(store.getSettings()),
      // windowwindow( emulator window)
      windowTargets: () => null,
    });
    appWin.onCloseApp((pkg) => {
      // window = app; window(, ), 
      // Android , cold boot. 
      runtime?.endApp(pkg, { onIdle: onContainerActive }).catch(() => {});
      // (Alt+F4 / taskbar)app, 
      // "app(xxx)"(app). 
      if (currentAppPkg === pkg) currentAppPkg = null;
      try { send('apps:changed'); } catch (_) { /* ignore */ }
    });

    // "window"= runtimedirectory + engine directory. 
    // windowwindow -- Qt app( 4.x Qt6, 
    // windowemulator),  agent.ps1 SetScope. 
    const agentScope = () => {
      const dirs = [];
      try { dirs.push(runtime.provisioner.root); } catch (_) { /* ignore */ }
      try { dirs.push(path.join(APP_ROOT, 'engine')); } catch (_) { /* ignore */ }
      return dirs.filter(Boolean);
    };
    // memory,  -- boot. 
    armAgent = async (agent) => {
      if (!agent) return { ok: false };
      const dirs = agentScope();
      // parameters pid: window""window
      await agent.scope(dirs, process.pid).catch(() => null);
      if (!dirs.length) appLog('agent scope is empty: suppressing no windows');
      return agent.bootHide().catch(() => ({ ok: false }));
    };

    // exit, (
    // wheel, ""). 
    const attachAgentEvents = (agent) => {
      agent.on('back', () => { runtime.client().keyBack().catch(() => {}); });
      agent.on('forward', () => { runtime.client().keyForward().catch(() => {}); });
      agent.on('wheel', (m) => {
        if (pointer.pointerOptions(store.getSettings()).wheel === 'smooth') wheelRouter.push(m);
      });
      agent.on('exit', () => {
        const next = new WinAgent();
        winAgent = next;
        appWin.agent = next;
        attachAgentEvents(next);
        // , window
        armAgent(next).catch(() => {});
      });
    };
    attachAgentEvents(winAgent);

    // ""emulator. 
    // " ApkBolt 4 ", emulator
    // qemu window -- . 
    runtime.emulator.onBeforeSpawn = async () => {
      if (!winAgent) return;
      await armAgent(winAgent);
    };
    // window PowerShell resident, cold boot 300~600ms. 
    // , window. 
    winAgent.ensure().then(() => armAgent(winAgent)).catch(() => {});

    registerIpc();
    createWindow({ show: !parseArgs(process.argv).silent });
    buildTray();
    applyAutoStart();

    // check: , launch 25 . 
    // boot adb / disk / snapshot, 
    // (""). 
    scheduleAutodebug();
    setTimeout(() => { runAutodebug().catch(() => {}); }, 25000).unref?.();

    // versioninstallapp orientation (). 
    // "app""orientation", portraitapp
    // landscape.  APK , 
    // directory + AndroidManifest, . 
    try {
      const { parseApk } = require('./core/apk');
      const filled = [];
      for (const app of store.getApps()) {
        if (app.orientation || !app.apkPath) continue;
        if (!fs.existsSync(app.apkPath)) continue;
        try {
          const meta = parseApk(app.apkPath);
          if (meta.orientation) {
            store.upsertApp({ package: app.package, orientation: meta.orientation });
            filled.push(`${app.label}=${meta.orientation}`);
          }
        } catch (_) { /* failureapp, launch */ }
      }
      if (filled.length) appLog(`orientation backfill: ${filled.join(', ')}`);
    } catch (_) { /* ignore */ }

    // disk:  3GB Android(system image/snapshotfailure). 
    // "", . 
    {
      const doctor = require('./core/doctor');
      const freeMB = doctor.freeDiskMB(store.DATA_DIR);
      if (freeMB && freeMB < 3072) {
        appLog(`LOW_DISK free=${freeMB}MB dir=${store.DATA_DIR}`);
        setTimeout(() => {
          notify('Insufficient Disk Space', `Only ${(freeMB / 1024).toFixed(1)} GB remaining. Change runtime directory in Settings or free up disk space.`);
          send('toast', { type: 'error', message: `Only ${(freeMB / 1024).toFixed(1)} GB remaining; Android may fail to boot.` });
        }, 3000).unref?.();
      }
    }

    // versiondesktopshortcut / null: launch, 
    installer.ensureShortcuts().then((fixed) => {
      if (fixed && fixed.length) {
        windowctl.refreshShell().catch(() => {});
        notify('Shortcuts rebuilt successfully', fixed.join(', '));
      }
    }).catch(() => {});

    // F11 / window;  ApkBolt
    try {
      globalShortcut.register('F11', () => { toggleDisplayMode(); });
    } catch (_) { /* ignore */ }
    // rotate: windowwindow,  Ctrl+R , 
    // .  Ctrl+Alt+R Ctrl+R --
    // /"", . 
    try {
      globalShortcut.register('CommandOrControl+Alt+R', () => {
        if (currentAppPkg) rotateCurrentApp().catch(() => {});
      });
    } catch (_) { /* ignore */ }

    const args = parseArgs(process.argv);
    if (args.apk) runInstall(args.apk).catch(() => {});
    else if (args.launch) await runLaunch(args.launch);
    else {
      // launchapp: splash window ready
      if (typeof splashDone === 'function') {
        setTimeout(() => splashDone(), 800);
      }
    }

    // :  WSA / appAndroidresident. 
    // ApkBolt (window), app am start. 
    // "app + runtime", /memory. 
    const prewarmEnabled = store.getSettings().engine.prewarm !== false;
    if (prewarmEnabled && !args.launch && store.getApps().length > 0) {
      // 1.2 window.  4 , app, 
      // """" AVD , . 
      setTimeout(async () => {
        try {
          const env = await runtime.provisioner.checkEnv();
          if (!(env.adb.ok && env.emulator.ok && env.sysimg.ok)) {
            appLog(`prewarm skipped: not ready (adb=${env.adb.ok} emu=${env.emulator.ok} img=${env.sysimg.ok})`);
            return;
          }
          // bootemulatorwindow qemu , 
          // note await:  spawn, . 
          if (winAgent) { try { await armAgent(winAgent); } catch (_) { /* ignore */ } }
          const t0 = Date.now();
          appLog('prewarm start');
          const r = await runtime.prewarm({ onLog: (m) => appLog(`prewarm ${m}`) });
          if (r && r.ok) appLog(`prewarm ready in ${Date.now() - t0}ms`);
          else {
            appLog(`prewarm failed: ${r && (r.error || r.skipped)}`);
            // failureemulatorwindow: , , 
            // "failure"desktopemulator. 
            if (winAgent) armAgent(winAgent).catch(() => {});
          }
        } catch (e) { appLog(`prewarm error: ${e && e.message}`); /* failure */ }
      }, 1200).unref?.();
    } else {
      appLog(`prewarm off (enabled=${prewarmEnabled} launch=${!!args.launch} apps=${store.getApps().length})`);
    }

    // 20 : cold bootdisk/CPU , 
    // downloadextractdesktop. app ensure() . 
    setTimeout(() => {
      autoDeploy().then((r) => {
        if (r && r.ok) send('toast', { type: 'ok', message: 'Runtime auto-preparation complete' });
      }).catch(() => {});
    }, 20000).unref?.();

    // launch 8 version(). versionhint, 
    // download -- update"update". 
    // (MSIX): installdirectory WindowsApps, update
    // , update Microsoft Store . 
    if (app.isPackaged && !store.STORE_BUILD) {
      // issue #98: "downloadextract, /restartupdate". 
      // +restart, --update. 
      // version,  resumable check . 
      let resuming = false;
      try {
        const job = updater.findResumableJob();
        if (job) {
          resuming = true;
          appLog(`resuming pending update ${job.version} from cached payload`);
          send('update:progress', { stage: 'apply', percent: 100, message: 'Completing pending update...' });
          updater.apply(job);
          setTimeout(() => { quitting = true; app.quit(); }, 900);
        }
      } catch (e) { appLog(`resume check failed: ${e.message}`); }
      // version;  return launch. 
      if (!resuming) setTimeout(() => {
        updater.check().then((info) => {
          updateInfo = info;
          send('update:state', info);
          if (info.hasUpdate) {
            appLog(`update available ${info.tag} (current v${app.getVersion()}, asset=${info.asset ? info.asset.name : 'none'})`);
            // : launchapp"", 
            // boot(""). 
          }
        }).catch((e) => appLog(`update check failed: ${e.message}`));
      }, 8000).unref?.();
    }

    // / resident: appwindow
    // ( onContainerActive). 

    // : exit, 
    if (process.argv.includes('--smoke') && mainWindow) {
      const out = process.argv[process.argv.indexOf('--smoke') + 1] || 'smoke.png';
      mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            if (process.argv.includes('--setup')) {
              // runtimesettings: --setup --settings , settings
              await mainWindow.webContents.executeJavaScript(
                "document.getElementById('btnSettings').click(); true;",
              );
              await new Promise((r) => setTimeout(r, 2500));
            }
            if (process.argv.includes('--settings')) {
              const opened = await mainWindow.webContents.executeJavaScript(`
                (async () => {
                  document.getElementById('btnSettings').click();
                  for (let i = 0; i < 50; i++) {
                    await new Promise((r) => setTimeout(r, 100));
                    if (document.getElementById('settingsMask').classList.contains('on')) return true;
                  }
                  return false;
                })()
              `);
              console.log('[smoke] settings opened =', opened);
              await new Promise((r) => setTimeout(r, 600));
              const dbg = await mainWindow.webContents.executeJavaScript(
                "JSON.stringify({ on: document.getElementById('settingsMask').classList.contains('on'), qr: !!document.querySelector('#aboutGroup img'), qrH: (document.querySelector('#aboutGroup img')||{}).naturalHeight, ver: (document.getElementById('aboutVer')||{}).textContent, note: (document.getElementById('setupNote')||{}).textContent })",
              );
              console.log('[smoke] dom =', dbg);
            }
            // window:  +
            const snap = async (file) => {
              mainWindow.webContents.invalidate();
              await mainWindow.webContents.capturePage().catch(() => null);
              await new Promise((r) => setTimeout(r, 400));
              const im = await mainWindow.webContents.capturePage();
              fs.writeFileSync(file, im.toPNG());
              console.log('[smoke] saved', file);
            };
            await snap(out);
            if (process.argv.includes('--perf')) {
              // ""(settings)
              await mainWindow.webContents.executeJavaScript(
                "document.getElementById('perfGroup').scrollIntoView({ block: 'start' }); true;",
              );
              await snap(out.replace(/\.png$/i, '-perf.png'));
            }
            if (process.argv.includes('--download')) {
              // "downloadupdate"
              await mainWindow.webContents.executeJavaScript(
                "document.getElementById('downloadGroup').scrollIntoView({ block: 'start' }); true;",
              );
              await snap(out.replace(/\.png$/i, '-download.png'));
            }
            if (process.argv.includes('--settings')) {
              // "about"( / GitHub / Powered by)
              await mainWindow.webContents.executeJavaScript(
                "document.getElementById('aboutGroup').scrollIntoView({ block: 'center' }); true;",
              );
              await snap(out.replace(/\.png$/i, '-about.png'));
            }
          } catch (e) {
            console.error('[smoke] Screenshot failed', e);
          }
          quitting = true;
          app.quit();
        }, 6500);
      });
    }

    app.on('activate', () => showWindow());
  });

  app.on('window-all-closed', () => {
    // window(close ), 
    // exit, , single instance. 
    // : "appwindow, ApkBolt ", 
    // "window""". 
    appLog(`window-all-closed quitting=${quitting}`);
    if (quitting) app.exit(0);
  });

  // / GPU , Electron defaultwindow, exit; 
  // "", log. 
  app.on('child-process-gone', (_e, d) => {
    try {
      appLog(`child-process-gone type=${d && d.type} reason=${d && d.reason} exit=${d && d.exitCode}`);
    } catch (_) { /* log */ }
  });

  let quitReady = false;
  /**
 * "runtime". 
   *
 * : app → . launch
 * single instance, emulator am start; 
 * dispose(), emulator --
 * log"runtimeexit(code=0)""device 'emulator-5554' not found". 
 * owner.pid launch, launch. 
   */
  const releaseRuntime = () => {
    let mine = true;
    try {
      const owner = Number(String(fs.readFileSync(path.join(store.DATA_DIR, 'owner.pid'), 'utf8')).trim());
      mine = !owner || owner === process.pid;
    } catch (_) { mine = true; }
    if (mine) {
      runtime?.dispose();
    } else {
      appLog('Another instance took over runtime; skipping stop');
    }
  };
  app.on('before-quit', (e) => {
    quitting = true;
    appLog(`before-quit ready=${quitReady}`);
    // exitwindowemulatorwindow" + ". 
    // (),  before-quit , completeexit. 
    // , window, Windows emulatorwindowdesktop--
    // " ApkBolt , desktop Android Emulator ". 
    if (!quitReady) {
      e.preventDefault();
      quitReady = true;
      sharer?.stop();
      notifier?.stop();
      try { appWin?.close({ keepApp: true }); } catch (_) { /* ignore */ }
      const finish = () => {
        try { winAgent?.dispose(); } catch (_) { /* ignore */ }
        try { wheelRouter?.dispose(); } catch (_) { /* ignore */ }
        releaseRuntime();
        // windowwindow,  window-all-closed
        try { if (decodeWindow && !decodeWindow.isDestroyed()) decodeWindow.destroy(); } catch (_) { /* ignore */ }
        app.quit();
      };
      setTimeout(finish, 400);
      return;
    }
    try { winAgent?.dispose(); } catch (_) { /* ignore */ }
    try { wheelRouter?.dispose(); } catch (_) { /* ignore */ }
    releaseRuntime();
    try { if (decodeWindow && !decodeWindow.isDestroyed()) decodeWindow.destroy(); } catch (_) { /* ignore */ }
  });
}
