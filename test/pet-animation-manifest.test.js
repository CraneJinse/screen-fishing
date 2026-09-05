const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../assets/pet/v1-runtime/action-manifest.json');
const fs = require('node:fs');
const path = require('node:path');

for (const actionId of ['idle', 'waiting']) {
  test(`${actionId} 使用低频随机眨眼且基础循环不含闭眼帧`, () => {
    const action = manifest.actions[actionId];
    const meta = action.animationMeta;
    assert.equal(meta.type, 'idle_blink');
    assert.deepEqual(meta.blinkIntervalMs, { min: 8000, max: 15000 });
    assert.ok(meta.doubleBlinkChance > 0 && meta.doubleBlinkChance < 0.2);
    const blinkOnlyFrames = new Set(meta.blinkFrameSequences.flat().filter((frame) => !meta.baseFrameSequence.includes(frame)));
    assert.ok(blinkOnlyFrames.size > 0);
  });
}

test('拖动不再切换独立动作', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  assert.doesNotMatch(renderer, /dragActionForFishingState|setVisualOverride\(['"]drag_/);
});
