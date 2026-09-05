const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/probability-system');
const V = require('../src/fish-variants');
const G = require('../src/game-state-runtime');

test('disabled special events do not consume a roll or create an empty result', () => {
  let calls = 0;
  const r = () => { calls++; return 0.5; };
  const result = P.encounter(r, { habitat: 'freshwater', unlockedPacks: ['F1'], fish: G.FISH, specialEvents: [] });
  assert.equal(result.encounterType, 'fish');
  assert.equal(result.packId, 'F1');
  assert.ok(calls > 0);
});

test('disabled and empty special registries leave identical downstream rolls', () => {
  const values = [0.5, 0.25, 0.33, 0.7, 0.8, 0.4];
  const make = () => { let i = 0; return () => values[i++ % values.length]; };
  const a = P.encounter(make(), { habitat: 'freshwater', unlockedPacks: ['F1'], fish: G.FISH, specialEvents: [] });
  const b = P.encounter(make(), { habitat: 'freshwater', unlockedPacks: ['F1'], fish: G.FISH, specialEvents: [{ id: 'off', enabled: false, habitats: ['freshwater'], weight: 1 }] });
  assert.deepEqual(a.rollTrace, b.rollTrace);
});

test('encounter follows pack, rarity, species and conditional unhook layers', () => {
  const fish = G.FISH.filter((x) => x.pack === 'F1');
  const result = P.encounter(() => 0.5, { habitat: 'freshwater', unlockedPacks: ['F1'], fish, specialEvents: [] });
  assert.equal(result.encounterType, 'fish');
  assert.equal(result.rarity, 'common');
  assert.equal(result.randomUnhook, false);
  assert.ok(result.variant);
});

test('exact zero is inside the random unhook interval', () => {
  const result = P.encounter(() => 0, { habitat: 'freshwater', unlockedPacks: ['F1'], fish: G.FISH, specialEvents: [] });
  assert.equal(result.randomUnhook, true);
  assert.equal(result.variant, null);
});

test('global pity escalates and resets only the appropriate tiers', () => {
  assert.equal(P.pityMinimum({ alternatePlusMisses: 19 }), 1);
  assert.equal(P.pityMinimum({ goldenPlusMisses: 99 }), 2);
  assert.equal(P.pityMinimum({ iridescentMisses: 359 }), 3);
  const next = P.updatePity({ alternatePlusMisses: 3, goldenPlusMisses: 3, iridescentMisses: 3 }, 'golden');
  assert.deepEqual(next, { alternatePlusMisses: 0, goldenPlusMisses: 0, iridescentMisses: 4 });
});

test('soft pity boosts are deducted from normal and keep total weight constant', () => {
  const base = P.variantWeights({ alternatePlusMisses: 0, goldenPlusMisses: 0, iridescentMisses: 0 });
  const boosted = P.variantWeights({ alternatePlusMisses: 0, goldenPlusMisses: 80, iridescentMisses: 280 });
  assert.equal(Object.values(base).reduce((sum, value) => sum + value, 0), 10000);
  assert.equal(Object.values(boosted).reduce((sum, value) => sum + value, 0), 10000);
  assert.ok(boosted.normal < base.normal);
  assert.ok(boosted.golden > base.golden);
  assert.ok(boosted.iridescent > base.iridescent);
});

test('variant normalization and protected sale contract are deterministic', () => {
  assert.equal(V.normalizeVariant('unknown'), 'normal');
  assert.equal(V.VALUE_MULTIPLIERS.iridescent, 8);
  assert.equal(V.isProtected({ variant: 'golden' }), false);
  assert.equal(V.isProtected({ variant: 'golden', locked: true }), true);
  assert.equal(V.isProtected({ variant: 'normal' }), false);
});

