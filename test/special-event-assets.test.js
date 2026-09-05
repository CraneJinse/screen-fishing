'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PNG } = require('pngjs');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/events/event-manifest.json'), 'utf8'));
const info = (relative) => PNG.sync.read(fs.readFileSync(path.join(root, 'assets/events', relative)));
const frameHashes = (png) => Array.from({ length: 6 }, (_, frame) => { const bytes = Buffer.alloc(256 * 256 * 4); for (let y = 0; y < 256; y++) { const start = (y * png.width + frame * 256) * 4; png.data.copy(bytes, y * 256 * 4, start, start + 256 * 4); } return crypto.createHash('sha256').update(bytes).digest('hex'); });

test('特殊事件高清资产覆盖60项，漂流瓶依四类内容共享瓶型徽记', () => {
  assert.equal(manifest.eventVersion, 3);
  assert.equal(manifest.probabilityVersion, 3);
  assert.equal(manifest.enabled, true);
  assert.equal(manifest.specialEventsEnabled, true);
  assert.equal(manifest.series.length, 3);
  assert.equal(manifest.entries.length, 60);
  assert.equal(new Set(manifest.entries.map((entry) => entry.id)).size, 60);
  const bottles = manifest.entries.filter((entry) => entry.seriesId === 'drift_bottle');
  assert.equal(bottles.length, 30);
  assert.equal(new Set(bottles.map((entry) => entry.icon)).size, 4);
  assert.equal(new Set(bottles.map((entry) => entry.catchAnimation)).size, 4);
  for (const item of bottles) {
    const theme = item.order <= 9 ? 'work' : item.order <= 15 ? 'waterside' : item.order <= 23 ? 'warmth' : 'vibe';
    assert.equal(item.bottleTheme, theme);
    assert.equal(item.icon, `drift-bottle/bottle-${theme}.png`);
  }
  const independent = manifest.entries.filter((entry) => !entry.id.startsWith('DB-'));
  assert.equal(new Set(independent.map((entry) => entry.icon)).size, 30);
  assert.equal(new Set(independent.map((entry) => entry.catchAnimation)).size, 30);
});

test('特殊事件图标与上钩动作条符合透明像素合同', () => {
  for (const series of manifest.series) assert.deepEqual([info(series.coverIcon).width, info(series.coverIcon).height], [64, 64]);
  for (const entry of manifest.entries) {
    const icon = info(entry.icon); const strip = info(entry.catchAnimation);
    assert.deepEqual([icon.width, icon.height], [256, 256]);
    assert.deepEqual([strip.width, strip.height], [1536, 256]);
    assert.equal(entry.frameCount, 6);
    assert.equal(entry.displaySize, 64, 'high source resolution must not enlarge the pet overlay');
    assert.equal(new Set(frameHashes(strip)).size, 6, `${entry.id} must contain visible frame-to-frame motion`);
    assert.ok(entry.description && !entry.description.includes('沿着共同的收杆轨迹'));
  }
});
