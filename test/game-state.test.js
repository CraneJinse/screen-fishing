const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/game-state-runtime');

test('正式状态机完成抛竿、中鱼、飞鱼、落船与庆祝链', () => {
  const t = 1000;
  const successRandom = () => 0.5;
  let state = G.createInitialState(t);
  state = G.transition(state, 'cast', successRandom, t);
  state = G.tick(state, state.stateEndsAt, successRandom);
  assert.equal(state.fishingState, 'waiting');
  assert.equal(state.stateEndsAt - t, 10000);
  state = G.tick(state, state.stateEndsAt, successRandom);
  assert.equal(state.fishingState, 'bite_intro');
  assert.equal(state.biteDeadlineAt - state.stateStartedAt, 30000);
  state = G.transition(state, 'reel', successRandom, state.stateStartedAt + 1);
  state = G.tick(state, state.stateEndsAt, successRandom);
  assert.equal(state.fishingState, 'catch_flight');
  state = G.tick(state, state.stateEndsAt, successRandom);
  assert.equal(state.fishingState, 'catch_land');
  assert.equal(state.history.length, 0);
  assert.equal(state.catchCommitAt - state.stateStartedAt, G.ACTION_DURATIONS.catch_land / 6);
  state = G.tick(state, state.catchCommitAt, successRandom);
  assert.equal(state.fishingState, 'catch_land');
  assert.equal(state.catchCommitted, true);
  assert.equal(state.history.length, 1);
  assert.equal(state.stats.totalCatchCount, 1);
  const catchId = state.currentResult.catchId;
  const committedAgain = G.commitCatch(state, () => .5, state.stateStartedAt + 20);
  assert.equal(committedAgain.history.length, 1);
  assert.equal(committedAgain.currentResult.catchId, catchId);
  state = G.tick(state, state.stateEndsAt, successRandom);
  assert.equal(state.fishingState, 'celebrating');
  state = G.tick(state, state.stateEndsAt, successRandom);
  assert.equal(state.fishingState, 'idle');
  assert.equal(state.history[0].catchId, catchId);
});

test('30秒后安静待收杆，长期不丢失当前鱼获', () => {
 let s={...G.createInitialState(0),fishingState:'waiting',stateEndsAt:1000};
 s=G.tick(s,1000,()=>.5);const pending=s.pendingCatch,deadline=s.biteDeadlineAt;
 s=G.tick(s,s.stateEndsAt,()=>.5);assert.equal(s.fishingState,'bite_loop');assert.equal(s.stateEndsAt,deadline);
 s=G.tick(s,deadline,()=>.5);assert.equal(s.fishingState,'bite_ready');assert.equal(s.stateEndsAt,null);
 s=G.tick(s,deadline+86400000,()=>{throw Error('No new roll while ready');});
 assert.deepEqual(s.pendingCatch,pending);assert.equal(s.stats.escapeCount,0);assert.equal(s.catches,0);
 assert.equal(G.transition(s,'reel',()=>.5,deadline+86400001).fishingState,'reel_pull');
});

test('提前收杆播放空杆并回到 idle', () => {
  let state = { ...G.createInitialState(100), fishingState: 'waiting', stateEndsAt: 5000 };
  state = G.transition(state, 'early-reel', () => 0, 200);
  assert.equal(state.fishingState, 'empty_reel');
  state = G.tick(state, state.stateEndsAt, () => 0);
  assert.equal(state.fishingState, 'idle');
  assert.equal(state.history.length, 0);
});

test('首杆10秒含动画，新手30–90秒，常规5–10分钟且中心更密集', () => {
 const state=G.createInitialState();assert.equal(G.durationFor(state),10000-G.ACTION_DURATIONS.casting);
 let seed=19;const rng=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
 for(const [castCount,min,max] of [[2,30000,90000],[5,30000,90000],[6,300000,600000],[500,300000,600000]]){
 const values=Array.from({length:1000},()=>G.durationFor({...state,firstCast:false,castCount},rng));
 assert.ok(Math.min(...values)>=min&&Math.max(...values)<=max);
 assert.ok(values.filter(v=>v>min+(max-min)*.3&&v<min+(max-min)*.7).length>values.filter(v=>v<min+(max-min)*.1||v>min+(max-min)*.9).length);
 }
});

