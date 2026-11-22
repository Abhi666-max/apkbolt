'use strict';
/**
 * driver(patch). 
 *
 * :ApkStart emulator + system image, "":
 * GLES 3.1,  WHPX TCG,  + driver host ......
 * defaultparameters, . 
 *
 * **driver**:driver JSON, ""
 * + "launchparameters". , , , . 
 *
 * :
 * 1. ** JSON, **.  require / eval / hook -- driver
 * download, , . 
 * 2. **whitelist**. launchparameters:`-gpu=...`, `-accel=...`, 
 * config.ini , . `-wipe-data`, `-datadir`, `-sysdir`, 
 * `disk.dataPartition.size` / . 
 * 3. ****. ; driver `priority` , 
 * app; boot"driver"logsettings. 
 *
 * docs/drivers.md,  src/drivers/. 
 */

const fs = require('fs');
const path = require('path');

const DRIVER_FORMAT = 'apkbolt-driver/1';
const MAX_DRIVER_BYTES = 256 * 1024;
const MAX_DRIVERS = 200;

/** driverlaunchparameters:`-flag=value` , value whitelist */
const ARG_RULES = {
  '-gpu': /^(auto|host|swiftshader|swiftshader_indirect|swangle|software|angle|angle_indirect|mesa)$/,
  '-accel': /^(auto|off|on|whpx|hax|haxm|aehd|tcg)$/,
  '-feature': /^[A-Za-z0-9_,.\-]{1,160}$/,
  '-gltransport': /^(pipe|asgpu|virtio)$/,
  // qemu parameters. ,  -drive/-virtfs /parameters
  '-qemu': /^-?[A-Za-z0-9_+=,.:/\-]{1,120}$/,
};

/** ""parameters() */
const FLAG_ONLY = new Set([
  '-no-audio',
  '-no-boot-anim',
  '-no-metrics',
  '-no-snapshot',
  '-no-snapshot-load',
  '-no-snapshot-save',
]);

/**
 * parameters:, , /AVD . 
 * error"", "whitelist". 
 */
const FORBIDDEN_ARGS = {
  '-wipe-data': 'Will erase installed apps and user data',
  '-datadir': 'Modifies AVD path, breaking multi-instance isolation',
  '-sysdir': 'Modifies system image source',
  '-partition-size': 'Modifies data partition size (please use Settings)',
  '-avd': 'AVD name is managed by ApkBolt',
  '-port': 'Ports are dynamically assigned by ApkBolt',
  '-http-proxy': 'Configure proxies via System Settings',
};

/** driver config.ini */
const INI_RULES = {
  'hw.gpu.mode': /^(auto|host|swiftshader|swiftshader_indirect|swangle|software|angle|angle_indirect|mesa)$/,
  'hw.gpu.enabled': /^(yes|no)$/,
  'hw.gltransport': /^(pipe|asgpu|virtio)$/,
  'hw.keyboard': /^(yes|no)$/,
  'hw.audioInput': /^(yes|no|none)$/,
  'hw.audioOutput': /^(yes|no)$/,
  'hw.camera.back': /^(none|emulated|webcam0)$/,
  'hw.camera.front': /^(none|emulated|webcam0)$/,
  'hw.gps': /^(yes|no)$/,
  'vm.heapSize': /^\d{2,4}$/,
  'hw.lcd.density': /^\d{3,4}$/,
};

/** driver */
const ENV_NAME_RULES = [
  /^ANDROID_[A-Z0-9_]{2,40}$/,
  /^QEMU_[A-Z0-9_]{2,40}$/,
  /^LIBGL_[A-Z0-9_]{2,40}$/,
  /^MESA_[A-Z0-9_]{2,40}$/,
  /^EMUGL_[A-Z0-9_]{2,40}$/,
];

/** match (, ) */
const MATCH_KEYS = new Set([
  'any', 'platform', 'arch', 'gpuVendor', 'gpuName', 'cpuVendor',
  'osBuild', 'totalMB', 'cores', 'accel', 'emulatorVersion',
]);

