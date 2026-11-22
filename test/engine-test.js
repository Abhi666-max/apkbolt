'use strict';
/**
 * ( QEMU / adb / Android)
 * : (), ZIP , , QEMU , monitor 
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

// , 
const TMP = path.join(os.tmpdir(), `apkbolt-test-${Date.now()}`);
process.env.APPDATA = TMP;
fs.mkdirSync(path.join(TMP, 'apkbolt'), { recursive: true });

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  return Promise.resolve()
    .then(() => { console.log(`  RUN: ${name}`); return fn(); })
    .then(() => { passed++; console.log(`  ✓ ${name}`); results.push(`  ✓ ${name}`); })
    .catch((e) => { failed++; console.log(`  ✗ ${name} (${e.message})`); results.push(`  ✗ ${name}\n    ${e.message}`); });
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

(async () => {
  console.log('\n[download.js]');
  const { download, downloadParallel, head, sha256File } = require('../src/core/download');

  // HTTP ( Range )
  const payload = Buffer.alloc(300 * 1024);
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251;

  const server = http.createServer((req, res) => {
    if (req.url === '/big.bin') {
      const range = req.headers.range;
      if (range) {
        const start = Number(/bytes=(\d+)-/.exec(range)[1]);
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${payload.length - 1}/${payload.length}`,
          'Content-Length': payload.length - start,
        });
        return res.end(payload.subarray(start));
      }
      res.writeHead(200, { 'Content-Length': payload.length });
      return res.end(payload);
    }
    // start-end  Range()
    if (req.url === '/ranged.bin') {
      server.rangeHits = (server.rangeHits || 0) + 1;
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
      if (!range) {
        res.writeHead(200, { 'Content-Length': payload.length, 'Accept-Ranges': 'bytes' });
        return res.end(payload);
      }
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), payload.length - 1);
      res.writeHead(206, {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${payload.length}`,
        'Content-Length': end - start + 1,
      });
      return res.end(payload.subarray(start, end + 1));
    }
    // Range
    if (req.url === '/norange.bin') {
      res.writeHead(200, { 'Content-Length': payload.length, 'Accept-Ranges': 'none' });
      return res.end(payload);
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/big.bin' });
      return res.end();
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  await test('+', async () => {
    const dest = path.join(TMP, 'dl1.bin');
    await download(`http://127.0.0.1:${port}/redirect`, dest);
    assert(fs.statSync(dest).size === payload.length, 'assertion failed');
  });

  await test('( )', async () => {
    const dest = path.join(TMP, 'dl2.bin');
    fs.writeFileSync(dest, payload.subarray(0, 100000));
    let lastPercent = 0;
    await download(`http://127.0.0.1:${port}/big.bin`, dest, {
      onProgress: (p) => { lastPercent = p.percent; },
    });
    assert(fs.statSync(dest).size === payload.length, ` ${fs.statSync(dest).size}`);
    assert(fs.readFileSync(dest).equals(payload), 'assertion failed');
    assert(lastPercent > 50, 'assertion failed');
  });

  await test('HEAD + SHA256', async () => {
    const h = await head(`http://127.0.0.1:${port}/big.bin`);
    assert(h.size === payload.length, 'HEAD');
    const sum = await sha256File(path.join(TMP, 'dl1.bin'));
    assert(/^[0-9a-f]{64}$/.test(sum), 'sha256');
  });

  await test('SHA256', async () => {
    const dest = path.join(TMP, 'dl3.bin');
    let threw = false;
    try {
      await download(`http://127.0.0.1:${port}/big.bin`, dest, { expectSha256: 'deadbeef'.repeat(8) });
    } catch (_) { threw = true; }
    assert(threw, 'assertion failed');
    assert(!fs.existsSync(dest), 'assertion failed');
  });

  await test(': ', async () => {
    const dest = path.join(TMP, 'dl4.bin');
    server.rangeHits = 0;
    let maxPercent = 0;
    const r = await downloadParallel(`http://127.0.0.1:${port}/ranged.bin`, dest, {
      connections: 8,
      minChunk: 32 * 1024,
      onProgress: (p) => { maxPercent = Math.max(maxPercent, p.percent); },
    });
    assert(fs.readFileSync(dest).equals(payload), 'assertion failed');
    assert(r.parallel > 1, `: ${r.parallel}`);
    assert(server.rangeHits >= r.parallel, `: ${server.rangeHits}`);
    assert(maxPercent > 0, 'assertion failed');
  });

  await test('Range', async () => {
    const dest = path.join(TMP, 'dl5.bin');
    const r = await downloadParallel(`http://127.0.0.1:${port}/norange.bin`, dest, {
      connections: 8,
      minChunk: 32 * 1024,
    });
    assert(fs.readFileSync(dest).equals(payload), 'assertion failed');
    assert(!r.parallel, 'assertion failed');
  });

  server.close();

  console.log('\n[provision.js]');
  const { Provisioner } = require('../src/core/provision');
  const store = require('../src/core/store');

  await test('unit test verification', async () => {
    const p = new Provisioner('C:/fake/app');
    assert(p.paths().root.startsWith(store.DATA_DIR), `: ${p.paths().root}`);
    assert(p.paths().qemuExe.endsWith('qemu-system-x86_64.exe'), 'qemu');
    assert(p.paths().adbExe.endsWith('adb.exe'), 'adb');
  });

  await test(': adb , ', async () => {
    const p = new Provisioner(path.join(TMP, 'nonexistent'));
    const env = await p.checkEnv();
    assert(env.adb.ok === false, 'adb');
    // QEMU ( winget  Program Files), 
    if (env.qemu.ok) assert(env.qemu.version, 'qemu');
    assert(env.ready === false, 'assertion failed');
    assert(typeof env.hypervisor.whpx === 'boolean', 'assertion failed');
  });

  await test('ZIP', async () => {
    const { ZipArchive } = require('../src/core/zip');
    // stored  zip
    const name = Buffer.from('platform-tools/adb.exe');
    const data = Buffer.from('fake-adb-binary');
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(0, 8);
    loc.writeUInt32LE(data.length, 18);
    loc.writeUInt32LE(data.length, 14);
    loc.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt32LE(data.length, 20);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(46 + name.length, 12);
    eocd.writeUInt32LE(30 + name.length + data.length, 16);
    const zipPath = path.join(TMP, 'pt.zip');
    fs.writeFileSync(zipPath, Buffer.concat([loc, name, data, cen, name, eocd]));

    const out = path.join(TMP, 'unzip');
    const p = new Provisioner(TMP);
    await p.extractZip(zipPath, out);
    assert(fs.readFileSync(path.join(out, 'platform-tools', 'adb.exe')).toString() === 'fake-adb-binary', 'assertion failed');
    assert(new ZipArchive(fs.readFileSync(zipPath)).has('platform-tools/adb.exe'), 'zip');
  });

  await test('SDK url', async () => {
    const { absUrl, baseOf, SOURCES } = require('../src/core/provision');
    // repository2-3.xml(emulator)
    assert(absUrl('emulator-windows_x64-16847572.zip') === `${baseOf(SOURCES.sdkIndex)}emulator-windows_x64-16847572.zip`, 'emulator');
    // sys-img  sys-img/android/, 
    const sysBase = baseOf(SOURCES.sysImgIndexes[0]);
    assert(sysBase.endsWith('/sys-img/android/'), `sys-img : ${sysBase}`);
    assert(absUrl('x86_64-30_r11.zip', sysBase) === 'https://dl.google.com/android/repository/sys-img/android/x86_64-30_r11.zip', 'sys-img');
    
    assert(absUrl('https://example.com/a.zip') === 'https://example.com/a.zip', 'assertion failed');
  });

  await test('emulator / URL', async () => {
    const p = new Provisioner(TMP);
    const emuUrl = await p.resolveEmulatorUrl();
    const imgUrl = await p.resolveSysimgUrl();
    for (const u of [emuUrl, imgUrl]) {
      assert(/^https?:\/\//i.test(u), ` URL: ${u}`);
      assert(/\.zip$/i.test(u), ` zip : ${u}`);
    }
    assert(/windows_x64/i.test(emuUrl), `emulator : ${emuUrl}`);
  });

  await test('AVD 64 (x86_64 x86)', async () => {
    const { EmulatorEngine } = require('../src/core/emulator');
    const emu = new EmulatorEngine(TMP);
    const r = emu.ensureAvd({ memoryMB: 2048, cores: 2 });
    const cfg = fs.readFileSync(path.join(r.avdDir, 'config.ini'), 'utf8');
    assert(/^hw\.cpu\.arch=x86_64$/m.test(cfg), `hw.cpu.arch  x86_64, : ${cfg.match(/^hw\.cpu\.arch=.*$/m)}`);
    assert(/^abi\.type=x86_64$/m.test(cfg), 'abi.type x86_64');
    assert(/^image\.sysdir\.1=\S*system-images\//m.test(cfg), 'image.sysdir.1');
  });

  await test(': NO_MATCHING_ABIS', async () => {
    const { friendlyInstallError } = require('../src/core/adb');
    const out = friendlyInstallError(
      'Performing Streamed Install\nadb.exe: failed to install x.apk: '
      + 'Failure [INSTALL_FAILED_NO_MATCHING_ABIS: Failed to extract native libraries, res=-113]',
    );
    assert(out.includes('ARM ') || out.includes('ARM native libraries'), ` ARM : ${out}`);
    assert(out.includes('INSTALL_FAILED_NO_MATCHING_ABIS'), 'assertion failed');
    const other = friendlyInstallError('Failure [INSTALL_FAILED_INVALID_APK: x]');
    assert(other.includes('') || other.includes('') || other.includes('corrupted') || other.includes('incomplete'), `: ${other}`);
  });

  await test(':  ISO9660 / /', async () => {
    const p = new Provisioner(TMP);
    const mk = (file, size, writeMagic) => {
      const fd = fs.openSync(file, 'w');
      fs.ftruncateSync(fd, size);
      if (writeMagic) {
        fs.writeSync(fd, Buffer.from([1]), 0, 1, 0x8000);
        fs.writeSync(fd, Buffer.from('CD001', 'latin1'), 0, 5, 0x8001);
      }
      fs.closeSync(fd);
      return file;
    };

    const good = mk(path.join(TMP, 'good.iso'), 450 * 1024 * 1024, true);
    const a = p.inspectIso(good);
    assert(a.ok && a.iso9660, ` ISO : ${a.reason}`);

    const broken = mk(path.join(TMP, 'broken.iso'), 450 * 1024 * 1024, false);
    const b = p.inspectIso(broken);
    assert(!b.ok && (/ISO9660|not a valid ISO/i.test(b.reason)), `: ${JSON.stringify(b)}`);

    const partial = mk(path.join(TMP, 'partial.iso'), 2 * 1024 * 1024, true);
    const c = p.inspectIso(partial);
    assert(!c.ok && (/incomplete/i.test(c.reason)), `: ${JSON.stringify(c)}`);

    for (const f of [good, broken, partial]) fs.rmSync(f, { force: true });
  });

  await test('stat ( mtime,  )', async () => {
    const { parseStatList } = require('../src/core/adb');
    const rows = parseStatList('1794309868|1234|./a.txt\n1794309900|99|./sub/b.png');
    assert(rows && rows.length === 2, `: ${JSON.stringify(rows)}`);
    assert(rows[0].rel === 'a.txt' && rows[0].size === 1234, 'assertion failed');
    assert(rows[1].rel === 'sub/b.png', 'assertion failed');
    assert(rows[1].mtime === 1794309900000, 'mtime');
    assert(parseStatList('ls: /nope: No such file') === null, 'stat null');
    assert(Array.isArray(parseStatList('')) && parseStatList('').length === 0, 'assertion failed');
  });

  console.log('\n[engine.js]');
  const { Runtime } = require('../src/core/engine');

  await test('QEMU :  ISO', async () => {
    const rt = new Runtime(TMP);
    rt._hv = { whpx: true };
    store.saveSettings({
      runtime: { isoPath: 'C:/img/android.iso', diskPath: 'C:/img/disk.qcow2' },
      engine: { memoryMB: 4096, cores: 4 },
    });
    const args = rt.buildArgs({ install: true }).join(' ');
    assert(args.includes('-cdrom C:/img/android.iso'), '-cdrom');
    assert(/order=d/.test(args), 'assertion failed');
    assert(/accel=whpx/.test(args), 'WHPX');
    assert(/-cpu host/.test(args), 'WHPX host CPU');
    assert(/hostfwd=tcp:127\.0\.0\.1:5555-:5555/.test(args), 'adb');
    assert(args.includes('-monitor tcp:127.0.0.1:5556'), 'monitor');
    assert(/-m 4096/.test(args), 'assertion failed');
  });

  await test('QEMU : ', async () => {
    const rt = new Runtime(TMP);
    rt._hv = { whpx: false };
    const args = rt.buildArgs({ install: false }).join(' ');
    assert(!args.includes('-cdrom'), 'ISO');
    assert(/order=c/.test(args), 'assertion failed');
    assert(/accel=tcg/.test(args), 'WHPX TCG');
    assert(/-cpu max/.test(args), 'TCG max CPU');
    assert(args.includes('if=virtio,format=qcow2'), 'assertion failed');
  });

  await test('headless', async () => {
    const rt = new Runtime(TMP);
    rt._hv = { whpx: false };
    const args = rt.buildArgs({ headless: true }).join(' ');
    assert(args.includes('-display none'), 'assertion failed');
  });

  await test('QEMU monitor : ', async () => {
    // QEMU monitor:  "(qemu) ",  ok
    const srv = net.createServer((sock) => {
      sock.write('QEMU 8.2.0 monitor - type \'help\' for more information\r\n(qemu) ');
      sock.on('data', (d) => {
        srv.lastCmd = d.toString().trim();
        sock.write('ok\r\n(qemu) ');
      });
    });
    await new Promise((r) => srv.listen(5556, '127.0.0.1', r));

    const rt = new Runtime(TMP);
    await rt.monitorCmd('system_powerdown');
    assert(srv.lastCmd === 'system_powerdown', `: ${srv.lastCmd}`);
    await new Promise((r) => srv.close(r));
  });

  await test('ensure needsSetup', async () => {
    store.saveSettings({ runtime: { installed: false }, engine: { mode: 'builtin' } });
    const rt = new Runtime(TMP);
    // adb  isOnline
    const r = await rt.ensure({ onLog: () => {} });
    assert(r.ok === false, 'assertion failed');
    assert(['provision', 'install'].includes(r.needsSetup), `needsSetup=${r.needsSetup}`);
  });

  await test('( ,  )', async () => {
    const rt = new Runtime(TMP);
    rt.provisioner.checkEnv = async () => ({ adb: { ok: true }, emulator: { ok: true }, sysimg: { ok: true } });
    rt.emulator.setPriority = async () => 0;
    let calls = 0;
    rt._ensureInner = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 60));
      return { ok: true, engine: 'emulator' };
    };
    // ( 4 )(ensure)
    const [a, b] = await Promise.all([rt.prewarm({}), rt.ensure({})]);
    assert(calls === 1, ` ${calls} , `);
    assert(a && a.ok && b && b.ok, 'assertion failed');
  });

  await test(':  boot_completed +', async () => {
    const rt = new Runtime(TMP);
    const calls = [];
    const fake = {
      isOnline: async () => true,
      connect: async () => true,
      shell: async (cmd) => {
        calls.push(cmd);
        if (cmd.includes('sys.boot_completed')) return '1';
        if (cmd.includes('pm path android')) return 'package:/system/framework/framework-res.apk';
        return '';
      },
    };
    const r = await rt.waitAndroidReady(fake, 5000, () => {});
    assert(r.ok, 'assertion failed');
    assert(calls.some((c) => c.includes('sys.boot_completed')), 'boot_completed');
    assert(calls.some((c) => c.includes('pm path android')), 'assertion failed');
  });

  await test('(kernel)', async () => {
    const rt = new Runtime(TMP);
    const fake = { isOnline: async () => true, connect: async () => true, shell: async () => '0' };
    const r = await rt.waitAndroidReady(fake, 1200, () => {});
    assert(!r.ok && r.stage === 'kernel', ` kernel : ${JSON.stringify(r)}`);
  });

  console.log('\n[provision.js  / ]');

  await test('playImageInfo API 34', async () => {
    const prov = new Provisioner(path.join(__dirname, '..'));
    const p = prov.paths();
    const dir = p.sysImgDir;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'kernel-ranchu'), 'k');
    fs.writeFileSync(path.join(dir, 'system.img'), Buffer.alloc(64));
    assert(!prov.playImageInfo().ok, 'assertion failed');
    fs.writeFileSync(path.join(dir, 'system.img'), Buffer.alloc(301 * 1024 * 1024));
    const info = prov.playImageInfo();
    assert(info.ok && info.api === '34' && info.tag === 'google_apis_playstore', ` API 34 : ${JSON.stringify(info)}`);
  });

  await test('unit test verification', async () => {
    const root = path.join(__dirname, '..');
    assert(fs.existsSync(path.join(root, 'src', 'ui', 'assets', 'logo.png')), 'logo.png');
    assert(fs.existsSync(path.join(root, 'src', 'ui', 'assets', 'appicon.ico')), 'appicon.ico');
    assert(fs.existsSync(path.join(root, 'build', 'prepare-runtime.js')), 'assertion failed');
    const html = fs.readFileSync(path.join(root, 'src', 'ui', 'index.html'), 'utf8');
    assert(html.includes('ApkBolt'), 'ApkBolt');
  });

  console.log(results.join('\n'));
  console.log(`\n: ${passed} , ${failed} \n`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(failed ? 1 : 0);
})();