test('图鉴为四包152种且各包规格正确', () => {
  assert.equal(G.FISH.length, 152);
  for (const pack of Object.keys(G.PACKS)) {
    const fish = G.FISH.filter((item) => item.pack === pack);
    assert.equal(fish.length, 38);
    assert.deepEqual(G.RARITIES.map((rarity) => fish.filter((item) => item.rarity === rarity).length), [18, 10, 6, 3, 1]);
  }
});

test('旧存档迁移到当前 schema 并把历史扩展到1000条', () => {
  const fish = G.FISH[0];
  const old = {
    version: 3, fishingState: 'bite', suspendedRemainingMs: 5000,
    settings: { ...G.defaultSettings, reducedMotion: true, urgentMotion: false },
    collection: { [fish.id]: { count: 2, firstAt: 1, maxSize: 20, maxWeight: 2 } },
    history: Array.from({ length: 1100 }, (_, index) => ({ id: index, type: 'fish', resultId: fish.id, name: fish.name, at: index, size: '20.0 cm', weight: '2.00 kg' }))
  };
  const state = G.normalizeState(old, 9999);
  assert.equal(state.saveSchemaVersion, G.SAVE_SCHEMA_VERSION);
  assert.equal(state.fishingState, 'bite_loop');
  assert.equal(state.isPaused, true);
  assert.equal(state.history.length, 1000);
  assert.equal(state.collection[fish.id].maxLengthCm, 20);
  assert.equal(Object.hasOwn(state.settings, 'reducedMotion'), false);
  assert.equal(Object.hasOwn(state.settings, 'urgentMotion'), false);
});

test('废弃动态设置不能通过设置补丁重新写入', () => {
  const state = G.applySettings(G.createInitialState(0), { reducedMotion: true, urgentMotion: false, showCastTimer: false }, 1);
  assert.equal(Object.hasOwn(state.settings, 'reducedMotion'), false);
  assert.equal(Object.hasOwn(state.settings, 'urgentMotion'), false);
  assert.equal(state.settings.showCastTimer, false);
});

test('四个不同角落的抛竿记录可累计并解锁屏幕四角成就', () => {
  let state = G.createInitialState(0);
  for (const [index, corner] of ['top-left', 'top-right', 'bottom-left', 'bottom-right'].entries()) {
    state = G.transition({ ...state, fishingState: 'idle' }, 'cast', () => 0.5, index + 1, { corner });
  }
  assert.deepEqual(Object.keys(state.cornerCasts).sort(), ['bottom-left', 'bottom-right', 'top-left', 'top-right']);
  assert.equal(state.achievements.includes('corners'), true);
});

test('暂停与恢复同时冻结状态迁移和中鱼截止时间', () => {
  const state = { ...G.createInitialState(1000), fishingState: 'bite_loop', stateEndsAt: 25000, biteDeadlineAt: 31000 };
  const paused = G.suspend(state, 4000);
  assert.deepEqual(paused.pausedTimers, { stateRemainingMs: 21000, biteRemainingMs: 27000, catchCommitRemainingMs: null, castTimerElapsedMs: 0 });
  assert.deepEqual(G.suspend(paused, 8000).pausedTimers, paused.pausedTimers);
  const resumed = G.resume(paused, 20000);
  assert.equal(resumed.stateEndsAt, 41000);
  assert.equal(resumed.biteDeadlineAt, 47000);
});

test('概率边界覆盖五档并尊重启用鱼包', () => {
  const cases = [[0, 'common'], [.62, 'rare'], [.87, 'epic'], [.96, 'legendary'], [.99, 'mythic']];
  for (const [roll, rarity] of cases) {
    const values = [roll, 0];
    const fish = G.pickResult(() => values.shift() ?? 0, 'S2');
    assert.equal(fish.pack, 'S2');
    assert.equal(fish.rarity, rarity);
  }
});

