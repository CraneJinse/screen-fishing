'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const approvedHashes = require('./fixtures/approved-art-hashes.json');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const root = path.join(__dirname, '..');
const fishRoot = path.join(root, 'assets', 'fish');
const manifest = JSON.parse(fs.readFileSync(path.join(fishRoot, 'variants', 'manifest.json'), 'utf8'));

test('1.3 fish variant manifest covers all 152 species', () => {
  assert.equal(manifest.entries.length, 152);
  assert.deepEqual([...new Set(manifest.entries.map((entry) => entry.fishId))].length, 152);
  assert.deepEqual(manifest.variants, ['normal', 'alternate', 'golden', 'iridescent']);
});

test('1.3 fish variant assets keep the contracted canvas sizes', () => {
  const sample = manifest.entries[0];
  const read = (rel) => PNG.sync.read(fs.readFileSync(path.join(fishRoot, 'variants', sample.pack.toLowerCase(), rel)));
  assert.deepEqual([read(sample.variants.normal.icon).width, read(sample.variants.normal.icon).height], [64, 64]);
  assert.deepEqual([read(sample.variants.normal.airborneStrip).width, read(sample.variants.normal.airborneStrip).height], [256, 64]);
  assert.deepEqual([read(sample.variants.iridescent.baseAirborneStrip).width, read(sample.variants.iridescent.baseAirborneStrip).height], [256, 64]);
});

test('pearl base and mask stay byte-identical to the four approved V2.2 masters', () => {
  for (const fishId of ['1', '2', '18', '26']) {
    for (const layer of ['base', 'mask']) {
      const approved = path.join(fishRoot, 'variant-prototype', 'v2', `fish-${fishId}-iridescent-${layer}.png`);
      const generated = path.join(fishRoot, 'variants', 'f1', 'iridescent', `${fishId}-${layer}.png`);
      assert.equal(hash(generated), approvedHashes[`${fishId}-${layer}`], `fish-${fishId} ${layer} drifted from approved V2.2`);
    }
  }
});

test('all ten approved option B detail samples match production exactly', () => {
  for (const fishId of ['1', '2', '18', '26', '50', '52', '53', '60', '102', '104']) {
    const entry = manifest.entries.find((item) => item.fishId === `fish-${fishId}`);
    const production = path.join(fishRoot, 'variants', entry.pack.toLowerCase(), entry.variants.iridescent.detailOverlay);
    const approved = path.join(root, 'artwork', 'iridescent-detail-ab-v1', 'details', `${fishId}-option-b.png`);
    assert.equal(hash(production), approvedHashes[`${fishId}-details`], `fish-${fishId} production details drifted from option B`);
  }
});

test('catalog presentation preserves long-fish aspect ratio by uniform inner scaling', () => {
  assert.equal(manifest.catalogPresentation.preserveAspectRatio, true);
  assert.equal(manifest.catalogPresentation.frameSizeUnchanged, true);
  for (const fishId of ['fish-50', 'fish-52', 'fish-97', 'fish-107']) {
    const entry = manifest.entries.find((item) => item.fishId === fishId);
    assert.ok(entry.presentation.catalogScale < 1, `${fishId} should use compact catalog art`);
  }
});

// Historical art-generation byte-stability is tested in the authoring workspace; production assets are checked above.
