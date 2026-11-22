'use strict';

const api = window.apkstart;
const $ = (id) => document.getElementById(id);

const state = {
  apps: [],
  settings: null,
  status: null,
  filter: '',
  installing: false,
  setupBusy: null,
  menuPkg: null,
};

/* ---------------- ---------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function initialOf(label) {
  const t = String(label || '?').trim();
  return (t[0] || '?').toUpperCase();
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function relTime(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)} min ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)} hr ago`;
  if (d < 86400000 * 30) return `${Math.floor(d / 86400000)} days ago`;
  return new Date(ts).toLocaleDateString('en-US');
}

/**
 * toast
 *
 * + : 
 * installfailure"runtimelaunchlog",  toast, 
 * error, "failure". 
 */
let _toastSeq = 0;
function toast({ title, body = '', type = 'info', progress = null, sticky = false, spinner = false }) {
  const wrap = $('toastWrap');
  // ① :  + (4 ), 
  const key = `${title}|${body}`;
  const dup = [...wrap.children].find((n) => n.dataset.key === key && Date.now() - Number(n.dataset.at || 0) < 4000);
  if (dup) {
    dup.dataset.at = String(Date.now());
    return {
      el: dup,
      dismiss: () => dup.remove(),
      update: ({ title: t2, body: b2 } = {}) => {
        if (t2 !== undefined) dup.querySelector('.t-title-text').textContent = t2;
        if (b2 !== undefined) dup.querySelector('.t-body').textContent = b2;
      },
    };
  }
  // ② :  4 , 
  while (wrap.children.length >= 4) wrap.firstElementChild.remove();

  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.dataset.key = key;
  el.dataset.at = String(Date.now());
  el.dataset.seq = String(++_toastSeq);
  el.innerHTML = `
    <div class="t-title">
      ${spinner ? '<span class="spinner"></span>' : ''}
      <span class="t-title-text">${esc(title)}</span>
    </div>
    <div class="t-body">${esc(body)}</div>
    ${progress === null ? '' : '<div class="bar"><i></i></div>'}
  `;
  $('toastWrap').appendChild(el);

  const dismiss = () => {
    el.style.transition = 'opacity .18s, transform .18s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(4px)';
    setTimeout(() => el.remove(), 200);
  };

  const ctl = {
    el, dismiss,
    update({ title: t2, body: b2, progress: p2, type: ty } = {}) {
      if (t2 !== undefined) el.querySelector('.t-title-text').textContent = t2;
      if (b2 !== undefined) el.querySelector('.t-body').textContent = b2;
      if (p2 !== undefined && el.querySelector('.bar i')) {
        el.querySelector('.bar i').style.width = `${Math.max(2, Math.min(100, p2))}%`;
      }
      if (ty === 'error') el.classList.add('error');
      if (ty === 'ok') {
        el.querySelector('.spinner')?.remove();
        el.classList.remove('error');
      }
    },
  };

  if (!sticky) setTimeout(dismiss, type === 'error' ? 6000 : 3200);
  return ctl;
}

/* ---------------- manual ---------------- */

/** manual;  */
function openManual(payload) {
  if (!api || typeof api.openManual !== 'function') return Promise.resolve(null);
  return api.openManual(payload || { topic: 'overview' }).catch(() => null);
}

/** check → guide. reason .  */
function openManualForIssue(issue, reason = 'clicked') {
  if (!issue) return openManual({ topic: 'overview', reason });
  return openManual({
    issue: issue.code,
    title: issue.title,
    detail: issue.detail,
    reason,
  });
}

/** install/error → guide */
function openManualForError(message, reason = 'install-failed') {
  return openManual({ error: message, reason });
}

/* ---------------- ---------------- */

function visibleApps() {
  const q = state.filter.trim().toLowerCase();
  if (!q) return state.apps;
  return state.apps.filter((a) => (
    a.label.toLowerCase().includes(q)
    || a.package.toLowerCase().includes(q)
  ));
}

function renderGrid() {
  const apps = visibleApps();
  const grid = $('grid');
  const empty = $('empty');

  const hasAny = state.apps.length > 0;
  grid.classList.toggle('hidden', apps.length === 0);
  empty.classList.toggle('hidden', apps.length > 0);

  if (!hasAny) {
    const s = state.status;
    $('emptyHint').textContent = s && s.adbOk === false
      ? 'First time: open Settings → Runtime → One-Click Setup, then install apps.'
      : 'Tip: All apps share one Android runtime - launching subsequent apps is nearly instantaneous.';
    grid.innerHTML = '';
    return;
  }

  // "app". 
  // : app, ; 
  // " APK ", . 
  grid.innerHTML = apps.map((a) => `
    <div class="card" data-pkg="${esc(a.package)}" title="${esc(a.label)}  -  ${esc(a.package)}">
      ${a.pinned ? '<span class="pin">★</span>' : ''}
      ${a.running ? '<span class="badge-run" title="Running"></span>' : ''}
      <div class="icon">
        ${a.iconUrl
          ? `<img src="${esc(a.iconUrl)}" alt="" draggable="false" />`
          : `<div class="fallback" style="background:${esc(a.accent || '#9aa6b2')}">${esc(initialOf(a.label))}</div>`}
      </div>
      <div class="name">${esc(a.label)}</div>
      <div class="meta">${a.running ? 'Running' : `v${esc(a.versionName)}${a.lastLaunchAt ? '  -  ' + relTime(a.lastLaunchAt) : ''}`}</div>
      <div class="open-hint">${a.running ? 'Bring to Front' : 'Open'}</div>
    </div>
  `).join('') + `
    <div class="card card-add" id="cardAdd" role="button" tabindex="0" title="Drop an APK here or click to browse">
      <div class="add-plus" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round"><path d="M12 6v12"/><path d="M6 12h12"/></svg>
      </div>
      <div class="name">Add App</div>
      <div class="meta">Drop APK to install</div>
    </div>
  `;
}

/* ---------------- ---------------- */

async function refreshApps() {
  try {
    state.apps = await api.listApps();
    renderGrid();
    updateStats();
  } catch (e) {
    console.error(e);
  }
}

function updateStats() {
  const n = state.apps.length;
  $('statusStats').textContent = n ? `${n} app${n === 1 ? '' : 's'}` : 'No apps installed';
}

async function refreshStatus() {
  try {
    state.status = await api.runtimeStatus();
    const s = state.status;
    const dot = $('statusDot');
    const text = $('statusText');
    const tag = $('engineTag');

    if (!s.adbOk) {
      dot.className = 'dot err';
      text.textContent = 'Runtime not deployed - Open Settings → Runtime to set up';
      tag.textContent = 'Setup needed';
      tag.className = 'brand-tag';
    } else if (s.deviceOnline) {
      dot.className = 'dot ok';
      text.textContent = `Runtime ready  -  Android ${s.android || '?'}${s.freeform ? '  -  Standalone windows active' : ''}`;
      tag.textContent = `Android ${s.android || ''}`.trim();
      tag.className = 'brand-tag ok';
    } else if (s.phase === 'booting' || s.vmStarting) {
      dot.className = 'dot warn';
      text.textContent = 'Booting Android...';
      tag.textContent = 'Booting';
      tag.className = 'brand-tag';
    } else if (s.needsSetup === 'accel') {
      dot.className = 'dot warn';
      // """"--
      text.textContent = 'Hardware acceleration off: running in software mode (slow). Use Diagnostics to fix.';
      tag.textContent = 'Software Mode';
      tag.className = 'brand-tag';
    } else if (s.needsSetup === 'sysimg') {
      dot.className = 'dot err';
      text.textContent = 'Missing Android 14 system image - download in Settings → Runtime (~1.5 GB, one-time)';
      tag.textContent = 'Image needed';
      tag.className = 'brand-tag';
    } else if (s.needsSetup === 'emulator') {
      dot.className = 'dot err';
      text.textContent = 'Runtime engine not installed - open Settings → Runtime';
      tag.textContent = 'Setup needed';
      tag.className = 'brand-tag';
    } else if (s.needsSetup === 'boot') {
      dot.className = 'dot warn';
      text.textContent = 'Runtime ready - install an APK or double-click a shortcut to launch';
      tag.textContent = 'Ready';
      tag.className = 'brand-tag';
    } else if (s.installing) {
      dot.className = 'dot warn';
      text.textContent = 'Installer running - complete installation in VM window';
      tag.textContent = 'Installing';
      tag.className = 'brand-tag';
    } else {
      dot.className = 'dot';
      text.textContent = s.installed ? 'Runtime idle (auto-starts when launching apps)' : 'Android system not installed - open Settings → Runtime';
      tag.textContent = s.installed ? 'Idle' : 'Not installed';
      tag.className = 'brand-tag';
    }
    $('statusDevice').textContent = s.deviceOnline ? (s.serial || '') : '';
    // network: (app"networkerror", ). 
    // , , log. 
    const netEl = $('statusNet');
    const netSep = $('statusNetSep');
    if (netEl) {
      const show = !!s.deviceOnline && !!s.network;
      netEl.hidden = !show;
      if (netSep) netSep.hidden = !show;
      if (show) {
        netEl.textContent = s.network.ok ? `Network OK ${s.network.ip || ''}`.trim() : 'VM offline';
        netEl.className = 'status-item status-net ' + (s.network.ok ? 'ok' : 'warn');
        netEl.title = s.network.ok
          ? 'Android VM is connected to the network'
          : 'Android VM has no internet connection. Use Settings → Repair Network to fix.';
      }
    }

    renderSetup(s);
  } catch (e) {
    $('statusText').textContent = `Status check failed: ${e.message}`;
  }
}

/* ---------------- runtime(settings) ---------------- */

/**
 * runtime//"settings", installapp. 
 * showSetup ui:navigate , "settingsruntime". 
 */
function showSetup(on) {
  if (!on) { $('setupGuide').hidden = true; return; }
  openSettings().then(() => {
    focusGroup($('runtimeGroup'));
  }).catch(() => {});
}

function fmtGB(n) { return n ? `${(n / 1073741824).toFixed(2)} GB` : ''; }

function stepRow(opt) {
  const cls = ['step'];
  if (opt.done) cls.push('done');
  if (opt.busy) cls.push('busy');
  return `
    <div class="${cls.join(' ')}" data-step="${opt.key}">
      <div class="idx">${opt.done ? '✓' : opt.index}</div>
      <div class="body">
        <div class="t">${esc(opt.title)}${opt.tag ? `<span class="tag ${opt.req ? 'req' : ''}">${esc(opt.tag)}</span>` : ''}</div>
        <div class="d" data-desc>${esc(opt.desc)}</div>
        <div class="bar"><i data-bar></i></div>
      </div>
      <div class="act">${opt.actions || ''}</div>
    </div>`;
}

function renderSetup(s) {
  if (!s) return;
  const env = s.env || {};
  const hv = env.hypervisor || {};
  const accel = env.accel || s.accel || {};

  // launchinstallapp: , 
  // settingsruntime + . 
  const accelOk = accel.ok || hv.whpx;
  const adbDone = !!(env.adb && env.adb.ok);
  const emuDone0 = !!(env.emulator && env.emulator.ok);
  const imgDone0 = !!(env.sysimg && env.sysimg.ok);
  const allDone0 = adbDone && emuDone0 && imgDone0;
  const stateText = $('setupStateText');
  if (stateText) {
    const missing = [];
    if (!adbDone) missing.push('adb');
    if (!emuDone0) missing.push('engine');
    if (!imgDone0) missing.push('system image');
    stateText.textContent = s.deviceOnline
      ? `Ready  -  Android ${s.android || ''}`
      : s.phase === 'booting' || s.vmStarting
        ? 'Booting Android...'
        : allDone0
          ? 'All components ready  -  Idle (auto-starts on launch)'
          : `Missing: ${missing.join(', ')}${accelOk ? '' : ' (no hardware acceleration - will use software mode)'}`;
    stateText.title = s.autoProfile || accel.note || hv.note || '';
  }

  const emuDone = !!(env.emulator && env.emulator.ok);
  const imgDone = !!(env.sysimg && env.sysimg.ok);
  const busy = state.setupBusy;
  const booting = s.phase === 'booting';

  // : download, parameters, boot"complete", 
  // launch, . 
  const allDone = !!(env.adb && env.adb.ok) && emuDone && imgDone;
  const left = [];
  if (!(env.adb && env.adb.ok)) left.push('adb toolchain');
  if (!emuDone) left.push('Android runtime');
  if (!imgDone) left.push('system image');
  const step = {
    key: 'all',
    index: 1,
    title: allDone ? 'All Ready' : 'One-Click Setup',
    tag: allDone ? 'Complete' : 'Auto',
    done: allDone,
    busy: !!busy,
    desc: s.deviceOnline
      ? `Android ${s.android || ''} ready  -  Windows adapt automatically to screen`
      : booting
        ? 'Booting Android...'
        : allDone
          ? 'All components ready - double-click any APK or shortcut to boot'
          : `Missing ${left.join(', ')}; click One-Click Setup below to install automatically`,
    actions: s.deviceOnline
      ? '<button class="btn ghost sm" data-act="vmStop">Stop Runtime</button>'
      : '',
  };

  $('setupSteps').innerHTML = stepRow(step);
  $('btnDeployAll').disabled = !!busy;
  $('btnDeployAll').textContent = busy ? 'Preparing...' : (allDone ? 'Ready  -  Re-check' : 'One-Click Setup');
  // ""failure: restartmemory diagnosis , 
  // autoProfile (issue #20/#25 ). 
  const lf = s.lastFailure;
  const lastMsg = (lf && lf.diagnosis && lf.diagnosis.title)
    ? `Last launch failed: ${lf.diagnosis.title}`
    : (s.diagnosis ? `Last auto-diagnosis: ${s.diagnosis.title}` : '');
  $('setupNote').textContent = lastMsg
    || s.autoProfile || 'Fully automatic: no manual image selection, acceleration, or memory tuning needed';
}

function store_getDiskSize() {
  return (state.settings && state.settings.runtime && state.settings.runtime.diskSizeGB) || 24;
}

function setStepBusy(key, on) {
  state.setupBusy = on ? key : null;
  // , 
  const row = $('setupSteps').querySelector('[data-step="all"]');
  if (row) {
    row.classList.toggle('busy', !!on);
    if (on) {
      const bar = row.querySelector('[data-bar]');
      if (bar) bar.style.width = '3%';
    }
  }
}

