#!/usr/bin/env node
'use strict';
/**
 * .apk (launch)
 * node scripts/assoc.js on → APK install
 * node scripts/assoc.js off → 
 */
const path = require('path');
const fs = require('fs');
const { registerAssociation, unregisterAssociation } = require('../src/core/assoc');

const action = process.argv[2] || 'on';
const isDev = !process.env.APKSTART_PACKAGED;
const exe = isDev
  ? path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe')
  : process.execPath;
const appDir = path.join(__dirname, '..');

if (action === 'on') {
  const iconPath = path.join(__dirname, '..', 'build', 'apkstart.ico');
  const r = registerAssociation(exe, fs.existsSync(iconPath) ? iconPath : undefined,
    isDev ? `"${appDir}"` : undefined);
  console.log(' .apk : ', r.progId);
  console.log(' .apk  ApkStart. ');
} else if (action === 'off') {
  unregisterAssociation();
  console.log(' .apk . ');
} else {
  console.log(': node scripts/assoc.js [on|off]');
  process.exit(1);
}
