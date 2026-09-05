'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Aquarium = require('../src/aquarium-state');
const Game = require('../src/game-state-runtime');
const catalog = require('../data/aquarium-catalog.json');

function fish(inventoryId, pack = 'F1', lengthCm = 10, extra = {}) {
  return {
    inventoryId,
    catchId: inventoryId,
    fishId: pack.startsWith('F') ? 'fish-2' : 'fish-53',
    resultId: pack.startsWith('F') ? 'fish-2' : 'fish-53',
    name: pack.startsWith('F') ? '霓虹灯鱼' : '小丑鱼',
    pack,
    caughtAt: 1,
    lengthCm,
    weightKg: 0.1,
    valueCoins: 20,
    ...extra
  };
}

function stateWithInventory(inventory, options = {}) {
  return Game.normalizeState({
    inventory,
    history: [],
    ownedPacks: options.ownedPacks || ['F1'],
    wallet: options.wallet || { balance: 0, totalEarned: 0, totalSpent: 0 },
    aquarium: options.aquarium
  }, 10);
}

test('catalog ships 34 complete, stable and correctly grouped entries', () => {
  assert.deepEqual(Aquarium.validateCatalog(catalog), { valid: true, errors: [], itemCount: 34 });
  const counts = Object.fromEntries(['tank', 'substrate', 'rock', 'plant', 'wood', 'background', 'effect'].map((category) => [category, catalog.items.filter((item) => item.category === category).length]));
  assert.deepEqual(counts, { tank: 5, substrate: 6, rock: 6, plant: 8, wood: 4, background: 3, effect: 2 });
  assert.equal(new Set(catalog.items.map((item) => item.id)).size, 34);
  assert.ok(catalog.items.every((item) => item.asset === `assets/aquarium/catalog/${item.id}.png`));
  assert.deepEqual(catalog.items.filter((item) => item.category === 'tank').map((item) => item.purchasePriceCoins), [600, 800, 1000, 1200, 1600]);
});

test('catalog validation rejects empty, malformed footprint and mismatched slot-layer contracts', () => {
  assert.equal(Aquarium.validateCatalog({ items: [] }).valid, false);
  const malformed = JSON.parse(JSON.stringify(catalog));
  malformed.items[0].layer = 'front';
  malformed.items[11].footprint.width = -1;
  const checked = Aquarium.validateCatalog(malformed);
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.includes('tank-basic:slot-layer'));
  assert.ok(checked.errors.includes('rock-round:footprint'));
});

test('schema 8 migration upgrades through current save schema while keeping aquarium schema 2, cleans dangling, duplicate and wrong-habitat references idempotently', () => {
  const inventory = [fish('fresh'), fish('salt', 'S1')];
  const old = {
    version: 8,
    saveSchemaVersion: 8,
    inventory,
    history: [],
    ownedPacks: ['F1', 'F2', 'S1'],
    aquarium: {
      activeHabitat: 'freshwater',
      ownedItemIds: ['tank-basic', 'missing-item'],
      tanks: {
        freshwater: { skinId: 'tank-basic', substrateId: 'substrate-river-sand', fish: [{ inventoryId: 'fresh' }, { inventoryId: 'fresh' }, { inventoryId: 'missing' }, { inventoryId: 'salt' }], decor: [] },
        saltwater: { skinId: 'tank-basic', fish: [{ inventoryId: 'salt' }, { inventoryId: 'fresh' }], decor: [] }
      }
    }
  };
  const migrated = Game.normalizeState(old, 100);
  assert.equal(migrated.saveSchemaVersion, Game.SAVE_SCHEMA_VERSION);
  assert.equal(migrated.aquarium.version, 2);
  assert.deepEqual(migrated.aquarium.tanks.freshwater.fish.map((entry) => entry.inventoryId), ['fresh']);
  assert.deepEqual(migrated.aquarium.tanks.saltwater.fish.map((entry) => entry.inventoryId), ['salt']);
  assert.equal(migrated.inventory.find((entry) => entry.inventoryId === 'fresh').displayLock, true);
  assert.equal(migrated.inventory.find((entry) => entry.inventoryId === 'salt').displayLock, true);
  assert.deepEqual(Game.normalizeState(migrated, 999).aquarium, migrated.aquarium);
});

