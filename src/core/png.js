'use strict';
/**
 * Zero-dependency PNG encoder & ApkBolt App Icon generator.
 * Generates custom geometric lightning bolt icons dynamically across all sizes.
 */
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA pixels (Uint8Array, length w*h*4) -> PNG Buffer */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function roundRectAlpha(x, y, w, h, r, px, py) {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r ? 1 : 0;
}

function pointInPolygon(px, py, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i][0], yi = vertices[i][1];
    const xj = vertices[j][0], yj = vertices[j][1];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

/**
 * Draw ApkBolt Flagship Geometric Lightning Bolt Icon.
 * Sleek 3D faceted electric amber & gold bolt on deep space obsidian squircle with cyber-neon rim.
 * @param {number} size Output dimension (e.g. 16, 20, 24, 32, 48, 64, 128, 256, 512)
 */
function drawAppIcon(size = 256) {
  const SS = size <= 32 ? 4 : (size <= 128 ? 2 : 1);
  const S = size * SS;
  const acc = new Float32Array(size * size * 4);

  const pad = S * 0.055;
  const boxW = S - pad * 2;
  const boxH = S - pad * 2;
  const cornerR = S * 0.23;

  const leftPoly = [
    [0.54, 0.10],
    [0.22, 0.54],
    [0.47, 0.54],
    [0.39, 0.90],
    [0.50, 0.49],
  ].map(([nx, ny]) => [pad + nx * boxW, pad + ny * boxH]);

  const rightPoly = [
    [0.54, 0.10],
    [0.50, 0.49],
    [0.39, 0.90],
    [0.78, 0.44],
    [0.53, 0.44],
  ].map(([nx, ny]) => [pad + nx * boxW, pad + ny * boxH]);

  const spine = [
    [pad + 0.54 * boxW, pad + 0.10 * boxH],
    [pad + 0.50 * boxW, pad + 0.49 * boxH],
    [pad + 0.39 * boxW, pad + 0.90 * boxH],
  ];

  const sparks = [
    { x: pad + 0.82 * boxW, y: pad + 0.22 * boxH, r: S * 0.024, cr: 0, cg: 240, cb: 255 },
    { x: pad + 0.18 * boxW, y: pad + 0.76 * boxH, r: S * 0.020, cr: 255, cg: 215, cb: 0 },
    { x: pad + 0.78 * boxW, y: pad + 0.74 * boxH, r: S * 0.016, cr: 245, cg: 166, cb: 35 },
  ];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      const cx = Math.min(Math.max(px, pad + cornerR), pad + boxW - cornerR);
      const cy = Math.min(Math.max(py, pad + cornerR), pad + boxH - cornerR);
      const dEdge = Math.hypot(px - cx, py - cy);
      if (dEdge > cornerR) continue;

      const nx = (px - pad) / boxW;
      const ny = (py - pad) / boxH;

      const gradT = 1.0 - (nx * 0.45 + ny * 0.55);
      let r = 9 + gradT * 22;
      let g = 11 + gradT * 26;
      let b = 16 + gradT * 36;

      const borderDist = cornerR - dEdge;
      if (borderDist < S * 0.035) {
        const rimIntensity = (1.0 - borderDist / (S * 0.035)) * (0.4 + (1.0 - ny) * 0.5);
        r += 245 * rimIntensity * 0.4;
        g += 166 * rimIntensity * 0.4;
        b += 35 * rimIntensity * 0.4;
      }

      const dCenter = Math.hypot(nx - 0.5, ny - 0.5);
      const glow = Math.max(0, 1.0 - dCenter * 2.2) * 0.28;
      r += 245 * glow;
      g += 166 * glow;
      b += 35 * glow;

      for (const sp of sparks) {
        const dSp = Math.hypot(px - sp.x, py - sp.y);
        if (dSp < sp.r * 2.5) {
          const spAlpha = Math.max(0, 1.0 - dSp / (sp.r * 2.5));
          r = r * (1 - spAlpha) + sp.cr * spAlpha;
          g = g * (1 - spAlpha) + sp.cg * spAlpha;
          b = b * (1 - spAlpha) + sp.cb * spAlpha;
        }
      }

      const inLeft = pointInPolygon(px, py, leftPoly);
      const inRight = pointInPolygon(px, py, rightPoly);

      if (inLeft) {
        const bt = ny;
        r = 255;
        g = 245 - bt * 85;
        b = 90 - bt * 60;
      } else if (inRight) {
        const bt = ny;
        r = 245 - bt * 40;
        g = 150 - bt * 50;
        b = 20 - bt * 10;
      }

      if (inLeft || inRight) {
        const dSpine1 = distToSegment(px, py, spine[0][0], spine[0][1], spine[1][0], spine[1][1]);
        const dSpine2 = distToSegment(px, py, spine[1][0], spine[1][1], spine[2][0], spine[2][1]);
        const dSpine = Math.min(dSpine1, dSpine2);
        const shineWidth = S * 0.022;
        if (dSpine < shineWidth) {
          const shine = (1.0 - dSpine / shineWidth) * 0.85;
          r = Math.min(255, r + 255 * shine);
          g = Math.min(255, g + 255 * shine);
          b = Math.min(255, b + 240 * shine);
        }
      }

      const oy = Math.floor(y / SS);
      const ox = Math.floor(x / SS);
      const idx = (oy * size + ox) * 4;
      acc[idx] += r;
      acc[idx + 1] += g;
      acc[idx + 2] += b;
      acc[idx + 3] += 255;
    }
  }

  const out = new Uint8Array(size * size * 4);
  const n = SS * SS;
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = Math.round(acc[i * 4] / n);
    out[i * 4 + 1] = Math.round(acc[i * 4 + 1] / n);
    out[i * 4 + 2] = Math.round(acc[i * 4 + 2] / n);
    out[i * 4 + 3] = Math.round(acc[i * 4 + 3] / n);
  }
  return encodePng(size, size, out);
}

module.exports = { encodePng, drawAppIcon };
