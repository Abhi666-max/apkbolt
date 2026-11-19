'use strict';
/**
 * Automatic Update System: Checks GitHub Releases (Abhi666-max/apkbolt) for updates.
 *
 * ：
 * - install（NSIS）：download `ApkStart-x.y.z-Setup.exe`，install（/S）；
 * - （ zip，runtimedownload）：download `ApkStart-vX-win64-portable.zip`，
 * extractdirectory —— runtimedirectory（%APPDATA%\apkstart\runtime）app、
 * snapshotdirectory，；
 * - （ runtime）：，directory resources\runtime。
 *
 * （exe ）， PowerShell ，
 * EncodedCommand ：exit → → 。
 * base64 .ps1 ，「path GBK 」
 * （PowerShell 5.1 BOM ANSI ）。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { downloadAny, downloadAnyParallel, downloadMulti, sha256File } = require('./download');
const { ZipFile, resolveZipEntry } = require('./zip');
const { cmpVer } = require('./version');
const { Sources } = require('./sources');
const inc = require('./incremental');

const OWNER = 'abhi666-max';
const REPO = 'apkbolt';

/** PowerShell ： ' '' */
function psq(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** directory（）， null */
function findInDir(dir, name) {
  try {
    const lower = name.toLowerCase();
    return fs.readdirSync(dir).find((n) => n.toLowerCase() === lower) || null;
  } catch (_) {
    return null;
  }
}

/**
 * directory NSIS uninstall， null。
 * electron-builder default `Uninstall <productName>.exe`（updater.flavor ），
 * version/custom `uninstaller.exe`（main.js ）。
 * ，install「uninstall」portable version（issue #51）。
 */
function findUninstaller(installDir) {
  try {
    const names = fs.readdirSync(installDir);
    return names.find((n) => /^Uninstall .*\.exe$/i.test(n))
      || names.find((n) => /^uninstall(er)?\.exe$/i.test(n))
      || null;
  } catch (_) {
    return null;
  }
}

class Updater {
  /**
   * @param {{currentVersion:string, exePath:string, isPackaged:boolean, dataDir:string,
   *          electronVersion?:string, onProgress?:Function}} o
   */
  constructor(o) {
    this.current = o.currentVersion || '0.0.0';
    this.exePath = o.exePath;
    this.installDir = path.dirname(o.exePath || '');
    this.isPackaged = !!o.isPackaged;
    this.dataDir = o.dataDir;
    this.onProgress = o.onProgress || (() => {});
    // incrementalupdate： Electron version（ ABI ）。
    // Electron runtime（main.js） process.versions.electron；。
    this.electronVersion = o.electronVersion || '';
    this.settings = typeof o.settings === 'function' ? o.settings : () => (o.settings || {});
    // settings() sources ：「 GitHub Gitee」「system image」
    this.sources = new Sources(this.settings);
    this.latest = null;
    this._last = null;
  }

 /** install：install（uninstall） */
  get flavor() {
    return findUninstaller(this.installDir) ? 'setup' : 'portable';
  }

  get updateDir() {
    return path.join(this.dataDir, 'update');
  }

  /**
 * update：GitHub / Gitee ，version，。
 * download prepare() 。
   */
  /**
 * @param {{force?:boolean}} [opts] force=true 10 versioncache
 * （「update」；launchcache）
   */
  async check(opts = {}) {
    const merged = await this.sources.latest({ force: !!opts.force });
    const pick = (re) => merged.assets.find((a) => re.test(String(a.name || '')));
    // 「」「runtime」（ApkStart-runtime-*.zip）。
    // fallback .zip runtime：runtime、
    // ，updateextractdirectory（ 1.5GB 、）。
    const isRuntimePack = (a) => inc.isAuxAsset((a && a.name) || '');

    const wantSetup = this.flavor === 'setup';
    const asset = wantSetup
      ? (pick(/Setup\.exe$/i) || merged.assets.find((a) => /\.exe$/i.test(a.name) && !isRuntimePack(a)))
      : (pick(/portable.*\.zip$/i) || pick(/win64.*\.zip$/i)
        || merged.assets.find((a) => /\.zip$/i.test(a.name) && !isRuntimePack(a)));

    // incremental： + 。、 Electron versionincremental；
    // full packagefallback asset ——incremental。
    const manifestAsset = pick(inc.MANIFEST_RE);
    const appAsset = pick(inc.APP_PACK_RE);

    this.latest = {
      version: merged.version,
      tag: merged.tag,
      name: merged.name,
      notes: merged.notes,
      htmlUrl: merged.htmlUrl,
      publishedAt: merged.publishedAt,
      // note parts：Gitee split url， parts 「」
      asset: asset
        ? {
          name: asset.name,
          size: asset.size,
          url: asset.url,
          // GitHub / Gitee ：，prepare() 。
          // sizes 「」——。
          urls: asset.urls,
          sizes: asset.sizes,
          source: asset.source,
          parts: asset.parts,
          partial: asset.partial,
        }
        : null,
      assets: merged.assets,
      // version / ，「」
      sources: merged.sources,
      unreachable: merged.unreachable,
      flavor: this.flavor,
      hasUpdate: cmpVer(merged.tag, this.current) > 0,
      current: this.current,
      canAutoApply: !!asset && (!!asset.url || !!(asset.parts && asset.parts.length)),
      // incremental：prepare() download（version/）
      incremental: this.flavor === 'portable' && !!manifestAsset && !!appAsset
        ? { manifest: manifestAsset, app: appAsset }
        : null,
    };
    this._last = this.latest;
    return this.latest;
  }

  /**
 * download「」：portable versionextract update/<ver>/payload，install Setup.exe。
   * @returns {Promise<{mode:'zip'|'setup', payload:string, version:string}>}
   */
  async prepare(info) {
    const it = info || this.latest;
    if (!it || !it.asset) throw new Error('No auto-install package available for this release, please download manually from GitHub releases');
    const dir = path.join(this.updateDir, it.version);
    fs.mkdirSync(dir, { recursive: true });

    // incremental： + （ MB）， Electron version、
    // 。incremental，full packagedownload。
    // incrementalfailure → full package，（resumable ）
    const forcedFull = fs.existsSync(path.join(dir, '.apkstart-force-full'));
    if (it.incremental && it.hasUpdate !== false && !forcedFull) {
      try {
        const job = await this._prepareApp(it, dir);
        if (job) return job;
      } catch (e) {
        this.onProgress({
          stage: 'download', percent: 1,
          message: `Incremental update unavailable (${e.message}), falling back to full package…`,
        });
      }
    }
    return this._prepareFull(it, dir);
  }

 /** full packagepath：download portable zip / Setup.exe extract（） */
  async _prepareFull(it, dir) {
    const file = path.join(dir, it.asset.name);
    let total = it.asset.size || 0;
    const conns = Math.max(1, Math.min(16, Number((this.settings().runtime || {}).downloadConnections) || 8));

    // Gitee 100MB， .part1/.part2。
    // split（ Gitee、 GitHub system image），
    // —— 「download + extract」。
    if (it.asset.parts && it.asset.parts.length) {
      await this._downloadParts(it.asset, file, conns, total);
    } else {
      this.onProgress({ stage: 'download', percent: 1, message: `Downloading ${it.asset.name}…` });
      // = + system image； 256KB ，chunkdownload。
      // 「GitHub KB/s、system image MB/s」：
      // ，。
      const cands = this.sources.candidates(it.asset);
      const ranked = await this.sources.rank(cands, { onProgress: (p) => this.onProgress(p) }).catch(() => cands);
      // 「」：GitHub Gitee
      // （compress， MB）， 92% complete。
      const sizes = it.asset.sizes || {};
      for (const u of ranked) {
        if (sizes[u]) { total = sizes[u]; break; }
      }
      // downloadMulti：chunk「GitHub 」「system image」，；
      // Range ，chunk。
      await downloadMulti(ranked, file, {
        connections: conns,
        onProgress: (pr) => {
          const pct = pr.percent != null ? pr.percent : (total ? Math.round((pr.got / total) * 100) : 0);
          const mb = `${(pr.got / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''}`;
          const sp = Number(pr.speed) > 0 ? ` · ${(pr.speed / 1048576).toFixed(2)} MB/s` : '';
          this.onProgress({
            stage: 'download',
            percent: Math.max(1, Math.min(99, pct)),
            message: `Downloading ${mb}${sp}`,
            speed: pr.speed,
          });
        },
      });
    }

    if (/\.zip$/i.test(file)) {
      const out = path.join(dir, 'payload');
      // issue #98：download+extractcomplete，/restartsuccess，
      // ， 100MB —— 「update」。
      // 、success，extract。
      if (this._payloadReady(out, it.version)) {
        this.onProgress({ stage: 'ready', percent: 100, message: 'Found downloaded update package, reusing' });
        return { mode: 'zip', payload: out, version: it.version };
      }
      fs.rmSync(out, { recursive: true, force: true });
      fs.mkdirSync(out, { recursive: true });
      await this._extract(file, out);
      this._markPayloadReady(out, it.version);
      this.onProgress({ stage: 'ready', percent: 100, message: 'Update package extracted successfully' });
      return { mode: 'zip', payload: out, version: it.version };
    }
    this.onProgress({ stage: 'ready', percent: 100, message: 'Installer package downloaded successfully' });
    return { mode: 'setup', payload: file, version: it.version };
  }

  /**
 * incrementalupdate：download + ，verifyextract app 。
 * null 「incremental」（full package）；， prepare fallback。
   * @returns {Promise<{mode:'app', payload:string, version:string}|null>}
   */
  async _prepareApp(it, dir) {
    if (!it.incremental || !it.incremental.manifest || !it.incremental.app) return null;
    const conns = Math.max(1, Math.min(16, Number((this.settings().runtime || {}).downloadConnections) || 8));

    // 1) ，dual source + （GitHub / Gitee / system image）download。
    const fetchAsset = async (asset, name, label) => {
      const target = path.join(dir, name);
      const ranked = await this.sources.rank(this.sources.candidates(asset), {}).catch(() => this.sources.candidates(asset));
      this.onProgress({ stage: 'download', percent: 1, message: `Fetching ${label}…` });
      await downloadAny(ranked, target, {});
      return target;
    };

    const manifestFile = await fetchAsset(it.incremental.manifest, `manifest-${it.version}.json`, 'update manifest');
    const manifest = inc.parseManifest(fs.readFileSync(manifestFile, 'utf8'));
    if (String(manifest.version).replace(/^v/i, '') !== String(it.version).replace(/^v/i, '')) {
      throw new Error('Manifest version does not match release version');
    }
    // app release （）
    const appAsset = it.assets && it.assets.find((a) => a && a.name === manifest.app.asset);
    const choice = inc.chooseMode({
      flavor: this.flavor,
      electronVersion: this.electronVersion,
      manifest,
      assets: appAsset ? [appAsset] : [],
      current: this.current,
    });
    if (choice.mode !== 'app') return null;

    const appFile = await fetchAsset(choice.appAsset, manifest.app.asset, 'incremental code package');
    const gotHash = await sha256File(appFile);
    if (String(gotHash).toLowerCase() !== String(manifest.app.sha256).toLowerCase()) {
      throw new Error('Incremental update package verification failed (sha256 mismatch)');
    }

    const payload = path.join(dir, 'app-payload');
    // downloadextractsuccessfailure：（full package .apkstart-ready ）
    if (this._payloadReady(payload, it.version)) {
      this.onProgress({ stage: 'ready', percent: 100, message: 'Found existing downloaded incremental package, reusing' });
      return { mode: 'app', payload, version: it.version, manifest };
    }
    fs.rmSync(payload, { recursive: true, force: true });
    fs.mkdirSync(payload, { recursive: true });
    await this._extract(appFile, payload);
    // verify：download / system image
    const bad = await inc.verifyExtracted({ payload, files: manifest.app.files });
    if (bad.length) throw new Error(`Incremental update package has ${bad.length} invalid files`);

    this._markPayloadReady(payload, it.version, 'app');
    this.onProgress({ stage: 'ready', percent: 100, message: 'Incremental update package verified' });
    return { mode: 'app', payload, version: it.version, manifest };
  }

  /**
 * downloadsplit。
   * @param {{name:string, size:number, parts:Array<{index:number,size:number,urls:string[]}>}} asset
   */
  async _downloadParts(asset, target, conns, total) {
    const dir = path.dirname(target);
    let doneBytes = 0;
    const fd = fs.openSync(target, 'w');
    try {
      for (const part of asset.parts) {
        const tmp = path.join(dir, `${asset.name}.${part.index}.tmp`);
        const cands = [];
        for (const u of part.urls) {
          for (const c of this.sources.candidates(u)) if (!cands.includes(c)) cands.push(c);
        }
        // eslint-disable-next-line no-await-in-loop
        const ranked = await this.sources.rank(cands, {
          onProgress: (p) => this.onProgress({ ...p, percent: Math.max(1, Math.min(99, Math.round((doneBytes / (total || 1)) * 100))) }),
        }).catch(() => cands);
        // eslint-disable-next-line no-await-in-loop
        await downloadAnyParallel(ranked, tmp, {
          connections: conns,
          onProgress: (pr) => {
            const got = doneBytes + (pr.got || 0);
            const pct = total ? Math.round((got / total) * 100) : 0;
            const sp = Number(pr.speed) > 0 ? ` · ${(pr.speed / 1048576).toFixed(2)} MB/s` : '';
            this.onProgress({
              stage: 'download',
              percent: Math.max(1, Math.min(99, pct)),
              message: `Downloading ${(got / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''} (part ${part.index}/${asset.parts.length})${sp}`,
              speed: pr.speed,
            });
          },
        });
        const buf = fs.readFileSync(tmp);
        if (part.size && buf.length !== part.size) {
          throw new Error(`Part ${part.index} size mismatch (${buf.length} ≠ ${part.size}), aborted. Please retry.`);
        }
        fs.writeSync(fd, buf, 0, buf.length, doneBytes);
        doneBytes += buf.length;
        fs.rmSync(tmp, { force: true });
      }
    } finally {
      fs.closeSync(fd);
    }
    if (total && doneBytes !== total) {
      throw new Error(`Assembled package size mismatch (${doneBytes} ≠ ${total}), aborted. Please retry.`);
    }
  }

  async _extract(zipPath, dest) {
    const zf = new ZipFile(zipPath);
    try {
      const names = zf.names().filter((n) => !n.endsWith('/'));
      let i = 0;
      for (const n of names) {
        i += 1;
        // zip-slip： zip.js （ ../、path、、）
        const target = resolveZipEntry(dest, n);
        if (!target) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        await zf.pipeTo(n, fs.createWriteStream(target));
        if (i % 20 === 0) {
          this.onProgress({
            stage: 'extract',
            percent: Math.min(99, Math.round((i / names.length) * 100)),
            message: `Extracting ${i}/${names.length}`,
          });
        }
      }
    } finally {
      try { zf.close(); } catch (_) { /* ignore */ }
    }
  }

 /** ：extract， */
  _readyFile(payload) { return path.join(payload, '.apkstart-ready'); }

  _markPayloadReady(payload, version, mode = 'zip') {
    try {
      fs.writeFileSync(this._readyFile(payload), JSON.stringify({ version, at: Date.now(), mode }), 'utf8');
    } catch (_) { /* ， */ }
  }

  _payloadReady(payload, version) {
    try {
      if (!fs.existsSync(this._readyFile(payload))) return false;
      const m = JSON.parse(fs.readFileSync(this._readyFile(payload), 'utf8'));
      // version = version，
      if (m.version !== version) return false;
      if (m.mode === 'app') {
        // incremental exe；「」 resources/app/package.json
        return fs.existsSync(path.join(payload, 'resources', 'app', 'package.json'));
      }
      // ： exe 。extract/。
      const exeName = path.basename(this.exePath || 'ApkStart.exe');
      return !!findInDir(payload, exeName);
    } catch (_) {
      return false;
    }
  }

  /**
 * launch：「downloadextract、/restartfailure」update。
 * ，download（issue #98 ）。
   * @returns {{mode:'zip', payload:string, version:string}|null}
   */
  findResumableJob() {
    try {
      if (!fs.existsSync(this.updateDir)) return null;
      const versions = fs.readdirSync(this.updateDir)
        .filter((n) => cmpVer(n, this.current) > 0)   // updateversion，restart
        .sort((a, b) => cmpVer(b, a));
      for (const v of versions) {
        // full package
        const payload = path.join(this.updateDir, v, 'payload');
        if (this._payloadReady(payload, v)) return { mode: 'zip', payload, version: v };
        // incremental（incrementalfailurefull package → ）
        const appPayload = path.join(this.updateDir, v, 'app-payload');
        if (!fs.existsSync(path.join(this.updateDir, v, '.apkstart-force-full'))
            && this._payloadReady(appPayload, v)) {
          return { mode: 'app', payload: appPayload, version: v };
        }
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  /**
 * launch「 + restart」，exitapp。
   * @param {{mode:'zip'|'setup', payload:string, version:string}} job
 * @param {{waitPid?:number, spawn?:boolean}} [opts] pid / launch
   */
  apply(job, opts = {}) {
    const exe = this.exePath;
    const dir = this.installDir;
    const logFile = path.join(this.updateDir, 'update.log');
    fs.mkdirSync(this.updateDir, { recursive: true });
    const waitPid = opts.waitPid || process.pid;

    const lines = [
      `$ErrorActionPreference = 'SilentlyContinue'`,
      `$log = ${psq(logFile)}`,
      `function Note($m) { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }`,
      `Note 'updater start'`,
      `$applyOk = $true`,
      // exit（ 90 ）， exe/dll
      `try { Wait-Process -Id ${waitPid} -Timeout 90 } catch { }`,
      `Start-Sleep -Milliseconds 700`,
    ];

    if (job.mode === 'zip') {
      // issue #98：「 exe 」——， copy
      // failuresuccess，、restartversion → bootcheckupdate → 。
      // ： exe .old， exe
      // ；failure .old，****launch。
      const exeName = path.basename(exe);
      lines.push(
        `$src = ${psq(job.payload)}`,
        `$dst = ${psq(dir)}`,
        `$exeName = ${psq(exeName)}`,
        `$target = Join-Path $dst $exeName`,
        `$srcExe = Join-Path $src $exeName`,
        `$expected = (Get-Item $srcExe).Length`,
        `$backup = "$target.old"`,
        `$hasBackup = $false`,
        `if (Test-Path $target) {`,
        `  try { Move-Item -LiteralPath $target -Destination $backup -Force; $hasBackup = $true } catch { Note "backup failed: $_" }`,
        `}`,
        `$ok = $false`,
        `for ($i = 1; $i -le 12; $i++) {`,
        `  Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force`,
        `  if ((Test-Path $target) -and ((Get-Item $target).Length -eq $expected)) { $ok = $true; Note "copy pass $i ok"; break }`,
        `  Note "copy pass $i failed, retry"; Start-Sleep -Milliseconds 600`,
        `}`,
        `if (-not $ok) {`,
        `  Note 'copy FAILED - keeping payload for next launch'`,
        `  $applyOk = $false`,
        `  if ($hasBackup) { try { Move-Item -LiteralPath $backup -Destination $target -Force } catch {} }`,
        `} else {`,
        `  if ($hasBackup) { try { Remove-Item -LiteralPath $backup -Force } catch {} }`,
        // success，； findResumableJob 。
        `  try { Remove-Item -LiteralPath (Join-Path $src '.apkstart-ready') -Force } catch {}`,
        `  Remove-Item -Path $src -Recurse -Force`,
        `}`,
      );
    } else if (job.mode === 'app') {
      // incremental： resources\app（ JS / / node_modules）。
      // Electron （exe / dll / locales） —— update ~100MB MB。
      // + verify package.json version，failure。
      const appRel = path.join('resources', 'app');
      lines.push(
        `$src = ${psq(job.payload)}`,
        `$dst = ${psq(dir)}`,
        `$appRel = ${psq(appRel)}`,
        `$appDst = Join-Path $dst $appRel`,
        `$appSrc = Join-Path $src $appRel`,
        `$pkgDst = Join-Path $appDst 'package.json'`,
        `$backup = "$appDst.old"`,
        `$hasBackup = $false`,
        `if (Test-Path $appDst) {`,
        `  try { Move-Item -LiteralPath $appDst -Destination $backup -Force; $hasBackup = $true } catch { Note "app backup failed: $_" }`,
        `}`,
        `$ok = $false`,
        `for ($i = 1; $i -le 12; $i++) {`,
        `  New-Item -ItemType Directory -Force -Path $appDst | Out-Null`,
        `  Copy-Item -Path (Join-Path $appSrc '*') -Destination $appDst -Recurse -Force`,
        `  if (Test-Path $pkgDst) {`,
        `    try {`,
        `      $pv = (Get-Content -LiteralPath $pkgDst -Raw | ConvertFrom-Json).version`,
        `      if ($pv -eq ${psq(job.version)}) { $ok = $true; Note "app copy pass $i ok"; break }`,
        `    } catch { Note "app version check: $_" }`,
        `  }`,
        `  Note "app copy pass $i failed, retry"; Start-Sleep -Milliseconds 500`,
        `}`,
        `if (-not $ok) {`,
        `  Note 'app copy FAILED - rollback and keep payload'`,
        `  $applyOk = $false`,
        // incrementalfailure（）：，launchfull package，
        // resumable —— issue #98 incremental。
        `  try { New-Item -ItemType File -Force -Path ${psq(path.join(this.updateDir, job.version, '.apkstart-force-full'))} | Out-Null } catch {}`,
        `  if (Test-Path $appDst) { try { Remove-Item -LiteralPath $appDst -Recurse -Force } catch {} }`,
        `  if ($hasBackup) { try { Move-Item -LiteralPath $backup -Destination $appDst -Force } catch {} }`,
        `} else {`,
        `  if ($hasBackup) { try { Remove-Item -LiteralPath $backup -Recurse -Force } catch {} }`,
        `  try { Remove-Item -LiteralPath (Join-Path $src '.apkstart-ready') -Force } catch {}`,
        `}`,
      );
    } else {
      lines.push(
        `Note 'run installer'`,
        `$p = Start-Process -FilePath ${psq(job.payload)} -ArgumentList '/S' -PassThru -Wait`,
        `Note ("installer exit " + $p.ExitCode)`,
        `Start-Sleep -Milliseconds 800`,
      );
    }

    lines.push(
      // issue #98： Start-Process 、failure → 「restart」。
      // -WorkingDirectory（portable versionpath），failure cmd /c start，log。
      `if (Test-Path ${psq(exe)}) {`,
      `  try {`,
      `    Start-Process -FilePath ${psq(exe)} -WorkingDirectory ${psq(dir)} -ErrorAction Stop`,
      `    Note 'relaunched via Start-Process'`,
      `  } catch {`,
      `    Note ("Start-Process failed: " + $_.Exception.Message + "; fallback to cmd start")`,
      `    try {`,
      `      Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','start','""',${psq(exe)} -WorkingDirectory ${psq(dir)} -WindowStyle Hidden`,
      `      Note 'relaunched via cmd start'`,
      `    } catch { Note ("cmd start failed: " + $_.Exception.Message) }`,
      `  }`,
      `} else { Note 'relaunch skipped: exe missing' }`,
      `Note 'updater done'`,
      `Start-Sleep -Milliseconds 400`,
      // failureversiondirectory（ + ），launch；
      // 「」，。
      `if ($applyOk) { Remove-Item -Path ${psq(path.join(this.updateDir, job.version))} -Recurse -Force }`,
      `else { Note 'version dir kept for resume on next launch' }`,
      // cleanfailure（directory/）updatefailure
      `exit 0`,
    );

    const script = lines.join('\r\n');
    fs.writeFileSync(path.join(this.updateDir, 'apply.log.ps1'), script, 'utf8');
    if (opts.spawn === false) return script;
    // -EncodedCommand UTF-16LE base64：path GBK
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    // **** detached： / 「」，
    // （update「restart」）。
    // Windows exit，「 + unref」
    // exit，。
    const child = spawn(ps, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden', '-EncodedCommand', b64,
    ], { stdio: 'ignore', windowsHide: true });
    child.unref();
    return true;
  }

 /** UI （install）， */
  static repoUrl() {
    return `https://github.com/${OWNER}/${REPO}/releases`;
  }
}

module.exports = { Updater, cmpVer, OWNER, REPO, findUninstaller };