test('物种尺寸由长度关联重量并受资料范围约束', () => {
  const profile = { lengthCm: { min: 10, typical: 20, max: 30 }, weightKg: { min: .1, typical: .8, max: 3 }, displayClass: 'small' };
  let seed = 123456789;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const samples = Array.from({ length: 5000 }, () => G.generateMeasurement(G.FISH[0], random, profile));
  assert.ok(samples.every((sample) => sample.lengthCm >= 10 && sample.lengthCm <= 30));
  assert.ok(samples.every((sample) => sample.weightKg >= .1 && sample.weightKg <= 3));
  assert.ok(samples.filter((sample) => sample.lengthCm >= 18 && sample.lengthCm <= 22).length
    > samples.filter((sample) => sample.lengthCm <= 12 || sample.lengthCm >= 28).length * 4);
  const lightMean = samples.filter((sample) => sample.lengthCm < 18).reduce((sum, sample) => sum + sample.weightKg, 0) / samples.filter((sample) => sample.lengthCm < 18).length;
  const heavyMean = samples.filter((sample) => sample.lengthCm > 22).reduce((sum, sample) => sum + sample.weightKg, 0) / samples.filter((sample) => sample.lengthCm > 22).length;
  assert.ok(heavyMean > lightMean * 1.5);
});

test('相同长度仍有独立体况扰动且亚克级重量不会被压成1克', () => {
  const profile = { lengthCm: { min: 10, typical: 20, max: 30 }, weightG: { min: 20, typical: 80, max: 300 }, massModel: { a: .01, b: 3 }, noise: { min: .85, max: 1.15 } };
  const sequenceA = [.5, .5, .5, .5];
  const sequenceB = [.5, .5, .5, 0];
  const a = G.generateMeasurement(G.FISH[0], () => sequenceA.shift() ?? .5, profile);
  const b = G.generateMeasurement(G.FISH[0], () => sequenceB.shift() ?? .5, profile);
  assert.equal(a.lengthCm, b.lengthCm);
  assert.notEqual(a.weightKg, b.weightKg);
  assert.equal(G.formatWeight(.00024), '240 mg');
});

test('旧版1克哨兵记录按既有长度迁移为新版重量', () => {
  const fish = G.FISH[0];
  const state = {
    ...G.createInitialState(1),
    history: [{ catchId: 'legacy-weight', id: 'legacy-weight', at: 1, resultId: fish.id, name: fish.name, type: 'fish', rarity: fish.rarity, rarityName: fish.rarityName, pack: fish.pack, packName: fish.packName, lengthCm: 10, weightKg: .001, size: '10.0 cm', weight: '1 g', measurementVersion: 2 }],
    collection: { [fish.id]: { count: 1, firstAt: 1, lastAt: 1, maxLengthCm: 10, maxWeightKg: .001 } }
  };
  const profile = { [fish.id]: { lengthCm: { min: 3, typical: 10, max: 40 }, weightG: { min: 1, typical: 25, max: 1200 }, massModel: { a: .025, b: 3 }, noise: { min: .9, max: 1.1 } } };
  const migrated = G.repairLegacyMeasurements(state, profile);
  assert.equal(migrated.history[0].measurementVersion, 5);
  assert.notEqual(migrated.history[0].weight, '1 g');
  assert.ok(migrated.history[0].weightKg > .02 && migrated.history[0].weightKg < .03);
});

test('落船尺寸只由上钩时保存的随机值决定，重启后不会漂移', () => {
  const fish = G.FISH[0];
  const base = {
    ...G.createInitialState(1), fishingState: 'catch_land', catchCommitted: false,
    pendingCatch: { fishId: fish.id, catchId: 'stable-measurement', selectedAt: 2, measurementRolls: [.23, .71] }
  };
  const profile = { [fish.id]: { lengthCm: { min: 10, typical: 20, max: 40 }, weightKg: { min: .1, typical: .8, max: 4 } } };
  const first = G.commitCatch(base, () => .01, 100, profile).currentResult;
  const afterRestart = G.commitCatch(JSON.parse(JSON.stringify(base)), () => .99, 100, profile).currentResult;
  assert.equal(first.lengthCm, afterRestart.lengthCm);
  assert.equal(first.weightKg, afterRestart.weightKg);
});

