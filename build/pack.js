'use strict';
/**
 * portable version:  dist/ApkBolt-win64-portable/
 * ApkBolt.exe(electron.exe + /version)+ resources/app(app)
 * install, extract. 
 *
 * --full( APKSTART_PACK_FULL=1)"": 
 * build/runtime resources/runtime, extract, launchdownload. 
 * directorydefault dist/ApkBolt-v<version>-win64-full, . 
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { assertStandalone } = require('./guard-standalone');

const ROOT = path.join(__dirname, '..');
const PKG = require(path.join(ROOT, 'package.json'));
const FULL = process.argv.includes('--full') || process.env.APKSTART_PACK_FULL === '1';
// directory(directory, )
let OUT = process.env.APKSTART_PACK_OUT
  ? path.resolve(process.env.APKSTART_PACK_OUT)
  : path.join(ROOT, 'dist', FULL ? `ApkBolt-v${PKG.version}-win64-full` : 'ApkBolt-win64-portable');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');

// Windows fs.cpSync " + system image"directory
// EINPROGRESS(Node error "not enough space on the disk", disk G). 
// copyFileSync : ,  syscall, 
// directory,  robocopy shell . 
function copy(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copy(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

console.log(FULL ? '()→' : ' →', OUT);
// : , failure
// version. directory, ; directory. 
if (fs.existsSync(OUT)) {
  try {
    const backup = `${OUT}.prev-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(OUT, backup);
    console.log(' →', backup);
  } catch (_) {
    // ( / / )directory, 
    // directory EBUSY; versiondirectory, . 
    OUT = path.join(ROOT, 'dist', `ApkBolt-v${require(path.join(ROOT, 'package.json')).version}-win64-portable`);
    console.log(',  →', OUT);
  }
}
fs.mkdirSync(path.join(OUT, 'resources', 'app'), { recursive: true });

// 1. Electron runtime
console.log(' Electron ...');
copy(ELECTRON_DIST, OUT);
fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });

// 1.1 slim: Electron 55 ,  41MB, . 
// zh-CN / zh-TW / en-US, (-39MB,  15%). 
const KEEP_LOCALES = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak']);
let localeSaved = 0;
try {
  const locDir = path.join(OUT, 'locales');
  for (const f of fs.readdirSync(locDir)) {
    if (KEEP_LOCALES.has(f)) continue;
    localeSaved += (() => { try { return fs.statSync(path.join(locDir, f)).size; } catch (_) { return 0; } })();
    fs.rmSync(path.join(locDir, f), { force: true });
  }
} catch (_) { /* locales directory */ }

// 1.2 : updatelog, ,  pak( 0.1~9MB)
for (const rel of ['LICENSES.chromium.html.bak', 'vk_swiftshader_icd.json.bak']) {
  fs.rmSync(path.join(OUT, rel), { force: true });
}

// 1.3 : 
// d3dcompiler_47.dll ANGLE HLSL GPU ,  Windows 8.1
// System32 DLL, LoadLibrary . 
// //(--smoke ).  2.1MB. 
// note: vk_swiftshader.dll / vulkan-1.dll -- GPU driver Chromium
// fallback, . 
let pruneSaved = 0;
for (const rel of ['d3dcompiler_47.dll']) {
  const p = path.join(OUT, rel);
  try {
    pruneSaved += fs.statSync(p).size;
    fs.rmSync(p, { force: true });
  } catch (_) { /*  */ }
}

// 2. app
// assets/ : PinyinIME.apk(IME), boot
// Runtime.prepare() Android. . 
console.log('...');
const appDir = path.join(OUT, 'resources', 'app');
for (const item of ['package.json', 'src', 'assets', 'LICENSE']) {
  const src = path.join(ROOT, item);
  if (fs.existsSync(src)) copy(src, path.join(appDir, item));
}

// 2.1 ():  src/ -- runtime npm . 
// : @napi-rs/lzma extract system.img.xz / vendor.img.xz, 
// package.json dependencies ,  pack.js node_modules. 
// "app": system image Cannot find module '@napi-rs/lzma', 
// runtime, parameters boot-failed. 0.5.9 . 
// (@scope/name) scope , 
// optionalDependency scope ( @napi-rs/lzma-win32-x64-msvc). 
const prodDeps = Object.keys((require(path.join(ROOT, 'package.json')).dependencies) || {});
if (prodDeps.length) {
  console.log(`(${prodDeps.length}): ${prodDeps.join(', ')}`);
  const destModules = path.join(appDir, 'node_modules');
  for (const dep of prodDeps) {
    if (dep.startsWith('@')) {
      const scope = dep.split('/')[0];
      const scopeSrc = path.join(ROOT, 'node_modules', scope);
      if (fs.existsSync(scopeSrc)) copy(scopeSrc, path.join(destModules, scope));
    } else {
      const depSrc = path.join(ROOT, 'node_modules', dep);
      if (fs.existsSync(depSrc)) copy(depSrc, path.join(destModules, dep));
    }
  }
}

// 3. directory
// engine/ ; runtime(emulator, system-images, 
// platform-tools, avd)applaunchdownload, install. 
// tools/ (, ), , . 
const ENGINE_SKIP = new Set(['emulator', 'system-images', 'platform-tools', 'avd', 'aehd', '_dl', 'qemu']);
for (const opt of ['engine']) {
  const src = path.join(ROOT, opt);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(appDir, opt);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (opt === 'engine' && ENGINE_SKIP.has(entry.name)) continue;
    copy(path.join(src, entry.name), path.join(dest, entry.name));
  }
}

