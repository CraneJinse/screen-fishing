'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const executableArgument = process.argv.indexOf('--executable');
const packagedExecutable = executableArgument >= 0 ? path.resolve(process.argv[executableArgument + 1] || '') : null;
const runner = packagedExecutable || require('electron');
const runnerArguments = packagedExecutable ? [] : ['.'];
if (packagedExecutable) assert.ok(fs.existsSync(packagedExecutable), `Packaged executable not found: ${packagedExecutable}`);

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fixture() {
  const now = Date.now();
  return {
    version: 8,
    saveSchemaVersion: 8,
    castCount: 3,
    catches: 3,
    collection: {
      'fish-1': { count: 3, firstAt: now - 2000, lastAt: now, maxLengthCm: 12.3, maxWeightKg: .12 }
    },
    history: [],
    inventory: [],
    settings: { petScale: 1 },
    ownedPacks: ['F1']
  };
}

function runScenario(directory) {
  const result = spawnSync(runner, runnerArguments, {
    cwd: packagedExecutable ? path.dirname(packagedExecutable) : root,
    env: {
      ...process.env,
      POND_SAVE_STARTUP_VERIFY: '1',
      POND_SAVE_STARTUP_VERIFY_DIR: directory
    },
    encoding: 'utf8',
    timeout: 15000
  });
  const match = result.stdout?.match(/POND_SAVE_STARTUP_VERIFY:(\{.*\})/);
  assert.ok(match, `Missing startup report. status=${result.status}; stderr=${result.stderr}`);
  return { status: result.status, report: JSON.parse(match[1]), stderr: result.stderr };
}

function captureProcess(child) {
  let stdout = '';
  let stderr = '';
  const waiters = [];
  function flush() {
    for (const waiter of [...waiters]) {
      if (!stdout.includes(waiter.token)) continue;
      clearTimeout(waiter.timer);
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve({ stdout, stderr });
    }
  }
  child.stdout.on('data', (chunk) => { stdout += chunk; flush(); });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return {
    waitFor(token, timeout = 15000) {
      if (stdout.includes(token)) return Promise.resolve({ stdout, stderr });
      return new Promise((resolve, reject) => {
        const waiter = { token, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for ${token}. stdout=${stdout}; stderr=${stderr}`));
        }, timeout);
        waiters.push(waiter);
      });
    }
  };
}

async function runStaleInstanceScenario(directory) {
  const options = {
    cwd: packagedExecutable ? path.dirname(packagedExecutable) : root,
    env: {
      ...process.env,
      POND_STALE_INSTANCE_VERIFY: '1',
      POND_STALE_INSTANCE_VERIFY_DIR: directory
    },
    stdio: ['ignore', 'pipe', 'pipe']
  };
  const first = spawn(runner, runnerArguments, options);
  const captured = captureProcess(first);
  try {
    await captured.waitFor('POND_STALE_INSTANCE_READY');
    fs.writeFileSync(path.join(directory, 'screen-fishing-save.json'), JSON.stringify(fixture()), 'utf8');
    const second = spawn(runner, runnerArguments, options);
    const reportOutput = await captured.waitFor('POND_STALE_INSTANCE_VERIFY:');
    await new Promise((resolve) => first.once('close', resolve));
    if (!second.killed) second.kill();
    const match = reportOutput.stdout.match(/POND_STALE_INSTANCE_VERIFY:(\{.*\})/);
    assert.ok(match, `Missing stale-instance report. stderr=${reportOutput.stderr}`);
    return JSON.parse(match[1]);
  } finally {
    if (!first.killed) first.kill();
  }
}

const suite = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-fishing-startup-suite-'));
(async () => {
try {
  const missingDir = path.join(suite, 'missing');
  fs.mkdirSync(missingDir);
  const missing = runScenario(missingDir);
  assert.equal(missing.status, 0);
  assert.equal(missing.report.source, 'missing');
  assert.deepEqual(missing.report.progress, { totalCatchCount: 0, discovered: 0, historyCount: 0 });

  const backupDir = path.join(suite, 'backup');
  fs.mkdirSync(backupDir);
  const backupFile = path.join(backupDir, 'screen-fishing-save.json.bak');
  fs.writeFileSync(path.join(backupDir, 'screen-fishing-save.json'), '{broken', 'utf8');
  fs.writeFileSync(backupFile, JSON.stringify(fixture()), 'utf8');
  const backupHash = digest(backupFile);
  const recovered = runScenario(backupDir);
  assert.equal(recovered.status, 0);
  assert.equal(recovered.report.source, 'backup');
  assert.equal(recovered.report.progress.totalCatchCount, 3);
  assert.equal(recovered.report.progress.discovered, 1);
  assert.equal(digest(backupFile), backupHash);
  assert.equal(JSON.parse(fs.readFileSync(path.join(backupDir, 'screen-fishing-save.json'), 'utf8')).catches, 3);
  assert.equal(fs.readdirSync(backupDir).filter((name) => name.includes('.unreadable-')).length, 1);

  const blockedDir = path.join(suite, 'blocked');
  fs.mkdirSync(blockedDir);
  const blockedPrimary = path.join(blockedDir, 'screen-fishing-save.json');
  const blockedBackup = `${blockedPrimary}.bak`;
  fs.writeFileSync(blockedPrimary, '{broken-primary', 'utf8');
  fs.writeFileSync(blockedBackup, '{broken-backup', 'utf8');
  const blockedHashes = [digest(blockedPrimary), digest(blockedBackup)];
  const blocked = runScenario(blockedDir);
  assert.equal(blocked.status, 2);
  assert.equal(blocked.report.source, 'error');
  assert.equal(blocked.report.writeAllowed, false);
  assert.deepEqual([digest(blockedPrimary), digest(blockedBackup)], blockedHashes);

  const staleDir = path.join(suite, 'stale-instance');
  fs.mkdirSync(staleDir);
  const refreshed = await runStaleInstanceScenario(staleDir);
  assert.ok(['second-instance', 'launch-signal'].includes(refreshed.trigger));
  assert.equal(refreshed.progress.totalCatchCount, 3);
  assert.equal(refreshed.progress.discovered, 1);

  process.stdout.write(`SAVE_STARTUP_VERIFY:${JSON.stringify({ ok: true, scenarios: ['missing', 'backup-recovery', 'blocked-no-overwrite', 'stale-instance-refresh'] })}\n`);
} finally {
  assert.equal(path.dirname(path.resolve(suite)), path.resolve(os.tmpdir()));
  assert(path.basename(suite).startsWith('screen-fishing-startup-suite-'));
  // Chromium may release its cache handles shortly after the main process exits.
  fs.rmSync(suite, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
