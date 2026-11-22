'use strict';
/**
 * .apk ( HKCU, )
 * apk → apkstart.exe "%1" → install → desktopshortcut
 */
const { execFileSync } = require('child_process');

const PROGID = 'ApkBolt.apk';
const EXT = '.apk';
const CLASSES = 'HKCU\\Software\\Classes';
// "default", uninstall, 
const STORE_KEY = 'HKCU\\Software\\ApkBolt';
const PREV_VALUE = 'assocPrev';

function reg(args) {
  try {
    execFileSync('reg', args, { windowsHide: true, stdio: 'pipe' });
    return true;
  } catch (_) {
    return false;
  }
}

/** default(REG_SZ),  */
function regDefault(key) {
  try {
    const out = execFileSync('reg', ['query', key, '/ve'], { windowsHide: true, encoding: 'utf8' });
    const line = String(out).split(/\r?\n/).find((l) => /REG_SZ/i.test(l));
    const m = line && /REG_SZ\s+(.*)$/i.exec(line);
    return m ? m[1].trim() : '';
  } catch (_) {
    return '';
  }
}

/** "default" */
function readPrev() {
  try {
    const out = execFileSync('reg', ['query', STORE_KEY, '/v', PREV_VALUE], { windowsHide: true, encoding: 'utf8' });
    const m = /REG_SZ\s+(.*)$/im.exec(String(out));
    return m ? m[1].trim() : '';
  } catch (_) {
    return '';
  }
}

function notifyShell() {
  const ps = `
$sig = '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);';
try {
  $t = Add-Type -MemberDefinition $sig -Name 'ShNotify' -Namespace 'ApkStart' -PassThru -ErrorAction Stop;
  $t::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero);
} catch {}
`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true, stdio: 'pipe', timeout: 8000,
    });
  } catch (_) { /* failure */ }
}

/**
 * @param {string} exePath apkstart path( electron.exe)
 * @param {string} [iconPath] ico
 * @param {string} [extraArgs] appdirectory,  "\"C:\\path\\apkstart\""
 */
function registerAssociation(exePath, iconPath, extraArgs) {
  const icon = iconPath || exePath;
  const command = `"${exePath}" ${extraArgs ? extraArgs + ' ' : ''}"%1"`;

  // .apk default: Android, uninstall ApkStart
  // ,  .apk "default". 
  const prev = regDefault(`${CLASSES}\\${EXT}`);
  if (prev && prev !== PROGID) {
    reg(['add', STORE_KEY, '/v', PREV_VALUE, '/d', prev, '/f']);
  } else if (!prev) {
    try { execFileSync('reg', ['delete', STORE_KEY, '/v', PREV_VALUE, '/f'], { windowsHide: true, stdio: 'pipe' }); } catch (_) { /*  */ }
  }

  reg(['add', `${CLASSES}\\${EXT}`, '/ve', '/d', PROGID, '/f']);
  reg(['add', `${CLASSES}\\${EXT}\\OpenWithProgids`, '/v', PROGID, '/t', 'REG_NONE', '/f']);

  reg(['add', `${CLASSES}\\${PROGID}`, '/ve', '/d', 'Android Application Package', '/f']);
  reg(['add', `${CLASSES}\\${PROGID}`, '/v', 'FriendlyTypeName', '/d', 'Android Application Package', '/f']);
  reg(['add', `${CLASSES}\\${PROGID}\\DefaultIcon`, '/ve', '/d', `"${icon}",0`, '/f']);
  reg(['add', `${CLASSES}\\${PROGID}\\shell\\open`, '/ve', '/d', 'Install with ApkBolt', '/f']);
  reg(['add', `${CLASSES}\\${PROGID}\\shell\\open\\command`, '/ve', '/d', command, '/f']);

  notifyShell();
  return { ok: true, progId: PROGID, previous: prev };
}

/**
 * . 
 * .apk default("", ), 
 * uninstall ApkStart .apk . : 
 * 1) → ; 
 * 2) default → ; 
 * 3) default → . 
 */
function unregisterAssociation() {
  reg(['delete', `${CLASSES}\\${EXT}\\OpenWithProgids`, '/v', PROGID, '/f']);
  reg(['delete', `${CLASSES}\\${PROGID}`, '/f']);

  const prev = readPrev();
  const current = regDefault(`${CLASSES}\\${EXT}`);
  let restored = '';
  if (prev) {
    reg(['add', `${CLASSES}\\${EXT}`, '/ve', '/d', prev, '/f']);
    restored = prev;
  } else if (current === PROGID) {
    reg(['add', `${CLASSES}\\${EXT}`, '/ve', '/d', '', '/f']);
  }
  try { execFileSync('reg', ['delete', STORE_KEY, '/v', PREV_VALUE, '/f'], { windowsHide: true, stdio: 'pipe' }); } catch (_) { /* ignore */ }
  notifyShell();
  return { ok: true, restored };
}

module.exports = { registerAssociation, unregisterAssociation, PROGID };
