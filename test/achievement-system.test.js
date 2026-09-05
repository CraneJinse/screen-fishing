'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const G = require('../src/game-state-runtime');
const A = require('../src/achievement-system');
const Events = require('../src/special-events');
const draft = require('../docs/specifications/achievements/ACHIEVEMENT_CANDIDATES_71.json');

function fishRecord(count = 1) { return { count, firstAt: 1, lastAt: 2, maxLengthCm: 20, maxWeightKg: .2, variants: { normal: { count } } }; }
function stateFor(metric, value) {
  const s = G.createInitialState(100);
  if (['castCount'].includes(metric)) s[metric] = value;
  else if (['totalCatchCount', 'uniqueSpeciesCount', 'largestLengthCm', 'largestWeightKg'].includes(metric)) s.stats[metric] = value;
  else if (metric.startsWith('rarity.')) s.stats.rarity[metric.split('.')[1]] = value;
  else if (metric.startsWith('packUnique.')) for (const fish of G.FISH.filter(f => f.pack === metric.split('.')[1]).slice(0, value)) s.collection[fish.id] = fishRecord();
  else if (metric === 'maxSpeciesCatchCount') s.collection[G.FISH[0].id] = fishRecord(value);
  else if (metric === 'raritiesDiscovered') for (const r of G.RARITIES.slice(0, value)) s.stats.rarity[r] = 1;
  else if (metric.startsWith('variantCatchCount.')) s.collection[G.FISH[0].id] = { ...fishRecord(value), variants: { [metric.split('.')[1]]: { count: value } } };
  else if (metric.startsWith('variantSpeciesCount.')) for (const f of G.FISH.slice(0, value)) s.collection[f.id] = { ...fishRecord(), variants: { [metric.split('.')[1]]: { count: 1 } } };
  else if (metric === 'maxVariantsPerSpecies') s.collection[G.FISH[0].id] = { ...fishRecord(), variants: Object.fromEntries(['normal','alternate','golden','iridescent'].map((v, i) => [v, { count: i < value ? 1 : 0 }])) };
  else if (metric === 'speciesVariantPairs') {
    for (let i = 0; i < value; i++) {
      const id = G.FISH[Math.floor(i / 4)].id;
      if (!s.collection[id]) s.collection[id] = { ...fishRecord(), variants: Object.fromEntries(['normal','alternate','golden','iridescent'].map(v => [v, { count: 0 }])) };
      s.collection[id].variants[['normal','alternate','golden','iridescent'][i % 4]].count = 1;
    }
  } else if (metric.startsWith('specialUnique.')) for (const e of Events.REGISTRY.filter(e => e.seriesId === metric.split('.')[1]).slice(0, value)) s.specialEventCollection.entries[e.id] = { count: 1 };
  else if (metric === 'specialUniqueTotal') for (const e of Events.REGISTRY.slice(0, value)) s.specialEventCollection.entries[e.id] = { count: 1 };
  else if (metric === 'wallet.totalEarned') s.wallet.totalEarned = value;
  else if (metric.startsWith('ownedPack.')) s.ownedPacks = value ? ['F1', metric.split('.')[1]] : ['F1'];
  else if (metric === 'cornerCount') s.cornerCasts = Object.fromEntries(A.CORNERS.slice(0, value).map(id => [id, 100]));
  else if (['smallLengthCatchCount','smallWeightCatchCount','soldFishCount','bestUniqueFiveWindow'].includes(metric)) s.achievementData[metric] = value;
  else throw Error(`Missing fixture ${metric}`);
  return s;
}
function catchFish(state, index, id = `catch-${index}-${state.catches}`) {
  return G.commitCatch({ ...state, fishingState: 'catch_land', catchCommitted: false, currentResult: null, pendingCatch: { encounterType: 'fish', fishId: G.FISH[index].id, catchId: id, selectedAt: 5, measurementRolls: [.5,.5] } }, () => .5, 1000 + state.catches);
}
function catchSpecial(state, id, receipt = id) {
  return G.commitCatch({ ...state, fishingState: 'catch_land', catchCommitted: false, currentResult: null, pendingCatch: { encounterType: 'special', eventId: id, catchId: receipt } }, () => .5, 2000);
}

