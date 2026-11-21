'use strict';
/**
 * Pure Node unit tests (no Electron / adb / network dependency)
 * Run: npm test
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

console.log('\n[zip.js]');
const { ZipArchive } = require('../src/core/zip');
test('package.json', () => {
  // zip（stored ）
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8); // stored
  const name = Buffer.from('hello.txt');
  const data = Buffer.from('hello apkstart');
  header.writeUInt16LE(name.length, 26);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 14);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(0, 8);
  cen.writeUInt16LE(name.length, 28);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt32LE(data.length, 20);
  cen.writeUInt32LE(0, 42); // local offset

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + name.length, 12); 
  eocd.writeUInt32LE(30 + name.length + data.length, 16); 

  const zip = new ZipArchive(Buffer.concat([header, name, data, cen, name, eocd]));
  assert(zip.has('hello.txt'), 'hello.txt');
  assert(zip.read('hello.txt').toString() === 'hello apkstart', 'assertion failed');
});

console.log('\n[png.js]');
const { encodePng, drawAppIcon } = require('../src/core/png');
test('PNG IHDR', () => {
  const rgba = new Uint8Array(16 * 16 * 4).fill(128);
  const png = encodePng(16, 16, rgba);
  assert(png[0] === 0x89 && png[1] === 0x50, 'PNG');
  assert(png.toString('ascii', 12, 16) === 'IHDR', 'IHDR chunk');
  assert(png.length > 50, 'assertion failed');
});
test('unit test verification', () => {
  for (const s of [16, 32, 64, 256]) {
    const png = drawAppIcon(s);
    const w = png.readUInt32BE(16);
    assert(w === s, ` ${s}， ${w}`);
  }
});

console.log('\n[axml.js + arsc.js + apk.js]');
const { parseAxml } = require('../src/core/axml');
const { ResTable } = require('../src/core/arsc');
const { parseApk, quickCheck } = require('../src/core/apk');

// ： APKSTART_TEST_APK ，
// APK （，）
function findFixture() {
  const candidates = [
    process.env.APKSTART_TEST_APK,
    path.join(__dirname, 'fixtures', 'sample.apk'),
  ];
  try {
    const dl = path.join(process.env.USERPROFILE || '', 'Documents');
    for (const f of fs.readdirSync(dl)) {
      if (/\.apk$/i.test(f)) candidates.push(path.join(dl, f));
    }
  } catch (_) { /* ignore */ }
  return candidates.find((c) => c && fs.existsSync(c));
}

const fixture = findFixture();
if (fixture) {
  console.log(`  （：${fixture}）`);
  test('quickCheck PK', () => {
    assert(quickCheck(fixture) === true);
  });
  const meta = parseApk(fixture);
  test('/ / Activity', () => {
    assert(/^[\w.]+$/.test(meta.package), `: ${meta.package}`);
    assert(meta.versionName, 'versionName');
    assert(meta.launchActivity && /\./.test(meta.launchActivity),
      ` Activity : ${meta.launchActivity}`);
  });
  test('unit test verification', () => {
    assert(meta.iconPng && meta.iconPng.length > 100, 'assertion failed');
    assert(meta.label, 'assertion failed');
    console.log(`    ↳ ${meta.label} (${meta.package}) v${meta.versionName}`);
  });
  test('AXML manifest', () => {
    const zip = new ZipArchive(fs.readFileSync(fixture));
    const root = parseAxml(zip.read('AndroidManifest.xml'));
    assert(root.name === 'manifest');
  });
  test('resources.arsc', () => {
    const zip = new ZipArchive(fs.readFileSync(fixture));
    if (zip.has('resources.arsc')) {
      const res = new ResTable(zip.read('resources.arsc'));
      assert(res.packages.length > 0, 'package');
    }
  });
} else {
  console.log('  （： APK ， APKSTART_TEST_APK）');
}

// APK  test/lib/make-apk.js：，
// run-tests / auto-test （）。
const { buildApkBytes } = require('./lib/make-apk');

