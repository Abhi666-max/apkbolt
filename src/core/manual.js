'use strict';
/**
 * Built-in user guide mapping: Issue / Error -> Tutorial Section
 * Pure function, does not depend on electron or fs.
 *
 * All error codes, diagnostics, and tutorial clicks route to resolve(),
 * ensuring deterministic navigation to the trusted anchor.
 */

/** Section id to anchor mapping in src/ui/manual.html */
const TOPICS = Object.freeze({
  overview: { id: 'overview', anchor: 'apkbolt-user-guide', title: 'ApkBolt User Guide  -  Table of Contents' },
  accel: { id: 'accel', anchor: '6-1-hardware-acceleration-slow-boot', title: 'Hardware Acceleration / Slow Boot' },
  install: { id: 'install', anchor: '6-2-installation-failed-install-failed', title: 'Installation Failed (INSTALL_FAILED_*)' },
  arm: { id: 'arm', anchor: '6-3-arm-translation-layer-issues', title: 'ARM Translation Layer / ARM App Issues' },
  adb: { id: 'adb', anchor: '6-4-adb-unauthorized-allow-debugging', title: 'adb Unauthorized (Allow USB Debugging)' },
  startup: { id: 'startup', anchor: '6-5-launch-issues-window-rotation', title: 'Launch Issues / Window with Rotation Button' },
  other: { id: 'other', anchor: '6-6-other-startup-issues-reference', title: 'Other Startup Issues Quick Reference' },
  sound: { id: 'sound', anchor: '6-7-no-sound-low-volume', title: 'No Sound / Low Volume in App' },
  dll: { id: 'dll', anchor: '6-8-store-launch-failure-dll-load-failed', title: 'Store Edition Launch Failure / 0xC0000135 (DLL Load Failed)' },
  diagnose: { id: 'diagnose', anchor: '5-4-builtin-guide-auto-tutorials', title: 'Built-in Guide & Auto Tutorials' },
  settings: { id: 'settings', anchor: '3-6-settings-navigation', title: 'Settings Navigation' },
  storage: { id: 'storage', anchor: '8-data-directory-overview', title: 'Data & Directory Overview' },
  network: { id: 'network', anchor: '5-2-autodiagnostics-network-repair', title: 'Auto-diagnostics & Network Repair' },
});

const ARM_RE = /NO_MATCHING_ABIS|DoBadTrampoline|libndk_translation|UnsatisfiedLinkError|arm64-v8a|armeabi-v7a|ARM translation|ARM translation layer/i;
const ADB_RE = /ADB_UNAUTHORIZED|unauthorized|Allow USB debugging|debug authorization/i;
const SOUND_RE = /audio|AUDIO|sound|volume|mute|Audiosrv/i;
// 0xC0000135 / DLL load failure (Decimal 3221225781 recognized as well)
const DLL_RE = /0x0?c0000135|3221225781|STATUS_DLL_NOT_FOUND|DLL load failed|dependent DLL|missing DLL|MSVCP140|VCRUNTIME|FaultingModuleName/i;

/** Auto-diagnostic issue code -> section id */
const ISSUE_MAP = Object.freeze({
  'accel.softwareEmulation': 'accel',
  'device.unauthorized': 'adb',
  'device.offline': 'adb',
  'device.missing': 'adb',
  'settings.orientationConflict': 'startup',
  'settings.detachedFullscreen': 'startup',
  'settings.snapshotOffLowDisk': 'storage',
  'storage.sharedBroken': 'storage',
  'settings.audioDisabled': 'sound',
  'audio.disabled': 'sound',
  'audio.windowsServiceStopped': 'sound',
  'storage.diskCritical': 'storage',
  'storage.diskLow': 'storage',
  'storage.dataNeedsReset': 'storage',
  'storage.dataMismatch': 'storage',
  'network.guestDown': 'network',
  'network.sourcesDown': 'network',
  'runtime.staleLocks': 'startup',
  'runtime.orphanProcesses': 'startup',
  'runtime.staleSnapshot': 'startup',
  'runtime.stuckBoot': 'startup',
  DLL: 'dll',
  vcRedist: 'dll',
});

/** Fallback keyword matching for error text / titles */
function topicByText(text) {
  const s = String(text || '');
  if (ARM_RE.test(s)) return 'arm';
  if (ADB_RE.test(s)) return 'adb';
  if (SOUND_RE.test(s)) return 'sound';
  if (DLL_RE.test(s)) return 'dll';
  if (/INSTALL_FAILED|INSTALL_PARSE|signature|corrupt|damaged|package/i.test(s)) return 'install';
  if (/hardware accel|hypervisor|WHPX|AEHD|accel/i.test(s)) return 'accel';
  if (/attach failed|emu:0|rotate|rotation|embed|does not open|icon/i.test(s)) return 'startup';
  if (/disk|space|shared folder|storage|data partition/i.test(s)) return 'storage';
  if (/network|dns|offline|mirror|download source/i.test(s)) return 'network';
  return 'overview';
}

/** Diagnostic issue -> guide section */
function topicForIssue(issue) {
  if (!issue) return TOPICS.overview;
  const code = String(issue.code || '');
  let id = ISSUE_MAP[code];
  if (!id || code === 'runtime.bootFailed' || code === 'logs.errors') {
    id = topicByText(`${issue.title || ''} ${issue.detail || ''}`);
    if (id === 'overview' && code === 'runtime.bootFailed') id = 'startup';
    if (id === 'overview' && code === 'logs.errors') id = 'other';
  }
  return TOPICS[id] || TOPICS.overview;
}

/** Raw error text -> guide section */
function topicForError(text) {
  const s = String(text || '');
  if (!s.trim()) return TOPICS.overview;
  if (ARM_RE.test(s)) return TOPICS.arm;
  if (ADB_RE.test(s)) return TOPICS.adb;
  if (SOUND_RE.test(s)) return TOPICS.sound;
  if (DLL_RE.test(s)) return TOPICS.dll;
  if (/INSTALL_|PARSE_FAILED|Install failed|signature|package/i.test(s)) return TOPICS.install;
  if (/attach failed|emu:0|device not found|rotation window/i.test(s)) return TOPICS.startup;
  return topicByText(s) === 'overview' ? TOPICS.install : TOPICS[topicByText(s)];
}

/**
 * Unified entry point: renderer passes { code, error, issue, or topic },
 * always returns a validated guide anchor.
 */
function resolve(payload) {
  const p = typeof payload === 'string' ? { error: payload } : (payload || {});
  let topic = TOPICS.overview;
  if (p.topic && TOPICS[p.topic]) topic = TOPICS[p.topic];
  else if (p.issue || p.code) {
    const issue = typeof p.issue === 'string'
      ? { code: p.issue, title: p.title, detail: p.detail }
      : (p.issue || { code: p.code, title: p.title, detail: p.detail });
    topic = topicForIssue(issue);
  } else if (p.error || p.message || p.text) topic = topicForError(p.error || p.message || p.text);
  return {
    id: topic.id,
    anchor: topic.anchor,
    title: topic.title,
    reason: String(p.reason || ''),
  };
}

module.exports = { TOPICS, ISSUE_MAP, topicForIssue, topicForError, topicByText, resolve };