test('资源路径与manifest映射拒绝路径穿越', () => {
  assert.equal(G.safeAssetPath('f1/icons/gold.png'), 'f1/icons/gold.png');
  assert.equal(G.safeAssetPath('../x.png'), null);
  assert.equal(G.safeAssetPath('C:/x.png'), null);
  assert.deepEqual(G.fishManifestMap({ entries: [{ catalogIndex: 1, icon: 'f1/icons/gold.png' }, { catalogIndex: 2, icon: '../bad.png' }] }), { 'fish-1': 'f1/icons/gold.png' });
});

test('设置更新忽略未知字段并限制桌宠缩放', () => {
  const state = G.applySettings(G.createInitialState(), { petScale: 9, activePack: 'bad', unknown: 'x', muted: 0 });
  assert.equal(state.settings.petScale, 1.35);
  assert.equal(Object.hasOwn(state.settings, 'activePack'), false);
  assert.equal(state.settings.muted, false);
  assert.equal(Object.hasOwn(state.settings, 'unknown'), false);
  assert.equal(state.settings.showCastTimer, true);
});

test('历史重量优先信任有限weightKg，展示字符串不会让它重复除以1000', () => {
  const fish = G.FISH[0];
  const state = G.normalizeState({
    history: [{ catchId: 'weight-unit', id: 'weight-unit', at: 1, type: 'fish', resultId: fish.id, lengthCm: 12, weightKg: 0.024, weight: '24.0 g', measurementVersion: 4 }]
  }, 2);
  assert.equal(state.history[0].weightKg, 0.024);
  assert.equal(state.history[0].weight, '24.0 g');
  assert.equal(G.normalizeState(state, 3).history[0].weightKg, 0.024);
});

test('空weightKg不被当成0，历史与库存都回退解析展示单位', () => {
  const fish = G.FISH[0];
  const state = G.normalizeState({
    history: [{ catchId: 'null-weight', at: 1, type: 'fish', resultId: fish.id, lengthCm: 12, weightKg: null, weight: '24.0 g', measurementVersion: 2 }],
    inventory: [{ inventoryId: 'null-weight', catchId: 'null-weight', fishId: fish.id, caughtAt: 1, lengthCm: 12, weightKg: '', weight: '24.0 g', valueCoins: 12 }]
  }, 2);
  assert.equal(state.history[0].weightKg, 0.024);
  assert.equal(state.inventory[0].weightKg, 0.024);
});

test('亚克级重量在历史与仓库归一化后保持一致且不会被抬到1克', () => {
  const fish = G.FISH.find((item) => item.id === 'fish-133') || G.FISH[0];
  const tinyWeightKg = 0.00012465;
  const catchId = 'subgram-roundtrip';
  const state = G.normalizeState({
    history: [{ catchId, id: catchId, type: 'fish', resultId: fish.id, lengthCm: 2.4, weightKg: tinyWeightKg, weight: '0.12 g', measurementVersion: 4 }],
    inventory: [{ inventoryId: catchId, catchId, fishId: fish.id, lengthCm: 2.4, weightKg: tinyWeightKg, weight: '0.12 g', measurementVersion: 4, valueCoins: 10 }]
  }, 1);
  assert.equal(state.history[0].weightKg, tinyWeightKg);
  assert.equal(state.inventory[0].weightKg, tinyWeightKg);
  assert.equal(state.history[0].weight, '125 mg');
  assert.equal(state.inventory[0].weight, '125 mg');
});