function updateStepProgress(component, p) {
  if (!component) return;
  const row = $('setupSteps').querySelector('[data-step="all"]');
  if (!row) return;
  if (p.percent !== undefined) {
    const bar = row.querySelector('[data-bar]');
    if (bar) bar.style.width = `${Math.max(3, Math.min(100, p.percent))}%`;
  }
  if (p.message) {
    const d = row.querySelector('[data-desc]');
    if (d) d.textContent = p.message;
  }
}

async function deployAll() {
  if (state.setupBusy) return;
  setStepBusy('all', true);
  try {
    // adb / / system image, 
    // ""retry, failure
    const r = await api.autoDeploy({ force: true });
    if (!r || !r.ok) {
      toast({ title: 'Setup Failed', body: (r && r.error) || 'Please check your internet connection and retry', type: 'error', sticky: true });
      return;
    }
    await refreshStatus();
    toast({ title: 'Components ready, booting...', body: 'First boot takes 1-3 minutes; subsequent launches take seconds.', type: 'info' });
    const started = await api.runtimeStart();
    await refreshStatus();
    toast(started && started.ok
      ? { title: 'Runtime Ready', body: 'You can now drag APKs into the window or double-click shortcuts.', type: 'ok' }
      : { title: 'Boot Incomplete', body: (started && started.error) || 'Export a diagnostic report to investigate', type: 'error', sticky: true });
  } catch (e) {
    toast({ title: 'Setup Failed', body: e.message, type: 'error', sticky: true });
  } finally {
    setStepBusy('all', false);
    await refreshStatus();
    selfCheck();
  }
}

async function runStep(key) {
  if (state.setupBusy) return { ok: false, error: 'Setup already in progress' };
  setStepBusy(key, true);
  let r;
  try {
    if (key === 'adb') r = await api.installAdb();
    else if (key === 'emulator') r = await api.installEmulator();
    else if (key === 'sysimg') r = await api.installSysimg();
    else if (key === 'accel') {
      const t = toast({
        title: 'Installing hardware acceleration driver...',
        body: 'Click Yes in the UAC elevation prompt',
        sticky: true,
        spinner: true,
      });
      r = await api.enableAccel();
      if (r.ok) t.update({ title: 'Hardware Acceleration Enabled', type: 'ok' });
      else t.update({ title: 'Acceleration Not Enabled', body: r.error, type: 'error', sticky: true });
    } else if (key === 'qemu') r = await api.installQemu();
    else if (key === 'iso') r = await api.downloadIso();
    else if (key === 'disk') r = await api.createDisk(store_getDiskSize());
    else r = { ok: false, error: 'Unknown step' };
  } catch (e) {
    r = { ok: false, error: e.message };
  }
  setStepBusy(key, false);
  await refreshStatus();
  return r;
}

async function startInstall() {
  const r = await api.startInstaller();
  if (!r.ok) {
    toast({ title: 'Failed to start installation environment', body: r.error, type: 'error', sticky: true });
    return;
  }
  $('setupGuide').hidden = false;
  $('setupGuide').scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast({ title: 'VM window opened', body: 'Follow the steps to complete installation, then click "Mark as Installed".', type: 'ok', sticky: true });
}

async function markInstalled() {
  await api.markInstalled();
  await api.runtimeStop();
  $('setupGuide').hidden = true;
  await refreshStatus();
  toast({ title: 'Installation complete', body: 'Runtime is active. You can now drag APKs here to install.', type: 'ok' });
}



/* ---------------- install ---------------- */

/** installfailure"", hint,  */
function friendlyInstallErrorText(msg) {
  const s = String(msg || 'Unknown error');
  if (/INSUFFICIENT_STORAGE|not enough space|insufficient space|ENOSPC/i.test(s)) {
    return `${s}\nAndroid data partition is full: go to Settings → Performance & Resources, increase partition size, and click "Expand Partition Now".`;
  }
  // failure: system image""hint(install:progress), 
  // failure"retry"--, failure. 
  if (/NO_MATCHING_ABIS/i.test(s)) {
    return /fallback.*still failed|abiRetried/i.test(s)
      ? `${s}\nARM compatible image is active but installation still failed. Please export a diagnostic report in Settings → Diagnostics.`
      : `${s}\nThis app contains only ARM libraries. ApkBolt is automatically switching to the ARM compatible image.`;
  }
  if (/INSTALL_FAILED_ALREADY_EXISTS|signatures do not match/i.test(s)) {
    return `${s}\nPackage name matches an existing app with a different signature. Uninstall the old version before reinstalling.`;
  }
  if (/INSTALL_FAILED_VERSION_DOWNGRADE/i.test(s)) return `${s}\nA newer version is already installed. Uninstall it before installing this package.`;
  if (/ERR_FS_FILE_TOO_LARGE|greater than possible Buffer|Cannot allocate|ENOMEM|out of memory/i.test(s)) {
    return `${s}\nPackage too large or insufficient memory. Confirm disk space and RAM, then retry.`
      + 'If it still fails, move the APK to a simple ASCII path (e.g. D:\\app.apk).';
  }
  return s;
}

/* "install..." sticky hint. install:error : 
 * send('install:error') invoke failure, , 
 * catch "error".  */
let installToast = null;

async function installFiles(paths) {
  if (!paths || !paths.length) return;
  if (state.installing) {
    toast({ title: 'Installation in progress', body: 'Please wait for the current installation to finish.' });
    return;
  }
  state.installing = true;
  let ok = 0;
  let failed = 0;

  for (const p of paths) {
    const name = p.split(/[\\/]/).pop();
    const t = toast({ title: `Installing ${name}`, body: 'Parsing APK...', progress: 8, sticky: true, spinner: true });
    installToast = t;
    let off = () => {};
    try {
      off = api.on('install:progress', (pr) => {
        const base = { parse: 12, 'parse-done': 24, runtime: 38, install: 62, shortcut: 88, done: 100 }[pr.stage] || 50;
        const pct = pr.percent != null ? Math.min(60, Math.round((pr.percent / 100) * 60)) : base;
        t.update({ title: pr.meta ? `Installing ${pr.meta.label}` : `Installing ${name}`, body: pr.message, progress: pct });
      });
      const r = await api.installApk(p);
      t.update({ title: `${r.app.label} Installed`, body: r.app.shortcutPath ? 'Desktop shortcut created - double-click to launch.' : 'Right-click the app card to create a desktop shortcut.', progress: 100, type: 'ok' });
      t.el.querySelector('.spinner')?.remove();
      setTimeout(t.dismiss, 3600);
      if (r.warnings && r.warnings.length) {
        toast({ title: `${r.app.label} Compatibility Notice`, body: r.warnings.join(' '), type: 'error', sticky: false });
      }
      ok++;
    } catch (e) {
      failed++;
      // "install..." sticky hint, , 
      // runtimelog -- "failure". 
      // errorhint install:error (), 
      // . 
      try { off(); } catch (_) { /* ignore */ }
      t.dismiss();
      if (installToast === t) installToast = null;
    } finally {
      try { off(); } catch (_) { /* ignore */ }
    }
  }

  state.installing = false;
  await refreshApps();
  if (ok && !failed) $('search').value = '';
}

/* ---------------- app ---------------- */

async function launchApp(pkg) {
  const app = state.apps.find((a) => a.package === pkg);
  state.launchPkg = pkg;
  const t = toast({
    title: `Opening ${app ? app.label : pkg}`, 
    body: 'Warming up Android runtime for launch, please wait...', 
    sticky: true,
    spinner: true,
  });
  const r = await api.launch(pkg);
  if (r.ok) {
    // appwindow, ; hint, window
    t.update({ title: 'Launched', body: 'App is running in a standalone window (use titlebar to rotate).', type: 'ok' });
    setTimeout(t.dismiss, 1600);
    setTimeout(() => api.winHide(), 900);
    setTimeout(refreshApps, 1200);
  } else {
    t.update({ title: 'Launch Failed', body: r.error, type: 'error' });
    setTimeout(t.dismiss, 6000);
  }
}

async function createShortcut(pkg) {
  try {
    const r = await api.createShortcut(pkg);
    toast({ title: 'Desktop Shortcut Created', body: r.path, type: 'ok' });
    refreshApps();
  } catch (e) {
    toast({ title: 'Shortcut Creation Failed', body: e.message, type: 'error' });
  }
}

async function uninstall(pkg) {
  const app = state.apps.find((a) => a.package === pkg);
  if (!app) return;
  const ok = window.confirm(`Uninstall "${app.label}"?\n\nAll app data will be erased and desktop shortcuts will be removed.`);
  if (!ok) return;
  try {
    await api.uninstall(pkg);
    toast({ title: 'Uninstalled', body: app.label, type: 'ok' });
    refreshApps();
  } catch (e) {
    toast({ title: 'Uninstall Failed', body: e.message, type: 'error' });
  }
}

/* ---------------- ---------------- */

const MENU_ITEMS = [
  { key: 'open', label: 'Open App', kbd: 'Enter' },
  // appruntime( showMenu ). 
  // , window, 
  // app, exit ApkStart. 
  { key: 'stop', label: 'Close App', onlyRunning: true },
  { key: 'shortcut', label: 'Create Desktop Shortcut' },
  { key: 'orientation', label: 'Rotate Orientation' },
  { key: 'pin', label: 'Pin to Top' },
  { key: 'keymap', label: 'Key Mapping...' },
  { divider: true },
  { key: 'reveal', label: 'Show APK in Explorer' },
  { key: 'clear', label: 'Clear App Data' },
  { divider: true },
  { key: 'uninstall', label: 'Uninstall', danger: true },
];

