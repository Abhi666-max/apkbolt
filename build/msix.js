'use strict';
/**
 * （MSIX）。
 *
 * electron-builder appx ：
 * - 26.x appx（ msix），download Windows SDK
 * （windows-kits-bundle-10_0_26100_0.zip）；
 * - （runFullTrust、、
 * ），。
 * stage + makeappx， Windows SDK exe。
 *
 * ：
 * node build/msix.js # dist/release/win-unpacked signature
 * node build/msix.js --stage <dir> # directory
 * node build/msix.js --sign # certificatesignature（）
 * node build/msix.js --identity Name --publisher "CN=..." --display 
 *
 * ：APKSTART_MSIX_IDENTITY / APKSTART_MSIX_PUBLISHER / APKSTART_MSIX_DISPLAY
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { encodePng, drawAppIcon } = require('../src/core/png');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

// ---------------- parameters ----------------

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const VERSION = String(pkg.version || '0.0.0');
// MSIX Version ， 0（Store ）
function msixVersion(v) {
  const p = String(v).split(/[.\-+]/).filter((x) => /^\d+$/.test(x)).slice(0, 3);
  while (p.length < 3) p.push('0');
  return `${p[0]}.${p[1]}.${p[2]}.0`;
}

// Partner Center → Product management → Product identity 。
// default：default `CN=AbhijeetKangane`，
// `node build/msix.js` 。
const PLACEHOLDER_PUBLISHER = 'CN=AbhijeetKangane';
const CONFIRMED_IDENTITY = 'AbhijeetKangane.ApkBolt';
const CONFIRMED_PUBLISHER = 'CN=58CA1DED-8AB3-4D0D-AF50-62C9B781AA4D';
const IDENTITY = arg('identity') || process.env.APKSTART_MSIX_IDENTITY || CONFIRMED_IDENTITY;
const PUBLISHER = arg('publisher') || process.env.APKSTART_MSIX_PUBLISHER || CONFIRMED_PUBLISHER;
const PUBLISHER_DISPLAY = arg('publisherDisplay') || process.env.APKSTART_MSIX_PUBLISHER_DISPLAY || 'Abhijeet Kangane';
const DISPLAY = arg('display') || process.env.APKSTART_MSIX_DISPLAY || 'ApkBolt';
const APP_ID = arg('appId') || 'ApkBolt';
const DO_SIGN = !!arg('sign', false);

const STAGE = path.resolve(String(arg('stage')
  || path.join(ROOT, 'dist', 'release', 'win-unpacked')));
const OUT_DIR = path.resolve(String(arg('out') || path.join(ROOT, 'dist', 'store')));

/**
 * 「directory」： MSIX `app\` ApkBolt.exe + resources。
 *
 * ，：
 * A. dist/ApkBolt-win64-portable —— `node build/pack.js` ，****。
 * ，runtime， build/runtime 
 * resources/runtime（ electron-builder extraResources ）。
 * B. dist/release/win-unpacked —— `electron-builder --win dir` ，
 * resources/runtime。 CDN ，
 * （ electron.exe、runtime ），。
 *
 * --payload 。
 */
function resolvePayload() {
  const explicit = arg('payload');
  if (explicit) return { dir: path.resolve(String(explicit)), addRuntime: false };
  const portable = path.join(ROOT, 'dist', 'ApkBolt-win64-portable');
  const runtime = path.join(ROOT, 'build', 'runtime');
  if (fs.existsSync(path.join(portable, 'ApkBolt.exe'))) {
    const hasRuntime = fs.existsSync(path.join(portable, 'resources', 'runtime', 'emulator', 'emulator.exe'));
    return { dir: portable, addRuntime: !hasRuntime && fs.existsSync(runtime), runtime };
  }
  return { dir: STAGE, addRuntime: false };
}

