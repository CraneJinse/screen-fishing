(function exposeAchievementPopup(globalScope) {
  'use strict';

  function unlockedIds(state) {
    return new Set(Array.isArray(state?.achievements) ? state.achievements : []);
  }

  function createPopup(definition) {
    if (!definition?.id || !definition?.name || !definition?.iconPath) return null;
    return {
      type: 'achievement',
      achievementId: definition.id,
      title: definition.name,
      description: definition.description || '',
      seriesName: definition.seriesName || '成就',
      iconPath: definition.iconPath,
      points: Math.max(0, Number(definition.points) || 0)
    };
  }

  function newlyUnlocked(previousState, nextState, definitions) {
    const before = unlockedIds(previousState);
    const after = unlockedIds(nextState);
    return (Array.isArray(definitions) ? definitions : [])
      .filter((definition) => after.has(definition.id) && !before.has(definition.id))
      .map(createPopup)
      .filter(Boolean);
  }

  const api = { createPopup, newlyUnlocked };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.PondAchievementPopup = api;
})(typeof window !== 'undefined' ? window : globalThis);
