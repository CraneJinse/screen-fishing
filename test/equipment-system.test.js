const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../src/game-state-runtime');
const Probability = require('../src/probability-system');

function funded(balance = 50000) {
  return { ...Game.createInitialState(0), wallet: { balance, totalEarned: balance, totalSpent: 0 } };
}

test('旧存档安全迁移到空装备库，未购买鱼竿不能开启自动抛竿', () => {
  const state = Game.normalizeState({ settings: { ...Game.defaultSettings, autoCastEnabled: true } }, 1);
  assert.equal(state.saveSchemaVersion, 14);
  assert.deepEqual(state.equipment, { ownedIds: [], activeBaitId: null });
  assert.equal(state.settings.autoCastEnabled, false);
  assert.equal(state.autoCastPending, false);
});

test('自动抛竿鱼竿按原子交易购买并默认开启', () => {
  const result = Game.purchaseEquipment(funded(1200), Game.AUTO_CAST_ROD_ID, 2);
  assert.equal(result.ok, true);
  assert.equal(result.cost, 1000);
  assert.equal(result.state.wallet.balance, 200);
  assert.equal(result.state.wallet.totalSpent, 1000);
  assert.ok(result.state.equipment.ownedIds.includes(Game.AUTO_CAST_ROD_ID));
  assert.equal(result.state.settings.autoCastEnabled, true);
  const duplicate = Game.purchaseEquipment(result.state, Game.AUTO_CAST_ROD_ID, 3);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.state.wallet.balance, 200);
});

test('三档钓饵必须依次购买，购买后自动装备且可停用和重新选择', () => {
  let state = funded();
  const skipped = Game.purchaseEquipment(state, 'bait-moon', 1);
  assert.equal(skipped.ok, false);
  assert.equal(skipped.reason, 'equipment-prerequisite');
  assert.equal(skipped.state.wallet.balance, 50000);
  for (const id of Game.BAIT_ORDER) {
    const bought = Game.purchaseEquipment(state, id, 2);
    assert.equal(bought.ok, true);
    state = bought.state;
    assert.equal(state.equipment.activeBaitId, id);
  }
  const none = Game.equipBait(state, null, 3);
  assert.equal(none.ok, true);
  assert.equal(none.state.equipment.activeBaitId, null);
  const fresh = Game.equipBait(none.state, 'bait-fresh', 4);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.state.equipment.activeBaitId, 'bait-fresh');
});

test('V4每档稀有度和异色基础权重与确认表完全一致', () => {
  const expected = {
    none: {
      rarity: { common: 7000, rare: 2000, epic: 700, legendary: 250, mythic: 50 },
      variant: { normal: 8800, alternate: 1000, golden: 170, iridescent: 30 }
    },
    'bait-fresh': {
      rarity: { common: 6200, rare: 2700, epic: 750, legendary: 300, mythic: 50 },
      variant: { normal: 8000, alternate: 1700, golden: 250, iridescent: 50 }
    },
    'bait-moon': {
      rarity: { common: 5400, rare: 3300, epic: 850, legendary: 380, mythic: 70 },
      variant: { normal: 7000, alternate: 2400, golden: 500, iridescent: 100 }
    },
    'bait-star': {
      rarity: { common: 4600, rare: 3700, epic: 1050, legendary: 550, mythic: 100 },
      variant: { normal: 6000, alternate: 3000, golden: 800, iridescent: 200 }
    }
  };
  assert.equal(Probability.PROBABILITY_VERSION, 4);
  for (const [key, table] of Object.entries(expected)) {
    const baitId = key === 'none' ? null : key;
    assert.deepEqual(Probability.rarityWeights(baitId), table.rarity);
    assert.deepEqual(Probability.variantWeights({}, { baitId }), table.variant);
    assert.equal(Object.values(table.rarity).reduce((sum, value) => sum + value, 0), 10000);
    assert.equal(Object.values(table.variant).reduce((sum, value) => sum + value, 0), 10000);
  }
});

