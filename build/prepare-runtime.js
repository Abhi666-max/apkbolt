'use strict';
/**
 * engine/ 「」runtime：build/runtime/
 *
 * system.img compress。AOSP system.img 3.1GB system image，
 * ，gzip ~580MB。。
 * emulator（slim 340MB）+ Electron + platform-tools， 1.0~1.1GB。
 * compress 1.4GB 。
 * launch 1~2 directory（），
 * src/core/provision.js materializeImages()。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'engine');
const OUT = path.join(ROOT, 'build', 'runtime');
const MARK = path.join(OUT, '.prepared');
// /data （ ext4，xz compress）。 userdata.img 。
const SEED_USERDATA = path.join(__dirname, 'seed', 'userdata.img.gz');

function sizeOf(p) {
  try { return fs.statSync(p).size; } catch (_) { return 0; }
}

async function gzipFile(src, dest) {
  await pipeline(
    fs.createReadStream(src),
    zlib.createGzip({ level: 6 }),
    fs.createWriteStream(dest),
  );
}

/** system image XZ（LZMA2）： gzip -6 ~25%（system.img 1.5GB→~1.1GB）。
 * default 9e ；CI XZ_PRESET=6 1/3（ +3%）。
 *
 * （）：
 * - python lzma（、）。@napi-rs/lzma createCompressStream 
 * 0 （ 18 ），fallbacktimeout。
 * - 【CI 3 】 pipe stdin，。
 * python `shutil.copyfileobj(sys.stdin.buffer, z)`， EOF ，
 * stdout 、exit。 p.stdout， .xz
 * 「compress」，CI directory。
 * - ：compress kill gzip fallback，。
 * - python / compressfailure → gzip -9（），
 * runtime materializeImages extract，。
 */