test('71 definitions match accepted IDs, fixed counts, points, series and removed IDs', () => {
  assert.equal(G.ACHIEVEMENTS.length, 71);
  assert.deepEqual(G.ACHIEVEMENTS.map(a => a.id), draft.candidates.map(a => a.id));
  assert.equal(G.ACHIEVEMENTS.reduce((n,a) => n + a.points, 0), 1255);
  assert.equal(G.ACHIEVEMENTS.filter(a => a.retroactive === 'A').length, 65);
  assert.equal(G.ACHIEVEMENTS.filter(a => a.retroactive === 'B').length, 6);
  assert.equal(G.ACHIEVEMENT_SERIES.length, 10);
  assert.equal(G.ACHIEVEMENTS.find(a => a.id === 'corners').target, 4);
  assert.ok(G.ACHIEVEMENTS.every(a => a.iconPath === `assets/ui/achievements-v2/${a.id}.png`));
});

test('all 71 thresholds fail below the boundary and unlock exactly on it', async t => {
  for (const a of G.ACHIEVEMENTS) await t.test(`${a.number} ${a.id}`, () => {
    const below = stateFor(a.stat, a.target - 1), exact = stateFor(a.stat, a.target);
    if (a.id === 'all-species') {
      for (const f of G.FISH.slice(0,151)) below.collection[f.id] = fishRecord();
      for (const f of G.FISH) exact.collection[f.id] = fishRecord();
    }
    assert.equal(G.achievementProgress(below, a), a.target - 1);
    assert.equal(G.achievementProgress(exact, a.id), a.target);
    assert.ok(!G.unlockAchievements(below, 123).achievements.includes(a.id));
    const result = G.unlockAchievements(exact, 123);
    assert.ok(result.achievements.includes(a.id));
    assert.equal(result.achievementTimes[a.id], 123);
    assert.equal(result.achievementMetadata[a.id].pointsAtUnlock, a.points);
    assert.equal(result.achievementMetadata[a.id].source, 'earned');
    assert.deepEqual(G.unlockAchievements(result, 999).achievementTimes, result.achievementTimes);
  });
});

test('legacy grant preserves all 18 active IDs and times; old 092 stays archived', () => {
  const ids = draft.candidates.filter(a => a.existing).map(a => a.id);
  const old = { achievements: [...ids, 'variety-streak-5', 'old-unknown'], achievementTimes: Object.fromEntries([...ids, 'variety-streak-5'].map(id => [id, 12])) };
  const s = G.normalizeState(old, 100);
  for (const id of ids) { assert.ok(s.achievements.includes(id)); assert.equal(s.achievementTimes[id], 12); }
  assert.ok(!s.achievements.includes('variety-streak-5'));
  assert.ok(!s.achievements.includes('five-unique-window'));
  assert.equal(s.achievementArchive['variety-streak-5'].unlockedAt, 12);
  assert.ok(s.achievementArchive['old-unknown']);
  assert.deepEqual(G.normalizeState(s, 500).achievementArchive, s.achievementArchive);
});

test('migration uses explicit deduplicated sale and small-size evidence only once', () => {
  const id = G.FISH[0].id;
  const row = { type: 'fish', resultId: id, catchId: 'evidence', at: 1, lengthCm: 5, weightKg: .01, soldAt: 2 };
  const old = { measurementVersion: 5, stats: { totalCatchCount: 2000 }, history: [row, row], inventory: [{ ...row, fishId: id }] };
  const s = G.normalizeState(old, 50);
  assert.equal(s.achievementData.soldFishCount, 1);
  assert.equal(s.achievementData.smallLengthCatchCount, 1);
  assert.equal(s.achievementData.smallWeightCatchCount, 1);
  assert.equal(s.achievementMetadata['sale-first'].source, 'retroactive');
  assert.equal(G.achievementDetails(s, 'sale-100').partialHistory, true);
  assert.equal(G.normalizeState(s, 100).achievementData.soldFishCount, 1);
  const missing = G.normalizeState({ measurementVersion: 5, history: [{ type: 'fish', resultId: id, catchId: 'missing', size: '1 cm', weight: '1 g' }] }, 50);
  assert.equal(missing.achievementData.smallLengthCatchCount, 0);
  assert.equal(missing.achievementData.smallWeightCatchCount, 0);
});

