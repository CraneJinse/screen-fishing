const test = require('node:test');
const assert = require('node:assert/strict');
const AssetRuntime = require('../src/asset-runtime');
const Game = require('../src/game-state-runtime');

test('主体清单要求22动作、152帧和落船第2帧唯一结算事件', () => {
  const actions = {};
  for (const [id, frameCount] of Object.entries(AssetRuntime.ACTION_FRAME_COUNTS)) {
    actions[id] = { file: `actions/${id}.png`, frameCount, frameWidth: 384, frameHeight: 416, frameDurationMs: 120, loop: false, frames: Array.from({ length: frameCount }, () => ({ fishAnchor: null, events: [] })) };
  }
  actions.catch_land.frames[1].events = ['catch_committed', 'result_card_show'];
  const result = AssetRuntime.validateActionManifest({ schemaVersion: '1.0.0', canvas: { width: 192, height: 208 }, actions });
  assert.equal(result.valid, true);
  assert.equal(Object.values(AssetRuntime.ACTION_FRAME_COUNTS).reduce((sum, count) => sum + count, 0), 152);
  const timings = AssetRuntime.actionTimings({ actions });
  assert.equal(timings.catch_land.totalMs, 720);
  assert.equal(timings.catch_land.frameStartMs[1], 120);
});

test('鱼动作元数据必须是4帧并映射10帧飞行序列', () => {
  const motion = { fishId: 'fish-1', frameCount: 4, frameWidth: 64, frameHeight: 64, flightPoseSequence: [0,1,2,3,2,1,0,1,2,0], frames: Array.from({ length: 4 }, () => ({ hookAnchor: { x: 30, y: 20 }, visualCenter: { x: 32, y: 32 }, safeBounds: { x: 2, y: 8, width: 60, height: 48 } })) };
  assert.equal(AssetRuntime.validateMotion(motion, 'fish-1').valid, true);
  motion.flightPoseSequence[4] = 8;
  assert.equal(AssetRuntime.validateMotion(motion, 'fish-1').valid, false);
});

test('鱼清单保留152数据槽并安全忽略未知ID与危险路径', () => {
  const result = AssetRuntime.validateFishManifest({ entries: [{ fishId: 'fish-1', icon: 'f1/icons/01.png' }, { fishId: 'fish-x', icon: '../bad.png' }] }, null, Game.FISH);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].fishId, 'fish-1');
  assert.equal(result.coverage.total, 152);
});

test('正式鱼类总清单缺少任一静态图、空中帧或动作配置时不得通过发布门禁', () => {
  const result = AssetRuntime.validateFishManifest(
    { entries: [{ fishId: 'fish-1', icon: 'f1/icons/01.png' }] },
    null,
    Game.FISH,
    { requireComplete: true }
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('fish-entry-coverage:1/152'));
  assert.ok(result.errors.includes('fish-airborne-coverage:0/152'));
  assert.ok(result.errors.includes('fish-motion-coverage:0/152'));
});

test('当前发布资源与UI图标通过尺寸校验', () => {
  const path = require('node:path');
  const snapshot = AssetRuntime.buildAssetSnapshot(path.join(__dirname, '..'), Game.FISH);
  const f1 = snapshot.diagnostics.fish.find((item) => item.id === 'fish');
  assert.equal(f1.coverage.entries, 152);
  assert.equal(f1.coverage.icons, 152);
  assert.equal(f1.errors.length, 0);
  const ui = snapshot.diagnostics.ui.find((item) => item.id === 'ui');
  const achievements = snapshot.diagnostics.ui.find((item) => item.id === 'achievements');
  assert.equal(ui.valid, true);
  assert.equal(ui.count, 19);
  assert.equal(achievements.valid, true);
  assert.equal(achievements.count, 71);
});

test('当前正式鱼类总清单达到152种完整运行时覆盖', () => {
  const path = require('node:path');
  const snapshot = AssetRuntime.buildAssetSnapshot(path.join(__dirname, '..'), Game.FISH);
  const fish = snapshot.diagnostics.fish.find((item) => item.id === 'fish');
  assert.equal(fish.valid, true);
  assert.deepEqual(fish.coverage, { entries: 152, icons: 152, airborne: 152, motions: 152, total: 152 });
  assert.equal(snapshot.diagnostics.fallbacks.includes('fish-runtime-fallback'), false);
});

test('1.3 异色清单达到152种与608个形态的完整运行时覆盖', () => {
  const path = require('node:path');
  const snapshot = AssetRuntime.buildAssetSnapshot(path.join(__dirname, '..'), Game.FISH);
  assert.equal(snapshot.diagnostics.variants.valid, true);
  assert.deepEqual(snapshot.diagnostics.variants.coverage, { entries: 152, variants: 608, total: 152 });
  assert.equal(snapshot.diagnostics.fallbacks.includes('fish-variants-fallback'), false);
  const bundle = snapshot.manifests.find((entry) => entry.id === 'fish-variants');
  const first = bundle.data.entries.find((entry) => entry.fishId === 'fish-1');
  assert.equal(first.variants.alternate.icon, 'f1/icons/1-alternate.png');
  assert.equal(first.variants.iridescent.baseAirborneStrip, 'f1/iridescent/1-base-airborne.png');
});

test('异色清单拒绝目录穿越路径', () => {
  const entry = {
    fishId: 'fish-1', pack: 'F1', variants: {
      normal: { icon: '../normal.png', airborneStrip: 'normal-strip.png' },
      alternate: { icon: 'alternate.png', airborneStrip: 'alternate-strip.png' },
      golden: { icon: 'golden.png', airborneStrip: 'golden-strip.png' },
      iridescent: {
        baseIcon: 'base.png', bodyMask: 'mask.png', detailOverlay: 'details.png',
        baseAirborneStrip: 'base-strip.png', airborneMask: 'mask-strip.png', detailOverlayStrip: 'details-strip.png'
      }
    }
  };
  const result = AssetRuntime.validateVariantManifest({ variantCount: 4, speciesCount: 152, entries: [entry] }, null, Game.FISH);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('unsafe-variant-path:fish-1:normal:icon'));
});