test('fish size classes support real-length thresholds and explicit/ray overrides', () => {
  assert.equal(Aquarium.fishMetrics(fish('a', 'F1', 10)).bioload, 1);
  assert.equal(Aquarium.fishMetrics(fish('b', 'F1', 30)).bioload, 2);
  assert.equal(Aquarium.fishMetrics(fish('c', 'F1', 100)).bioload, 3);
  assert.equal(Aquarium.fishMetrics(fish('d', 'F1', 250)).bioload, 4);
  assert.equal(Aquarium.fishMetrics(fish('ray', 'F1', 30, { name: '黑白魟' })).bioload, 3);
  assert.equal(Aquarium.fishMetrics(fish('override', 'F1', 5, { aquariumBioload: 4 })).sizeClass, 'giant');
});

test('placing fish enforces count, bioload, habitat and globally unique inventory references atomically', () => {
  const tiny = Array.from({ length: 9 }, (_, index) => fish(`tiny-${index}`));
  let state = stateWithInventory(tiny);
  for (let index = 0; index < 8; index += 1) {
    const result = Game.aquariumAction(state, 'place-fish', { inventoryId: `tiny-${index}` }, 20 + index);
    assert.equal(result.ok, true);
    state = result.state;
  }
  const before = JSON.stringify(state);
  const full = Game.aquariumAction(state, 'place-fish', { inventoryId: 'tiny-8' }, 40);
  assert.equal(full.reason, 'count-full');
  assert.equal(JSON.stringify(full.state), before);
  assert.equal(Game.aquariumAction(state, 'place-fish', { inventoryId: 'tiny-0' }, 41).reason, 'already-displayed');

  const giants = Array.from({ length: 4 }, (_, index) => fish(`giant-${index}`, 'F1', 250));
  state = stateWithInventory(giants);
  for (let index = 0; index < 3; index += 1) state = Game.aquariumAction(state, 'place-fish', { inventoryId: `giant-${index}` }, 50 + index).state;
  assert.equal(Game.aquariumAction(state, 'place-fish', { inventoryId: 'giant-3' }, 60).reason, 'bioload-full');

  const mixed = stateWithInventory([fish('fresh'), fish('salt', 'S1')]);
  assert.equal(Game.aquariumAction(mixed, 'place-fish', { inventoryId: 'salt' }, 61).reason, 'wrong-habitat');
  assert.equal(Game.aquariumAction(mixed, 'switch-habitat', { habitat: 'saltwater' }, 62).reason, 'habitat-locked');
});

test('saltwater profile unlocks with S1 and removing fish clears its derived display lock', () => {
  let state = stateWithInventory([fish('salt', 'S1')], { ownedPacks: ['F1', 'F2', 'S1'], wallet: { balance: 1000, totalEarned: 1000, totalSpent: 0 } });
  const bought = Aquarium.purchaseItem(state.aquarium, state.wallet, state.inventory, state.ownedPacks, { itemId: 'tank-black-iron', habitat: 'saltwater' }, catalog);
  let result = Aquarium.setTankHabitat(bought.snapshot, state.inventory, state.ownedPacks, { tankId: bought.createdTankId, habitat: 'saltwater' }, catalog);
  assert.equal(result.ok, true);
  result = Aquarium.placeFish(result.snapshot, state.inventory, state.ownedPacks, { tankId: bought.createdTankId, inventoryId: 'salt' }, catalog);
  assert.equal(result.ok, true);
  state = { ...state, aquarium: result.snapshot };
  state.inventory = Aquarium.applyDisplayLocks(state.inventory, state.aquarium);
  assert.equal(state.inventory[0].displayLock, true);
  result = Aquarium.removeFish(state.aquarium, state.inventory, state.ownedPacks, { tankId: bought.createdTankId, inventoryId: 'salt' }, catalog);
  assert.equal(result.ok, true);
  assert.equal(Aquarium.applyDisplayLocks(state.inventory, result.snapshot)[0].displayLock, false);
});

