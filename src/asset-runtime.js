'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ACTION_FRAME_COUNTS = Object.freeze({
  idle: 6, idle_yawn: 8, click_react: 4, menu_greet: 4, drag_idle: 6,
  drag_fishing: 6, cast: 8, waiting: 6, bite_intro: 6, bite_loop: 8,
  bite_urgent: 8, reel_pull: 8, catch_flight: 10, catch_land: 6,
  fish_escape: 8, sad_recover: 6, empty_reel: 6, celebrate_common: 6,
  celebrate_rare: 8, celebrate_epic: 8, celebrate_legendary: 8,
  celebrate_mythic: 8
});

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function pngSize(file) {
  try {
    const header = Buffer.alloc(24);
    const descriptor = fs.openSync(file, 'r');
    try { fs.readSync(descriptor, header, 0, 24, 0); } finally { fs.closeSync(descriptor); }
    if (header.toString('ascii', 1, 4) !== 'PNG') return null;
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } catch { return null; }
}

function safeRelative(value, extension) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..') || normalized.includes(':')) return null;
  if (extension && !normalized.toLowerCase().endsWith(extension)) return null;
  return normalized;
}

function safeImageRelative(value) {
  return safeRelative(value, '.png') || safeRelative(value, '.svg');
}

function validateActionManifest(data, rootDir) {
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== 'object') return { valid: false, errors: ['manifest-not-object'], warnings, coverage: '0/22' };
  if (data.schemaVersion !== '1.0.0') warnings.push('schema-version-not-1.0.0');
  if (Number(data.canvas?.width) !== 192 || Number(data.canvas?.height) !== 208) errors.push('logical-canvas-must-be-192x208');
  const actions = data.actions && typeof data.actions === 'object' ? data.actions : {};
  for (const [actionId, expectedFrames] of Object.entries(ACTION_FRAME_COUNTS)) {
    const action = actions[actionId];
    if (!action) { errors.push(`missing-action:${actionId}`); continue; }
    const file = safeRelative(action.file, '.png');
    if (!file) errors.push(`unsafe-action-path:${actionId}`);
    else if (rootDir && !fs.existsSync(path.join(rootDir, file))) errors.push(`missing-action-file:${actionId}`);
    else if (rootDir) {
      const size = pngSize(path.join(rootDir, file));
      if (!size || size.width !== Number(action.frameWidth) * expectedFrames || size.height !== Number(action.frameHeight)) errors.push(`wrong-action-image-size:${actionId}`);
    }
    if (Number(action.frameCount) !== expectedFrames) errors.push(`wrong-frame-count:${actionId}`);
    if (!Array.isArray(action.frames) || action.frames.length !== expectedFrames) errors.push(`wrong-frame-metadata:${actionId}`);
    for (const [index, frame] of (action.frames || []).entries()) {
      const anchor = frame?.fishAnchor;
      if (anchor && (!(anchor.x >= 0 && anchor.x <= 192) || !(anchor.y >= 0 && anchor.y <= 208) || !(anchor.pose >= 0 && anchor.pose <= 3))) errors.push(`invalid-fish-anchor:${actionId}:${index}`);
    }
  }
  const commitEvents = Object.entries(actions).flatMap(([actionId, action]) => (action.frames || []).flatMap((frame, index) => (frame.events || []).includes('catch_committed') ? [`${actionId}:${index}`] : []));
  if (commitEvents.length !== 1 || commitEvents[0] !== 'catch_land:1') errors.push('catch-committed-event-must-be-catch_land:1');
  const cardEvents = Object.entries(actions).flatMap(([actionId, action]) => (action.frames || []).flatMap((frame, index) => (frame.events || []).includes('result_card_show') ? [`${actionId}:${index}`] : []));
  if (cardEvents.length !== 1 || cardEvents[0] !== 'catch_land:1') errors.push('result-card-event-must-be-catch_land:1');
  const present = Object.keys(ACTION_FRAME_COUNTS).filter((id) => actions[id]).length;
  return { valid: errors.length === 0, errors, warnings, coverage: `${present}/22` };
}