// ---------------- ----------------
// 100% 5 。directory .scale-* / .targetsize-*
// ， resources.pri（makepri）， —— 。
const ASSETS = [
  { file: 'StoreLogo.png', w: 50, h: 50 },
  { file: 'Square44x44Logo.png', w: 44, h: 44 },
  { file: 'Square71x71Logo.png', w: 71, h: 71 },
  { file: 'Square150x150Logo.png', w: 150, h: 150 },
  { file: 'Square310x310Logo.png', w: 310, h: 310 },
  { file: 'Wide310x150Logo.png', w: 310, h: 150 },
  { file: 'SplashScreen.png', w: 620, h: 300 },
];

const BG = [20, 22, 27];        // #14161b
const ACCENT = [61, 220, 132];  // #3ddc84 Android

/** （） */
function inRoundRect(px, py, x, y, w, h, r) {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** w×h side （ + ） */
function composeIcon(w, h, side) {
  const rgba = new Uint8Array(w * h * 4);
  const ox = (w - side) / 2;
  const oy = (h - side) / 2;
  const pad = side * 0.06;
  const box = { x: ox + pad, y: oy + pad, w: side - pad * 2, h: side - pad * 2, r: side * 0.24 };
  const tW = side * 0.30;
  const tH = side * 0.34;
  const tcx = ox + side * 0.5 + side * 0.02;
  const tcy = oy + side * 0.5;
  const ax = tcx - tW * 0.38;
  const ay = tcy - tH / 2;
  const bx = tcx - tW * 0.38;
  const by = tcy + tH / 2;
  const cx2 = tcx + tW * 0.62;
  const cy2 = tcy;
  const inTri = (px, py) => {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx2) * (by - cy2) - (bx - cx2) * (py - cy2);
    const d3 = (px - ax) * (cy2 - ay) - (cx2 - ax) * (py - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // ：（/launch）
      let r = BG[0];
      let g = BG[1];
      let b = BG[2];
      let a = 255;
      const px = x + 0.5;
      const py = y + 0.5;
      if (inRoundRect(px, py, box.x, box.y, box.w, box.h, box.r)) {
        const t = (x / w) * 0.6 + (y / h) * 0.4;
        r = Math.round(20 + t * 14);
        g = Math.round(26 + t * 18);
        b = Math.round(33 + t * 24);
        if (inTri(px, py)) { r = ACCENT[0]; g = ACCENT[1]; b = ACCENT[2]; }
      }
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
    }
  }
  return encodePng(w, h, rgba);
}

/** ：build/build-icons.js */
const STORE_ASSETS = path.join(ROOT, 'build', 'store-assets');

function writeAssets(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const made = [];
  for (const a of ASSETS) {
    const pre = path.join(STORE_ASSETS, a.file);
    let buf = null;
    if (fs.existsSync(pre)) {
      buf = fs.readFileSync(pre);
    } else {
      // ： build-icons ，
      buf = (a.w === a.h)
        ? drawAppIcon(a.w)
        : composeIcon(a.w, a.h, Math.min(a.h * 0.72, a.w * 0.42));
      console.warn(`  [] ${a.file}  build/store-assets ，`);
    }
    fs.writeFileSync(path.join(dir, a.file), buf);
    made.push(`${a.file} ${a.w}x${a.h}`);
  }
  return made;
}

// ---------------- ----------------

function manifest() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!--
  ApkBolt · Microsoft Store (MSIX) 
   build/msix.js ，； build/msix.js。

   Partner Center ：
    Identity/@Name          ← Product identity → Package/Identity/Name
    Identity/@Publisher     ← Product identity → Package/Identity/Publisher
  ，Publisher  Subject。
