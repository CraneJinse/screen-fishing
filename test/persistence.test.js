const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Persistence = require('../src/persistence');

test('可恢复写入保留上一版备份并写入完整新文件', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-fishing-save-test-'));
  const file = path.join(directory, 'save.json');
  try {
    Persistence.writeJsonRecoverable(file, { version: 1, value: 'old' });
    Persistence.writeJsonRecoverable(file, { version: 2, value: 'new' });
    assert.deepEqual(Persistence.readJson(file), { version: 2, value: 'new' });
    assert.deepEqual(Persistence.readJson(`${file}.bak`), { version: 1, value: 'old' });
    assert.equal(fs.existsSync(`${file}.tmp`), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('主存档损坏时从备份回退', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-fishing-recover-test-'));
  const file = path.join(directory, 'save.json');
  try {
    fs.writeFileSync(file, '{broken', 'utf8');
    fs.writeFileSync(`${file}.bak`, JSON.stringify({ version: 4, catches: 8 }), 'utf8');
    const loaded = Persistence.readJsonRecoverable(file, {});
    assert.equal(loaded.source, 'backup');
    assert.equal(loaded.value.catches, 8);
    assert.equal(loaded.errors.primary.code, 'INVALID_JSON');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('不存在的存档与已有但不可读的存档严格区分', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-fishing-read-state-test-'));
  const file = path.join(directory, 'save.json');
  try {
    assert.equal(Persistence.readJsonRecoverable(file, {}).source, 'missing');
    fs.writeFileSync(file, '{broken', 'utf8');
    const loaded = Persistence.readJsonRecoverable(file, {});
    assert.equal(loaded.source, 'error');
    assert.equal(loaded.errors.primary.code, 'INVALID_JSON');
    assert.equal(loaded.errors.backup.code, 'ENOENT');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('启动读取会重试瞬时错误但不会把最终错误伪装成新存档', async () => {
  let reads = 0;
  const expected = { version: 8, catches: 42 };
  const loaded = await Persistence.readJsonRecoverableWithRetry('save.json', null, {
    attempts: 4,
    delays: [1, 1, 1],
    sleep: async () => {},
    read: () => {
      reads += 1;
      if (reads < 3) return { value: null, source: 'error', errors: { primary: { code: 'EBUSY' } } };
      return { value: expected, source: 'primary', errors: {} };
    }
  });
  assert.equal(loaded.source, 'primary');
  assert.equal(loaded.attempts, 3);
  assert.deepEqual(loaded.value, expected);
});

test('主档瞬时占用时先重试而不是立刻降级到可能较旧的备份', async () => {
  let reads = 0;
  const loaded = await Persistence.readJsonRecoverableWithRetry('save.json', null, {
    attempts: 3,
    delays: [1, 1],
    sleep: async () => {},
    read: () => {
      reads += 1;
      if (reads === 1) return { value: { catches: 40 }, source: 'backup', errors: { primary: { code: 'EBUSY' } } };
      return { value: { catches: 41 }, source: 'primary', errors: {} };
    }
  });
  assert.equal(loaded.source, 'primary');
  assert.equal(loaded.attempts, 2);
  assert.equal(loaded.value.catches, 41);
});

test('从备份恢复时保留好备份并隔离损坏主文件', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-fishing-restore-test-'));
  const file = path.join(directory, 'save.json');
  const backup = `${file}.bak`;
  try {
    fs.writeFileSync(file, '{broken', 'utf8');
    fs.writeFileSync(backup, JSON.stringify({ version: 8, catches: 41 }), 'utf8');
    const restored = Persistence.restoreJsonFromBackup(file, { version: 8, catches: 41 });
    assert.deepEqual(Persistence.readJson(file), { version: 8, catches: 41 });
    assert.deepEqual(Persistence.readJson(backup), { version: 8, catches: 41 });
    assert.ok(restored.quarantine && fs.existsSync(restored.quarantine));
    assert.equal(fs.readFileSync(restored.quarantine, 'utf8'), '{broken');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('进度下限阻止空白内存覆盖丰富存档但允许库存出售', () => {
  const baselineState = {
    catches: 12,
    history: Array.from({ length: 12 }, (_, index) => ({ catchId: String(index) })),
    inventory: Array.from({ length: 8 }, (_, index) => ({ inventoryId: String(index) })),
    collection: { 'fish-1': { count: 5 }, 'fish-2': { count: 7 } }
  };
  const floor = Persistence.progressSummary(baselineState);
  assert.equal(Persistence.progressRegressed({ catches: 0, history: [], collection: {} }, floor), true);
  assert.equal(Persistence.progressRegressed({ ...baselineState, inventory: [] }, floor), false);
});

test('重复启动只采用不倒退且不旧于当前内存的磁盘状态', () => {
  const current = {
    catches: 12,
    history: Array.from({ length: 12 }, (_, index) => ({ catchId: String(index) })),
    collection: { 'fish-1': { count: 12 } },
    lastUpdated: 200
  };
  assert.equal(Persistence.shouldAdoptCandidate(current, {
    catches: 0, history: [], collection: {}, lastUpdated: 300
  }), false);
  assert.equal(Persistence.shouldAdoptCandidate(current, {
    ...current, lastUpdated: 199
  }), false);
  assert.equal(Persistence.shouldAdoptCandidate(current, {
    ...current, lastUpdated: 201
  }), true);
  assert.equal(Persistence.shouldAdoptCandidate({
    catches: 0, history: [], collection: {}, lastUpdated: 300
  }, current), true);
});
