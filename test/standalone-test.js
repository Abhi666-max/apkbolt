'use strict';
/**
 *  Node :  Electron, , . 
 * (0.5.6 ): 
 *   **ApkBolt , , . **
 * : 
 *   1. (MuMu /  /  / WSA / FydeOS); 
 *   2.  settings.json  mode=mumu / fydeos / attach,  builtin; 
 *   3. . 
 * : node test/standalone-test.js
 */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findBundled, findForbiddenSource, assertStandalone } = require('../build/guard-standalone');
const backends = require('../src/core/backends');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(ROOT, ...p));

function tmpDir(name) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `apkbolt-${name}-`));
  return d;
}
function touch(dir, rel, bytes = 8) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes));
  return p;
}

(() => {
  console.log('\n[  -  ]');

  const store = require('../src/core/store');
  const settings = store.getSettings();

  test('Default engine is builtin runtime', () => {
    assert.equal(settings.engine.mode, 'builtin', ` mode=${settings.engine.mode}`);
  });

  test('Registry contains only builtin backend', () => {
    assert.equal(backends.REGISTRY.length, 1, ` ${backends.REGISTRY.length} `);
    assert.deepEqual(backends.describe().map((d) => d.id), ['builtin']);
  });

  test('Legacy mode strings fallback to builtin', () => {
    for (const mode of ['mumu', 'fydeos', 'attach', 'ldplayer', 'whatever', '']) {
      const made = backends.create({
        appRoot: ROOT, settings: { engine: { mode } }, store, log: () => {},
      });
      assert.equal(made.id, 'builtin', `mode=${mode}  ${made.id}`);
      assert.equal(made.backend.constructor.id, 'builtin', 'BuiltinBackend');
    }
  });

  test('Explicit foreign id rejected in favor of builtin', () => {
    const made = backends.create({
      appRoot: ROOT, settings: { engine: { mode: 'builtin' } }, store, log: () => {}, id: 'mumu',
    });
    assert.equal(made.id, 'builtin', 'id=mumu');
  });

  test('Auto-selection does not probe external emulators', async () => {
    // : autoPick " builtin",  probe()
    const src = read('src', 'core', 'backends', 'index.js');
    assert(!/\.probe\(/.test(src), 'assertion failed');
    assert(!/mumu|fydeos|ldplayer|bluestacks/i.test(src.replace(/[\s\S]*?const REGISTRY[\s\S]*?\];/, '')), 'assertion failed');
  });

  console.log('\n[  -  ]');

  test('backends/ directory contains only base, builtin, index', () => {
    const files = fs.readdirSync(path.join(ROOT, 'src', 'core', 'backends')).sort();
    assert.deepEqual(files, ['base.js', 'builtin.js', 'index.js'], `: ${files.join(', ')}`);
  });

  test('External emulator modules removed', () => {
    for (const rel of [
      ['src', 'core', 'backends', 'mumu.js'],
      ['src', 'core', 'backends', 'fydeos.js'],
      ['src', 'core', 'mumu-compat.js'],
      ['src', 'core', 'frame.js'],
    ]) {
      assert.equal(exists(...rel), false, `${rel.join('/')} `);
    }
  });

  test('Engine contains no third-party fallback branches', () => {
    const src = read('src', 'core', 'engine.js');
    assert(!/_fallbackFrom/.test(src), 'assertion failed');
    assert(!/backend\.id !== 'builtin'/.test(src), 'id');
    assert(!/engine\.mode === 'attach'/.test(src), 'attach( )');
    assert(!/ATTACH_ENDPOINTS/.test(src), 'adb');
  });

  test('Settings page contains no third-party dropdowns', () => {
    const html = read('src', 'ui', 'index.html');
    assert(!/setEngineMode/.test(html), 'assertion failed');
    assert(!/value="mumu"|value="fydeos"|value="attach"/.test(html), 'assertion failed');
    assert(!/setMumuPath|setMumuMemGB|setMumuCores|setFydeosHost/.test(html), 'assertion failed');
    assert(/id="setEngineLabel"/.test(html), 'assertion failed');
  });

  test('Persistence layer migrates legacy fields', () => {
    const src = read('src', 'core', 'store.js');
    assert(/s\.engine\.mode = 'builtin'/.test(src), 'getSettings mode=builtin');
    assert(/mumuPath/.test(src) && /delete s\.engine\[k\]/.test(src), 'assertion failed');
  });

  test('adb candidate list contains no third-party adb binaries', () => {
    const src = read('src', 'core', 'adb.js');
    const block = src.slice(src.indexOf('const COMMON_ADB_PATHS'), src.indexOf('];', src.indexOf('const COMMON_ADB_PATHS')));
    assert(!/mumu|ldplayer|bluestacks|hd-adb/i.test(block), 'adb');
  });

  console.log('\n[  -  ]');

  test('Guard identifies MuMu binary', () => {
    const d = tmpDir('guard-hit');
    touch(d, 'runtime/MuMuManager.exe');
    const hits = findBundled(d);
    assert.equal(hits.length, 1, ` ${hits.length}`);
    assert.equal(hits[0].vendor, 'MuMu Emulator');
    fs.rmSync(d, { recursive: true, force: true });
  });

  test('Guard identifies MuMu directories', () => {
    for (const dirName of ['nx_main', 'nx_device', 'nemu']) {
      const d = tmpDir('guard-dir');
      fs.mkdirSync(path.join(d, dirName), { recursive: true });
      touch(d, path.join(dirName, 'whatever.bin'));
      assert.equal(findBundled(d).length, 1, `${dirName} `);
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test('Guard identifies LDPlayer / BlueStacks', () => {
    const d = tmpDir('guard-others');
    touch(d, 'runtime/LDPlayer.exe');
    touch(d, 'runtime/Bluestacks.exe');
    const vendors = new Set(findBundled(d).map((h) => h.vendor));
    assert.ok(vendors.has('LDPlayer'), 'assertion failed');
    assert.ok(vendors.has('BlueStacks'), 'assertion failed');
    fs.rmSync(d, { recursive: true, force: true });
  });

  test('Guard does not flag ApkBolt runtime', () => {
    const d = tmpDir('guard-src');
    touch(d, 'app/src/core/backends/builtin.js', 64);
    touch(d, 'app/src/core/resources.js', 64);
    assert.equal(findBundled(d).length, 0, 'assertion failed');
    fs.rmSync(d, { recursive: true, force: true });
  });

  test('Guard blocks third-party adapter source files', () => {
    const d = tmpDir('guard-adapter');
    touch(d, 'app/src/core/backends/mumu.js', 64);
    touch(d, 'app/src/core/backends/fydeos.js', 64);
    touch(d, 'app/src/core/mumu-compat.js', 64);
    const hits = findForbiddenSource(d);
    assert.equal(hits.length, 3, ` ${hits.length}( 3)`);
    const r = assertStandalone(d, { label: '', exit: false });
    assert.equal(r.ok, false, 'assertion failed');
    fs.rmSync(d, { recursive: true, force: true });
  });

  test('Guard does not misidentify standard js files', () => {
    const d = tmpDir('guard-other-js');
    touch(d, 'app/src/render/frame.js', 64);
    touch(d, 'app/src/core/backends/builtin.js', 64);
    assert.equal(findForbiddenSource(d).length, 0, 'core frame.js / builtin.js');
    fs.rmSync(d, { recursive: true, force: true });
  });

  test('Clean runtime directory passes guard', () => {
    const d = tmpDir('guard-clean');
    touch(d, 'runtime/emulator/emulator.exe', 64);
    touch(d, 'runtime/platform-tools/adb.exe', 64);
    const r = assertStandalone(d, { label: '', exit: false });
    assert.equal(r.ok, true, JSON.stringify(r.hits));
    fs.rmSync(d, { recursive: true, force: true });
  });

  test('Missing directory skipped cleanly by guard', () => {
    const r = assertStandalone(path.join(os.tmpdir(), 'apkbolt-not-exist-xyz'), { exit: false });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
  });

  console.log('\n[  -  ]');

  test('Portable build scans resources directory', () => {
    const src = read('build', 'pack.js');
    assert(/assertStandalone\(path\.join\(OUT, 'resources'\)/.test(src), 'pack.js');
  });

  test('MSIX build scans payload app directory', () => {
    const src = read('build', 'msix.js');
    assert(/assertStandalone\(appDir/.test(src), 'msix.js');
  });

  test('Pack includes only build/runtime', () => {
    const yml = read('electron-builder.yml');
    const block = yml.slice(yml.indexOf('extraResources:'));
    const head = block.slice(0, block.indexOf('win:'));
    assert(!/mumu|ldplayer|bluestacks/i.test(head), 'extraResources');
    assert(/build\/runtime/.test(head), 'extraResources');
  });

  console.log(`\n: ${passed} , ${failed} \n`);
  process.exit(failed ? 1 : 0);
})();