function actionTimings(data) {
  const timings = {};
  for (const [id, action] of Object.entries(data?.actions || {})) {
    const count = Math.max(1, Number(action.frameCount) || 1);
    const durations = Array.isArray(action.frameDurationsMs) && action.frameDurationsMs.length === count
      ? action.frameDurationsMs.map((value) => Math.max(16, Number(value) || 16))
      : Array.from({ length: count }, () => Math.max(16, Number(action.frameDurationMs) || 120));
    const frameStartMs = [];
    let totalMs = 0;
    for (const duration of durations) { frameStartMs.push(totalMs); totalMs += duration; }
    timings[id] = { totalMs, frameStartMs };
  }
  return timings;
}

function validateMotion(data, fishId) {
  const errors = [];
  if (!data || typeof data !== 'object') return { valid: false, errors: ['motion-not-object'] };
  if (data.fishId !== fishId) errors.push('fish-id-mismatch');
  if (Number(data.frameCount) !== 4 || Number(data.frameWidth) !== 64 || Number(data.frameHeight) !== 64) errors.push('motion-grid-must-be-4x64x64');
  if (!Array.isArray(data.flightPoseSequence) || data.flightPoseSequence.length !== 10 || data.flightPoseSequence.some((pose) => !Number.isInteger(pose) || pose < 0 || pose > 3)) errors.push('flight-sequence-invalid');
  else if (new Set(data.flightPoseSequence).size !== 4) errors.push('flight-sequence-must-use-all-poses');
  if (!Array.isArray(data.frames) || data.frames.length !== 4) errors.push('motion-frame-metadata-invalid');
  for (const frame of data.frames || []) {
    const anchor = frame?.hookAnchor;
    if (!anchor || !(anchor.x >= 0 && anchor.x < 64) || !(anchor.y >= 0 && anchor.y < 64)) errors.push('hook-anchor-invalid');
    const center = frame?.visualCenter;
    if (!center || !(center.x >= 0 && center.x < 64) || !(center.y >= 0 && center.y < 64)) errors.push('visual-center-invalid');
    const bounds = frame?.safeBounds;
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)
      || !(bounds.width > 0) || !(bounds.height > 0)
      || bounds.x < 0 || bounds.y < 0
      || bounds.x + bounds.width > 64 || bounds.y + bounds.height > 64) errors.push('safe-bounds-invalid');
  }
  return { valid: errors.length === 0, errors };
}

function validateFishManifest(data, rootDir, catalog, options = {}) {
  const errors = [];
  const warnings = [];
  const catalogIds = new Set(catalog.map((fish) => fish.id));
  const seen = new Set();
  let iconCount = 0;
  let airborneCount = 0;
  let motionCount = 0;
  const entries = [];
  for (const source of Array.isArray(data?.entries) ? data.entries : []) {
    const fishId = source.fishId || source.id || `fish-${source.catalogIndex}`;
    if (!catalogIds.has(fishId) || seen.has(fishId)) { warnings.push(`ignored-fish:${fishId}`); continue; }
    seen.add(fishId);
    const entry = { ...source, fishId };
    const icon = safeRelative(source.icon || source.path, '.png');
    if (icon && (!rootDir || fs.existsSync(path.join(rootDir, icon)))) {
      const size = rootDir ? pngSize(path.join(rootDir, icon)) : { width: 64, height: 64 };
      if (size?.width === 64 && size?.height === 64) { entry.icon = icon; iconCount += 1; }
      else warnings.push(`wrong-icon-size:${fishId}`);
    }
    else warnings.push(`missing-icon:${fishId}`);
    const airborne = safeRelative(source.airborneStrip, '.png');
    if (airborne && (!rootDir || fs.existsSync(path.join(rootDir, airborne)))) {
      const size = rootDir ? pngSize(path.join(rootDir, airborne)) : { width: 256, height: 64 };
      if (size?.width === 256 && size?.height === 64) { entry.airborneStrip = airborne; airborneCount += 1; }
      else warnings.push(`wrong-airborne-size:${fishId}`);
    }
    const motion = safeRelative(source.motion, '.json');
    if (motion && rootDir && fs.existsSync(path.join(rootDir, motion))) {
      const motionData = readJson(path.join(rootDir, motion));
      const validation = validateMotion(motionData, fishId);
      if (validation.valid) { entry.motionData = motionData; motionCount += 1; }
      else warnings.push(...validation.errors.map((error) => `${error}:${fishId}`));
    }
    entries.push(entry);
  }
  if (options.requireComplete) {
    const expected = catalog.length;
    if (seen.size !== expected) errors.push(`fish-entry-coverage:${seen.size}/${expected}`);
    if (iconCount !== expected) errors.push(`fish-icon-coverage:${iconCount}/${expected}`);
    if (airborneCount !== expected) errors.push(`fish-airborne-coverage:${airborneCount}/${expected}`);
    if (motionCount !== expected) errors.push(`fish-motion-coverage:${motionCount}/${expected}`);
  }
  return { valid: errors.length === 0, errors, warnings, entries, coverage: { entries: seen.size, icons: iconCount, airborne: airborneCount, motions: motionCount, total: catalog.length } };
}