function showMenu(x, y, pkg) {
  const menu = $('ctxmenu');
  state.menuPkg = pkg;
  const app = state.apps.find((a) => a.package === pkg);
  const items = MENU_ITEMS.filter((it) => !it.onlyRunning || (app && app.running));
  menu.innerHTML = items.map((it) => {
    if (it.divider) return '<div class="divider"></div>';
    const label = it.key === 'pin' ? (app && app.pinned ? 'Unpin' : 'Pin to Top')
      : (it.key === 'orientation'
        ? (app && app.orientationOverride === 'landscape' ? 'Launch Portrait (currently landscape)'
          : (app && app.orientationOverride === 'portrait' ? 'Launch Landscape (currently portrait)' : 'Launch in Landscape'))
        : it.label);
    return `<div class="item ${it.danger ? 'danger' : ''}" data-key="${it.key}" data-act="${it.key}">
      <span>${esc(label)}</span>${it.kbd ? `<span class="k">${it.kbd}</span>` : ''}
    </div>`;
  }).join('');
  menu.classList.add('on');

  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 10)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 10)}px`;
}

function hideMenu() {
  $('ctxmenu').classList.remove('on');
  state.menuPkg = null;
}

async function handleMenu(act) {
  const pkg = state.menuPkg;
  const app = state.apps.find((a) => a.package === pkg);
  hideMenu();
  if (!app) return;
  switch (act) {
    case 'open': return launchApp(pkg);
    case 'stop': {
      try {
        const r = await api.stop(pkg);
        if (r && r.ok) {
          toast({ title: 'Closed', body: app.label, type: 'ok' });
        } else {
          toast({ title: 'Close Failed', body: (r && r.error) || 'Unknown error', type: 'error' });
        }
      } catch (e) {
        toast({ title: 'Close Failed', body: e.message, type: 'error' });
      }
      return refreshApps();
    }
    case 'shortcut': return createShortcut(pkg);
    case 'orientation': {
      // : app → landscape → portrait → app
      // portraitapp, landscape. 
      const cur = app.orientationOverride;
      const next = cur === 'landscape' ? 'portrait' : (cur === 'portrait' ? null : 'landscape');
      try {
        const r = await api.setAppOrientation(pkg, next);
        const txt = next === 'landscape' ? 'Launch in Landscape' : (next === 'portrait' ? 'Launch in Portrait' : 'Follow App');
        toast({ title: `Orientation: ${txt}`, body: 'Takes effect on next launch - no full restart needed.', type: 'ok' });
        if (r && typeof r.landscape === 'boolean' && state.apps) {
          const rec = state.apps.find((a) => a.package === pkg);
          if (rec) rec.orientationOverride = next;
        }
      } catch (e) {
        toast({ title: 'Failed to set orientation', body: e.message, type: 'error' });
      }
      return refreshApps();
    }
    case 'pin': return api.pin(pkg, !app.pinned).then(refreshApps);
    case 'keymap': return showKeymapPicker(pkg, app.label);
    case 'reveal': return api.revealApk(pkg);
    case 'clear': {
      if (!window.confirm(`Clear all data for "${app.label}"? This cannot be undone.`)) return;
      try {
        await api.clearData(pkg);
        toast({ title: 'Data Cleared', body: app.label, type: 'ok' });
      } catch (e) {
        toast({ title: 'Clear Failed', body: e.message, type: 'error' });
      }
      return;
    }
    case 'uninstall': return uninstall(pkg);
    default: return undefined;
  }
}

/**
 * key.  confirm + prompt ( UI ). 
 * . 
 */
async function showKeymapPicker(pkg, label) {
  try {
    const presets = await api.keymap.getPresets();
    const current = await api.keymap.getMap(pkg);
    const hasCurrent = current && current.length > 0;
    const lines = presets.map((p, i) => `${i + 1}. ${p.label} - ${p.desc}`);
    if (hasCurrent) lines.unshift('0. Clear current mapping');
    const msg = `Choose key mapping preset for "${label}":\n\n${lines.join('\n')}\n\nEnter number:`;
    const input = window.prompt(msg, hasCurrent ? '0' : '1');
    if (input === null) return; // 
    const idx = parseInt(input, 10);
    if (hasCurrent && idx === 0) {
      await api.keymap.setMap(pkg, []);
      toast({ title: 'Key mapping cleared', body: label, type: 'ok' });
      return;
    }
    const presetIdx = hasCurrent ? idx - 1 : idx;
    if (presetIdx < 1 || presetIdx > presets.length) {
      toast({ title: 'Invalid number', type: 'error' });
      return;
    }
    const chosen = presets[presetIdx - 1];
    await api.keymap.applyPreset(pkg, chosen.id);
    toast({ title: `Applied "${chosen.label}"`, body: `${label}  -  Keyboard is active in app`, type: 'ok' });
  } catch (e) {
    toast({ title: 'Key mapping setup failed', body: e.message, type: 'error' });
  }
}

/* ---------------- settings ---------------- */

// ---------------- Androidsettings ----------------

let volumeTimer = null;

async function refreshAndroid() {
  const el = $('androidStatus');
  if (!el) return;
  el.textContent = 'Loading...';
  const r = await api.android.status().catch(() => null);
  if (!r || !r.ok) {
    el.textContent = r && r.error ? `Runtime not ready (${String(r.error).slice(0, 36)})` : 'Runtime not running';
    return;
  }
  el.textContent = `Android ${r.sdk || '?'}  -  ${r.wifi ? 'Wi-Fi On' : 'Wi-Fi Off'}` +
    `${r.airplane ? '  -  Airplane Mode' : ''}  -  Volume ${r.volume}%`;
  $('setAndroidWifi').checked = !!r.wifi;
  $('setAndroidAirplane').checked = !!r.airplane;
  $('setAndroidAnim').checked = !r.animationsOff;
  $('setAndroidVolume').value = r.volume;
  $('androidVolumeText').textContent = `${r.volume}%`;
  if (r.fontScale) $('setAndroidFont').value = Number(r.fontScale).toFixed(2);
  if (r.density) {
    const opt = [...$('setAndroidDensity').options].find((o) => o.value === String(r.density));
    if (opt) $('setAndroidDensity').value = String(r.density);
  }
}

function bindAndroid() {
  const set = async (key, value, msg) => {
    const r = await api.android.set(key, value).catch(() => null);
    toast({
      type: r && r.ok ? 'ok' : 'error',
      title: r && r.ok ? (msg || 'Applied') : `Failed: ${(r && r.error) || 'Runtime not ready'}`, 
    });
    if (r && r.ok) refreshAndroid();
  };
  $('setAndroidWifi').addEventListener('change', (e) => set('wifi', e.target.checked, e.target.checked ? 'Wi-Fi Enabled' : 'Wi-Fi Disabled'));
  $('setAndroidAirplane').addEventListener('change', (e) => set('airplane', e.target.checked, e.target.checked ? 'Airplane Mode On' : 'Airplane Mode Off'));
  $('setAndroidAnim').addEventListener('change', (e) => set('animations', e.target.checked, e.target.checked ? 'System Animations On' : 'Animations Off (Faster UI)'));
  $('setAndroidFont').addEventListener('change', (e) => set('fontScale', Number(e.target.value), 'Font scale updated'));
  $('setAndroidDensity').addEventListener('change', (e) => set('density', Number(e.target.value), 'Display density updated'));
  $('setAndroidVolume').addEventListener('input', (e) => {
    $('androidVolumeText').textContent = `${e.target.value}%`;
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => set('volume', Number(e.target.value), 'Volume updated'), 260);
  });
  $('btnAndroidRefresh').addEventListener('click', () => refreshAndroid());
  $('btnAndroidTune').addEventListener('click', async () => {
    const r = await api.android.tune(state.launchPkg || '').catch(() => null);
    toast({ type: r && r.ok ? 'ok' : 'error', title: r && r.ok ? 'Optimized: animations off, background relaxed, battery whitelist active' : 'Optimization failed - runtime may not be running' });
    if (r && r.ok) refreshAndroid();
  });
  const open = async (action) => {
    const r = await api.android.open(action).catch(() => null);
    if (!r || !r.ok) {
      toast({ type: 'error', title: 'Launch an app first to boot the Android engine' });
    }
  };
  $('btnAndroidSettings').addEventListener('click', () => open('settings'));
  $('btnAndroidDisplay').addEventListener('click', () => open('display'));
  $('btnAndroidSound').addEventListener('click', () => open('sound'));
  $('btnAndroidLocale').addEventListener('click', () => open('locale'));
  $('btnAndroidApps').addEventListener('click', () => open('apps'));
}

/** settings: runtime, ,  */
function syncBackendFields() {
  const perf = $('perfGroup');
  if (perf) perf.hidden = false;
  refreshResources();
}

/** + (settings) */
async function refreshResources() {
  const bNote = $('builtinResNote');
  if (!bNote) return;
  const gb = (mb) => (Number(mb) > 0 ? `${Math.round(Number(mb) / 1024)} GB` : 'Unknown');
  const r = await api.resources().catch(() => null);
  if (!r || r.ok === false) {
    bNote.textContent = (r && (r.note || r.error)) || 'Resource allocation info temporarily unavailable';
    return;
  }
  const host = r.host || {};
  const lim = r.limits || {};
  const free = Number(r.freeMB) || Number((r.current && r.current.freeMB) || 0);
  bNote.textContent = `Host: ${gb(host.totalMB)} RAM / ${host.cores} cores; `
    + `Allocatable RAM up to ${gb(lim.maxMB)}, cores up to ${Math.max(1, (host.cores || 1) - 1)} (reserving 1/4 RAM & 1 core for Windows). `
    + `Data partition max: ${lim.maxGB || 0} GB${free ? ` (disk free: ${(free / 1024).toFixed(1)} GB)` : ''}. `
    + (r.verdict && r.verdict.note ? ` ${r.verdict.note}` : '');
}

/** checkup: () */
function renderPreflight(res) {
  const list = $('preflightList');
  const sum = $('preflightSummary');
  const applyBtn = $('btnPreflightApply');
  if (!list) return;
  list.textContent = '';
  if (!res || !res.report) {
    if (sum) sum.textContent = (res && res.error) || 'Diagnostics returned no results, please retry';
    return;
  }
  const { report, edition } = res;
  for (const it of report.items) {
    const item = document.createElement('div');
    item.className = 'pf-item';
    const head = document.createElement('div');
    head.className = 'pf-head';
    const dot = document.createElement('span');
    dot.className = `pf-dot ${it.level}`;
    const title = document.createElement('span');
    title.className = 'pf-title';
    title.textContent = it.title;
    head.append(dot, title);
    item.append(head);
    if (it.detail) {
      const d = document.createElement('div');
      d.className = 'pf-detail';
      d.textContent = it.detail;
      item.append(d);
    }
    if (it.action && it.action.kind === 'elevate') {
      const wrap = document.createElement('div');
      wrap.className = 'pf-action';
      const btn = document.createElement('button');
      btn.className = 'btn ghost sm';
      btn.textContent = it.action.label;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = 'Processing...';
        let r = null;
        if (it.action.id === 'accel') r = await api.enableAccel().catch(() => null);
        else r = await api.enableVirtualization().catch(() => null);
        btn.disabled = false;
        btn.textContent = old;
        if (!r) { toast({ type: 'error', title: 'Operation incomplete', body: 'Try again later or follow manual instructions' }); return; }
        if (r.cancelled) toast({ type: 'warn', title: 'Cancelled', body: 'No system settings were changed' });
        else if (r.ok || r.already) {
          const reboot = r.restartNeeded === true;
          toast({
            type: 'ok',
            title: r.already ? 'Hardware acceleration already active' : (reboot ? 'Submitted - reboot required' : 'Applied'),
            body: r.already ? '' : (reboot ? 'Reboot PC for acceleration to take effect, then run Diagnostics' : 'Run Diagnostics to confirm results'),
          });
          if (r.already || !reboot) setTimeout(() => runPreflight().catch(() => {}), 1200);
        } else {
          toast({ type: 'error', title: 'Could not complete automatically', body: (r.error || r.note || 'Follow the manual instructions') });
        }
      });
      wrap.append(btn);
      item.append(wrap);
    } else if (it.action && it.action.kind === 'manual') {
      const wrap = document.createElement('div');
      wrap.className = 'pf-action pf-detail';
      wrap.textContent = `⚠ ${it.action.label}`;
      item.append(wrap);
    }
    list.append(item);
  }
  const rec = report.recommended || {};
  if (sum) {
    sum.textContent = `${report.summary}. Recommended: ${Math.round((rec.memoryMB || 0) / 1024)} GB RAM / `
      + `${rec.cores || 2} cores / ${rec.renderSize || 'auto'}  -  Renderer: ${rec.gpuMode || 'auto'}`
      + (edition === 'store' ? ' (Store edition: system features must be enabled in Windows Features manually)' : '');
  }
  if (applyBtn) applyBtn.hidden = false;
}

async function runPreflight() {
  const btn = $('btnPreflight');
  const sum = $('preflightSummary');
  if (!btn) return null;
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Checking...';
  if (sum) sum.textContent = 'Checking virtualization, GPU, RAM... (first run takes ~2-3 s)';
  let r = null;
  try {
    r = await api.preflightRun();
  } catch (e) {
    r = { error: e.message || 'Diagnostics failed' };
  }
  btn.disabled = false;
  btn.textContent = old;
  renderPreflight(r);
  return r;
}

/** driver(patch):  + */
function renderDrivers(r) {
  const list = $('drvList');
  const sum = $('drvSummary');
  if (!list) return;
  const host = (r && r.host) || {};
  const drivers = (r && r.drivers) || [];
  const errors = (r && r.errors) || [];
  const onCount = drivers.filter((d) => d.enabled && d.matched).length;
  if (sum) {
    const accel = host.accel === 'none' ? 'No hardware acceleration' : (host.accel || 'Unknown');
    sum.textContent = `Host: ${host.platform || ''}/${host.arch || ''}  -  ${host.gpuVendor || 'Unknown'} GPU  -  ${accel}`
      + `  -  emulator ${host.emulatorVersion || 'Unknown'}; ${drivers.length} drivers, ${onCount} active on this PC.`
      + (errors.length ? ` ${errors.length} file(s) failed to load (see below).` : '');
  }
  list.textContent = '';
  for (const d of drivers) {
    const item = document.createElement('div');
    item.className = d.enabled ? 'drv-item on' : 'drv-item';

    const head = document.createElement('div');
    head.className = 'drv-head';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!d.enabled;
    cb.addEventListener('change', async () => {
      const res = await api.driversSetEnabled(d.id, cb.checked).catch(() => null);
      if (res && res.ok && res.overview) renderDrivers(res.overview);
      else { cb.checked = !cb.checked; toast({ type: 'error', title: 'Save failed', body: (res && res.error) || 'Please try again later' }); }
    });
    const name = document.createElement('span');
    name.className = 'drv-name';
    name.textContent = d.name;
    head.append(cb, name);

    if (d.matched && d.enabled) {
      const b = document.createElement('span');
      b.className = 'drv-badge hit';
      b.textContent = 'Active';
      head.append(b);
    }
    if (d.builtin) {
      const b = document.createElement('span');
      b.className = 'drv-badge';
      b.textContent = 'Built-in Template';
      head.append(b);
    }
    item.append(head);

    const meta = document.createElement('div');
    meta.className = 'drv-meta';
    meta.textContent = `v${d.version || '?'}`
      + (d.author ? `  -  ${d.author}` : '')
      + `  -  priority ${d.priority}`
      + (d.hits && d.hits.length ? `  -  Matched: ${d.hits.join(' / ')}` : '  -  Not matched on this PC');
    item.append(meta);

    if (d.description) {
      const desc = document.createElement('div');
      desc.className = 'drv-meta';
      desc.textContent = d.description;
      item.append(desc);
    }
    list.append(item);
  }
  for (const e of errors) {
    const err = document.createElement('div');
    err.className = 'drv-err';
    err.textContent = `${String(e.file || '').split(/[\\/]/).pop()}: ${(e.errors || []).join('; ')}`;
    list.append(err);
  }
  if (!drivers.length && !errors.length) {
    const empty = document.createElement('div');
    empty.className = 'drv-meta';
    empty.textContent = 'No drivers installed. Click "Export Template for This PC" to create one, or import a JSON driver.';
    list.append(empty);
  }
}

async function refreshDrivers() {
  if (!$('drvList')) return;
  const r = await api.driversList().catch(() => null);
  if (!r) {
    if ($('drvSummary')) $('drvSummary').textContent = 'Unable to read driver list (runtime may not be deployed yet)';
    return;
  }
  renderDrivers(r);
}

function fillSettings(s) {
  syncBackendFields();
  refreshDrivers().catch(() => {});
  $('setAdbPath').value = s.adbPath || '';
  $('setSystemImage').value = s.runtime.isoPath || '';
  $('setMemory').value = s.engine.memoryMB;
  $('setCores').value = s.engine.cores;
  $('setIdle').value = s.engine.idleShutdownMinutes;
  if ($('setSourcePref')) $('setSourcePref').value = (s.runtime && s.runtime.sourcePreference) || 'auto';
  if ($('setAutoMirror')) $('setAutoMirror').checked = (s.runtime && s.runtime.autoMirror) !== false;
  if ($('setGiteeToken')) $('setGiteeToken').value = (s.runtime && s.runtime.giteeToken) || '';
  if ($('setMirrorPrefix')) $('setMirrorPrefix').value = (s.runtime && s.runtime.mirrorPrefix) || '';
  if ($('setConnections')) $('setConnections').value = Number((s.runtime && s.runtime.downloadConnections) || 8);
  $('setAudio').checked = s.engine.audio !== false;
  $('setLiteMode').checked = s.engine.liteMode !== false;
  $('setPrewarm').checked = s.engine.prewarm !== false;
  $('setPriorityMode').value = ['performance', 'game'].includes(s.engine.priorityMode)
    ? s.engine.priorityMode : 'balanced';
  $('setDeepTrim').checked = !!s.engine.deepTrim;
  $('setMouseRightBack').checked = s.engine.mouseRightBack !== false;
  $('setMouseWheelMode').value = ['smooth', 'native', 'off'].includes(s.engine.mouseWheelMode)
    ? s.engine.mouseWheelMode : 'smooth';
  $('setMouseSideButtons').checked = !!s.engine.mouseSideButtons;
  if ($('setKeymapEnabled')) $('setKeymapEnabled').checked = s.engine.keymapEnabled !== false;
  // : window()
  if ($('setMultiWindow')) $('setMultiWindow').checked = !!s.engine.multiWindow;
  if ($('setKeepBackground')) $('setKeepBackground').value = String(
    Number(s.engine.keepBackground) >= 0 ? Number(s.engine.keepBackground) : 1,
  );
  $('setCompat').checked = !!(s.runtime && s.runtime.compatImage);
  $('setAutoShortcut').checked = !!s.createShortcutOnInstall;
  $('setStartMenuShortcut').checked = s.createStartMenuShortcut !== false;
  $('setShortcutDir').value = s.shortcutDir || '';
  $('setSharedDir').value = s.sharedDir || '';
  $('setDeviceSharedDir').value = s.deviceSharedDir || '';
  const d = s.display || {};
  $('setAutoStart').checked = s.autoStart !== false;
  const eng = s.engine || {};
  if ($('setResourceMode')) $('setResourceMode').value = eng.resourceMode || 'balanced';
  if ($('setRenderSize')) $('setRenderSize').value = eng.renderSize || 'auto';
  if ($('setDataGB')) $('setDataGB').value = String(Number(eng.dataPartitionGB || 0));
  if ($('setFastDns')) $('setFastDns').checked = eng.fastDns !== false;
  if ($('setLocale')) $('setLocale').value = eng.locale || 'zh-CN';
  if ($('setChineseIme')) $('setChineseIme').checked = eng.chineseIme !== false;
  if ($('setKeepSnapshot')) $('setKeepSnapshot').checked = eng.keepSnapshot !== false;
  $('setDisplayMode').value = d.mode === 'fullscreen' ? 'fullscreen' : 'window';
  if ($('setAutoFullscreen')) $('setAutoFullscreen').value = d.autoFullscreenOnLaunch === true ? 'on' : 'off';
  if ($('setLandscape')) $('setLandscape').value = d.landscape === true ? 'landscape' : 'portrait';
  if ($('setOrientationMode')) $('setOrientationMode').value = d.orientationMode || 'auto';
  if ($('setAutoRotate')) $('setAutoRotate').value = d.autoRotate === false ? 'off' : 'on';
  if ($('setTabletMode')) $('setTabletMode').value = d.tabletMode === false ? 'off' : 'on';
  $('setPortrait').value = d.portrait || '900x1600';
  // 0.6.0 defaultwindow:  true embedded mode(configuration undefined )
  if ($('setWindowEmbed')) $('setWindowEmbed').value = d.windowEmbed === true ? 'embed' : 'detached';
  $('portraitField').hidden = $('setDisplayMode').value === 'fullscreen';
}

/** data partition + disk, settingscapacity */
async function refreshDataInfo() {
  const el = $('dataNote');
  if (!el) return;
  const info = await api.dataInfo().catch(() => null);
  if (!info) { el.textContent = 'Failed to read data partition info'; return; }
  const auto = Number(($('setDataGB') || {}).value || 0) === 0;
  // quickboot system image guest capacity( 8GB system image, guest 5.7GB), 
  // , "runtime". 
  const img = info.overlay ? 'Fast-boot overlay disk (actual capacity reported by Android /data)' : (info.fsGB ? `Filesystem: ${info.fsGB} GB` : (info.imageGB ? `${info.imageGB} GB` : 'Not yet created'));
  const free = info.freeDiskMB ? `${(info.freeDiskMB / 1024).toFixed(1)} GB` : 'Unknown';
  const pending = Number(info.pendingGB) > 0
    ? ` Target ${info.configuredGB} GB not yet applied: Android is using an overlay disk; "Reset Android Data" is required to expand.`
    : '';
  el.textContent = `Data partition: ${img}${auto ? ' (Auto)' : ''}  -  Disk free: ${free}. ${pending}` + ' If an app reports storage full, increase this value and click "Expand Partition Now".';
}

/* ---------------- settings:  + ---------------- */

/**
 * settings, ( 0.6.0 : 
 * "settings"). settings 8 , . 
 *
 * index.html data-cat --
 * test/settings-categories-test.js verify. 
 */
const SETTINGS_CATS = [
  { id: 'basic', name: 'General & Install' },
  { id: 'display', name: 'Display & Window' },
  { id: 'input', name: 'Input & Controls' },
  { id: 'perf', name: 'Performance' },
  { id: 'net', name: 'Network & Downloads' },
  { id: 'diag', name: 'Diagnostics & Repair' },
  { id: 'files', name: 'Integration & Files' },
  { id: 'about', name: 'Updates & About' },
  { id: 'lab', name: 'Lab' },
];

const settingsCatState = { cat: 'basic', query: '' };

/** settings(.group details.advanced-group ) */
function settingsGroups() {
  return Array.from(document.querySelectorAll('#settingsBody [data-cat]'));
}

/** : , ,  */
function groupMatches(group, q) {
  if (!q) return true;
  const text = (group.textContent || '').toLowerCase();
  if (text.includes(q)) return true;
  const title = group.querySelector('.group-title');
  return !!title && title.textContent.toLowerCase().includes(q);
}

/** */
function switchSettingsCat(cat, { keepQuery = false } = {}) {
  const target = SETTINGS_CATS.some((c) => c.id === cat) ? cat : 'basic';
  settingsCatState.cat = target;
  if (!keepQuery) settingsCatState.query = '';
  try { localStorage.setItem('apkbolt.settings.cat', target); } catch (_) { /* ignore */ }
  const search = $('setSearch');
  if (search && !keepQuery) search.value = '';
  const clear = $('btnClearSearch');
  if (clear) clear.hidden = !settingsCatState.query;
  document.querySelectorAll('#setNav .set-nav-item').forEach((b) => {
    b.classList.toggle('on', b.dataset.cat === target);
  });
  applySettingsFilter();
}

/**
 * app: (, 
 * ""); . 
 */
function applySettingsFilter() {
  const q = settingsCatState.query.trim().toLowerCase();
  const groups = settingsGroups();
  const hitPerCat = {};
  for (const g of groups) {
    const hit = groupMatches(g, q);
    const inCat = g.dataset.cat === settingsCatState.cat;
    g.hidden = q ? !hit : !inCat;
    if (hit) hitPerCat[g.dataset.cat] = (hitPerCat[g.dataset.cat] || 0) + 1;
  }
  // : 
  document.querySelectorAll('#setNav .set-nav-item').forEach((b) => {
    const n = hitPerCat[b.dataset.cat] || 0;
    b.classList.toggle('dim', !!q && n === 0);
    b.title = q ? `${n} match(es)` : '';
  });
  // ( :last-child )
  const visible = groups.filter((g) => !g.hidden);
  visible.forEach((g) => g.classList.remove('last-visible'));
  if (visible.length) visible[visible.length - 1].classList.add('last-visible');
  updateCatBadges();
}

/** : ,  */
function focusGroup(el) {
  if (!el) return;
  const cat = el.dataset && el.dataset.cat;
  if (cat) switchSettingsCat(cat);
  const body = $('settingsBody');
  if (body) body.scrollTop = 0;
  if (typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

function bindSettingsCategory() {
  const nav = $('setNav');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.set-nav-item');
      if (!btn) return;
      switchSettingsCat(btn.dataset.cat);
      const body = $('settingsBody');
      if (body) body.scrollTop = 0;
    });
  }

  const search = $('setSearch');
  const clear = $('btnClearSearch');
  if (search) {
    search.addEventListener('input', () => {
      settingsCatState.query = search.value || '';
      if (clear) clear.hidden = !settingsCatState.query;
      applySettingsFilter();
    });
    // : 
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const hit = settingsGroups().find((g) => !g.hidden);
      if (hit) focusGroup(hit);
    });
  }
  if (clear) {
    clear.addEventListener('click', () => {
      settingsCatState.query = '';
      if (search) search.value = '';
      clear.hidden = true;
      applySettingsFilter();
    });
  }

  // Note
  try {
    const last = localStorage.getItem('apkbolt.settings.cat');
    if (last && SETTINGS_CATS.some((c) => c.id === last)) settingsCatState.cat = last;
  } catch (_) { /* ignore */ }
  switchSettingsCat(settingsCatState.cat);
}

/* ---------------- check( debug)---------------- */

/** check( src/core/autodebug.js CATEGORIES ) */
const DEBUG_CATS = [
  { id: 'runtime', name: 'Runtime' },
  { id: 'device', name: 'Device Connection' },
  { id: 'storage', name: 'Storage' },
  { id: 'settings', name: 'Settings' },
  { id: 'network', name: 'Network' },
  { id: 'logs', name: 'Logs' },
];

let autodebugLast = null;

function renderAutodebug(res) {
  const list = $('autodebugList');
  const txt = $('autodebugStateText');
  if (!list) return;
  autodebugLast = res || null;
  const issues = (res && res.issues) || [];
  const at = res && res.at;

  if (txt) {
    if (res && res.running) txt.textContent = 'Checking...';
    else if (!at) txt.textContent = 'Not checked yet';
    else if (!issues.length) txt.textContent = `Last check ${relTime(at)}  -  All systems healthy`;
    else txt.textContent = `Last check ${relTime(at)}  -  ${issues.length} issue(s) to address`;
  }

  if (!issues.length) {
    list.innerHTML = `<div class="dbg-ok">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
      <span>No issues detected. Runtime, adb authorization, disk space, data partition, and settings are healthy.</span>
    </div>`;
    updateCatBadges();
    return;
  }

  const byCat = new Map();
  for (const it of issues) {
    const key = it.category || 'runtime';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(it);
  }
  const order = DEBUG_CATS.map((c) => c.id);
  const keys = Array.from(byCat.keys()).sort((a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  list.innerHTML = keys.map((key) => {
    const name = (DEBUG_CATS.find((c) => c.id === key) || {}).name || key;
    const items = byCat.get(key);
    return `<div class="dbg-group">
      <div class="dbg-group-title">${esc(name)}<span class="dbg-count">${items.length}</span></div>
      ${items.map((it) => `
        <div class="dbg-item ${esc(it.severity || 'info')}">
          <span class="dbg-sev"></span>
          <div class="dbg-body">
            <div class="dbg-name">${esc(it.title || '')}</div>
            <div class="dbg-hint">${esc(it.hint || '')}</div>
            ${it.detail ? `<div class="dbg-detail">${esc(it.detail)}</div>` : ''}
          </div>
          ${it.fix ? `<button class="dbg-fix" data-code="${esc(it.code)}">Fix</button>` : ''}
          <button class="dbg-help" data-code="${esc(it.code)}" title="Open Guide">Help</button>
        </div>`).join('')}
    </div>`;
  }).join('');

  list.querySelectorAll('.dbg-fix').forEach((b) => {
    b.addEventListener('click', () => {
      const issue = issues.find((x) => x.code === b.dataset.code);
      if (issue) fixIssue(issue);
    });
  });
  list.querySelectorAll('.dbg-help').forEach((b) => {
    b.addEventListener('click', () => {
      const issue = issues.find((x) => x.code === b.dataset.code);
      if (issue) openManualForIssue(issue, 'clicked');
    });
  });

  updateCatBadges();
}

/** :  */
function updateCatBadges() {
  const issues = (autodebugLast && autodebugLast.issues) || [];
  document.querySelectorAll('#setNav .set-nav-badge').forEach((el) => {
    const cat = el.dataset.badge;
    // checksettings, settings"diagnoserepair"
    const n = cat === 'diag' ? issues.filter((i) => i.severity === 'error').length : 0;
    el.hidden = n === 0;
    el.textContent = n ? String(n) : '';
    el.classList.toggle('warn', false);
  });
}

function bindAutodebug() {
  const btn = $('btnAutodebugRun');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = 'Checking...';
      try {
        const r = await api.autodebugRun().catch(() => null);
        if (r) renderAutodebug(r);
        else toast({ title: 'Check Failed', body: 'Error collecting status, please try again', type: 'error' });
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    });
  }

  const report = $('btnAutodebugReport');
  if (report) {
    report.addEventListener('click', async () => {
      const r = await api.doctorReport().catch(() => null);
      if (r && r.ok !== false) toast({ title: 'Diagnostics report exported', body: 'Saved to disk', type: 'ok' });
      else toast({ title: 'Export failed', body: (r && r.error) || 'Please retry', type: 'error' });
    });
  }

  const auto = $('setAutodebugAuto');
  if (auto) {
    auto.addEventListener('change', async () => {
      const r = await api.autodebugConfig({ auto: auto.checked }).catch(() => null);
      if (r) fillAutodebugSettings(r);
      toast({
        title: auto.checked ? 'Auto-diagnostics enabled' : 'Auto-diagnostics disabled',
        body: auto.checked ? 'Periodic background check enabled; notifies on new issues' : 'You can run a manual check anytime',
        type: 'info',
      });
    });
  }

  const interval = $('setAutodebugInterval');
  if (interval) {
    interval.addEventListener('change', async () => {
      const r = await api.autodebugConfig({ intervalMin: Number(interval.value) }).catch(() => null);
      if (r) fillAutodebugSettings(r);
      toast({ title: 'Interval updated', body: `Checking every ${r ? r.intervalMin : interval.value} minutes`, type: 'ok' });
    });
  }

  const notify = $('setAutodebugNotify');
  if (notify) {
    notify.addEventListener('change', async () => {
      const r = await api.autodebugConfig({ notify: notify.checked }).catch(() => null);
      if (r) fillAutodebugSettings(r);
    });
  }
}

function fillAutodebugSettings(cfg) {
  if (!cfg) return;
  const auto = $('setAutodebugAuto');
  if (auto) auto.checked = cfg.auto !== false;
  const interval = $('setAutodebugInterval');
  if (interval) interval.value = String(cfg.intervalMin || 10);
  const notify = $('setAutodebugNotify');
  if (notify) notify.checked = cfg.notify !== false;
}

async function openSettings() {
  state.settings = await api.getSettings();
  fillSettings(state.settings);
  fillAutodebugSettings((state.settings && state.settings.debug) || {});
  const info = await api.info();
  $('setRuntimeDir').value = info.runtimeDir || info.dataDir;
  if ($('setAvdDir')) {
    const di = await api.dataInfo().catch(() => null);
    $('setAvdDir').value = (di && di.avdDir) || '';
  }
  const verEl = document.getElementById('aboutVer');
  if (verEl && info.version) verEl.textContent = `v${info.version}`;
  const curVerEl = document.getElementById('updateCurrent');
  if (curVerEl && info.version) curVerEl.textContent = `v${info.version}`;
  const assoc = await api.assocStatus();
  const btn = $('btnAssoc');
  btn.textContent = assoc.registered ? 'Associated  -  Click to Unlink' : 'Not Associated  -  Click to Enable';
  btn.dataset.on = assoc.registered ? '1' : '0';

  api.doctorProfile().then((r) => {
    if (r && r.text) $('autoProfileText').textContent = r.text;
  }).catch(() => { $('autoProfileText').textContent = 'Automatic Mode'; });
  api.runtimeUsage().then((u) => {
    $('usageText').textContent = u
      ? `Total: ${u.totalText}${u.reclaimable ? `  -  Reclaimable: ${u.reclaimableText} (${u.count} items)` : '  -  Clean'}`
      : 'Usage stats unavailable';
  }).catch(() => { $('usageText').textContent = 'Usage stats unavailable'; });

  $('settingsMask').classList.add('on');
  refreshAndroid();
  refreshDataInfo();
  applySettingsFilter();
  // check(), 
  api.autodebugState().then((r) => { if (r) renderAutodebug(r); }).catch(() => {});
}

function closeSettings() {
  $('settingsMask').classList.remove('on');
}

/* ---------------- update ---------------- */

let lastUpdate = null;

/** settings(launch) */
function renderUpdate(info) {
  lastUpdate = info || null;
  const cur = $('updateCurrent');
  const st = $('updateState');
  const btn = $('btnDoUpdate');
  const bar = $('updateBar');
  if (!cur || !st || !btn) return;
  if (!info) return;
  if (info.current) cur.textContent = `v${info.current}`;

  if (info.ok === false) {
    st.textContent = `Check failed: ${info.error || 'Network unavailable'}`;
    // failure: , download. 
    // "", "update". 
    showUpdateBtn(true);
    btn.textContent = 'Open Releases';
    btn.dataset.mode = 'manual';
    lastUpdate = { htmlUrl: info.htmlUrl || '' };
    if (bar) bar.hidden = true;
    return;
  }
  if (info.hasUpdate) {
    // version,  --
    // "update", log. 
    const src = (info.sources || []).map((x) => `${x.name} ${x.tag || ''}`.trim()).join(' / ');
    const bad = (info.unreachable || []).map((x) => x.name).join(', ');
    const stale = info.stale ? ' (offline cache, may not be latest)' : '';
    st.textContent = `New version found: ${info.tag}${src ? ` (${src})` : ''}${bad ? `; unreachable: ${bad}` : ''}${stale}`;
    showUpdateBtn(true);
    btn.textContent = info.asset ? 'Update Now' : 'Open Releases';
    btn.dataset.mode = info.asset ? 'auto' : 'manual';
    const note = $('updateNote');
    if (note && info.notes) {
      const brief = String(info.notes).split('\n').slice(0, 8).join('\n').trim();
      if (brief) note.textContent = `Release notes:\n${brief}`;
    }
    if (bar) bar.hidden = true;
  } else {
    const src = (info.sources || []).map((x) => x.name).join(' / ');
    const stale = info.stale ? ' (offline cache)' : '';
    st.textContent = `Up to date (v${info.current})${src ? `  -  via ${src}` : ''}${stale}`;
    showUpdateBtn(false);
    if (bar) bar.hidden = true;
  }
}

/** .btn display:inline-flex,  hidden ,  display */
function showUpdateBtn(on) {
  const btn = $('btnDoUpdate');
  if (!btn) return;
  btn.hidden = !on;
  btn.style.display = on ? '' : 'none';
}

function renderUpdateProgress(p) {
  if (!p) return;
  const st = $('updateState');
  const bar = $('updateBar');
  const fill = $('updateBarFill');
  if (p.stage === 'error') {
    if (st) st.textContent = `Update failed: ${p.message || ''}`;
    if (bar) bar.hidden = true;
    toast({ title: 'Update failed', body: p.message || '', type: 'error' });
    return;
  }
  if (st) st.textContent = p.message || 'Updating...';
  if (bar && fill) {
    bar.hidden = false;
    fill.style.width = `${Math.max(0, Math.min(100, p.percent || 0))}%`;
  }
}

function bindUpdate() {
  const check = $('btnCheckUpdate');
  const go = $('btnDoUpdate');
  if (!check || !go) return;

  const runCheck = async (silent) => {
    if (!silent) {
      check.disabled = true;
      const old = check.textContent;
      check.textContent = 'Checking...';
      $('updateState').textContent = 'Connecting to GitHub...';
      try {
        const info = await api.updateCheck();
        renderUpdate(info);
        if (info && info.hasUpdate) toast({ title: `New version available: ${info.tag}`, body: 'Click "Update Now" to install', type: 'info' });
        else if (info && info.ok !== false) toast({ title: 'Already up to date', body: `v${info.current}`, type: 'ok' });
      } catch (e) {
        $('updateState').textContent = `Check failed: ${e.message}`;
      } finally {
        check.disabled = false;
        check.textContent = old;
      }
      return;
    }
    const info = await api.updateCheck().catch(() => null);
    if (info) renderUpdate(info);
  };

  check.addEventListener('click', () => runCheck(false));

  go.addEventListener('click', async () => {
    if (go.dataset.mode === 'manual') {
      api.updateOpenRelease(lastUpdate && lastUpdate.htmlUrl);
      return;
    }
    go.disabled = true;
    go.textContent = 'Updating...';
    const r = await api.updateApply().catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) {
      go.disabled = false;
      go.textContent = 'Update Now';
      if (r && r.error && !r.manual) {
        $('updateState').textContent = `Update failed: ${r.error}`;
        toast({ title: 'Update failed', body: r.error, type: 'error' });
      }
    } else {
      $('updateState').textContent = `Downloaded v${r.version}, restarting to apply...`;
    }
  });

  // settings, (, )
  runCheck(true).catch(() => {});
}

function bindSettings() {
  const save = async (patch) => {
    state.settings = await api.setSettings(patch);
  };

  if ($('btnPreflight')) $('btnPreflight').addEventListener('click', () => runPreflight());
  if ($('btnPreflightApply')) {
    $('btnPreflightApply').addEventListener('click', async () => {
      const btn = $('btnPreflightApply');
      btn.disabled = true;
      const r = await api.preflightApply().catch(() => null);
      btn.disabled = false;
      if (!r || !r.ok) {
        toast({ type: 'error', title: 'Failed to apply', body: (r && r.error) || 'Please try again later' });
        return;
      }
      state.settings = r.settings;
      toast({
        type: 'ok',
        title: 'Configured for this PC',
        body: `RAM: ${Math.round((r.recommended.memoryMB || 0) / 1024)} GB / ${r.recommended.cores} cores / ${r.recommended.renderSize}`
          + (r.driverFile ? '; driver generated, will apply on next launch' : ''),
      });
      if (r.driverError) toast({ type: 'warn', title: 'Driver save failed', body: r.driverError });
      fillSettings(r.settings);
      refreshStatus();
    });
  }
  if ($('btnDrvReload')) $('btnDrvReload').addEventListener('click', () => refreshDrivers());
  if ($('btnDrvFolder')) {
    $('btnDrvFolder').addEventListener('click', async () => {
      const r = await api.driversOpenFolder().catch(() => null);
      if (!r || !r.ok) toast({ type: 'error', title: 'Cannot open driver directory' });
    });
  }
  if ($('btnDrvImport')) {
    $('btnDrvImport').addEventListener('click', async () => {
      const r = await api.driversImport().catch(() => null);
      if (!r || r.canceled) return;
      if (!r.ok) {
        toast({ type: 'error', title: 'Import failed', body: (r.errors || []).slice(0, 3).join('; ') });
        return;
      }
      toast({ type: 'ok', title: 'Driver imported and enabled', body: `${r.driver.name} v${r.driver.version}` });
      if (r.overview) renderDrivers(r.overview);
    });
  }
  if ($('btnDrvExport')) {
    $('btnDrvExport').addEventListener('click', async () => {
      const r = await api.driversExportTemplate().catch(() => null);
      if (!r || r.canceled) return;
      if (!r.ok) { toast({ type: 'error', title: 'Export failed' }); return; }
      toast({ type: 'ok', title: 'Template exported', body: 'Edit effect in driver folder and refresh to apply' });
      refreshDrivers();
    });
  }

  $('setAdbPath').addEventListener('change', (e) => save({ adbPath: e.target.value.trim() }));
  $('setSystemImage').addEventListener('change', (e) => save({ runtime: { isoPath: e.target.value.trim() } }));
  // memory / : "",  0 . 
  // memoryMB,  overridesFromSettings autoMemory=false , 
  // "memory"ignore -- settings"". 
  $('setMemory').addEventListener('change', (e) => {
    const v = Number(e.target.value) || 0;
    save(v > 0 ? { engine: { memoryMB: v, autoMemory: false } } : { engine: { memoryMB: 0, autoMemory: true } });
  });
  $('setCores').addEventListener('change', (e) => {
    const v = Number(e.target.value) || 0;
    save(v > 0 ? { engine: { cores: v, autoMemory: false } } : { engine: { cores: 0, autoMemory: true } });
  });
  if ($('setResourceMode')) {
    $('setResourceMode').addEventListener('change', async (e) => {
      // liteMode / priorityMode / renderSize()
      state.settings = await api.setSettings({ engine: { resourceMode: e.target.value } });
      fillSettings(state.settings);
      toast({ title: 'Resource policy updated', body: 'Takes effect on next launch', type: 'ok' });
    });
  }
  if ($('setRenderSize')) {
    $('setRenderSize').addEventListener('change', (e) => save({ engine: { renderSize: e.target.value } }));
  }
  if ($('setFastDns')) {
    $('setFastDns').addEventListener('change', (e) => save({ engine: { fastDns: e.target.checked } }));
  }
  if ($('setLocale')) {
    $('setLocale').addEventListener('change', async (e) => {
      state.settings = await api.setSettings({ engine: { locale: e.target.value } });
      toast({ title: 'System language updated', body: 'Takes effect on next runtime restart', type: 'ok' });
    });
  }
  if ($('setChineseIme')) {
    $('setChineseIme').addEventListener('change', async (e) => {
      state.settings = await api.setSettings({ engine: { chineseIme: e.target.checked } });
      toast({
        title: e.target.checked ? 'Chinese IME Enabled' : 'Chinese IME Disabled',
        body: 'Takes effect after restarting Android runtime',
        type: 'ok',
      });
    });
  }
  if ($('setKeepSnapshot')) {
    $('setKeepSnapshot').addEventListener('change', (e) => save({ engine: { keepSnapshot: e.target.checked } }));
  }
  if ($('setDataGB')) {
    $('setDataGB').addEventListener('change', (e) => {
      save({ engine: { dataPartitionGB: Number(e.target.value) || 0 } });
      refreshDataInfo();
    });
  }
  if ($('btnGrowData')) {
    $('btnGrowData').addEventListener('click', async () => {
      const gb = Number($('setDataGB').value) || 0;
      if (!gb) { toast({ title: 'Select a partition size', body: 'Auto mode determines size by free disk space', type: 'info' }); return; }
      const { response } = await api.confirm({
        title: 'Expand Android Data Partition Now?',
        message: `Will expand /data to ${gb} GB (in-place, preserving apps and data).`, 
        detail: 'Active apps will close. Next launch will take ~15 seconds to apply expansion.', 
        okLabel: 'Expand Now',
      });
      if (response !== 1) return;
      $('btnGrowData').disabled = true;
      const old = $('btnGrowData').textContent;
      $('btnGrowData').textContent = 'Expanding...';
      const r = await api.setDataSize(gb).catch((e) => ({ ok: false, error: e.message }));
      $('btnGrowData').disabled = false;
      $('btnGrowData').textContent = old;
      if (r && !r.ok && r.needsReset) {
        // launch: , capacity /data. 
        // , . 
        const again = await api.confirm({
          title: 'Reset Required to Expand Partition',
          message: `Android is using an overlay disk. Expanding to ${gb} GB requires resetting /data.`, 
          detail: 'This will erase installed apps and saved data. System images are preserved. Continue?', 
          okLabel: 'Erase & Rebuild',
        });
        if (again.response !== 1) { refreshDataInfo(); return; }
        $('btnGrowData').disabled = true;
        $('btnGrowData').textContent = 'Rebuilding...';
        const rr = await api.resetAndResize(gb).catch((e) => ({ ok: false, error: e.message }));
        $('btnGrowData').disabled = false;
        $('btnGrowData').textContent = old;
        toast({
          type: rr && rr.ok ? 'ok' : 'error',
          title: rr && rr.ok ? 'Rebuilt at new capacity' : 'Rebuild failed',
          body: rr && rr.ok
            ? `Will rebuild /data at ${gb} GB on next launch (~30s wait)`
            : (rr && rr.error) || 'Unknown error',
        });
        refreshDataInfo();
        return;
      }
      toast({
        type: r && r.ok ? 'ok' : 'error',
        title: r && r.ok ? 'Partition expanded' : 'Expansion failed',
        body: r && r.ok ? `Now ~${r.fsGB || r.imageGB || gb} GB available` : (r && r.error) || 'Unknown error',
      });
      refreshDataInfo();
    });
  }
  $('setIdle').addEventListener('change', (e) => save({ engine: { idleShutdownMinutes: Number(e.target.value) || 0 } }));
  if ($('setSourcePref')) {
    $('setSourcePref').addEventListener('change', (e) => save({ runtime: { sourcePreference: e.target.value } }));
  }
  if ($('setAutoMirror')) {
    $('setAutoMirror').addEventListener('change', (e) => save({ runtime: { autoMirror: e.target.checked } }));
  }
  if ($('setGiteeToken')) {
    $('setGiteeToken').addEventListener('change', (e) => save({ runtime: { giteeToken: e.target.value.trim() } }));
  }
  if ($('setMirrorPrefix')) {
    $('setMirrorPrefix').addEventListener('change', (e) => save({ runtime: { mirrorPrefix: e.target.value.trim() } }));
  }
  if ($('setConnections')) {
    $('setConnections').addEventListener('change', (e) => {
      const n = Math.max(1, Math.min(16, Number(e.target.value) || 8));
      e.target.value = n;
      save({ runtime: { downloadConnections: n } });
    });
  }
  $('setAudio').addEventListener('change', (e) => save({ engine: { audio: e.target.checked } }));
  $('setLiteMode').addEventListener('change', (e) => save({ engine: { liteMode: e.target.checked } }));
  $('setPrewarm').addEventListener('change', (e) => save({ engine: { prewarm: e.target.checked } }));
  $('setPriorityMode').addEventListener('change', (e) => save({ engine: { priorityMode: e.target.value } }));
  const savePointer = async (patch) => {
    await save({ engine: patch });
    // window/uninstallhook, window
    api.refreshPointerMapping().catch(() => {});
  };
  $('setMouseRightBack').addEventListener('change', (e) => savePointer({ mouseRightBack: e.target.checked }));
  $('setMouseWheelMode').addEventListener('change', (e) => savePointer({ mouseWheelMode: e.target.value }));
  $('setMouseSideButtons').addEventListener('change', (e) => savePointer({ mouseSideButtons: e.target.checked }));
  if ($('setKeymapEnabled')) {
    $('setKeymapEnabled').addEventListener('change', async (e) => {
      await api.keymap.setEnabled(e.target.checked);
      toast({ title: e.target.checked ? 'Keyboard mapping enabled' : 'Keyboard mapping disabled', type: 'ok' });
    });
  }
  // : . hintapp(apppath). 
  if ($('setMultiWindow')) {
    $('setMultiWindow').addEventListener('change', (e) => {
      save({ engine: { multiWindow: e.target.checked } });
      toast({
        title: e.target.checked ? 'Multi-window enabled (experimental)' : 'Single window mode restored',
        body: e.target.checked ? 'Takes effect on next launch: multiple apps can run simultaneously.' : '', 
        type: 'ok',
      });
    });
  }
  if ($('setKeepBackground')) {
    $('setKeepBackground').addEventListener('change', (e) => {
      save({ engine: { keepBackground: Number(e.target.value) } });
    });
  }
  $('setDeepTrim').addEventListener('change', async (e) => {
    await save({ engine: { deepTrim: e.target.checked } });
    // pm disable-user , 
    if (!e.target.checked) {
      api.restoreSystemApps().catch(() => {});
      toast({ title: 'System components restored', body: 'Deep trim disabled, background packages restored', type: 'info' });
    }
  });
  $('setCompat').addEventListener('change', async (e) => {
    const on = e.target.checked;
    await save({ runtime: { compatImage: on } });
    const env = ((state.status = await api.runtimeStatus()).env) || {};
    const ok = env.playImage && env.playImage.ok;
    $('compatInstallField').hidden = !on || !!ok;
    if (on && !ok) toast({ title: 'ARM compatibility enabled', body: 'Google Play compatible image (Android 14, ~1.5 GB) required', type: 'info' });
    else if (on) toast({ title: 'ARM compatibility enabled', body: 'Takes effect after runtime restart', type: 'info' });
  });
  $('setAutoShortcut').addEventListener('change', (e) => save({ createShortcutOnInstall: e.target.checked }));
  $('setStartMenuShortcut').addEventListener('change', (e) => save({ createStartMenuShortcut: e.target.checked }));
  $('setShortcutDir').addEventListener('change', (e) => save({ shortcutDir: e.target.value.trim() }));
  $('setDeviceSharedDir').addEventListener('change', (e) => save({ deviceSharedDir: e.target.value.trim() }));
  $('setAutoStart').addEventListener('change', (e) => save({ autoStart: e.target.checked }));
  $('setDisplayMode').addEventListener('change', async (e) => {
    const mode = e.target.value;
    $('portraitField').hidden = mode === 'fullscreen';
    state.settings = await api.setSettings({ display: { mode } });
    toast({ title: mode === 'fullscreen' ? 'Fullscreen enabled' : 'Windowed mode enabled', type: 'ok' });
  });
  if ($('setAutoFullscreen')) {
    $('setAutoFullscreen').addEventListener('change', async (e) => {
      const on = e.target.value === 'on';
      state.settings = await api.setSettings({ display: { autoFullscreenOnLaunch: on } });
      toast({ title: on ? 'Auto-fullscreen enabled' : 'Auto-fullscreen disabled', body: 'Takes effect on next launch', type: 'ok' });
    });
  }
  if ($('setOrientationMode')) {
    $('setOrientationMode').addEventListener('change', async (e) => {
      const mode = e.target.value;
      state.settings = await api.setSettings({ display: { orientationMode: mode } });
      toast({
        title: mode === 'auto' ? 'Orientation: Follow App' : (mode === 'landscape' ? 'Orientation: Force Landscape' : 'Orientation: Force Portrait'),
        body: mode === 'auto'
          ? 'Orientation will match app preferences. Incompatible orientations restart runtime automatically.'
          : 'Runtime will restart once to lock orientation to target.',
        type: 'ok',
      });
    });
  }
  if ($('setAutoRotate')) {
    $('setAutoRotate').addEventListener('change', async (e) => {
      const on = e.target.value === 'on';
      state.settings = await api.setSettings({ display: { autoRotate: on } });
      toast({
        title: on ? 'Auto-rotation enabled' : 'Auto-rotation disabled',
        body: 'Saved to Android image. Display orientation is governed by display policy.',
        type: 'ok',
      });
    });
  }
  if ($('setTabletMode')) {
    $('setTabletMode').addEventListener('change', async (e) => {
      const on = e.target.value === 'on';
      state.settings = await api.setSettings({ display: { tabletMode: on } });
      toast({
        title: on ? 'Tablet mode enabled' : 'Tablet mode disabled',
        body: 'Takes effect on next launch (restarts runtime to adjust density).',
        type: 'ok',
      });
    });
  }
  if ($('setLandscape')) {
    $('setLandscape').addEventListener('change', async (e) => {
      const landscape = e.target.value === 'landscape';
      state.settings = await api.setSettings({ display: { landscape } });
      toast({
        title: landscape ? 'Panel set to landscape' : 'Panel set to portrait',
        body: 'Next launch will restart runtime to switch physical panel orientation.',
        type: 'ok',
      });
    });
  }
  $('setPortrait').addEventListener('change', async (e) => {
    state.settings = await api.setSettings({ display: { portrait: e.target.value } });
    toast({ title: 'Resolution updated', body: 'Takes effect on next launch', type: 'ok' });
  });
  $('setWindowEmbed').addEventListener('change', async (e) => {
    const embed = e.target.value === 'embed';
    // windowEmbedChosen "": upgradedefault. 
    state.settings = await api.setSettings({
      display: { windowEmbed: embed, windowEmbedChosen: true },
    });
    toast({
      title: embed ? 'Embedded mode enabled' : 'Native window mode enabled',
      body: embed
        ? 'Takes effect on next launch. Embedded mode offers unified window controls.'
        : 'Takes effect on next launch. Native window mode provides smooth rendering.',
      type: 'ok',
    });
  });
  $('btnRebuildShortcuts').addEventListener('click', async () => {
    const r = await api.rebuildShortcuts();
    toast({
      title: r && r.fixed && r.fixed.length ? 'Shortcuts rebuilt' : 'Shortcuts verified',
      body: r && r.fixed && r.fixed.length ? r.fixed.join(', ') : 'Desktop and Start Menu shortcuts are healthy',
      type: 'ok',
    });
  });

  $('btnDiagnostics').addEventListener('click', async () => {
    try {
      const r = await api.doctorReport();
      toast({ title: 'Diagnostic report exported', body: `${r.diagnosis.title}  -  ${r.file}`, type: 'ok', sticky: true });
    } catch (e) {
      toast({ title: 'Export failed', body: e.message, type: 'error' });
    }
  });

  $('btnCleanup').addEventListener('click', async () => {
    const btn = $('btnCleanup');
    const includeSnapshots = $('chkCleanSnapshots') && $('chkCleanSnapshots').checked;
    btn.disabled = true;
    try {
      const preview = await api.runtimeCleanup({ apply: false, includeSnapshots });
      if (!preview.candidates.length) {
        toast({ title: 'Already clean', body: 'No obsolete images or snapshots to remove.', type: 'ok' });
        return;
      }
      const r = await api.runtimeCleanup({ apply: true, includeSnapshots });
      if (r.cancelled) return;
      toast({
        title: 'Cleanup Complete',
        body: `Freed ~${(r.saved / 1048576).toFixed(0)} MB (${r.removed.length} items), installed apps are preserved.`,
        type: 'ok',
      });
      const u = await api.runtimeUsage();
      $('usageText').textContent = `Total: ${u.totalText}  -  Reclaimable: ${u.reclaimableText} (${u.count} items)`;
    } catch (e) {
      toast({ title: 'Cleanup failed', body: e.message, type: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  // Android: (, ), 
  $('btnResetData').addEventListener('click', async () => {
    const btn = $('btnResetData');
    btn.disabled = true;
    try {
      const first = await api.confirm({
        type: 'warning',
        title: 'Reset Android Data?',
        message: 'This will reset the Android system to a clean state:',
        detail: '• Delete all installed apps and user data\n'
          + '• Delete current fast-boot snapshot\n'
          + '• System image is preserved; launching apps will recreate data cleanly\n\n'
          + 'This action cannot be undone. Continue?',
        buttons: ['Cancel', 'Continue'],
        defaultId: 0,
        cancelId: 0,
      });
      if (!first || first.response !== 1) return;
      const second = await api.confirm({
        type: 'warning',
        title: 'Confirm Reset',
        message: 'All installed apps and local data will be permanently deleted. Confirm?',
        detail: 'System images, other AVDs, and cached APK files are safely preserved.',
        buttons: ['Cancel', 'Confirm Reset'],
        defaultId: 0,
        cancelId: 0,
      });
      if (!second || second.response !== 1) return;
      const r = await api.runtimeResetData();
      if (!r || !r.ok) {
        toast({ title: 'Reset Failed', body: (r && r.error) || 'Please retry', type: 'error' });
        return;
      }
      toast({
        title: 'Android Data Reset',
        body: `Freed ~${r.reclaimedMB} MB, installed app records cleared.`,
        type: 'ok',
      });
      const u = await api.runtimeUsage();
      $('usageText').textContent = `Total: ${u.totalText}  -  Reclaimable: ${u.reclaimableText} (${u.count} items)`;
    } catch (e) {
      toast({ title: 'Reset Failed', body: e.message, type: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  // repairnetwork: Androidblack screen(""). 
  // /data Wi-Fi configuration, wlan0 , default. 
  // Play Store system image root,  /data; app, . 
  $('btnRepairNetwork').addEventListener('click', async () => {
    const btn = $('btnRepairNetwork');
    btn.disabled = true;
    try {
      const ok = await api.confirm({
        type: 'warning',
        title: 'Repair Virtual Machine Network?',
        message: 'Network-dependent pages failing to load is usually caused by VM network issues.',
        detail: 'Repair will attempt progressive recovery steps:\n\n'
          + '1. Cold-boot VM (bypass snapshot) and wait for network - preserves all data\n'
          + '2. Reset Android data if issue persists - app list preserved and auto-reinstalled\n'
          + '   (local app states will be reset)\n\n'
          + 'Affects current AVD only. Process takes ~1-5 minutes. Continue?',
        buttons: ['Cancel', 'Start Repair'],
        defaultId: 0,
        cancelId: 0,
      });
      if (!ok || ok.response !== 1) return;
      const r = await api.runtimeRepairNetwork();
      if (!r || !r.ok) {
        toast({
          title: 'Network Not Restored',
          body: (r && r.error) || 'Network not restored after reset. Check host firewall and proxy settings.',
          type: 'error',
        });
        return;
      }
      toast({
        title: 'Network Restored',
        body: `${(r.network && r.network.ip) || 'Connected'}${r.wiped ? ' (data reset for repair; clicking apps will reinstall)' : ' (user data preserved)'}`,
        type: 'ok',
      });
    } catch (e) {
      toast({ title: 'Repair failed', body: e.message, type: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  // cleanversion: directory / uninstall / updatetemporary, . 
  $('btnLeftovers').addEventListener('click', async () => {
    const btn = $('btnLeftovers');
    btn.disabled = true;
    try {
      const r = await api.leftoversScan();
      if (!r || !r.ok) {
        toast({ title: 'Scan failed', body: (r && r.error) || 'Please retry', type: 'error' });
        return;
      }
      const items = r.items || [];
      if (!items.length) {
        toast({ title: 'Clean', body: 'No leftover files from previous versions found.', type: 'ok' });
        return;
      }
      const mb = Math.round((r.totalBytes || 0) / 1048576);
      const lines = items.slice(0, 8).map((x) => `• ${x.note}: ${x.path}`);
      if (items.length > 8) lines.push(`...and ${items.length - 8} more item(s)`);
      const ok = await api.confirm({
        type: 'warning',
        title: 'Clean Old Version Residue?',
        message: `Found ${items.length} leftover items (~${mb} MB):`,
        detail: `${lines.join('\n')}\n\nDeletes only legacy program directories, dead uninstall entries, and temp files.`
          + 'Current app version and your user data will not be touched.',
        buttons: ['Cancel', 'Start Cleanup'],
        defaultId: 1,
        cancelId: 0,
      });
      if (!ok || ok.response !== 1) return;
      const c = await api.leftoversClean(items);
      if (!c || !c.ok) {
        toast({ title: 'Cleanup failed', body: (c && c.error) || 'Please retry', type: 'error' });
        return;
      }
      const failNote = (c.failed && c.failed.length) ? `, ${c.failed.length} item(s) in use and skipped` : '';
      toast({
        title: 'Cleaned Version Residue',
        body: `Removed ${c.removed.length} items, freed ${c.freedMB || 0} MB${failNote}.`,
        type: 'ok',
      });
      const u = await api.runtimeUsage();
      $('usageText').textContent = `Total: ${u.totalText}  -  Reclaimable: ${u.reclaimableText} (${u.count} items)`;
    } catch (e) {
      toast({ title: 'Cleanup failed', body: e.message, type: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  $('btnOpenShared').addEventListener('click', () => api.openSharedDir());

  // shortcut: desktop / fallback
  $('btnRebuildShortcuts').addEventListener('click', async () => {
    const btn = $('btnRebuildShortcuts');
    btn.disabled = true;
    try {
      const r = await api.rebuildShortcuts().catch(() => ({ ok: false }));
      const fixed = (r && r.fixed) || [];
      toast(fixed.length
        ? { title: 'Shortcuts rebuilt', body: fixed.join(', '), type: 'ok' }
        : { title: 'Shortcuts intact', body: 'No missing shortcuts found', type: 'info' });
    } finally {
      btn.disabled = false;
    }
  });

  // directory: directory, ""directory
  $('btnBrowseShared').addEventListener('click', async () => {
    const picked = await api.openDir();
    if (!picked) return;
    $('setSharedDir').value = picked;
    toast({ title: 'New directory selected', body: 'Click "Save & Migrate" to transfer existing files', type: 'info' });
  });
  $('btnSaveShared').addEventListener('click', async () => {
    const dir = $('setSharedDir').value.trim();
    if (!dir) { toast({ title: 'Please select or enter a directory first', type: 'error' }); return; }
    const btn = $('btnSaveShared');
    btn.disabled = true;
    const r = await api.setSharedDir(dir).catch(() => ({ ok: false }));
    btn.disabled = false;
    if (r.ok) {
      const moved = r.oldDir && r.oldDir !== r.newDir;
      toast({ title: 'Shared folder updated', body: moved ? 'Existing files migrated to new directory' : 'Saved', type: 'ok' });
    } else {
      toast({ title: 'Save failed', body: r.error, type: 'error' });
    }
  });

  // uninstall ApkStart ( .apk + launchuninstall; portable version)
  $('btnUninstall').addEventListener('click', async () => {
    const ok = window.confirm('Are you sure you want to uninstall ApkBolt?\n\nThis will remove file associations and app data. Continue?');
    if (!ok) return;
    const btn = $('btnUninstall');
    btn.disabled = true;
    const r = await api.removeSelf().catch(() => ({ ok: false }));
    if (r.ok && r.portable) {
      btn.disabled = false;
      toast({
        title: 'Portable edition cannot auto-uninstall',
        body: `Please delete program directory (${r.exeDir}) and data directory (${r.dataDir})`,
        type: 'info', sticky: true,
      });
      return;
    }
    if (!r.ok) {
      btn.disabled = false;
      toast({ title: 'Uninstall failed', body: r.error, type: 'error' });
      return;
    }
    toast({ title: 'Uninstalling...', body: 'Uninstaller launched. ApkBolt will now exit.', type: 'ok', sticky: true });
  });

  // ARM system imagedownload( toast)
  $('btnInstallPlay').addEventListener('click', async () => {
    const btn = $('btnInstallPlay');
    btn.disabled = true;
    const t = toast({ title: 'Downloading ARM Compatibility Image', body: 'Preparing...', sticky: true, spinner: true, progress: 3 });
    const un = api.on('provision:progress', (p) => {
      if (p.component !== 'playimg') return;
      t.update({ title: 'Downloading ARM Image', body: p.message || '', progress: p.percent });
    });
    try {
      const r = await api.installPlayImage();
      if (r && r.ok) {
        t.update({ title: 'ARM Compatibility Image Ready', body: 'Takes effect after runtime restart', progress: 100 });
        setTimeout(() => t.dismiss(), 3000);
        $('compatInstallField').hidden = true;
        refreshStatus();
      } else {
        t.update({ title: 'Download Failed', body: (r && r.error) || 'Unknown error', progress: null });
        t.dismiss();
        toast({ title: 'Download Failed', body: (r && r.error) || 'Unknown error', type: 'error' });
      }
    } catch (e) {
      t.dismiss();
      toast({ title: 'Download Failed', body: e.message, type: 'error' });
    } finally {
      un();
      btn.disabled = false;
    }
  });

  // system image
  (async () => {
    const env = ((state.status = await api.runtimeStatus()).env) || {};
    const s = state.settings;
    const on = !!(s && s.runtime && s.runtime.compatImage);
    const ok = env.playImage && env.playImage.ok;
    $('compatInstallField').hidden = !on || !!ok;
    if (env.playImage) {
      $('compatImgStatus').textContent = ok
        ? `Ready (${(env.playImage.size / 1073741824).toFixed(2)} GB)` : 'Not downloaded';
    }
  })();
  $('btnOpenData').addEventListener('click', async () => {
    const info = await api.info();
    const dir = info.runtimeDir || info.dataDir;
    window.open(`file:///${dir.replace(/\\/g, '/')}`);
  });
  $('btnBrowseRuntimeDir').addEventListener('click', async () => {
    const info = await api.info();
    const picked = await api.openDir();
    if (!picked) return;
    await api.setSettings({ runtime: { dir: picked } });
    $('setRuntimeDir').value = picked;
    toast({ title: 'Data Directory Updated', body: 'Please restart ApkBolt for changes to take effect', type: 'ok', sticky: true });
  });

  // Androiddirectory(AVD + snapshot): , 
  if ($('btnBrowseAvdDir')) {
    $('btnBrowseAvdDir').addEventListener('click', async () => {
      const picked = await api.openDir();
      if (!picked) return;
      await api.setSettings({ runtime: { avdDir: picked } });
      $('setAvdDir').value = picked;
      toast({
        title: 'Android Data Directory Updated',
        body: 'Please restart ApkBolt for changes to take effect.',
        type: 'ok',
        sticky: true,
      });
    });
  }
  if ($('btnOpenAvdDir')) {
    $('btnOpenAvdDir').addEventListener('click', async () => {
      const info = await api.dataInfo().catch(() => null);
      const dir = (info && info.avdDir) || (await api.info()).dataDir;
      window.open(`file:///${String(dir).replace(/\\/g, '/')}`);
    });
  }

  $('btnRuntimeStart').addEventListener('click', async () => {
    const el = $('probeResult');
    el.textContent = 'Starting...';
    const r = await api.runtimeStart();
    el.textContent = r.ok ? `Ready: ${r.engine}` : `Launch failed: ${r.error}`;
    refreshStatus();
  });

  $('btnRuntimeStop').addEventListener('click', async () => {
    await api.runtimeStop();
    $('probeResult').textContent = 'Engine stopped';
    refreshStatus();
  });

  $('btnAssoc').addEventListener('click', async () => {
    const btn = $('btnAssoc');
    if (btn.dataset.on === '1') {
      await api.assocUnregister();
      btn.textContent = 'Not associated  -  Click to register';
      btn.dataset.on = '0';
      toast({ title: '.apk file association removed' });
    } else {
      const r = await api.assocRegister();
      btn.textContent = 'Associated  -  Click to unregister';
      btn.dataset.on = '1';
      toast({ title: '.apk association enabled', body: r.ok ? 'Double-clicking any APK will now open ApkBolt' : '', type: r.ok ? 'ok' : 'error' });
    }
  });
}

