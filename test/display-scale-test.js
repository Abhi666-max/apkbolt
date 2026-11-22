'use strict';
/**
 * issue #9 9" 100% " Node ( Electron/). 
 * :  Electron  DIP  DPI-aware 
 *       SetWindowPos(), 125%/150%  2/3 , , 
 *       . :  agent.layout  _physical()  scaleFactor. 
 * : 
 *  - _physical  100%/125%/150%/175% (, )
 *  - sf=1 / 
 *  - _area()  sf  area 
 *  - :  layout  _physical, 
 * : node test/display-scale-test.js
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
// require --CI  ELECTRON_SKIP_BINARY_DOWNLOAD=1, 
// require appwin.js  electron (). 
const { physicalRect } = require('../src/core/geometry');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

(() => {
  console.log('\n[issue #9 9  -  DIP → ]');

  test('100% :  ( ,  )', () => {
    const r = { x: 100, y: 60, w: 1280, h: 720 };
    assert.equal(physicalRect(r, 1), r, 'sf=1');
    assert.equal(physicalRect(r, 0), r, 'sf');
  });

  test('150% :  , ', () => {
    assert.deepEqual(physicalRect({ x: 100, y: 60, w: 1280, h: 720 }, 1.5),
      { x: 150, y: 90, w: 1920, h: 1080 });
  });

  test('125% : ', () => {
    assert.deepEqual(physicalRect({ x: 33, y: 41, w: 1001, h: 777 }, 1.25),
      { x: Math.round(33 * 1.25), y: Math.round(41 * 1.25), w: Math.round(1001 * 1.25), h: Math.round(777 * 1.25) });
  });

  test('(-8 ) , ', () => {
    assert.deepEqual(physicalRect({ x: -8, y: 30 - 8, w: 900, h: 500 }, 2),
      { x: -16, y: 44, w: 1800, h: 1000 });
  });

  test(': workArea DIP × sf =', () => {
    // 150%  1920×1080  workArea  1280×693 DIP
    const phys = physicalRect({ x: 0, y: 0, w: 1280, h: 693 }, 1.5);
    assert.equal(phys.w, 1920);
    assert.equal(phys.h, Math.round(693 * 1.5)); // ≈ 1040, 
  });

  console.log('\n[  -   layout ]');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'appwin.js'), 'utf8');

  test('appwin._physical geometry.physicalRect', () => {
    assert(/require\('\.\/geometry'\)/.test(src), 'appwin geometry');
    const start = src.indexOf('_physical(rect, sf) {');
    const body = src.slice(start, start + 200);
    assert(/physicalRect\(rect/.test(body), '_physical physicalRect( )');
  });

  test('_area() sf,  area', () => {
    const fn = src.slice(src.indexOf('_area() {'), src.indexOf('_scale() {'));
    assert(/scaleFactor/.test(fn), '_area scaleFactor');
    assert(/return \{[^}]*sf:/s.test(fn), '_area sf');
  });

  test('openDetached layout _physical', () => {
    const start = src.indexOf('async openDetached(');
    const body = src.slice(start, src.indexOf('async embed(', start));
    assert(/agent\.layout\(this\._physical\(/.test(body), 'openDetached agent.layout _physical');
  });

  test('toggleMaximize layout _physical', () => {
    const start = src.indexOf('async toggleMaximize()');
    const body = src.slice(start, src.indexOf('openDetachedLayoutOnly(area) {'));
    assert(/agent\.layout\(this\._physical\(/.test(body), 'assertion failed');
    // probe , 
    assert(/agent\.layout\(this\._preFullscreenRect\)/.test(body), 'probe');
  });

  test('openDetachedLayoutOnly layout _physical', () => {
    const start = src.indexOf('openDetachedLayoutOnly(area) {');
    const body = src.slice(start, start + 600);
    assert(/agent\.layout\(this\._physical\(/.test(body), 'assertion failed');
  });

  test('_rect() sf ( )', () => {
    const start = src.indexOf('_rect() {');
    const body = src.slice(start, start + 500);
    assert(/this\._scale\(\)/.test(body) && /\* sf/.test(body), 'assertion failed');
  });

  console.log(`\n: ${passed} , ${failed} \n`);
  process.exit(failed ? 1 : 0);
})();
