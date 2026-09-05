const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/probability-system');
const G = require('../src/game-state-runtime');
const Events = require('../src/special-events');

function seeded(seed) { let n = seed >>> 0; return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 0x100000000; }; }
function encounter(rng, pity = {}, extra = {}) {
  return P.encounter(rng, { habitat: 'freshwater', unlockedPacks: ['F1'], fish: G.FISH, specialEvents: Events.REGISTRY, specialEventPity: pity, ...extra });
}

test('V3持续序列每3至7次上钩出现事件，任意种子无连发且长空窗最多6次', () => {
  for (const seed of [0, 1, 0x12345678, 0xdeadbeef]) {
    const rng = seeded(seed); let pity = P.normalizeSpecialPity(), previous = 0, specials = 0;
    for (let i = 1; i <= 20000; i++) {
      const result = encounter(rng, pity); pity = result.nextSpecialEventPity;
      assert.ok(pity.nonSpecialStreak <= 6);
      if (result.type === 'special') { assert.ok(i - previous >= 3 && i - previous <= 7); previous = i; specials++; }
    }
    assert.ok(Math.abs(specials / 20000 - 0.2) < 0.006);
  }
});

test('固定间隔与重复收藏状态不会改变鱼类内部命名随机流', () => {
  for (let seed = 0; seed < 100; seed++) {
    const first = encounter(seeded(seed), { nonSpecialStreak: 0, nextSpecialAt: 3 });
    const second = encounter(seeded(seed), { nonSpecialStreak: 0, nextSpecialAt: 7, duplicateSpecialStreak: 8 }, { collection: { 'DB-001': { count: 1 } } });
    for (const layer of ['pack', 'rarity', 'fish', 'randomUnhook', 'variant']) assert.deepEqual(first.rollTrace[layer], second.rollTrace[layer]);
  }
});

test('升级保留已等待进度，旧档达到6次时下一次立即兑现', () => {
  for (const oldStreak of [6, 7, 12, 999999]) {
    const state = G.normalizeState({ probabilityVersion: 2, specialEventPity: { nonSpecialStreak: oldStreak, duplicateSpecialStreak: 5 } }, 10);
    assert.equal(state.specialEventPity.nonSpecialStreak, 6);
    assert.equal(encounter(() => 0.99, state.specialEventPity).type, 'special');
  }
  const state = G.normalizeState({ specialEventPity: { nonSpecialStreak: 4, duplicateSpecialStreak: 2 } }, 10);
  assert.equal(state.specialEventPity.nonSpecialStreak, 4);
});

test('runtime在首次中鱼时持久化间隔，重启暂停与重复tick不会重抽或重复计数', (t) => {
  t.mock.method(Events, 'runtimeRegistry', () => Events.REGISTRY);
  const before = { ...G.createInitialState(0), fishingState: 'waiting', stateEndsAt: 10 };
  const bite = G.tick(before, 10, seeded(7));
  assert.equal(bite.fishingState, 'bite_intro');
  assert.ok(bite.specialEventPity.nextSpecialAt >= 3);
  const restored = G.normalizeState(JSON.parse(JSON.stringify(bite)), 11);
  assert.deepEqual(restored.pendingCatch, bite.pendingCatch);
  assert.deepEqual(restored.specialEventPity, bite.specialEventPity);
  assert.deepEqual(G.tick(restored, 11, () => { throw Error('must not reroll'); }).specialEventPity, bite.specialEventPity);
  const paused = G.tick({ ...restored, isPaused: true }, 9999, () => { throw Error('paused'); });
  assert.deepEqual(paused.specialEventPity, bite.specialEventPity);
});

test('事件提醒结束保留待收杆，不提前收藏也不重抽事件', (t) => {
 t.mock.method(Events,'runtimeRegistry',()=>Events.REGISTRY);
 let state={...G.createInitialState(0),fishingState:'waiting',stateEndsAt:10,specialEventPity:{nonSpecialStreak:2,nextSpecialAt:3,duplicateSpecialStreak:8}};
 state=G.tick(state,10,seeded(8));assert.equal(state.pendingCatch.encounterType,'special');
 const next={...state.specialEventPity},pending=state.pendingCatch;
 state=G.tick(state,state.biteDeadlineAt,seeded(9));assert.equal(state.fishingState,'bite_ready');
 state=G.tick(state,86400000,()=>{throw Error('Should not reroll');});
 assert.deepEqual(state.specialEventCollection.entries,{});assert.deepEqual(state.specialEventPity,next);assert.deepEqual(state.pendingCatch,pending);
 const reel=G.transition(state,'reel',seeded(10),86400001);assert.equal(reel.fishingState,'reel_pull');assert.deepEqual(reel.pendingCatch,pending);
});