/* ---------------- ---------------- */

function bindEvents() {
  // Note
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="http"]');
    if (!a) return;
    e.preventDefault();
    api.openExternal(a.getAttribute('href'));
  });

  $('btnSettings').addEventListener('click', openSettings);
  $('btnRestartEngine')?.addEventListener('click', async () => {
    toast({ title: 'Restarting Engine...', body: 'Restarting background Android runtime', type: 'info' });
    try {
      const r = await api.runtimeRestart();
      toast({ title: r.ok ? 'Engine Restarted' : 'Restart Failed', body: r.error || '', type: r.ok ? 'ok' : 'error' });
      refreshStatus();
    } catch (e) {
      toast({ title: 'Restart Failed', body: e.message, type: 'error' });
    }
  });
  $('dropHero')?.addEventListener('click', () => api.pickApk().then((files) => files && installFiles(files)));
  $('btnBrowseHero')?.addEventListener('click', (e) => { e.stopPropagation(); api.pickApk().then((files) => files && installFiles(files)); });
  // 0.6.2: manual"about"
  $('btnManual')?.addEventListener('click', () => openManual({ topic: 'overview', reason: 'toolbar' }));
  $('btnOpenManual')?.addEventListener('click', () => openManual({ topic: 'overview', reason: 'about' }));
  // : " / / Android 14"settingsruntime
  $('engineTag').addEventListener('click', () => showSetup(true));
  $('btnCloseSettings').addEventListener('click', closeSettings);
  $('btnDoneSettings').addEventListener('click', closeSettings);
  $('settingsMask').addEventListener('click', (e) => {
    if (e.target === $('settingsMask')) closeSettings();
  });

  // runtime: settings, 
  $('btnDeployAll').addEventListener('click', deployAll);
  $('btnMarkInstalled').addEventListener('click', markInstalled);
  $('btnGuideClose').addEventListener('click', () => { $('setupGuide').hidden = true; });
  $('btnSetupAdvanced').addEventListener('click', () => {
    const adv = document.querySelector('.advanced-group');
    if (adv) {
      adv.open = true;
      adv.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });

  // : settingsruntime
  $('envChip').addEventListener('click', () => {
    openSettings().then(() => {
      const box = $('envCheck');
      if (box && !box.hidden) focusGroup(box);
      else focusGroup($('runtimeGroup'));
    }).catch(() => {});
  });

  $('setupSteps').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'emulator' || act === 'sysimg' || act === 'accel'
      || act === 'adb' || act === 'qemu' || act === 'iso' || act === 'disk') {
      const r = await runStep(act);
      if (!r.ok) toast({ title: 'Operation failed', body: r.error, type: 'error', sticky: true });
      return;
    }
    if (act === 'isoImport') {
      const r = await api.importIso();
      if (r.ok) { toast({ title: 'System image imported', body: r.path, type: 'ok' }); refreshStatus(); }
      else if (!r.canceled) toast({ title: 'Import failed', body: r.error, type: 'error' });
      return;
    }
    if (act === 'diskImport') {
      const r = await api.importDisk();
      if (r.ok) { toast({ title: 'Virtual disk imported', body: 'Runtime can be launched directly', type: 'ok' }); refreshStatus(); }
      else if (!r.canceled) toast({ title: 'Import failed', body: r.error, type: 'error' });
      return;
    }
    if (act === 'install') { await startInstall(); return; }
    if (act === 'vmStart') {
      const t = toast({ title: 'Starting runtime...', body: 'First boot: initializing Android system', sticky: true, spinner: true });
      const r = await api.runtimeStart();
      if (r.ok) { t.update({ title: 'Runtime ready', type: 'ok' }); setTimeout(t.dismiss, 2200); }
      else t.update({ title: 'Launch Failed', body: r.error, type: 'error' });
      refreshStatus();
      return;
    }
    if (act === 'vmStop') {
      await api.runtimeStop();
      toast({ title: 'Runtime session ended' });
      refreshStatus();
    }
  });

  const pick = async () => {
    const files = await api.pickApk();
    if (files.length) installFiles(files);
  };
  $('btnInstall').addEventListener('click', pick);
  $('btnInstall2').addEventListener('click', pick);
  // directorysettings:  + "sharing"
  const btnSync = $('btnSyncShared');
  if (btnSync) btnSync.addEventListener('click', async () => {
    btnSync.disabled = true;
    try {
      await api.syncShared();
      toast({ title: 'Shared folder synchronized', type: 'ok' });
    } catch (_) {
      toast({ title: 'Sync failed', body: 'Sync skipped: runtime not ready', type: 'error' });
    } finally {
      btnSync.disabled = false;
    }
  });

  $('search').addEventListener('input', (e) => {
    state.filter = e.target.value;
    renderGrid();
  });

  $('grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    // "app" data-pkg, installlaunch. 
    // "install APK", . 
    if (card.classList.contains('card-add')) { $('btnInstall').click(); return; }
    if (card.dataset.pkg) launchApp(card.dataset.pkg);
  });

  $('grid').addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY, card.dataset.pkg);
  });

  $('grid').addEventListener('dblclick', (e) => {
    const card = e.target.closest('.card');
    if (card) createShortcut(card.dataset.pkg);
  });

  $('ctxmenu').addEventListener('click', (e) => {
    const item = e.target.closest('.item');
    if (item) handleMenu(item.dataset.act);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ctxmenu')) hideMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideMenu();
      closeSettings();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('search').focus();
    }
  });

  // install
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    $('dropzone').classList.add('on');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) $('dropzone').classList.remove('on');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('dropzone').classList.remove('on');
    const files = [...(e.dataTransfer?.files || [])];
    const paths = files
      .map((f) => { try { return api.pathForFile(f); } catch (_) { return null; } })
      .filter((p) => p && /\.apk$/i.test(p));
    if (paths.length) installFiles(paths);
    else toast({ title: 'Only .apk files are supported', type: 'error' });
  });

  // Note
  api.on('install:error', (p) => {
    // error"install..."( APK )
    if (installToast) { try { installToast.dismiss(); } catch (_) { /* ignore */ } installToast = null; }
    const name = p && p.file ? String(p.file).split(/[\\/]/).pop() : '';
    const raw = (p && p.message) || 'Unknown error';
    toast({
      title: name ? `Installation failed: ${name}` : 'Installation failed',
      body: friendlyInstallErrorText(raw),
      type: 'error',
    });
    // 0.6.2: installfailure(ARM / signature / space...)
    openManualForError(raw, 'install-failed');
  });
  api.on('toast', (p) => toast({ title: p.message, type: p.type === 'error' ? 'error' : 'info' }));
  api.on('app:launched', () => setTimeout(refreshApps, 800));
  // app("app", , window)""
  api.on('apps:changed', () => setTimeout(refreshApps, 300));
  api.on('runtime:log', (m) => console.log('[runtime]', m));
  api.on('ui:navigate', (v) => {
    if (v === 'settings') openSettings();
    if (v === 'setup') { showSetup(true); refreshStatus(); }
  });
  api.on('provision:progress', (p) => updateStepProgress(p.component, p));
  api.on('update:state', (info) => {
    if (!info) return;
    renderUpdate(info);
    // launch 8 update: , "version"
    const wm = $('welcomeMask');
    if (wm && !wm.hidden) renderWelcomeTips();
  });
  api.on('update:progress', (p) => renderUpdateProgress(p));
  // check: , settings
  api.on('autodebug:state', (r) => {
    if (r && r.running) {
      const txt = $('autodebugStateText');
      if (txt) txt.textContent = 'Checking...';
      return;
    }
    renderAutodebug(r);
  });
}

