'use strict';
/**
 * incrementalupdate： + 「」zip。
 *
 * 99MB， Electron （exe / dll / locales），upgrade Electron
 * ； resources/app JS / / node_modules。
 * app ， sha256， Electron
 * version， resources/app completeupgrade。
 *
 * （ --out directory，defaultdirectory）：
 * ApkStart-v<version>-manifest.json
 * ApkStart-v<version>-app.zip
 *
 * ：node build/incremental.js <portable versiondirectory> <tag> [--out directory]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { sha256File } = require('../src/core/download');
const { find7z } = require('./zip');

const ROOT = path.dirname(__dirname);

/** Electron version： */
function electronVersion(root = ROOT) {
  const candidates = [
    path.join(root, 'node_modules', 'electron', 'package.json'),
    path.join(root, 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j.name === 'electron' && j.version) return String(j.version);
    } catch (_) { /*  */ }
  }
  try {
    const ep = path.join(root, 'package.json');
    const dev = (JSON.parse(fs.readFileSync(ep, 'utf8')).devDependencies || {}).electron;
    if (dev) return String(dev).replace(/^[^\d]*/, '');
  } catch (_) { /* ignore */ }
  return '';
}

/** directorypath（） */
function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, base));
    else if (e.isFile()) out.push(path.relative(base, abs).replace(/\\/g, '/'));
  }
  return out;
}

function zipApp(exe, srcDir, outZip, rootDir) {
  // cwd portable versiondirectory，path resources/app/...
  const r = spawnSync(exe, ['a', '-tzip', '-mm=Deflate', '-mx=9', '-bso0', '-bsp0', '-y', outZip, 'resources\\app'], {
    cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(`（${r.status}）：${String(r.stderr || r.stdout || '').slice(0, 400)}`);
  }
  if (!fs.existsSync(srcDir)) throw new Error(`：${srcDir}`);
}

async function build(portableDir, tag, outDir = process.cwd()) {
  const portable = path.resolve(portableDir);
  const appDir = path.join(portable, 'resources', 'app');
  if (!fs.existsSync(path.join(portable, 'ApkStart.exe'))) throw new Error(' ApkStart.exe');
  if (!fs.existsSync(path.join(appDir, 'package.json'))) throw new Error(' resources/app/package.json');

  const version = String(tag || '').replace(/^v/i, '');
  if (!version) throw new Error(' / tag');

  fs.mkdirSync(outDir, { recursive: true });
  const appName = `ApkStart-v${version}-app.zip`;
  const manifestName = `ApkStart-v${version}-manifest.json`;
  const appZip = path.join(outDir, appName);
  const manifestPath = path.join(outDir, manifestName);

  fs.rmSync(appZip, { force: true });
  const exe = find7z();
  if (!exe) throw new Error(' 7-Zip，（CI  windows-latest ）');
  zipApp(exe, appDir, appZip, portable);

  const files = {};
  const rels = walk(appDir).sort();
  for (const rel of rels) {
    const abs = path.join(appDir, ...rel.split('/'));
    files[`resources/app/${rel}`] = {
      size: fs.statSync(abs).size,
      sha256: await sha256File(abs),
    };
  }
  const packHash = await sha256File(appZip);
  const manifest = {
    schema: 1,
    version,
    tag: tag.startsWith('v') ? tag : `v${tag}`,
    electronVersion: electronVersion(ROOT),
    generatedAt: new Date().toISOString(),
    app: {
      asset: appName,
      sha256: packHash,
      size: fs.statSync(appZip).size,
      files,
    },
    full: { asset: `ApkStart-v${version}-win64-portable.zip` },
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`：${manifestPath}`);
  console.log(`：${appZip}（${(fs.statSync(appZip).size / 1024 / 1024).toFixed(2)} MB，${rels.length} ）`);
  console.log(`Electron：${manifest.electronVersion || '()'}`);
  return { manifestPath, appZip, manifest };
}

if (require.main === module) {
  const dir = process.argv[2];
  const tag = process.argv[3];
  const oi = process.argv.indexOf('--out');
  const out = oi > 0 ? process.argv[oi + 1] : process.cwd();
  if (!dir || !tag) {
    console.error('：node build/incremental.js <> <tag> [--out ]');
    process.exit(1);
  }
  build(dir, tag, out).catch((e) => { console.error('：', e.message); process.exit(1); });
}

module.exports = { build, electronVersion, walk };