test('素材不可用时冻结节奏与重复计数，恢复后兑现已到期事件', (t) => {
  const pity = { nonSpecialStreak: 6, duplicateSpecialStreak: 8, nextSpecialAt: 7 };
  t.mock.method(Events, 'runtimeRegistry', () => []);
  const bite = G.tick({ ...G.createInitialState(0), fishingState: 'waiting', stateEndsAt: 10, specialEventPity: pity }, 10, () => 0.5);
  assert.equal(bite.pendingCatch.encounterType, 'fish');
  assert.deepEqual(bite.specialEventPity, pity);
  assert.equal(encounter(() => 0.5, bite.specialEventPity).type, 'special');
});

test('第9次特殊成功候选仍强制未发现内容，超时不会消费新内容保护', () => {
  const collection = Object.fromEntries(Events.REGISTRY.slice(0, 59).map((event) => [event.id, { count: 1 }]));
  const pity = { nonSpecialStreak: 6, nextSpecialAt: 7, duplicateSpecialStreak: 8 };
  const result = encounter(() => 0.5, pity, { collection });
  assert.equal(result.eventId, Events.REGISTRY[59].id);
  assert.equal(result.selectionMode, 'new_item_pity');
  assert.equal(result.nextSpecialEventPity.duplicateSpecialStreak, 8);
});

test('异常间隔安全归一，缺失鱼类候选不推进一次有效上钩', () => {
  for (const interval of [-1, 0, 2, 8, 3.5, Infinity, 'bad', null]) assert.equal(P.normalizeSpecialPity({ nextSpecialAt: interval }).nextSpecialAt, null);
  const pity = { nonSpecialStreak: 0, nextSpecialAt: 7, duplicateSpecialStreak: 0 };
  const none = encounter(() => 0.5, pity, { fish: [] });
  assert.equal(none.type, 'none');
  assert.deepEqual(none.nextSpecialEventPity, pity);
});

test('迁移旧pending保留V2选定来源，重启和结算不把鱼获标成V3', () => {
  const old = { ...G.createInitialState(0), probabilityVersion: 2, fishingState: 'catch_land',
    pendingCatch: { fishId: 'fish-1', variant: 'normal', catchId: 'legacy-v2', measurementRolls: [0.5, 0.5] } };
  const restored = G.normalizeState(JSON.parse(JSON.stringify(old)), 10);
  assert.equal(restored.probabilityVersion, 3);
  assert.equal(restored.pendingCatch.probabilityVersion, 2);
  assert.equal(restored.pendingCatch.fishId, old.pendingCatch.fishId);
  const again = G.normalizeState(JSON.parse(JSON.stringify(restored)), 20);
  const committed = G.commitCatch(again, () => { throw Error('already selected, must not reroll'); }, 30);
  assert.equal(committed.currentResult.probabilityVersion, 2);
  assert.equal(committed.history[0].probabilityVersion, 2);
  assert.equal(committed.inventory[0].probabilityVersion, 2);
});

test('pending显式版本优先于外层版本，最早无版本旧档标记来源1', () => {
  const explicit = G.normalizeState({ probabilityVersion: 3, pendingCatch: { fishId: 'fish-1', probabilityVersion: 2 } }, 10);
  assert.equal(explicit.pendingCatch.probabilityVersion, 2);
  const legacy = G.normalizeState({ pendingCatch: { fishId: 'fish-1' } }, 10);
  assert.equal(legacy.pendingCatch.probabilityVersion, 1);
});

test('V3新鱼类与特殊pending记录选定来源，特殊和脱钩结算继续使用原来源', (t) => {
  t.mock.method(Events, 'runtimeRegistry', () => Events.REGISTRY);
  const waiting = { ...G.createInitialState(0), fishingState: 'waiting', stateEndsAt: 10 };
  const fish = G.tick(waiting, 10, seeded(2));
  assert.equal(fish.pendingCatch.probabilityVersion, 3);
  const special = G.tick({ ...waiting, specialEventPity: { nonSpecialStreak: 6, nextSpecialAt: 7 } }, 10, seeded(2));
  assert.equal(special.pendingCatch.probabilityVersion, 3);
  const oldSpecial = { ...special, probabilityVersion: 3, fishingState: 'catch_land', pendingCatch: { ...special.pendingCatch, probabilityVersion: 2 } };
  assert.equal(G.commitCatch(oldSpecial, () => { throw Error('must not reroll special'); }, 20).currentResult.probabilityVersion, 2);
  const oldUnhook = { ...fish, fishingState: 'bite_loop', pendingCatch: { ...fish.pendingCatch, randomUnhook: true, probabilityVersion: 2 } };
  assert.equal(G.transition(oldUnhook, 'reel', () => 0.5, 20).currentResult.probabilityVersion, 2);
});