const VARIANT_FIELDS = Object.freeze({
  normal: Object.freeze({ icon: [64, 64], airborneStrip: [256, 64] }),
  alternate: Object.freeze({ icon: [64, 64], airborneStrip: [256, 64] }),
  golden: Object.freeze({ icon: [64, 64], airborneStrip: [256, 64] }),
  iridescent: Object.freeze({
    baseIcon: [64, 64], bodyMask: [64, 64], detailOverlay: [64, 64],
    baseAirborneStrip: [256, 64], airborneMask: [256, 64], detailOverlayStrip: [256, 64]
  })
});

function validateVariantManifest(data, rootDir, catalog, options = {}) {
  const errors = [];
  const warnings = [];
  const catalogIds = new Set(catalog.map((fish) => fish.id));
  const seen = new Set();
  const entries = [];
  for (const source of Array.isArray(data?.entries) ? data.entries : []) {
    const fishId = String(source?.fishId || '');
    if (!catalogIds.has(fishId) || seen.has(fishId)) {
      errors.push(`unknown-or-duplicate-fish:${fishId || 'empty'}`);
      continue;
    }
    seen.add(fishId);
    const packPrefix = String(source.pack || '').toLowerCase();
    if (!['f1', 'f2', 's1', 's2'].includes(packPrefix)) {
      errors.push(`invalid-pack:${fishId}`);
      continue;
    }
    const normalizedVariants = {};
    for (const [variant, fields] of Object.entries(VARIANT_FIELDS)) {
      const variantSource = source.variants?.[variant];
      if (!variantSource) {
        errors.push(`missing-variant:${fishId}:${variant}`);
        continue;
      }
      normalizedVariants[variant] = {};
      for (const [field, expected] of Object.entries(fields)) {
        const raw = safeRelative(variantSource[field], '.png');
        const relative = raw && raw.startsWith(`${packPrefix}/`) ? raw : raw ? `${packPrefix}/${raw}` : null;
        if (!relative) {
          errors.push(`unsafe-variant-path:${fishId}:${variant}:${field}`);
          continue;
        }
        const file = rootDir ? path.join(rootDir, relative) : null;
        const size = file && fs.existsSync(file) ? pngSize(file) : null;
        if (rootDir && !size) errors.push(`missing-variant-file:${fishId}:${variant}:${field}`);
        else if (size && (size.width !== expected[0] || size.height !== expected[1])) {
          errors.push(`wrong-variant-size:${fishId}:${variant}:${field}:${size.width}x${size.height}`);
        }
        normalizedVariants[variant][field] = relative;
      }
    }
    entries.push({ ...source, variants: normalizedVariants });
  }
  if (options.requireComplete && seen.size !== catalog.length) errors.push(`variant-entry-coverage:${seen.size}/${catalog.length}`);
  if (Number(data?.variantCount) !== 4) errors.push('variant-count-must-be-4');
  if (Number(data?.speciesCount) !== catalog.length) errors.push(`variant-species-count:${data?.speciesCount}/${catalog.length}`);
  return {
    valid: errors.length === 0, errors, warnings, entries,
    coverage: { entries: seen.size, variants: entries.reduce((sum, entry) => sum + Object.keys(entry.variants || {}).length, 0), total: catalog.length }
  };
}

function validateIconManifest(data, rootDir, idField) {
  const errors = [];
  const entries = [];
  const seen = new Set();
  for (const entry of Array.isArray(data?.entries) ? data.entries : []) {
    const id = entry?.[idField];
    const icon = safeImageRelative(entry?.path || entry?.icon);
    if (!id || seen.has(id)) { errors.push(`duplicate-or-missing-id:${id || 'empty'}`); continue; }
    seen.add(id);
    if (!icon || (rootDir && !fs.existsSync(path.join(rootDir, icon)))) { errors.push(`missing-icon:${id}`); continue; }
    entries.push({ ...entry, [entry.path ? 'path' : 'icon']: icon });
  }
  return { valid: errors.length === 0, errors, entries, count: entries.length };
}

