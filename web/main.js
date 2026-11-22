// ApkBolt Landing Page Interactive Script
document.addEventListener('DOMContentLoaded', () => {
  // Smooth scroll for anchor navigation
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // Real File Input & Drag & Drop Handling
  const dropzone = document.getElementById('dropzoneDemo');
  const fileInput = document.getElementById('apkFileInput');
  const btnBrowse = document.getElementById('btnBrowseFile');
  const btnDemo = document.getElementById('btnDemoApk');
  const title = document.getElementById('dropzoneTitle');
  const desc = document.getElementById('dropzoneDesc');
  const icon = document.getElementById('dropzoneIcon');

  // Trigger file dialog on browse button click
  if (btnBrowse && fileInput) {
    btnBrowse.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  // Also clicking the dropzone directly triggers file selection
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => {
      fileInput.click();
    });
  }

  // Handle selected file from input
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        simulateApkLaunch(file.name, (file.size / (1024 * 1024)).toFixed(1) + ' MB');
      }
    });
  }

  // Demo APK button simulation
  if (btnDemo) {
    btnDemo.addEventListener('click', (e) => {
      e.stopPropagation();
      simulateApkLaunch('Spotify-v8.9.18.apk', '42.8 MB');
    });
  }

  // Drag and drop event listeners
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '#fbbf24';
      dropzone.style.backgroundColor = 'rgba(245, 158, 11, 0.08)';
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      dropzone.style.backgroundColor = 'rgba(245, 158, 11, 0.02)';
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        simulateApkLaunch(file.name, (file.size / (1024 * 1024)).toFixed(1) + ' MB');
      } else {
        simulateApkLaunch('Package-Sample.apk', '28.4 MB');
      }
    });
  }

  function resetDropzone() {
    dropzone.style.borderColor = 'rgba(245, 158, 11, 0.4)';
    dropzone.style.backgroundColor = 'rgba(245, 158, 11, 0.02)';
    dropzone.innerHTML = `
      <div class="dropzone-icon" id="dropzoneIcon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
      </div>
      <h3 id="dropzoneTitle">Drag &amp; Drop APK file here</h3>
      <p id="dropzoneDesc">or click to browse your local computer for .apk or .xapk packages</p>
      <div class="dropzone-actions">
        <button type="button" class="browse-btn" id="btnBrowseFile">Select APK Package</button>
        <button type="button" class="demo-btn" id="btnDemoApk">Try Demo APK</button>
      </div>
    `;

    const newBtnBrowse = document.getElementById('btnBrowseFile');
    const newBtnDemo = document.getElementById('btnDemoApk');

    if (newBtnBrowse && fileInput) {
      newBtnBrowse.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
      });
    }

    if (newBtnDemo) {
      newBtnDemo.addEventListener('click', (e) => {
        e.stopPropagation();
        simulateApkLaunch('Spotify-v8.9.18.apk', '42.8 MB');
      });
    }

    if (fileInput) fileInput.value = '';
  }

  function simulateApkLaunch(pkgName, sizeStr) {
    const cleanName = pkgName.replace(/\.apk$/i, '');
    dropzone.style.borderColor = '#10b981';
    dropzone.style.backgroundColor = 'rgba(16, 185, 129, 0.05)';
    dropzone.innerHTML = `
      <div class="dropzone-loading">
        <div class="spinner"></div>
        <h3>Parsing ${pkgName} (${sizeStr})</h3>
        <p>Inspecting AndroidManifest.xml &bull; Validating API 34 &amp; Dual-ABI signatures...</p>
      </div>
    `;

    setTimeout(() => {
      dropzone.innerHTML = `
        <div class="apk-analyzed-box">
          <div class="apk-analyzed-header">
            <div class="apk-check-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div class="apk-header-info">
              <div class="apk-status-tag">✓ Package Verified &bull; Ready to Launch</div>
              <h3 class="apk-app-name">${cleanName}</h3>
              <p class="apk-app-meta">Size: <strong>${sizeStr}</strong> &bull; Target: <strong>Android 14 (API 34)</strong> &bull; Engine: <strong>Hardware Passthrough</strong></p>
            </div>
          </div>

          <div class="apk-action-flow">
            <p class="apk-run-hint">Web browsers cannot run native Windows hypervisors directly. To launch <strong>${cleanName}</strong> in an independent, resizable 60 FPS desktop window on your PC:</p>
            
            <div class="apk-quick-steps">
              <div class="q-step"><span class="q-num">1</span> Download ApkBolt (.zip)</div>
              <div class="q-arrow">→</div>
              <div class="q-step"><span class="q-num">2</span> Open ApkBolt.exe</div>
              <div class="q-arrow">→</div>
              <div class="q-step"><span class="q-num">3</span> Drag &amp; drop ${cleanName}</div>
            </div>

            <div class="apk-cta-buttons">
              <a href="https://github.com/abhi666-max/apkbolt/releases/download/v0.6.3/ApkBolt-v0.6.3-portable.zip" class="btn btn-primary btn-large">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                Download ApkBolt to Run ${cleanName}
              </a>
              <button type="button" class="btn btn-secondary" id="btnTestAnother">Select Another APK</button>
            </div>
          </div>
        </div>
      `;

      const btnAnother = document.getElementById('btnTestAnother');
      if (btnAnother) {
        btnAnother.addEventListener('click', (e) => {
          e.stopPropagation();
          resetDropzone();
        });
      }
    }, 900);
  }
});
