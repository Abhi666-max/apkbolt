'use strict';
/**
 * runtimeslim：emulator「launch」。
 *
 * emulator.js launchparameters：
 * - x86_64 system image（API30 AOSP） → qemu-system-aarch64.exe 
 * - -gpu software（swiftshader ） → vulkan / gles_angle 
 * - 38px → emulator、WebEngine 
 *
 * network netsimd / netsim / nimble_bridge ：
 * wifi / ，app，「」。
 *
 * ：
 * node build/slim-runtime.js build/runtime # （default）
 * node build/slim-runtime.js build/runtime --aggressive # QtWebEngine（-169MB）
 *   node build/slim-runtime.js build/runtime --dry-run
 */
const fs = require('fs');
const path = require('path');

/**
 * ：（ -190MB）。
 * （，）：
 * - Qt6WebEngineCoreAndroidEmu.dll emulator.exe （）， → 
 * - lib64/gles_angle vk_swiftshader，swiftshader → 
 * - lib64/vulkan （ + ）， → 103MB
 */
const SAFE = [
  ['emulator/qemu/windows-x86_64/qemu-system-aarch64.exe', 'arm64  QEMU （ x86_64 ）'],
  // note：directory emulator/lib64/vulkan —— vulkan-1.dll -gpu host ，
  // host failure、（ AMD 780M ）。：
  ['emulator/lib64/vulkan/layers', 'Vulkan （host ，-20MB）'],
  ['emulator/lib64/vulkan/glslangValidator.exe', '（，-7MB）'],
  ['emulator/lib64/vulkan/libvulkan_lvp.dll', 'lavapipe  Vulkan （，-53MB）'],
  ['emulator/lib64/vulkan/lvp_icd.json', 'lavapipe  ICD （-1KB）'],
  ['emulator/lib64/vulkan/vk_swiftshader.dll', 'SwiftShader Vulkan（gles_angle ，-23MB）'],
  ['emulator/lib64/qt/translations', '（ 38px ）'],
  // note： emulator-check.exe —— emulator -accel-check check AEHD/WHPX，
  // "hardware acceleration" TCG software emulation（boot 42s 10 +）。
  ['emulator/qsn.exe', 'QEMU （emulator.exe ， strings ，-34MB）'],
  ['emulator/resources/Toren1BD_Main.png', 'VR （，-3.7MB）'],
  ['emulator/resources/Toren1BD_Decor.png', 'VR （-3.5MB）'],
  ['emulator/resources/Toren1BD.obj', 'VR  3D （-3.5MB）'],
  ['emulator/resources/macroPreviews', '（-2.7MB）'],
  ['emulator/resources/default360.mp4', '360° （-2.4MB）'],
];

/** ：WebEngine 、gles_angle ， */
const AGGRESSIVE = [];

function sizeOf(p) {
  let s = 0;
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    for (const e of fs.readdirSync(p, { withFileTypes: true })) s += sizeOf(path.join(p, e.name));
  } catch (_) { /* ignore */ }
  return s;
}

function slim(root, { aggressive = false, dryRun = false, log = console.log } = {}) {
  if (!fs.existsSync(path.join(root, 'emulator', 'emulator.exe'))) {
    throw new Error(`${root} （ emulator/emulator.exe）`);
  }
  const list = aggressive ? SAFE.concat(AGGRESSIVE) : SAFE;
  let freed = 0;
  for (const [rel, why] of list) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    const n = sizeOf(p);
    if (!dryRun) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch (e) {
        log(`   ${rel}：${e.message}`);
        continue;
      }
    }
    freed += n;
    log(`   ${rel}（${(n / 1048576).toFixed(0)} MB）— ${why}`);
  }
  log(`${dryRun ? '' : ''} ${(freed / 1048576).toFixed(0)} MB`);
  return freed;
}

module.exports = { slim };

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, 'runtime'));
  const aggressive = process.argv.includes('--aggressive');
  const dryRun = process.argv.includes('--dry-run');
  console.log(`：${root}（${aggressive ? '' : ''}）`);
  slim(root, { aggressive, dryRun });
}