function buildAssetSnapshot(projectRoot, catalog) {
  const manifests = [];
  const diagnostics = { generatedAt: new Date().toISOString(), action: null, fish: [], variants: null, ui: [], fallbacks: [] };
  const petRelative = 'assets/pet/v1-runtime/action-manifest.json';
  const petData = readJson(path.join(projectRoot, petRelative));
  if (petData) {
    const basePath = path.posix.dirname(petRelative);
    const validation = validateActionManifest(petData, path.join(projectRoot, basePath));
    diagnostics.action = validation;
    if (validation.valid) {
      manifests.push({ id: 'pet', basePath, data: petData });
      diagnostics.timings = actionTimings(petData);
    }
    else diagnostics.fallbacks.push('pet-design-fallback');
  } else diagnostics.fallbacks.push('pet-design-fallback');
  const runtimeFishRelative = 'assets/fish/runtime-manifest.json';
  const runtimeFish = readJson(path.join(projectRoot, runtimeFishRelative));
  if (runtimeFish) {
    const basePath = path.posix.dirname(runtimeFishRelative);
    const validation = validateFishManifest(runtimeFish, path.join(projectRoot, basePath), catalog, { requireComplete: true });
    diagnostics.fish.push({ id: 'fish', ...validation, entries: undefined });
    if (validation.valid) manifests.push({ id: 'fish', basePath, data: { ...runtimeFish, entries: validation.entries } });
    else diagnostics.fallbacks.push('fish-runtime-fallback');
  }
  for (const pack of ['f1', 'f2', 's1', 's2']) {
    const relative = `assets/fish/${pack}/manifest.json`;
    const data = readJson(path.join(projectRoot, relative));
    if (!data) continue;
    const basePath = path.posix.dirname(relative);
    const validation = validateFishManifest(data, path.join(projectRoot, basePath), catalog);
    diagnostics.fish.push({ id: `fish-${pack}`, ...validation, entries: undefined });
    manifests.push({ id: `fish-${pack}`, basePath, data: { ...data, entries: validation.entries } });
  }
  const variantsRelative = 'assets/fish/variants/manifest.json';
  const variantsData = readJson(path.join(projectRoot, variantsRelative));
  if (variantsData) {
    const basePath = path.posix.dirname(variantsRelative);
    const validation = validateVariantManifest(variantsData, path.join(projectRoot, basePath), catalog, { requireComplete: true });
    diagnostics.variants = { ...validation, entries: undefined };
    if (validation.valid) manifests.push({ id: 'fish-variants', basePath, data: { ...variantsData, entries: validation.entries } });
    else diagnostics.fallbacks.push('fish-variants-fallback');
  } else diagnostics.fallbacks.push('fish-variants-fallback');
  for (const [id, relative, idField] of [['achievements', 'assets/ui/achievement-manifest.json', 'achievementId'], ['ui', 'assets/ui/ui-manifest.json', 'iconId']]) {
    const data = readJson(path.join(projectRoot, relative));
    if (!data) continue;
    const basePath = path.posix.dirname(relative);
    const validation = validateIconManifest(data, path.join(projectRoot, basePath), idField);
    diagnostics.ui.push({ id, valid: validation.valid, count: validation.count, errors: validation.errors });
    manifests.push({ id, basePath, data: { ...data, entries: validation.entries } });
  }
  const measurements = readJson(path.join(projectRoot, 'data/fish-measurements.json'));
  if (measurements) manifests.push({ id: 'measurements', basePath: 'data', data: measurements });
  return { manifests, fallbackPet: 'assets/pet/v4-design-gate/canonical-seated-fishing.png', timings: diagnostics.timings || {}, diagnostics };
}

module.exports = { ACTION_FRAME_COUNTS, VARIANT_FIELDS, pngSize, safeRelative, safeImageRelative, validateActionManifest, actionTimings, validateMotion, validateFishManifest, validateVariantManifest, validateIconManifest, buildAssetSnapshot };
