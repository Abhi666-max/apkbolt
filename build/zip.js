'use strict';
/**
 * compress（Windows zip）。
 *
 * PowerShell `Compress-Archive`：
 * .NET deflate（ zlib 6 ）， 225MB directory
 * 105,213,775 ；7-Zip deflate（`-mx=9`） 99,616,541 —— 5.6MB。
 * Gitee 100MB（ 104,800,000 success，
 * 105,213,775 part1/part2 extract）。 5MB，
 * 「extract，」。
 *
 * 7-Zip ； 7-Zip Compress-Archive（hint）。
 *
 * ：
 * node build/zip.js <directory> <.zip> [--limit-mb 100]
 * exit：0 success / 1 failure / 2 （CI failure，split）
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MIB = 1024 * 1024;

/** 7-Zip （7z.exe 7za.exe） */
function find7z() {
  const explicit = process.env.APKSTART_7Z;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const direct = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    path.join(__dirname, '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
  ];
  for (const p of direct) if (fs.existsSync(p)) return p;

  // PATH （GitHub Actions windows-latest 7-Zip PATH ）
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    for (const exe of ['7z.exe', '7za.exe']) {
      const p = path.join(dir, exe);
      try { if (fs.existsSync(p)) return p; } catch (_) { /* ignore */ }
    }
  }

  // electron-builder download 7zip cache（）
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache');
  try {
    for (const d of fs.readdirSync(cache)) {
      if (!/^7zip/i.test(d)) continue;
      const base = path.join(cache, d);
      for (const sub of fs.readdirSync(base)) {
        const p = path.join(base, sub, 'bin', '7za.exe');
        if (fs.existsSync(p)) return p;
      }
    }
  } catch (_) { /* cachedirectory */ }
  return '';
}

function dirStats(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (d) => {
    for (const it of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) walk(p);
      else { files += 1; bytes += fs.statSync(p).size; }
    }
  };
  walk(dir);
  return { files, bytes };
}

/** 7-Zip zip：cwd directory，path、directory */
function zipWith7z(exe, srcDir, outZip, level = 9) {
  const r = spawnSync(exe, ['a', '-tzip', '-mm=Deflate', `-mx=${level}`, '-bso0', '-bsp0', '-y', outZip, '*'], {
    cwd: srcDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(`7-Zip （${r.status}）：${String(r.stderr || r.stdout || '').slice(0, 400)}`);
  }
}

/** fallback：PowerShell Compress-Archive（ 5%， 7-Zip ） */
function zipWithPowershell(srcDir, outZip) {
  const ps = `Compress-Archive -Path '${path.join(srcDir, '*')}' -DestinationPath '${outZip}' -CompressionLevel Optimal -Force`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(`Compress-Archive ：${String(r.stderr || '').slice(0, 400)}`);
  }
}

/** compress：app zip ，extract */
function verify(zipPath, expect) {
  const { ZipFile } = require('../src/core/zip');
  const zip = new ZipFile(zipPath);
  try {
    const names = zip.names().filter((n) => !n.endsWith('/'));
    let bytes = 0;
    for (const n of names) bytes += zip.entries.get(n).uncompSize;
    if (names.length !== expect.files) {
      throw new Error(`： ${names.length}， ${expect.files}`);
    }
    if (bytes !== expect.bytes) {
      throw new Error(`： ${bytes}， ${expect.bytes}`);
    }
    return names.length;
  } finally {
    zip.close();
  }
}

function main() {
  const srcDir = path.resolve(process.argv[2] || '');
  const outZip = path.resolve(process.argv[3] || '');
  const limArg = process.argv.indexOf('--limit-mb');
  const limitMiB = limArg > 0 ? Number(process.argv[limArg + 1]) : 100;
  if (!srcDir || !fs.existsSync(srcDir) || !outZip) {
    console.error('：node build/zip.js <> <.zip> [--limit-mb 100]');
    process.exit(1);
  }

  const stats = dirStats(srcDir);
  console.log(` ${srcDir}（${stats.files} ，${(stats.bytes / MIB).toFixed(1)} MB）`);
  fs.rmSync(outZip, { force: true });

  const exe = find7z();
  if (exe) {
    console.log('：', exe);
    zipWith7z(exe, srcDir, outZip);
  } else {
    console.warn('⚠️   7-Zip， Compress-Archive ——  5% ， Gitee ');
    zipWithPowershell(srcDir, outZip);
  }

  const size = fs.statSync(outZip).size;
  const entries = verify(outZip, stats);
  console.log(`：${outZip}`);
  console.log(`  ${entries} ，${size} （${(size / MIB).toFixed(2)} MiB）， ${(size / stats.bytes * 100).toFixed(1)}%`);

  if (size > limitMiB * MIB) {
    console.error(`✗  ${limitMiB} MiB （Gitee  100MB）。，。`);
    process.exit(2);
  }
  console.log(`  ✓  ${limitMiB} MiB （ ${((limitMiB * MIB - size) / MIB).toFixed(2)} MiB）`);
}

if (require.main === module) main();

module.exports = { find7z, dirStats, verify };
