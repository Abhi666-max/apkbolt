'use strict';
/**
 * ：install****emulator。
 *
 * ：
 * ApkStart install（NSIS / portable version / MSIX） —— emulator +
 * platform-tools + system image，， MuMu / / 。
 * 0.5.6 ：****，install「runtime + 」，
 * 「runtime」。，
 * （backends/mumu.js / backends/fydeos.js / mumu-compat.js）—— ，
 * failure，「emulator」。
 *
 * ： MuMu directoryruntime build/runtime，
 * emulatordirectory resources 。app，
 * 「emulator」——。
 * ，failure。
 */

const fs = require('fs');
const path = require('path');

/**
 * ，「emulator」。
 * emulator， /android/ ，。
 */
const BANNED = [
  { re: /^mumu/i, vendor: 'MuMu Emulator' },          // MuMuManager.exe / MuMuPlayer.exe / MuMuVMMVbox
  { re: /\.nemu$/i, vendor: 'MuMu Emulator' },        // MuMuPlayer-12.0-0.nemu
  { re: /^nemu$/i, vendor: 'MuMu Emulator' },         // MuMu  nemu
  { re: /^nx_main$/i, vendor: 'MuMu Emulator' },      // MuMu  nx_main / nx_device
  { re: /^nx_device$/i, vendor: 'MuMu Emulator' },
  { re: /^ldplayer/i, vendor: 'LDPlayer' },
  { re: /^dnplayer/i, vendor: 'LDPlayer' },
  { re: /^bluestacks/i, vendor: 'BlueStacks' },
  { re: /^hd-player/i, vendor: 'BlueStacks' },
  { re: /^mgalaxy/i, vendor: 'MEmu ' },
];

/** 「emulator」；.js/.md/.json configuration， */
const BINARY_EXT = /\.(exe|dll|sys|nemu|vdi|vmdk|vbox|iso|msi|bin|dat|db|img)$/i;

/**
 * /directory。
 * @param {string} dir directory（ resources/runtime app directory）
 * @param {object} [opts] { limit } （default 20，hint）
 * @returns {Array<{path: string, name: string, vendor: string}>}
 */
function findBundled(dir, { limit = 20 } = {}) {
  const hits = [];
  const walk = (d) => {
    if (hits.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) {
      return; // / ：
    }
    for (const e of entries) {
      if (hits.length >= limit) return;
      const hit = BANNED.find((b) => b.re.test(e.name));
      // directory；（ backends/mumu.js MuMu ）
      if (hit && (e.isDirectory() || BINARY_EXT.test(e.name))) {
        hits.push({ path: path.join(d, e.name), name: e.name, vendor: hit.vendor });
        continue; // directory，
      }
      if (e.isDirectory()) walk(path.join(d, e.name));
    }
  };
  walk(dir);
  return hits;
}

/**
 * （「emulator」）。
 * .js， BINARY_EXT ，。
 */
const BANNED_SOURCE = [
  { re: /^mumu\.js$/i, what: 'MuMu ' },
  { re: /^fydeos\.js$/i, what: 'FydeOS ' },
  { re: /^mumu-compat\.js$/i, what: 'MuMu ' },
  { re: /^frame\.js$/i, what: 'MuMu ' },
];

/**
 * 。
 * 「backends/xxx.js」 src/core ， frame.js。
 * @param {string} dir
 * @returns {Array<{path: string, name: string, vendor: string}>}
 */
function findForbiddenSource(dir) {
  const hits = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) {
      return;
    }
    const dirName = path.basename(d);
    for (const e of entries) {
      if (e.isDirectory()) { walk(path.join(d, e.name)); continue; }
      const hit = BANNED_SOURCE.find((b) => b.re.test(e.name));
      if (!hit) continue;
      // ：backends/ mumu|fydeos、core/ mumu-compat / frame。
      // （ frame.js），。
      const suspicious = dirName === 'backends' || (dirName === 'core' && !/^builtin\.js$/i.test(e.name));
      if (suspicious) hits.push({ path: path.join(d, e.name), name: e.name, vendor: hit.what });
    }
  };
  walk(dir);
  return hits;
}

/**
 * directoryemulator。
 * @param {string} dir
 * @param {object} [opts] { label, exit } label hint；exit=false 
 * @returns {{ok: boolean, skipped?: boolean, hits: Array}}
 */
function assertStandalone(dir, { label = '', exit = true } = {}) {
  if (!dir || !fs.existsSync(dir)) return { ok: true, skipped: true, hits: [] };
  const hits = findBundled(dir).concat(findForbiddenSource(dir));
  if (!hits.length) return { ok: true, hits: [] };

  const vendors = [...new Set(hits.map((h) => h.vendor))].join(' / ');
  console.error(`\n[] ${label} （${vendors}）：`);
  for (const h of hits) console.error(`  - ${h.path}`);
  console.error('');
  console.error('ApkStart 、：、，');
  console.error('「」。');
  console.error('。\n');
  if (exit) process.exit(4);
  return { ok: false, hits };
}

module.exports = { BANNED, BANNED_SOURCE, findBundled, findForbiddenSource, assertStandalone };