test('old measurement models cannot grant size awards before repair', () => {
  const id = G.FISH[0].id;
  const old = { measurementVersion: 1, collection: { [id]: { ...fishRecord(), maxLengthCm: 10000, maxWeightKg: 10000 } }, history: [{ type: 'fish', resultId: id, catchId: 'old', lengthCm: 10000, weightKg: 10000, measurementVersion: 1 }] };
  const s = G.normalizeState(old, 50);
  assert.equal(s.achievementData.pendingMeasurements, true);
  assert.ok(!s.achievements.includes('length-200'));
  assert.ok(!s.achievements.includes('weight-50'));
  const repaired = G.repairLegacyMeasurements(s);
  assert.equal(repaired.achievementData.pendingMeasurements, false);
  assert.ok(!repaired.achievements.includes('length-200'));
  assert.ok(!repaired.achievements.includes('weight-50'));
});

test('special branch unlocks immediately, deduplicates receipts and counts content IDs', () => {
  let s = catchSpecial(G.createInitialState(), 'DB-001', 'receipt-1');
  assert.ok(s.achievements.includes('bottles-1'));
  s = catchSpecial(s, 'DB-001', 'receipt-1');
  assert.equal(s.specialEventCollection.entries['DB-001'].count, 1);
  s = catchSpecial(s, 'DB-001', 'receipt-2');
  assert.equal(s.specialEventCollection.entries['DB-001'].count, 2);
  assert.equal(G.achievementProgress(s, 'bottles-30'), 1);
  assert.equal(s.stats.totalCatchCount, 0);
  const entries = Object.fromEntries(Events.REGISTRY.map(e => [e.id, { count: 1 }]));
  const full = G.normalizeState({ specialEventCollection: { entries } }, 10);
  const eventIds = G.ACHIEVEMENTS.filter(a => [7,8].includes(a.seriesId)).map(a => a.id);
  assert.equal(eventIds.filter(id => full.achievements.includes(id)).length, 9);
  assert.equal(G.achievementSummary(full).points, 175);
});

test('five unique fish require A-B-C-D-E, persist through specials, pause and restart', () => {
  let s = G.createInitialState();
  for (const index of [0,1,0,1,0]) s = catchFish(s, index);
  assert.ok(!s.achievements.includes('five-unique-window'));
  s = catchSpecial(s, 'EC-001');
  s = G.resume(G.suspend(s, 20), 40);
  s = G.normalizeState(JSON.parse(JSON.stringify(s)), 50);
  for (const index of [1,2,3,4]) s = catchFish(s, index);
  assert.ok(s.achievements.includes('five-unique-window'));
  assert.deepEqual(s.achievementData.recentFishIds, G.FISH.slice(0,5).map(f => f.id));
  s = catchFish(s, 4);
  assert.ok(s.achievements.includes('five-unique-window'));
});

test('trustworthy old contiguous history proves 093 without relying on old streak scalar', () => {
  const history = G.FISH.slice(0,5).map((f,i) => ({ type: 'fish', resultId: f.id, catchId: String(i), at: i, lengthCm: 20, weightKg: .2 })).reverse();
  const s = G.normalizeState({ measurementVersion: 5, history }, 50);
  assert.ok(s.achievements.includes('five-unique-window'));
  const forged = G.normalizeState({ stats: { bestDistinctStreak: 100 } }, 50);
  assert.ok(!forged.achievements.includes('five-unique-window'));
});

test('successful sale updates persistent counter exactly once; protected/failing sales do not', () => {
  let s = catchFish(G.createInitialState(), 0);
  const inventoryId = s.inventory[0].inventoryId;
  const protectedState = G.setInventoryLocked(s, inventoryId, true).state;
  assert.equal(G.sellInventory(protectedState, inventoryId).state.achievementData.soldFishCount, 0);
  const sold = G.sellInventory(s, [inventoryId, inventoryId], 200);
  assert.equal(sold.ok, true);
  assert.equal(sold.state.achievementData.soldFishCount, 1);
  assert.ok(sold.state.achievements.includes('sale-first'));
  assert.equal(G.sellInventory(sold.state, inventoryId, 250).state.achievementData.soldFishCount, 1);
  const restarted = G.normalizeState({ ...sold.state, history: [] });
  assert.equal(restarted.achievementData.soldFishCount, 1);
});

