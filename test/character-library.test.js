'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { PNG } = require('pngjs');
const { CharacterLibrary, validatePackage } = require('../src/character-library');
const appRoot = path.resolve(__dirname, '..');
const template = require('../assets/pet/v1-runtime/action-manifest.json');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pond-characters-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, library: new CharacterLibrary({ root: path.join(root, 'library'), appRoot, bundledRoot: null }) };
}
function fixture(root, status = 'draft', id = 'test-only') {
  const dir = path.join(root, 'source-' + id); fs.mkdirSync(dir, { recursive: true });
  const meta = { format: 'screen-fishing-character', schemaVersion: 1, id, name: '仅供测试的原版副本', status, design: { character: '验证夹具', boat: '验证夹具', rod: '验证夹具' } };
  if (status === 'ready') {
    fs.cpSync(path.join(appRoot, 'assets/pet/v1-runtime/actions'), path.join(dir, 'actions'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'action-manifest.json'), JSON.stringify(template));
    const strip = PNG.sync.read(fs.readFileSync(path.join(dir, 'actions/idle.png'))), preview = new PNG({ width: 384, height: 416 });
    PNG.bitblt(strip, preview, 0, 0, 384, 416, 0, 0); fs.writeFileSync(path.join(dir, 'preview.png'), PNG.sync.write(preview));
    meta.preview = 'preview.png'; meta.actionManifest = 'action-manifest.json';
  }
  fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify(meta)); return dir;
}
test('character draft is listed but cannot replace the builtin or enter the game save', t => {
  const { root, library } = setup(t), dir = fixture(root);
  const sentinel = path.join(root, 'screen-fishing-save.json'); fs.writeFileSync(sentinel, '{"catches":23}');
  library.import(dir); assert.equal(library.snapshot().entries.length, 2);
  assert.throws(() => library.select('test-only'), /尚未完成/);
  assert.equal(library.snapshot().selectedId, 'classic'); assert.equal(fs.readFileSync(sentinel, 'utf8'), '{"catches":23}');
  assert.throws(() => library.import(dir), /已经存在/);
});
test('complete pack imports atomically, selects, survives restart and preserves gameplay timings', t => {
  const { root, library } = setup(t), dir = fixture(root, 'ready'); library.import(dir); library.select('test-only');
  const reloaded = new CharacterLibrary({ root: library.root, appRoot }); assert.equal(reloaded.selectedId, 'test-only');
  const base = { manifests: [{ id: 'pet', data: template }, { id: 'fish', data: {} }], diagnostics: { timings: { cast: 100 } } };
  const result = reloaded.assets(base); assert.match(result.manifests[0].basePath, /^file:/);
  assert.deepEqual(result.manifests[0].data.actions, template.actions); assert.equal(result.diagnostics, base.diagnostics); assert.equal(result.manifests[1], base.manifests[1]);
  reloaded.select('classic'); assert.equal(reloaded.assets(base), base);
});
test('draft upgrades to full pack with recoverable archive and no implicit activation', t => {
  const { root, library } = setup(t), dir = fixture(root); library.import(dir);
  fixture(root, 'ready'); library.import(dir); assert.equal(library.packs.get('test-only').metadata.status, 'ready');
  assert.equal(fs.readdirSync(path.join(library.root, '.archive')).length, 1); assert.equal(library.selectedId, 'classic');
});
test('changed animation timing and forged/corrupted image cannot pass import', t => {
  const { root, library } = setup(t), dir = fixture(root, 'ready');
  const data = structuredClone(template); data.actions.cast.frameDurationMs += 1; fs.writeFileSync(path.join(dir, 'action-manifest.json'), JSON.stringify(data));
  assert.throws(() => library.import(dir), /时序/);
  fs.writeFileSync(path.join(dir, 'action-manifest.json'), JSON.stringify(template));
  const file = path.join(dir, 'actions/cast.png'), bytes = fs.readFileSync(file); bytes[bytes.length - 20] ^= 1; fs.writeFileSync(file, bytes);
  assert.throws(() => library.import(dir), /PNG/); assert.equal(library.snapshot().entries.length, 1);
});
test('path escape, link directory, reserved ID and missing design are rejected', t => {
  const { root, library } = setup(t), dir = fixture(root), metaFile = path.join(dir, 'character.json'), meta = JSON.parse(fs.readFileSync(metaFile));
  fs.writeFileSync(metaFile, JSON.stringify({ ...meta, preview: '../outside.png' })); assert.throws(() => library.import(dir), /路径/);
  fs.writeFileSync(metaFile, JSON.stringify({ ...meta, id: 'classic' })); assert.throws(() => library.import(dir), /ID/);
  fs.writeFileSync(metaFile, JSON.stringify({ ...meta, design: {} })); assert.throws(() => library.import(dir), /三部分/);
  fs.writeFileSync(metaFile, JSON.stringify(meta)); const link = path.join(root, 'link'); fs.symlinkSync(dir, link, 'junction'); assert.throws(() => library.import(link), /链接/);
});
test('missing active pack and malformed selection safely fall back without overwriting evidence', t => {
  const { library } = setup(t), file = path.join(library.root, 'selection.json');
  fs.writeFileSync(file, JSON.stringify({ selectedId: 'missing' })); library.reload(); assert.equal(library.selectedId, 'classic'); assert.match(library.notice, /不可用/);
  fs.writeFileSync(file, '{bad'); library.reload(); assert.equal(library.selectedId, 'classic'); assert.equal(fs.readFileSync(file, 'utf8'), '{bad');
});
test('import copies allowlisted files only and busy import never partially registers', t => {
  const { root, library } = setup(t), dir = fixture(root); fs.writeFileSync(path.join(dir, 'run.js'), 'throw Error("never copy or execute")');
  const lock = path.join(library.root, '.import.lock'); fs.writeFileSync(lock, 'busy'); assert.throws(() => library.import(dir), /其他角色/); fs.unlinkSync(lock);
  library.import(dir); assert.deepEqual(fs.readdirSync(path.join(library.root, 'test-only')), ['character.json']);
});
test('draft upgrade rejects a redirected archive and preserves the existing draft', t => {
  const { root, library } = setup(t), dir = fixture(root); library.import(dir); fixture(root, 'ready');
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  fs.symlinkSync(outside, path.join(library.root, '.archive'), 'junction');
  assert.throws(() => library.import(dir), /归档/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(library.root, 'test-only/character.json'))).status, 'draft');
  assert.deepEqual(fs.readdirSync(outside), ['keep.txt']);
});
