(function exposeVariants(globalScope) {
  'use strict';
  const VARIANTS = Object.freeze(['normal', 'alternate', 'golden', 'iridescent']);
  const VARIANT_NAMES = Object.freeze({ normal: '原色', alternate: '异色', golden: '纯金', iridescent: '炫彩' });
  const VALUE_MULTIPLIERS = Object.freeze({ normal: 1, alternate: 1.5, golden: 4, iridescent: 8 });
  function normalizeVariant(value) { return VARIANTS.includes(value) ? value : 'normal'; }
  function variantStats(record = {}, legacyCount = 0, legacy = {}) {
    return Object.fromEntries(VARIANTS.map((v) => {
      const item = record[v];
      const explicit = item && typeof item === 'object';
      return [v, {
        count: Math.max(0, explicit ? Number(item.count) || 0 : (v === 'normal' ? Number(legacyCount) || 0 : 0)),
        firstAt: explicit ? item.firstAt || null : (v === 'normal' ? legacy.firstAt || null : null),
        maxLengthCm: Math.max(0, explicit ? Number(item.maxLengthCm) || 0 : (v === 'normal' ? Number(legacy.maxLengthCm) || 0 : 0)),
        maxWeightKg: Math.max(0, explicit ? Number(item.maxWeightKg) || 0 : (v === 'normal' ? Number(legacy.maxWeightKg) || 0 : 0))
      }];
    }));
  }
  function applyCatch(record, variant, now, measurement = {}) { const stats = variantStats(record); const key = normalizeVariant(variant); stats[key].count++; if (!stats[key].firstAt) stats[key].firstAt = now; stats[key].maxLengthCm = Math.max(stats[key].maxLengthCm, Number(measurement.lengthCm) || 0); stats[key].maxWeightKg = Math.max(stats[key].maxWeightKg, Number(measurement.weightKg) || 0); return stats; }
  function isProtected(entry) { return Boolean(entry?.locked) || Boolean(entry?.autoLocked); }
  function assetFor(manifest, fishId, variant = 'normal') { const entry = manifest?.entries?.find((x) => x.fishId === fishId); return entry?.variants?.[normalizeVariant(variant)] || entry?.variants?.normal || null; }
  const api = { VARIANTS, VARIANT_NAMES, VALUE_MULTIPLIERS, normalizeVariant, variantStats, applyCatch, isProtected, assetFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; globalScope.PondVariants = api;
})(typeof window !== 'undefined' ? window : globalThis);