test('displayed fish cannot be sold singly and are excluded from a batch sale', () => {
  let state = stateWithInventory([fish('displayed'), fish('free')]);
  state = Game.aquariumAction(state, 'place-fish', { inventoryId: 'displayed' }, 20).state;
  const single = Game.sellInventory(state, 'displayed', 30);
  assert.equal(single.reason, 'fish-in-aquarium');
  assert.equal(single.state.wallet.balance, 0);
  const batch = Game.sellInventory(state, ['displayed', 'free'], 31);
  assert.equal(batch.ok, true);
  assert.deepEqual(batch.excludedDisplay, ['displayed']);
  assert.deepEqual(batch.state.inventory.map((entry) => entry.inventoryId), ['displayed']);
  assert.equal(batch.state.aquarium.tanks.freshwater.fish[0].inventoryId, 'displayed');
});

test('decoration purchase is permanent, exact and atomic for duplicates or insufficient coins', () => {
  let state = stateWithInventory([], { wallet: { balance: 500, totalEarned: 500, totalSpent: 0 } });
  let result = Game.aquariumAction(state, 'purchase-item', { itemId: 'plant-anubias' }, 20);
  assert.equal(result.ok, true);
  assert.equal(result.state.wallet.balance, 320);
  assert.equal(result.state.wallet.totalSpent, 180);
  state = result.state;
  const duplicate = Game.aquariumAction(state, 'purchase-item', { itemId: 'plant-anubias' }, 21);
  assert.equal(duplicate.reason, 'already-owned');
  assert.equal(duplicate.state.wallet.balance, 320);
  const insufficient = Game.aquariumAction(state, 'purchase-item', { itemId: 'tank-panorama' }, 22);
  assert.equal(insufficient.reason, 'insufficient-coins');
  assert.deepEqual(insufficient.state, state);
});

test('layout saves exactly 12 load and 8 instances, snaps coordinates to 4 DIP and rejects overflow atomically', () => {
  const ownedItemIds = catalog.items.map((item) => item.id);
  const base = Aquarium.normalizeAquariumState({ ...Aquarium.createInitialAquariumState(), ownedItemIds }, [], ['F1'], catalog);
  const exactTwelve = {
    skinId: 'tank-basic', backgroundId: null, substrateId: 'substrate-river-sand', effectId: null,
    decor: [
      { instanceId: 'a', itemId: 'rock-slate-cave', x: 0.15, y: 1, scale: 1 },
      { instanceId: 'b', itemId: 'rock-slate-cave', x: 0.38, y: 1, scale: 1 },
      { instanceId: 'c', itemId: 'rock-slate-cave', x: 0.62, y: 1, scale: 1 },
      { instanceId: 'd', itemId: 'wood-root', x: 0.84, y: 1, scale: 1 }
    ]
  };
  let result = Aquarium.saveLayout(base, [], ['F1'], { layout: exactTwelve }, catalog);
  assert.equal(result.ok, true);
  assert.equal(result.metrics.decorLoad, 12);
  const eight = {
    ...exactTwelve,
    decor: [
      ...Array.from({ length: 3 }, (_, i) => ({ instanceId: `r${i}`, itemId: 'rock-round', x: 0.1 + i * 0.12, y: 1, scale: 0.8 })),
      ...Array.from({ length: 3 }, (_, i) => ({ instanceId: `g${i}`, itemId: 'plant-grass', x: 0.5 + i * 0.1, y: 1, scale: 0.8 })),
      ...Array.from({ length: 2 }, (_, i) => ({ instanceId: `m${i}`, itemId: 'plant-moss-ball', x: 0.82 + i * 0.08, y: 1, scale: 0.8 }))
    ]
  };
  result = Aquarium.saveLayout(base, [], ['F1'], { layout: eight }, catalog);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.tanks.freshwater.decor.length, 8);
  const snapped = Aquarium.saveLayout(base, [], ['F1'], { layout: { ...exactTwelve, decor: [{ instanceId: 'snap', itemId: 'rock-round', x: 0.507, y: 0.913, scale: 1 }] } }, catalog);
  assert.equal(snapped.ok, true);
  assert.ok(Math.abs(snapped.snapshot.tanks.freshwater.decor[0].x * 112 - Math.round(snapped.snapshot.tanks.freshwater.decor[0].x * 112)) < 1e-5);
  assert.ok(Math.abs(snapped.snapshot.tanks.freshwater.decor[0].y * 48 - Math.round(snapped.snapshot.tanks.freshwater.decor[0].y * 48)) < 1e-5);

  const before = JSON.stringify(base);
  const overCount = Aquarium.saveLayout(base, [], ['F1'], { layout: { ...eight, decor: [...eight.decor, { instanceId: 'ninth', itemId: 'rock-round', x: 0.95, y: 1, scale: 0.8 }] } }, catalog);
  assert.equal(overCount.reason, 'invalid-layout');
  assert.equal(JSON.stringify(overCount.snapshot), before);
});