-->
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">

  <Identity
    Name="${IDENTITY}"
    Publisher="${PUBLISHER}"
    Version="${msixVersion(VERSION)}"
    ProcessorArchitecture="x64" />

  <Properties>
    <DisplayName>${DISPLAY}</DisplayName>
    <PublisherDisplayName>${PUBLISHER_DISPLAY}</PublisherDisplayName>
    <Description>${pkg.description || DISPLAY}</Description>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>

  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.22621.0" />
  </Dependencies>

  <Resources>
    <Resource Language="zh-CN" />
    <Resource Language="en-US" />
  </Resources>

  <Capabilities>
    <!-- （Desktop Bridge）。 -->
    <rescap:Capability Name="runFullTrust" />
    <!--
       unvirtualizedResources / broadFileSystemAccess：
       PC ，Store ；
      AppContainer ，full-trust 。
       AppData ， %USERPROFILE%\\ApkBolt，
      （ src/core/store.js  STORE_BUILD）。
    -->
  </Capabilities>

  <Applications>
    <Application Id="${APP_ID}" Executable="app\\ApkBolt.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="${DISPLAY}"
        Description="${pkg.description || DISPLAY}"
        BackgroundColor="#14161B"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        Square44x44Logo="Assets\\Square44x44Logo.png">
        <!--
          / logo  uap:DefaultTile ，
          uap:VisualElements  ——  MakeAppx ：
          "?? DTD/??????? 'VisualElements' ??? 'Square71x71Logo'?"
          （0x80080204 The package manifest is not valid）
        -->
        <uap:DefaultTile Wide310x150Logo="Assets\\Wide310x150Logo.png"
          Square71x71Logo="Assets\\Square71x71Logo.png"
          Square310x310Logo="Assets\\Square310x310Logo.png" />
        <uap:SplashScreen Image="Assets\\SplashScreen.png" BackgroundColor="#14161B" />
      </uap:VisualElements>
    </Application>
  </Applications>
