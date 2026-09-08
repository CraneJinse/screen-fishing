'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const G = require('../src/game-state-runtime');
const PetLayout = require('../src/pet-layout');
const root = path.resolve(__dirname, '..');

function browserRuntime(htmlName) {
  const html = fs.readFileSync(path.join(root, 'src', htmlName), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  const context = vm.createContext({ window: {} });
  const runtimeIndex = scripts.indexOf('game-state-runtime.js');
  assert.ok(runtimeIndex > 0);
  for (const script of scripts.slice(0, runtimeIndex + 1)) vm.runInContext(fs.readFileSync(path.join(root, 'src', script), 'utf8'), context, { filename: script });
  return { context, scripts, game: context.window.PondGame };
}

for (const htmlName of ['index.html', 'panel.html']) test(`${htmlName} actual browser script order yields 71 working rules without CommonJS`, () => {
  const { game, scripts, context } = browserRuntime(htmlName);
  assert.equal(game.ACHIEVEMENTS.length, 71);
  assert.equal(game.achievementSummary(game.createInitialState()).totalPoints, 1255);
  assert.ok(scripts.indexOf('achievement-system.js') < scripts.indexOf('game-state-runtime.js'));
  if (htmlName === 'panel.html') assert.ok(scripts.indexOf('achievement-panel.js') < scripts.indexOf('panel.js'));
  const fish = G.FISH[0].id;
  const raw = { measurementVersion: 5, castCount: 1, collection: { [fish]: { count: 10 } }, specialEventCollection: { entries: { 'DB-001': { count: 1 } } } };
  const actual = game.normalizeState(raw, 100), expected = G.normalizeState(raw, 100);
  assert.deepEqual(Array.from(actual.achievements), expected.achievements);
  assert.equal(actual.achievementMetadata['bottles-1'].source, 'retroactive');
  assert.equal(typeof context.window.PondAchievements.applyAchievementAction, 'function');
});

function mainDispatch() {
  const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const dispatch = source.slice(source.indexOf('function dispatch('), source.indexOf('function economyAction('));
  let saves = 0, broadcasts = 0, lookups = 0, achievementQueues = 0;
  const context = vm.createContext({
    Game: G, gameState: G.createInitialState(), assets: {}, resultCardOverride: null,
    bounds: { x: -1900, y: 120, width: 192, height: 208 },
    area: { x: -1920, y: 40, width: 1920, height: 1000 },
    saveGame() { saves++; return true; }, broadcastAll() { broadcasts++; }, updateTrayMenu() {}, showResult() {},
    queueAchievementUnlocks() { achievementQueues++; }, showNextAchievementPopup() {},
    petBodyBounds() { lookups++; return context.bounds; },
    cornerIdForBounds(bounds) { return PetLayout.cornerIdForBounds(bounds, context.area); },
    publicSnapshot() { return { state: context.gameState }; }
  });
  vm.runInContext(dispatch, context);
  return { context, counts: () => ({ saves, broadcasts, lookups, achievementQueues }) };
}

test('real main dispatch overwrites stale renderer corner using current negative-monitor bounds', () => {
  const { context, counts } = mainDispatch();
  const result = context.dispatch('cast', { corner: 'bottom-right' });
  assert.equal(result.ok, true);
  assert.equal(G.achievementProgress(context.gameState, 'corners'), 1);
  assert.ok(Object.hasOwn(context.gameState.cornerCasts, 'top-left'));
  assert.ok(!Object.hasOwn(context.gameState.cornerCasts, 'bottom-right'));
  assert.equal(counts().lookups, 1);
  assert.equal(counts().saves, 1);
  assert.equal(counts().achievementQueues, 1);
});

test('real main achievement actions save once, reject fourth track without write, and acknowledge once', () => {
  const { context, counts } = mainDispatch();
  for (const a of G.ACHIEVEMENTS.slice(0,3)) assert.equal(context.dispatch('achievement-track', { id: a.id }).ok, true);
  assert.equal(context.dispatch('achievement-track', { id: G.ACHIEVEMENTS[3].id }).reason, 'tracking-limit');
  assert.equal(counts().saves, 3);
  context.gameState.achievementNotice = { ids: ['first-cast'], source: 'retroactive', at: 10 };
  const result = context.dispatch('achievement-acknowledge');
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.state.achievementNotice, null);
  assert.equal(counts().saves, 4);
  assert.equal(counts().broadcasts, 4);
  assert.equal(counts().lookups, 0);
});

test('four broad edge casts resolve unique quadrants for common and negative display origins', () => {
  for (const area of [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: -1920, y: 40, width: 1920, height: 1000 }, { x: 0, y: -1440, width: 2560, height: 1440 }]) {
    const actual = [];
    for (const [left, top] of [[true,true], [false,true], [true,false], [false,false]]) {
      const bounds = { width: 192, height: 208, x: left ? area.x + 85 : area.x + area.width - 192 - 85, y: top ? area.y + 70 : area.y + area.height - 208 - 70 };
      actual.push(PetLayout.cornerIdForBounds(bounds, area));
    }
    assert.deepEqual(actual, ['top-left','top-right','bottom-left','bottom-right']);
  }
});

test('achievement preferences roll back and report failure when persistence rejects the write', () => {
  const { context } = mainDispatch();
  context.gameState.achievementNotice = { ids: ['first-cast'], source: 'retroactive', at: 10 };
  const before = context.gameState;
  context.saveGame = () => false;
  for (const [action,payload] of [
    ['achievement-track',{id:'first-cast'}],
    ['achievement-acknowledge',{}],
    ['achievement-title',{id:''}]
  ]) {
    const result = context.dispatch(action,payload);
    assert.equal(result.ok,false);
    assert.equal(result.reason,'persistence-failed');
    assert.equal(context.gameState,before);
    assert.equal(result.snapshot.state.achievementNotice,before.achievementNotice);
    assert.deepEqual(context.gameState.achievementTracking,[]);
  }
});
