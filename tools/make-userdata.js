'use strict';
/**
 * userdata system image(). 
 * : node tools/make-userdata.js <> [MB]
 */
const fs = require('fs');
const { buildEmptyExt4 } = require('../src/core/userdata');

const out = process.argv[2];
if (!out) {
  console.error(': node tools/make-userdata.js <> [MB]');
  process.exit(2);
}
const sizeMB = Number(process.argv[3] || 64);
const img = buildEmptyExt4({ sizeMB });
fs.writeFileSync(out, img);
console.log(` ${out}(${(img.length / 1024 / 1024).toFixed(0)}MB, ext4/4KB block)`);
