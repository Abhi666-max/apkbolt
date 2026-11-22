'use strict';
/**
 * : , , , apply , . 
 * ,  GitHub / Gitee. 
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Updater } = require('../src/core/updater');
const inc = require('../src/core/incremental');
const { ZipFile } = require('../src/core/zip');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
async function atest(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const TMP = path.join(__dirname, 'out', 'incremental');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const sampleFiles = {
  'resources/app/package.json': { sha256: 'AAA', size: 3 },
  'resources/app/src/main.js': { sha256: 'BBB', size: 9 },
};

console.log('\n[  -  ]');
test('parseManifest', () => {
  for (const bad of ['not json', '{}', JSON.stringify({ schema: 2 }), JSON.stringify({ schema: 1, version: '1' })]) {
    let threw = false;
    try { inc.parseManifest(bad); } catch (_) { threw = true; }
    assert(threw, `: ${bad.slice(0, 30)}`);
  }
});

test('parseManifest', () => {
  const m = inc.parseManifest(JSON.stringify({
    schema: 1, version: '0.6.3', electronVersion: '33.4.11',
    app: { asset: 'ApkBolt-v0.6.3-app.zip', sha256: 'x', files: sampleFiles },
  }));
  assert(m.version === '0.6.3' && m.app.files['resources/app/package.json'], 'assertion failed');
});

test('( / / )', () => {
  assert(inc.isAuxAsset('ApkBolt-v0.6.3-manifest.json'));
  assert(inc.isAuxAsset('ApkBolt-v0.6.3-app.zip'));
  assert(inc.isAuxAsset('ApkBolt-runtime-v0.6.3.zip'));
  assert(!inc.isAuxAsset('ApkBolt-v0.6.3-win64-portable.zip'));
});

test('Electron / →', () => {
  const manifest = { app: { asset: 'a.zip', sha256: 'x', files: {} }, electronVersion: '33.4.11' };
  const assets = [{ name: 'a.zip' }];
  assert(inc.chooseMode({ flavor: 'portable', electronVersion: '33.4.11', manifest, assets }).mode === 'app');
  assert(inc.chooseMode({ flavor: 'portable', electronVersion: '22.0.0', manifest, assets }).mode === 'full');
  assert(inc.chooseMode({ flavor: 'setup', electronVersion: '33.4.11', manifest, assets }).mode === 'full');
  assert(inc.chooseMode({ flavor: 'portable', electronVersion: '33.4.11', manifest, assets: [] }).mode === 'full');
});

console.log('\n[  -  ]');
(async () => {
  const dir = path.join(TMP, 'hash');
  fs.mkdirSync(path.join(dir, 'resources', 'app', 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'resources', 'app', 'package.json'), '{"version":"0.6.3"}');
  fs.writeFileSync(path.join(dir, 'resources', 'app', 'src', 'main.js'), 'console.log(1)');
  const files = {
    'resources/app/package.json': { sha256: sha(fs.readFileSync(path.join(dir, 'resources/app/package.json'))) },
    'resources/app/src/main.js': { sha256: sha(fs.readFileSync(path.join(dir, 'resources/app/src/main.js'))) },
    'resources/app/src/gone.js': { sha256: 'deadbeef' },
  };
  const hash = (f) => fs.existsSync(f) ? sha(fs.readFileSync(f)) : null;

  await atest('inspectLocal', async () => {
    const r = await inc.inspectLocal({ installDir: dir, files, hash });
    assert(r.missing.length === 1 && r.missing[0] === 'resources/app/src/gone.js', `missing=${r.missing}`);
    assert(r.changed.length === 0, `changed=${r.changed}`);
    assert(!r.ok);
  });

  await atest('verifyExtracted , ', async () => {
    const ok = { 'resources/app/package.json': files['resources/app/package.json'] };
    assert((await inc.verifyExtracted({ payload: dir, files: ok, hash })).length === 0);
    const bad = { 'resources/app/package.json': { sha256: '0'.repeat(64) } };
    assert((await inc.verifyExtracted({ payload: dir, files: bad, hash })).length === 1);
  });

  console.log('\n[  -  check ]');
  await atest('check() , ', async () => {
    const exe = path.join(TMP, 'check', 'ApkBolt.exe');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, 'x');
    const u = new Updater({ currentVersion: '0.6.2', exePath: exe, isPackaged: true, dataDir: path.join(TMP, 'check-data'), electronVersion: '33.4.11' });
    u.sources.latest = async () => ({
      version: '0.6.3', tag: 'v0.6.3', notes: '', htmlUrl: '', publishedAt: '',
      assets: [
        { name: 'ApkBolt-v0.6.3-manifest.json', size: 1, url: 'https://x/m', urls: ['https://x/m'], sizes: {} },
        { name: 'ApkBolt-v0.6.3-app.zip', size: 2, url: 'https://x/a', urls: ['https://x/a'], sizes: {} },
        { name: 'ApkBolt-v0.6.3-win64-portable.zip', size: 3, url: 'https://x/f', urls: ['https://x/f'], sizes: {} },
      ],
      sources: [], unreachable: [],
    });
    const info = await u.check();
    assert(info.incremental && info.incremental.manifest.name.endsWith('manifest.json'), 'assertion failed');
    assert(info.incremental.app.name.endsWith('app.zip'), 'assertion failed');
    assert(info.asset && info.asset.name.endsWith('portable.zip'), 'assertion failed');
    assert(info.hasUpdate);
  });

  console.log('\n[  -  apply ]');
  test('app resources/app, ', () => {
    const dataDir = path.join(TMP, 'apply');
    const exe = path.join(dataDir, 'ApkBolt.exe');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(exe, 'old');
    const u = new Updater({ currentVersion: '0.6.2', exePath: exe, isPackaged: true, dataDir });
    const payload = path.join(dataDir, 'update', '0.6.3', 'app-payload');
    fs.mkdirSync(path.join(payload, 'resources', 'app'), { recursive: true });
    fs.writeFileSync(path.join(payload, 'resources', 'app', 'package.json'), '{"version":"0.6.3"}');
    const script = u.apply({ mode: 'app', payload, version: '0.6.3' }, { spawn: false });
    assert(/Join-Path \$appDst 'package\.json'/.test(script) || /'package\.json'/.test(script), 'package.json');
    assert(/Move-Item -LiteralPath \$appDst -Destination \$backup/.test(script), 'app');
    assert(/app copy FAILED - rollback and keep payload/.test(script), '/');
    assert(/Start-Process -FilePath/.test(script) && /cmd\.exe/.test(script), 'assertion failed');
    assert(!/Join-Path \$src '\*'\) -Destination \$dst -Recurse/.test(script), 'assertion failed');
  });

  test(', ', () => {
    const dataDir = path.join(TMP, 'forcefull');
    const exe = path.join(dataDir, 'ApkBolt.exe');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, 'x');
    const u = new Updater({ currentVersion: '0.6.2', exePath: exe, isPackaged: true, dataDir });
    const payload = path.join(dataDir, 'update', '0.6.3', 'app-payload');
    fs.mkdirSync(path.join(payload, 'resources', 'app'), { recursive: true });
    fs.writeFileSync(path.join(payload, 'resources', 'app', 'package.json'), '{}');
    u._markPayloadReady(payload, '0.6.3', 'app');
    assert(u.findResumableJob().mode === 'app', 'assertion failed');
    fs.writeFileSync(path.join(dataDir, 'update', '0.6.3', '.apkbolt-force-full'), '');
    assert(u.findResumableJob() === null, 'assertion failed');
    const script = u.apply({ mode: 'app', payload, version: '0.6.3' }, { spawn: false });
    assert(/\.apkbolt-force-full/.test(script), 'apply');
  });

  test('findResumableJob , ', () => {
    const dataDir = path.join(TMP, 'resume');
    const exe = path.join(dataDir, 'ApkBolt.exe');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, 'x');
    const u = new Updater({ currentVersion: '0.6.2', exePath: exe, isPackaged: true, dataDir });
    const appPayload = path.join(dataDir, 'update', '0.6.3', 'app-payload');
    fs.mkdirSync(path.join(appPayload, 'resources', 'app'), { recursive: true });
    fs.writeFileSync(path.join(appPayload, 'resources', 'app', 'package.json'), '{}');
    u._markPayloadReady(appPayload, '0.6.3', 'app');
    const job = u.findResumableJob();
    assert(job && job.mode === 'app' && job.version === '0.6.3', ` app ,  ${JSON.stringify(job)}`);

    const zipPayload = path.join(dataDir, 'update', '0.6.4', 'payload');
    fs.mkdirSync(zipPayload, { recursive: true });
    fs.writeFileSync(path.join(zipPayload, 'ApkBolt.exe'), 'new');
    u._markPayloadReady(zipPayload, '0.6.4', 'zip');
    // 0.6.4  0.6.3
    const job2 = u.findResumableJob();
    assert(job2 && job2.mode === 'zip' && job2.version === '0.6.4', 'assertion failed');
  });

  console.log('\n[  -  ]');
  test('build/incremental.js', async () => {
    const fixture = path.join(TMP, 'portable');
    fs.mkdirSync(path.join(fixture, 'resources', 'app', 'src'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'ApkBolt.exe'), 'shell-bytes-not-in-app-pack');
    fs.writeFileSync(path.join(fixture, 'resources', 'app', 'package.json'), '{"version":"0.6.3","name":"apkbolt"}');
    fs.writeFileSync(path.join(fixture, 'resources', 'app', 'src', 'main.js'), 'console.log("incremental")');
    const out = path.join(TMP, 'assets');
    const { build } = require('../build/incremental');
    const r = await build(fixture, 'v0.6.3', out);
    assert(fs.existsSync(r.manifestPath) && fs.existsSync(r.appZip), 'assertion failed');
    const m = inc.parseManifest(fs.readFileSync(r.manifestPath, 'utf8'));
    assert(m.version === '0.6.3' && m.electronVersion, '/ Electron');
    assert(m.app.files['resources/app/src/main.js'], 'app');
    assert(!m.app.files['ApkBolt.exe'], 'assertion failed');
    const zf = new ZipFile(r.appZip);
    const names = zf.names();
    assert(names.some((n) => /resources\/app\/package\.json/.test(n)), ` package.json: ${names}`);
    assert(!names.some((n) => /ApkBolt\.exe/.test(n)), 'exe');
    zf.close();
  });

  console.log(`\n: ${passed} , ${failed} \n`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(': ', e);
  process.exit(1);
});
