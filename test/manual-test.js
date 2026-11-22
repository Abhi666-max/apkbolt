'use strict';
/**
 * Built-in manual mapping tests
 * : 
 *  1)  src/ui/manual.html; 
 *  2)  /  / . 
 */
const fs = require('fs');
const path = require('path');

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

const ROOT = path.join(__dirname, '..');
const manual = require(path.join(ROOT, 'src/core/manual'));
const html = fs.readFileSync(path.join(ROOT, 'src/ui/manual.html'), 'utf8');

console.log('\n[  -  ]');
test('Every topic anchor exists in manual.html', () => {
  for (const topic of Object.values(manual.TOPICS)) {
    assert(html.includes(`id="${topic.anchor}"`), `${topic.id}  ${topic.anchor} `);
  }
});

test('Manual body contains v0.6.3 and sound topic', () => {
  assert(html.includes('v0.6.3'), 'v0.6.3');
  assert(html.includes('') || html.includes('No Sound') || html.includes('audio'), 'assertion failed');
  assert(html.includes('') || html.includes('Built-in User Guide') || html.includes('Guide') || html.includes('Manual'), 'assertion failed');
});

test('Manual contains section 6.8 for DLL load failures', () => {
  assert(html.includes('0xC0000135'), '6.8');
});

console.log('\n[  -   → ]');
test('Hardware acceleration issues route to 6.1', () => {
  const t = manual.topicForIssue({ code: 'accel.softwareEmulation', title: '' });
  assert(t.id === 'accel', ` accel,  ${t.id}`);
});

test('adb unauthorized issues route to 6.4', () => {
  const t = manual.topicForIssue({ code: 'device.unauthorized', title: '' });
  assert(t.id === 'adb', ` adb,  ${t.id}`);
});

test('Sound issues route to 6.7', () => {
  assert(manual.topicForIssue({ code: 'audio.disabled' }).id === 'sound', '6.7');
  assert(manual.topicForIssue({ code: 'audio.windowsServiceStopped' }).id === 'sound', '6.7');
});

test('DLL / VC++ issues route to 6.8', () => {
  assert(manual.topicForIssue({ code: 'DLL', title: ' DLL ' }).id === 'dll', 'DLL 6.8');
  assert(manual.topicForIssue({ code: 'vcRedist', title: ' VC++ ' }).id === 'dll', 'VC++ 6.8');
  const t = manual.topicForIssue({ code: 'runtime.bootFailed', title: '', detail: '0xC0000135 emulator exit' });
  assert(t.id === 'dll', ` 0xC0000135  6.8,  ${t.id}`);
});

test('Startup failure with ARM logs routes to 6.3', () => {
  const t = manual.topicForIssue({
    code: 'runtime.bootFailed',
    title: '',
    detail: 'DoBadTrampoline libndk_translation',
  });
  assert(t.id === 'arm', ` arm,  ${t.id}`);
});

test('Generic startup failure routes to 6.5', () => {
  const t = manual.topicForIssue({ code: 'runtime.bootFailed', title: '', detail: 'cannot lock AVD' });
  assert(t.id === 'startup', ` startup,  ${t.id}`);
});

console.log('\n[  -   → ]');
test('NO_MATCHING_ABIS routes to ARM section', () => {
  assert(manual.topicForError('INSTALL_FAILED_NO_MATCHING_ABIS').id === 'arm', 'ARM');
});

test('Other INSTALL_FAILED errors route to installation section', () => {
  assert(manual.topicForError('INSTALL_FAILED_INSUFFICIENT_STORAGE').id === 'install', 'assertion failed');
});

test('adb and sound errors route correctly', () => {
  assert(manual.topicForError('ADB_UNAUTHORIZED').id === 'adb', 'adb 6.4');
  assert(manual.topicForError('audio disabled -no-audio').id === 'sound', '6.7');
});

test('0xC0000135 6.8', () => {
  assert(manual.topicForError('emulator exit 3221225781').id === 'dll', '6.8');
  assert(manual.topicForError('0xC0000135 STATUS_DLL_NOT_FOUND').id === 'dll', '6.8');
});

console.log('\n[  -  ]');
test('resolve / issue / topic', () => {
  assert(manual.resolve('INSTALL_FAILED_NO_MATCHING_ABIS').id === 'arm', 'assertion failed');
  assert(manual.resolve({ issue: 'audio.disabled' }).id === 'sound', 'issue code');
  assert(manual.resolve({ topic: 'overview', reason: 'toolbar' }).anchor, 'topic');
});

test(', ', () => {
  const r = manual.resolve({});
  assert(r.id === 'overview' && r.anchor, 'assertion failed');
});

console.log('\n[  -  ]');
test('manual:open, preload openManual', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
  assert(/ipcMain\.handle\('manual:open'/.test(main), 'manual:open');
  assert(/openManual:\s*\(payload\)/.test(preload), 'preload openManual');
  assert(/new BrowserWindow\([\s\S]*manual\.html/.test(main), 'assertion failed');
});

test('/', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'app.js'), 'utf8');
  assert(/id="btnManual"/.test(html), 'assertion failed');
  assert(/id="btnOpenManual"/.test(html), 'assertion failed');
  assert(/\$\('btnManual'\)\?\.addEventListener/.test(js), 'assertion failed');
  assert(/\$\('btnOpenManual'\)\?\.addEventListener/.test(js), 'assertion failed');
});

test('unit test verification', () => {
  const js = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'app.js'), 'utf8');
  assert(/openManualForError\(raw, 'install-failed'\)/.test(js), 'assertion failed');
  assert(/function failFix\([\s\S]*openManualForIssue\(issue, 'fix-failed'\)/.test(js), 'assertion failed');
  assert(/case 'audioService'/.test(js) && /case 'audio':/.test(js), 'assertion failed');
});

test('unit test verification', () => {
  const js = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'app.js'), 'utf8');
  assert(/class="dbg-help"/.test(js), 'assertion failed');
  assert(/class="ec-help"/.test(js), 'assertion failed');
});

test('0xC0000135 DLL / VC++', () => {
  const doctor = fs.readFileSync(path.join(ROOT, 'src', 'core', 'doctor.js'), 'utf8');
  const emu = fs.readFileSync(path.join(ROOT, 'src', 'core', 'emulator.js'), 'utf8');
  assert(!/title: ' VC\+\+ '/.test(doctor), 'doctor /VC++');
  assert(!/ DLL(VC\+\+  \/ )/.test(emu), 'emulator');
  assert(/0xC0000135|Dependent DLL/i.test(emu), '0xC0000135');
});

console.log(`\n: ${passed} , ${failed} \n`);
process.exitCode = failed ? 1 : 0;