</Package>
`;
}

// ---------------- makeappx / signtool ----------------

function which(exe) {
  const cands = [];
  const push = (p) => { if (p) cands.push(p); };
  // 1) PATH
  const envPath = process.env.PATH || '';
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, exe);
    try { if (fs.statSync(p).isFile()) push(p); } catch (_) { /* next */ }
  }
  // 2) Windows SDK（10.0.x version， x64）
  const kits = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Windows Kits', '10', 'bin'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'App Certification Kit'),
  ];
  for (const k of kits) {
    let versions = [];
    try { versions = fs.readdirSync(k); } catch (_) { continue; }
    for (const v of versions) {
      for (const arch of ['x64', 'x86', '']) {
        const p = arch ? path.join(k, v, arch, exe) : path.join(k, v, exe);
        try { if (fs.statSync(p).isFile()) push(p); } catch (_) { /* next */ }
      }
    }
  }
  // 3) electron-builder downloadcache（ --win appx ）
  const cacheRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');
  const stack = [cacheRoot];
  let guard = 0;
  while (stack.length && guard < 6000) {
    const dir = stack.pop();
    guard += 1;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.toLowerCase() === exe.toLowerCase()) push(p);
    }
  }
  if (!cands.length) return null;

  /**
 * 。
   *
 * ：winCodeSign windows-6 / windows-8 /
 * windows-10 signtool.exe。windows-6 MSIX 
 * `0x80080209 (SignerSign failed)` —— MSIX SIP 。
 * windows-10\x64，「」。
   */
  const score = (p) => {
    const l = p.toLowerCase();
    let s = 0;
    if (/\\windows-10\\x64\\/.test(l)) s += 100;
    else if (/\\windows-10\\/.test(l)) s += 60;
    if (/\\windows-1[01]\\x64\\/.test(l)) s += 40;
    if (/\\x64\\/.test(l)) s += 10;
    if (/\\windows-6\\|\\windows-8\\|\\darwin\\|\\linux\\/.test(l)) s -= 200;
    return s;
  };
  cands.sort((a, b) => (score(b) - score(a)) || b.localeCompare(a, 'en'));
  return cands[0];
}

function run(exe, args, opts = {}) {
  return execFileSync(exe, args, { stdio: 'inherit', windowsHide: true, ...opts });
}

// ：MSIX MuMu emulator（runtime）
const { assertStandalone } = require('./guard-standalone');

// ---------------- ----------------

function stagePackage() {
  const pick = resolvePayload();
  const appSrc = pick.dir;
  if (!fs.existsSync(path.join(appSrc, 'ApkBolt.exe'))) {
    console.error(`\n ${path.join(appSrc, 'ApkBolt.exe')}。`);
    console.error('：');
    console.error('  A) node build/pack.js          （，； build/runtime ）');
    console.error('  B) npx electron-builder --win dir --x64 --config electron-builder.yml');
    console.error('     ——  CDN ，， Win-unpacked 。\n');
    process.exit(1);
  }
  const work = path.join(OUT_DIR, '.stage');
  fs.rmSync(work, { recursive: true, force: true });
  const appDir = path.join(work, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  console.log(`（ ${appSrc}）…`);
  fs.cpSync(appSrc, appDir, { recursive: true });
  // Electron/electron-builder ，
  for (const junk of ['builder-debug.yml', 'builder-effective-config.yaml', '.icon-ico', 'VERSION.txt']) {
    fs.rmSync(path.join(appDir, junk), { force: true, recursive: true });
  }
  // portable versionruntime： build/runtime （ electron-builder extraResources）
  if (pick.addRuntime) {
    console.log(` ${pick.runtime} → app/resources/runtime（ 1 GB，）…`);
    fs.cpSync(pick.runtime, path.join(appDir, 'resources', 'runtime'), { recursive: true });
  }
  const rtExe = path.join(appDir, 'resources', 'runtime', 'emulator', 'emulator.exe');
  if (!fs.existsSync(rtExe)) {
    console.error(`\n：${rtExe}  —— 。`);
    console.error(' node build/prepare-runtime.js  build/runtime。\n');
  } else {
    console.log('（emulator / platform-tools / system-images）');
  }
  // ：runtime、，emulator
  assertStandalone(appDir, { label: 'MSIX  app/' });
  console.log('…');
  const made = writeAssets(path.join(work, 'Assets'));
  for (const m of made) console.log(`  ${m}`);
  fs.writeFileSync(path.join(work, 'AppxManifest.xml'), manifest(), 'utf8');
  console.log(`：Identity=${IDENTITY} Publisher=${PUBLISHER} Version=${msixVersion(VERSION)}`);
  return work;
}

function main() {
  console.log(`ApkBolt MSIX    ${VERSION} → ${msixVersion(VERSION)}`);
  // ： Publisher （0x800B0109 / ）。
  // —— default，。
  if (!String(PUBLISHER).toUpperCase().includes('58CA1DED') && !process.argv.includes('--allow-placeholder')) {
    console.error(`\nPublisher  Partner Center ：${PUBLISHER}`);
    console.error(` ${CONFIRMED_PUBLISHER}（Identity ${CONFIRMED_IDENTITY}）。`);
    console.error(' Publisher 。');
    console.error('（，） --allow-placeholder。\n');
    process.exit(3);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const work = stagePackage();

  const makeappx = which('makeappx.exe');
  if (!makeappx) {
    console.error('\n makeappx.exe。：');
    console.error('  A.  Windows SDK（ Windows SDK ， Visual Studio）：');
    console.error('     https://developer.microsoft.com/windows/downloads/windows-sdk/');
    console.error('  B.  npx electron-builder --win appx， windows-kits-bundle ，');
    console.error('      electron-builder 。');
    console.error(`\nstage ，：\n  "${'<makeappx.exe>'}" pack /d "${work}" /p "${path.join(OUT_DIR, artifactName())}" /o\n`);
    process.exit(2);
  }
  const out = path.join(OUT_DIR, artifactName());
  console.log(`\n ${makeappx} …`);
  // makeappx /o overwrite； fs.rmSync 。
  // rmSync reclaim shim，1.5GB ETIMEDOUT，
  // （0.6.2 ）。
  run(makeappx, ['pack', '/d', work, '/p', out, '/o', '/v']);

  const mb = fs.statSync(out).size / 1048576;
  console.log(`\n：${out}  (${mb.toFixed(0)} MB)`);

  // .NET ZipFile ： + +
  try {
    const { execFileSync: ex } = require('child_process');
    const ps = [
      '-NoProfile', '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem;`
      + `$z=[IO.Compression.ZipFile]::OpenRead('${out.replace(/'/g, "''")}');`
      + `$n=$z.Entries | ForEach-Object { $_.FullName }; $z.Dispose();`
      + `foreach($k in @('AppxManifest.xml','AppxBlockMap.xml','[Content_Types].xml')){`
      + ` if($n -contains $k){ "OK   $k" } else { "MISS $k" } }`
      + `"entries: " + $n.Count`,
    ];
    ex('powershell.exe', ps, { stdio: 'inherit', windowsHide: true });
  } catch (_) { /* failure */ }

  if (DO_SIGN) sign(out);
  else {
    console.log('\n（Store ，）。');
    console.log(' --sign 。');
  }
  // stage 1.3 GB ，「」，
  // success（ --keep-stage）。
  if (!process.argv.includes('--keep-stage')) {
    try {
      fs.rmSync(work, { recursive: true, force: true });
      console.log(' dist/store/.stage');
    } catch (_) { /* ， */ }
  }
  console.log(`\n docs/store-msix.md。`);
}