test('layout rejects more than 38 percent opaque coverage and out-of-water anchors', () => {
  const ownedItemIds = catalog.items.map((item) => item.id);
  const base = Aquarium.normalizeAquariumState({ ...Aquarium.createInitialAquariumState(), ownedItemIds }, [], ['F1'], catalog);
  const coverage = Aquarium.saveLayout(base, [], ['F1'], { layout: {
    skinId: 'tank-basic', substrateId: 'substrate-river-sand', backgroundId: null, effectId: null,
    decor: [0.2, 0.5, 0.8].map((x, index) => ({ instanceId: `root-${index}`, itemId: 'wood-root', x, y: 1, scale: 1.2 }))
  } }, catalog);
  assert.equal(coverage.reason, 'invalid-layout');
  assert.ok(coverage.errors.includes('coverage-full'));
  const outside = Aquarium.saveLayout(base, [], ['F1'], { layout: {
    skinId: 'tank-basic', substrateId: 'substrate-river-sand', backgroundId: null, effectId: null,
    decor: [{ instanceId: 'outside', itemId: 'wood-root', x: 0, y: 0, scale: 1 }]
  } }, catalog);
  assert.equal(outside.reason, 'invalid-layout');
  assert.ok(outside.errors.includes('outside-water'));
});

test('layout rejects a malformed decoration list without clearing the current layout', () => {
  const ownedItemIds = catalog.items.map((item) => item.id);
  const base = Aquarium.normalizeAquariumState({ ...Aquarium.createInitialAquariumState(), ownedItemIds }, [], ['F1'], catalog);
  const before = JSON.stringify(base);
  const result = Aquarium.saveLayout(base, [], ['F1'], { layout: {
    skinId: 'tank-basic', substrateId: 'substrate-river-sand', backgroundId: null, effectId: null
  } }, catalog);
  assert.equal(result.reason, 'invalid-layout');
  assert.ok(result.errors.includes('invalid-decor-list'));
  assert.equal(JSON.stringify(result.snapshot), before);
});

test('aquarium settings accept flat patches and reject malformed values atomically', () => {
  const state = stateWithInventory([]);
  let result = Game.aquariumAction(state, 'set-setting', { scale: 1.1, visible: true, inputLocked: true }, 20);
  assert.equal(result.ok, true);
  assert.equal(result.state.aquarium.settings.scale, 1.1);
  assert.equal(result.state.aquarium.settings.inputLocked, true);
  assert.equal(result.state.aquarium.visible, true);
  const before = result.state;
  result = Game.aquariumAction(before, 'set-setting', { scale: 1.5 }, 21);
  assert.equal(result.reason, 'invalid-setting');
  assert.deepEqual(result.state, before);
});

