'use strict';
/**
 * version. ,  updater ↔ sources require . 
 */

/** Normalizes version strings into comparable numeric arrays. */
function parseVer(v) {
  return String(v || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((x) => (/^\d+$/.test(x) ? Number(x) : x))
    .filter((x) => x !== '');
}

/** Returns 1 if a>b, -1 if a<b, 0 if equal. */
function cmpVer(a, b) {
  const A = parseVer(a);
  const B = parseVer(b);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i += 1) {
    const x = A[i];
    const y = B[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x < y ? -1 : 1;
    } else {
      const sx = String(x);
      const sy = String(y);
      if (sx !== sy) return sx < sy ? -1 : 1;
    }
  }
  return 0;
}

module.exports = { parseVer, cmpVer };