/* ---------------- launch ---------------- */

async function init() {
  bindEvents();
  bindSettings();
  bindSettingsCategory();
  bindAutodebug();
  bindUpdate();
  bindAndroid();
  bindWelcome();
  state.settings = await api.getSettings();
  await refreshStatus();
  await refreshApps();
  refreshAndroid();
  selfCheck();
  maybeShowWelcome();
  setInterval(refreshStatus, 6000);
  setInterval(refreshApps, 15000);
  setInterval(selfCheck, 60000);
}

/* ---------------- launch ---------------- */

let startupInfo = null;

function greetingOf(h) {
  if (h < 5) return 'Good night';
  if (h < 11) return 'Good morning';
  if (h < 13) return 'Good afternoon';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function bindWelcome() {
  const mask = $('welcomeMask');
  if (!mask) return;
  const close = () => { mask.hidden = true; };
  const never = $('welcomeNever');
  $('welcomeOk').addEventListener('click', () => {
    if (never && never.checked) api.setSettings({ welcome: { disabled: true } }).catch(() => {});
    close();
  });
  $('welcomeSettings').addEventListener('click', () => { close(); openSettings(); });
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !mask.hidden) close(); });
}

/** Welcome dialog disabled on auto-startup for clean SaaS UX */
async function maybeShowWelcome() {
  return;
}

