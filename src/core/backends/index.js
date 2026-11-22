'use strict';
/**
 * 
 *
 * **: runtime(builtin). **
 *
 * 0.5.6 , ApkBolt ,  Android runtime
 * ( adb / emulator / system image), probe, , driveremulator
 * (MuMu / / / WSA / FydeOS), "runtime". 
 *
 * , : 
 * - probe,  MuMu "", 
 * " ApkBolt emulator", , , system image; 
 * - emulatorupgrade, , configuration ApkBolt , ; 
 * - / portable versionruntime, emulator. 
 * (),  builtin: 
 * settings, configuration,  settings.json . 
 */

const { Backend, CAPS } = require('./base');
const { BuiltinBackend } = require('./builtin');

const REGISTRY = [
  BuiltinBackend,
];

/** . , "".  */
const ONLY = 'builtin';

function byId(id) {
  return REGISTRY.find((B) => B.id === id) || null;
}

/** (, ) */
function describe() {
  return REGISTRY.map((B) => ({
    id: B.id,
    label: B.label,
    summary: B.summary,
    embedCapable: B.embedCapable,
  }));
}

/**
 * settings. 
 *
 * note: **ignore settings.engine.mode**. version mode=mumu / fydeos / attach, 
 * settings.json -- builtin, 
 * "".  id 'builtin'. 
 *
 * @param {object} o { appRoot, settings, runtime, store, log, id }
 * @returns {{ backend: Backend, Cls: Function, id: string }}
 */
function create({ appRoot, runtime, store, log, id: forced } = {}) {
  // id(path) builtin
  const id = forced && byId(forced) ? forced : ONLY;
  const Cls = byId(id) || BuiltinBackend;
  const backend = new Cls(appRoot, { runtime, store, log });
  return { backend, Cls, id: Cls.id };
}

/**
 * . ,  builtin, probe: 
 * probeemulatordirectory / , . 
 */
async function autoPick() {
  return { id: ONLY, reason: 'builtin-only' };
}

module.exports = {
  REGISTRY, ONLY, CAPS, byId, describe, create, autoPick, Backend,
};
