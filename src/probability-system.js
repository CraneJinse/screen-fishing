(function exposeProbability(globalScope) {
  'use strict';
  const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic'];
  const RARITY_WEIGHTS = Object.freeze({ common: 7000, rare: 2000, epic: 700, legendary: 250, mythic: 50 });
  const DEFAULT_BAIT_ID = null;
  const BAIT_PROFILES = Object.freeze({
    none: Object.freeze({
      id: null,
      rarityWeights: Object.freeze({ common: 7000, rare: 2000, epic: 700, legendary: 250, mythic: 50 }),
      variantWeights: Object.freeze({ normal: 8800, alternate: 1000, golden: 170, iridescent: 30 })
    }),
    'bait-fresh': Object.freeze({
      id: 'bait-fresh',
      rarityWeights: Object.freeze({ common: 6200, rare: 2700, epic: 750, legendary: 300, mythic: 50 }),
      variantWeights: Object.freeze({ normal: 8000, alternate: 1700, golden: 250, iridescent: 50 })
    }),
    'bait-moon': Object.freeze({
      id: 'bait-moon',
      rarityWeights: Object.freeze({ common: 5400, rare: 3300, epic: 850, legendary: 380, mythic: 70 }),
      variantWeights: Object.freeze({ normal: 7000, alternate: 2400, golden: 500, iridescent: 100 })
    }),
    'bait-star': Object.freeze({
      id: 'bait-star',
      rarityWeights: Object.freeze({ common: 4600, rare: 3700, epic: 1050, legendary: 550, mythic: 100 }),
      variantWeights: Object.freeze({ normal: 6000, alternate: 3000, golden: 800, iridescent: 200 })
    })
  });
  // V3 samples a persisted renewal interval, rather than a Bernoulli roll each bite.
  const SPECIAL_INTERVAL_MIN = 3;
  const SPECIAL_INTERVAL_MAX = 7;
  const SPECIAL_RATE = 0.2;
  const SPECIAL_BASE_RATE_BP = 2000; // Long-run target; not a per-bite probability.
  const PROBABILITY_VERSION = 4;
  const NON_SPECIAL_STREAK_LIMIT = SPECIAL_INTERVAL_MAX - 1;
  const DUPLICATE_SPECIAL_STREAK_LIMIT = 8;
  const RANDOM_UNHOOK_RATE = 0.01;
  function unit(rng) { const n = Number(rng()); return Number.isFinite(n) ? Math.max(0, Math.min(1 - 1e-12, n)) : 0.5; }
  function namedStreams(rng) {
    const rootSeed = Math.floor(unit(rng) * 0x100000000) >>> 0;
    const hash = (label) => { let h = rootSeed ^ 0x9e3779b9; for (const c of label) h = Math.imul(h ^ c.charCodeAt(0), 0x45d9f3b) >>> 0; return h >>> 0; };
    const make = (label) => { let state = hash(label) || 0x6d2b79f5; return () => { let value = state = (state + 0x6d2b79f5) >>> 0; value = Math.imul(value ^ (value >>> 15), value | 1); value ^= value + Math.imul(value ^ (value >>> 7), value | 61); return ((value ^ (value >>> 14)) >>> 0) / 0x100000000; }; };
    return { rootSeed, encounterType: make('encounterType'), specialInterval: make('specialInterval'), specialSeries: make('specialSeries'), specialItem: make('specialItem'), pack: make('pack'), rarity: make('rarity'), species: make('species'), escape: make('escape'), variant: make('variant') };
  }
  function weighted(rng, entries, weight = (x) => x.weight) {
    const valid = entries.filter((x) => Number.isFinite(weight(x)) && weight(x) > 0);
    const total = valid.reduce((s, x) => s + weight(x), 0); if (!valid.length || total <= 0) return null;
    let cursor = unit(rng) * total; for (const item of valid) { cursor -= weight(item); if (cursor < 0) return item; } return valid[valid.length - 1];
  }
  function eligibleSpecialEvents(registry, habitat) { return (Array.isArray(registry) ? registry : []).filter((e) => e && e.enabled === true && (!Array.isArray(e.habitats) || e.habitats.includes(habitat)) && Number(e.baseWeight ?? e.weight) > 0); }
  function normalizeSpecialPity(counters = {}) {
    const p = counters.specialEventPity || counters;
    const safe = (v) => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number.isFinite(Number(v)) ? Number(v) : 0)));
    const interval = Number(p.nextSpecialAt);
    return {
      nonSpecialStreak: Math.min(NON_SPECIAL_STREAK_LIMIT, safe(p.nonSpecialStreak)),
      duplicateSpecialStreak: Math.min(DUPLICATE_SPECIAL_STREAK_LIMIT, safe(p.duplicateSpecialStreak)),
      nextSpecialAt: Number.isInteger(interval) && interval >= SPECIAL_INTERVAL_MIN && interval <= SPECIAL_INTERVAL_MAX ? interval : null
    };
  }
  function chooseSpecialInterval(rng) { return SPECIAL_INTERVAL_MIN + Math.floor(unit(rng) * (SPECIAL_INTERVAL_MAX - SPECIAL_INTERVAL_MIN + 1)); }
  function specialWeight(item, collection = {}) { return collection[item.id]?.count > 0 ? 50 : Number(item.baseWeight ?? item.weight ?? 100); }
  function chooseSpecial(rng, events, collection = {}, forceNew = false) {
    const pool = forceNew ? events.filter((item) => !(collection[item.id]?.count > 0)) : events;
    return weighted(rng, pool, (item) => specialWeight(item, collection));
  }
  function normalizeBaitId(value) { return typeof value === 'string' && Object.hasOwn(BAIT_PROFILES, value) && value !== 'none' ? value : DEFAULT_BAIT_ID; }
  function baitProfile(value) { return BAIT_PROFILES[normalizeBaitId(value) || 'none']; }
  function rarityWeights(baitId = DEFAULT_BAIT_ID) { return { ...baitProfile(baitId).rarityWeights }; }
  function chooseRarity(rng, baitId = DEFAULT_BAIT_ID) {
    const weights = rarityWeights(baitId);
    return weighted(rng, RARITIES.map((id) => ({ id, weight: weights[id] }))).id;
  }
  function choosePack(rng, packs) { const ids = [...new Set((Array.isArray(packs) ? packs : []).filter(Boolean))]; return ids.length ? ids[Math.floor(unit(rng) * ids.length)] : null; }
  function chooseFish(rng, fish, rarity) { const list = (Array.isArray(fish) ? fish : []).filter((f) => !rarity || f.rarity === rarity); return list.length ? list[Math.floor(unit(rng) * list.length)] : null; }
  function pityMinimum(counters = {}) {
    if (Number(counters.iridescentMisses) >= 359) return 3;
    if (Number(counters.goldenPlusMisses) >= 99) return 2;
    if (Number(counters.alternatePlusMisses) >= 19) return 1;
    return 0;
  }
  function variantWeights(counters = {}, variant = {}) {
    const base = { ...baitProfile(variant.baitId).variantWeights, ...(variant.weights || {}) };
    const goldenMiss = Math.max(0, Number(counters.goldenPlusMisses) || 0) - 44;
    const goldenBoost = goldenMiss > 0 ? Math.min(1700, Math.round(1700 * Math.pow(Math.min(1, goldenMiss / 55), 2))) : 0;
    const iridescentMiss = Math.max(0, Number(counters.iridescentMisses) || 0) - 179;
    const iridescentBoost = iridescentMiss > 0 ? Math.min(500, Math.round(500 * Math.pow(Math.min(1, iridescentMiss / 180), 2))) : 0;
    return {
      normal: Math.max(0, base.normal - goldenBoost - iridescentBoost),
      alternate: Math.max(0, base.alternate),
      golden: Math.max(0, base.golden + goldenBoost),
      iridescent: Math.max(0, base.iridescent + iridescentBoost)
    };
  }
  function rollVariant(rng, counters = {}, variant = {}) {
    const weights = variantWeights(counters, variant);
    const minimum = pityMinimum(counters);
    const entries = [{ id: 'normal', weight: weights.normal }, { id: 'alternate', weight: weights.alternate }, { id: 'golden', weight: weights.golden }, { id: 'iridescent', weight: weights.iridescent }];
    const natural = weighted(rng, entries).id;
    const level = (id) => entries.findIndex((e) => e.id === id);
    return level(natural) >= minimum ? natural : entries[minimum].id;
  }
  function updatePity(counters = {}, variant) {
    const next = { alternatePlusMisses: Number(counters.alternatePlusMisses) || 0, goldenPlusMisses: Number(counters.goldenPlusMisses) || 0, iridescentMisses: Number(counters.iridescentMisses) || 0 };
    if (variant !== 'normal') next.alternatePlusMisses = 0; else next.alternatePlusMisses++;
    if (variant === 'golden' || variant === 'iridescent') next.goldenPlusMisses = 0; else next.goldenPlusMisses++;
    if (variant === 'iridescent') next.iridescentMisses = 0; else next.iridescentMisses++;
    return next;
  }
  function encounter(rng, { habitat, unlockedPacks, fish, specialEvents = [], counters = {}, specialEventPity = null, collection = {}, baitId = DEFAULT_BAIT_ID, variantConfig } = {}) {
    const selectedBaitId = normalizeBaitId(baitId);
    const selectedRarityWeights = rarityWeights(selectedBaitId);
    const events = eligibleSpecialEvents(specialEvents, habitat);
    const trace = { baitId: selectedBaitId, special: null, pack: null, rarity: null, fish: null, randomUnhook: null, variant: null };
    const streams = events.length ? namedStreams(rng) : null;
    let nextSpecialEventPity = normalizeSpecialPity(specialEventPity || {});
    if (streams) trace.rngVersion = 'mulberry32-named-v1';
    if (events.length) {
      const pity = nextSpecialEventPity;
      const interval = pity.nextSpecialAt ?? chooseSpecialInterval(streams.specialInterval);
      const due = pity.nonSpecialStreak + 1 >= interval;
      trace.special = { roll: null, rate: SPECIAL_RATE, rateBp: SPECIAL_BASE_RATE_BP, candidateCount: events.length, interval, encounterIndex: pity.nonSpecialStreak + 1, topLevelMode: due ? 'scheduled_interval' : 'interval_wait' };
      nextSpecialEventPity = { ...pity, nextSpecialAt: interval, nonSpecialStreak: Math.min(NON_SPECIAL_STREAK_LIMIT, pity.nonSpecialStreak + 1) };
      if (due) {
        nextSpecialEventPity = { ...pity, nonSpecialStreak: 0, nextSpecialAt: chooseSpecialInterval(streams.specialInterval) };
        const forceNew = pity.duplicateSpecialStreak >= DUPLICATE_SPECIAL_STREAK_LIMIT && events.some((item) => !(collection[item.id]?.count > 0));
        const eligibleItems = forceNew ? events.filter((item) => !(collection[item.id]?.count > 0)) : events;
        const series = [...new Set(eligibleItems.map((item) => item.seriesId))].map((seriesId) => ({
          id: seriesId,
          items: eligibleItems.filter((item) => item.seriesId === seriesId),
          weight: eligibleItems.filter((item) => item.seriesId === seriesId).reduce((sum, item) => sum + specialWeight(item, collection), 0)
        }));
        const seriesRoll = unit(streams.specialSeries);
        const selectedSeries = weighted(() => seriesRoll, series);
        const eventRoll = unit(streams.specialItem);
        const event = chooseSpecial(() => eventRoll, selectedSeries?.items || eligibleItems, collection, false);
        trace.special.seriesRoll = seriesRoll; trace.special.seriesResult = selectedSeries?.id || null;
        trace.special.eventRoll = eventRoll; trace.special.result = event?.id || null; trace.special.selectionMode = forceNew ? 'new_item_pity' : 'weighted';
        return { type: 'special', encounterType: 'special', eventId: event?.id || null, seriesId: event?.seriesId || null, event: event || null, baitId: selectedBaitId, probabilityVersion: PROBABILITY_VERSION, topLevelMode: 'scheduled_interval', selectionMode: forceNew ? 'new_item_pity' : 'weighted', nextSpecialEventPity, rollTrace: trace };
      }
    } else trace.special = { roll: null, rate: 0, candidateCount: 0 };
    const packIds = [...new Set((Array.isArray(unlockedPacks) ? unlockedPacks : []).filter(Boolean))];
    const packRoll = unit(streams ? streams.pack : rng); const packId = packIds.length ? packIds[Math.floor(packRoll * packIds.length)] : null;
    trace.pack = { roll: packRoll, candidateCount: packIds.length, result: packId };
    const packFish = (fish || []).filter((f) => f.pack === packId);
    const rarityRoll = unit(streams ? streams.rarity : rng); const rarity = weighted(() => rarityRoll, RARITIES.map((id) => ({ id, weight: selectedRarityWeights[id] }))).id;
    trace.rarity = { roll: rarityRoll, candidateCount: RARITIES.length, weights: selectedRarityWeights, result: rarity };
    const list = packFish.filter((f) => f.rarity === rarity); const fishRoll = unit(streams ? streams.species : rng); const selected = list[Math.min(list.length - 1, Math.floor(fishRoll * list.length))] || packFish[0] || null;
    trace.fish = { roll: fishRoll, candidateCount: list.length, fallbackCandidateCount: packFish.length, result: selected?.id || null };
    if (!selected) return { type: 'none', encounterType: 'none', baitId: selectedBaitId, probabilityVersion: PROBABILITY_VERSION, nextSpecialEventPity: normalizeSpecialPity(specialEventPity || {}), rollTrace: trace };
    const unhookRoll = unit(streams ? streams.escape : rng); const randomUnhook = unhookRoll < RANDOM_UNHOOK_RATE;
    trace.randomUnhook = { roll: unhookRoll, rate: RANDOM_UNHOOK_RATE, result: randomUnhook };
    if (randomUnhook) return { type: 'random_unhook', encounterType: 'fish', packId, rarity: selected.rarity, fishId: selected.id, randomUnhook: true, variant: null, baitId: selectedBaitId, probabilityVersion: PROBABILITY_VERSION, nextSpecialEventPity, rollTrace: trace };
    const variantRoll = unit(streams ? streams.variant : rng); const variant = rollVariant(() => variantRoll, counters, { ...(variantConfig || {}), baitId: selectedBaitId }); trace.variant = { roll: variantRoll, weights: variantWeights(counters, { ...(variantConfig || {}), baitId: selectedBaitId }), result: variant };
    return { type: 'fish', encounterType: 'fish', packId, rarity: selected.rarity, fishId: selected.id, randomUnhook: false, variant, baitId: selectedBaitId, probabilityVersion: PROBABILITY_VERSION, nextSpecialEventPity, rollTrace: trace };
  }
  const api = { RARITIES, RARITY_WEIGHTS, DEFAULT_BAIT_ID, BAIT_PROFILES, SPECIAL_RATE, SPECIAL_BASE_RATE_BP, SPECIAL_INTERVAL_MIN, SPECIAL_INTERVAL_MAX, PROBABILITY_VERSION, NON_SPECIAL_STREAK_LIMIT, DUPLICATE_SPECIAL_STREAK_LIMIT, RANDOM_UNHOOK_RATE, weighted, eligibleSpecialEvents, normalizeSpecialPity, chooseSpecialInterval, namedStreams, chooseSpecial, normalizeBaitId, baitProfile, rarityWeights, chooseRarity, choosePack, chooseFish, pityMinimum, variantWeights, rollVariant, updatePity, encounter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; globalScope.PondProbability = api;
})(typeof window !== 'undefined' ? window : globalThis);
