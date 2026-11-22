'use strict';
/**
 * Android verify。
 *
 * APK AndroidManifest.xml（），path
 * （store.iconPath / apkPath） adb shell （pm path / pidof / am start…）。
 * verify「../」、、shell path.join shell：
 * directory，。
 *
 * Android ：，/，
 * //。 ASCII verify，
 * ，path shell 。
 */
const RE_PKG = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;

function validPackageName(pkg) {
  return typeof pkg === 'string' && RE_PKG.test(pkg);
}

/** （log/fallback，install） */
function safeFilePart(pkg) {
  if (validPackageName(pkg)) return pkg;
  return `invalid-${String(pkg || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)}`;
}

module.exports = { validPackageName, safeFilePart, RE_PKG };
