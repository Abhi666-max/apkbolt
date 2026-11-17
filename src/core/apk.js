'use strict';
/**
 * APK ： / version / app / launch Activity / / ABI
 * complete， aapt、 adb、。
 */
const fs = require('fs');
const { ZipFile } = require('./zip');
const { parseAxml, attr, attrValue, children } = require('./axml');
const { ResTable } = require('./arsc');
const { validPackageName } = require('./pkgname');

const LAUNCHER_ACTIONS = ['android.intent.action.MAIN'];
const LAUNCHER_CATS = ['android.intent.category.LAUNCHER'];

function isLauncherActivity(node) {
  const filters = children(node, 'intent-filter');
  for (const f of filters) {
    const actions = children(f, 'action').map((a) => attrValue(a, 'name'));
    const cats = children(f, 'category').map((c) => attrValue(c, 'name'));
    const hasMain = actions.some((a) => LAUNCHER_ACTIONS.includes(a));
    const hasLauncher = cats.some((c) => LAUNCHER_CATS.includes(c));
    if (hasMain && hasLauncher) return true;
  }
  return false;
}

function pickIconFromZip(zip) {
  // fallback： res/ 、（png / webp / jpg ）
  const candidates = zip.names().filter((n) => /^res\/.*\.(png|webp|jpe?g)$/i.test(n));
  const scored = candidates.map((n) => {
    const e = zip.entries.get(n);
    let s = e.uncompSize;
    if (/ic_launcher|app_icon|ic_app/i.test(n)) s *= 6;
    if (/_round|_foreground|_background/i.test(n)) s *= 0.4;
    if (/xxxhdpi/i.test(n)) s *= 1.6;
    else if (/xxhdpi/i.test(n)) s *= 1.4;
    else if (/xhdpi/i.test(n)) s *= 1.2;
    if (/\//.test(n.split('/')[1] || '')) { /* noop */ }
    return { n, s };
  }).sort((a, b) => b.s - a.s);
  for (const c of scored.slice(0, 30)) {
    try {
      const data = zip.read(c.n);
      if (data && data.length > 100) return { data, file: c.n };
    } catch (_) { /* ignore */ }
  }
  return null;
}

const IMG_RE = /\.(png|webp|jpe?g)$/i;

// ---- orientation ----
// AndroidManifest android:screenOrientation ：
//   0 unspecified / 1 portrait / 2 landscape / 3 sensor / 4 sensorLandscape
//   5 sensorPortrait / 6 reverseLandscape / 7 reversePortrait / 8 behind
//   9 nosensor / 10 user / 11 fullSensor / 12 userLandscape / 13 userPortrait
//   14 fullUser / 15 locked
// 「orientation」；sensor / fullSensor / user / unspecified
// ，runtime，，app
// 「orientation」。
const ORI_PORTRAIT = new Set([1, 5, 7, 13]);
const ORI_LANDSCAPE = new Set([2, 4, 6, 12]);

/**
 * app「」portraitlandscape。
 *
 * ：emulator（hw.lcd）orientationapp
 * screenOrientation ，Android app（letterbox）
 * —— ， wm size / density / letterbox-style 
 * （， docs）。window，
 * orientationapp。installorientation apps.json，
 * launch，。
 *
 * ：orientation Activity （launch Activity ，
 * ）。「 portrait + sensor」
 * portrait； Activity landscape landscape。
 *
 * @returns {'portrait'|'landscape'|null} null = ，settings
 */
function detectOrientation(acts, launcher) {
  let portrait = 0;
  let landscape = 0;
  for (const a of acts) {
    const raw = attrValue(a, 'screenOrientation');
    const v = typeof raw === 'number' ? raw : Number(raw);
    const weight = a === launcher ? 4 : 1;
    if (ORI_PORTRAIT.has(v)) portrait += weight;
    else if (ORI_LANDSCAPE.has(v)) landscape += weight;
  }
  if (portrait === 0 && landscape === 0) return null;
  if (portrait === landscape) return null;
  return portrait > landscape ? 'portrait' : 'landscape';
}

/** drawable / src ， APK path */
function drawableFileOf(node, res) {
  for (const name of ['drawable', 'src']) {
    const a = attr(node, name);
    if (!a) continue;
    if (a.refId && res) {
      const f = res.resolve(a.refId, 'file');
      if (f) return f;
    } else if (typeof a.typed === 'string') {
      return a.typed;
    }
  }
  return null;
}

/**
 * XML 。、XML 3 ：
 * `<adaptive-icon><foreground><inset><drawable/></inset></foreground>`，
 * `<layer-list><item><bitmap android:src="@drawable/x"/></item></layer-list>`，
 * 「」。
 */
function iconFromNode(zip, node, res, depth = 0) {
  const file = drawableFileOf(node, res);
  if (file) {
    if (IMG_RE.test(file) && zip.has(file)) {
      const data = zip.read(file);
      if (data && data.length > 100) return { data, file };
    }
    if (/\.xml$/i.test(file) && depth < 3 && zip.has(file)) {
      const inner = iconFromXml(zip, zip.read(file), res, depth + 1);
      if (inner) return inner;
    }
  }
  for (const c of node.children || []) {
    const hit = iconFromNode(zip, c, res, depth);
    if (hit) return hit;
  }
  return null;
}

/** / layer-list XML / */
function iconFromXml(zip, xmlBuffer, res, depth = 0) {
  let root;
  try {
    root = parseAxml(xmlBuffer);
  } catch (_) {
    return null;
  }
  // foreground → background → monochrome
  for (const key of ['foreground', 'background', 'monochrome']) {
    const node = root.children.find((c) => c.name === key) || (root.name === key ? root : null);
    if (!node) continue;
    const hit = iconFromNode(zip, node, res, depth);
    if (hit) return hit;
  }
  // （layer-list / bitmap / inset ）
  return iconFromNode(zip, root, res, depth);
}

/**
 * APK 。
 * ZIP （directory + ），** APK memory**：
 * fs.readFileSync 2GB installfailure（Node Buffer ），
 * memory OOM 。
 */
function parseApk(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size < 1024) throw new Error('File too small to be a valid APK');
  const zip = new ZipFile(filePath);
  try {
    return parseApkZip(zip, filePath, stat);
  } finally {
    zip.close();
  }
}

