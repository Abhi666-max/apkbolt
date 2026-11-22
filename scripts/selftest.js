'use strict';
/**
 * runtime()
 *
 * npm run selftest # checkupruntime
 * npm run selftest -- --apk a.apk # install → launch → → directory
 *
 * :  Android , "app, window, sharing"
 * , . 
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../src/core/store');
const { Runtime } = require('../src/core/engine');
const { Sharer } = require('../src/core/sharer');
const { parseApk } = require('../src/core/apk');

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : '';
};
const APK = argOf('--apk');
// = pathruntime serial; 
const SERIAL = argOf('--serial') || '';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const mark = ok === null ? '○' : ok ? '✓' : '✗';
  console.log(`  ${mark} ${name}${detail ? `  -  ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(name, fn) {
  process.stdout.write('');
  try {
    const detail = await fn();
    record(name, true, detail || '');
    return true;
  } catch (e) {
    record(name, e && e.skipped ? null : false, e.message);
    return false;
  }
}

(async () => {
  console.log('\nApkStart ');
  console.log(`: ${SERIAL}`);
  console.log('─'.repeat(64));

  console.log('\n[]');
  const runtime = new Runtime(path.join(__dirname, '..'));
  const prov = runtime.provisioner;

  let env = null;
  await step('adb', async () => {
    env = await prov.checkEnv();
    if (!env.adb.ok) throw new Error(' adb, ""');
    return `v${env.adb.version}`;
  });
  await step('Android Emulator', async () => {
    if (!env.emulator.ok) throw new Error(', ""');
    return `v${env.emulator.version}`;
  });
  await step('unit test verification', async () => {
    if (!env.sysimg.ok) throw new Error(env.sysimg.note || '');
    return `Android ${env.sysimg.api}  -  ${(env.sysimg.size / 1073741824).toFixed(2)}GB`;
  });
  record('', env.accel.ok ? true : null,
    env.accel.ok ? env.accel.note : '(, )');

  console.log('\n[]');
  let client = runtime.client(SERIAL || undefined);
  const online = await step('unit test verification', async () => {
    if (SERIAL) {
      await client.connect().catch(() => false);
      if (!await client.isOnline()) throw new Error(`: ${SERIAL}`);
      return SERIAL;
    }
    const r = await runtime.ensure({ onLog: () => {} });
    if (!r.ok) throw new Error(r.error || '');
    client = r.client;
    return client.serial;
  });

  if (!online) {
    console.log('\n, . ');
  } else {
    await step('Android', async () => {
      const [ver, sdk, abi] = await Promise.all([
        client.androidVersion(), client.sdkInt(), client.shell('getprop ro.product.cpu.abi').catch(() => ''),
      ]);
      if (!ver) throw new Error('');
      return `Android ${ver} (API ${sdk})  -  ${String(abi).trim()}`;
    });
    await step('unit test verification', async () => {
      const s = await client.wmSize();
      if (!s) throw new Error('wm size ');
      return `${s.width}×${s.height}`;
    });
    await step('freeform', async () => {
      const ok = await client.ensureFreeform();
      if (!ok) throw new Error(' freeform()');
      return '';
    });

    console.log('\n[]');
    await step('unit test verification', async () => {
      const sharer = new Sharer(runtime);
      await client.shellMkdir(store.getSettings().deviceSharedDir);
      const localDir = store.getSettings().sharedDir;
      fs.mkdirSync(localDir, { recursive: true });
      const probe = path.join(localDir, `selftest-${Date.now()}.txt`);
      const payload = `apkstart selftest ${new Date().toISOString()}`;
      fs.writeFileSync(probe, payload);

      const up = await sharer.sync();
      if (up.errors && up.errors.length) throw new Error(up.errors[0]);
      const remote = `${store.getSettings().deviceSharedDir}/${path.basename(probe)}`;
      const back = await client.shell(`cat "${remote}" 2>/dev/null`);
      if (!String(back).includes('apkstart selftest')) throw new Error(' →  ');

      const reverse = path.join(localDir, `selftest-from-device-${Date.now()}.txt`);
      await client.shell(`echo device-side > "${store.getSettings().deviceSharedDir}/${path.basename(reverse)}"`);
      await sharer.sync();
      if (!fs.existsSync(reverse) || !fs.readFileSync(reverse, 'utf8').includes('device-side')) {
        throw new Error(' →  ');
      }
      fs.rmSync(probe, { force: true });
      fs.rmSync(reverse, { force: true });
      await client.shell(`rm -f "${remote}"`);
      return ' + ';
    });

    if (APK) {
      console.log('\n[]');
      let meta = null;
      await step('APK', async () => {
        meta = parseApk(APK);
        return `${meta.label} (${meta.package} v${meta.versionName})`;
      });
      if (meta) {
        await step('unit test verification', async () => {
          await client.install(APK);
          const installed = await client.isInstalled(meta.package);
          if (!installed) throw new Error('pm path ');
          return 'pm path ';
        });
        await step('unit test verification', async () => {
          await client.startApp(meta.package, meta.launchActivity, { freeform: true });
          await sleep(4000);
          const top = await client.shell('dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity"');
          if (!String(top).includes(meta.package)) throw new Error('');
          return meta.package;
        });
        await step('unit test verification', async () => {
          const png = await client.screenshot();
          const out = path.join(__dirname, '..', 'test', 'out');
          fs.mkdirSync(out, { recursive: true });
          const file = path.join(out, 'selftest.png');
          fs.writeFileSync(file, png);
          if (png.length < 4096) throw new Error('');
          return file;
        });
      }
    } else {
      console.log('\n[]  --apk, ');
    }
  }

  // runtime:  emulator stdio
  // Node exit, ""
  if (!SERIAL && runtime.emulator.running()) {
    await runtime.stop({}).catch(() => {});
  }

  const failed = results.filter((r) => r.ok === false);
  console.log('\n' + '─'.repeat(64));
  console.log(`: ${results.filter((r) => r.ok === true).length} , ${failed.length} , `
    + `${results.filter((r) => r.ok === null).length} `);
  if (failed.length) {
    console.log(': ');
    failed.forEach((f) => console.log(`   -  ${f.name}: ${f.detail}`));
    process.exit(1);
  }
  console.log(' ✅\n');
  process.exit(0);
})().catch((e) => {
  console.error('\n: ', e.message);
  process.exit(1);
});
