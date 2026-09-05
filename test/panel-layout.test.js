'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { restoredBounds } = require('../src/panel-layout');

test('panel restores independently resized width and height on a negative-coordinate monitor', () => {
  const saved = { x: -1800, y: -200, width: 1100, height: 460 };
  assert.deepEqual(restoredBounds(saved, { x: -1920, y: -300, width: 1920, height: 1080 }), saved);
});
test('panel moves fully into the remaining monitor and clamps oversized saved dimensions', () => {
  assert.deepEqual(restoredBounds({ x: -1800, y: -200, width: 2000, height: 1400 },
    { x: 0, y: 0, width: 1280, height: 720 }), { x: 0, y: 0, width: 1280, height: 720 });
});
test('panel handles old bounds and a work area smaller than its normal minimum', () => {
  assert.deepEqual(restoredBounds({ x: 2000, y: 1000, width: 800 },
    { x: 0, y: 0, width: 1280, height: 720 }), { x: 480, y: 160, width: 800, height: 560 });
  assert.deepEqual(restoredBounds({}, { x: -400, y: 10, width: 400, height: 300 }),
    { x: -400, y: 10, width: 400, height: 300 });
});