const EFFECT_KEYS = new Set([
  'gpuMode', 'forceTcg', 'emulatorArgs', 'configIni', 'env', 'notes',
]);

// ---------------- ----------------

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function asArray(v) {
  return Array.isArray(v) ? v : [v];
}

/** :, failure null(verifyerror) */
function safeRegex(pattern) {
  const s = String(pattern || '');
  if (!s || s.length > 200) return null;
  try {
    return new RegExp(s, 'i');
  } catch (_) {
    return null;
  }
}

/** version, '36.4.9' vs '36.4.10' */
function versionParts(v) {
  return String(v || '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .slice(0, 4)
    .map(Number);
}

function cmpVersion(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function inRange(value, range) {
  if (range === undefined || range === null) return true;
  const { min, max } = isObj(range) ? range : { min: range };
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  if (min !== undefined && n < Number(min)) return false;
  if (max !== undefined && n > Number(max)) return false;
  return true;
}

// ---------------- verify ----------------

function validateMatch(match, errors) {
  if (match === undefined) return {};
  if (!isObj(match)) {
    errors.push('match must be an object');
    return {};
  }
  for (const k of Object.keys(match)) {
    if (!MATCH_KEYS.has(k)) errors.push(`match.${k} is not a supported match condition`);
  }
  const out = {};
  if (match.any !== undefined) out.any = !!match.any;
  if (match.platform !== undefined) out.platform = asArray(match.platform).map(String);
  if (match.arch !== undefined) out.arch = asArray(match.arch).map(String);
  if (match.gpuVendor !== undefined) out.gpuVendor = asArray(match.gpuVendor).map((v) => String(v).toLowerCase());
  if (match.cpuVendor !== undefined) out.cpuVendor = asArray(match.cpuVendor).map((v) => String(v).toLowerCase());
  if (match.accel !== undefined) out.accel = asArray(match.accel).map((v) => String(v).toLowerCase());
  if (match.gpuName !== undefined) {
    if (!safeRegex(match.gpuName)) errors.push('match.gpuName is not a valid regex (max length 200)');
    else out.gpuName = String(match.gpuName);
  }
  for (const k of ['osBuild', 'totalMB', 'cores', 'emulatorVersion']) {
    if (match[k] === undefined) continue;
    if (!isObj(match[k]) && typeof match[k] !== 'number' && typeof match[k] !== 'string') {
      errors.push(`match.${k} must be a number or {min,max}`);
      continue;
    }
    if (isObj(match[k])) {
      const bad = ['min', 'max'].filter((x) => match[k][x] !== undefined && !Number.isFinite(Number(match[k][x])));
      if (bad.length) {
        errors.push(`match.${k}.${bad.join('/')} must be a number`);
        continue;
      }
      out[k] = { min: match[k].min, max: match[k].max };
    } else {
      out[k] = { min: match[k] };
    }
  }
  return out;
}

function validateArgs(args, errors) {
  const out = [];
  if (args === undefined) return out;
  if (!Array.isArray(args)) {
    errors.push('effect.emulatorArgs must be an array of strings');
    return out;
  }
  for (const raw of args) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const eq = s.indexOf('=');
    const flag = eq > 0 ? s.slice(0, eq) : s;
    const value = eq > 0 ? s.slice(eq + 1) : '';
    if (FORBIDDEN_ARGS[flag]) {
      errors.push(`emulatorArgs does not allow ${flag}: ${FORBIDDEN_ARGS[flag]}`);
      continue;
    }
    if (eq < 0) {
      if (!FLAG_ONLY.has(flag)) errors.push(`emulatorArgs does not support standalone flag ${flag} (use ${flag}=value)`);
      else out.push({ flag, value: '' });
      continue;
    }
    const rule = ARG_RULES[flag];
    if (!rule) {
      errors.push(`emulatorArgs does not support ${flag}`);
      continue;
    }
    if (!rule.test(value)) {
      errors.push(`emulatorArgs has invalid value for ${flag}: ${value}`);
      continue;
    }
    out.push({ flag, value });
  }
  return out;
}

function validateIni(ini, errors) {
  const out = {};
  if (ini === undefined) return out;
  if (!isObj(ini)) {
    errors.push('effect.configIni must be an object');
    return out;
  }
  for (const [k, v] of Object.entries(ini)) {
    const rule = INI_RULES[k];
    if (!rule) {
      errors.push(`configIni does not support ${k}`);
      continue;
    }
    const s = String(v);
    if (!rule.test(s)) {
      errors.push(`configIni has invalid value for ${k}: ${s}`);
      continue;
    }
    out[k] = s;
  }
  return out;
}

function validateEnv(env, errors) {
  const out = {};
  if (env === undefined) return out;
  if (!isObj(env)) {
    errors.push('effect.env must be an object');
    return out;
  }
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_NAME_RULES.some((re) => re.test(k))) {
      errors.push(`env does not allow setting ${k}`);
      continue;
    }
    const s = String(v);
    if (s.length > 200 || /[\r\n\0]/.test(s)) {
      errors.push(`env.${k} has invalid value (length <= 200, no newlines)`);
      continue;
    }
    out[k] = s;
  }
  return out;
}