// 3.5 : runtime(emulator + platform-tools + system image)
if (FULL) {
  const runtime = path.join(ROOT, 'build', 'runtime');
  const runtimeExe = path.join(runtime, 'emulator', 'emulator.exe');
  if (!fs.existsSync(runtimeExe)) {
    console.error('\n[!]  build/runtime/emulator/emulator.exe. ');
    console.error('     node build/prepare-runtime.js(npm run runtime), . \n');
    process.exit(1);
  }
  console.log('( 1 GB, )...');
  // runtimedirectory: userdata.img.broken(failure), 
  // *.part(extract), *.new(temporary). , 
  // system image -- , . 
  // .img.xz :  xz extract
  // ("failed to fill whole buffer"),  --
  // "app". 0.5.9 system.img.xz
  // (495MB 1366MB / 2958MB). xz footer, 
  // 8 "YZ"; . 
  const walkXz = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walkXz(p); continue; }
      if (!/\.img\.xz$/i.test(e.name)) continue;
      const size = fs.statSync(p).size;
      const fd = fs.openSync(p, 'r');
      let tail;
      try {
        const n = Math.min(8, size);
        tail = Buffer.alloc(n);
        fs.readSync(fd, tail, 0, n, size - n);
      } finally { fs.closeSync(fd); }
      if (!tail.includes(Buffer.from('YZ'))) {
        console.error(`\n[!] ( xz footer, ): ${p}`);
        console.error(`     ${(size / 1048576).toFixed(1)} MB. . \n`);
        process.exit(1);
      }
    }
  };
  walkXz(runtime);
  // note .pynew temporary(python ),  .new . 
  const JUNK = /(\.broken|\.part|\.new|\.pynew|\.tmp|\.bak)$/i;
  const copyRuntime = (src, dest) => {
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src)) {
        if (JUNK.test(entry)) continue;
        copyRuntime(path.join(src, entry), path.join(dest, entry));
      }
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  };
  copyRuntime(runtime, path.join(OUT, 'resources', 'runtime'));
}

// 3.6 :  MuMu / / emulator. 
// failure -- "", . 
assertStandalone(path.join(OUT, 'resources'), { label: ' resources' });

// 4.
const exePath = path.join(OUT, 'ApkBolt.exe');
fs.renameSync(path.join(OUT, 'electron.exe'), exePath);

/**
 * ApkBolt.exe version. 
 *
 * :  exe Electron --
 * FileDescription=Electron, ProductName=Electron, CompanyName=GitHub, Inc., 
 * version 33.4.11,  Electron . , taskbar, 
 * shortcut, /"Electron"default, 
 * "default". 
 *
 * rcedit electron-builder / electron-winstaller , 
 * node_modules , . 
 */
function embedExeMeta(exe) {
  const rcedit = [
    path.join(ROOT, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe'),
    path.join(ROOT, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'),
  ].find((p) => fs.existsSync(p));
  if (!rcedit) {
    console.warn('  [!]  rcedit.exe, exe / Electron ');
    return false;
  }
  const ico = path.join(ROOT, 'src', 'ui', 'assets', 'appicon.ico');
  if (!fs.existsSync(ico)) {
    console.warn(`  [!]  ${ico}, `);
    return false;
  }
  const args = [
    exe,
    '--set-icon', ico,
    // version( MSIX ), version
    '--set-file-version', `${PKG.version}.0`,
    '--set-product-version', PKG.version,
    '--set-version-string', 'ProductName', 'ApkBolt',
    '--set-version-string', 'FileDescription', 'ApkBolt - High-Performance Android Desktop Launcher',
    '--set-version-string', 'CompanyName', 'Abhijeet Kangane',
    '--set-version-string', 'LegalCopyright', 'Copyright (c) 2026 Abhijeet Kangane',
    '--set-version-string', 'OriginalFilename', 'ApkBolt.exe',
    '--set-version-string', 'InternalName', 'ApkBolt',
  ];
  try {
    execFileSync(rcedit, args, { stdio: 'pipe', windowsHide: true });
    console.log(`  exe /(${PKG.version}, FileDescription=ApkBolt )`);
    return true;
  } catch (e) {
    console.warn(`  [!] rcedit : ${e.message}`);
    return false;
  }
}
embedExeMeta(exePath);

// 5. version
const pkg = PKG;
const fullNote = FULL ? '(, )' : '()';
fs.writeFileSync(path.join(OUT, 'VERSION.txt'),
  `ApkBolt ${pkg.version}\n${fullNote}\n: ${new Date().toLocaleString('zh-CN')}\n`);

// 6. : , 
function dirSize(dir) {
  let n = 0;
  try {
    for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, it.name);
      n += it.isDirectory() ? dirSize(p) : fs.statSync(p).size;
    }
  } catch (_) { /* ignore */ }
  return n;
}
const totalMB = dirSize(OUT) / 1048576;
console.log(
  `.  ${totalMB.toFixed(0)} MB( ${(localeSaved / 1048576).toFixed(0)} MB, `
  + ` ${(pruneSaved / 1048576).toFixed(1)} MB). `,
);
console.log(': node build/zip.js ' + path.relative(ROOT, OUT) + ' <.zip>');
console.log(` ${path.join(OUT, 'ApkBolt.exe')} . `);
if (!FULL) console.log('", ": node build/pack.js --full');
