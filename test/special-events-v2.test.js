const test = require('node:test');
const assert = require('node:assert/strict');
const Events = require('../src/special-events');
const P = require('../src/probability-system');
const G = require('../src/game-state-runtime');

test('正式特殊事件清单固定为 DB30 RS10 EC20', () => {
  assert.equal(Events.REGISTRY.length, 60);
  assert.deepEqual(Events.SERIES.map((x) => [x.id, x.count]), [['drift_bottle', 30], ['research_salvage', 10], ['eco_cleanup', 20]]);
  assert.equal(new Set(Events.REGISTRY.map((x) => x.id)).size, 60);
  assert.ok(Events.REGISTRY.every((x) => x.description && x.description !== x.title && x.iconPath.startsWith('assets/events/') && x.animationPath));
});

test('资产未齐时整套特殊事件不可抽取且不消耗随机流', () => {
  assert.equal(Events.readiness(Events.MANIFEST, Events.REGISTRY, () => false).ready, false);
  assert.equal(Events.runtimeRegistry().length, 60);
  let calls = 0; const result = P.encounter(() => { calls += 1; return 0.5; }, { habitat: 'freshwater', unlockedPacks: ['F1'], fish: G.FISH, specialEvents: [] });
  assert.equal(result.encounterType, 'fish'); assert.ok(calls > 0);
});

test('V3旧档长空窗立即兑现并保留动态重复权重', () => {
  const event = P.encounter(() => 0, { habitat: 'freshwater', specialEvents: Events.REGISTRY, specialEventPity: { nonSpecialStreak: 12 }, collection: {} });
  assert.equal(event.encounterType, 'special');
  assert.equal(event.probabilityVersion, 3);
  assert.equal(event.topLevelMode, 'scheduled_interval');
  assert.equal(event.rollTrace.rngVersion, 'mulberry32-named-v1');
  assert.equal(event.rollTrace.special.seriesResult, event.seriesId);
  const repeated = P.encounter(() => 0.01, { habitat: 'freshwater', specialEvents: Events.REGISTRY, specialEventPity: { nonSpecialStreak: 12 }, collection: { 'DB-001': { count: 1 } } });
  assert.equal(repeated.encounterType, 'special');
  assert.notEqual(repeated.eventId, 'DB-001');
});

test('每次重复特殊事件都保留唯一结果ID供鱼获卡显示', () => {
  const base = G.createInitialState(0);
  const first = G.commitCatch({ ...base, fishingState: 'catch_land', pendingCatch: { encounterType: 'special', eventId: 'DB-001', catchId: 'special-first' } }, () => 0.5, 10);
  const second = G.commitCatch({ ...first, fishingState: 'catch_land', catchCommitted: false, currentResult: null, pendingCatch: { encounterType: 'special', eventId: 'DB-001', catchId: 'special-second' } }, () => 0.5, 20);
  assert.equal(first.currentResult.catchId, 'special-first');
  assert.equal(second.currentResult.catchId, 'special-second');
  assert.equal(second.currentResult.count, 2);
  assert.equal(second.currentResult.first, false);
});

test('特殊事件成功只进入独立收藏，超时不收藏', () => {
  let state = G.createInitialState(0);
  state = { ...state, fishingState: 'catch_land', pendingCatch: { encounterType: 'special', eventId: 'DB-001', seriesId: 'drift_bottle', selectedAt: 1 } };
  const committed = G.commitCatch(state, () => 0.5, 10);
  assert.equal(committed.specialEventCollection.entries['DB-001'].count, 1);
  assert.equal(committed.history.length, 0);
  assert.equal(committed.inventory.length, 0);
  const timedOut = G.normalizeState({ ...state, fishingState: 'escaping', pendingCatch: null }, 11);
  assert.deepEqual(timedOut.specialEventCollection.entries, {});
});

test('旧档加法迁移特殊计数与收藏且保留鱼类状态', () => {
  const state = G.normalizeState({ catches: 3, wallet: { balance: 99 }, collection: { 'fish-1': { count: 2 } }, specialEventPity: { nonSpecialStreak: -5, duplicateSpecialStreak: 99 }, specialEventCollection: { entries: { 'DB-001': { count: 2, firstFoundAt: 4, lastFoundAt: 5 } } } }, 20);
  assert.equal(state.wallet.balance, 99);
  assert.equal(state.collection['fish-1'].count, 2);
  assert.deepEqual(state.specialEventPity, { nonSpecialStreak: 0, duplicateSpecialStreak: 8, nextSpecialAt: null });
  assert.equal(state.specialEventCollection.entries['DB-001'].count, 2);
  assert.equal(state.saveSchemaVersion, G.SAVE_SCHEMA_VERSION);
  assert.deepEqual(G.normalizeState(state, 21).specialEventCollection, state.specialEventCollection);
});

test('随机脱钩使用统一type且不推进特殊重复计数', () => {
  const state = G.createInitialState(0);
  const result = G.transition({ ...state, fishingState: 'bite_loop', pendingCatch: { encounterType: 'fish', randomUnhook: true, fishId: 'fish-1' } }, 'reel', () => 0, 1);
  assert.equal(result.currentResult.type, 'random_unhook');
  assert.equal(result.specialEventPity.duplicateSpecialStreak, 0);
});

test('启用特殊事件后鱼类异色保底仍读取鱼类pity', () => {
  const result = P.encounter(() => 0.99, { habitat: 'freshwater', unlockedPacks: ['F1'], fish: G.FISH, specialEvents: Events.REGISTRY, counters: { alternatePlusMisses: 19, goldenPlusMisses: 99, iridescentMisses: 359 }, specialEventPity: { nonSpecialStreak: 0 }, collection: {} });
  assert.equal(result.encounterType, 'fish');
  assert.equal(result.variant, 'iridescent');
});