/**
 * verifydriver( JSON.parse ). 
 * errors , , "". 
 * @param {object} raw
 * @param {object} [opts] { file } 
 * @returns {{ ok:boolean, errors:string[], driver:object|null }}
 */
function validateDriver(raw, { file = '' } = {}) {
  const errors = [];
  const where = file ? `${file}: ` : '';
  if (!isObj(raw)) return { ok: false, errors: [`${where}driver must be a JSON object`], driver: null };

  if (raw.format !== DRIVER_FORMAT) {
    errors.push(`${where}format must be "${DRIVER_FORMAT}" (current ${JSON.stringify(raw.format)})`);
  }
  const id = String(raw.id || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(id)) {
    errors.push(`${where}id must consist of alphanumeric characters, ., _, or - (3-64 chars)`);
  }
  const name = String(raw.name || '').trim();
  if (!name || name.length > 80) errors.push(`${where}name is required (max 80 chars)`);
  const version = String(raw.version || '').trim();
  if (!/^\d+(\.\d+){0,3}(-[A-Za-z0-9.]+)?$/.test(version)) errors.push(`${where}version must follow semver (e.g. 1.0.0)`);
  if (raw.priority !== undefined && (!Number.isFinite(Number(raw.priority)) || Math.abs(Number(raw.priority)) > 100)) {
    errors.push(`${where}priority must be a number between -100 and 100`);
  }

  const match = validateMatch(raw.match, errors);
  if (raw.match !== undefined && isObj(raw.match) && Object.keys(raw.match).length === 0) {
    errors.push(`${where}match cannot be empty (use {"any": true} to match all)`);
  }
  const effectRaw = isObj(raw.effect) ? raw.effect : null;
  if (!effectRaw) errors.push(`${where}effect must be an object`);
  let effect = {
    gpuMode: '', forceTcg: null, args: [], ini: {}, env: {}, notes: [],
  };
  if (effectRaw) {
    for (const k of Object.keys(effectRaw)) {
      if (!EFFECT_KEYS.has(k)) errors.push(`${where}effect.${k} is not a supported field`);
    }
    if (effectRaw.gpuMode !== undefined) {
      const v = String(effectRaw.gpuMode);
      if (!ARG_RULES['-gpu'].test(v)) errors.push(`${where}effect.gpuMode has invalid value: ${v}`);
      else effect.gpuMode = v;
    }
    if (effectRaw.forceTcg !== undefined) {
      if (typeof effectRaw.forceTcg !== 'boolean') errors.push(`${where}effect.forceTcg must be a boolean`);
      else effect.forceTcg = effectRaw.forceTcg;
    }
    effect.args = validateArgs(effectRaw.emulatorArgs, errors);
    effect.ini = validateIni(effectRaw.configIni, errors);
    effect.env = validateEnv(effectRaw.env, errors);
    if (effectRaw.notes !== undefined) {
      if (!Array.isArray(effectRaw.notes)) errors.push(`${where}effect.notes must be an array of strings`);
      else {
        effect.notes = effectRaw.notes
          .map((n) => String(n).trim())
          .filter(Boolean)
          .slice(0, 8)
          .map((n) => (n.length > 200 ? `${n.slice(0, 200)}...` : n));
      }
    }
  }

  if (errors.length) return { ok: false, errors, driver: null };
  return {
    ok: true,
    errors: [],
    driver: {
      format: DRIVER_FORMAT,
      id,
      name,
      version,
      author: String(raw.author || '').slice(0, 60),
      description: String(raw.description || '').slice(0, 400),
      homepage: String(raw.homepage || '').slice(0, 200),
      priority: Number(raw.priority || 0),
      // disabled, default
      enabled: raw.enabled !== false,
      match,
      effect,
      file,
    },
  };
}

