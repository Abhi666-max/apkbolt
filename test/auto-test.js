'use strict';
/**
 * Zero-config adaptive / container regression tests (pure Node)
 * Run: node test/auto-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), `apkstart-auto-test-${Date.now()}`);
process.env.APPDATA = TMP;
fs.mkdirSync(path.join(TMP, 'apkstart'), { recursive: true });

let passed = 0;
let failed = 0;
const results = [];
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed += 1; results.push(`  ✓ ${name}`); })
    .catch((e) => { failed += 1; results.push(`  ✗ ${name}\n    ${e.stack || e.message}`); });
}
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }

const doctor = require('../src/core/doctor');
const layers = require('../src/core/layers');
const pointer = require('../src/core/pointer');
const { AdbClient, friendlyInstallError, friendlyLaunchError } = require('../src/core/adb');

(async () => {
  console.log('\n[doctor.js ]');

  await test('Select GPU backend based on emulator version (new version host priority + software fallback, legacy swiftshader_indirect)', () => {
    // gpuCandidates  GPU (AMD  swangle ), 
    // "". 
    const c37 = doctor.gpuCandidates('37.3.8.0');
    assert(c37.includes('host'), '37.x host');
    assert(c37.includes('swangle'), '37.x swangle');
    assert(c37.includes('software'), 'assertion failed');
    // 37.x  swiftshader_indirect  GL , 
    assert(!c37.includes('swiftshader_indirect'));
    // swiftshader_indirect
    const c35 = doctor.gpuCandidates('35.1.4.0');
    assert(c35.includes('host'));
    assert(c35.includes('swiftshader_indirect'));
    // detectGpuVendor  unknown()
    const v = doctor.detectGpuVendor();
    assert(['nvidia', 'amd', 'intel', 'unknown'].includes(v), `detectGpuVendor : ${v}`);
  });

  await test('Low memory system automatic down-scaling (no longer hardcoded 4GB / 4 cores)', () => {
    const host = { totalMB: 4096, freeMB: 2600, cores: 2, home: 'C:\\Users\\x', homeAscii: true, tmp: TMP, platform: 'win32', arch: 'x64', rdp: false };
    const p = doctor.chooseProfile({ host, accel: { ok: false }, emulatorVersion: '37.3.8.0', diskMB: 20000, port: 5554, adbPort: 5044 });
    assert(p.memoryMB === 2048, ` 2048,  ${p.memoryMB}`);
    assert(p.cores === 2, ` 2,  ${p.cores}`);
    assert(p.accel === 'off', 'Fallback to software emulation when acceleration is unavailable');
    assert(p.bootTimeoutMs > 240000, 'Software emulation receives extended boot timeout');
    assert(p.gpu === 'host' || p.gpu === 'swangle', ` host  swangle(AMD  swangle ),  ${p.gpu}`);
    // accel ,  TCG  GPU
    const lastResort = doctor.planVariants(p).find((v) => v.lastResort);
    assert(lastResort && /software|swiftshader/.test(lastResort.gpu), 'Fallback profile must use software rendering');
    // 4/6/8GB( 16G), 
    assert(p.dataMB >= 4096 && p.dataMB <= 8192, ` 4~8GB,  ${p.dataMB}`);
    const big = doctor.chooseProfile({
      host, accel: { ok: true }, emulatorVersion: '37.3.8.0', diskMB: 200000,
      settings: { engine: { dataPartitionGB: 24 } }, overrides: {},
    });
    assert(big.dataMB === 24 * 1024, 'Configured data partition size must take effect');
  });

  await test('High memory system memory capping', () => {
    const host = { totalMB: 65536, freeMB: 50000, cores: 32, home: 'C:\\x', homeAscii: true, tmp: TMP, platform: 'win32', arch: 'x64', rdp: false };
    const p = doctor.chooseProfile({ host, accel: { ok: true }, emulatorVersion: '37.3.8.0', diskMB: 200000, port: 5554, adbPort: 5044 });
    assert(p.memoryMB <= 3072 && p.cores <= 4, `: ${p.memoryMB}MB / ${p.cores}`);
    assert(p.accel === 'auto');
  });

  await test('Retry matrix: from optimal to conservative, with software emulation and cold boot fallback', () => {
    const p = doctor.chooseProfile({
      host: doctor.hostInfo(), accel: { ok: true }, emulatorVersion: '37.3.8.0',
      diskMB: 50000, port: 5554, adbPort: 5044,
    });
    const v = doctor.planVariants(p);
    assert(v.length >= 3 && v.length <= 4, ` 3-4,  ${v.length}`);
    assert(v.some((x) => x.accel === 'off'), 'Missing software emulation fallback');
    // " + ",  -wipe-data: 
    // ,  wipe (). 
    assert(v[v.length - 1].snapshot === false, 'Final fallback profile must skip snapshot');
    assert(v[v.length - 1].wipe === false, 'Automatic retries must never wipe userdata');
    assert(v[v.length - 1].memoryMB <= 2048, 'Final fallback profile downscales to minimum memory');
    const keys = v.map((x) => `${x.gpu}|${x.accel}|${x.wipe}|${x.memoryMB}|${x.snapshot !== false}`);
    assert(new Set(keys).size === keys.length, 'Retry profiles must be unique');
  });

  await test('Image directory switch should not wipe userdata', () => {
    const c = 'C:/Users/x/AppData/Roaming/apkstart/system-images/android-34/google_apis_playstore/x86_64/';
    const d = 'D:/ApkStartRuntime/system-images/android-34/google_apis_playstore/x86_64/';
    assert(doctor.imageIdentity(c) === doctor.imageIdentity(d), 'Same image path identity must match');
    const key = (p) => doctor.snapshotKey({ emulatorVersion: '37.3.8', api: '34', tag: 'google_apis_playstore' }, p);
    assert(key(c) === key(d), 'Snapshot persists across disk moves');
    const other = 'D:/rt/system-images/android-34/google_apis/x86_64/';
    assert(doctor.imageIdentity(other) !== doctor.imageIdentity(d), 'Image modifications must be detected');
  });

  await test('Snapshot fingerprint persists across GPU/accel/memory retry variations', () => {
    const a = doctor.snapshotKey({ dataMB: 4096, emulatorVersion: '37.3.8.0', api: '34', tag: 'google_apis_playstore' }, 'C:\\img');
    const b = doctor.snapshotKey({ dataMB: 4096, emulatorVersion: '37.3.8.0', api: '34', tag: 'google_apis_playstore' }, 'C:\\img');
    const c = doctor.snapshotKey({ dataMB: 4096, emulatorVersion: '37.3.8.0', api: '34', tag: 'google_apis_playstore' }, 'C:\\img2');
    assert(a === b && a !== c);
  });

  await test('Log diagnostics identifies GPU / acceleration / path / lock file issues', () => {
    assert(doctor.diagnose(['Failed to initialize GL emulation']).code === 'GPU_INIT');
    assert(doctor.diagnose(['ERROR: x86_64 emulation currently requires hardware acceleration!']).code === 'ACCEL');
    assert(doctor.diagnose(['Cannot allocate memory for guest RAM']).code === 'MEMORY');
    assert(doctor.diagnose(['panic: AVD apkstart is already running']).code === 'AVD_LOCK');
    assert(doctor.diagnose(['non-ASCII path is not supported']).code === 'NON_ASCII');
    assert(doctor.diagnose(['random line']).code === 'UNKNOWN');
  });

  await test('Log diagnostics: emulator exit 0xC0000005 flagged as rendering crash', () => {
    // issue #20/#25:  Userspace boot properties  exit 3221225477
    assert(doctor.diagnose(['emulator exit 3221225477']).code === 'ACCESS_VIOLATION');
    assert(doctor.diagnose(['... 0xC0000005 ...']).code === 'ACCESS_VIOLATION');
    // : ,  GPU_INIT
    const mixed = ['Graphics backend: gfxstream', 'emulator exit 3221225477'];
    assert(doctor.diagnose(mixed).code === 'ACCESS_VIOLATION', 'Crashes take diagnostic precedence over rendering logs');
  });

  await test('Free port probe returns valid even port pair', async () => {
    const p = await doctor.freePortPair(5560);
    assert(p % 2 === 0 && p >= 5560, `: ${p}`);
  });

  await test('Settings display parameters match actual launch parameters', () => {
    const common = {
      accel: { ok: true }, emulatorVersion: '37.3.8.0', diskMB: 50000, port: 5562, adbPort: 5044,
      // : /,  CI
      // (GitHub runner  4 ,  6  3 , )
      host: { totalMB: 32768, freeMB: 24000, cores: 12, home: 'C:\\x', homeAscii: true, tmp: TMP, platform: 'win32', arch: 'x64', rdp: false },
    };
    const p = doctor.autoProfile({ ...common, settings: { engine: { autoMemory: true, gpuMode: 'auto', memoryMB: 0, cores: 0 } } });
    const text = doctor.describeProfile(p);
    assert(p.gpu === 'host' || p.gpu === 'swangle', ` host  swangle(AMD ),  ${p.gpu}`);
    assert(p.accelOk === true && (text.includes('') || text.includes('Hardware Accel')), text);
    assert(!text.includes('swiftshader_indirect'), text);
    assert(text.includes(' 5562') || text.includes('Port 5562'), text);

    // ; 
    const old = doctor.autoProfile({ ...common, emulatorVersion: '35.1.4.0', settings: {} });
    assert(old.gpu === 'host' && doctor.gpuCandidates('35.1.4.0').includes('swiftshader_indirect'));
    const manual = doctor.autoProfile({ ...common, settings: { engine: { autoMemory: false, memoryMB: 6144, cores: 6, gpuMode: 'swiftshader' } } });
    assert(manual.memoryMB === 6144 && manual.cores === 6 && manual.gpu === 'swiftshader', JSON.stringify(manual));
    const zero = doctor.overridesFromSettings({ autoMemory: false, memoryMB: 0, cores: 0, gpuMode: 'auto' });
    assert(zero.memoryMB === 0 && zero.cores === 0 && zero.gpuMode === '', JSON.stringify(zero));
  });

  console.log('\n[layers.js ]');

  await test('Identify recyclable items: non-x86_64 QEMU, old images, stale AVDs, lock files, old snapshots', () => {
    const root = path.join(TMP, 'runtime-layers');
    const mk = (p, size) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const b = Buffer.alloc(size || 16, 65);
      fs.writeFileSync(p, b);
    };
    mk(path.join(root, 'system-images', 'android-34', 'google_apis_playstore', 'x86_64', 'system.img'), 1024);
    mk(path.join(root, 'system-images', 'android-34', 'google_apis_playstore', 'x86_64', 'kernel-ranchu'), 16);
    mk(path.join(root, 'system-images', 'android-34', 'google_apis_playstore', 'x86_64', 'NOTICE.txt'), 2048);
    mk(path.join(root, 'system-images', 'android-30', 'default', 'x86_64', 'system.img'), 512);
    mk(path.join(root, 'emulator', 'qemu', 'windows-x86_64', 'qemu-system-aarch64.exe'), 128);
    mk(path.join(root, 'emulator', 'qemu', 'windows-x86_64', 'qemu-system-x86_64.exe'), 128);
    mk(path.join(root, 'avd', 'apkstart.avd', 'config.ini'), 32);
    mk(path.join(root, 'avd', 'apkstart.avd', 'snapshots', 'default_boot', 'ram.img'), 256);
    mk(path.join(root, 'avd', 'apkstart.avd', 'multiInstance.lock'), 8);
    mk(path.join(root, 'avd', 'apkstart-arm.avd', 'userdata-qemu.img'), 512);

    const a = layers.analyze(root);
    const paths = a.candidates.map((c) => c.path.replace(/\\/g, '/'));
    assert(paths.some((p) => p.endsWith('qemu-system-aarch64.exe')), 'Should list non-x86_64 QEMU');
    assert(!paths.some((p) => p.endsWith('qemu-system-x86_64.exe')), 'Must preserve x86_64 QEMU');
    assert(paths.some((p) => p.includes('android-30')), 'Should list legacy API30 image');
    assert(paths.some((p) => p.endsWith('.lock')), 'Should list lock files');
    assert(paths.some((p) => p.includes('snapshots')), 'Should list stale snapshots');
    assert(paths.some((p) => p.includes('apkstart-arm.avd')), 'Should list inactive AVDs');
    assert(!paths.some((p) => p.endsWith('apkstart.avd/config.ini')), 'AVD');

    const dry = layers.prune(root, { apply: false });
    assert(dry.removed.length === 0 && dry.saved === 0, 'dryRun');
    assert(fs.existsSync(path.join(root, 'avd', 'apkstart-arm.avd', 'userdata-qemu.img')));

    const done = layers.prune(root, { apply: true });
    assert(done.saved > 0 && done.removed.length >= 5, 'assertion failed');
    assert(!fs.existsSync(path.join(root, 'avd', 'apkstart-arm.avd')), 'AVD');
    assert(fs.existsSync(path.join(root, 'avd', 'apkstart.avd', 'config.ini')), 'AVD');
    assert(fs.existsSync(path.join(root, 'emulator', 'qemu', 'windows-x86_64', 'qemu-system-x86_64.exe')), 'x86_64 QEMU');
  });

  console.log('\n[adb.js /]');

  await test('Android 14 legacy targetSdk failure guidance', () => {
    const s = friendlyInstallError('Failure [INSTALL_FAILED_DEPRECATED_SDK_VERSION: app must target at least 23]');
    assert(s.includes('Android 14') && (s.includes('') || s.includes('automatically')), s);
  });

  await test('ARM translation crash diagnostic guidance', () => {
    const s = friendlyLaunchError('F DEBUG: DoBadTrampoline libndk_translation SIGABRT', 'com.phoenix.read');
    assert((s.includes('ARM ') || s.includes('ARM translation layer')) && (s.includes('') || s.includes('compatible image')), s);
  });

  console.log('\n[sharer ()]');

  await test('Files are cached and not repeatedly pulled from guest', async () => {
    const { Sharer } = require('../src/core/sharer');
    const localDir = path.join(TMP, 'shared');
    fs.mkdirSync(localDir, { recursive: true });
    const file = path.join(localDir, 'a.txt');
    fs.writeFileSync(file, 'hello');

    const calls = { push: 0, pull: 0 };
    const fakeClient = {
      isOnline: async () => true,
      shellMkdir: async () => {},
      shell: async () => '',
      push: async () => { calls.push += 1; },
      pull: async (_r, dst) => { calls.pull += 1; fs.writeFileSync(dst, 'hello'); },
      listRemoteStat: async () => [{ rel: 'a.txt', size: 5, mtime: Date.now() - 60000 }],
    };
    const sh = new Sharer({ client: () => fakeClient });
    sh.localDirOverride = localDir;
    // /, 
    Object.defineProperty(sh, 'localDir', { get: () => localDir });
    Object.defineProperty(sh, 'remoteDir', { get: () => '/sdcard/x' });
    sh.stateFile = path.join(TMP, 'shared-state.json');

    await sh.sync();          // 1 :  →
    const firstPull = calls.pull;
    await sh.sync();          // 2
    await sh.sync();          // 3
    await sh.sync();          // 4
    assert(calls.push === 1, `,  ${calls.push}`);
    assert(firstPull === 0, `,  ${firstPull} `);
    assert(calls.pull === firstPull, `,  ${calls.pull} `);
  });

  await test('Oversized files are not pulled to host', async () => {
    const { Sharer } = require('../src/core/sharer');
    const localDir = path.join(TMP, 'shared2');
    fs.mkdirSync(localDir, { recursive: true });
    let pulled = 0;
    const fakeClient = {
      isOnline: async () => true,
      shellMkdir: async () => {},
      shell: async () => '',
      push: async () => {},
      pull: async () => { pulled += 1; },
      listRemoteStat: async () => [{ rel: 'big.mp4', size: 600 * 1024 * 1024, mtime: Date.now() }],
    };
    const sh = new Sharer({ client: () => fakeClient });
    Object.defineProperty(sh, 'localDir', { get: () => localDir });
    Object.defineProperty(sh, 'remoteDir', { get: () => '/sdcard/x' });
    sh.stateFile = path.join(TMP, 'shared-state2.json');
    await sh.sync();
    assert(pulled === 0, '512MB');
  });

  console.log('\n[adb/sharer ]');

  await test('ls -l parsing compatibility with Android group and date formats', async () => {
    const { AdbClient } = require('../src/core/adb');
    const fake = Object.create(AdbClient.prototype);
    fake.shell = async () => '-rw-rw---- 1 u0_a188 media_rw 12 2026-11-12 18:52 hello.txt\r\n'
      + 'drwxrwx--- 2 u0_a188 media_rw 4096 2026-11-12 18:52 sub\r\n'
      + '-rw-rw---- 1 u0_a188 7 Nov 12 18:52 no-group.txt\r\n';
    const rows = await fake.listRemote('/sdcard/x');
    assert(rows.length === 3, ` 3 ,  ${rows.length}`);
    assert(rows[0].name === 'hello.txt' && rows[0].size === 12, JSON.stringify(rows[0]));
    assert(rows[1].isDir && rows[1].name === 'sub', JSON.stringify(rows[1]));
    assert(rows[2].name === 'no-group.txt' && rows[2].size === 7, JSON.stringify(rows[2]));
  });

  await test('Remote file listing via find+stat', async () => {
    const { Sharer } = require('../src/core/sharer');
    const sh = Object.create(Sharer.prototype);
    const fake = {
      shell: async () => '12|1794480758|./a.txt\n8|1794480759|./sub/b.txt\n',
      listRemote: async () => [],
    };
    const rows = await sh.listRemoteRecursive(fake, '/sdcard/x');
    assert(rows.length === 2, ` 2 ,  ${rows.length}`);
    assert(rows[1].rel === 'sub/b.txt' && rows[1].mtime > 1e12, JSON.stringify(rows[1]));
  });

  console.log('\n[zip.js ]');

  await test('ZipFile and ZipArchive parse consistency', async () => {
    const zlib = require('zlib');
    const { ZipArchive, ZipFile } = require('../src/core/zip');
    const entries = [
      { name: 'a.txt', data: Buffer.from('hello apkstart'), method: 0 },
      { name: 'dir/b.bin', data: Buffer.alloc(200000, 7), method: 8 },
    ];
    const locals = [];
    const centrals = [];
    let off = 0;
    for (const it of entries) {
      const raw = it.method === 8 ? zlib.deflateRawSync(it.data) : it.data;
      const name = Buffer.from(it.name);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(it.method, 8);
      lh.writeUInt32LE(raw.length, 18);
      lh.writeUInt32LE(it.data.length, 22);
      lh.writeUInt16LE(name.length, 26);
      locals.push(lh, name, raw);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(20, 4);
      ch.writeUInt16LE(20, 6);
      ch.writeUInt16LE(it.method, 10);
      ch.writeUInt32LE(raw.length, 20);
      ch.writeUInt32LE(it.data.length, 24);
      ch.writeUInt16LE(name.length, 28);
      ch.writeUInt32LE(off, 42);
      centrals.push(ch, name);
      off += lh.length + name.length + raw.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(off, 16);
    const buf = Buffer.concat([...locals, cd, eocd]);
    const zipPath = path.join(TMP, 'parity.zip');
    fs.writeFileSync(zipPath, buf);

    const mem = new ZipArchive(buf);
    const file = new ZipFile(zipPath);
    try {
      assert(mem.names().join('|') === file.names().join('|'), 'assertion failed');
      assert(mem.read('a.txt').equals(file.read('a.txt')), 'stored');
      assert(mem.read('dir/b.bin').equals(file.read('dir/b.bin')), 'deflate');
      const out = path.join(TMP, 'b.bin');
      await file.pipeTo('dir/b.bin', fs.createWriteStream(out));
      assert(fs.readFileSync(out).equals(entries[1].data), 'pipeTo');
    } finally {
      file.close();
    }
  });

  await test('Zip64: EOCD 0xffff/0xffffffff ,  Zip64 EOCD', async () => {
    const { ZipArchive, ZipFile } = require('../src/core/zip');
    const name = Buffer.from('hello.txt');
    const data = Buffer.from('hello zip64 apkstart');
    
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(45, 4);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const cenStart = lh.length + name.length + data.length;
    // :  0xffffffff,  Zip64 extra(id=0x0001)
    const extra = Buffer.alloc(28);
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(24, 2);
    extra.writeBigUInt64LE(BigInt(data.length), 4);
    extra.writeBigUInt64LE(BigInt(data.length), 12);
    extra.writeBigUInt64LE(0n, 20);
    const ch = Buffer.alloc(46 + name.length + extra.length);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(45, 6);
    ch.writeUInt32LE(0xffffffff, 20);
    ch.writeUInt32LE(0xffffffff, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(extra.length, 30);
    ch.writeUInt32LE(0xffffffff, 42);
    name.copy(ch, 46);
    extra.copy(ch, 46 + name.length);
    // Zip64 EOCD + locator +  EOCD()
    const z64 = Buffer.alloc(56);
    z64.writeUInt32LE(0x06064b50, 0);
    z64.writeBigUInt64LE(44n, 4);
    z64.writeUInt16LE(45, 12);
    z64.writeUInt16LE(45, 14);
    z64.writeBigUInt64LE(1n, 24);
    z64.writeBigUInt64LE(1n, 32);
    z64.writeBigUInt64LE(BigInt(ch.length), 40);
    z64.writeBigUInt64LE(BigInt(cenStart), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeBigUInt64LE(BigInt(cenStart + ch.length), 8);
    loc.writeUInt32LE(1, 16);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0xffff, 8);
    eocd.writeUInt16LE(0xffff, 10);
    eocd.writeUInt32LE(0xffffffff, 12);
    eocd.writeUInt32LE(0xffffffff, 16);
    const buf = Buffer.concat([lh, name, data, ch, z64, loc, eocd]);

    const mem = new ZipArchive(buf);
    assert(mem.has('hello.txt'), 'ZipArchive Zip64');
    assert(String(mem.read('hello.txt')) === 'hello zip64 apkstart', 'ZipArchive');
    assert(mem.entries.get('hello.txt').uncompSize === data.length, 'ZipArchive extra');

    const zipPath = path.join(TMP, 'zip64.zip');
    fs.writeFileSync(zipPath, buf);
    const file = new ZipFile(zipPath);
    try {
      assert(file.has('hello.txt'), 'ZipFile Zip64');
      assert(String(file.read('hello.txt')) === 'hello zip64 apkstart', 'ZipFile');
      assert(file.entries.get('hello.txt').localOffset === 0, 'ZipFile extra');
    } finally {
      file.close();
    }
  });

  console.log('\n[emulator.js AVD ]');

  await test('AVD + + GPU', () => {
    const { EmulatorEngine } = require('../src/core/emulator');
    const emu = new EmulatorEngine(path.join(__dirname, '..'));
    const r = emu.ensureAvd({ memoryMB: 2048, cores: 2, gpu: 'software', dataMB: 4096, accel: 'auto' });
    const cfg = fs.readFileSync(path.join(r.avdDir, 'config.ini'), 'utf8');
    assert(/^hw\.ramSize=2048$/m.test(cfg));
    assert(/^disk\.dataPartition\.size=4096M$/m.test(cfg), '16G');
    assert(/^hw\.gpu\.mode=software$/m.test(cfg));
    assert(!/^fastboot\.forceColdBoot=yes$/m.test(cfg), 'assertion failed');
    assert(!/^fastboot\.forceFastBoot=/m.test(cfg), '-snapshot ,  default_boot');
    assert(/^hw\.cpu\.arch=x86_64$/m.test(cfg));
    assert(fs.existsSync(path.join(r.avdDir, 'snapshot.key')), 'assertion failed');
  });

  await test('/ / ,  GPU', () => {
    const { EmulatorEngine } = require('../src/core/emulator');
    const emu = new EmulatorEngine(path.join(__dirname, '..'));
    // ( AVD / ) -snapshot: 
    // qemu , . 
    const fresh = emu.buildArgs({ gpu: 'software', memoryMB: 2048, cores: 2, snapshot: true }).join(' ');
    assert(/-gpu software/.test(fresh));
    assert(!/swiftshader_indirect/.test(fresh));
    assert(/-memory 2048/.test(fresh) && /-cores 2/.test(fresh));
    if (!emu.hasSnapshot()) {
      // ", ": -no-snapshot , 
      // , . 
      assert(/-no-snapshot-load/.test(fresh), '-no-snapshot-load( )');
      assert(!/ -no-snapshot( |$)/.test(fresh), '-no-snapshot( )');
    }
    // quickboot. "": 
    // snapshot.pb , , 
    // emulator , , , . 
    const avdDir = path.join(emu.provisioner.paths().avdHome, 'apkstart.avd');
    const snapDir = path.join(avdDir, 'snapshots');
    const created = !fs.existsSync(snapDir);
    fs.mkdirSync(path.join(snapDir, 'apkstart'), { recursive: true });

    // (12  pb +  ram.img)""
    fs.writeFileSync(path.join(snapDir, 'apkstart', 'snapshot.pb'), 'x'.repeat(12));
    assert(!emu.hasSnapshot(), 'assertion failed');
    const broken = emu.buildArgs({ gpu: 'software', memoryMB: 2048, cores: 2, snapshot: true }).join(' ');
    assert(/-no-snapshot-load/.test(broken), '( )');

    // : pb  + ram.img ( hasSnapshot )
    fs.mkdirSync(path.join(snapDir, 'apkstart'), { recursive: true });
    fs.writeFileSync(path.join(snapDir, 'apkstart', 'snapshot.pb'), 'x'.repeat(2048));
    fs.writeFileSync(path.join(snapDir, 'apkstart', 'ram.img'), Buffer.alloc(2 * 1024 * 1024));
    const withSnap = emu.buildArgs({ gpu: 'software', memoryMB: 2048, cores: 2, snapshot: true }).join(' ');
    assert(/-snapshot apkstart/.test(withSnap), 'quickboot');
    assert(!/-no-snapshot-load/.test(withSnap), 'assertion failed');
    if (created) fs.rmSync(snapDir, { recursive: true, force: true });

    const cold = emu.buildArgs({ wipe: true }).join(' ');
    assert(/-wipe-data/.test(cold), 'wipe -wipe-data');
    // : (), ****. 
    // "":  →  → . 
    // -no-snapshot, , . 
    assert(/ -no-snapshot-load( |$)/.test(cold), 'wipe');
    assert(!/ -no-snapshot( |$)/.test(cold), 'wipe ( )');
  });

  // . PowerShell 5.1 " BOM  UTF-8" ANSI , 
  // C#  -- Add-Type , 
  // " / ". , . 
  await test('UTF-8 BOM( Add-Type )', () => {
    const file = path.join(__dirname, '..', 'src', 'core', 'win', 'agent.ps1');
    const buf = fs.readFileSync(file);
    assert(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, 'agent.ps1 UTF-8 BOM');
  });

  // Chromium "", . 
  // Electron , , 
  // ( /  /  / ).  window region, 
  // resize . 
  await test(',  window region', () => {
    const file = path.join(__dirname, '..', 'src', 'core', 'win', 'agent.ps1');
    const src = fs.readFileSync(file, 'utf8');
    assert(/SetParent\(emu, parent\)/.test(src), 'embed FindChromeRender');
    assert(/FindChromeRender\(host\)/.test(src), 'Chromium');
    assert(!/CreateRectRgn\(0, clipTop/.test(src), 'region');
    assert(/SetWindowRgn\(emu, IntPtr\.Zero/.test(src), 'embed region');
  });

  // "",  wm size / density. 
  // - wm size:  LCD  ->  90°, , ; 
  // - wm density: framebuffer  -> , . 
  await test('(lcdFor landscape),  wm size', () => {
    const doctor = require('../src/core/doctor');
    const p = doctor.lcdFor({ accelOk: true, landscape: false });
    const l = doctor.lcdFor({ accelOk: true, landscape: true });
    assert(p.w === 720 && p.h === 1280, ` 720x1280,  ${p.w}x${p.h}`);
    assert(l.w === 1280 && l.h === 720, ` 1280x720,  ${l.w}x${l.h}`);

    const adb = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'adb.js'), 'utf8');
    const i = adb.indexOf('async setOrientation(');
    const j = adb.indexOf('async resetDisplayOverrides(');
    const body = adb.slice(i, j);
    assert(!/wm size \d/.test(body), 'setOrientation wm size');
    // density  tabletDensity()(), 
    // 190(720  → 606dp ). 
    assert(/wm density \$\{tabletDensity\(\)\}/.test(body), 'density');
    assert(/const TABLET_DENSITY = 190/.test(adb), '190');
  });

  await test('unit test verification', () => {
    const ps = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'win', 'priority.ps1'), 'utf8');
    assert(/game\s*=\s*'High'/.test(ps), 'game qemu High');
    const aw = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'appwin.js'), 'utf8');
    assert(/opts\.enabled && !game/.test(aw), 'game WH_MOUSE_LL');
  });

  await test(':  ,  , ', async () => {
    const { lookup, toCommand, PRESETS } = require('../src/core/keymap');
    const { KeymapEngine } = require('../src/core/keymap-engine');

    
    assert(PRESETS.fps && PRESETS.fps.mappings.length >= 4, 'FPS 4');
    assert(PRESETS.rpg && PRESETS.rpg.mappings.length >= 4, 'RPG 4');
    assert(PRESETS.generic && PRESETS.generic.mappings.length >= 3, '3');

    // : 
    assert(lookup(PRESETS.fps.mappings, 'W').action === 'tap', 'W w');
    assert(lookup(PRESETS.fps.mappings, 'z') === null, 'null');

    // :  →
    const cmd = toCommand({ action: 'tap', x: 0.5, y: 0.5 }, 720, 1280);
    assert(cmd === 'input tap 360 640', `tap : ${cmd}`);
    const sw = toCommand({ action: 'swipe', x1: 0, y1: 0.5, x2: 1, y2: 0.5, duration: 100 }, 720, 1280);
    assert(sw === 'input swipe 0 640 720 640 100', `swipe : ${sw}`);
    const ke = toCommand({ action: 'keyevent', code: 4 }, 720, 1280);
    assert(ke === 'input keyevent 4', `keyevent : ${ke}`);

    // : /, , 
    const calls = [];
    const eng = new KeymapEngine({
      execInput: (c) => { calls.push(c); return Promise.resolve(); },
      getSize: () => ({ width: 720, height: 1280 }),
      minInterval: 0,  
    });
    eng.setMap('com.test.game', PRESETS.fps.mappings);
    assert(eng.getMap('com.test.game').length > 0, 'setMap/getMap');
    eng.enable(false);
    assert(await eng.handleKey('w', 'com.test.game') === false, 'assertion failed');
    eng.enable(true);
    assert(await eng.handleKey('w', 'com.test.game') === true, 'assertion failed');
    assert(await eng.handleKey('z', 'com.test.game') === false, 'assertion failed');
    assert(await eng.handleKey('w', 'com.other.app') === false, 'assertion failed');
    assert(calls.length === 1 && /input tap/.test(calls[0]), ` input tap, : ${calls.join('|')}`);
  });

  await test('GPU :  unknown, AMD swangle', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'doctor.js'), 'utf8');
    assert(/detectGpuVendor/.test(doc), 'detectGpuVendor');
    assert(/Get-CimInstance Win32_VideoController/.test(doc), 'PowerShell CIM(wmic Win11 24H2+ )');
    assert(/vendor === 'amd'[\s\S]{0,200}swangle.*host/.test(doc), 'AMD swangle host');
    const d = require('../src/core/doctor');
    const v = d.detectGpuVendor();
    assert(['nvidia', 'amd', 'intel', 'unknown'].includes(v), ` unknown, : ${v}`);
  });

  await test(': splash + +', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    assert(fs.existsSync(path.join(root, 'src', 'ui', 'splash.html')), 'splash.html');
    assert(fs.existsSync(path.join(root, 'src', 'ui', 'splash.css')), 'splash.css');
    assert(fs.existsSync(path.join(root, 'src', 'ui', 'splash.js')), 'splash.js');
    assert(fs.existsSync(path.join(root, 'src', 'splash-preload.js')), 'splash-preload.js');
    assert(/splashWin/.test(mainJs), 'main.js splash');
    assert(/splashProgress/.test(mainJs), 'splashProgress');
    assert(/splashDone/.test(mainJs), 'splashDone');
    assert(/splash:version/.test(mainJs) || /splash:isFirstRun/.test(mainJs), 'splash IPC');
  });

  await test('below( / )', () => {
    const engJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'engine.js'), 'utf8');
    // balanced/performance  normal: below  qemu , 
    // , (""). 
    const begin = engJs.slice(engJs.indexOf('async beginApp'));
    assert(/mode === 'game' \? 'game' : 'normal'/.test(begin), 'beginApp game→game,  →normal');
    assert(!/performance.*\? 'normal' : 'below'/.test(begin), 'balanced below');
    // /: endApp  idle, 
    const setIdx = begin.indexOf("setPriority(level)");
    const firstIdx = begin.indexOf("if (first)");
    assert(setIdx > -1, 'beginApp setPriority');
    // setPriority  if(first)  -- ( first)
    const firstBlock = begin.slice(firstIdx, begin.indexOf('\n\n', firstIdx));
    assert(!/setPriority\(level\)/.test(firstBlock) || begin.split('setPriority(level)').length >= 2, 'setPriority beginApp , ');
  });

  await test('( )', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'doctor.js'), 'utf8');
    assert(/rmode === 'save'[\s\S]{0,120}2048/.test(doc), 'save memoryMB 2048( 1GB + 1GB )');
    // ,  save
    assert(/!overrides\.memoryMB/.test(doc), 'save');
  });

  await test('emulator ram.bin ( 3GB )', () => {
    const { EmulatorEngine } = require('../src/core/emulator');
    const emu = new EmulatorEngine(path.join(__dirname, '..'));
    const avdDir = path.join(emu.provisioner.paths().avdHome, 'apkstart.avd');
    const snapDir = path.join(avdDir, 'snapshots', 'apkstart');
    fs.rmSync(path.join(avdDir, 'snapshots'), { recursive: true, force: true });
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(path.join(snapDir, 'snapshot.pb'), 'x'.repeat(2048));
    fs.writeFileSync(path.join(snapDir, 'ram.bin'), Buffer.alloc(2 * 1024 * 1024));
    assert(emu.hasSnapshot(), 'ram.bin');
    const args = emu.buildArgs({ gpu: 'software', memoryMB: 2048, cores: 2, snapshot: true }).join(' ');
    assert(/-snapshot apkstart/.test(args), 'quickboot');
    assert(!/-no-snapshot-load/.test(args), 'assertion failed');
    fs.rmSync(path.join(avdDir, 'snapshots'), { recursive: true, force: true });
  });

  await test('userdata : 4K block + ENCRYPT +', () => {
    const { buildEmptyExt4 } = require('../src/core/userdata');
    const sb = 1024;
    const img = buildEmptyExt4({ sizeMB: 64, encrypt: false });
    assert(img.readUInt16LE(sb + 0x38) === 0xEF53, 'superblock 0xEF53');
    // dm-default-key(Android 13  /data ) 4096, 
    // fs block  mount()  EINVAL -- " /data". 
    assert(img.readUInt32LE(sb + 0x18) === 2, 's_log_block_size 2(4096 )');
    assert(img.readUInt32LE(sb + 0x1C) === 2, 's_log_cluster_size block size');
    // ext_attr  setxattr  EOPNOTSUPP, SELinux , 
    // netd / media / tombstoned  exit 1, . 
    assert((img.readUInt32LE(sb + 0x5C) & 0x8) !== 0, 'ext_attr');
    const total = img.readUInt32LE(sb + 0x04);
    const free = img.readUInt32LE(sb + 0x0C);
    const inodes = img.readUInt32LE(sb + 0x00);
    const freeInodes = img.readUInt32LE(sb + 0x10);
    assert(free > 0 && free < total, '(0, total)');
    assert(freeInodes === inodes - 10, 'inode 1~10 (e2fsck )');
    const withEnc = buildEmptyExt4({ sizeMB: 64 });
    assert((withEnc.readUInt32LE(sb + 0x60) & 0x10000) !== 0, 'ENCRYPT(FBE )');
    assert((img.readUInt32LE(sb + 0x60) & 0x10000) === 0, 'encrypt:false');
  });

  console.log('\n[ /  / ]');
  await test('( )', () => {
    const { EmulatorEngine } = require('../src/core/emulator');
    const emu = new EmulatorEngine(path.join(__dirname, '..'));
    const win = emu.buildArgs({ headless: false, gpu: 'software', lcd: { w: 720, h: 1280, dpi: 320 } }).join(' ');
    assert(!/-no-window/.test(win), '-no-window');
    // -no-skin:  -skin,  config.ini , 
    // ", """. 
    assert(!/\s-no-skin(\s|$)/.test(win), '-no-skin( -skin)');
    assert(/-skin \d+x\d+/.test(win), '-skin');
    const headless = emu.buildArgs({ headless: true }).join(' ');
    assert(/-no-window/.test(headless));
  });

  await test(':  ( -no-audio),  -no-audio', () => {
    const { EmulatorEngine } = require('../src/core/emulator');
    const emu = new EmulatorEngine(path.join(__dirname, '..'));
    // settings getter:  -no-audio
    Object.defineProperty(emu, 'settings', { configurable: true, get: () => ({ engine: { audio: true } }) });
    const on = emu.buildArgs({ headless: false, gpu: 'software' }).join(' ');
    assert(!/-no-audio/.test(on), 'audio=true -no-audio');
    // -no-audio
    Object.defineProperty(emu, 'settings', { configurable: true, get: () => ({ engine: { audio: false } }) });
    const off = emu.buildArgs({ headless: false, gpu: 'software' }).join(' ');
    assert(/-no-audio/.test(off), 'audio=false -no-audio');
  });

  await test(':  " "', () => {
    const store = require('../src/core/store');
    store.saveSettings({ engine: { headless: true }, hideAfterLaunch: true });
    const s = store.getSettings();
    assert(s.engine.headless === false, 'headless false');
    assert(s.hideAfterLaunch === false, 'hideAfterLaunch false');
    assert(s.autoStart === true && s.autoDeploy === true, '/');
    assert(s.createStartMenuShortcut === true, 'assertion failed');
  });

  await test(':  / ,  9:16', () => {
    const d = require('../src/core/display');
    const area = { x: 0, y: 0, w: 1920, h: 1080 };
    // Android ( LCD ), 
    assert(JSON.stringify(d.sizeFor('fullscreen', '900x1600', area)) === JSON.stringify({ w: 900, h: 1600 }));
    assert(JSON.stringify(d.sizeFor('window', '720x1280', area)) === JSON.stringify({ w: 720, h: 1280 }));
    assert(d.sizeFor('window', '', area).h > d.sizeFor('window', '', area).w);
    const b = d.defaultBounds(area);
    assert(b.h > b.w && b.h <= area.h && b.x >= 0 && b.y >= 0, JSON.stringify(b));
    // : , ( LCD )
    const f = d.fullscreenBounds('900x1600', area);
    assert(f.h === area.h, JSON.stringify(f));
    assert(Math.abs(f.w - Math.round(f.h * 900 / 1600)) <= 1, JSON.stringify(f));
    assert(f.x > 0 && f.x + f.w <= area.w, JSON.stringify(f));
    assert(d.densityFor(1080, 1920, 0) > 300);
    assert(d.densityFor(720, 1280, 240) === 240);
  });

  await test('adb wm size / wm density', async () => {
    const { AdbClient } = require('../src/core/adb');
    const cmds = [];
    const fake = { shell: async (c) => { cmds.push(c); return ''; } };
    await AdbClient.prototype.setDisplaySize.call(fake, 1920, 1080, 420);
    assert(cmds.includes('wm size 1920x1080'), cmds.join('|'));
    assert(cmds.includes('wm density 420'), cmds.join('|'));
    await AdbClient.prototype.resetDisplaySize.call(fake);
    assert(cmds.includes('wm size reset') && cmds.includes('wm density reset'));
  });

  await test('PNG-in-ICO WebP ICO', async () => {
    const { pngBytesToIco, iconToIco } = require('../src/core/shortcut');
    const { drawAppIcon } = require('../src/core/png');
    const png = drawAppIcon(64);
    const ico = pngBytesToIco(png);
    assert(ico && ico.readUInt16LE(2) === 1 && ico.readUInt16LE(4) === 1, 'ICO 1');
    assert(ico.readUInt32LE(14) === png.length, 'PNG');
    assert(ico.slice(22).equals(png), 'ICO PNG');
    assert(pngBytesToIco(Buffer.from('not a png')) === null);
    // WebP(nativeImage )→  decode  ICO
    const webp = Buffer.concat([Buffer.from('RIFF\x00\x00\x00\x00WEBP'), Buffer.alloc(32)]);
    const fallback = await iconToIco(webp);
    assert(fallback && fallback.length > 22, 'WebP');
    const decoded = await iconToIco(webp, { decode: async () => png });
    assert(decoded && decoded.slice(22).equals(png), 'decode');
  });

  await test('ASCII( / )', () => {
    const w = require('../src/core/windowctl');
    assert(fs.existsSync(w.SCRIPT), 'windowctl.ps1');
    const b = fs.readFileSync(w.SCRIPT);
    assert(!b.some((x) => x > 127), 'ps1 ASCII,  UTF-8 JSON');
    assert(typeof w.present === 'function' && typeof w.getBounds === 'function');
  });

  await test('xzFile stdin (CI )', async () => {
    const { xzFile } = require('../build/prepare-runtime');
    const zlib = require('zlib');
    const crypto = require('crypto');
    const dir = path.join(TMP, 'xz-regression');
    fs.mkdirSync(dir, { recursive: true });
    const src = path.join(dir, 'sample.img');
    const payload = Buffer.concat([
      Buffer.from('APKSTART-XZ-REGRESSION'),
      crypto.randomBytes(256 * 1024),
      Buffer.alloc(1024 * 1024),
    ]);
    fs.writeFileSync(src, payload);
    const dest = path.join(dir, 'sample.img.xz');

    const saved = { XZ_PRESET: process.env.XZ_PRESET, XZ_TIMEOUT_MS: process.env.XZ_TIMEOUT_MS };
    process.env.XZ_PRESET = '1';           // , 
    process.env.XZ_TIMEOUT_MS = '15000';  // 15s  kill,  CI
    let timer;
    try {
      await Promise.race([
        xzFile(src, dest),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('xzFile 25s (stdin  EOF?)')), 25000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }

    const have = (p) => (fs.existsSync(p) ? fs.statSync(p).size : 0);
    const out = have(dest) > 0 ? dest : dest.replace(/\.xz$/, '.gz');
    assert(have(out) > 0, '0');
    let back;
    if (/\.xz$/i.test(out)) {
      // @napi-rs/lzma  binding: CI  Node 20 job
      // npm optional dependencies  bug (Node 22 ). 
      // python  lzma ,  XZ , 
      // . 
      assert(fs.readFileSync(out).subarray(0, 6).equals(
        Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]),
      ), 'XZ');
      const { findPython } = require('../build/prepare-runtime');
      const py = findPython();
      assert(py, 'XZ python, ');
      const backPath = path.join(dir, 'sample.img.back');
      require('child_process').execFileSync(py, ['-c',
        'import lzma,sys;open(sys.argv[1],"wb").write(lzma.open(sys.argv[2],"rb").read())',
        backPath, out], { stdio: 'ignore' });
      back = fs.readFileSync(backPath);
    } else {
      back = zlib.gunzipSync(fs.readFileSync(out));
    }
    assert(back.equals(payload), 'assertion failed');
  });

  console.log('\n[container.js ]');

  const container = require('../src/core/container');

  await test('/ ,  App', () => {
    for (const p of ['android', 'com.android.systemui', 'com.google.android.gms', 'com.foo.bar.baz']) {
      const sys = container.isSystemPackage(p);
      if (p.startsWith('com.foo')) assert(!sys, `${p}  App`);
      else assert(sys, `${p} `);
    }
    assert(container.isSystemPackage(''), ', ');
  });

  await test('App, ', () => {
    const r = container.buildSessionCommands({
      pkg: 'com.phoenix.read',
      installed: ['com.phoenix.read', 'com.other.app', 'com.android.vending', 'com.google.android.gms', 'com.third.game'],
    });
    assert(r.stopped.length === 2, ` 2  App,  ${r.stopped.join(',')}`);
    assert(r.stopped.includes('com.other.app') && r.stopped.includes('com.third.game'));
    assert(!r.commands.some((c) => c.includes('pm disable')), 'assertion failed');
    assert(!r.commands.some((c) => c.includes('kill-all')), ',  App');
    assert(!r.commands.some((c) => /force-stop (android|com\.android|com\.google\.android)/.test(c)), 'force-stop');
  });

  await test(': ', () => {
    const r = container.buildSessionCommands({
      pkg: 'com.phoenix.read',
      installed: ['com.evil;rm -rf /', 'com.ok.app', '$(whoami)', 'com.foo-bar'],
    });
    assert(r.stopped.length === 1 && r.stopped[0] === 'com.ok.app', `,  ${r.stopped.join(',')}`);
    assert(!r.commands.some((c) => c.includes('rm -rf') || c.includes('$(')), 'assertion failed');
  });

  await test(',  , ', () => {
    const r = container.buildSessionCommands({
      pkg: 'com.phoenix.read', installed: [], deep: true,
    });
    assert(r.disabled.length > 0, 'assertion failed');
    assert(r.commands.some((c) => c.includes('pm disable-user --user 0 com.android.vending')));
    for (const p of container.NEVER_TRIM) {
      assert(!r.disabled.includes(p), `${p} `);
    }
    const back = container.buildRestoreCommands();
    for (const p of container.OPTIONAL_SYSTEM) {
      assert(back.some((c) => c.includes(`pm enable ${p}`)), `${p} `);
    }
  });

  await test(':  + Android idle,  /', () => {
    const idle = container.buildIdleCommands();
    assert(idle.some((c) => c.includes('am kill-all')), 'assertion failed');
    assert(idle.some((c) => c.includes('deviceidle force-idle')), 'Android idle');
    let s = container.nextSessionState([], 'open', 'a');
    assert(s.hasApp && !s.idle && s.foreground === 'a');
    s = container.nextSessionState(s.active, 'open', 'b');
    assert(s.active.length === 2 && s.foreground === 'b');
    s = container.nextSessionState(s.active, 'close', 'a');
    assert(s.active.length === 1 && s.hasApp && !s.idle);
    s = container.nextSessionState(s.active, 'close', 'b');
    assert(s.idle && !s.hasApp && s.active.length === 0, 'assertion failed');
  });

  await test('doctor :  vCPU, ', () => {
    const host = { totalMB: 32768, freeMB: 20000, cores: 16, home: 'C:\\x', homeAscii: true, tmp: TMP, platform: 'win32', arch: 'x64', rdp: false };
    const lite = doctor.liteProfile({ host, engine: {} });
    // floor(/4)  2~3 -- 8  2  vCPU, . 
    // ",  4",  2. 
    assert(lite && lite.cores === 4, `16  4 ,  ${lite && lite.cores}`);
    const save = doctor.liteProfile({ host, engine: { resourceMode: 'save' } });
    assert(save.cores === 2, ` 2 ,  ${save.cores}`);
    assert(doctor.liteProfile({ host, engine: { liteMode: false } }) === null, 'null');
    const low = doctor.liteProfile({ host: { ...host, cores: 2 }, engine: {} });
    assert(low.cores === 2, '2 2');

    const auto = doctor.autoProfile({
      settings: { engine: { autoMemory: true, liteMode: true } },
      accel: { ok: true }, emulatorVersion: '37.3.8.0', diskMB: 100000, host,
    });
    assert(auto.lite === true && auto.cores <= 4, JSON.stringify({ lite: auto.lite, cores: auto.cores }));
    const manual = doctor.autoProfile({
      settings: { engine: { autoMemory: false, cores: 6, liteMode: true } },
      accel: { ok: true }, emulatorVersion: '37.3.8.0', diskMB: 100000, host,
    });
    assert(manual.cores === 6, 'assertion failed');
    assert(/Lightweight/.test(doctor.describeProfile(auto)), 'assertion failed');
  });

  await test(', ', () => {
    const root = path.join(__dirname, '..');
    const agentPs1 = fs.readFileSync(path.join(root, 'src', 'core', 'win', 'agent.ps1'), 'utf8');
    const agentJs = fs.readFileSync(path.join(root, 'src', 'core', 'agent.js'), 'utf8');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    const appwinJs = fs.readFileSync(path.join(root, 'src', 'core', 'appwin.js'), 'utf8');
    const storeJs = fs.readFileSync(path.join(root, 'src', 'core', 'store.js'), 'utf8');
    const uiHtml = fs.readFileSync(path.join(root, 'src', 'ui', 'index.html'), 'utf8');

    assert(/mouseSideButtons:\s*false/.test(storeJs), 'assertion failed');
    assert(!/winAgent\.hook\(true\)/.test(mainJs), 'assertion failed');
    assert(!/agent\.hook\(true\)/.test(appwinJs), 'assertion failed');
    assert(!/sharer\.start\(8000\)/.test(mainJs), 'assertion failed');
    assert(/setHook/.test(agentJs) && /hooked/.test(agentJs), 'assertion failed');
    assert(/new Thread\(HookThreadProc\)/.test(agentPs1), 'assertion failed');
    assert(/GetMessage\(out MSG/.test(agentPs1), 'assertion failed');
    assert(!/Poll\(4000,\s*SelectMode\.SelectRead\)/.test(agentPs1), '4');
    assert(/Poll\(50,\s*SelectMode\.SelectRead\)/.test(agentPs1), 'assertion failed');
    assert(/now - _embedAt < 8000/.test(agentPs1), ',  2 EnumWindows');
    assert(/setLiteMode/.test(uiHtml) && /setDeepTrim/.test(uiHtml), 'assertion failed');
  });

  await test(':  SetParent,  , ', () => {
    const root = path.join(__dirname, '..');
    const agentPs1 = fs.readFileSync(path.join(root, 'src', 'core', 'win', 'agent.ps1'), 'utf8');
    const appwinJs = fs.readFileSync(path.join(root, 'src', 'core', 'appwin.js'), 'utf8');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    const uiHtml = fs.readFileSync(path.join(root, 'src', 'ui', 'index.html'), 'utf8');

    // : UI -> main -> appwin
    assert(/setWindowEmbed/.test(uiHtml), '" "');
    assert(/windowEmbed === false/.test(mainJs), 'main');
    assert(/openDetached/.test(appwinJs), 'appwin openDetached');
    // `detached: displaySettings().windowEmbed === false` , 
    // ( showWhileWaiting), . 
    assert(/detached:\s*displaySettings\(\)\.windowEmbed === false/.test(mainJs)
      || /const detached = displaySettings\(\)\.windowEmbed === false/.test(mainJs), 'detached');

    // SetParent--
    // (,  SetParent )
    const codeOnly = (src) => src.split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .filter((l) => l.trim() && !/^\s*(\*|\/\*)/.test(l))
      .join('\n');
    const layoutBlock = agentPs1.slice(agentPs1.indexOf('cmd == "layout"'));
    const layoutBody = codeOnly(layoutBlock.slice(0, layoutBlock.indexOf('cmd == "hook"')));
    assert(!/SetParent\s*\(/.test(layoutBody), 'layout SetParent( )');
    assert(/SetWindowPos\s*\(/.test(layoutBody), 'layout');

    // , 
    assert(/_detachedMode/.test(agentPs1), 'agent.ps1 _detachedMode');
    const detachBlock = agentPs1.slice(agentPs1.indexOf('cmd == "detach"'));
    assert(/keep/.test(detachBlock.slice(0, 600)), 'detach keep " " " "');

    // : , 
    assert(/_panelRatio/.test(appwinJs), 'assertion failed');
    assert(!/w:\s*Math\.min\(area\.w - 80, 1280\)/.test(appwinJs), '1280 ( )');
  });

  await test(':  builtin, ', () => {
    const backends = require('../src/core/backends');
    // 0.5.6 :  MuMu /  /  / WSA, 
    // ApkStart , . 
    assert(backends.REGISTRY.length === 1, 'assertion failed');
    assert(backends.REGISTRY[0].id === 'builtin', 'builtin');
  });

  await test('ApkStart: ', () => {
    const root = path.join(__dirname, '..');
    const ps1 = fs.readFileSync(path.join(root, 'src', 'core', 'win', 'agent.ps1'), 'utf8');
    const agent = fs.readFileSync(path.join(root, 'src', 'core', 'agent.js'), 'utf8');
    const appwin = fs.readFileSync(path.join(root, 'src', 'core', 'appwin.js'), 'utf8');

    assert(/SetWindowTextW/.test(ps1), 'agent.ps1 SetWindowTextW');
    assert(/cmd == "title"/.test(ps1), 'agent.ps1 title');
    assert(/LooksLikeEmulator/.test(ps1), ',  Android Emulator');
    assert(/_ourTitle/.test(ps1), 'assertion failed');
    // Qt , 
    assert(/QuietSweep[\s\S]{0,600}SetWindowTextW/.test(ps1), 'assertion failed');
    assert(/setTitle\(/.test(agent), 'agent.js setTitle');
    assert(/agent\.setTitle\(/.test(appwin), 'assertion failed');
  });

  await test(':  locale,  , captive portal', () => {
    const root = path.join(__dirname, '..');
    const emuJs = fs.readFileSync(path.join(root, 'src', 'core', 'emulator.js'), 'utf8');
    const adbJs = fs.readFileSync(path.join(root, 'src', 'core', 'adb.js'), 'utf8');
    const engJs = fs.readFileSync(path.join(root, 'src', 'core', 'engine.js'), 'utf8');
    const storeJs = fs.readFileSync(path.join(root, 'src', 'core', 'store.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'src', 'ui', 'index.html'), 'utf8');

    // locale  -change-locale:  -prop persist.sys.locale
    // , guest  getprop ,  -change-locale
    assert(/'\-change-locale',\s*locale/.test(emuJs), '-change-locale');
    // : " -prop"
    const emuCode = emuJs.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert(!/-prop[\s\S]{0,80}persist\.sys\.locale[^=]/.test(emuCode), 'Should not use -prop persist.sys.locale in code (use -change-locale instead)');
    assert(/_guestLocale/.test(emuJs), 'assertion failed');
    
    assert(/locale:\s*'(zh-CN|en-US)'/.test(storeJs), 'locale');
    assert(/chineseIme:\s*(true|false)/.test(storeJs), 'assertion failed');

    // :  APK, 
    assert(fs.existsSync(path.join(root, 'assets', 'PinyinIME.apk')), 'Missing PinyinIME.apk');
    assert(/ensureChineseIme/.test(adbJs), 'adb ensureChineseIme');
    assert(/com\.android\.inputmethod\.pinyin/.test(adbJs), 'Must use Google Pinyin IME');
    assert(/ime enable/.test(adbJs) && /default_input_method/.test(adbJs), 'assertion failed');
    assert(/ensureChineseIme/.test(engJs), 'prepare()');
    assert(/_chineseReady/.test(engJs), '( )');
    assert(/chineseIme/.test(engJs), 'assertion failed');

    // :  gstatic "!"
    assert(/captive_portal_http_url/.test(adbJs), 'assertion failed');
    assert(/connect\.rom\.miui\.com/.test(adbJs), 'assertion failed');

    
    assert(/setLocale/.test(html) && /setChineseIme/.test(html), '/');
  });

  await test(':  / 90°', () => {
    const root = path.join(__dirname, '..');
    const engJs = fs.readFileSync(path.join(root, 'src', 'core', 'engine.js'), 'utf8');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

    // : init=WxH  cur=WxH  =
    assert(/_healOrientation/.test(engJs), 'assertion failed');
    assert(/init=\(\\d\+\)x\(\\d\+\)/.test(engJs), 'init');
    assert(/cur=\(\\d\+\)x\(\\d\+\)/.test(engJs), 'cur');
    assert(/initLand !== curLand/.test(engJs), '( )');
    // :  ignore-orientation + density
    assert(/mSetIgnoreOrientationRequest=true/.test(engJs), 'ignore-orientation');
    assert(/Override density:/.test(engJs), 'Override density');
    assert(/tabletMode/.test(engJs), 'assertion failed');
    assert(/wm set-ignore-orientation-request true/.test(engJs), 'ignore-orientation');
    assert(/wm density \$\{densityWanted\}/.test(engJs), 'density');
    assert(/_healOrientation/.test(engJs.slice(engJs.indexOf('startWatchdog'))), 'assertion failed');
    // Activity , . 
    // 2200 : onAppUp  then , 
    // _healOrientation , 600 . 
    assert(/onAppUp[\s\S]{0,2200}_healOrientation/.test(mainJs), 'assertion failed');
    // , 
    assert(/panelLandscape/.test(engJs), '" " " "');
  });

  await test('Linux : .desktop , Exec ,  PNG', () => {
    const os = require('os');
    const shortcut = require('../src/core/shortcut');
    // Windows  .lnk, Linux  .desktop(freedesktop )
    assert(shortcut.shortcutExt() === (process.platform === 'win32' ? '.lnk' : '.desktop'), 'assertion failed');

    // .desktop ()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apkstart-dt-'));
    const out = path.join(dir, '.desktop');
    const png = path.join(dir, 'icon.png');
    fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    try {
      shortcut.writeDesktopEntry({
        shortcutPath: out,
        target: '/opt/ApkStart/ApkStart',
        args: '--launch "com.example.app"',
        iconPngPath: png,
        description: '',
      });
      assert(fs.existsSync(out), '.desktop');
      const body = fs.readFileSync(out, 'utf8');
      assert(/\[Desktop Entry\]/.test(body), 'Desktop Entry');
      assert(/^Type=Application$/m.test(body), 'Type Application');
      // , 
      assert(/^Exec=.*"\/opt\/ApkStart\/ApkStart"/m.test(body), 'Exec');
      assert(/com\.example\.app/.test(body), 'Exec --launch');
      assert(/^Icon=.*icon\.png$/m.test(body), 'PNG (ICO Linux )');
      // .desktop , 
      if (process.platform !== 'win32') {
        const mode = fs.statSync(out).mode & 0o777;
        assert((mode & 0o100) !== 0, '.desktop');
      }
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }
  });

  await test('" ":  , rotation 0, ', () => {
    const root = path.join(__dirname, '..');
    const adbJs = fs.readFileSync(path.join(root, 'src', 'core', 'adb.js'), 'utf8');

    // ( 90°): 
    // 1) (hw.lcd.width/height  + )--  doctor.lcdFor
    // 2)  **0**: ,  1
    // 3) :  portrait, 
    // init=1280x720  cur=720x1280
    const setOri = adbJs.slice(adbJs.indexOf('async setOrientation'), adbJs.indexOf('async resetDisplayOverrides'));
    assert(/wm user-rotation lock 0/.test(setOri), 'setOrientation rotation 0( 1 )');
    assert(!/user-rotation lock \$\{landscape \? 1/.test(setOri), 'landscape 1 -- " "');
    assert(/wm set-ignore-orientation-request/.test(setOri), ', ');

    const reset = adbJs.slice(adbJs.indexOf('async resetDisplayOverrides'));
    assert(/wm user-rotation lock 0/.test(reset.slice(0, 800)), 'resetDisplayOverrides 0');
    assert(/wm set-ignore-orientation-request/.test(reset.slice(0, 800)), 'resetDisplayOverrides ignore-orientation');
  });

  await test(':  + + IPC', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    const preloadJs = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');
    const uiJs = fs.readFileSync(path.join(root, 'src', 'ui', 'app.js'), 'utf8');

    // app:stop(, endApp , 
    // → )
    assert(/ipcMain\.handle\('app:stop'/.test(mainJs), 'app:stop IPC');
    
    assert(/stop:\s*\(pkg\)\s*=>\s*invoke\('app:stop'/.test(preloadJs), 'preload stop');
    
    assert(/key:\s*'stop'/.test(uiJs), '" "');
    assert(/case 'stop':/.test(uiJs), 'stop');
    // , 
    assert(/Close Current App/i.test(mainJs), 'Tray menu missing Close Current App');
    // ""
    assert(/apps:changed/.test(mainJs) && /apps:changed/.test(uiJs), 'apps:changed');

    // :  IPC  stopApp , 
    assert(/async function stopApp/.test(mainJs), 'stopApp');
    assert(/ipcMain\.handle\('app:stop'[\s\S]{0,200}stopApp/.test(mainJs), 'app:stop IPC stopApp');
    assert(/stopApp\(pkg\)\.then/.test(mainJs) || /stopApp\(pkg\)/.test(mainJs), 'stopApp');
    // currentAppPkg, "(xxx)"
    assert(/currentAppPkg === target/.test(mainJs) || /currentAppPkg = null/.test(mainJs), 'stopApp currentAppPkg');
    // ()
    assert(/detached[\s\S]{0,200}agent\.hide/.test(mainJs), 'hide close');
    // (Alt+F4) currentAppPkg
    assert(/onCloseApp[\s\S]{0,300}currentAppPkg = null/.test(mainJs) || /onCloseApp[\s\S]{0,300}currentAppPkg === pkg/.test(mainJs), 'onCloseApp currentAppPkg');
  });

  await test(':  ApkStart , ', () => {
    const os = require('os');
    const leftovers = require('../src/core/leftovers');
    const np = (p) => { try { return path.resolve(p).toLowerCase(); } catch (_) { return String(p).toLowerCase(); } };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apkstart-left-'));
    try {
      // "" + "",  ApkStart.exe
      const mk = (name) => {
        const d = path.join(root, name);
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, 'ApkStart.exe'), 'fake-exe');
        return d;
      };
      const old1 = mk('ApkStart-v0.3.9-win64-portable');
      const old2 = mk('ApkStart-win64-portable.prev-2026-01-01T00-00-00-000Z'); 
      const curDir = mk('ApkStart-v0.5.0-win64-portable');

      const r = leftovers.scan({ installDir: curDir, dataDir: root, avdHome: '' });
      const found = r.items.filter((i) => i.kind === 'dir').map((i) => np(i.path));

      assert(found.includes(np(old1)), 'assertion failed');
      // .prev-*  pack.js , , 
      assert(found.includes(np(old2)), '.prev');
      // : 
      assert(!found.includes(np(curDir)), '( )');
    } finally {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }
  });

  await test(',  ANR / _activeApps', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

    // openAppWindow  async:  await . 
    assert(/async function openAppWindow/.test(mainJs), 'openAppWindow async( )');
    // await,  close/endApp  →  → ANR
    assert(/await openAppWindow\(/.test(mainJs), 'runLaunch await openAppWindow');

    // : "",  endApp() --  bug
    const fn = mainJs.slice(mainJs.indexOf('async function openAppWindow'));
    const body = fn.slice(0, fn.indexOf('\n}', fn.indexOf('currentAppPkg = pkg')));
    assert(/currentAppPkg !== pkg/.test(body), '( )');
    assert(/runtime\.endApp\(prev/.test(body) || /runtime\.endApp\(currentAppPkg/.test(body), 'endApp (force-stop + _activeApps)');
    // appWin.open()  close({keepApp:true}),  endApp; 
    // endApp,  open  close. 
    assert(/close\(\{ keepApp: true \}\)/.test(body) && /endApp/.test(body), 'park (close keepApp) endApp , ');

    // _activeApps
    assert(/else if \(currentAppPkg && currentAppPkg !== pkg\)/.test(body), '_activeApps');
  });

  await test(':  , ', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    const htmlJs = fs.readFileSync(path.join(root, 'src', 'ui', 'index.html'), 'utf8');
    const uiJs = fs.readFileSync(path.join(root, 'src', 'ui', 'app.js'), 'utf8');
    const emuJs = fs.readFileSync(path.join(root, 'src', 'core', 'emulator.js'), 'utf8');

    // autoFullscreenOnLaunch ,  -- . 
    const uses = (mainJs.match(/autoFullscreenOnLaunch/g) || []).length;
    assert(uses > 0, 'autoFullscreenOnLaunch ( )');
    assert(/fullscreen:[\s\S]{0,200}autoFullscreenOnLaunch/.test(mainJs), 'openAppWindow fullscreen');

    
    assert(/setAutoFullscreen/.test(htmlJs), '" "');
    assert(/setLandscape/.test(htmlJs), '" "');
    assert(/setAutoFullscreen'\)\.addEventListener/.test(uiJs), 'assertion failed');
    assert(/setLandscape'\)\.addEventListener/.test(uiJs), 'assertion failed');

    // + ; , 
    assert(/panelLandscape/.test(emuJs), 'emulator');
    assert(/orientation mismatch/.test(mainJs), 'assertion failed');
    assert(/reloadApp:\s*false/.test(mainJs), '( )');

    // "", maximize
    const appwinJs = fs.readFileSync(path.join(root, 'src', 'core', 'appwin.js'), 'utf8');
    assert(/_wantFullscreen/.test(appwinJs), 'assertion failed');
    assert(/if \(this\._wantFullscreen\)/.test(appwinJs), 'openDetached');

    // :  rt.client , beforeStart  rt
    const instJs = fs.readFileSync(path.join(root, 'src', 'core', 'installer.js'), 'utf8');
    assert(/beforeStart[\s\S]{0,400}replaced[\s\S]{0,200}replaced\.client/.test(instJs), 'installer.launch beforeStart rt');
    assert(/return newRt/.test(mainJs) || /return rt/.test(mainJs.slice(mainJs.indexOf('restartForOrientation'))), 'restartForOrientation rt beforeStart');

    // :  _panelRatio
    assert(/this\.state\.landscape.*b\.height > b\.width/.test(appwinJs)
      || /landscape.*height.*width/.test(appwinJs), '_panelRatio');
  });

  await test(':  ,  4', () => {
    const root = path.join(__dirname, '..');
    const instJs = fs.readFileSync(path.join(root, 'src', 'core', 'installer.js'), 'utf8');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

    // :  2 , "" 4
    // , "". . 
    assert(/onAppUp/.test(instJs), 'installer.launch onAppUp');
    assert(/if \(!seen && typeof onAppUp === 'function'\)/.test(instJs), 'onAppUp " " , ');

    // , ( await), 
    assert(/onAppUp:\s*\(\)\s*=>/.test(mainJs), 'main.js onAppUp');
    const block = mainJs.slice(mainJs.indexOf('onAppUp: () =>'), mainJs.indexOf('beforeStart:'));
    assert(/attachAppWindow\(\)/.test(block), 'onAppUp');
    assert(!/await attachAppWindow\(\)/.test(block), 'onAppUp await ( ,  )');

    // --
    // /, . 
    assert(/attachDoneEarly/.test(mainJs), 'assertion failed');
    assert(/if \(attachDoneEarly\)/.test(mainJs), 'assertion failed');

    // : ""
    assert(/aliveSince >= 4000/.test(instJs), '4 ( )');
  });

  await test(': AVD Wi-Fi,  " "', () => {
    const root = path.join(__dirname, '..');
    const emuJs = fs.readFileSync(path.join(root, 'src', 'core', 'emulator.js'), 'utf8');
    const engineJs = fs.readFileSync(path.join(root, 'src', 'core', 'engine.js'), 'utf8');

    // API 34  Play Store  wlan0(netsim  Wi-Fi),  eth0. 
    // config.ini  hw.wifi, wlan0  NO-CARRIER, "". 
    assert(/['"]hw\.wifi=yes['"]/.test(emuJs), 'config.ini hw.wifi=yes');

    // : AndroidWifi "Saved / Won't automatically connect", 
    // . shell  NETWORK_SETTINGS , cmd wifi
    // connect-network  SecurityException,  UI . 
    assert(/async repairWifi/.test(emuJs), 'Wi-Fi');
    assert(/WIFI_SETTINGS/.test(emuJs), 'Wi-Fi');
    assert(/uiautomator dump/.test(emuJs), 'uiautomator');
    // "", "!", 
    // , . 
    assert(/captive_portal_http_url/.test(emuJs), 'assertion failed');
    // connect-network (, ). 
    // --. 
    const emuCode = emuJs.split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .filter((l) => l.trim() && !/^\s*(\*|\/\*)/.test(l))
      .join('\n');
    assert(!/cmd wifi connect-network/.test(emuCode), 'shell connect-network , ');

    // : , , 
    const repair = engineJs.slice(engineJs.indexOf('async repairNetwork'));
    const repairBody = repair.slice(0, repair.indexOf('async ', 10) > 0 ? undefined : undefined);
    assert(/repairWifi/.test(repairBody), 'repairNetwork Wi-Fi');
    const wifiAt = repairBody.indexOf('repairWifi');
    const wipeAt = repairBody.indexOf('forceWipeOnNextStart');
    assert(wifiAt > -1 && wipeAt > -1 && wifiAt < wipeAt, ':  Wi-Fi,  ( )');

    // ensureNetwork , 
    const ensure = engineJs.slice(engineJs.indexOf('async ensureNetwork'));
    const ensureBody = ensure.slice(0, ensure.indexOf('async repairNetwork'));
    const eWifi = ensureBody.indexOf('repairWifi');
    const eBoot = ensureBody.indexOf('_netColdBootTried');
    assert(eWifi > -1 && eBoot > -1 && eWifi < eBoot, 'ensureNetwork Wi-Fi, ');

    // (installer), "". 
    // repairWifi,  ensureNetwork(). 
    const instJs = fs.readFileSync(path.join(root, 'src', 'core', 'installer.js'), 'utf8');
    assert(/repairWifi/.test(instJs), 'Wi-Fi');
    assert(!/\.ensureNetwork\(/.test(instJs), 'ensureNetwork( )');
    // engine(this.runtime): rt  ensure() ,  client. 
    // rt.repairWifi  undefined,  catch , . 
    assert(/this\.runtime\.repairWifi\(/.test(instJs), 'repairWifi engine(this.runtime)');
    assert(!/\brt\.repairWifi\(/.test(instJs), 'rt ensure() ,  repairWifi');
    // engine ,  installer  undefined
    assert(/async repairWifi\(/.test(engineJs), 'engine repairWifi');
  });

  await test('WinAgent.setHook(false) PowerShell', async () => {
    const { WinAgent } = require('../src/core/agent');
    const a = new WinAgent();
    a.hooked = false;
    const r = await a.setHook(false);
    assert(r && r.hooked === false, 'hooked=false');
    assert(a.ready === null, 'assertion failed');
  });

  console.log('\n[]');

  await test(':  + , ', () => {
    const store = require('../src/core/store');
    const d = pointer.pointerOptions(store.getSettings());
    assert(d.rightBack === true, 'assertion failed');
    assert(d.wheel === 'smooth', 'assertion failed');
    assert(d.side === false, 'assertion failed');
    assert(d.enabled === true, 'assertion failed');
    // settings.json
    assert(pointer.pointerOptions({ engine: { liteMode: true } }).rightBack === true);
    const off = pointer.pointerOptions({ engine: { mouseRightBack: false, mouseWheelMode: 'off', mouseSideButtons: false } });
    assert(off.enabled === false, 'assertion failed');
    const native = pointer.pointerOptions({ engine: { mouseRightBack: false, mouseWheelMode: 'native', mouseSideButtons: false } });
    assert(native.enabled === false, 'assertion failed');
  });

  await test('hookOptions , ', () => {
    const on = pointer.hookOptions({ enabled: true, rightBack: true, wheel: true, side: false });
    assert(on.rightBack && on.wheel && !on.side);
    const off = pointer.hookOptions({ enabled: false, rightBack: true, wheel: true, side: true });
    assert(!off.rightBack && !off.wheel && !off.side, 'enabled=false');
    assert(pointer.hookOptions(true).side === true, '( )');
    assert(pointer.hookOptions(false).enabled === false);
  });

  await test(':  = ,  = , ', () => {
    const down = pointer.wheelToSwipe({ dy: -120, nx: 0.5, ny: 0.5, width: 900, height: 1600 });
    assert(down && down.y1 > down.y2, '( )');
    const up = pointer.wheelToSwipe({ dy: 120, nx: 0.5, ny: 0.5, width: 900, height: 1600 });
    assert(up && up.y1 < up.y2, '( )');
    assert(pointer.wheelToSwipe({ dx: 0, dy: 0 }) === null, 'assertion failed');
    for (const s of [down, up]) {
      assert([s.x1, s.x2].every((v) => v >= 1 && v <= 899), 'x');
      assert([s.y1, s.y2].every((v) => v >= 1 && v <= 1599), 'y');
      assert(s.duration >= 100 && s.duration <= 240, 'assertion failed');
    }
    const big = pointer.wheelToSwipe({ dy: -12000, nx: 0, ny: 0, width: 900, height: 1600 });
    assert(big.y1 - big.y2 <= Math.round(1600 * 0.78), 'assertion failed');
    const horiz = pointer.wheelToSwipe({ dx: 120, dy: 0, width: 900, height: 1600 });
    assert(horiz && horiz.x1 > horiz.x2 && horiz.y1 === horiz.y2, 'assertion failed');
  });

  await test('input :  , ', async () => {
    assert(pointer.isInputCommand('input keyevent 4'));
    assert(pointer.isInputCommand(pointer.swipeToCommand(pointer.wheelToSwipe({ dy: -120 }))));
    assert(!pointer.isInputCommand('input keyevent 4; rm -rf /sdcard'));
    assert(!pointer.isInputCommand('input swipe 1 2 3 4 100 && reboot'));
    assert(!pointer.isInputCommand('sh -c anything'));
    const c = new AdbClient({ adbPath: 'adb', serial: 'test' });
    let blocked = false;
    try { await c.input('input keyevent 4; rm -rf /'); } catch (e) { blocked = /Invalid/i.test(e.message); }
    assert(blocked, 'adb');
    assert(c._input === null, 'assertion failed');
  });

  await test(',  adb', async () => {
    const c = new AdbClient({ adbPath: 'adb', serial: 'test' });
    const used = [];
    c.input = async (cmd) => { used.push(cmd); };
    c.shell = async () => { used.push('shell'); };
    await c.keyBack();
    assert(used[0] === 'input keyevent 4' && !used.includes('shell'), 'spawn adb');
    const c2 = new AdbClient({ adbPath: 'adb', serial: 'test' });
    const used2 = [];
    c2.input = async () => { throw new Error('offline'); };
    c2.shell = async (cmd) => { used2.push(cmd); return ''; };
    await c2.keyForward();
    assert(used2[0] === 'input keyevent 125', ', ');
  });

  await test('WheelRouter', async () => {
    const cmds = [];
    const r = new pointer.WheelRouter({
      inject: async (cmd) => { cmds.push(cmd); },
      getSize: () => ({ width: 900, height: 1600 }),
      flushMs: 10,
    });
    r.push({ dx: 0, dy: -120, nx: 0.5, ny: 0.5 });
    r.push({ dx: 0, dy: -120, nx: 0.5, ny: 0.5 });
    r.push({ dx: 0, dy: -120, nx: 0.5, ny: 0.4 });
    await r.flush();
    assert(cmds.length === 1, `3  1 ,  ${cmds.length}`);
    assert(pointer.isInputCommand(cmds[0]), 'input swipe');
    const m = /^input swipe (\d+) (\d+) (\d+) (\d+)/.exec(cmds[0]);
    assert(m && Number(m[2]) > Number(m[4]), 'assertion failed');
    r.dispose();
    r.push({ dy: -120 });
    await r.flush();
    assert(cmds.length === 1, 'dispose');
  });

  await test(':  / ,  , ', () => {
    const ps1 = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'win', 'agent.ps1'), 'utf8');
    assert(/WM_RBUTTONDOWN/.test(ps1) && /WM_MOUSEWHEEL/.test(ps1), 'assertion failed');
    assert(/WM_MOUSEHWHEEL/.test(ps1), 'assertion failed');
    assert(/PushWheel\(/.test(ps1) && /FlushWheel\(false\)/.test(ps1), 'assertion failed');
    assert(/GetAncestor\(fg, 2\)/.test(ps1), 'assertion failed');
    assert(/new Thread\(HookThreadProc\)/.test(ps1) && /GetMessage\(out MSG/.test(ps1), 'assertion failed');
    assert(!/Poll\(4000,\s*SelectMode\.SelectRead\)/.test(ps1), 'assertion failed');
    assert(/_optRight == 0/.test(ps1) && /_optWheel == 0/.test(ps1), 'assertion failed');
    const appwinJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'appwin.js'), 'utf8');
    assert(/pointerConfig/.test(appwinJs) && /refreshPointer/.test(appwinJs), 'assertion failed');
    const uiHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'index.html'), 'utf8');
    assert(/setMouseRightBack/.test(uiHtml) && /setMouseWheelMode/.test(uiHtml), 'assertion failed');
  });

  await test('WinAgent.setHook , ', async () => {
    const { WinAgent } = require('../src/core/agent');
    const a = new WinAgent();
    const sent = [];
    a.call = async (obj) => { sent.push(obj); return { ok: true, hooked: true }; };
    const on = await a.setHook(true, { rightBack: true, wheel: true, side: false });
    assert(on.hooked === true && sent.length === 1, 'assertion failed');
    assert(sent[0].right === 1 && sent[0].wheel === 1 && sent[0].side === 0, 'hook');
    await a.setHook(false);
    assert(sent[1].on === 0 && a.hooked === false, 'assertion failed');
    const b = new WinAgent();
    const r = await b.setHook(false);
    assert(r.hooked === false && b.ready === null, 'PowerShell');
  });

  console.log('\n[updater.js ]');
  await test(', v /', () => {
    const { cmpVer } = require('../src/core/updater');
    assert(cmpVer('v0.3.2', '0.3.1') === 1, '0.3.2 0.3.1');
    assert(cmpVer('0.3.1', 'v0.3.1') === 0, 'v');
    assert(cmpVer('0.10.0', '0.9.9') === 1, 'assertion failed');
    assert(cmpVer('1.0.0', '1.0.1') === -1, '1.0.0 1.0.1');
  });

  await test(':  =Setup.exe,  =portable.zip', () => {
    const { Updater } = require('../src/core/updater');
    const dir = path.join(TMP, 'upd-setup');
    fs.mkdirSync(dir, { recursive: true });
    const exe = path.join(dir, 'ApkStart.exe');
    fs.writeFileSync(exe, 'x');
    const portable = new Updater({ currentVersion: '0.1.0', exePath: exe, isPackaged: true, dataDir: TMP });
    assert(portable.flavor === 'portable', 'assertion failed');
    fs.writeFileSync(path.join(dir, 'Uninstall ApkStart.exe'), 'x');
    assert(portable.flavor === 'setup', 'assertion failed');
    // ,  check
    assert(/Setup\.exe$/i.test('ApkStart-0.3.2-Setup.exe'), 'assertion failed');
    assert(/portable.*\.zip$/i.test('ApkStart-v0.3.2-win64-portable.zip'), 'assertion failed');
  });

  await test('(ApkStart-runtime-*.zip)', async () => {
    const { Updater } = require('../src/core/updater');
    const dir = path.join(TMP, 'upd-asset');
    fs.mkdirSync(dir, { recursive: true });
    const exe = path.join(dir, 'ApkStart.exe');
    fs.writeFileSync(exe, 'x');
    const mk = (assets) => ({
      version: '0.5.0', tag: 'v0.5.0', name: 'ApkStart v0.5.0', notes: '', htmlUrl: '',
      publishedAt: '', sources: [], unreachable: [], assets,
    });
    const u = new Updater({ currentVersion: '0.3.4', exePath: exe, isPackaged: true, dataDir: dir });
    // →
    u.sources = { latest: async () => mk([
      { name: 'ApkStart-runtime-v0.5.0.zip', url: 'https://x/runtime.zip', urls: ['https://x/runtime.zip'], sizes: {} },
      { name: 'ApkStart-v0.5.0-win64-portable.zip', url: 'https://x/p.zip', urls: ['https://x/p.zip'], sizes: {} },
    ]) };
    let info = await u.check({ force: true });
    assert(/portable/.test(info.asset.name), `,  ${info.asset.name}`);

    // ()→ ,  1.5GB
    u.sources = { latest: async () => mk([
      { name: 'ApkStart-runtime-v0.5.0.zip', url: 'https://x/runtime.zip', urls: ['https://x/runtime.zip'], sizes: {} },
    ]) };
    info = await u.check({ force: true });
    assert(!info.asset, 'assertion failed');
    assert(info.canAutoApply === false, 'assertion failed');
  });

  await test(':  , ', () => {
    const { Sources, withMirror } = require('../src/core/sources');
    const url = 'https://github.com/o/r/releases/download/v1/a.zip';
    const auto = new Sources(() => ({ runtime: { autoMirror: true } }));
    const list = auto.candidates(url);
    assert(list[0] === url, '( )');
    assert(list.length >= 2 && list.some((u) => u.includes('ghfast.top')), 'assertion failed');

    const custom = new Sources(() => ({ runtime: { autoMirror: true, mirrorPrefix: 'https://my.mirror/' } }));
    const c2 = custom.candidates(url);
    assert(c2.length === 2 && c2[1] === `https://my.mirror/${url}`, `,  ${JSON.stringify(c2)}`);

    const off = new Sources(() => ({ runtime: { autoMirror: false } }));
    assert(off.candidates(url).length === 1, 'assertion failed');
    assert(withMirror(url, 'https://x/') === `https://x/${url}`, 'assertion failed');

    // GitHub: Gitee  403, 
    const giteeUrl = 'https://gitee.com/daily-miku/apkstart/releases/download/v1/a.zip.part1';
    assert(auto.candidates(giteeUrl).length === 1, 'Gitee GitHub');
  });

  await test(':  , ', async () => {
    const { Sources } = require('../src/core/sources');
    const s = new Sources(() => ({ runtime: { autoMirror: false } }));
    // , 
    s._rankCache.set('https://slow/', { at: Date.now(), ok: true, speed: 1000 });
    s._rankCache.set('https://fast/', { at: Date.now(), ok: true, speed: 9000 });
    s._rankCache.set('https://dead/', { at: Date.now(), ok: false, speed: 0 });
    const ranked = await s.rank(['https://slow/', 'https://dead/', 'https://fast/']);
    assert(ranked[0] === 'https://fast/', `,  ${ranked[0]}`);
    assert(ranked[2] === 'https://dead/', '( )');
    s.reset();
    assert(s._rankCache.size === 0, 'reset ( / )');
  });

  await test(': Gitee (v1.2.3.zip)', async () => {
    const { Sources } = require('../src/core/sources');
    const s2 = new Sources(() => ({ runtime: {} }));
    s2.fetchReleases = async () => [
      {
        source: 'gitee',
        name: 'Gitee',
        web: 'e',
        rel: {
          tag_name: 'v0.3.2',
          assets: [
            { name: 'v0.3.2.zip', size: 999, browser_download_url: 'ge://src' },
            { name: 'v0.3.2.tar.gz', size: 999, browser_download_url: 'ge://src2' },
            { name: 'ApkStart-v0.3.2-win64-portable.zip', size: 10, browser_download_url: 'ge://ok' },
          ],
        },
      },
    ];
    const m = await s2.latest();
    assert(m.assets.length === 1 && m.assets[0].url === 'ge://ok',
      ` ApkStart* ,  ${JSON.stringify(m.assets.map((a) => a.name))}`);
  });

  await test('Gitee size :  ( )', async () => {
    const { Sources } = require('../src/core/sources');
    const s = new Sources(() => ({ runtime: {} }));
    s.fetchReleases = async () => [{
      source: 'gitee',
      name: 'Gitee',
      web: 'e',
      rel: {
        tag_name: 'v0.3.3',
        // Gitee  name + url,  size()
        assets: [
          { name: 'ApkStart-v0.3.3-win64-portable.zip.part1', browser_download_url: 'ge://p1' },
          { name: 'ApkStart-v0.3.3-win64-portable.zip.part2', browser_download_url: 'ge://p2' },
        ],
      },
    }];
    const m = await s.latest();
    assert(m.assets.length === 1, ` 1 ,  ${m.assets.length}`);
    const a = m.assets[0];
    assert(a.name === 'ApkStart-v0.3.3-win64-portable.zip', `,  ${a.name}`);
    assert(a.parts && a.parts.length === 2, 'assertion failed');
    assert(a.parts[0].urls[0] === 'ge://p1' && a.parts[1].urls[0] === 'ge://p2', '/');
    assert(a.size === 0, '0( )');
  });

  await test('updater.asset,  prepare " "', async () => {
    const { Updater } = require('../src/core/updater');
    const u = new Updater({
      currentVersion: '0.0.1', exePath: path.join(TMP, 'A.exe'), isPackaged: true, dataDir: TMP,
      settings: () => ({}),
    });
    u.sources.latest = async () => ({
      version: '9.9.9',
      tag: 'v9.9.9',
      assets: [{
        name: 'ApkStart-v9.9.9-win64-portable.zip',
        size: 0,
        partial: true,
        parts: [{ index: 1, size: 0, urls: ['https://gitee.com/x/p1'] }, { index: 2, size: 0, urls: ['https://gitee.com/x/p2'] }],
      }],
      sources: [{ source: 'gitee', name: 'Gitee', tag: 'v9.9.9' }],
      unreachable: [],
    });
    const info = await u.check({ force: true });
    assert(info.asset && info.asset.parts && info.asset.parts.length === 2, 'parts asset');
    assert(info.canAutoApply === true, 'assertion failed');
  });

  await test(':  , ', async () => {
    const { Sources } = require('../src/core/sources');
    const s = new Sources(() => ({ runtime: {} }));
    s.fetchReleases = async () => [
      { source: 'github', name: 'GitHub', web: 'g', rel: { tag_name: 'v0.4.0', assets: [{ name: 'ApkStart-A-portable.zip', size: 10, browser_download_url: 'gh://a' }] } },
      { source: 'gitee', name: 'Gitee', web: 'e', rel: { tag_name: 'v0.3.9', assets: [{ name: 'ApkStart-A-portable.zip', size: 10, browser_download_url: 'ge://a' }, { name: 'ApkStart-B.txt', size: 1, browser_download_url: 'ge://b' }] } },
    ];
    const m = await s.latest();
    assert(m.version === '0.4.0', `,  ${m.version}`);
    assert(m.assets.length === 1 && m.assets[0].url === 'gh://a', 'assertion failed');
  });

  await test(': scope ,  ( )', async () => {
    const { WinAgent } = require('../src/core/agent');
    const a = new WinAgent();
    const sent = [];
    // : 
    a.call = async (obj) => { sent.push(obj); return { ok: true, n: 1 }; };
    const r = await a.scope(['C:////runtime', '', null, 'D:////repo////engine']);
    assert(sent.length === 1 && sent[0].cmd === 'scope', ` scope,  ${JSON.stringify(sent)}`);
    assert(sent[0].dirs === 'C:////runtime;D:////repo////engine', `,  ${sent[0].dirs}`);
    assert(r.ok === true, 'scope ok');
    // : "", 
    const empty = await a.scope([]);
    assert(sent[1].dirs === '' && empty.ok === true, '( )');
  });

  await test(':  ,  ( Gitee )', async () => {
    const { Sources } = require('../src/core/sources');
    const s = new Sources(() => ({ runtime: { autoMirror: false } }));
    const gh = 'https://github.com/o/r/releases/download/v0.3.3/a.zip';
    const ge = 'https://gitee.com/o/r/releases/download/v0.3.3/a.zip';
    s.fetchReleases = async () => [
      { source: 'github', name: 'GitHub', web: 'g', rel: { tag_name: 'v0.3.3', assets: [{ name: 'ApkStart-v0.3.3-win64-portable.zip', size: 108200693, browser_download_url: gh }] } },
      // Gitee  size(),  GitHub
      { source: 'gitee', name: 'Gitee', web: 'e', rel: { tag_name: 'v0.3.3', assets: [{ name: 'ApkStart-v0.3.3-win64-portable.zip', browser_download_url: ge }] } },
    ];
    const m = await s.latest();
    assert(m.assets.length === 1, ` 1 ,  ${m.assets.length}`);
    const a = m.assets[0];
    assert(a.urls.length === 2 && a.urls[1] === ge, `,  ${JSON.stringify(a.urls)}`);
    assert(a.sizes[gh] === 108200693 && !a.sizes[ge], ', ');
    const cands = s.candidates(a);
    assert(cands.length === 2 && cands[0] === gh, `,  ${JSON.stringify(cands)}`);
  });

  await test(':  ,  ( )', async () => {
    const http = require('http');
    const { downloadMulti } = require('../src/core/download');
    const MB = 1024 * 1024;
    const small = Buffer.alloc(3 * MB);   // ()
    const big = Buffer.alloc(5 * MB);
    for (let i = 0; i < small.length; i += 1) small[i] = i % 251;
    for (let i = 0; i < big.length; i += 1) big[i] = (i * 7) % 251;
    const serve = (data) => (req, res) => {
      const r = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
      if (!r) { res.writeHead(200, { 'Content-Length': data.length }); res.end(data); return; }
      const a = Number(r[1]);
      const b = Math.min(Number(r[2]), data.length - 1);
      res.writeHead(206, {
        'Content-Range': `bytes ${a}-${b}/${data.length}`,
        'Content-Length': b - a + 1,
      });
      res.end(data.slice(a, b + 1));
    };
    const mk = (data) => new Promise((resolve) => {
      const srv = http.createServer(serve(data));
      srv.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const s1 = await mk(small);
    const s2 = await mk(big);
    const out = path.join(TMP, 'mixed-size.bin');
    try {
      // = rank() : 
      await downloadMulti([`http://127.0.0.1:${s1.address().port}/f`, `http://127.0.0.1:${s2.address().port}/f`], out, { connections: 4 });
      const got = fs.readFileSync(out);
      assert(got.length === small.length && Buffer.compare(got, small) === 0,
        `(${small.length} ),  ${got.length} `);
    } finally {
      s1.close(); s2.close();
      fs.rmSync(out, { force: true });
    }
  });

  await test(':  , ', async () => {
    const http = require('http');
    const { Updater } = require('../src/core/updater');
    const partA = Buffer.alloc(4096, 0x41);
    const partB = Buffer.alloc(2048, 0x42);
    const srv = http.createServer((req, res) => {
      if (req.url.startsWith('/a')) { res.writeHead(200, { 'Content-Length': partA.length }); res.end(partA); return; }
      if (req.url.startsWith('/b')) { res.writeHead(200, { 'Content-Length': partB.length }); res.end(partB); return; }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const sb = path.join(TMP, 'parts-upd');
    fs.mkdirSync(sb, { recursive: true });
    const u = new Updater({ currentVersion: '0.0.0', exePath: path.join(sb, 'A.exe'), isPackaged: true, dataDir: sb, settings: () => ({}) });
    const target = path.join(sb, 'joined.zip');
    try {
      await u._downloadParts({
        name: 'joined.zip',
        size: partA.length + partB.length,
        parts: [
          { index: 1, size: partA.length, urls: [`http://127.0.0.1:${port}/a`] },
          { index: 2, size: partB.length, urls: [`http://127.0.0.1:${port}/b`] },
        ],
      }, target, 2, partA.length + partB.length);
      const got = fs.readFileSync(target);
      assert(got.length === partA.length + partB.length, 'assertion failed');
      assert(got.slice(0, partA.length).every((b) => b === 0x41), 'assertion failed');
      assert(got.slice(partA.length).every((b) => b === 0x42), 'assertion failed');
    } finally {
      srv.close();
      fs.rmSync(sb, { recursive: true, force: true });
    }
  });

  await test(':  , ', async () => {
    const http = require('http');
    const { downloadMulti } = require('../src/core/download');
    const data = Buffer.alloc(3 * 1024 * 1024);
    for (let i = 0; i < data.length; i += 1) data[i] = i % 251;
    const handler = (req, res) => {
      const r = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
      if (!r) { res.writeHead(200, { 'Content-Length': data.length }); res.end(data); return; }
      const a = Number(r[1]);
      const b = Math.min(Number(r[2]), data.length - 1);
      res.writeHead(206, {
        'Content-Range': `bytes ${a}-${b}/${data.length}`,
        'Content-Length': b - a + 1,
      });
      res.end(data.slice(a, b + 1));
    };
    // listening :  listen , 
    const mk = () => new Promise((resolve) => {
      const srv = http.createServer(handler);
      srv.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const s1 = await mk();
    const s2 = await mk();
    const urls = [
      `http://127.0.0.1:${s1.address().port}/f`,
      `http://127.0.0.1:${s2.address().port}/f`,
    ];
    const out = path.join(TMP, 'multi.bin');
    try {
      const r = await downloadMulti(urls, out, { connections: 6, minChunk: 512 * 1024 });
      const got = fs.readFileSync(out);
      assert(Buffer.compare(got, data) === 0, 'assertion failed');
      assert(r.sources === 2 && r.parallel >= 2, ` 2 ,  ${JSON.stringify(r)}`);
      assert(got.length === data.length, 'assertion failed');
    } finally {
      s1.close(); s2.close();
      fs.rmSync(out, { force: true });
    }
  });

  await test(':  ( 1.4GB)', async () => {
    const http = require('http');
    const { downloadMulti } = require('../src/core/download');
    const MB = 1024 * 1024;
    const total = 3 * MB;
    const data = Buffer.alloc(total);
    for (let i = 0; i < total; i += 1) data[i] = i % 251;
    let ranged = 0;
    const handler = (req, res) => {
      const r = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
      if (!r) { res.writeHead(200, { 'Content-Length': total }); res.end(data); return; }
      const a = Number(r[1]);
      const b = Math.min(Number(r[2]), total - 1);
      if (b > a) ranged += 1;          // ( 0-0 )
      res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${total}`, 'Content-Length': b - a + 1 });
      res.end(data.slice(a, b + 1));
    };
    // :  downloadMulti ()
    const mk = () => new Promise((resolve) => {
      const srv = http.createServer(handler);
      srv.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const s1 = await mk();
    const s2 = await mk();
    const urls = [`http://127.0.0.1:${s1.address().port}/f`, `http://127.0.0.1:${s2.address().port}/f`];
    const out = path.join(TMP, 'multi-resume.bin');
    try {
      // ", "(: 3  × 1MB)
      const per = Math.ceil(total / 3);
      const fd = fs.openSync(out, 'w');
      fs.ftruncateSync(fd, total);
      fs.writeSync(fd, data, 0, per * 2, 0);
      fs.closeSync(fd);
      fs.writeFileSync(`${out}.chunks.json`, JSON.stringify({ total, n: 3, done: [0, per] }));

      const r = await downloadMulti(urls, out, { connections: 3, minChunk: MB });
      assert(r.resumed === true, 'assertion failed');
      assert(ranged === 1, ` 1 ,  ${ranged} `);
      assert(Buffer.compare(fs.readFileSync(out), data) === 0, 'assertion failed');
      assert(!fs.existsSync(`${out}.chunks.json`), 'assertion failed');
    } finally {
      s1.close(); s2.close();
      fs.rmSync(out, { force: true });
      fs.rmSync(`${out}.chunks.json`, { force: true });
    }
  });

  await test(':  , ', async () => {
    const http = require('http');
    const { downloadMulti } = require('../src/core/download');
    const data = Buffer.alloc(4 * 1024 * 1024, 9);
    // , : "TCP /"
    const stall = http.createServer((req, res) => {
      const r = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
      if (!r) { res.writeHead(200, { 'Content-Length': data.length }); res.end(data); return; }
      const a = Number(r[1]);
      const b = Math.min(Number(r[2]), data.length - 1);
      res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${data.length}`, 'Content-Length': b - a + 1 });
      // 1KB, 
      res.write(data.slice(a, a + 1024));
    });
    const good = http.createServer((req, res) => {
      const r = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
      if (!r) { res.writeHead(200, { 'Content-Length': data.length }); res.end(data); return; }
      const a = Number(r[1]);
      const b = Math.min(Number(r[2]), data.length - 1);
      res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${data.length}`, 'Content-Length': b - a + 1 });
      res.end(data.slice(a, b + 1));
    });
    const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
    const s1 = await listen(stall);
    const s2 = await listen(good);
    const out = path.join(TMP, 'stall.bin');
    const t0 = Date.now();
    try {
      const r = await downloadMulti(
        [`http://127.0.0.1:${s1.address().port}/f`, `http://127.0.0.1:${s2.address().port}/f`],
        out,
        { connections: 4, minChunk: 1024 * 1024, idleMs: 400, retries: 2 },
      );
      const cost = Date.now() - t0;
      assert(fs.statSync(out).size === data.length, 'assertion failed');
      assert(cost < 15000, `,  ${cost}ms`);
    } finally {
      s1.close(); s2.close();
      fs.rmSync(out, { force: true });
      fs.rmSync(`${out}.chunks.json`, { force: true });
    }
  });

  await test(':  KB/s ,  %', async () => {
    const http = require('http');
    const { downloadMulti } = require('../src/core/download');
    const MB = 1024 * 1024;
    const total = 2 * MB;
    const data = Buffer.alloc(total, 5);
    // :  100ms  4KB(≈40KB/s)
    const slow = http.createServer((req, res) => {
      const r = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
      if (!r) { res.writeHead(200, { 'Content-Length': total }); res.end(data); return; }
      const a = Number(r[1]);
      const b = Math.min(Number(r[2]), total - 1);
      res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${total}`, 'Content-Length': b - a + 1 });
      let pos = a;
      const pump = () => {
        if (pos > b) { res.end(); return; }
        const chunk = data.slice(pos, Math.min(b + 1, pos + 4096));
        pos += chunk.length;
        res.write(chunk);
        setTimeout(pump, 100);
      };
      pump();
    });
    const fast = http.createServer((req, res) => {
      const r = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
      if (!r) { res.writeHead(200, { 'Content-Length': total }); res.end(data); return; }
      const a = Number(r[1]);
      const b = Math.min(Number(r[2]), total - 1);
      res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${total}`, 'Content-Length': b - a + 1 });
      res.end(data.slice(a, b + 1));
    });
    const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
    const s1 = await listen(slow);
    const s2 = await listen(fast);
    const out = path.join(TMP, 'slowrot.bin');
    const t0 = Date.now();
    try {
      await downloadMulti(
        [`http://127.0.0.1:${s1.address().port}/f`, `http://127.0.0.1:${s2.address().port}/f`],
        out,
        { connections: 2, minChunk: 512 * 1024, idleMs: 3000, slowAfterMs: 400, slowBps: 200 * 1024 },
      );
      const cost = Date.now() - t0;
      assert(Buffer.compare(fs.readFileSync(out), data) === 0, 'assertion failed');
      // 2MB / 40KB/s ≈ 50 ; 
      assert(cost < 15000, `,  ${cost}ms`);
    } finally {
      s1.close(); s2.close();
      fs.rmSync(out, { force: true });
      fs.rmSync(`${out}.chunks.json`, { force: true });
    }
  });

  await test(': ', async () => {
    const http = require('http');
    const { downloadMulti } = require('../src/core/download');
    const data = Buffer.alloc(2 * 1024 * 1024, 7);
    const srv = http.createServer((req, res) => {
      const r = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
      if (!r) { res.writeHead(200, { 'Content-Length': data.length }); res.end(data); return; }
      const a = Number(r[1]);
      const b = Math.min(Number(r[2]), data.length - 1);
      res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${data.length}`, 'Content-Length': b - a + 1 });
      res.end(data.slice(a, b + 1));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/f`;
    // ", ", 
    const probe = http.createServer(() => {});
    await new Promise((r) => probe.listen(0, '127.0.0.1', r));
    const deadPort = probe.address().port;
    await new Promise((r) => probe.close(r));
    const out = path.join(TMP, 'multi1.bin');
    try {
      // : 
      const r = await downloadMulti([url, `http://127.0.0.1:${deadPort}/nope`], out, { connections: 4 });
      assert(fs.statSync(out).size === data.length, 'assertion failed');
      assert(!r.multi || r.sources === 1, 'assertion failed');
    } finally {
      srv.close();
      fs.rmSync(out, { force: true });
    }
  });

  await test(':  10 , force', async () => {
    const { Sources } = require('../src/core/sources');
    const s = new Sources(() => ({ runtime: {} }));
    let calls = 0;
    s.fetchReleases = async () => {
      calls += 1;
      return [{ source: 'github', name: 'GitHub', web: 'g', rel: { tag_name: 'v1.0.0', assets: [] } }];
    };
    await s.latest();
    await s.latest();
    assert(calls === 1, `,  ${calls} `);
    await s.latest({ force: true });
    assert(calls === 2, 'force');
    s.reset();
    await s.latest();
    assert(calls === 3, 'reset');
  });

  await test(':  403 , ', async () => {
    const { Sources } = require('../src/core/sources');
    const s = new Sources(() => ({ runtime: {} }));
    let giteeCalls = 0;
    s.fetchReleases = async () => {
      giteeCalls += 1;
      return [
        { source: 'github', name: 'GitHub', web: 'g', rel: { tag_name: 'v1.0.0', assets: [] } },
        { source: 'gitee', name: 'Gitee', web: 'e', error: 'gitee.com 403 ()' },
      ];
    };
    // : Gitee  403, 
    await s.latest({ force: true });
    assert(giteeCalls === 1, 'assertion failed');
    const reason = s.blockedReason('gitee');
    assert(!!reason, '403');
    assert(s.blockedReason('github') === null, 'assertion failed');
    // ()
    assert(/Temporarily skipped/i.test(reason), `, : ${reason}`);
    s.reset();
    assert(s.blockedReason('gitee') === null, 'reset');
  });

  await test(':  ( stale,  )', async () => {
    const { Sources } = require('../src/core/sources');
    const s = new Sources(() => ({ runtime: {} }));
    s.fetchReleases = async () => [
      { source: 'github', name: 'GitHub', web: 'g', rel: { tag_name: 'v1.2.3', assets: [] } },
    ];
    const first = await s.latest();
    assert(first.tag === 'v1.2.3' && !first.stale, 'assertion failed');
    s._relTtl = 0;   
    s.fetchReleases = async () => [
      { source: 'github', name: 'GitHub', web: 'g', error: '' },
    ];
    const second = await s.latest();
    assert(second.tag === 'v1.2.3' && second.stale === true, 'stale');
  });

  await test(':  (CI )', () => {
    const fs2 = require('fs');
    const os2 = require('os');
    const tmp = fs2.mkdtempSync(path.join(os2.tmpdir(), 'sysroot-'));
    const oldAppData = process.env.APPDATA;
    process.env.APPDATA = path.join(tmp, 'appdata');
    try {
      const store = require('../src/core/store');
      const { Provisioner } = require('../src/core/provision');
      const root = path.join(tmp, 'rt');
      store.saveSettings({ runtime: { dir: root } });
      const p = new Provisioner(path.join(__dirname, '..'));

      // 1) :  system-images →
      assert(p.paths().sysImgRoot === path.join(root, 'system-images'),
        `,  ${p.paths().sysImgRoot}`);

      // 2) ()→
      fs2.mkdirSync(path.join(root, 'system-images'), { recursive: true });
      assert(p.paths().sysImgRoot === path.join(root, 'system-images'), 'assertion failed');

      // 3) ()→
      fs2.rmSync(path.join(root, 'system-images'), { recursive: true, force: true });
      fs2.mkdirSync(path.join(store.DATA_DIR, 'system-images'), { recursive: true });
      assert(p.paths().sysImgRoot === path.join(store.DATA_DIR, 'system-images'),
        `,  ${p.paths().sysImgRoot}`);
    } finally {
      if (oldAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = oldAppData;
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test('(MSIX ): ', () => {
    const fs2 = require('fs');
    const os2 = require('os');
    const tmp = fs2.mkdtempSync(path.join(os2.tmpdir(), 'ro-root-'));
    const oldAppData = process.env.APPDATA;
    process.env.APPDATA = path.join(tmp, 'appdata');
    try {
      const store = require('../src/core/store');
      const { Provisioner } = require('../src/core/provision');
      // "" root: , mkdir  EEXIST/ENOTDIR
      const blocker = path.join(tmp, 'blocker');
      fs2.writeFileSync(blocker, 'x');
      const roRoot = path.join(blocker, 'rt');
      store.saveSettings({ runtime: { dir: roRoot } });
      const p = new Provisioner(path.join(__dirname, '..'));
      const paths = p.paths();
      assert(paths.rootWritable === false, 'assertion failed');
      // : , (, )
      assert(paths.sysImgRoot === path.join(store.DATA_DIR, 'system-images'),
        `,  ${paths.sysImgRoot}`);
      assert(paths.tmp.toLowerCase().startsWith(store.DATA_DIR.toLowerCase()), '_tmp');
      assert(paths.avdHome.toLowerCase().startsWith(store.DATA_DIR.toLowerCase()), 'AVD');
      // (, %APPDATA% )
      assert(paths.emulatorExe === path.join(roRoot, 'emulator', 'emulator.exe'), 'emulator');
      assert(paths.adbExe === path.join(roRoot, 'platform-tools', 'adb.exe'), 'adb');
      // ensureDirs  root
      p.ensureDirs();
    } finally {
      if (oldAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = oldAppData;
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test('" ",  1.5GB', () => {
    const fs2 = require('fs');
    const os2 = require('os');
    const tmp = fs2.mkdtempSync(path.join(os2.tmpdir(), 'packed-img-'));
    const oldAppData = process.env.APPDATA;
    process.env.APPDATA = path.join(tmp, 'appdata');
    const sparse = (file, size) => {
      fs2.mkdirSync(path.dirname(file), { recursive: true });
      fs2.writeFileSync(file, '');
      fs2.truncateSync(file, size);   // : , 
    };
    try {
      const store = require('../src/core/store');
      const { Provisioner } = require('../src/core/provision');
      // /  MSIX:  .xz,  system.img
      const root = path.join(tmp, 'rt');
      const dir = path.join(root, 'system-images', 'android-34', 'google_apis_playstore', 'x86_64');
      sparse(path.join(dir, 'system.img.xz'), 320 * 1024 * 1024);
      fs2.writeFileSync(path.join(dir, 'kernel-ranchu'), 'x');
      store.saveSettings({ runtime: { dir: root } });
      // appRoot ,  engine/system-images
      const p = new Provisioner(path.join(tmp, 'empty-app'));
      const sys = p.systemImageInfo();
      assert(sys.ok === true, '( autoDeploy )');
      assert(sys.compressed === true, '" "');
      assert(String(sys.dir).toLowerCase().startsWith(root.toLowerCase()), 'assertion failed');
      const play = p.playImageInfo();
      assert(play.ok === true && play.compressed === true, 'assertion failed');

      // ( system.img) compressed=false, 
      sparse(path.join(dir, 'system.img'), 320 * 1024 * 1024);
      const after = p.systemImageInfo();
      assert(after.ok === true && after.compressed === false, 'assertion failed');
    } finally {
      if (oldAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = oldAppData;
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  console.log('\n[ /  / ]');

  await test(',  vCPU/ /', () => {
    const store = require('../src/core/store');
    let s = store.saveSettings({ engine: { resourceMode: 'smooth' } });
    assert(s.engine.liteMode === false, 'assertion failed');
    assert(s.engine.priorityMode === 'game', '(FPS/ )');
    assert(s.engine.renderSize === '720x1280', ` 720p,  ${s.engine.renderSize}`);
    s = store.saveSettings({ engine: { resourceMode: 'save' } });
    assert(s.engine.liteMode === true && s.engine.renderSize === '540x960', '540p +');
    s = store.saveSettings({ engine: { resourceMode: 'balanced' } });
    assert(s.engine.renderSize === 'auto', 'assertion failed');
  });

  await test(', ', () => {
    const store = require('../src/core/store');
    store.saveSettings({ engine: { dataPartitionGB: 12 } });
    const p = doctor.autoProfile({ settings: store.getSettings(), accel: { ok: true }, emulatorVersion: '37.3.8.0', diskMB: 50000 });
    assert(p.dataMB === 12 * 1024, ` 12GB,  ${p.dataMB}MB`);
    store.saveSettings({ engine: { dataPartitionGB: 0 } });
    const auto = doctor.autoProfile({ settings: store.getSettings(), accel: { ok: true }, emulatorVersion: '37.3.8.0', diskMB: 50000 });
    assert(auto.dataMB === 6144, ` 6GB,  ${auto.dataMB}`);
  });

  await test('( ,  )', () => {
    const base = { emulatorVersion: '37.3.8', api: '34', tag: 'google_apis_playstore' };
    const a = doctor.snapshotKey({ ...base, dataMB: 4096 }, 'img');
    const b = doctor.snapshotKey({ ...base, dataMB: 24576 }, 'img');
    assert(a === b, 'assertion failed');
    const c = doctor.snapshotKey({ ...base, dataMB: 4096, emulatorVersion: '36.0.0' }, 'img');
    assert(a !== c, 'assertion failed');
  });

  await test(', ', () => {
    const lf = require('../src/core/logfile');
    const f = path.join(TMP, 'rot.log');
    fs.writeFileSync(f, 'x'.repeat(300 * 1024));
    const rotated = lf.rotate(f, 256);
    assert(rotated === true, 'assertion failed');
    assert(!fs.existsSync(f) && fs.existsSync(path.join(TMP, 'rot.1.log')), '.1.log');
  });

  await test('.log :  , ', () => {
    const lf = require('../src/core/logfile');
    const f = path.join(TMP, 'plain.txt');
    fs.writeFileSync(f, 'x'.repeat(300 * 1024));
    const rotated = lf.rotate(f, 256);
    assert(rotated === false, 'bak');
    assert(fs.existsSync(f), 'assertion failed');
  });

  await test(', ', () => {
    const { EmulatorEngine } = require('../src/core/emulator');
    const emu = new EmulatorEngine(path.join(__dirname, '..'));
    emu.lastExitCode = 3221225477;
    emu.lastDiagnosis = doctor.diagnose(['emulator exit 3221225477']);
    emu.attempts = [{ plan: 'host / ', diagnosis: 'ACCESS_VIOLATION', exitCode: 3221225477 }];
    emu._persistFailure({ why: 'test' });
    const back = emu.lastFailure();
    assert(back && back.exitCode === 3221225477, 'assertion failed');
    assert(back.diagnosis && back.diagnosis.code === 'ACCESS_VIOLATION', 'assertion failed');
    assert(back.attempts.length === 1, 'assertion failed');
    emu._clearFailure();
    assert(emu.lastFailure() === null, 'assertion failed');
  });

  await test('.xapk :  ,  base, ', async () => {
    const crypto = require('crypto');
    const { parseBundle } = require('../src/core/installer');
    const { buildApkBytes, buildStoredZip } = require('./lib/make-apk');
    const apk = buildApkBytes();

    // : (base + config), meta
    const okPath = path.join(TMP, 'ok.xapk');
    fs.writeFileSync(okPath, buildStoredZip([
      { name: 'base.apk', data: apk },
      { name: 'split_config.arm64_v8a.apk', data: apk },
      { name: 'manifest.json', data: Buffer.from('{}') },
    ]));
    const b = await parseBundle(okPath);
    try {
      assert(b.files.length === 2, ` 2 ,  ${b.files.length}`);
      assert(b.files.every((f) => fs.existsSync(f)), 'assertion failed');
      assert(b.meta.package === 'com.example.test', ` ${b.meta.package}`);
    } finally {
      b.cleanup();
    }

    // :  APK  → , 
    const badPath = path.join(TMP, 'bad.xapk');
    fs.writeFileSync(badPath, buildStoredZip([{ name: 'readme.txt', data: Buffer.from('nope') }]));
    let err = null;
    try { await parseBundle(badPath); } catch (e) { err = e; }
    assert(err && (/ APK /.test(err.message) || /No APK splits found/i.test(err.message)), `,  ${err && err.message}`);
    const dir = path.join(os.tmpdir(), 'apkstart-bundle',
      crypto.createHash('sha1').update(badPath).digest('hex').slice(0, 12));
    assert(!fs.existsSync(dir), 'assertion failed');
  });

  await test('materializeImages:  .img.gz,  , ', async () => {
    const zlib = require('zlib');
    const store = require('../src/core/store');
    const { Provisioner } = require('../src/core/provision');
    const before = store.getSettings().runtime.dir;
    const rt = path.join(TMP, 'rt-materialize');
    const imgDir = path.join(rt, 'system-images', 'android-34', 'google_apis_playstore', 'x86_64');
    fs.mkdirSync(imgDir, { recursive: true });
    fs.writeFileSync(path.join(imgDir, 'kernel-ranchu'), 'kernel');
    // 40MB : gzip  KB,  >32MB, ""
    fs.writeFileSync(path.join(imgDir, 'system.img.gz'), zlib.gzipSync(Buffer.alloc(40 * 1024 * 1024, 7)));
    store.saveSettings({ runtime: { dir: rt } });
    const prov = new Provisioner(path.join(__dirname, '..'));
    try {
      const n = await prov.materializeImages();
      assert(n === 1, ` 1 ,  ${n}`);
      const img = path.join(imgDir, 'system.img');
      assert(fs.statSync(img).size === 40 * 1024 * 1024, 'assertion failed');
      assert(fs.existsSync(path.join(imgDir, 'kernel-ranchu')), 'assertion failed');
      assert(!fs.existsSync(`${img}.part`), '.part');

      const again = await prov.materializeImages();
      assert(again === 0, `,  ${again}`);

      // :  MATERIALIZE_FAILED,  .part()
      fs.rmSync(img, { force: true });
      fs.writeFileSync(path.join(imgDir, 'system.img.gz'), Buffer.from('not a gzip at all'));
      let err = null;
      try { await prov.materializeImages(); } catch (e) { err = e; }
      assert(err && err.code === 'MATERIALIZE_FAILED', `,  ${err && err.message}`);
      assert(!fs.existsSync(`${img}.part`), '.part');
    } finally {
      store.saveSettings({ runtime: { dir: before } });
    }
  });

  await test('/ : provisioner ( )', () => {
    const { Provisioner } = require('../src/core/provision');
    const p = new Provisioner(path.join(__dirname, '..'));
    // /
    p._cache.pack = { url: 'https://old.example/runtime.zip', tag: 'v1' };
    p._cache.emulatorUrl = 'https://old.example/emulator.zip';
    p._cache.sysimgUrl = 'https://old.example/sysimg.zip';
    p.invalidateEnvCache();
    assert(!p._cache.pack, 'assertion failed');
    assert(!p._cache.emulatorUrl && !p._cache.sysimgUrl, '/');
  });

  await test('( )', () => {
    const { EmulatorEngine } = require('../src/core/emulator');
    const emu = new EmulatorEngine(path.join(__dirname, '..'));
    emu._log = [
      { t: 1, line: 'Graphics backend: gfxstream' },
      { t: 2, line: 'emulator exit 3221225477' },        // 1 : 0xC0000005
      { t: 3, line: '---  2  ---' },
      { t: 4, line: 'Address already in use' },          // 2 : 
    ];
    assert(doctor.diagnose(emu._attemptLines(0, 80)).code === 'ACCESS_VIOLATION', '1');
    assert(doctor.diagnose(emu._attemptLines(2, 80)).code === 'PORT_BUSY', '2');
    // ,  UNKNOWN
    const fallback = emu._attemptLines(emu._log.length, 80);
    assert(fallback.length === emu._log.length, `,  ${fallback.length} `);
  });

  await test(':  ( )', () => {
    const { componentArg, parseResolvedActivity } = require('../src/core/adb');
    // (v0.3.4  apps.json )→
    assert(componentArg('com.phoenix.read', 'com.phoenix.read/com.dragon.read.pages.splash.SplashActivity')
      === 'com.phoenix.read/com.dragon.read.pages.splash.SplashActivity', 'assertion failed');
    // :  /  →
    assert(componentArg('com.a.b', 'MainActivity') === 'com.a.b/MainActivity');
    assert(componentArg('com.a.b', '.MainActivity') === 'com.a.b/.MainActivity');
    assert(componentArg('com.a.b', '') === '', 'activity ( intent)');
    // resolve-activity /priority : 
    const out = 'priority=0\ncom.phoenix.read/com.dragon.read.pages.splash.SplashActivity\n\n';
    assert(parseResolvedActivity('com.phoenix.read', out)
      === 'com.phoenix.read/com.dragon.read.pages.splash.SplashActivity', 'assertion failed');
    assert(parseResolvedActivity('com.other', out) === '', 'assertion failed');
  });

  await test(': ', () => {
    const root = path.join(__dirname, '..');
    const appwin = fs.readFileSync(path.join(root, 'src', 'core', 'appwin.js'), 'utf8');
    // maximize()  show:false  BrowserWindow  --
    // "". 
    assert(/fullscreen && !this\.detachedMode\) this\.win\.maximize\(\)/.test(appwin), 'maximize ( )');
    assert(/if \(this\.detachedMode\) this\.agent\.show\(\)/.test(appwin), ', ');
    // ready-to-show  show:  showWhileWaiting(, 
    // )"...". 
    const readyIdx = appwin.indexOf("once('ready-to-show'");
    assert(readyIdx > 0 && /if \(this\.detachedMode && !this\._showWhileWaiting\) return;/
      .test(appwin.slice(readyIdx, readyIdx + 600)), 'ready-to-show return');
  });

  await test(': splash , ', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    // runLaunch / autoDeploy  whenReady ****,  const
    // splashDone (typeof  'undefined')--
    // 480x360  alwaysOnTop . 
    assert(/^let splashWin = null;$/m.test(mainJs), 'splashWin let');
    assert(/^let splashDone = \(\) => \{\};$/m.test(mainJs), 'splashDone let');
    assert(/^let splashProgress = \(\) => \{\};$/m.test(mainJs), 'splashProgress let');
    assert(!/const splashDone = \(\) =>/.test(mainJs), 'whenReady const');
    // : splash
    assert(/setTimeout\(\(\) => \{[\s\S]{0,160}splashWin\.close\(\);/.test(mainJs), 'splashDone');
  });

  await test(': ', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    const launchIdx = mainJs.indexOf('async function runLaunch(');
    const body = mainJs.slice(launchIdx, launchIdx + 2600);
    const hideIdx = body.indexOf('mainWindow.hide()');
    const openIdx = body.indexOf('openAppWindow(pkg');
    assert(hideIdx > 0 && openIdx > 0, 'runLaunch');
    assert(hideIdx < openIdx, 'mainWindow.hide() openAppWindow ( )');
  });

  await test(':  , ', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    const apkJs = fs.readFileSync(path.join(root, 'src', 'core', 'apk.js'), 'utf8');
    const storeJs = fs.readFileSync(path.join(root, 'src', 'core', 'store.js'), 'utf8');
    const installerJs = fs.readFileSync(path.join(root, 'src', 'core', 'installer.js'), 'utf8');

    assert(/function wantLandscapeFor\(pkg\)/.test(mainJs), '" "');
    assert(/orientationMode/.test(mainJs), 'assertion failed');
    assert(/orientationOverride/.test(mainJs), 'assertion failed');
    // ,  displaySettings().landscape
    assert(/const wantLand = wantLandscapeFor\(pkg\)/.test(mainJs), 'beforeStart');
    assert(/const land = wantLandscapeFor\(pkg\)/.test(mainJs), 'openAppWindow');
    // APK
    assert(/function detectOrientation\(/.test(apkJs), 'APK');
    assert(/orientation,/.test(apkJs), 'parseApk orientation');
    assert(/orientation: meta\.orientation/.test(installerJs), 'apps.json');
    assert(/orientationMode: 'auto'/.test(storeJs), 'assertion failed');
    // : 
    assert(/orientation backfill/.test(mainJs), 'assertion failed');
  });

  await test(': ', () => {
    const root = path.join(__dirname, '..');
    const installerJs = fs.readFileSync(path.join(root, 'src', 'core', 'installer.js'), 'utf8');
    // beforeStart  rt,  const rt, 
    // "Assignment to constant variable.", . 
    assert(/let rt = await this\.runtime\.ensure\(\{ onLog \}\)/.test(installerJs), 'rt let,  client');
    assert(/if \(replaced && replaced\.client\) rt = replaced;/.test(installerJs), 'rt');
  });

  await test(': ', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    const appwin = fs.readFileSync(path.join(root, 'src', 'core', 'appwin.js'), 'utf8');
    // (); 
    // 40 , , . 
    assert(/showWhileWaiting: detached && !splashVisible/.test(mainJs), ',  showWhileWaiting');
    assert(/splashVisible = !!\(splashWin && !splashWin\.isDestroyed\(\)\)/.test(mainJs), 'splash " "');
    assert(/const willRestart = land !== !!displaySettings\(\)\.landscape/.test(mainJs), '" "');
    assert(/if \(this\.detachedMode && !this\._showWhileWaiting\) return;/.test(appwin), 'ready-to-show showWhileWaiting');
    assert(/<[\s\S]{0,40}|Switching orientation for [\s\S]{0,40} to/.test(mainJs), 'assertion failed');
    // , pre-attach  -- , 
    // 40 (). 
    assert(/appWin\.showWaiting\(/.test(mainJs), 'assertion failed');
    assert(/waitingForRestart/.test(appwin), '" "');
    // pre-attach ,  hide
    assert(/if \(appWin\.waitingForRestart\)/.test(mainJs), 'pre-attach');
  });

  await test('show , ', () => {
    const root = path.join(__dirname, '..');
    const appwin = fs.readFileSync(path.join(root, 'src', 'core', 'appwin.js'), 'utf8');
    const start = appwin.indexOf('async openDetached(');
    const body = appwin.slice(start, start + 2000);
    const titleIdx = body.indexOf('this.agent.setTitle(');
    const showIdx = body.indexOf('this.agent.show()');
    assert(titleIdx > 0 && showIdx > 0, 'openDetached');
    assert(titleIdx < showIdx, 'setTitle show ( )');
  });

  await test('unit test verification', () => {
    const root = path.join(__dirname, '..');
    const emuJs = fs.readFileSync(path.join(root, 'src', 'core', 'emulator.js'), 'utf8');
    // Wi-Fi  sys.boot_completed  5~20 , ""
    // ; ""(). 
    assert(/checkNetwork\('', \{ waitMs: \d+, interval: \d+ \}\)/.test(emuJs), ', ');
    const idx = emuJs.indexOf('Runtime ready') !== -1 ? emuJs.indexOf('Runtime ready') : emuJs.indexOf('');
    const boot = emuJs.slice(idx);
    const warn = boot.slice(0, 4000);
    // : ""
    const warnCode = warn.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert(!/Reset Android Data/i.test(warnCode), '" "( )');
    assert(/no internet connection/i.test(warnCode), ', ');
  });

  await test('unit test verification', () => {
    const root = path.join(__dirname, '..');
    const ps1 = fs.readFileSync(path.join(root, 'src', 'core', 'win', 'agent.ps1'), 'utf8');
    // emulator  qemu  Windows (Win11  Windows Terminal), 
    // 200~300ms;  250ms . 
    assert(/_consoleSweep/.test(ps1), 'assertion failed');
    assert(/now - _consoleSweep > \(_perfMode \? 200 : 100\)/.test(ps1), '15 100ms');
    assert(/now - _bootHideStart < 15000/.test(ps1), ',  CPU');
    // " + ",  pid
    assert(/static void HideConsoleWindows\(\)/.test(ps1) && /IsOurConsole\(h\)/.test(ps1), 'IsOurConsole(conhost pid emulator )');
  });

  await test('" "', () => {
    const root = path.join(__dirname, '..');
    const emuJs = fs.readFileSync(path.join(root, 'src', 'core', 'emulator.js'), 'utf8');
    // emulator.exe , spawn  qemu ,  this.proc
    // (killed  false).  = : 
    // restartForOrientation  ensure() → start()  reused, 
    // serial  adb → `device not found`, . 
    const reuse = emuJs.slice(emuJs.indexOf('async start('), emuJs.indexOf('async start(') + 900);
    assert(/_consoleAlive\(\)/.test(reuse), 'start()');
    assert(/this\.proc = null;/.test(reuse), 'proc , ');
    // stop() ,  running()  true
    const stopFn = emuJs.slice(emuJs.indexOf('async stop('), emuJs.indexOf('async stop(') + 1800);
    assert(/killAttempt\(\)[\s\S]{0,200}this\.proc = null;/.test(stopFn), 'stop() this.proc');
    // engine :  adb  device, 
    // isOnline() ,  device not found. 
    const engineJs = fs.readFileSync(path.join(root, 'src', 'core', 'engine.js'), 'utf8');
    const inner = engineJs.slice(engineJs.indexOf('async _ensureInner('), engineJs.indexOf('async _ensureInner(') + 2200);
    assert(/getprop sys\.boot_completed/.test(inner), 'ensure');
    assert(/probe !== null/.test(inner), 'assertion failed');
    // adb , 
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    const rot = mainJs.slice(mainJs.indexOf('async function restartForOrientation'), mainJs.indexOf('async function restartForOrientation') + 2600);
    assert(/c\.isOnline\(\)\.catch\(\(\) => false\)/.test(rot), 'stop adb');
  });

  await test('Windows Terminal', () => {
    const root = path.join(__dirname, '..');
    const ps1 = fs.readFileSync(path.join(root, 'src', 'core', 'win', 'agent.ps1'), 'utf8');
    // Win11  Windows Terminal , qemu
    // WindowsTerminal.exe: pid//, ""
    assert(/static void SnapshotConsoles\(\)/.test(ps1), 'assertion failed');
    assert(/_consolesBeforeBoot/.test(ps1), 'assertion failed');
    assert(/now - _bootHideStart < 20000[\s\S]{0,120}_consolesBeforeBoot\.Contains/.test(ps1), '" 20 "');
    assert(/tl\.IndexOf\("terminal", StringComparison\.Ordinal\) >= 0/.test(ps1), 'terminal ( )');
    assert(/SnapshotConsoles\(\);/.test(ps1), 'boothide');
  });

  await test(':  /', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    // 80 ( + ). 
    // : openAppWindow , , 
    // ,  `cmd: Can't find service: activity`. 
    assert(/let launchInFlight = null;/.test(mainJs), 'assertion failed');
    assert(/if \(launchInFlight\.pkg === pkg\)[\s\S]{0,120}return launchInFlight\.promise;/.test(mainJs), 'assertion failed');
    assert(/launch queued \$\{pkg\}/.test(mainJs), 'assertion failed');
    assert(/async function launchOne\(pkg\)/.test(mainJs), 'launchOne');
    assert(/launchInFlight = entry;/.test(mainJs), 'finally , ');
  });

  await test(':  WHPX,  AEHD', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    const appJs = fs.readFileSync(path.join(root, 'src', 'ui', 'app.js'), 'utf8');
    const preloadJs = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');

    // 1)  WHPX  HypervisorPlatform( WSL2 ), 
    // ; . 
    assert(/for \(const f of \['HypervisorPlatform', 'VirtualMachinePlatform'\]\)/.test(mainJs), 'HypervisorPlatform(WHPX )');
    // 2)  WinHvPlatform.dll :  Windows , 
    // . 
    const handler = mainJs.slice(mainJs.indexOf("ipcMain.handle('provision:enableVirtualization'"));
    const handlerBody = handler.slice(0, 4000);
    assert(!/if \(hv\.dll\) \{/.test(handlerBody), 'WinHvPlatform.dll');
    // 3) (MSIX): "",  UAC
    assert(/if \(store\.STORE_BUILD\) \{[\s\S]{0,900}manual: true/.test(handlerBody), 'manual UI');
    assert(/Store edition cannot elevate permissions/.test(mainJs), 'assertion failed');
    assert(/Windows Hypervisor Platform/.test(mainJs), '"Windows "');
    // 4) , 
    assert(/const whpx = await enableWhpxFeatures\(\);\s*\n\s*runtime\.provisioner\.invalidateEnvCache/.test(mainJs), 'invalidateEnvCache');
    // 5) ""(1223 = ERROR_CANCELLED)
    assert(/1223/.test(mainJs) && /cancelled/.test(mainJs), 'UAC');
    // 6) "Windows ",  ms-settings
    assert(/optionalfeatures\.exe/.test(mainJs), 'classic optionalfeatures.exe');
    // 7) UI  manual / cancelled, 
    assert(/r\.manual/.test(appJs) && /api\.openWindowsFeatures/.test(appJs), 'UI manual');
    assert(/openWindowsFeatures: \(\) => invoke\('provision:openWindowsFeatures'\)/.test(preloadJs), 'preload openWindowsFeatures');
    // 8) ()
    assert(/let accelWarned = false;/.test(mainJs) && /Running in software simulation mode/.test(mainJs), 'assertion failed');
  });

  await test('exe / ,  Electron', () => {
    const root = path.join(__dirname, '..');
    const packJs = fs.readFileSync(path.join(root, 'build', 'pack.js'), 'utf8');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    const pkg = require(path.join(root, 'package.json'));

    // exe  Electron: FileDescription=Electron, 
    // ProductName=Electron, CompanyName=GitHub, Inc.,  33.4.11, . 
    assert(/function embedExeMeta\(exe\)/.test(packJs), 'exe');
    assert(/--set-icon/.test(packJs), 'assertion failed');
    assert(/--set-file-version/.test(packJs), 'assertion failed');
    assert(/--set-version-string', 'FileDescription'/.test(packJs), 'FileDescription');
    assert(/--set-version-string', 'ProductName', 'ApkBolt'/.test(packJs), 'ProductName ApkStart');
    assert(/embedExeMeta\(exePath\)/.test(packJs), 'assertion failed');
    // rcedit , "Electron "
    assert(/ rcedit\.exe/.test(packJs), 'rcedit');

    // :  AppUserModelID, / "Electron"
    assert(/setAumid\(APP_AUMID\);/.test(mainJs), 'AppUserModelID');

    // ()
    assert(/--full/.test(packJs) && /(ApkStart|ApkBolt)-v\$\{PKG\.version\}-win64-full/.test(packJs), '--full');
    assert(/build', 'runtime'/.test(packJs), 'build/runtime');
  });

  await test(': package.json / MSIX /', () => {
    const root = path.join(__dirname, '..');
    const pkg = require(path.join(root, 'package.json'));
    const { msixVersion } = require(path.join(root, 'build', 'msix.js'));
    const four = msixVersion(pkg.version);
    assert(/^\d+\.\d+\.\d+\.0$/.test(four), `MSIX : ${four}`);
    const artifact = `ApkStart_${four}_x64.msix`;
    for (const f of ['docs/store-listing.md', 'docs/store-msix.md', 'docs/store-upload-walkthrough.md']) {
      const t = fs.readFileSync(path.join(root, f), 'utf8');
      assert(t.includes(artifact), `${f}  ${artifact}`);
    }
    // exe (),  package.json
    const packJs = fs.readFileSync(path.join(root, 'build', 'pack.js'), 'utf8');
    assert(/\$\{PKG\.version\}\.0/.test(packJs), 'exe package.json');
    // exe , 
    const msixJs = fs.readFileSync(path.join(root, 'build', 'msix.js'), 'utf8');
    assert(/const VERSION = String\(pkg\.version/.test(msixJs), 'MSIX package.json');
  });

  await test('+', () => {
    const root = path.join(__dirname, '..');
    const installerJs = fs.readFileSync(path.join(root, 'src', 'core', 'installer.js'), 'utf8');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    const shortcutJs = fs.readFileSync(path.join(root, 'src', 'core', 'shortcut.js'), 'utf8');

    // / =  APK  <>.ico,  ApkStart
    assert(/const ico = app\.icoPath && fs\.existsSync\(app\.icoPath\) \? app\.icoPath : undefined;/.test(installerJs), 'icoPath');
    assert(/iconIcoPath: ico/.test(installerJs), 'writeShortcut');
    assert(!/iconIcoPath:\s*(APPICON|appicon|brandIcon)/.test(installerJs), 'ApkStart');
    // AUMID verification
    assert(/appUserModelId: `AbhijeetKangane\.ApkBolt\.\$\{app\.package\}`/.test(installerJs), 'AUMID');
    // Windows AUMID matching
    assert(/const APP_AUMID = 'AbhijeetKangane\.ApkBolt';/.test(mainJs), 'AUMID');
    assert(/setAumid\(`\$\{APP_AUMID\}\.\$\{pkg\}`\)/.test(mainJs), 'AUMID');
    assert(/function showWindow\(\) \{\s*\n\s*\/\/[^\n]*\n\s*setAumid\(APP_AUMID\);/.test(mainJs), 'ApkStart AUMID');
    // writeShortcut  iconIndex  0(ico  0 ), 
    assert(/icon: opt\.iconIcoPath \|\| opt\.target/.test(shortcutJs), 'target');
    assert(/iconIndex: 0/.test(shortcutJs), 'iconIndex 0');
  });

  await test(':  ,  APK', () => {
    const root = path.join(__dirname, '..');
    const o = require('../src/core/orientation');

    
    assert(o.resolveLandscape({ mode: 'landscape', orientation: 'portrait', orientationOverride: 'portrait' }) === true, 'assertion failed');
    assert(o.resolveLandscape({ mode: 'portrait', orientation: 'landscape', orientationOverride: 'landscape' }) === false, 'assertion failed');
    // APK  --  APK  portrait, 
    assert(o.resolveLandscape({ mode: 'auto', orientation: 'portrait', orientationOverride: 'landscape' }) === true, 'per-app APK portrait');
    assert(o.resolveLandscape({ mode: 'auto', orientation: 'landscape', orientationOverride: 'portrait' }) === false, 'per-app APK landscape');
    // APK , 
    assert(o.resolveLandscape({ mode: 'auto', orientation: 'portrait' }) === false, 'APK');
    assert(o.resolveLandscape({ mode: 'auto', orientation: null, panelLandscape: true }) === true, 'assertion failed');
    // + (, )
    assert(o.flipLandscape(false) === true && o.flipLandscape(true) === false, 'flip');
    assert(o.parseOverride(o.overrideValue(true)) === true, 'assertion failed');
    assert(o.parseOverride(o.overrideValue(false)) === false, 'assertion failed');

    // , ()
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    assert(/wantLandscapeFor\(pkg\)\s*\)?\.?\s*/.test(mainJs) && /orientation\.resolveLandscape/.test(mainJs), 'wantLandscapeFor resolveLandscape');
    assert(/async function rotateCurrentApp\(\)/.test(mainJs), 'assertion failed');
    assert(/orientation\.flipLandscape\(current\)/.test(mainJs), 'flip');
    assert(/orientation\.overrideValue\(next\)/.test(mainJs), 'assertion failed');
    const shellJs = fs.readFileSync(path.join(root, 'src', 'ui', 'shell.js'), 'utf8');
    assert(/shell\.rotate\(\)/.test(shellJs), 'assertion failed');
  });

  await test(',  wm', () => {
    const root = path.join(__dirname, '..');
    const o = require('../src/core/orientation');
    // ( / )=
    assert(o.autoRotateSetting({}) === '1', 'assertion failed');
    assert(o.autoRotateSetting({ display: {} }) === '1', 'display');
    assert(o.autoRotateSetting({ display: { autoRotate: false } }) === '0', '0');
    // store  true
    const storeJs = fs.readFileSync(path.join(root, 'src', 'core', 'store.js'), 'utf8');
    assert(/autoRotate:\s*true/.test(storeJs), 'store autoRotate=true');
    // adb , ( lock 0 / ignore-request)
    const adbJs = fs.readFileSync(path.join(root, 'src', 'core', 'adb.js'), 'utf8');
    assert(/accelerometer_rotation \$\{guestAutoRotate\(\)\}/.test(adbJs), 'adb guestAutoRotate');
  });

  await test(':  ,  , ', () => {
    const root = path.join(__dirname, '..');
    const storeJs = fs.readFileSync(path.join(root, 'src', 'core', 'store.js'), 'utf8');
    // 0.6.0: (SetParent)/, , 
    // . 
    assert(/windowEmbed:\s*false/.test(storeJs), 'defaultSettings.display.windowEmbed false');
    // : "", 
    assert(/windowEmbedMigrated2/.test(storeJs), 'assertion failed');
    assert(/windowEmbedChosen !== true/.test(storeJs), 'assertion failed');
    // : "migrated2=true  true"( / ), 
    // → . "". 
    const migBody = storeJs.slice(storeJs.indexOf('Final verdict on window hosting mode'), storeJs.indexOf('Final verdict on window hosting mode') + 1200);
    assert(/d\.windowEmbedChosen !== true && d\.windowEmbed !== false/.test(migBody), 'Migration condition must not rely on windowEmbedMigrated2');
    // , 
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    assert(/pre-attach detached ok/.test(mainJs), 'assertion failed');
    // , ("")
    const attachBody = mainJs.slice(mainJs.indexOf('async function attachAppWindow'), mainJs.indexOf('async function attachAppWindow') + 2200);
    assert(/for \(let i = 0; i < 4; i \+= 1\)/.test(attachBody), 'assertion failed');
    assert(/falling back to embedded mode/i.test(attachBody), ', ');
    const appJs = fs.readFileSync(path.join(root, 'src', 'ui', 'app.js'), 'utf8');
    assert(/windowEmbedChosen:\s*true/.test(appJs), '" "');
    const indexHtml = fs.readFileSync(path.join(root, 'src', 'ui', 'index.html'), 'utf8');
    assert(/setWindowEmbed/.test(indexHtml), 'assertion failed');
    // , 
    const sel = indexHtml.slice(indexHtml.indexOf('id="setWindowEmbed"'), indexHtml.indexOf('id="setWindowEmbed"') + 400);
    assert(sel.indexOf('value="detached"') < sel.indexOf('value="embed"'), '( )');
  });

  await test(': ', () => {
    const root = path.join(__dirname, '..');
    const probeJs = fs.readFileSync(path.join(root, 'src', 'core', 'autodebug-probe.js'), 'utf8');
    // true , 
    assert(/windowEmbed:\s*!!\(settings\.display && settings\.display\.windowEmbed === true\)/.test(probeJs), '" true "');
  });

  await test(':  , ', () => {
    const root = path.join(__dirname, '..');
    const engineJs = fs.readFileSync(path.join(root, 'src', 'core', 'engine.js'), 'utf8');
    // waitForNetwork  8 ,  adb
    assert(/cached\.ok && Date\.now\(\) - cached\.at < 8000/.test(engineJs), 'waitForNetwork');
    // stop() , 
    const stopBody = engineJs.slice(engineJs.indexOf('async stop('), engineJs.indexOf('async stop(') + 400);
    assert(/this\._lastNetwork = null/.test(stopBody), 'stop');
  });

  await test('( @napi-rs/lzma ,  ,  )', () => {
    const root = path.join(__dirname, '..');
    const packJs = fs.readFileSync(path.join(root, 'build', 'pack.js'), 'utf8');
    const pkg = require(path.join(root, 'package.json'));

    // 0.5.9 : pack.js  src/,  node_modules, 
    // Cannot find module '@napi-rs/lzma', . 
    assert(pkg.dependencies && pkg.dependencies['@napi-rs/lzma'], '@napi-rs/lzma dependencies ( system.img.xz )');
    assert(/node_modules/.test(packJs) && /dependencies/.test(packJs), 'pack.js package.json dependencies');
    assert(/startsWith\('@'\)/.test(packJs), 'scope ( @napi-rs/*-win32-x64-msvc)');
    // :  node_modules
    const lzmaDir = path.join(root, 'node_modules', '@napi-rs', 'lzma');
    assert(fs.existsSync(lzmaDir), '@napi-rs/lzma');
  });

  await test('lzma ,  require stack', () => {
    const root = path.join(__dirname, '..');
    const provJs = fs.readFileSync(path.join(root, 'src', 'core', 'provision.js'), 'utf8');
    assert(/LZMA_MISSING/.test(provJs), 'lzma LZMA_MISSING');
    assert(/Incomplete.*package/i.test(provJs), 'Error message must state incomplete package clearly');
    // require.resolve: 
    assert(/try\s*\{[^}]*require\.resolve\('@napi-rs\/lzma'\)/.test(provJs), 'require.resolve try , ');
  });

  await test(':  (Taskbar)', () => {
    const root = path.join(__dirname, '..');
    const adbJs = fs.readFileSync(path.join(root, 'src', 'core', 'adb.js'), 'utf8');
    // (sw606dp) Launcher  Taskbar: , , 
    assert(/async disableLauncherTaskbar\(\)/.test(adbJs), 'disableLauncherTaskbar');
    assert(/settings put global enable_taskbar 0/.test(adbJs), 'global enable_taskbar');
    // Launcher , 
    assert(/am force-stop com\.google\.android\.apps\.nexuslauncher/.test(adbJs), 'Pixel Launcher');
    // (), "+"
    const pf = adbJs.slice(adbJs.indexOf('async prepareForeground('), adbJs.indexOf('async prepareForeground(') + 1600);
    assert(/enable_taskbar 0/.test(pf), 'prepareForeground');
    const reset = adbJs.slice(adbJs.indexOf('async resetDisplayOverrides('), adbJs.indexOf('async resetDisplayOverrides(') + 1600);
    assert(/disableLauncherTaskbar\(\)/.test(reset), 'resetDisplayOverrides disableLauncherTaskbar');
  });

  await test(': ', () => {
    const root = path.join(__dirname, '..');
    const adbJs = fs.readFileSync(path.join(root, 'src', 'core', 'adb.js'), 'utf8');
    assert(/async waitForAppFirstFrame\(pkg/.test(adbJs), 'waitForAppFirstFrame');
    // Android 12+  Activity  Splash,  +
    assert(/Splash Screen/.test(adbJs), 'Splash');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    // ,  + , 
    const idx = mainJs.indexOf('waitForAppFirstFrame');
    assert(idx > 0, 'main waitForAppFirstFrame');
    const after = mainJs.slice(idx, idx + 900);
    assert(/finishBootAnimation/.test(after), 'assertion failed');
    // `dumpsys window`: `dumpsys window windows`  mCurrentFocus, 
    // , . 
    assert(/dumpsys window \| grep -E "Splash Screen\|mCurrentFocus"/.test(adbJs), 'dumpsys window( mCurrentFocus)');
    // 15 , 12
    assert(/timeoutMs:\s*20000/.test(mainJs), '20');
  });

  await test(': boot splash , ', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    // : splash  + appWin  boot
    assert(/const finishBootAnimation = \(\) =>/.test(mainJs), 'assertion failed');
    const fn = mainJs.slice(mainJs.indexOf('const finishBootAnimation'),
      mainJs.indexOf('const finishBootAnimation') + 700);
    assert(/bootAnimDone/.test(fn), ', ');
    assert(/setState\(\{ ready: true/.test(fn), 'boot');
    assert(/splashDone/.test(fn), 'splash');
    // launch  setState ready( Splash )
    assert(/if \(!attachDoneEarly\) finishBootAnimation\(\)/.test(mainJs), 'launch');
    // : , 
    assert(/setTimeout\(finishBootAnimation, 24000\)/.test(mainJs), '24');
  });

  await test(':  PNG + , ', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    // PNG(iconPath),  ICO(Chromium <img> )
    assert(/setIcon\(rec && \(rec\.iconPath \|\| rec\.icoPath\)\)/.test(mainJs), 'PNG');
    const shellHtml = fs.readFileSync(path.join(root, 'src', 'ui', 'shell.html'), 'utf8');
    const shellCss = fs.readFileSync(path.join(root, 'src', 'ui', 'shell.css'), 'utf8');
    const shellJs = fs.readFileSync(path.join(root, 'src', 'ui', 'shell.js'), 'utf8');
    assert(/object-fit:\s*contain/.test(shellCss), 'contain , ');
    assert(/class="boot-aura"/.test(shellHtml) && /class="boot-glow"/.test(shellHtml), 'boot ( )');
    assert(/@keyframes bootBreathe/.test(shellCss), 'assertion failed');
    assert(/prefers-reduced-motion/.test(shellCss), 'assertion failed');
    assert(/FALLBACK/.test(shellJs) && /logo-128/.test(shellJs), 'assertion failed');
  });

  await test(':  ( 20s+)', () => {
    const root = path.join(__dirname, '..');
    const adbJs = fs.readFileSync(path.join(root, 'src', 'core', 'adb.js'), 'utf8');
    const fn = adbJs.slice(adbJs.indexOf('async grantRuntimePermissions('), adbJs.indexOf('async grantRuntimePermissions(') + 2600);
    // ,  dumpsys package
    assert(/rec\.permGranted === true/.test(fn), 'assertion failed');
    assert(/store\.upsertApp\(\{ package: pkg, permGranted: true \}\)/.test(fn), 'assertion failed');
    const clear = adbJs.slice(adbJs.indexOf('async clearData('), adbJs.indexOf('async clearData(') + 400);
    assert(/permGranted: false/.test(clear), 'pm clear');
    const inst = fs.readFileSync(path.join(root, 'src', 'core', 'installer.js'), 'utf8');
    assert(/permGranted: false/.test(inst), 'assertion failed');
  });

  await test(': AMD host Vulkan', () => {
    const root = path.join(__dirname, '..');
    const emuJs = fs.readFileSync(path.join(root, 'src', 'core', 'emulator.js'), 'utf8');
    assert(/-feature', '-Vulkan/.test(emuJs), 'host Vulkan');
    assert(/badGpuVulkanTried/.test(emuJs), 'emulator host');
    // host + AMD + Windows , 
    assert(/gpu === 'host' && process\.platform === 'win32' && doctor\.detectGpuVendor\(\) === 'amd'/.test(emuJs), 'host + AMD Vulkan');
  });

  await test(': ', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    assert(/looksForeignBundle/.test(mainJs), '" resources/runtime"');
    assert(/resources\[\\\\\/\]runtime\$/.test(mainJs), 'resources/runtime');
  });

  await test(': ', () => {
    const root = path.join(__dirname, '..');
    const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    // "", ; 
    // dispose(),  device not found -- . 
    assert(/owner\.pid/.test(mainJs), 'assertion failed');
    assert(/const releaseRuntime = /.test(mainJs), '" "');
    const fn = mainJs.slice(mainJs.indexOf('const releaseRuntime'), mainJs.indexOf('const releaseRuntime') + 800);
    assert(/owner === process\.pid/.test(fn), 'pid');
    const hits = (mainJs.match(/runtime\?\.dispose\(\)/g) || []).length;
    assert(hits === 1, ` releaseRuntime ,  ${hits} `);
  });

  await test(': ', () => {
    const root = path.join(__dirname, '..');
    const agentJs = fs.readFileSync(path.join(root, 'src', 'core', 'agent.js'), 'utf8');
    // exe , Windows  junction ; 
    // emu:0 →  → . 
    assert(/realpathSync\.native/.test(agentJs), 'scope');
    const scope = agentJs.slice(agentJs.indexOf('async scope('), agentJs.indexOf('async scope(') + 1200);
    assert(/list\.push\(d\)/.test(scope), ', ');
  });

  await test('ARM-only :  , ', () => {
    const root = path.join(__dirname, '..');
    const inst = fs.readFileSync(path.join(root, 'src', 'core', 'installer.js'), 'utf8');
    // !playImageInfo().ok : , 
    // , "", " + ". 
    const retry = inst.slice(inst.indexOf('if (e.code === \'NO_MATCHING_ABIS\')'), inst.indexOf('if (e.code === \'NO_MATCHING_ABIS\')') + 260);
    assert(!/NO_MATCHING_ABIS.*playImageInfo/.test(retry), 'ABI playImageInfo');
    assert(/abiRetried = true/.test(inst), ', ');
    const sw = inst.slice(inst.indexOf('async switchToCompat'), inst.indexOf('async install('));
    assert(/invalidateSnapshot\(\)/.test(sw), ', ');
    assert(/runningHasArm/.test(inst) && /ro\.product\.cpu\.abilist/.test(inst), 'ARM');
    const ui = fs.readFileSync(path.join(root, 'src', 'ui', 'app.js'), 'utf8');
    const f = ui.slice(ui.indexOf('function friendlyInstallErrorText'), ui.indexOf('function friendlyInstallErrorText') + 900);
    assert(!/NO_MATCHING_ABIS/i.test(f) || /switching to|active but/i.test(f.slice(f.indexOf('NO_MATCHING_ABIS'), f.indexOf('NO_MATCHING_ABIS') + 320)), 'Failure banner must clarify active status');
  });

  console.log(results.join('\n'));
  console.log(`\n: ${passed} , ${failed} \n`);

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(failed ? 1 : 0);
})();