test('切换钓饵只影响下一杆，当前杆使用抛竿时快照', () => {
  let state = funded();
  state = Game.purchaseEquipment(state, 'bait-fresh', 1).state;
  state = Game.purchaseEquipment(state, 'bait-moon', 2).state;
  state = Game.equipBait(state, 'bait-fresh', 3).state;
  state = { ...state, firstCast: false, castCount: 5 };
  state = Game.transition(state, 'cast', () => 0.5, 10);
  assert.equal(state.castBaitId, 'bait-fresh');
  state = Game.equipBait(state, 'bait-moon', 11).state;
  assert.equal(state.equipment.activeBaitId, 'bait-moon');
  assert.equal(state.castBaitId, 'bait-fresh');
  state = { ...state, fishingState: 'waiting', stateEndsAt: 12, specialEventPity: { nonSpecialStreak: 0, duplicateSpecialStreak: 0, nextSpecialAt: 7 } };
  state = Game.tick(state, 12, () => 0.5);
  assert.equal(state.pendingCatch.baitId, 'bait-fresh');
});

test('钓饵不改变特殊事件节奏、脱钩概率或随机调用次数', () => {
  function make(values) { let index = 0; const random = () => values[index++ % values.length]; random.calls = () => index; return random; }
  const values = [0.41, 0.73, 0.18, 0.64, 0.52, 0.92, 0.31];
  const plainRng = make(values);
  const baitRng = make(values);
  const base = { habitat: 'freshwater', unlockedPacks: ['F1'], fish: Game.FISH, specialEvents: [] };
  const plain = Probability.encounter(plainRng, { ...base, baitId: null });
  const bait = Probability.encounter(baitRng, { ...base, baitId: 'bait-star' });
  assert.equal(plainRng.calls(), baitRng.calls());
  assert.equal(plain.rollTrace.randomUnhook.roll, bait.rollTrace.randomUnhook.roll);
  assert.equal(plain.rollTrace.randomUnhook.rate, 0.01);
  assert.equal(bait.rollTrace.randomUnhook.rate, 0.01);
});

test('有效收杆完成动画后自动抛下一杆，提前收杆和关闭设置不会连抛', () => {
  let state = Game.purchaseEquipment(funded(), Game.AUTO_CAST_ROD_ID, 1).state;
  state = {
    ...state, firstCast: false, castCount: 8, fishingState: 'bite_ready',
    pendingCatch: { encounterType: 'fish', fishId: Game.FISH[0].id, randomUnhook: true, probabilityVersion: 4, baitId: null }
  };
  state = Game.transition(state, 'reel', () => 0.5, 10);
  assert.equal(state.fishingState, 'empty_reel');
  assert.equal(state.autoCastPending, true);
  state = Game.tick(state, state.stateEndsAt, () => 0.5);
  assert.equal(state.fishingState, 'casting');
  assert.equal(state.castCount, 9);
  assert.equal(state.autoCastPending, false);

  let early = { ...state, fishingState: 'waiting', stateEndsAt: 100 };
  early = Game.transition(early, 'early-reel', () => 0.5, 20);
  assert.equal(early.autoCastPending, false);
  early = Game.tick(early, early.stateEndsAt, () => 0.5);
  assert.equal(early.fishingState, 'idle');

  let disabled = { ...state, fishingState: 'bite_ready', pendingCatch: { encounterType: 'fish', fishId: Game.FISH[0].id, randomUnhook: true, probabilityVersion: 4 } };
  disabled = Game.applySettings(disabled, { autoCastEnabled: false }, 30);
  disabled = Game.transition(disabled, 'reel', () => 0.5, 31);
  disabled = Game.tick(disabled, disabled.stateEndsAt, () => 0.5);
  assert.equal(disabled.fishingState, 'idle');
});

test('普通鱼和特殊事件收杆都会排队，并只在庆祝结束后重抛', () => {
  const equipped = Game.purchaseEquipment(funded(), Game.AUTO_CAST_ROD_ID, 1).state;
  for (const pendingCatch of [
    { encounterType: 'fish', fishId: Game.FISH[0].id, randomUnhook: false, probabilityVersion: 4 },
    { encounterType: 'special', eventId: 'DB-001', seriesId: 'drift_bottle', probabilityVersion: 4 }
  ]) {
    const bite = { ...equipped, firstCast: false, castCount: 6, fishingState: 'bite_ready', pendingCatch };
    const reeling = Game.transition(bite, 'reel', () => 0.5, 10);
    assert.equal(reeling.fishingState, 'reel_pull');
    assert.equal(reeling.autoCastPending, true);
    const celebrating = { ...reeling, fishingState: 'celebrating', stateEndsAt: 20 };
    const recast = Game.tick(celebrating, 20, () => 0.5);
    assert.equal(recast.fishingState, 'casting');
    assert.equal(recast.castCount, 7);
  }
});