// ---------------- ----------------

/**
 * "",  match. 
 * @param {object} o { info, gpuVendor, gpuName, osBuild, accel, emulatorVersion }
 */
function hostContext({ info = {}, gpuVendor = 'unknown', gpuName = '', osBuild = 0, accel = 'unknown', emulatorVersion = '' } = {}) {
  const rel = String(process.release && process.release.name === 'node' ? '' : '');
  return {
    platform: process.platform,
    arch: process.arch,
    totalMB: toInt(info.totalMB),
    cores: toInt(info.cores) || 1,
    gpuVendor: String(gpuVendor || 'unknown').toLowerCase(),
    gpuName: String(gpuName || ''),
    cpuVendor: String((info.cpuVendor || '')).toLowerCase(),
    osBuild: toInt(osBuild),
    accel: String(accel || 'unknown').toLowerCase(),
    emulatorVersion: String(emulatorVersion || rel || ''),
  };
}

/**
 * "", "driver". 
 * @returns {{ ok:boolean, hits:string[] }}
 */
function matchHost(match, host) {
  if (!isObj(match) || !Object.keys(match).length) return { ok: false, hits: [] };
  const hits = [];
  if (match.any) hits.push('any');
  if (match.platform && !match.platform.includes(host.platform)) return { ok: false, hits: [] };
  if (match.platform) hits.push(`platform=${host.platform}`);
  if (match.arch && !match.arch.includes(host.arch)) return { ok: false, hits: [] };
  if (match.arch) hits.push(`arch=${host.arch}`);
  if (match.gpuVendor && !match.gpuVendor.includes(host.gpuVendor)) return { ok: false, hits: [] };
  if (match.gpuVendor) hits.push(`gpu=${host.gpuVendor}`);
  if (match.gpuName) {
    const re = safeRegex(match.gpuName);
    if (!re || !re.test(host.gpuName || '')) return { ok: false, hits: [] };
    hits.push(`gpuName≈${match.gpuName}`);
  }
  if (match.cpuVendor && !match.cpuVendor.includes(host.cpuVendor)) return { ok: false, hits: [] };
  if (match.cpuVendor) hits.push(`cpu=${host.cpuVendor}`);
  if (match.accel && !match.accel.includes(host.accel)) return { ok: false, hits: [] };
  if (match.accel) hits.push(`accel=${host.accel}`);
  if (match.osBuild !== undefined) {
    const b = host.osBuild;
    if (!b || !inRange(b, match.osBuild)) return { ok: false, hits: [] };
    hits.push(`osBuild=${b}`);
  }
  if (match.totalMB !== undefined) {
    if (!inRange(host.totalMB, match.totalMB)) return { ok: false, hits: [] };
    hits.push(`mem=${host.totalMB}MB`);
  }
  if (match.cores !== undefined) {
    if (!inRange(host.cores, match.cores)) return { ok: false, hits: [] };
    hits.push(`cores=${host.cores}`);
  }
  if (match.emulatorVersion !== undefined) {
    const v = host.emulatorVersion;
    if (!v) return { ok: false, hits: [] };
    if (match.emulatorVersion.min !== undefined && cmpVersion(v, match.emulatorVersion.min) < 0) return { ok: false, hits: [] };
    if (match.emulatorVersion.max !== undefined && cmpVersion(v, match.emulatorVersion.max) > 0) return { ok: false, hits: [] };
    hits.push(`emu=${v}`);
  }
  return { ok: hits.length > 0, hits };
}