test('毫克展示可以无损回读且v5迁移同步修正历史和仓库', () => {
  const fish = G.FISH[0];
  const catchId = 'v5-outside-range';
  const profile = { [fish.id]: { lengthCm: { min: 6.5, typical: 10, max: 12 }, weightG: { min: 8, typical: 25, max: 55 }, massModel: { type: 'power', a: .025, b: 3 }, noise: { min: .9, max: 1.1 } } };
  const migrated = G.repairLegacyMeasurements({
    ...G.createInitialState(1), measurementVersion: 4,
    history: [{ catchId, id: catchId, at: 1, type: 'fish', resultId: fish.id, lengthCm: 2, weightKg: .0002, weight: '200 mg', measurementVersion: 4 }],
    inventory: [{ inventoryId: catchId, catchId, fishId: fish.id, caughtAt: 1, lengthCm: 2, weightKg: .0002, weight: '200 mg', measurementVersion: 4, valueCoins: 1 }],
    collection: { [fish.id]: { count: 1, firstAt: 1, lastAt: 1, maxLengthCm: 2, maxWeightKg: .0002 } }
  }, profile);
  assert.equal(G.normalizeState({ history: [{ catchId: 'mg', type: 'fish', resultId: fish.id, lengthCm: 2, weight: '240 mg' }] }, 2).history[0].weightKg, .00024);
  assert.ok(migrated.history[0].lengthCm >= 6.5 && migrated.history[0].lengthCm <= 12);
  assert.equal(migrated.history[0].measurementVersion, 5);
  assert.equal(migrated.inventory[0].lengthCm, migrated.history[0].lengthCm);
  assert.equal(migrated.inventory[0].weightKg, migrated.history[0].weightKg);
  assert.equal(migrated.inventory[0].weight, migrated.history[0].weight);
  assert.equal(migrated.measurementVersion, 5);
});

test('旧历史自动迁移成去重库存并补算固定价值', () => {
  const fish = G.FISH[0];
  const old = {
    history: [
      { catchId: 'old-1', id: 'old-1', at: 1, type: 'fish', resultId: fish.id, lengthCm: 10, weightKg: 0.001, weight: '1 g', measurementVersion: 3 },
      { catchId: 'old-1', id: 'old-1', at: 1, type: 'fish', resultId: fish.id, lengthCm: 10, weightKg: 0.001, weight: '1 g', measurementVersion: 3 }
    ]
  };
  const profile = { [fish.id]: { lengthCm: { min: 3, typical: 10, max: 40 }, weightG: { min: 1, typical: 25, max: 1200 }, massModel: { a: .025, b: 3 }, noise: { min: .9, max: 1.1 } } };
  const migrated = G.repairLegacyMeasurements(old, profile);
  assert.equal(migrated.inventory.length, 1);
  assert.equal(migrated.inventory[0].inventoryId, 'old-1');
  assert.ok(migrated.inventory[0].weightKg > .02);
  assert.ok(migrated.inventory[0].valueCoins > 1);
  assert.equal(migrated.history[0].valueCoins, migrated.inventory[0].valueCoins);
  assert.equal(migrated.economyVersion, 2);
});

test('抛竿计时在中鱼停止，暂停不计入时间且提前收杆清零', () => {
  let state = G.transition(G.createInitialState(100), 'cast', () => 0, 100);
  assert.equal(state.castTimerStartedAt, 100);
  state = G.tick(state, state.stateEndsAt, () => 0);
  const biteAt = state.stateEndsAt;
  state = G.tick(state, biteAt, () => 0);
  assert.equal(state.castTimerStartedAt, null);
  assert.equal(state.castTimerElapsedMs, biteAt - 100);
  state = G.suspend({ ...state, fishingState: 'waiting', stateEndsAt: 9000, castTimerStartedAt: 2000, castTimerElapsedMs: 0 }, 4000);
  assert.equal(state.pausedTimers.castTimerElapsedMs, 2000);
  const resumed = G.resume(state, 20000);
  assert.equal(resumed.castTimerStartedAt, 18000);
  const empty = G.transition({ ...resumed, fishingState: 'waiting', stateEndsAt: 30000 }, 'early-reel', () => 0, 21000);
  assert.equal(empty.castTimerStartedAt, null);
  assert.equal(empty.castTimerElapsedMs, 0);
});

test('归一化旧存档会幂等补齐已达成成就及解锁时间', () => {
  const first = G.normalizeState({ castCount: 1, stats: { totalCatchCount: 1 }, achievements: [] }, 1234);
  assert.ok(first.achievements.includes('first-cast'));
  assert.ok(first.achievements.includes('first-catch'));
  assert.equal(first.achievementTimes['first-cast'], 1234);
  const second = G.normalizeState(first, 9999);
  assert.equal(second.achievementTimes['first-cast'], 1234);
});

