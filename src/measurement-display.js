(function exposeMeasurementDisplay(globalScope) {
  'use strict';

  function profileMap(data) {
    const entries = Array.isArray(data?.entries) ? data.entries : null;
    if (entries) return Object.fromEntries(entries.filter((item) => item?.fishId).map((item) => [item.fishId, item]));
    return data?.entries && typeof data.entries === 'object' ? data.entries : data && typeof data === 'object' ? data : {};
  }
  function rangeText(range, unit) {
    if (!range || !Number.isFinite(Number(range.min)) || !Number.isFinite(Number(range.max))) return '暂未收录';
    const typical = Number.isFinite(Number(range.typical)) ? `，常见 ${Number(range.typical).toLocaleString('zh-CN')} ${unit}` : '';
    return `${Number(range.min).toLocaleString('zh-CN')}–${Number(range.max).toLocaleString('zh-CN')} ${unit}${typical}`;
  }
  function description(profile) {
    return String(profile?.descriptionZh || profile?.realityDescriptionZh || profile?.description || '').trim();
  }

  const api = { profileMap, rangeText, description };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.PondMeasurements = api;
})(typeof window !== 'undefined' ? window : globalThis);
