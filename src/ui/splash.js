'use strict';
/* ApkStart boot: update,  */

const api = window.apkstartSplash;
if (!api) { /* preload exit */ }

const $ = (id) => document.getElementById(id);

// version
api?.version?.().then((v) => { if ($('ver')) $('ver').textContent = v || ''; }).catch(() => {});

// install +
Promise.all([
  api?.isFirstRun?.().catch(() => false),
  api?.bundled?.().catch(() => false),
]).then(([first, bundled]) => {
  if (!first || !$('firstRun')) return;
  $('firstRun').hidden = false;
  // runtime(install / MSIX ): "download". 
  // " 850MB system image", compresssystem image
  // directory, . 
  if (bundled) {
    if ($('firstRunTitle')) $('firstRunTitle').textContent = 'First Launch  -  Setting up locally (no internet needed)';
    if ($('firstRunList')) {
      $('firstRunList').innerHTML = [
        '<li>Runtime components are bundled - no downloads needed</li>',
        '<li>Extracting system image to user directory (~1 min, one-time)</li>',
        '<li>Configuring hardware acceleration & input methods</li>',
        '<li>Double-click any APK or desktop shortcut to launch instantly</li>',
      ].join('');
    }
  }
}).catch(() => {});

// update
api?.onProgress?.((p) => {
  if (!p) return;
  if (p.percent != null && $('progressBar')) {
    $('progressBar').style.width = Math.min(100, Math.max(0, p.percent)) + '%';
  }
  if (p.message && $('status')) {
    $('status').textContent = p.message;
  }
});

// complete →
api?.onDone?.(() => {
  const splash = $('splash');
  if (splash) {
    splash.classList.add('out');
    setTimeout(() => { api?.close?.(); }, 520);
  }
});