test('落船结算时刻服从动作清单第2帧起点', () => {
  const timings = { catch_land: { totalMs: 900, frameStartMs: [0, 210, 350, 500, 650, 780] } };
  let state = { ...G.createInitialState(1), fishingState: 'catch_flight', stateEndsAt: 1000, pendingCatch: { fishId: 'fish-1', selectedAt: 1, catchId: 'fixed', measurementRolls: [.5, .5] } };
  state = G.tick(state, 1000, () => .5, {}, timings);
  assert.equal(state.catchCommitAt, 1210);
  assert.equal(G.tick(state, 1209, () => .5, {}, timings).history.length, 0);
  const committed = G.tick(state, 1210, () => .5, {}, timings);
  assert.equal(committed.history.length, 1);
  assert.equal(committed.history[0].catchId, 'fixed');
});

test('累计统计不依赖会裁剪的历史列表并可解锁单包与尺寸成就', () => {
  const collection = {};
  for (const fish of G.FISH.filter((item) => item.pack === 'F1')) {
    collection[fish.id] = { count: 2, firstAt: 1, lastAt: 2, maxLengthCm: fish.id === 'fish-1' ? 120 : 20, maxWeightKg: fish.id === 'fish-1' ? 12 : .5 };
  }
  let state = G.normalizeState({ collection, history: [], measurementVersion: 5 }, 100);
  assert.equal(state.stats.totalCatchCount, 76);
  assert.equal(state.stats.packUnique.F1, 38);
  state = G.unlockAchievements(state, 101);
  assert.ok(state.achievements.includes('pack-f1-complete'));
  assert.ok(state.achievements.includes('length-record'));
  assert.ok(state.achievements.includes('weight-record'));
});

test('连续不同物种统计跨结算累计且重复物种重置为1', () => {
  const fish = G.FISH.slice(0, 5);
  let state = G.createInitialState(0);
  for (let index = 0; index < fish.length; index += 1) {
    state = {
      ...state, fishingState: 'catch_land', catchCommitted: false, currentResult: null,
      pendingCatch: { fishId: fish[index].id, catchId: `streak-${index}`, selectedAt: index, measurementRolls: [.5, .5] }
    };
    state = G.commitCatch(state, () => .5, 100 + index);
  }
  assert.equal(state.stats.bestDistinctStreak, 5);
  assert.ok(state.achievements.includes('five-unique-window'));
  assert.ok(!state.achievements.includes('variety-streak-5'));
  state = { ...state, fishingState: 'catch_land', catchCommitted: false, currentResult: null, pendingCatch: { fishId: fish[4].id, catchId: 'repeat', selectedAt: 9, measurementRolls: [.5, .5] } };
  state = G.commitCatch(state, () => .5, 200);
  assert.equal(state.stats.distinctStreak, 1);
  assert.equal(state.stats.bestDistinctStreak, 5);
});

test('每次结算自动创建唯一库存实例并把实际价值固化到历史', () => {
  const fish = G.FISH[0];
  const base = {
    ...G.createInitialState(1), fishingState: 'catch_land', catchCommitted: false,
    pendingCatch: { fishId: fish.id, catchId: 'inventory-catch', selectedAt: 2, measurementRolls: [.4, .6] }
  };
  const committed = G.commitCatch(base, () => .5, 100);
  assert.equal(committed.inventory.length, 1);
  assert.equal(committed.inventory[0].inventoryId, 'inventory-catch');
  assert.equal(committed.inventory[0].catchId, committed.history[0].catchId);
  assert.equal(committed.inventory[0].valueCoins, committed.history[0].valueCoins);
  assert.ok(committed.inventory[0].valueCoins > 0);
  const again = G.commitCatch(committed, () => .5, 101);
  assert.equal(again.inventory.length, 1);
});