/** hint: launch 8 update, ,  */
function renderWelcomeTips() {
  const box = $('welcomeTips');
  if (!box) return;
  const apps = (state.apps || []).length;
  const tips = [];
  if (lastUpdate && lastUpdate.hasUpdate) {
    tips.push(`New version available: <b>${esc(lastUpdate.tag || '')}</b> - update via Settings → Updates.`);
  }
  if (!apps) {
    tips.push('Drag and drop an APK anywhere to install - desktop shortcuts are created automatically.');
  } else {
    tips.push('Click any app card to launch in a standalone window with rotation and scaling controls.');
  }
  tips.push('Closing an app keeps the Android runtime warm so subsequent launches are instant.');
  box.innerHTML = tips
    .map((t, i) => `<div class="welcome-tip"><i>${i + 1}</i><span>${t}</span></div>`)
    .join('');
}

/* ---------------- ---------------- */

let envBusy = false;

/** doctor:selfCheck: settings,  */
async function selfCheck() {
  if (envBusy) return;
  envBusy = true;
  try {
    const r = await api.selfCheck().catch(() => null);
    if (r) renderEnvCheck(r);
  } catch (_) { /* failure */ }
  finally { envBusy = false; }
}

function renderEnvCheck(r) {
  const box = $('envCheck');
  if (!box) return;
  // ""complete, 
  const needDeploy = !!(state.status && state.status.needsSetup);
  const issues = (r.issues || []).filter((i) => !(needDeploy && i.fix === 'deploy'));

  // : , settings
  const chip = $('envChip');
  if (chip) {
    const errs = issues.filter((i) => i.severity === 'error').length;
    chip.hidden = issues.length === 0;
    chip.textContent = errs ? `${errs} issue(s) to fix` : `${issues.length} notice(s)`;
    chip.className = `status-chip${errs ? ' err' : ''}`;
    chip.title = issues.map((i) => i.title).join('; ');
  }

  if (!issues.length) {
    box.hidden = false;
    box.innerHTML = `
      <div class="env-check-ok">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
        <span>System check passed - no issues affecting runtime were found.</span>
        <span style="flex:1"></span>
        <button class="btn ghost sm" id="btnEnvRecheck">Re-check</button>
      </div>`;
    const re = $('btnEnvRecheck');
    if (re) re.addEventListener('click', selfCheck);
    return;
  }
  const errs = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.length - errs;
  box.hidden = false;
  box.innerHTML = `
    <div class="env-check-head">
      <span class="ec-title">System Check</span>
      ${errs ? `<span class="ec-count">${errs} error(s)</span>` : ''}
      ${warns ? `<span class="ec-count warn">${warns} warning(s)</span>` : ''}
      <span class="ec-spacer"></span>
      <button class="btn ghost sm" id="btnEnvRecheck">Re-check</button>
      <button class="btn primary sm" id="btnEnvFixAll">Fix All</button>
    </div>
    <div class="env-check-list">
      ${issues.map((i) => `
        <div class="env-check-item ${i.severity}">
          <span class="ec-sev"></span>
          <div class="ec-body">
            <div class="ec-name">${esc(i.title)}</div>
            <div class="ec-hint">${esc(i.hint || '')}</div>
          </div>
          ${i.fix ? `<button class="ec-fix" data-code="${esc(i.code)}">Fix</button>` : ''}
          <button class="ec-help" data-code="${esc(i.code)}" title="Open Guide">Guide</button>
        </div>`).join('')}
    </div>`;
  const re = $('btnEnvRecheck');
  if (re) re.addEventListener('click', selfCheck);
  const fixAll = $('btnEnvFixAll');
  if (fixAll) fixAll.addEventListener('click', () => fixAllIssues(issues));
  box.querySelectorAll('.ec-fix').forEach((b) => {
    b.addEventListener('click', () => {
      const issue = issues.find((x) => x.code === b.dataset.code);
      if (issue) fixIssue(issue);
    });
  });
  box.querySelectorAll('.ec-help').forEach((b) => {
    b.addEventListener('click', () => {
      const issue = issues.find((x) => x.code === b.dataset.code);
      if (issue) openManualForIssue(issue, 'clicked');
    });
  });
}

