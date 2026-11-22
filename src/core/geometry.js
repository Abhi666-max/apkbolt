'use strict';
/**
 * Pure coordinate geometry calculations (zero external dependencies).
 *
 * Electron screen / BrowserWindow DIP(); window
 * agent.ps1 per-monitor v2 DPI ,  Win32 SetWindowPos 
 * . ,  125% / 150% "window / /
 * "(issue #99). embedded mode _rect() scaleFactor, 
 * , window. 
 */

/**
 * Converts DIP coordinate rectangle to physical display pixels.
 * @param {{x:number,y:number,w:number,h:number}} rect DIP logical pixel rectangle
 * @param {number} [scaleFactor] Device scale factor (1 = identity)
 * @returns {{x:number,y:number,w:number,h:number}} Physical pixel rectangle
 */
function physicalRect(rect, scaleFactor) {
  const k = Number(scaleFactor) || 1;
  if (!rect || k === 1) return rect;
  return {
    x: Math.round(rect.x * k),
    y: Math.round(rect.y * k),
    w: Math.round(rect.w * k),
    h: Math.round(rect.h * k),
  };
}

module.exports = { physicalRect };
