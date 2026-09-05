'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Events = require('../src/special-events');

test('special item flight progresses from water to air to a settled pose across state boundaries', () => {
  const sequence = [Events.animationPose('reel_pull', 0), Events.animationPose('reel_pull', 0.99),
    Events.animationPose('catch_flight', 0), Events.animationPose('catch_flight', 0.5),
    Events.animationPose('catch_flight', 0.99), Events.animationPose('catch_land', 0.8),
    Events.animationPose('celebrating', 0), Events.animationPose('celebrating', 0.99)];
  assert.deepEqual(sequence, [0, 1, 2, 3, 4, 5, 5, 5]);
});

test('runtime catalogue resolves 256 px art with 64 px display and preserves all 60 event identities', () => {
  const runtime = Events.runtimeRegistry();
  assert.equal(runtime.length, 60);
  for (const entry of runtime) {
    assert.equal(entry.frameWidth, 256);
    assert.equal(entry.frameHeight, 256);
    assert.equal(entry.displaySize, 64);
    assert.equal(entry.hookAnchor.x * entry.displaySize / entry.frameWidth, 32);
    assert.equal(entry.title, Events.byId(entry.id).title);
  }
  assert.equal(new Set(runtime.map((entry) => entry.iconPath)).size, 34);
});
