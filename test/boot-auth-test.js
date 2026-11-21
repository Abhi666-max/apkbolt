'use strict';
/**
 *  /  Node （、）。
 *  0.5.3 ：
 *  1) 「 USB 」 →  device unauthorized →
 *      240s×4 。： unauthorized、、
 *     。
 *  2) PackageManager  installed=true， /data/app / →
 *     am start 。：isInstalled  APK 。
 * ：node test/boot-auth-test.js
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {
  AdbClient, parseDeviceState, isUnauthorizedError, parsePmPaths,
} = require('../src/core/adb');

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

const adbDevices = (line) => `List of devices attached\n${line}\n`;

(async () => {
  console.log('\n[adb ]');
  test('unauthorized authorized （get-state ）', () => {
    assert.equal(parseDeviceState(adbDevices('emulator-5554\tunauthorized'), 'emulator-5554'), 'unauthorized');
    assert.equal(parseDeviceState(adbDevices('emulator-5554\tdevice'), 'emulator-5554'), 'device');
  });
  test('offline / no permissions /', () => {
    assert.equal(parseDeviceState(adbDevices('emulator-5554\toffline'), 'emulator-5554'), 'offline');
    assert.equal(parseDeviceState(adbDevices('emulator-5554\tno permissions'), 'emulator-5554'), 'unauthorized');
    assert.equal(parseDeviceState(adbDevices(''), 'emulator-5554'), 'no-device');
  });
  test('serial ，', () => {
    const out = adbDevices('emulator-5556\tdevice\nemulator-5554\tunauthorized');
    assert.equal(parseDeviceState(out, 'emulator-5554'), 'unauthorized');
  });
  test('unauthorized（ ADB_VENDOR_KEYS ）', () => {
    assert.equal(isUnauthorizedError('error: device unauthorized.'), true);
    assert.equal(isUnauthorizedError("This adb server's $ADB_VENDOR_KEYS is not set. error: device unauthorized"), true);
    assert.equal(isUnauthorizedError('error: device offline'), false);
    assert.equal(isUnauthorizedError('error: no devices/emulators found'), false);
  });

  console.log('\n[pm path  + ]');
  test('pm path （split APK）', () => {
    const out = 'package:/data/app/~~x/com.foo-1/base.apk\npackage:/data/app/~~x/com.foo-1/split_arm64.apk\n';
    assert.deepEqual(parsePmPaths(out), [
      '/data/app/~~x/com.foo-1/base.apk',
      '/data/app/~~x/com.foo-1/split_arm64.apk',
    ]);
  });
  test('pm path =', () => {
    assert.deepEqual(parsePmPaths(''), []);
    assert.deepEqual(parsePmPaths('Error: package not found'), []);
  });

  await atest('PM APK → isInstalled false', async () => {
    const c = Object.create(AdbClient.prototype);
    c.shell = async (cmd) => {
      if (cmd.startsWith('pm path')) return 'package:/data/app/~~x/com.foo-1/base.apk';
      // ：， PRESENT
      return '';
    };
    assert.equal(await c.isInstalled('com.foo'), false);
  });
  await atest('APK → isInstalled true', async () => {
    const c = Object.create(AdbClient.prototype);
    c.shell = async (cmd) => {
      if (cmd.startsWith('pm path')) return 'package:/data/app/~~x/com.foo-1/base.apk';
      return '__APKSTART_PRESENT__';
    };
    assert.equal(await c.isInstalled('com.foo'), true);
  });
  await atest('→ （ ）', async () => {
    const c = Object.create(AdbClient.prototype);
    const seen = [];
    c.shell = async (cmd) => {
      if (cmd.startsWith('pm path')) {
        return 'package:/data/app/~~x/com.foo/base.apk\npackage:/data/app/~~x/com.foo/split.apk';
      }
      seen.push(cmd);
      return ''; // [ -s ]
    };
    assert.equal(await c.isInstalled('com.foo'), false);
    assert.ok(seen.some((s) => s.includes('/data/app/~~x/com.foo/split.apk')), 'assertion failed');
  });

  console.log('\n[]');
  await atest('adb unauthorized →', async () => {
    const emu = Object.create(require('../src/core/emulator').EmulatorEngine.prototype);
    emu.port = 5554; // serial  getter：emulator-${port}
    emu._log = [];   // log()  push
    emu._adbGuestHealthy = async () => false;
    const ok = await emu._saveViaAdb('adb');
    assert.equal(ok, false, 'assertion failed');
  });
  await atest('：', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'emulator.js'), 'utf8');
    const fn = src.slice(src.indexOf('async _saveViaAdb('), src.indexOf('async _saveViaAdb(') + 700);
    assert.ok(/_adbGuestHealthy/.test(fn), '_saveViaAdb guest');
    const stopFn = src.slice(src.indexOf('async stop('), src.indexOf('async stop(') + 2400);
    assert.ok(/_adbGuestHealthy/.test(stopFn), 'stop()');
    assert.ok(/invalidateSnapshot\(\)/.test(stopFn), 'assertion failed');
  });
  await atest('： unauthorized', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'engine.js'), 'utf8');
    const boot = src.slice(src.indexOf('async bootEmulator('), src.indexOf('async bootEmulator(') + 4200);
    assert.ok(/isUnauthorizedError/.test(boot), 'unauthorized');
    assert.ok(/deviceState\(\)/.test(boot), 'devices state');
    assert.ok(/invalidateSnapshot\(\)/.test(boot), 'assertion failed');
    assert.ok(/_coldBoot = true/.test(boot), 'adb');
    assert.ok(/ADB_UNAUTHORIZED/.test(boot), '，');
  });
  await atest('adb server ADB_VENDOR_KEYS host/guest', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'adb.js'), 'utf8');
    assert.ok(/ADB_VENDOR_KEYS/.test(src), 'adb');
  });

  console.log(`\n：${passed} ，${failed} \n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('  ：', e.stack || e.message);
  process.exit(1);
});