test('pack purchases unlock ownership immediately and do not deduct earned progress', () => {
  const s = G.createInitialState(); s.wallet = { balance: 10000, totalEarned: 10000, totalSpent: 0 };
  const bought = G.purchasePack(s, 'F2', 100);
  assert.equal(bought.ok, true);
  assert.ok(bought.state.achievements.includes('own-f2'));
  assert.ok(bought.state.achievements.includes('earned-10000'));
});

test('four corners reject arbitrary keys, preserve progress across sessions, and never mutate input', () => {
  let s = G.createInitialState();
  const unchanged = JSON.stringify(s);
  const invalid = G.transition(s, 'cast', () => .5, 1, { corner: 'pretend-corner' });
  assert.equal(G.achievementProgress(invalid, 'corners'), 0);
  assert.equal(JSON.stringify(s), unchanged);
  for (const corner of A.CORNERS) s = G.transition(G.normalizeState({ ...s, fishingState: 'idle' }), 'cast', () => .5, 100, { corner });
  assert.ok(s.achievements.includes('corners'));
  assert.equal(G.achievementDetails(s, 'corners').corners.filter(c => c.completed).length, 4);
});

test('71 completed achievements grant 1255 points and ten titles; tracking and notices are bounded', () => {
  let s = G.createInitialState(); s.achievements = G.ACHIEVEMENTS.map(a => a.id);
  s = G.unlockAchievements(s);
  const summary = G.achievementSummary(s);
  assert.equal(summary.points, 1255); assert.equal(summary.total, 71); assert.equal(summary.titles.length, 10);
  assert.equal(G.applyAchievementAction(s, { type: 'title', id: 4 }).state.achievementTitleId, '4');
  assert.equal(G.applyAchievementAction(G.createInitialState(), { type: 'title', id: 4 }).reason, 'title-locked');
  for (const a of G.ACHIEVEMENTS.slice(0,3)) s = G.applyAchievementAction(s, { type: 'track', id: a.id }).state;
  assert.equal(G.applyAchievementAction(s, { type: 'track', id: G.ACHIEVEMENTS[3].id }).reason, 'tracking-limit');
  s = G.applyAchievementAction(s, { type: 'acknowledge' }).state;
  assert.equal(G.normalizeState(s).achievementNotice, null);
  assert.equal(G.normalizeState(s).achievementTracking.length, 3);
});

test('browser and Node expose equivalent pure achievement APIs', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(require.resolve('../src/achievement-system'), 'utf8'), context);
  assert.equal(context.window.PondAchievements.ACHIEVEMENTS.length, 71);
  assert.equal(typeof context.window.PondAchievements.achievementSummary, 'function');
});

test('issued point snapshots and earned series titles survive future definition progress changes', () => {
  const old = { ...G.createInitialState(), achievements: ['first-cast'], achievementTimes: { 'first-cast': 10 }, achievementMetadata: { 'first-cast': { source: 'earned', pointsAtUnlock: 17 } }, achievementTitles: ['1'] };
  const restored = G.normalizeState(old, 200);
  assert.equal(G.achievementSummary(restored).points, 17);
  assert.ok(G.achievementSummary(restored).titles.some(t => t.id === '1'));
  assert.equal(restored.achievementMetadata['first-cast'].pointsAtUnlock, 17);
  assert.equal(restored.achievementTimes['first-cast'], 10);
});

test('fixed fish completion sets cannot be replaced by future fish or forged cumulative counts', () => {
  const s = G.createInitialState();
  s.stats.uniqueSpeciesCount = 999;
  s.stats.packUnique.F1 = 999;
  s.collection['future-fish'] = fishRecord(999);
  assert.equal(G.achievementProgress(s, 'all-species'), 0);
  assert.equal(G.achievementProgress(s, 'pack-f1-complete'), 0);
});
