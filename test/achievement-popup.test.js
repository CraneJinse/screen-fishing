'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Game = require('../src/game-state-runtime');
const Popup = require('../src/achievement-popup');

const root = path.resolve(__dirname, '..');

test('newly unlocked achievements become complete popup models in catalog order', () => {
  const selected = [Game.ACHIEVEMENTS[4], Game.ACHIEVEMENTS[1], Game.ACHIEVEMENTS[0]];
  const previous = { achievements: [selected[1].id] };
  const next = { achievements: selected.map((item) => item.id) };
  const popups = Popup.newlyUnlocked(previous, next, Game.ACHIEVEMENTS);
  assert.deepEqual(popups.map((item) => item.achievementId), [selected[2].id, selected[0].id]);
  for (const popup of popups) {
    const definition = Game.ACHIEVEMENTS.find((item) => item.id === popup.achievementId);
    assert.deepEqual(popup, {
      type: 'achievement', achievementId: definition.id, title: definition.name,
      description: definition.description, seriesName: definition.seriesName,
      iconPath: definition.iconPath, points: definition.points
    });
  }
});

test('existing, repeated and malformed achievement data never creates a popup', () => {
  const id = Game.ACHIEVEMENTS[0].id;
  assert.deepEqual(Popup.newlyUnlocked({ achievements: [id] }, { achievements: [id, id] }, Game.ACHIEVEMENTS), []);
  assert.deepEqual(Popup.newlyUnlocked(null, null, Game.ACHIEVEMENTS), []);
  assert.equal(Popup.createPopup({ id: 'broken', name: '缺图' }), null);
});

test('result renderer and main process expose the achievement popup contract', () => {
  const renderer = fs.readFileSync(path.join(root, 'src', 'result.js'), 'utf8');
  const runtimeCss = fs.readFileSync(path.join(root, 'src', 'result-runtime.css'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(renderer, /achievement \? '解锁新成就！'/);
  assert.match(renderer, /type === 'achievement'/);
  assert.match(runtimeCss, /data-result-type='achievement'/);
  assert.match(main, /setImmediate\(showNextAchievementPopup\)/);
  assert.match(main, /scheduleResultHide\(RESULT_AUTO_HIDE_MS\)/);
  assert.match(main, /const RESULT_AUTO_HIDE_MS = 10000/);
});
