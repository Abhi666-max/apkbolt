'use strict';
/**
 * Settings categories navigation and search tests
 * ，「」。
 * ：HTML  data-cat，，
 *  HTML 。
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'src/ui/index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'src/ui/app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/ui/style.css'), 'utf8');

/** （settingsBody） HTML  */
const bodyMatch = html.match(/<div class="modal-body" id="settingsBody">([\s\S]*?)<\/div>\s*<\/div>\s*<footer/);
assert(bodyMatch, 'assertion failed');

console.log('\n[ · ]');
test('unit test verification', () => {
  assert(html.includes('id="setNav"'), 'assertion failed');
  assert(html.includes('id="setSearch"'), 'assertion failed');
  assert(html.includes('id="btnClearSearch"'), 'assertion failed');
  assert(html.includes('id="settingsBody"'), 'id（ ）');
});

test('9 （ ）', () => {
  const navMatch = html.match(/<nav class="set-nav" id="setNav"[\s\S]*?<\/nav>/);
  assert(navMatch, 'nav');
  const items = navMatch[0].match(/data-cat="([a-z]+)"/g) || [];
  const ids = items.map((s) => s.replace(/data-cat="|"/g, ''));
  const expected = ['basic', 'display', 'input', 'perf', 'net', 'diag', 'files', 'about', 'lab'];
  assert(ids.length === expected.length, ` ${expected.length} ， ${ids.length}`);
  for (const e of expected) {
    assert(ids.includes(e), ` ${e}`);
  }
});

test('（ ）', () => {
  
  const groups = bodyMatch[1].match(/<(div class="group"|details class="advanced-group")[^>]*>/g) || [];
  assert(groups.length >= 15, ` 15 ， ${groups.length}`);
  for (const g of groups) {
    assert(/data-cat="[a-z]+"/.test(g), ` data-cat：${g}`);
  }
});

test('（ 「 」）', () => {
  const navMatch = html.match(/<nav class="set-nav" id="setNav"[\s\S]*?<\/nav>/);
  const navIds = (navMatch[0].match(/data-cat="([a-z]+)"/g) || []).map((s) => s.replace(/data-cat="|"/g, ''));
  const used = (bodyMatch[1].match(/data-cat="([a-z]+)"/g) || []).map((s) => s.replace(/data-cat="|"/g, ''));
  const usedSet = Array.from(new Set(used));
  for (const u of usedSet) {
    assert(navIds.includes(u), ` ${u} `);
  }
  // ，
  for (const n of navIds) {
    assert(used.includes(n), ` ${n} ，`);
  }
});

test('unit test verification', () => {
  const expect = [
    ['id="runtimeGroup"', 'basic'],
    ['id="perfGroup"', 'perf'],
    ['id="preflightGroup"', 'diag'],
    ['id="driverGroup"', 'diag'],
    ['id="autodebugGroup"', 'diag'],
    ['id="downloadGroup"', 'net'],
    ['id="updateGroup"', 'about'],
    ['id="aboutGroup"', 'about'],
    ['id="labGroup"', 'lab'],
  ];
  for (const [marker, cat] of expect) {
    const idx = html.indexOf(marker);
    assert(idx > 0, ` ${marker}`);
    const tail = html.slice(idx, idx + 120);
    assert(tail.includes(`data-cat="${cat}"`), `${marker}  ${cat}`);
  }
});

test('unit test verification', () => {
  const m = appJs.match(/const SETTINGS_CATS = \[([\s\S]*?)\];/);
  assert(m, 'app.js SETTINGS_CATS');
  const ids = (m[1].match(/id:\s*'([a-z]+)'/g) || []).map((s) => s.replace(/id:\s*'|'/g, ''));
  const navMatch = html.match(/<nav class="set-nav" id="setNav"[\s\S]*?<\/nav>/);
  const navIds = (navMatch[0].match(/data-cat="([a-z]+)"/g) || []).map((s) => s.replace(/data-cat="|"/g, ''));
  assert(ids.length === navIds.length, ` ${ids.length} ， ${navIds.length} `);
  for (const n of navIds) {
    assert(ids.includes(n), ` ${n}`);
  }
});

console.log('\n[ · ]');
test('、', () => {
  assert(appJs.includes('function switchSettingsCat'), 'assertion failed');
  assert(appJs.includes('function applySettingsFilter'), 'assertion failed');
  assert(appJs.includes('function groupMatches'), 'assertion failed');
  assert(appJs.includes('function focusGroup'), 'assertion failed');
  assert(appJs.includes('apkbolt.settings.cat') || appJs.includes('apkstart.settings.cat'), 'assertion failed');
});

test('（ ）', () => {
  // ，
  const fn = appJs.match(/function applySettingsFilter\(\) \{[\s\S]*?\n\}/);
  assert(fn, 'applySettingsFilter');
  assert(/g\.hidden = q \? !hit : !inCat/.test(fn[0]), '（ ）');
});

test('focusGroup（ ）', () => {
  assert(appJs.includes("focusGroup($('runtimeGroup'))"), 'assertion failed');
  assert(appJs.includes("focusGroup($('perfGroup'))"), 'assertion failed');
  // scrollIntoView  focusGroup
  const direct = appJs.match(/box\.scrollIntoView\(\{ block: 'start', behavior: 'smooth' \}\)/g) || [];
  assert(direct.length === 0, ` scrollIntoView （ ${direct.length} ）`);
});

test('fixIssue', () => {
  assert(appJs.includes('data-code="${esc(it.code)}"'), 'code');
  assert(appJs.includes('fixIssue(issue)'), 'assertion failed');
});

test('， engine.multiWindow', () => {
  assert(html.includes('id="setMultiWindow"'), 'assertion failed');
  assert(html.includes('id="setKeepBackground"'), 'assertion failed');
  assert(html.includes('class="lab-notice"'), 'assertion failed');
  // ，
  assert(/setMultiWindow'\)\.checked = !!s\.engine\.multiWindow/.test(appJs), 'multiWindow');
  assert(/engine:\s*\{\s*multiWindow:\s*e\.target\.checked/.test(appJs), 'engine.multiWindow');
  assert(/engine:\s*\{\s*keepBackground:/.test(appJs), 'assertion failed');
  // （ UI）
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/core/engine.js'), 'utf8');
  assert(/s\.engine && s\.engine\.multiWindow/.test(engineJs), 'engine multiWindow force-stop');
  const storeJs = fs.readFileSync(path.join(ROOT, 'src/core/store.js'), 'utf8');
  assert(/multiWindow:\s*false/.test(storeJs), 'store multiWindow');
});

console.log('\n[ · ]');
test('、', () => {
  for (const sel of ['.set-nav', '.set-nav-item', '.set-search', '.dbg-list', '.dbg-item', '.modal-main']) {
    assert(css.includes(sel), `style.css  ${sel}`);
  }
});

test('unit test verification', () => {
  assert(/\.modal \{[^}]*width: 880px/.test(css), '880px');
  assert(css.includes('max-width: calc(100vw - 48px)'), 'assertion failed');
});

console.log(`\n：${passed} ，${failed} `);
process.exit(failed ? 1 : 0);
