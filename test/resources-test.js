'use strict';
/**
 * ( / CPU / ) Node :  Electron, . 
 * "":  32GB , 128GB , 
 * ,  / , 
 * . 
 * : node test/resources-test.js
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {
  hostProfile, memoryLimits, clampMemoryMB, clampCores, memVerdict,
  diskRequiredMB, diskVerdict, diskLimits, clampDataGB, storageVerdict,
} = require('../src/core/resources');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

const GB = 1024 * 1024 * 1024;

(() => {
  console.log('\n[  -  ]');

  test('hostProfile ( )', () => {
    const h = hostProfile({ totalMB: 32768, cores: 16 });
    assert.equal(h.totalMB, 32768);
    assert.equal(h.cores, 16);
  });

  test('hostProfile 0 / NaN', () => {
    const h = hostProfile({});
    assert.ok(h.cores >= 1);
    assert.ok(Number.isFinite(h.totalMB));
  });

  test('25%', () => {
    const lim = memoryLimits(32768);
    assert.equal(lim.maxMB, 24576, `32GB  24GB,  ${lim.maxMB}`);
    assert.equal(lim.stepMB, 512);
    assert.equal(lim.minMB, 1024);
  });

  test('unit test verification', () => {
    const lim = memoryLimits(0);
    assert.ok(lim.maxMB >= 4096 && lim.maxMB <= 16384);
  });

  console.log('\n[  -  ]');

  test('0 ,  0', () => {
    const r = clampMemoryMB(0, 32768);
    assert.equal(r.mb, 0);
    assert.equal(r.reason, 'auto');
  });

  test('3GB 512MB 3072', () => {
    const r = clampMemoryMB(3000, 32768);
    assert.equal(r.mb, 3072);
    assert.equal(r.capped, true);
  });

  test('64GB', () => {
    const r = clampMemoryMB(64 * 1024, 32768);
    assert.equal(r.mb, 24576);
    assert.equal(r.capped, true);
    assert.ok(/ 24 GB|maximum allocation is 24 GB/i.test(r.reason), r.reason);
  });

  test('128MB', () => {
    const r = clampMemoryMB(128, 32768);
    assert.equal(r.mb, 1024);
    assert.equal(r.capped, true);
  });

  test('(4GB) 4GB', () => {
    const r = clampMemoryMB(4096, 4096);
    assert.equal(r.mb, 3072);
  });

  console.log('\n[  -  CPU ]');

  test('16 15', () => {
    assert.equal(clampCores(16, 16).cores, 15);
  });

  test('1', () => {
    assert.equal(clampCores(8, 1).cores, 1);
  });

  test('0 =', () => {
    assert.equal(clampCores(0, 8).cores, 0);
  });

  console.log('\n[  -  ]');

  test('Windows', () => {
    const v = memVerdict(28672, 32768);
    assert.equal(v.level, 'insufficient');
    assert.ok(/paging/i.test(v.note), v.note);
  });

  test('unit test verification', () => {
    assert.equal(memVerdict(8192, 32768).level, 'ok');
    assert.equal(memVerdict(8192, 32768).note, '');
  });

  test('768MB', () => {
    assert.equal(memVerdict(512, 32768).level, 'insufficient');
  });

  console.log('\n[  -  ]');

  test('50GB 1.8 + 2GB', () => {
    const need = diskRequiredMB(50 * GB);
    assert.equal(need, Math.ceil(50 * 1024 * 1.8) + 2048);
  });

  test('80%', () => {
    assert.equal(diskLimits(100 * 1024).maxGB, 80);
  });

  test('20GB 64GB', () => {
    const r = clampDataGB(64, 20 * 1024);
    assert.equal(r.gb, 16);
    assert.equal(r.capped, true);
    assert.ok(/ 20\.0 GB|only 20\.0 GB/i.test(r.reason), r.reason);
  });

  test('64GB', () => {
    const r = clampDataGB(64, 200 * 1024);
    assert.equal(r.gb, 64);
    assert.equal(r.capped, false);
  });

  test('storageVerdict', () => {
    const v = storageVerdict(30 * 1024, 50 * GB);
    assert.equal(v.ok, false);
    assert.ok(v.shortMB > 0);
    assert.ok(/short by/i.test(v.note), v.note);
  });

  test('unit test verification', () => {
    assert.equal(storageVerdict(0, 50 * GB).ok, true);
  });

  console.log('\n[  -  ]');

  test('diskVerdict', () => {
    const v = diskVerdict(200 * 1024, 100 * 1024);
    assert.equal(v.ok, true);
    assert.equal(v.message, '');
  });

  test('diskVerdict ( )', () => {
    const v = diskVerdict(10 * 1024, 60 * 1024);
    assert.equal(v.ok, false);
    assert.ok(/Insufficient disk space/i.test(v.message), v.message);
    assert.ok(/ApkStart |ApkBolt runtime/i.test(v.message), v.message);
  });

  test('diskVerdict', () => {
    assert.equal(diskVerdict(0, 60 * 1024).ok, true);
  });

  test('50GB 1.8 + 2GB', () => {
    const need = diskRequiredMB(50 * GB);
    assert.ok(need > 85 * 1024 && need < 95 * 1024, ` ${need} MB`);
  });

  console.log('\n[  -  ]');

  const builtinSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'backends', 'builtin.js'), 'utf8');
  test('resources()', () => {
    assert(/resources\(\) \{/.test(builtinSrc), 'builtin resources()');
  });

  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  test('unit test verification', () => {
    assert(/sanitizeResourcePatch/.test(mainSrc), 'assertion failed');
    assert(/engine:resources/.test(mainSrc), 'engine:resources IPC');
    assert(/runtime:resetAndResize/.test(mainSrc), '+');
    assert(!/mumuMemoryGB|mumuCores/.test(mainSrc), 'assertion failed');
  });

  const emulatorSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'emulator.js'), 'utf8');
  test('quickboot , ', () => {
    assert(/_hasDataOverlay/.test(emulatorSrc), 'qcow2');
    assert(/needsReset: true/.test(emulatorSrc), 'needsReset');
    assert(/fsGB/.test(emulatorSrc), 'dataInfo');
  });

  const doctorSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'doctor.js'), 'utf8');
  test('/ ,  8GB/8', () => {
    assert(/memoryLimits\(host\.totalMB\)/.test(doctorSrc), 'doctor');
    assert(!/1536, 8192/.test(doctorSrc), 'doctor 8192');
  });

  console.log(`\n: ${passed} , ${failed} \n`);
  process.exit(failed ? 1 : 0);
})();
