'use strict';
/**
 * app()
 *
 * ApkBolt QEMU ,  WSA / " App
 * "--Linux , zygote, system_server . 
 * ""resident, : 
 * 1. App Android( 40~142 , CPU/disk); 
 * 2. App memory, network, ; 
 * 3. App , qemu Normal desktop CPU; 
 * 4. ,  App . 
 *
 * , : 
 * - , " App"= am start + window( Runtime.beginApp ); 
 * - App App , ; 
 * - App Android idle, , qemu ; 
 * - default( GMS / App ), 
 * "". 
 *
 * adb / Electron, , . 
 */

/** : black screenapp */
const NEVER_TRIM = [
  'android',
  'com.android.systemui',
  'com.android.settings',
  'com.android.inputmethod.latin',
  'com.google.android.inputmethod.latin',
  'com.android.webview',
  'com.google.android.webview',
  'com.google.android.gms',
  'com.google.android.gsf',
  'com.android.providers.settings',
  'com.android.server.telecom',
];

/** "": update//,  App */
const OPTIONAL_SYSTEM = [
  'com.android.vending',                    // Play (update)
  'com.google.android.setupwizard',         // settings
  'com.android.printspooler',               // 
  'com.android.wallpapercropper',
  'com.android.dreams.basic',               // 
  'com.android.providers.calendar',
  'com.android.providers.contacts',
  'com.android.managedprovisioning',
  'com.android.statementservice',
  'com.android.backupconfirm',
];

/** /: ,  */
const SYSTEM_PREFIXES = [
  'android', 'com.android.', 'com.google.android.',
  'com.qualcomm.', 'com.qti.', 'vendor.', 'com.mediatek.',
];

/** Android shell ,  */
const SAFE_PKG = /^[A-Za-z][A-Za-z0-9_.]+$/;

function isSystemPackage(pkg) {
  const p = String(pkg || '').trim();
  if (!p) return true;
  if (!SAFE_PKG.test(p)) return true;
  return SYSTEM_PREFIXES.some((pre) => p === pre || p.startsWith(pre));
}

/**
 * launch App . 
 * @param {object} o
 * @param {string} o.pkg 
 * @param {string[]} o.installed App (store )
 * @param {boolean} o.deep (), default false
 * @param {boolean} o.killBackground cache, default false
 * (launch App, clean endApp )
 * @returns {{commands:string[], stopped:string[], disabled:string[], kept:string[]}}
 */
function buildSessionCommands({
  pkg, installed = [], deep = false, killBackground = false,
} = {}) {
  const target = SAFE_PKG.test(String(pkg || '').trim()) ? String(pkg).trim() : '';
  const commands = [];
  const stopped = [];
  const disabled = [];
  const kept = [];

  for (const raw of installed) {
    const p = String(raw || '').trim();
    if (!p || p === target || isSystemPackage(p) || NEVER_TRIM.includes(p)) {
      if (p) kept.push(p);
      continue;
    }
    stopped.push(p);
    commands.push(`am force-stop ${p}`);
  }

  // cache(,  persistent ), 
  // " App" force-stop , memory. 
  if (killBackground) commands.push('am kill-all 2>/dev/null || true');

  if (deep) {
    for (const p of OPTIONAL_SYSTEM) {
      if (NEVER_TRIM.includes(p)) continue;
      disabled.push(p);
      commands.push(`pm disable-user --user 0 ${p} 2>/dev/null || true`);
    }
    // network, /
    commands.push('settings put global restricted_background_data 1 2>/dev/null || true');
  }

  return { commands, stopped, disabled, kept };
}

/**
 * App "". 
 * shutdown,  AVD: ,  CPU/memory Windows. 
 */
function buildIdleCommands({ deep = false } = {}) {
  const commands = [
    'am kill-all 2>/dev/null || true',
    'dumpsys deviceidle force-idle 2>/dev/null || true',
  ];
  if (deep) commands.push('settings put global restricted_background_data 1 2>/dev/null || true');
  return commands;
}

/** (, ) */
function buildRestoreCommands() {
  return [
    ...OPTIONAL_SYSTEM.map((p) => `pm enable ${p} 2>/dev/null || true`),
    'settings put global restricted_background_data 0 2>/dev/null || true',
  ];
}

/**
 * :  launch/close . 
 * , "window""window". 
 */
function nextSessionState(active, event, pkg) {
  const set = new Set(active || []);
  if (event === 'open') set.add(pkg);
  else if (event === 'close') set.delete(pkg);
  return {
    active: [...set],
    hasApp: set.size > 0,
    foreground: event === 'open' ? pkg : (set.size ? [...set][set.size - 1] : null),
    idle: set.size === 0,
  };
}

/** log/diagnose */
function describeSession(state, plan) {
  const n = state.active.length;
  if (!n) return 'Container idle (Android backgrounded with reduced priority, 0 app processes)';
  return `Container active: ${n} app window(s)${plan && plan.stopped && plan.stopped.length ? `, stopped ${plan.stopped.length} background app(s)` : ''}`;
}

/**
 * window(B ). 
 *
 * window nextSessionState :  active app, 
 * """". appmemory, : 
 * - foreground: window, ; 
 * - background: ""window,  force-stop(), 
 * launch, , /. 
 *
 * @param {string[]} active app
 * @param {string} foreground ( null)
 * @returns {{foreground:string|null, background:string[], count:number}}
 */
function sessionRoles(active = [], foreground = null) {
  const set = (active || []).filter(Boolean);
  const fg = foreground && set.includes(foreground) ? foreground : (set.length ? set[set.length - 1] : null);
  return {
    foreground: fg,
    background: set.filter((p) => p !== fg),
    count: set.length,
  };
}

/**
 * app(force-stop reclaimmemory). 
 *
 * (, ): 
 * - background,  foreground; 
 * - / NEVER_TRIM ; 
 * - N (default 1), ; 
 * - tombstoneLimit<=0 "", (memory). 
 *
 * @param {object} o { background, installedSystem?, keepRecent?, tombstone? }
 * @returns {{tombstone:string[], keep:string[]}}
 */
function planTombstones({ background = [], keepRecent = 1 } = {}) {
  const bg = (background || []).filter((p) => p && !isSystemPackage(p) && !NEVER_TRIM.includes(p));
  // background ,  keepRecent , 
  const keepCount = Math.max(0, Number(keepRecent) || 0);
  const keep = bg.slice(Math.max(0, bg.length - keepCount));
  const tombstone = bg.filter((p) => !keep.includes(p));
  return { tombstone, keep };
}

/** : force-stop , reclaimmemory/ */
function buildTombstoneCommands(pkgs = []) {
  return pkgs.filter((p) => SAFE_PKG.test(String(p))).map((p) => `am force-stop ${p}`);
}

module.exports = {
  NEVER_TRIM, OPTIONAL_SYSTEM, SYSTEM_PREFIXES,
  isSystemPackage, buildSessionCommands, buildIdleCommands,
  buildRestoreCommands, nextSessionState, describeSession,
  sessionRoles, planTombstones, buildTombstoneCommands,
};
