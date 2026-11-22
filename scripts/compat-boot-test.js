'use strict';
/* : path boot(API 34 Play system image)→ abilist → ARM APK → launch */
process.env.ANDROID_ADB_SERVER_PORT = process.env.ANDROID_ADB_SERVER_PORT || '5038';
const fs = require('fs');
const path = require('path');
const store = require('../src/core/store');
const { Runtime } = require('../src/core/engine');

const ROOT = path.join(__dirname, '..');
const APK = process.argv[2] || 'D:\\.apk';

(async () => {
  store.saveSettings({ runtime: { compatImage: true } });
  const rt = new Runtime(ROOT);

  console.log('[1] ensure()( →  Google Play / API 34 )');
  const r = await rt.ensure({
    onLog: (m) => console.log('    [boot]', m),
  });
  if (!r.ok) { console.error('    ensure :', r.error || JSON.stringify(r).slice(0, 300)); process.exit(1); }
  console.log('    engine =', r.engine, r.reused ? '()' : '');

  const c = rt.client();
  console.log('[2] release =', await c.shell('getprop ro.build.version.release'));
  console.log('    sdk     =', await c.shell('getprop ro.build.version.sdk'));
  console.log('    abilist =', await c.shell('getprop ro.product.cpu.abilist'));
  console.log('    tag     =', await c.shell('getprop ro.build.tags'));

  if (APK && fs.existsSync(APK)) {
    console.log('[3]  ARM APK()...');
    const ins = await c.install(APK);
    console.log('    install =', JSON.stringify(ins).slice(0, 160));
    await c.shell('am start -n com.phoenix.read/com.dragon.read.pages.splash.SplashActivity');
    await new Promise((res) => setTimeout(res, 20000));
    const ps = await c.shell('ps -A | grep phoenix');
    console.log('[4]  20s :', ps ? ' ✓' : ' ✗');
  } else {
    console.log('[3]  APK (', APK, ')');
  }

  console.log('[5] ');
  store.saveSettings({ runtime: { compatImage: false } });
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