/** "": priority , driverapp, driverapp() */
function specificity(match) {
  return Object.keys(match || {}).filter((k) => k !== 'any').length;
}

/**
 * driver" → → priority". 
 * :gpuMode/forceTcg , args flag , ini/env . 
 */
function mergeEffect(drivers) {
  const effect = {
    gpuMode: '', forceTcg: null, args: [], ini: {}, env: {}, notes: [],
  };
  const argIndex = new Map();
  for (const d of drivers) {
    const e = d.effect;
    if (e.gpuMode) effect.gpuMode = e.gpuMode;
    if (e.forceTcg !== null) effect.forceTcg = e.forceTcg;
    for (const a of e.args) {
      const key = a.flag;
      if (argIndex.has(key)) effect.args[argIndex.get(key)] = a;
      else {
        argIndex.set(key, effect.args.length);
        effect.args.push(a);
      }
    }
    Object.assign(effect.ini, e.ini);
    Object.assign(effect.env, e.env);
    for (const n of e.notes) effect.notes.push(`${d.name}: ${n}`);
  }
  return effect;
}

/**
 * (verify)driver, . 
 *
 * `state` (id → true/false), 
 * `enabled`:default `enabled:false`, "" state, 
 * installdirectory JSON(store versiondirectory, ). 
 *
 * @param {object} o { drivers, host, state, disabled }
 * @returns {{ applied:Array, skipped:Array, effect:object }}
 */
function resolve({ drivers = [], host = {}, state = {}, disabled = [] } = {}) {
  const off = new Set((Array.isArray(disabled) ? disabled : []).map(String));
  const applied = [];
  const skipped = [];
  for (const d of drivers) {
    if (!d || !d.id) continue;
    const forced = state && typeof state[d.id] === 'boolean' ? state[d.id] : null;
    const on = forced !== null ? forced : (d.enabled !== false);
    if (!on || off.has(d.id)) {
      skipped.push({ id: d.id, name: d.name, reason: 'disabled' });
      continue;
    }
    const m = matchHost(d.match, host);
    if (!m.ok) {
      skipped.push({ id: d.id, name: d.name, reason: 'no-match' });
      continue;
    }
    applied.push({ ...d, hits: m.hits, matchCount: specificity(d.match) });
  }
  applied.sort((a, b) => (a.priority - b.priority)
    || (a.matchCount - b.matchCount)
    || String(a.id).localeCompare(String(b.id)));
  return { applied, skipped, effect: mergeEffect(applied) };
}

// ---------------- IO ----------------

/** driverdirectory(settings, log, directory) */
function userDir(store) {
  return path.join(store.DATA_DIR, 'drivers');
}

/** driver(; default enabled:false, ) */
function bundledDir(appRoot) {
  return path.join(appRoot || '.', 'src', 'drivers');
}

/**
 * directorydriver. driver:
 * error, . 
 * @returns {{ drivers:Array, errors:Array<{file:string, errors:string[]}>, dir:string }}
 */
