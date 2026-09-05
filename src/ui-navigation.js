(function exposeUiNavigation(globalScope) {
  'use strict';

  function nextGridIndex(current, key, count, columns = 4) {
    if (!Number.isInteger(current) || current < 0 || count < 1) return -1;
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
    if (!Object.hasOwn(offsets, key)) return current;
    return Math.max(0, Math.min(count - 1, current + offsets[key]));
  }

  const api = { nextGridIndex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.PondNavigation = api;
})(typeof window !== 'undefined' ? window : globalThis);
