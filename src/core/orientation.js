'use strict';
/**
 * orientation(,  Electron / adb / network, CI require). 
 *
 * :  main.js (wantLandscapeFor, 
 * rotate, rotate), "orientation", 
 * ( display.landscape,  appWin.state.landscape). 
 * rotate,  apps.json orientation, 
 * app wantLandscapeFor -- "". 
 * , , . 
 */

const ORIENTATION_MODES = ['auto', 'landscape', 'portrait'];

/**
 * applandscapeportrait. 
 *
 * ( → ): 
 * 1. settings(landscape / portrait)
 * 2. app(orientationOverride, rotate / )
 * 3. APK orientation(orientation)
 * 4. orientation(restart)
 */
function resolveLandscape({ mode = 'auto', orientation = null, orientationOverride = null, panelLandscape = false } = {}) {
  if (mode === 'landscape') return true;
  if (mode === 'portrait') return false;
  if (orientationOverride === 'landscape') return true;
  if (orientationOverride === 'portrait') return false;
  if (orientation === 'landscape') return true;
  if (orientation === 'portrait') return false;
  return !!panelLandscape;
}

/** orientation, rotate:  → ,  → */
function flipLandscape(current) {
  return !current;
}

/** : true → 'landscape', false → 'portrait'( apps.json ) */
function overrideValue(landscape) {
  return landscape ? 'landscape' : 'portrait';
}

/** orientation;  null(= ) */
function parseOverride(value) {
  if (value === 'landscape') return true;
  if (value === 'portrait') return false;
  return null;
}

/**
 * In-guest"rotate"default. 
 * ,  accelerometer_rotation 0 settings
 * "rotate". default(orientation
 * wm user-rotation lock + set-ignore-orientation-request , ), 
 * app Settings.System.ACCELEROMETER_ROTATION "". 
 * guest 0/1 . 
 */
function autoRotateSetting(settings) {
  const d = (settings && settings.display) || {};
  return d.autoRotate === false ? '0' : '1';
}

module.exports = {
  ORIENTATION_MODES,
  resolveLandscape,
  flipLandscape,
  overrideValue,
  parseOverride,
  autoRotateSetting,
};