test('aquarium water sound is opt-in and accepts only boolean patches', () => {
  const state = stateWithInventory([]);
  assert.equal(state.aquarium.settings.waterSound, false);
  let result = Game.aquariumAction(state, 'set-setting', { waterSound: true }, 20);
  assert.equal(result.ok, true);
  assert.equal(result.state.aquarium.settings.waterSound, true);
  const before = result.state;
  result = Game.aquariumAction(before, 'set-setting', { waterSound: 'true' }, 21);
  assert.equal(result.reason, 'invalid-setting');
  assert.deepEqual(result.state, before);
});

test('tank instances migrate, can be switched by id, and tank purchases are repeatable', () => {
  const inventory = [fish('fresh')];
  let state = stateWithInventory(inventory, { wallet: { balance: 2000, totalEarned: 2000, totalSpent: 0 } });
  assert.equal(Array.isArray(state.aquarium.tankInstances), true);
  assert.equal(state.aquarium.activeTankId, 'tank-1');
  let result = Aquarium.purchaseItem(state.aquarium, state.wallet, inventory, ['F1'], { itemId: 'tank-basic', habitat: 'freshwater' }, catalog);
  assert.equal(result.ok, true);
  assert.equal(result.createdTankId != null, true);
  assert.equal(result.cost, 600);
  const created = result.createdTankId;
  result = Aquarium.switchTank(result.snapshot, inventory, ['F1'], { tankId: created }, catalog);
  assert.equal(result.ok, true);
  result = Aquarium.setTankHabitat(result.snapshot, inventory, ['F1'], { tankId: created, habitat: 'saltwater' }, catalog);
  assert.equal(result.reason, 'habitat-locked');
  result = Aquarium.setTankHabitat(result.snapshot, inventory, ['F1', 'S1'], { tankId: created, habitat: 'saltwater' }, catalog);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.tankInstances.find((tank) => tank.tankId === created).habitat, 'saltwater');
});

test('decor scale accepts 0.5 to 2.0 in 0.05 increments and rejects overflow', () => {
  const owned = catalog.items.map((item) => item.id);
  const base = Aquarium.normalizeAquariumState({ ...Aquarium.createInitialAquariumState(), ownedItemIds: owned }, [], ['F1'], catalog);
  const layout = { skinId: 'tank-basic', substrateId: 'substrate-river-sand', backgroundId: null, effectId: null, decor: [{ instanceId: 'scaled', itemId: 'rock-round', x: .5, y: .875, scale: .55 }] };
  assert.equal(Aquarium.saveLayout(base, [], ['F1'], { layout }, catalog).ok, true);
  layout.decor[0].scale = 2.01;
  assert.equal(Aquarium.saveLayout(base, [], ['F1'], { layout }, catalog).reason, 'invalid-layout');
});

test('display locks scan fish in a second same-habitat tank', () => {
  const inventory = [fish('a'), fish('b')];
  const base = Aquarium.normalizeAquariumState(Aquarium.createInitialAquariumState(), inventory, ['F1'], catalog);
  const purchased = Aquarium.purchaseItem(base, { balance: 1000, totalEarned: 1000, totalSpent: 0 }, inventory, ['F1'], { itemId: 'tank-basic' }, catalog);
  const placed = Aquarium.placeFish(purchased.snapshot, inventory, ['F1'], { tankId: purchased.createdTankId, inventoryId: 'b' }, catalog);
  const locked = Aquarium.applyDisplayLocks(inventory, placed.snapshot);
  assert.equal(locked.find((entry) => entry.inventoryId === 'b').displayLock, true);
});

test('paid skin survives normalization and layout save', () => {
  const inventory = [];
  const base = Aquarium.normalizeAquariumState(Aquarium.createInitialAquariumState(), inventory, ['F1'], catalog);
  const bought = Aquarium.purchaseItem(base, { balance: 1000, totalEarned: 1000, totalSpent: 0 }, inventory, ['F1'], { itemId: 'tank-black-iron' }, catalog);
  const tank = bought.snapshot.tankInstances.find((entry) => entry.tankId === bought.createdTankId);
  const normalized = Aquarium.normalizeAquariumState(bought.snapshot, inventory, ['F1'], catalog);
  assert.equal(normalized.tankInstances.find((entry) => entry.tankId === tank.tankId).skinId, 'tank-black-iron');
  const saved = Aquarium.saveLayout(normalized, inventory, ['F1'], { tankId: tank.tankId, layout: { ...tank, decor: [] } }, catalog);
  assert.equal(saved.snapshot.tankInstances.find((entry) => entry.tankId === tank.tankId).skinId, 'tank-black-iron');
});

