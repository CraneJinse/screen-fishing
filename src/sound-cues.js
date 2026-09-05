(function exposeSoundCues(globalScope) {
  'use strict';

  function cuesForTransition(previousState, nextState, result) {
    const cues = [];
    if (previousState !== nextState) {
      if (nextState === 'casting') cues.push('cast');
      if (nextState === 'bite_intro') cues.push('bite');
      if (nextState === 'catch_flight') cues.push('breach');
      if (nextState === 'catch_land') cues.push('land');
      if (nextState === 'celebrating' && result && result.rarity !== 'common') cues.push('rare');
    }
    return cues;
  }

  const api = { cuesForTransition };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.PondSounds = api;
})(typeof window !== 'undefined' ? window : globalThis);
