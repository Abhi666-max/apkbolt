'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ClipboardSync } = require('../src/core/clipboard');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { failed++; console.error(`  ✗ ${name}\n    ${e.stack || e.message}`); });
}

(async () => {
  console.log('\n[clipboard.js Bidirectional Sync Tests]');

  await test('syncHostToGuest sends base64 encoded text to adb shell', async () => {
    let hostText = 'Hello ApkBolt! 🚀';
    let executedScript = '';
    const fakeClipboard = {
      readText: () => hostText,
      writeText: (t) => { hostText = t; },
    };
    const fakeAdb = {
      shell: async (args) => {
        executedScript = args.join(' ');
        return '';
      },
    };

    const sync = new ClipboardSync(fakeAdb, { clipboard: fakeClipboard });
    const pushed = await sync.syncHostToGuest();
    assert.equal(pushed, true, 'Should report text pushed');
    assert.ok(executedScript.includes('base64 -d'), 'Should pipe base64 decoded string');
    assert.ok(executedScript.includes(Buffer.from('Hello ApkBolt! 🚀').toString('base64')), 'Should contain encoded text');

    // Second run with same text should be skipped (no redundant IPC)
    const pushedAgain = await sync.syncHostToGuest();
    assert.equal(pushedAgain, false, 'Should skip duplicate clipboard push');
  });

  await test('syncGuestToHost pulls text from Android clipboard', async () => {
    let hostText = '';
    const fakeClipboard = {
      readText: () => hostText,
      writeText: (t) => { hostText = t; },
    };
    const fakeAdb = {
      shell: async (args) => {
        if (args[0] === 'cmd' && args[1] === 'clipboard' && args[2] === 'get') {
          return 'Guest Android Content\n';
        }
        return '';
      },
    };

    const sync = new ClipboardSync(fakeAdb, { clipboard: fakeClipboard });
    const pulled = await sync.syncGuestToHost();
    assert.equal(pulled, true, 'Should report text pulled');
    assert.equal(hostText, 'Guest Android Content', 'Host clipboard should receive Android text');
  });

  console.log(`\nClipboard Tests: ${passed} passed, ${failed} failed\n`);
  process.exitCode = failed ? 1 : 0;
})();

