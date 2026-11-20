'use strict';
/* appwindow： rotate / / / ，settings ApkStart */
const api = window.apkstart;
const $ = (id) => document.getElementById(id);

const btn = {
  rotate: $('btnRotate'),
  min: $('btnMin'),
  max: $('btnMax'),
  close: $('btnClose'),
};

btn.rotate.addEventListener('click', () => api.shell.rotate());
btn.min.addEventListener('click', () => api.shell.minimize());
btn.max.addEventListener('click', () => api.shell.maximize());
btn.close.addEventListener('click', () => api.shell.close());

// Chromium ；
// 「Android」，。
window.addEventListener('contextmenu', (e) => e.preventDefault());

// Ctrl+R rotate，F11 （ Windows ）
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); api.shell.rotate(); }
  else if (e.key === 'F11') { e.preventDefault(); api.shell.maximize(); }
  else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); api.shell.back(); }
  else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); api.shell.forward(); }
  else {
    // keykey（/→）
    api.shell.keyEvent(e.key).catch(() => {});
  }
});

function applyState(s) {
  if (!s) return;
  $('appName').textContent = s.label || 'App';
  $('bootName').textContent = s.label || '';
  const icon = s.iconUrl || '';
  // fallback：app（ICO/WebP failure、file URL CSP ）
  // logo，launch「」。
  const FALLBACK = 'assets/logo-128.png';
  const bootIcon = $('bootIcon');
  const appIcon = $('appIcon');
  if (bootIcon) {
    bootIcon.onerror = () => { if (bootIcon.src.indexOf('logo-128') < 0) bootIcon.src = FALLBACK; };
    bootIcon.src = icon || FALLBACK;
  }
  if (appIcon) {
    appIcon.onerror = () => { if (appIcon.src.indexOf('logo-128') < 0) appIcon.src = FALLBACK; };
    appIcon.src = icon || FALLBACK;
  }
  $('bootTip').textContent = s.tip || '';
  if (s.ready) {
    const boot = $('boot');
    if (boot) {
      boot.classList.add('out');
      setTimeout(() => { boot.style.display = 'none'; }, 420);
    }
    document.body.style.background = '#0b0c0e';
  }
}

api.shell.onState(applyState);
api.shell.state().then(applyState).catch(() => {});