function artifactName() {
  return `ApkBolt_${msixVersion(VERSION)}_x64.msix`;
}

function sign(file) {
  const signtool = which('signtool.exe');
  if (!signtool) {
    console.error('\n signtool.exe，。');
    return;
  }
  const pfx = path.join(OUT_DIR, 'ApkBolt-test.pfx');
  const pwd = process.env.APKSTART_MSIX_PFX_PASSWORD || 'ApkBolt!test';
  const subject = PUBLISHER;   // Publisher
  if (!fs.existsSync(pfx)) {
    console.log(`\n（Subject=${subject}）…`);
    const ps = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `$c = New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature`
      + ` -CertStoreLocation 'Cert:\\CurrentUser\\My'`
      + ` -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}')`
      + ` -Subject '${subject}' -FriendlyName 'ApkBolt MSIX Test';`
      + `$p = ConvertTo-SecureString -String '${pwd}' -Force -AsPlainText;`
      + `Export-PfxCertificate -Cert ("Cert:\\CurrentUser\\My\\" + $c.Thumbprint) -FilePath '${pfx}' -Password $p | Out-Null;`
      + `"thumbprint=" + $c.Thumbprint`,
    ];
    try { run('powershell.exe', ps); } catch (e) { console.error(`：${e.message}`); return; }
  }
  console.log('…');
  try {
    run(signtool, ['sign', '/a', '/v', '/fd', 'SHA256', '/f', pfx, '/p', pwd, file]);
  } catch (e) {
    console.error(`：${e.message}`);
    console.error('\n：electron-builder  winCodeSign ，');
    console.error(' signtool.exe  MSIX 「A required function is not present」');
    console.error('（ MSIX  SIP ）。， Windows SDK  signtool：');
    console.error('  "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\signtool.exe" \\');
    console.error(`    sign /fd SHA256 /a /f "${pfx}" /p "${pwd}" "${file}"`);
    console.error('\n****：Microsoft Store 。');
    return;
  }
  console.log('\n（ PowerShell ， Add-AppxPackage）：');
  console.log(`  Import-PfxCertificate -CertStoreLocation 'Cert:\\LocalMachine\\TrustedPeople' -FilePath '${pfx}' -Password (ConvertTo-SecureString '${pwd}' -Force -AsPlainText)`);
  console.log(`  Add-AppxPackage -Path '${file}'`);
}

if (require.main === module) main();

module.exports = { msixVersion, manifest, composeIcon, which, ASSETS };
