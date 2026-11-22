'use strict';
/**
 * incrementalupdate(): , , /verify. 
 *
 * :  ~99MB,  Electron (ApkBolt.exe 180MB compress, 
 * dll, locales), upgrade Electron ; 
 * `resources/app/**`( JS / / node_modules). upgrade
 * 99MB .  tiny : 
 * - `ApkBolt-vX-manifest.json`:  app sha256 / size, 
 * Electron version; 
 * - `ApkBolt-vX-app.zip`:  app ( MB). 
 * Electron version, , verify
 * `resources/app`; full package, update. 
 *
 * require electron, CI require . 
 */
const path = require('path');
const { sha256File } = require('./download');

const APP_DIR = 'resources/app';
const MANIFEST_RE = /-manifest\.json$/i;
const APP_PACK_RE = /-app\.zip$/i;

/** ,  ./ ,  zip */
function norm(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

/** verify. ""full package, .  */
function parseManifest(text) {
  let m;
  try { m = JSON.parse(text); } catch (_) { throw new Error('Incremental manifest is not valid JSON'); }
  if (!m || m.schema !== 1) throw new Error('Incremental manifest version not supported');
  if (!m.version || !m.electronVersion) throw new Error('Incremental manifest missing version info');
  if (!m.app || !m.app.asset || !m.app.sha256 || !m.app.files
      || typeof m.app.files !== 'object' || !Object.keys(m.app.files).length) {
    throw new Error('Incremental manifest missing package info');
  }
  return m;
}

/** "", installextractdirectory */
function isAuxAsset(name) {
  const s = String(name || '');
  return /runtime/i.test(s) || APP_PACK_RE.test(s) || MANIFEST_RE.test(s);
}

/**
 * updateincrementalfull package. 
 * network: install, Electron version, . 
 */
function chooseMode({ flavor, electronVersion, manifest, assets = [], current = '' }) {
  if (flavor !== 'portable') return { mode: 'full', reason: 'Installed version uses full installer' };
  if (!manifest) return { mode: 'full', reason: 'No incremental manifest' };
  if (!electronVersion || String(manifest.electronVersion) !== String(electronVersion)) {
    return { mode: 'full', reason: 'Different Electron version; full package required' };
  }
  const appAsset = assets.find((a) => a && a.name === manifest.app.asset);
  if (!appAsset) return { mode: 'full', reason: 'Incremental package not published' };
  return { mode: 'app', appAsset, reason: 'Code-layer incremental update' };
}

/**
 * app :  / . 
 * @param {string} installDir portable versiondirectory( resources/app)
 * @param {object} files app.files(installdirectorypath → {sha256,size})
 * @param {function} hash , 
 */
async function inspectLocal({ installDir, files, hash = sha256File }) {
  const changed = [];
  const missing = [];
  for (const [rel, meta] of Object.entries(files || {})) {
    const full = path.join(installDir, ...norm(rel).split('/'));
    let got = null;
    try { got = await hash(full); } catch (_) { /*  */ }
    if (got === null) missing.push(norm(rel));
    else if (String(got).toLowerCase() !== String(meta && meta.sha256 || '').toLowerCase()) changed.push(norm(rel));
  }
  return { changed, missing, ok: changed.length === 0 && missing.length === 0 };
}

/**
 * verifyextractincremental:  sha256 . 
 * "download / system image". 
 */
async function verifyExtracted({ payload, files, hash = sha256File }) {
  const bad = [];
  for (const [rel, meta] of Object.entries(files || {})) {
    const full = path.join(payload, ...norm(rel).split('/'));
    let got = null;
    try { got = await hash(full); } catch (_) { /*  */ }
    if (got === null || String(got).toLowerCase() !== String(meta && meta.sha256 || '').toLowerCase()) {
      bad.push(norm(rel));
    }
  }
  return bad;
}

module.exports = {
  APP_DIR, MANIFEST_RE, APP_PACK_RE, norm, parseManifest, isAuxAsset,
  chooseMode, inspectLocal, verifyExtracted, sha256File,
};