test('经济基准以稀有度为首要差异且鱼包倍率温和递增', () => {
  assert.deepEqual(G.RARITY_BASE_VALUES, { common: 20, rare: 60, epic: 180, legendary: 600, mythic: 2400 });
  assert.deepEqual(G.PACK_MULTIPLIERS, { F1: 1, F2: 1.08, S1: 1.16, S2: 1.25 });
  for (const fish of G.FISH) {
    const nominal = G.RARITY_BASE_VALUES[fish.rarity] * G.PACK_MULTIPLIERS[fish.pack];
    assert.ok(fish.baseValueCoins >= Math.floor(nominal * .94) && fish.baseValueCoins <= Math.ceil(nominal * 1.06));
  }
  const commonAverage = (pack) => {
    const values = G.FISH.filter((fish) => fish.pack === pack && fish.rarity === 'common').map((fish) => fish.baseValueCoins);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  assert.ok(commonAverage('F1') < commonAverage('F2'));
  assert.ok(commonAverage('F2') < commonAverage('S1'));
  assert.ok(commonAverage('S1') < commonAverage('S2'));
  assert.deepEqual(G.PACK_PRICES, { F1: 0, F2: 4000, S1: 6000, S2: 8000 });
  assert.deepEqual(G.PACK_ORDER.map((pack) => G.getPackPrice(pack)), [0, 4000, 6000, 8000]);
});

test('同种鱼尺寸只在基准价值附近微调', () => {
  const fish = G.FISH[0];
  const profile = { lengthCm: { min: 5, typical: 10, max: 20 }, weightG: { min: 5, typical: 20, max: 100 } };
  const small = G.calculateCatchValue(fish, { lengthCm: 5, weightKg: .005 }, profile);
  const normal = G.calculateCatchValue(fish, { lengthCm: 10, weightKg: .02 }, profile);
  const large = G.calculateCatchValue(fish, { lengthCm: 20, weightKg: .1 }, profile);
  assert.ok(small < normal && normal < large);
  assert.ok(small >= Math.round(fish.baseValueCoins * .8));
  assert.ok(large <= Math.round(fish.baseValueCoins * 1.25));
});

test('仓库支持最新与图鉴同种小到大排序且不修改原数组', () => {
  const first = G.FISH.find((fish) => fish.pack === 'F1');
  const second = G.FISH.find((fish) => fish.pack === 'F2');
  const source = [
    { inventoryId: 'b', fishId: first.id, caughtAt: 3, lengthCm: 20, weightKg: .2 },
    { inventoryId: 'c', fishId: second.id, caughtAt: 5, lengthCm: 10, weightKg: .1 },
    { inventoryId: 'a', fishId: first.id, caughtAt: 1, lengthCm: 8, weightKg: .05 }
  ];
  assert.deepEqual(G.sortInventory(source, 'newest').map((item) => item.inventoryId), ['c', 'b', 'a']);
  assert.deepEqual(G.sortInventory(source, 'catalog').map((item) => item.inventoryId), ['a', 'b', 'c']);
  assert.deepEqual(source.map((item) => item.inventoryId), ['b', 'c', 'a']);
});

test('单卖和批量卖出原子结算，已售鱼不能重复出售', () => {
  const fish = G.FISH[0];
  const state = G.normalizeState({
    economyVersion: 1,
    inventory: [
      { inventoryId: 'one', catchId: 'one', fishId: fish.id, caughtAt: 1, lengthCm: 10, weightKg: .02, valueCoins: 10, measurementVersion: 4 },
      { inventoryId: 'two', catchId: 'two', fishId: fish.id, caughtAt: 2, lengthCm: 12, weightKg: .03, valueCoins: 15, measurementVersion: 4 }
    ],
    history: [
      { catchId: 'one', type: 'fish', resultId: fish.id, at: 1, lengthCm: 10, weightKg: .02, valueCoins: 10, measurementVersion: 4 },
      { catchId: 'two', type: 'fish', resultId: fish.id, at: 2, lengthCm: 12, weightKg: .03, valueCoins: 15, measurementVersion: 4 }
    ]
  }, 3);
  const invalidBatch = G.sellInventory(state, ['one', 'missing'], 10);
  assert.equal(invalidBatch.ok, false);
  assert.equal(invalidBatch.state.inventory.length, 2);
  assert.equal(invalidBatch.state.wallet.balance, 0);
  const sold = G.sellInventory(state, ['one', 'two'], 11);
  assert.equal(sold.ok, true);
  assert.equal(sold.earned, 25);
  assert.equal(sold.state.wallet.balance, 25);
  assert.equal(sold.state.inventory.length, 0);
  assert.ok(sold.state.history.every((entry) => entry.soldAt === 11));
  const duplicate = G.sellInventory(sold.state, 'one', 12);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.state.wallet.balance, 25);
});

