'use strict';
/**
 * issue  Node （//）。
 *  GitHub issues  5 ：
 *  - #2 P0-1：APK  →  / adb
 *  - #2 P0-4：provision/updater  zip-slip
 *  - #2 P1-1：_fetchText  Promise  settle
 *  - #5 1：（）
 *  - #9 8： → （ + ）
 * ：node test/issue-hardening-test.js
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const { validPackageName, safeFilePart } = require('../src/core/pkgname');
const { resolveZipEntry } = require('../src/core/zip');
const store = require('../src/core/store');
const { findUninstaller, Updater } = require('../src/core/updater');
const { Provisioner } = require('../src/core/provision');

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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'apkstart-hardening-'));

(async () => {
  console.log('\n[issue #2 P0-1 · ]');
  test('Android', () => {
    for (const p of ['com.github.tvbox.osc', 'com.tencent.mm', 'org.example.app_2']) {
      assert.equal(validPackageName(p), true, `${p} `);
    }
  });
  test('/ / shell /', () => {
    for (const p of ['../evil', 'com..x', '.com.x', 'com/x', 'com\\x', 'C:evil', 'a;rm -rf', 'a|b',
      'a b', 'a$(id)', 'a`id`', '', 'com.x.', '1com.x', 'com.x-y']) {
      assert.equal(validPackageName(p), false, `${JSON.stringify(p)} `);
    }
  });
  test('unit test verification', () => {
    const safe = safeFilePart('../evil');
    assert.ok(!safe.includes('/') && !safe.includes('\\') && !safe.includes('..'), `：${safe}`);
    assert.equal(safeFilePart('com.ok.pkg'), 'com.ok.pkg');
  });
  test('store /APK', () => {
    const icon = store.iconPath('../../Windows/System32/drivers/etc/hosts');
    const apk = store.apkPath('../../evil', '../../x');
    assert.ok(!icon.includes('..'), ` ..：${icon}`);
    assert.ok(!apk.includes('..'), `APK  ..：${apk}`);
    assert.match(path.basename(apk), /\.apk$/);
  });

  console.log('\n[issue #2 P0-4 · zip-slip]');
  test('unit test verification', () => {
    const root = path.join(TMP, 'zip-ok');
    assert.equal(resolveZipEntry(root, 'emulator/qemu.exe'), path.join(root, 'emulator', 'qemu.exe'));
    assert.equal(resolveZipEntry(root, 'a/b/c.txt'), path.join(root, 'a', 'b', 'c.txt'));
  });
  test('../ / / / / UNC', () => {
    const root = path.join(TMP, 'zip-root');
    for (const n of ['../evil', 'a/../../evil', '/etc/passwd', 'C:\\Windows\\x', 'C:/Windows/x',
      'a\\..\\..\\evil', '\\\\server\\share\\x', 'a/../b']) {
      assert.equal(resolveZipEntry(root, n), null, `${JSON.stringify(n)} `);
    }
  });
  test('provision updater zip-slip', () => {
    const prov = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'provision.js'), 'utf8');
    const upd = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'updater.js'), 'utf8');
    assert.ok(/resolveZipEntry\(/.test(prov), 'provision.extractZip');
    assert.ok(/resolveZipEntry\(/.test(upd), 'updater._extract');
  });

  console.log('\n[issue #2 P1-1 · _fetchText ]');
  await atest('Promise 、 settle', async () => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': String(64 * 1024) });
      res.end(Buffer.alloc(64 * 1024, 0x61));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/index.xml`;
    try {
      const p = new Provisioner({});
      const out = await Promise.race([
        p._fetchText(url, 1024),
        new Promise((_, rej) => setTimeout(() => rej(new Error('_fetchText ')), 5000)),
      ]);
      assert.equal(out, '', '，');
    } finally {
      srv.close();
    }
  });
  test('_fetchText settle', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'provision.js'), 'utf8');
    assert.ok(/let done = false/.test(src) && /const finish = \(\) =>/.test(src), 'assertion failed');
    assert.ok(/setTimeout/.test(src), 'assertion failed');
  });

  console.log('\n[issue #5 1 · ]');
  test('electron-builder Uninstall X.exe', () => {
    const dir = path.join(TMP, 'uninst-a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Uninstall ApkStart.exe'), 'x');
    assert.equal(findUninstaller(dir), 'Uninstall ApkStart.exe');
  });
  test('uninstaller.exe', () => {
    const dir = path.join(TMP, 'uninst-b');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'uninstaller.exe'), 'x');
    assert.equal(findUninstaller(dir), 'uninstaller.exe');
  });
  test('（ ） null', () => {
    const dir = path.join(TMP, 'uninst-c');
    fs.mkdirSync(dir, { recursive: true });
    assert.equal(findUninstaller(dir), null);
  });

  console.log('\n[issue #9 8 · ]');
  await atest('， / exe', async () => {
    const dataDir = path.join(TMP, 'upd-resume');
    const exe = path.join(dataDir, 'ApkStart.exe');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(exe, 'x');
    const u = new Updater({ currentVersion: '0.5.3', exePath: exe, isPackaged: true, dataDir });

    const payload = path.join(dataDir, 'update', '0.5.4', 'payload');
    fs.mkdirSync(payload, { recursive: true });
    fs.writeFileSync(path.join(payload, 'ApkStart.exe'), 'new');
    assert.equal(u.findResumableJob(), null, 'assertion failed');
    u._markPayloadReady(payload, '0.5.4');
    const job = u.findResumableJob();
    assert.ok(job && job.version === '0.5.4', '0.5.4');

    // →
    const cur = new Updater({ currentVersion: '0.5.4', exePath: exe, isPackaged: true, dataDir });
    assert.equal(cur.findResumableJob(), null, 'assertion failed');
    // →
    fs.writeFileSync(u._readyFile(payload), JSON.stringify({ version: '0.5.2' }));
    assert.equal(u.findResumableJob(), null, 'assertion failed');
  });
  test('apply ， 、', () => {
    const dataDir = path.join(TMP, 'upd-apply');
    const exe = path.join(dataDir, 'ApkStart.exe');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(exe, 'old');
    const u = new Updater({ currentVersion: '0.5.3', exePath: exe, isPackaged: true, dataDir });
    const payload = path.join(dataDir, 'update', '0.5.4', 'payload');
    fs.mkdirSync(payload, { recursive: true });
    fs.writeFileSync(path.join(payload, 'ApkStart.exe'), 'new-version-bytes');
    const script = u.apply({ mode: 'zip', payload, version: '0.5.4' }, { spawn: false });
    assert.ok(/\(Get-Item \$target\)\.Length -eq \$expected/.test(script), 'exe');
    assert.ok(/keeping payload for next launch/.test(script), 'assertion failed');
    assert.ok(/Start-Process -FilePath/.test(script) && /cmd\.exe/.test(script), 'assertion failed');
  });

  console.log(`\n：${passed} ，${failed} \n`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('  ：', e.stack || e.message);
  process.exit(1);
});