test('changing tank habitat reports removals and retains its skin', () => {
  const inventory = [fish('fresh', 'F1')];
  const base = Aquarium.normalizeAquariumState(Aquarium.createInitialAquariumState(), inventory, ['F1', 'S1'], catalog);
  const bought = Aquarium.purchaseItem(base, { balance: 1000, totalEarned: 1000, totalSpent: 0 }, inventory, ['F1', 'S1'], { itemId: 'tank-black-iron' }, catalog);
  const placed = Aquarium.placeFish(bought.snapshot, inventory, ['F1', 'S1'], { tankId: bought.createdTankId, inventoryId: 'fresh' }, catalog);
  const changed = Aquarium.setTankHabitat(placed.snapshot, inventory, ['F1', 'S1'], { tankId: bought.createdTankId, habitat: 'saltwater' }, catalog);
  assert.equal(changed.ok, true);
  assert.equal(changed.removedFishCount, 1);
  assert.equal(changed.snapshot.tankInstances.find((entry) => entry.tankId === bought.createdTankId).skinId, 'tank-black-iron');
});

test('failed tank purchase does not advance nextTankNumber and invalid purchase price is rejected', () => {
  const base = Aquarium.normalizeAquariumState(Aquarium.createInitialAquariumState(), [], ['F1'], catalog);
  const before = base.nextTankNumber;
  const failed = Aquarium.purchaseItem(base, { balance: 0, totalEarned: 0, totalSpent: 0 }, [], ['F1'], { itemId: 'tank-black-iron' }, catalog);
  assert.equal(failed.reason, 'insufficient-coins');
  assert.equal(failed.snapshot.nextTankNumber, before);
  const malformed = JSON.parse(JSON.stringify(catalog));
  malformed.items.find((item) => item.id === 'tank-oak').purchasePriceCoins = 0;
  assert.equal(Aquarium.validateCatalog(malformed).valid, false);
});

test('normalization has no offline decay, passive income or live motion persistence', () => {
  const state = stateWithInventory([fish('quiet')], { wallet: { balance: 123, totalEarned: 456, totalSpent: 333 } });
  const placed = Game.aquariumAction(state, 'place-fish', { inventoryId: 'quiet' }, 20).state;
  const later = Game.normalizeState(placed, 20 + 1000 * 60 * 60 * 24 * 365);
  assert.deepEqual(later.aquarium, placed.aquarium);
  assert.deepEqual(later.wallet, placed.wallet);
  assert.equal('position' in later.aquarium.tanks.freshwater.fish[0], false);
  assert.equal('lastFedAt' in later.aquarium, false);
});

test('normalization never leaves a locked saltwater tank active', () => {
  const aquarium = Aquarium.normalizeAquariumState({
    ...Aquarium.createInitialAquariumState(),
    activeTankId: 'tank-2',
    activeHabitat: 'saltwater',
    tankInstances: [
      { tankId: 'tank-1', name: '鱼缸1', habitat: 'freshwater', skinId: 'tank-basic', backgroundId: null, substrateId: 'substrate-river-sand', effectId: null, fish: [], decor: [] },
      { tankId: 'tank-2', name: '鱼缸2', habitat: 'saltwater', skinId: 'tank-basic', backgroundId: null, substrateId: null, effectId: null, fish: [], decor: [] }
    ]
  }, [], ['F1']);
  assert.equal(aquarium.activeTankId, 'tank-1');
  assert.equal(aquarium.activeHabitat, 'freshwater');
});