function findPython() {
  const { spawnSync } = require('child_process');
  for (const cmd of ['python', 'python3', 'py']) {
    try {
      const r = spawnSync(cmd, ['-c', 'import lzma;print("ok")'], {
        encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (r.status === 0 && /ok/.test(String(r.stdout))) return cmd;
    } catch (_) { /*  */ }
  }
  return null;
}

async function xzFile(src, dest) {
  const preset = Math.max(0, Math.min(9, Number(process.env.XZ_PRESET || 9)));
  const extreme = preset >= 9 && process.env.XZ_NO_EXTREME !== '1';
  const pyPreset = extreme ? '9|lzma.PRESET_EXTREME' : String(preset);
  const dictSize = preset >= 9 ? (1 << 27) : preset >= 6 ? (1 << 26) : (1 << 23);
  // default 2 （3GB / 2 / preset 6 ~40min）；timeout kill gzip fallback。
  const timeoutMs = Math.max(5000, Number(process.env.XZ_TIMEOUT_MS || 2 * 60 * 60 * 1000));
  const py = findPython();
  if (py) {
    const { spawn } = require('child_process');
    const p = spawn(py, ['-c', [
      'import lzma,sys,shutil',
      `flt=[{"id":lzma.FILTER_LZMA2,"preset":${pyPreset},"dict_size":${dictSize}}]`,
      'z=lzma.LZMAFile(sys.stdout.buffer,mode="wb",format=lzma.FORMAT_XZ,filters=flt)',
      'shutil.copyfileobj(sys.stdin.buffer,z); z.close()',
    ].join(';')], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });

    // ， await exit close 。
    const exited = new Promise((resolve) => {
      p.on('close', resolve);
      p.on('error', () => resolve(-1));
    });
    const watchdog = setTimeout(() => {
      console.log(`  （xz  ${Math.round(timeoutMs / 60000)} ， gzip -9）`);
      try { p.kill(); } catch (_) { /* exit */ }
    }, timeoutMs);

    let ok = false;
    try {
      // ：stdin compress。pipeline src end(p.stdin)，
      // python EOF flush XZ exit。
      const streams = [
        pipeline(fs.createReadStream(src), p.stdin),
        pipeline(p.stdout, fs.createWriteStream(dest)),
      ];
      // （EPIPE / failure），。
      streams.forEach((s) => s.catch(() => { try { p.kill(); } catch (_) { /* noop */ } }));
      const settled = await Promise.allSettled(streams);
      const code = await exited;
      ok = code === 0 && settled.every((r) => r.status === 'fulfilled') && sizeOf(dest) > 0;
    } catch (_) {
      ok = false;
    } finally {
      clearTimeout(watchdog);
    }
    if (ok) return;
    // .xz ，fallback。
    try { fs.rmSync(dest, { force: true }); } catch (_) { /* ignore */ }
    console.log(`  （${py} ， gzip -9）`);
  } else {
    console.log('  （ python， gzip -9（））');
  }
  // fallback：gzip -9（ xz，runtime materializeImages extract）
  await pipeline(
    fs.createReadStream(src),
    zlib.createGzip({ level: 9 }),
    fs.createWriteStream(dest.replace(/\.xz$/i, '.gz')),
  );
}

async function main() {
  const force = process.argv.includes('--force');
  if (fs.existsSync(MARK) && !force) {
    console.log('build/runtime （ --force ）');
    return;
  }
  if (!fs.existsSync(SRC)) {
    console.error(' engine/ ，');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  // 1. emulator / platform-tools（）
  for (const dir of ['emulator', 'platform-tools']) {
    const s = path.join(SRC, dir);
    if (!fs.existsSync(s)) continue;
    console.log(` ${dir}…`);
    fs.cpSync(s, path.join(OUT, dir), { recursive: true });
  }

  // 1.5 slim：launchparameters（ -400MB）
  if (!process.argv.includes('--no-slim')) {
    console.log('…');
    const { slim } = require('./slim-runtime');
    slim(OUT, { aggressive: !process.argv.includes('--safe-slim') });
  }

  // 2. system image：system image .xz（runtime materializeImages extract），
  const imgRoot = path.join(SRC, 'system-images');
  let compressed = 0;
  if (fs.existsSync(imgRoot)) {
    for (const api of fs.readdirSync(imgRoot)) {
      for (const tag of fs.readdirSync(path.join(imgRoot, api))) {
        for (const abi of fs.readdirSync(path.join(imgRoot, api, tag))) {
          const from = path.join(imgRoot, api, tag, abi);
          const to = path.join(OUT, 'system-images', api, tag, abi);
          fs.mkdirSync(to, { recursive: true });
          for (const f of fs.readdirSync(from)) {
            const src = path.join(from, f);
            if (!fs.statSync(src).isFile()) continue;
            // NOTICE.txt GMS （~20MB），
            if (/^NOTICE\.txt$/i.test(f)) continue;
            // userdata.img ext4 （seed）：
            // sys-img 1MB ，emulator e2fsck code=8，
            // 1MB → guest invalid magic → /data → install。
            // （mke2fs），，CI 。
            if (/^userdata\.img$/i.test(f) && fs.existsSync(SEED_USERDATA)) {
              fs.copyFileSync(SEED_USERDATA, path.join(to, 'userdata.img.gz'));
              console.log('userdata.img  ext4 （build/seed）');
              compressed += 1;
              continue;
            }
            if (/^(system|vendor|cache|userdata)\.img$/i.test(f) && sizeOf(src) > 32 * 1024 * 1024) {
              // system image，；compress（）compress
              const xz = path.join(to, `${f}.xz`);
              const gz = path.join(to, `${f}.gz`);
              // gzip fallbackpath .gz，， 3GB 。
              // >1MB compress：vendor.img.gz ~21MB、userdata.img ，
              // 「compress」。
              const existing = [xz, gz].find((p) => sizeOf(p) > 1024 * 1024);
              if (existing) {
                console.log(` ${f}（ ${path.extname(existing)} ${(sizeOf(existing) / 1048576).toFixed(1)} MB）`);
                compressed += 1;
                continue;
              }
              console.log(` ${f}（${(sizeOf(src) / 1073741824).toFixed(2)} GB）→ XZ 9e（，）…`);
              // eslint-disable-next-line no-await-in-loop
              await xzFile(src, xz);
              compressed += 1;
            } else {
              fs.copyFileSync(src, path.join(to, f));
            }
          }
        }
      }
    }
  }

  fs.writeFileSync(MARK, new Date().toISOString());
  const gzCount = compressed;
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else total += sizeOf(p);
    }
  };
  walk(OUT);
  console.log(`：build/runtime（${(total / 1073741824).toFixed(2)} GB， ${gzCount} ）`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
// （ main ）
module.exports = { xzFile, gzipFile, findPython };