test('legacy variant save migrates to current schema without value rewrite', () => {
  const state = G.normalizeState({ version: 7, catches: 1, collection: { 'fish-1': { count: 1 } }, history: [{ type: 'fish', resultId: 'fish-1', valueCoins: 77, weightKg: 0.01, at: 4 }] }, 10);
  assert.equal(state.saveSchemaVersion, G.SAVE_SCHEMA_VERSION);
  assert.equal(state.history[0].variant, 'normal');
  assert.equal(state.history[0].valueCoins, 77);
  assert.equal(state.pity.alternatePlusMisses, 0);
  assert.equal(state.collection['fish-1'].variants.normal.count, 1);
  const again = G.normalizeState(state, 11);
  assert.deepEqual(again.collection, state.collection);
});

test('variant stats preserve independent measurement records', () => {
  let stats = V.applyCatch({}, 'golden', 10, { lengthCm: 12, weightKg: 0.2 });
  stats = V.applyCatch(stats, 'golden', 20, { lengthCm: 10, weightKg: 0.3 });
  assert.deepEqual(stats.golden, { count: 2, firstAt: 10, maxLengthCm: 12, maxWeightKg: 0.3 });
  assert.equal(stats.normal.count, 0);
});

test('explicit zero normal stats are not replaced by an iridescent catch total', () => {
  const stats = V.variantStats({
    normal: { count: 0, firstAt: null, maxLengthCm: 0, maxWeightKg: 0 },
    iridescent: { count: 1, firstAt: 10, maxLengthCm: 12, maxWeightKg: 0.2 }
  }, 1, { firstAt: 10, maxLengthCm: 12, maxWeightKg: 0.2 });
  assert.equal(stats.normal.count, 0);
  assert.equal(stats.normal.firstAt, null);
  assert.equal(stats.iridescent.count, 1);
});

test('protected golden inventory cannot be sold until explicitly unlocked', () => {
  const state = G.normalizeState({ inventory: [{ inventoryId: 'g1', fishId: 'fish-1', variant: 'golden', locked: true, valueCoins: 100, lengthCm: 10, weightKg: 0.01, caughtAt: 1 }], history: [] }, 2);
  assert.equal(state.inventory[0].autoLocked, false);
  const result = G.sellInventory(state, ['g1'], 3);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'protected-variant');
  const unlocked = G.setInventoryLocked(state, 'g1', false, 4);
  assert.equal(G.sellInventory(unlocked.state, ['g1'], 5).ok, true);
});

test('only the first golden catch is auto-locked', () => {
  const base = { ...G.createInitialState(0), fishingState: 'catch_land', pendingCatch: { fishId: 'fish-1', variant: 'golden', catchId: 'g1', measurementRolls: [0.5, 0.5] } };
  const first = G.commitCatch(base, () => 0.5, 1);
  assert.equal(first.currentResult.locked, true);
  const secondBase = { ...base, pendingCatch: { ...base.pendingCatch, catchId: 'g2' }, collection: first.collection, history: first.history, inventory: first.inventory };
  const second = G.commitCatch(secondBase, () => 0.5, 2);
  assert.equal(second.currentResult.locked, false);
});

test('variant inventory sorting prioritizes rare variants then catalog and size', () => {
  const entries = [
    { inventoryId: 'n', fishId: 'fish-1', variant: 'normal', lengthCm: 1, weightKg: 1, caughtAt: 1 },
    { inventoryId: 'g', fishId: 'fish-2', variant: 'golden', lengthCm: 99, weightKg: 9, caughtAt: 2 },
    { inventoryId: 'i', fishId: 'fish-3', variant: 'iridescent', lengthCm: 99, weightKg: 9, caughtAt: 3 },
    { inventoryId: 'a', fishId: 'fish-1', variant: 'alternate', lengthCm: 2, weightKg: 1, caughtAt: 4 },
    { inventoryId: 'u', fishId: 'fish-1', variant: 'unknown', lengthCm: 0.5, weightKg: 1, caughtAt: 5 }
  ];
  assert.deepEqual(G.sortInventory(entries, 'variant').map((x) => x.inventoryId), ['i', 'g', 'a', 'u', 'n']);
});