console.log('\n[ APK：axml + apk ]');
{
  const { attrValue, ANDROID_NS } = require('../src/core/axml');
  test('attrValue ： null = ， android', () => {
    const node = {
      attrs: [
        { ns: '', name: 'package', typed: 'com.a.b' },
        { ns: ANDROID_NS, name: 'label', typed: '' },
      ],
    };
    // （ package） null ； parseApk
    assert(attrValue(node, 'package', null) === 'com.a.b', 'package ns=null');
    assert(attrValue(node, 'package') === null, 'android');
    assert(attrValue(node, 'label') === '', 'android');
    assert(attrValue(node, 'label', null) === '', 'ns=null android');
  });
}
{
  const tmp = path.join(os.tmpdir(), `apkstart-synth-${Date.now()}.apk`);
  fs.writeFileSync(tmp, buildApkBytes());
  try {
    const meta = parseApk(tmp);
    test('：manifest package', () => {
      assert(meta.package === 'com.example.test', ` ${meta.package}`);
    });
    test('/ / SDK', () => {
      assert(meta.label === 'TestApp', `label=${meta.label}`);
      assert(meta.versionName === '1.2.3', `versionName=${meta.versionName}`);
      assert(meta.versionCode === 7, `versionCode=${meta.versionCode}`);
      assert(meta.minSdk === 21 && meta.targetSdk === 34, `sdk=${meta.minSdk}/${meta.targetSdk}`);
    });
    test('Activity intent-filter', () => {
      assert(meta.launchActivity === 'com.example.test.Main', `activity=${meta.launchActivity}`);
    });
    test('ABI', () => {
      assert(JSON.stringify(meta.abis) === '["arm64-v8a"]', JSON.stringify(meta.abis));
      assert(meta.iconFile === 'res/mipmap-hdpi/ic_launcher.png', `icon=${meta.iconFile}`);
      assert(meta.iconPng && meta.iconPng[0] === 0x89 && meta.iconPng[1] === 0x50, 'PNG');
      assert(meta.sizeBytes === fs.statSync(tmp).size, 'assertion failed');
    });
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* ignore */ }
  }
}

{
  const { detectOrientation } = require('../src/core/apk');
  const { ANDROID_NS } = require('../src/core/axml');
  const act = (name, ori) => ({
    name: 'activity',
    attrs: [
      { ns: ANDROID_NS, name: 'name', typed: name },
      ...(ori == null ? [] : [{ ns: ANDROID_NS, name: 'screenOrientation', typed: ori }]),
    ],
  });
  test('： Activity', () => {
    // 「 portrait +  sensor 」→ portrait
    const hongguo = [
      act('SplashActivity', 3), act('MainActivity', 1), act('ReaderActivity', 3),
      act('WebActivity', 1), act('DetailActivity', 1),
    ];
    assert(detectOrientation(hongguo, hongguo[0]) === 'portrait', 'portrait');
    // Activity  landscape
    const modu = [act('MainActivity', 2)];
    assert(detectOrientation(modu, modu[0]) === 'landscape', 'landscape');
    // sensor /  unspecified → ，
    const sensorOnly = [act('A', 3), act('B', 11), act('C', 0), act('D', 14)];
    assert(detectOrientation(sensorOnly, sensorOnly[0]) === null, 'null');
    assert(detectOrientation([act('A', null)], null) === null, 'null');
    // Activity ：
    const launcherWins = [act('Launcher', 2), act('P1', 1), act('P2', 1), act('P3', 1)];
    assert(detectOrientation(launcherWins, launcherWins[0]) === 'landscape', 'Activity');
    // reversePortrait / userLandscape
    assert(detectOrientation([act('A', 7)], null) === 'portrait', 'reversePortrait');
    assert(detectOrientation([act('A', 12)], null) === 'landscape', 'userLandscape');
  });
}

console.log(`\n：${passed} ，${failed} \n`);
process.exit(failed ? 1 : 0);