/** parseApk ： zip */
function parseApkZip(zip, filePath, stat) {
  if (!zip.has('AndroidManifest.xml')) {
    throw new Error('Missing AndroidManifest.xml: This is not a single APK (may be a .apks/.xapk split package)');
  }

  const manifestBuf = zip.read('AndroidManifest.xml');
  const manifest = parseAxml(manifestBuf);

  // package manifest **space**（ns=''），「space」：
  // attrValue default android space， null space。
  const packageName = attrValue(manifest, 'package', null);
  if (!packageName) throw new Error('No package name found in manifest');
  // package path adb shell， Android 。
  // / "../"、 shell （issue #2 P0-1）。
  if (!validPackageName(packageName)) {
    throw new Error(`Invalid package name in manifest: ${JSON.stringify(String(packageName).slice(0, 80))}`);
  }

  const versionName = attrValue(manifest, 'versionName') || '1.0';
  const versionCodeRaw = attrValue(manifest, 'versionCode');
  const versionCode = typeof versionCodeRaw === 'number' ? versionCodeRaw : 0;

  const usesSdk = children(manifest, 'uses-sdk')[0];
  const minSdk = usesSdk ? (attrValue(usesSdk, 'minSdkVersion') | 0) : 0;
  const targetSdk = usesSdk ? (attrValue(usesSdk, 'targetSdkVersion') | 0) : 0;

  const app = children(manifest, 'application')[0] || { children: [], attrs: [] };

  // ---- （ @0x7f ）----
  let res = null;
  if (zip.has('resources.arsc')) {
    try { res = new ResTable(zip.read('resources.arsc')); } catch (_) { res = null; }
  }

  // ---- app ----
  let label = null;
  const labelAttr = attr(app, 'label');
  if (labelAttr) {
    if (labelAttr.refId && res) label = res.resolve(labelAttr.refId, 'string');
    else if (typeof labelAttr.typed === 'string') label = labelAttr.typed;
  }
  if (!label || typeof label !== 'string') {
    label = packageName.split('.').pop();
    label = label.charAt(0).toUpperCase() + label.slice(1);
  }

  // ---- launch Activity ----
  let launchActivity = null;
  const acts = children(app, 'activity').concat(children(app, 'activity-alias'));
  const launcher = acts.find(isLauncherActivity);
  if (launcher) {
    const n = attrValue(launcher, 'name');
    const target = attrValue(launcher, 'targetActivity');
    if (n) {
      if (n.startsWith('.')) launchActivity = packageName + n;
      else if (!n.includes('.')) launchActivity = `${packageName}.${n}`;
      else launchActivity = n;
      if (launcher.name === 'activity-alias' && target) {
        launchActivity = target.startsWith('.') ? packageName + target : target;
      }
    }
  }

  // ---- orientation（emulatorlandscapeportrait， detectOrientation）----
  const orientation = detectOrientation(acts, launcher);

  // ---- ----
  let icon = null;
  const iconAttr = attr(app, 'icon') || attr(app, 'roundIcon');
  if (iconAttr) {
    let file = null;
    if (iconAttr.refId && res) file = res.resolve(iconAttr.refId, 'file');
    else if (typeof iconAttr.typed === 'string') file = iconAttr.typed;

    if (file && zip.has(file)) {
      if (/\.xml$/i.test(file)) {
        icon = iconFromXml(zip, zip.read(file), res);
      } else {
        icon = { data: zip.read(file), file };
      }
    }
  }
  if (!icon) icon = pickIconFromZip(zip);

  // ---- ABI（ x86 runtime ARM ）----
  const abis = [...new Set(zip.names()
    .filter((n) => n.startsWith('lib/'))
    .map((n) => n.split('/')[1])
    .filter(Boolean))];

  return {
    ok: true,
    filePath,
    sizeBytes: stat.size,
    package: packageName,
    label: String(label).replace(/\s+/g, ' ').trim().slice(0, 60),
    versionName: String(versionName),
    versionCode,
    minSdk,
    targetSdk,
    launchActivity,
    abis,
    orientation,
    iconPng: icon ? icon.data : null,
    iconFile: icon ? icon.file : null,
  };
}

/** verify： PK\x03\x04 */
function quickCheck(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    fs.closeSync(fd);
    return b[0] === 0x50 && b[1] === 0x4b;
  } catch (_) {
    return false;
  }
}

module.exports = { parseApk, quickCheck, detectOrientation };