test('默认仅F1解锁，购买鱼包扣款并控制淡水咸水候选池', () => {
  let state = G.createInitialState(1);
  assert.deepEqual(state.ownedPacks, ['F1']);
  assert.ok(G.getAvailableFish(state).every((fish) => fish.pack === 'F1'));
  const locked = G.switchHabitat(state, 'saltwater', 2);
  assert.equal(locked.ok, false);
  state = { ...state, wallet: { ...state.wallet, balance: 18000 } };
  const missingPrerequisite = G.purchasePack(state, 'S1', 3);
  assert.equal(missingPrerequisite.ok, false);
  assert.equal(missingPrerequisite.reason, 'previous-pack-required');
  assert.equal(missingPrerequisite.requiredPack, 'F2');
  assert.equal(missingPrerequisite.state.wallet.balance, 18000);
  const boughtFresh = G.purchasePack(state, 'F2', 4);
  assert.equal(boughtFresh.ok, true);
  assert.equal(boughtFresh.cost, 4000);
  const skippedSalt = G.purchasePack(boughtFresh.state, 'S2', 4);
  assert.equal(skippedSalt.reason, 'previous-pack-required');
  assert.equal(skippedSalt.requiredPack, 'S1');
  assert.equal(skippedSalt.state.wallet.balance, boughtFresh.state.wallet.balance);
  const boughtSalt = G.purchasePack(boughtFresh.state, 'S1', 5);
  assert.equal(boughtSalt.ok, true);
  assert.equal(boughtSalt.cost, 6000);
  assert.ok(boughtSalt.state.ownedPacks.includes('S1'));
  const switched = G.switchHabitat(boughtSalt.state, 'saltwater', 6);
  assert.equal(switched.ok, true);
  assert.ok(G.getAvailableFish(switched.state).every((fish) => fish.pack === 'S1'));
  const boughtDeep = G.purchasePack(switched.state, 'S2', 7);
  assert.equal(boughtDeep.ok, true);
  assert.equal(boughtDeep.state.wallet.balance, 0);
  const fresh = G.switchHabitat(boughtDeep.state, 'freshwater', 8);
  assert.deepEqual([...new Set(G.getAvailableFish(fresh.state).map((fish) => fish.pack))].sort(), ['F1', 'F2']);
  const duplicate = G.purchasePack(fresh.state, 'F2', 9);
  assert.equal(duplicate.reason, 'already-owned');
  assert.equal(duplicate.state.wallet.balance, fresh.state.wallet.balance);
});

test('经济v2保留旧库存固化价值并补齐旧版非线性鱼包前置', () => {
  const fish = G.FISH[0];
  const legacy = {
    economyVersion: 1,
    ownedPacks: ['F1', 'S1'],
    history: [{ catchId: 'legacy-price', type: 'fish', resultId: fish.id, at: 1, lengthCm: 12, weightKg: .03, weight: '30.0 g', valueCoins: 777, measurementVersion: 5 }],
    inventory: [{ inventoryId: 'legacy-price', catchId: 'legacy-price', fishId: fish.id, caughtAt: 1, lengthCm: 12, weightKg: .03, valueCoins: 777, measurementVersion: 5 }]
  };
  const migrated = G.repairLegacyMeasurements(legacy, {});
  assert.equal(migrated.economyVersion, 2);
  assert.equal(migrated.history[0].valueCoins, 777);
  assert.equal(migrated.inventory[0].valueCoins, 777);
  assert.deepEqual(migrated.ownedPacks, ['F1', 'F2', 'S1']);
});

test('旧activePack设置被移除且不会错误解锁旧鱼包', () => {
  const state = G.normalizeState({ settings: { ...G.defaultSettings, activePack: 'S2' } }, 1);
  assert.equal(Object.hasOwn(state.settings, 'activePack'), false);
  assert.deepEqual(state.ownedPacks, ['F1']);
  assert.equal(state.activeHabitat, 'freshwater');
});