/** repairsuccess: error, guide( 60 ) */
function failFix(issue, ctl, body) {
  const msg = body || 'Please follow manual instructions';
  if (ctl && typeof ctl.update === 'function') ctl.update({ body: msg, type: 'error', sticky: true });
  else toast({ title: 'Repair incomplete', body: msg, type: 'error' });
  openManualForIssue(issue, 'fix-failed');
}

async function fixIssue(issue) {
  switch (issue.fix) {
    case 'vcRedist': {
      const r = await api.installVcRedist().catch(() => ({ ok: false }));
      if (!r.ok && r.reason === 'no-installer') {
        api.openExternal('https://learn.microsoft.com/zh-CN/cpp/windows/latest-supported-vc-redist?view=msvc-170#visual-studio-2015-2017-2019-and-2022');
        toast({ title: 'Built-in installer package not found', body: 'Opened Microsoft official download page - download x64 version', type: 'info' });
        break;
      }
      toast(r.ok
        ? { title: 'Visual C++ Runtime installed', type: 'ok' }
        : { title: 'Installation incomplete', body: r.error || 'Please retry', type: 'error' });
      break;
    }
    case 'virtualization': {
      const t = toast({ title: 'Enabling hardware acceleration...', body: 'Click Yes in the UAC elevation prompt', sticky: true, spinner: true });
      const r = await api.enableVirtualization().catch(() => ({ ok: false }));
      if (r.ok) {
        t.update({ title: 'Hardware Acceleration Enabled', body: r.restartNeeded ? 'Please reboot your PC for optimal performance' : (r.note || ''), type: 'ok' });
        setTimeout(t.dismiss, 3200);
      } else if (r.manual) {
        // (MSIX):  mediumIL, . 
        // failure, " Windows "
        // , . 
        t.dismiss();
        await api.openWindowsFeatures?.().catch(() => null);
        toast({
          title: 'Manual configuration required (one-time)',
          body: r.note || 'Check "Windows Hypervisor Platform" in the opened window, click OK, and reboot.',
          type: 'info',
          sticky: true,
        });
        // , guide, window
        openManualForIssue(issue, 'fix-failed');
      } else if (r.cancelled) {
        t.update({ title: 'Cancelled', body: r.error || 'UAC permission not granted. Settings unchanged.', type: 'info', spinner: false });
        setTimeout(t.dismiss, 4200);
      } else {
        failFix(issue, t, r.error || r.note || 'Failed to enable hardware acceleration. Opened tutorial.');
      }
      break;
    }
    case 'disk': {
      // (space),  confirm
      const r = await api.runtimeCleanup({ apply: true }).catch(() => null);
      if (!r) { toast({ title: 'Cleanup failed', body: 'Please retry', type: 'error' }); break; }
      if (r.cancelled) break;
      toast({ title: 'Cleanup Complete', body: `Freed ~${((r.saved || 0) / 1048576).toFixed(0)} MB`, type: 'ok' });
      break;
    }
    case 'path': {
      toast({ title: 'ASCII directory path recommended', body: 'Change runtime directory in Settings → Integration, then restart ApkBolt.', type: 'info', sticky: true });
      openSettings();
      break;
    }
    case 'deploy': {
      toast({ title: 'Deploying missing runtime components...', type: 'info', sticky: true, spinner: true });
      await deployAll();
      break;
    }
    case 'lock': {
      const r = await api.clearLocks().catch(() => ({ ok: false }));
      toast(r.ok ? { title: 'Residual lock files cleaned', type: 'ok' } : { title: 'Cleanup failed', body: r.error, type: 'error' });
      break;
    }
    // ---- check( debug)repair ----
    case 'restartRuntime': {
      // unauthorized / / self-healing: (cold boot)
      const t = toast({ title: 'Restarting Android runtime...', body: 'Rebooting runtime (~15 seconds)', type: 'info', sticky: true, spinner: true });
      const r = await api.restartRuntime().catch(() => ({ ok: false }));
      if (r && r.ok) {
        t.update({ title: 'Android runtime restarted', body: 'Click Allow in debugging authorization prompt', type: 'ok' });
        setTimeout(t.dismiss, 3000);
      } else {
        failFix(issue, t, (r && r.error) || 'Restart failed. Opened tutorial.');
      }
      break;
    }
    case 'orphans': {
      const r = await api.clearOrphans().catch(() => ({ ok: false }));
      toast(r && r.ok
        ? { title: 'Cleaned orphan emulator processes', type: 'ok' }
        : { title: 'Cleanup failed', body: (r && r.error) || 'Please retry', type: 'error' });
      break;
    }
    case 'snapshots': {
      const r = await api.clearSnapshot().catch(() => ({ ok: false }));
      toast(r && r.ok
        ? { title: 'Fast-boot snapshot invalidated', body: 'Next app launch will perform a clean cold boot', type: 'ok' }
        : { title: 'Failed to invalidate snapshot', body: (r && r.error) || 'Please retry', type: 'error' });
      break;
    }
    case 'dataReset': {
      // : app, , . 
      toast({
        title: 'Android data partition rebuild required',
        body: 'In Settings → Performance, click "Expand Partition Now" and confirm reset.',
        type: 'info',
        sticky: true,
      });
      openSettings().then(() => focusGroup($('perfGroup'))).catch(() => {});
      break;
    }
    case 'orientation': {
      // orientation: landscapelandscape, portraitportrait
      const s = (state.settings && state.settings.display) || {};
      const mode = s.orientationMode || 'auto';
      if (mode === 'auto') {
        toast({ title: 'Currently set to "Follow App"', body: 'Panel orientation adapts to app requests automatically.', type: 'info' });
        break;
      }
      const wantLandscape = mode === 'landscape';
      state.settings = await api.setSettings({ display: { landscape: wantLandscape } });
      fillSettings(state.settings);
      toast({
        title: wantLandscape ? 'Panel switched to landscape' : 'Panel switched to portrait',
        body: 'Takes effect on next launch',
        type: 'ok',
      });
      break;
    }
    case 'shared': {
      toast({ title: 'Check shared folder', body: 'Confirm the shared directory exists and is writable in Settings → Integration.', type: 'info', sticky: true });
      openSettings().then(() => focusGroup(document.querySelector('#settingsBody [data-cat="files"]'))).catch(() => {});
      break;
    }
    // ---- 0.6.2 checkrepair ----
    case 'audio': {
      const t = toast({ title: 'Enabling audio in Android runtime...', body: 'Restarting runtime to re-enable audio', type: 'info', sticky: true, spinner: true });
      const s = await api.setSettings({ engine: { audio: true } }).catch(() => null);
      if (!s) { failFix(issue, t, 'Failed to save audio settings. Opened guide.'); break; }
      state.settings = s;
      fillSettings(s);
      const r = await api.restartRuntime().catch(() => ({ ok: false }));
      if (r && r.ok !== false) {
        t.update({ title: 'Audio enabled', body: 'Runtime restarted; audio should now be active.', type: 'ok' });
        setTimeout(t.dismiss, 3600);
      } else {
        failFix(issue, t, 'Audio setting enabled but runtime failed to restart. Opened guide.');
      }
      break;
    }
    case 'audioService': {
      // MSIX / , guide
      toast({ title: 'Windows Audio service must be started', body: 'Opened instructions', type: 'info', sticky: true });
      openManualForIssue(issue, 'clicked');
      break;
    }
    case 'repairNetwork': {
      const t = toast({ title: 'Resetting Android network...', body: 'Installed app list is preserved', type: 'info', sticky: true, spinner: true });
      const r = await api.runtimeRepairNetwork().catch(() => ({ ok: false }));
      if (r && r.ok !== false) {
        t.update({ title: 'Android network reset', body: 'Will reconnect on next app launch', type: 'ok' });
        setTimeout(t.dismiss, 3000);
      } else {
        t.update({ title: 'Reset Failed', body: (r && r.error) || 'Please retry', type: 'error' });
      }
      break;
    }
    case 'report': {
      const r = await api.doctorReport().catch(() => null);
      toast(r && r.ok !== false
        ? { title: 'Diagnostic report exported', body: 'Report exported to disk', type: 'ok' }
        : { title: 'Export failed', body: (r && r.error) || 'Please retry', type: 'error' });
      break;
    }
    case 'settings': {
      openSettings();
      break;
    }
    default:
      toast({ title: 'Automatic fix not supported for this item', body: issue.hint || '', type: 'info' });
  }
  // repair, 
  setTimeout(selfCheck, 600);
  setTimeout(refreshStatus, 600);
}

async function fixAllIssues(issues) {
  const fixable = issues.filter((i) => i.fix);
  for (const i of fixable) {
    // eslint-disable-next-line no-await-in-loop
    await fixIssue(i);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res) => setTimeout(res, 500));
  }
}

init().catch((e) => {
  console.error(e);
  toast({ title: 'Initialization failed', body: e.message, type: 'error', sticky: true });
});