function loadDir(dir) {
  const out = { drivers: [], errors: [], dir };
  if (!dir || !fs.existsSync(dir)) return out;
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => /\.json$/i.test(n));
  } catch (e) {
    out.errors.push({ file: dir, errors: [e.message] });
    return out;
  }
  names.sort();
  for (const n of names.slice(0, MAX_DRIVERS)) {
    const file = path.join(dir, n);
    let raw;
    try {
      const st = fs.statSync(file);
      if (st.size > MAX_DRIVER_BYTES) {
        out.errors.push({ file, errors: [`File too large (${st.size} bytes, limit ${MAX_DRIVER_BYTES})`] });
        continue;
      }
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      out.errors.push({ file, errors: [`Read error: ${e.message}`] });
      continue;
    }
    const r = validateDriver(raw, { file });
    if (!r.ok) out.errors.push({ file, errors: r.errors });
    else out.drivers.push({ ...r.driver, dir });
  }
  return out;
}

/** directory id :directory( id ) */
function loadAll(dirs = []) {
  const all = [];
  const errors = [];
  for (const dir of dirs) {
    const r = loadDir(dir);
    errors.push(...r.errors);
    for (const d of r.drivers) {
      const i = all.findIndex((x) => x.id === d.id);
      if (i >= 0) all[i] = d;
      else all.push(d);
    }
  }
  return { drivers: all, errors };
}

/**
 * driver:verify,  id `<id>.json`. 
 * verify id , ( ../ path). 
 * @returns {{ ok:boolean, file?:string, driver?:object, errors?:string[] }}
 */
function importDriver(srcFile, destDir) {
  let raw;
  try {
    const st = fs.statSync(srcFile);
    if (st.size > MAX_DRIVER_BYTES) return { ok: false, errors: ['File too large; driver maximum is 256 KB'] };
    raw = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`Read error: ${e.message}`] };
  }
  const r = validateDriver(raw, { file: path.basename(srcFile) });
  if (!r.ok) return { ok: false, errors: r.errors };
  try {
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, `${r.driver.id}.json`);
    fs.writeFileSync(dest, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    return { ok: true, file: dest, driver: r.driver };
  } catch (e) {
    return { ok: false, errors: [`Write error: ${e.message}`] };
  }
}

/**
 * "": match, 
 * effect ""driver. 
 */
function templateFromHost(host = {}, { name = 'My Machine' } = {}) {
  const gpu = host.gpuVendor && host.gpuVendor !== 'unknown' ? host.gpuVendor : 'unknown';
  return {
    format: DRIVER_FORMAT,
    id: `my-${gpu}-${toInt(host.osBuild) || 'custom'}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-'),
    name: `${name} Compatibility Patch`,
    version: '1.0.0',
    author: '',
    description: 'Generated from template: match criteria pre-filled for this machine; edit effect as needed.',
    priority: 0,
    match: {
      platform: host.platform || process.platform,
      arch: host.arch || process.arch,
      ...(gpu !== 'unknown' ? { gpuVendor: gpu } : {}),
      ...(host.totalMB ? { totalMB: { min: Math.max(2048, Math.round(host.totalMB * 0.9)) } } : {}),
    },
    effect: {
      gpuMode: 'swangle',
      forceTcg: false,
      emulatorArgs: [],
      configIni: {},
      env: {},
      notes: ['Example: change gpuMode to host / software or enable forceTcg'],
    },
  };
}

/** gpuMode emulator -gpu (auto ) */
function gpuModeToArg(mode) {
  const v = String(mode || '').trim();
  return v && v !== 'auto' ? v : '';
}

module.exports = {
  DRIVER_FORMAT,
  ARG_RULES,
  FLAG_ONLY,
  FORBIDDEN_ARGS,
  INI_RULES,
  ENV_NAME_RULES,
  MATCH_KEYS,
  EFFECT_KEYS,
  MAX_DRIVER_BYTES,
  safeRegex,
  cmpVersion,
  validateDriver,
  hostContext,
  matchHost,
  specificity,
  mergeEffect,
  resolve,
  userDir,
  bundledDir,
  loadDir,
  loadAll,
  importDriver,
  templateFromHost,
  gpuModeToArg,
};
