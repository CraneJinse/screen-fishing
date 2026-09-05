'use strict';
const fs = require('node:fs');
const path = require('node:path');

function errorDetails(error) {
  return {
    code: error?.code || (error instanceof SyntaxError ? 'INVALID_JSON' : 'READ_ERROR'),
    message: String(error?.message || error || 'Unknown persistence error')
  };
}

function readJsonResult(file) {
  try {
    return { ok: true, exists: true, value: JSON.parse(fs.readFileSync(file, 'utf8')), error: null };
  } catch (error) {
    return { ok: false, exists: error?.code !== 'ENOENT', value: null, error: errorDetails(error) };
  }
}

function readJson(file) {
  const result = readJsonResult(file);
  return result.ok ? result.value : null;
}

function validatedRead(file, validate) {
  const result = readJsonResult(file);
  if (!result.ok || typeof validate !== 'function' || validate(result.value)) return result;
  return { ok: false, exists: true, value: null, error: { code: 'VALIDATION_FAILED', message: `JSON content failed validation: ${file}` } };
}

function readJsonRecoverable(file, fallback = null, options = {}) {
  const validate = options?.validate;
  const primary = validatedRead(file, validate);
  if (primary.ok) return { value: primary.value, source: 'primary', errors: {} };
  const backup = validatedRead(`${file}.bak`, validate);
  if (backup.ok) return { value: backup.value, source: 'backup', errors: { primary: primary.error } };
  const source = primary.exists || backup.exists ? 'error' : 'missing';
  return { value: fallback, source, errors: { primary: primary.error, backup: backup.error } };
}

async function readJsonRecoverableWithRetry(file, fallback = null, options = {}) {
  const attempts = Math.max(1, Math.floor(Number(options.attempts) || 1));
  const delays = Array.isArray(options.delays) ? options.delays : [];
  const read = typeof options.read === 'function' ? options.read : readJsonRecoverable;
  const sleep = typeof options.sleep === 'function'
    ? options.sleep
    : (delay) => new Promise((resolve) => setTimeout(resolve, delay));
  let loaded;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    loaded = read(file, fallback);
    const primaryCode = loaded.errors?.primary?.code;
    const transientPrimary = ['EBUSY', 'EACCES', 'EPERM', 'EMFILE', 'ENFILE'].includes(primaryCode);
    const shouldRetry = loaded.source === 'error' || (loaded.source === 'backup' && transientPrimary);
    if (!shouldRetry) return { ...loaded, attempts: attempt };
    if (attempt < attempts) await sleep(Math.max(0, Number(delays[attempt - 1]) || 0));
  }
  return { ...loaded, attempts };
}

function uniqueSibling(file, label) {
  const parsed = path.parse(file);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  let candidate = path.join(parsed.dir, `${parsed.name}.${label}-${stamp}${parsed.ext}`);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}.${label}-${stamp}-${suffix}${parsed.ext}`);
    suffix += 1;
  }
  return candidate;
}

function writePayload(file, value) {
  const descriptor = fs.openSync(file, 'w');
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function restoreJsonFromBackup(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.restore.tmp`;
  if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  writePayload(temporary, value);
  let quarantine = null;
  try {
    if (fs.existsSync(file)) {
      quarantine = uniqueSibling(file, 'unreadable');
      fs.renameSync(file, quarantine);
    }
    fs.renameSync(temporary, file);
    return { file, backup: `${file}.bak`, quarantine };
  } catch (error) {
    if (!fs.existsSync(file) && quarantine && fs.existsSync(quarantine)) fs.renameSync(quarantine, file);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function writeJsonRecoverable(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  const backup = `${file}.bak`;
  writePayload(temporary, value);
  let movedPrimary = false;
  try {
    if (fs.existsSync(file)) {
      if (fs.existsSync(backup)) fs.rmSync(backup, { force: true });
      fs.renameSync(file, backup);
      movedPrimary = true;
    }
    fs.renameSync(temporary, file);
    return { file, backup: movedPrimary ? backup : null };
  } catch (error) {
    if (!fs.existsSync(file) && movedPrimary && fs.existsSync(backup)) fs.renameSync(backup, file);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function progressSummary(value) {
  const state = value && typeof value === 'object' ? value : {};
  const collection = state.collection && typeof state.collection === 'object' ? state.collection : {};
  const discovered = Object.values(collection).filter((entry) => Number(entry?.count) > 0).length;
  const historyCount = Array.isArray(state.history) ? state.history.length : 0;
  const totalCatchCount = Math.max(0, Number(state.stats?.totalCatchCount) || 0, Number(state.catches) || 0, historyCount);
  return { totalCatchCount, discovered, historyCount };
}

function progressRegressed(current, baseline) {
  const next = progressSummary(current);
  const floor = {
    totalCatchCount: Math.max(0, Number(baseline?.totalCatchCount) || 0),
    discovered: Math.max(0, Number(baseline?.discovered) || 0),
    historyCount: Math.max(0, Number(baseline?.historyCount) || 0)
  };
  return next.totalCatchCount < floor.totalCatchCount
    || next.discovered < floor.discovered
    || next.historyCount < floor.historyCount;
}

function shouldAdoptCandidate(current, candidate) {
  const currentProgress = progressSummary(current);
  const candidateProgress = progressSummary(candidate);
  if (progressRegressed(candidate, currentProgress)) return false;
  const hasMoreProgress = candidateProgress.totalCatchCount > currentProgress.totalCatchCount
    || candidateProgress.discovered > currentProgress.discovered
    || candidateProgress.historyCount > currentProgress.historyCount;
  if (hasMoreProgress) return true;
  const currentUpdated = Math.max(0, Number(current?.lastUpdated) || 0);
  const candidateUpdated = Math.max(0, Number(candidate?.lastUpdated) || 0);
  return candidateUpdated >= currentUpdated;
}

module.exports = {
  readJson, readJsonResult, readJsonRecoverable, readJsonRecoverableWithRetry,
  restoreJsonFromBackup, writeJsonRecoverable, progressSummary, progressRegressed,
  shouldAdoptCandidate
};
