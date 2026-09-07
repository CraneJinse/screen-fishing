const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, dialog, powerMonitor, shell } = require('electron');
const { CharacterLibrary } = require('./src/character-library');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Game = require('./src/game-state-runtime');
const SpecialEvents = require('./src/special-events');
const PanelLayout = require('./src/panel-layout');
const AssetRuntime = require('./src/asset-runtime');
const Persistence = require('./src/persistence');
const StorageLocation = require('./src/storage-location');
const ShortcutSettings = require('./src/shortcut-settings');
const PetLayout = require('./src/pet-layout');
const FishingCore = require('./src/fishing-core');
const PACKAGE_VERSION = require('./package.json').version;
const APP_DISPLAY_NAME = '摸鱼搭子';
app.setName(APP_DISPLAY_NAME);

const IS_SMOKE = process.env.POND_SMOKE_TEST === '1';
const IS_PACKAGE_VERIFY = process.env.POND_PACKAGE_VERIFY === '1';
const IS_SOAK = process.env.POND_SOAK_TEST === '1';
const IS_AQUARIUM_SMOKE = process.env.POND_AQUARIUM_SMOKE_TEST === '1';
const IS_SAVE_STARTUP_VERIFY = process.env.POND_SAVE_STARTUP_VERIFY === '1';
const IS_STALE_INSTANCE_VERIFY = process.env.POND_STALE_INSTANCE_VERIFY === '1';
const AQUARIUM_ENABLED = false;
// Keep the completed aquarium available only to its archived source smoke and
// soak suites. Normal development and packaged builds are fishing-only.
const AQUARIUM_RUNTIME_ENABLED = AQUARIUM_ENABLED || IS_SMOKE || IS_SOAK || IS_AQUARIUM_SMOKE;
const AquariumWindow = AQUARIUM_RUNTIME_ENABLED ? require('./src/aquarium-window') : null;
let storageLocation = null;
if (IS_SMOKE || IS_PACKAGE_VERIFY) {
  process.on('unhandledRejection', (error) => {
    const prefix = IS_PACKAGE_VERIFY ? 'POND_PACKAGE_VERIFY_UNHANDLED' : 'POND_SMOKE_UNHANDLED';
    process.stderr.write(`${prefix}:${error?.stack || error}\n`);
    app.exit(1);
  });
}
if (IS_SAVE_STARTUP_VERIFY || IS_STALE_INSTANCE_VERIFY) {
  const tempRoot = path.resolve(os.tmpdir());
  const requested = path.resolve((IS_SAVE_STARTUP_VERIFY
    ? process.env.POND_SAVE_STARTUP_VERIFY_DIR
    : process.env.POND_STALE_INSTANCE_VERIFY_DIR) || '');
  if (!requested.startsWith(`${tempRoot}${path.sep}`)) throw new Error('Save startup verification directory must stay inside the OS temp directory');
  app.setPath('userData', requested);
} else if (IS_SMOKE || IS_PACKAGE_VERIFY || IS_SOAK || IS_AQUARIUM_SMOKE) app.setPath('userData', path.join(os.tmpdir(), `screen-fishing-test-${process.pid}`));
else {
  const productionUserData = process.defaultApp
    ? StorageLocation.developmentUserDataDirectory(__dirname)
    : StorageLocation.productionUserDataDirectory(process.execPath);
  fs.mkdirSync(productionUserData, { recursive: true });
  storageLocation = { targetRoot: productionUserData, portable: !process.defaultApp, automaticLegacyImport: false };
  app.setPath('userData', productionUserData);
}

// Leave a stable transparent gutter around the 192x208 art.  This prevents
// scaled line pixels and the left side of the boat from being clipped.
const PET_SIZE = { width: 376, height: 248 };
const PANEL_SIZE = { width: 640, height: 560 };
const RESULT_AUTO_HIDE_MS = 10000;
const SAVE_READ_RETRY_DELAYS_MS = [75, 175, 350, 700];
const PET_PRESENTATION_RECOVERY_DELAYS_MS = [250, 1400];
const LAUNCH_SIGNAL_POLL_MS = 500;
const SMOKE_SHORTCUTS = { pet: 'CommandOrControl+Alt+Shift+9', panel: 'CommandOrControl+Alt+Shift+8', fishing: 'CommandOrControl+Alt+Shift+7' };
const AQUARIUM_SHORTCUT_DEFAULT = 'CommandOrControl+Shift+A';
const AQUARIUM_SMOKE_SHORTCUT = 'CommandOrControl+Alt+Shift+6';
const TICK_MS = 100;
let petWindow;
let panelWindow;
let resultWindow;
let aquariumWindow;
let tray;
let gameState;
let tickTimer;
let resultHideTimer;
let windowSaveTimer;
let isQuitting = false;
let shortcutRegistered = false;
let panelShortcutRegistered = false;
let fishingShortcutRegistered = false;
let aquariumShortcutRegistered = false;
let currentShortcuts = { pet: null, panel: null, fishing: null, aquarium: null };
let lastResultCatchId = null;
// Ephemeral UI-only result for outcomes that intentionally do not enter fish history.
let resultCardOverride = null;
let assets;
let characterLibrary;
let measurementMap = {};
let panelDialogOpen = false;
let persistenceError = null;
let persistenceNotice = null;
let saveLoadSource = 'uninitialized';
let saveWriteAllowed = false;
let saveProgressFloor = { totalCatchCount: 0, discovered: 0, historyCount: 0 };
let diskRefreshPromise = null;
let repeatedLaunchPromise = null;
let launchSignalTimer = null;
let launchSignalWatcherActive = false;
let petToolSide = 'right';
let panelReadiness = null;
let panelShowRequest = 0;
let petExplicitlyHidden = false;
let aquariumExplicitlyHidden = true;
let aquariumLayoutModeActive = false;
const aquariumPresentationRecoveryTimers = new Set();
const petPresentationRecoveryTimers = new Set();
const launchSignalEnabled = !IS_SMOKE && !IS_PACKAGE_VERIFY && !IS_SOAK && !IS_AQUARIUM_SMOKE && !IS_SAVE_STARTUP_VERIFY;
const launchRequestFile = path.join(app.getPath('userData'), 'launch-request.json');
const launchMonitorFile = path.join(app.getPath('userData'), 'launch-monitor-diagnostics.json');
const processLaunchToken = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
let lastHandledLaunchToken = processLaunchToken;
if (launchSignalEnabled) {
  try {
    fs.mkdirSync(path.dirname(launchRequestFile), { recursive: true });
    fs.writeFileSync(launchRequestFile, JSON.stringify({ token: processLaunchToken, processId: process.pid, requestedAt: Date.now() }), 'utf8');
  } catch (error) {
    process.stderr.write(`POND_LAUNCH_SIGNAL_WARNING:${error.message}\n`);
  }
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on('second-instance', () => { handleRepeatedLaunch('second-instance'); });

function jsonPath(name) { return path.join(app.getPath('userData'), name); }
function finite(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function hashSeedForMain(value) {
  let hash = 2166136261;
  for (const char of String(value || 'aquarium')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash || 1;
}
function readJson(file, fallback = null) { return Persistence.readJson(file) ?? fallback; }
function atomicWriteJson(file, value) { return Persistence.writeJsonRecoverable(file, value); }
function normalizeRuntimeState(value) {
  const normalized = Game.normalizeState(value);
  if (AQUARIUM_ENABLED) return normalized;
  const archiveFile = jsonPath('aquarium-system-archive.json');
  if (!fs.existsSync(archiveFile)) {
    const payload = FishingCore.archivePayload(normalized, '1.5.5');
    if (payload) payload.archivedByVersion = PACKAGE_VERSION;
    try {
      if (payload) atomicWriteJson(archiveFile, payload);
      if (payload && !fs.existsSync(archiveFile)) throw new Error('鱼缸封存文件未落盘');
    } catch (error) {
      persistenceError = `鱼缸封存失败，原存档未转换：${error.message}`;
      return normalized;
    }
  }
  return FishingCore.disableAquariumState(normalized);
}
function isPlausibleSave(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && ['version', 'saveSchemaVersion', 'history', 'collection', 'settings', 'castCount'].some((key) => Object.hasOwn(value, key)));
}
function saveGame({ allowProgressReset = false } = {}) {
  if (!gameState || !saveWriteAllowed) return false;
  const currentProgress = Persistence.progressSummary(gameState);
  if (!allowProgressReset && Persistence.progressRegressed(gameState, saveProgressFloor)) {
    persistenceError = '存档安全保护：当前内存进度低于启动时记录，已拒绝覆盖磁盘存档';
    return false;
  }
  try {
    atomicWriteJson(jsonPath('screen-fishing-save.json'), gameState);
    saveProgressFloor = currentProgress;
    persistenceError = null;
    return true;
  }
  catch (error) { persistenceError = error.message; return false; }
}
function startupSaveDiagnostics(loaded, saveFile, trigger = 'startup') {
  return {
    generatedAt: new Date().toISOString(), packageVersion: PACKAGE_VERSION,
    trigger, processId: process.pid, executable: process.execPath, appPath: app.getAppPath(),
    launchSignalEnabled, lastHandledLaunchToken,
    userData: app.getPath('userData'), saveFile, source: loaded.source,
    attempts: loaded.attempts, errors: loaded.errors || {},
    progress: gameState ? Persistence.progressSummary(gameState) : null,
    writeAllowed: saveWriteAllowed,
    storageLocation
  };
}
function writeStartupSaveDiagnostics(loaded, saveFile, trigger = 'startup') {
  try { atomicWriteJson(jsonPath('startup-save-diagnostics.json'), startupSaveDiagnostics(loaded, saveFile, trigger)); }
  catch (error) { process.stderr.write(`POND_SAVE_DIAGNOSTIC_WARNING:${error.message}\n`); }
}
function readGameSave(saveFile) {
  return Persistence.readJsonRecoverableWithRetry(saveFile, null, {
    attempts: SAVE_READ_RETRY_DELAYS_MS.length + 1,
    delays: SAVE_READ_RETRY_DELAYS_MS,
    read: (file, fallback) => Persistence.readJsonRecoverable(file, fallback, { validate: isPlausibleSave })
  });
}
async function loadGame() {
  const saveFile = jsonPath('screen-fishing-save.json');
  saveWriteAllowed = false;
  persistenceError = null;
  persistenceNotice = null;
  const loaded = await readGameSave(saveFile);
  saveLoadSource = loaded.source;
  if (loaded.source === 'error') {
    writeStartupSaveDiagnostics(loaded, saveFile);
    return { ok: false, loaded, saveFile };
  }
  gameState = normalizeRuntimeState(loaded.value);
  if (gameState.isPaused) gameState = Game.resume(gameState);
  saveProgressFloor = Persistence.progressSummary(gameState);
  saveWriteAllowed = true;
  if (loaded.source === 'backup') {
    try {
      const recovery = Persistence.restoreJsonFromBackup(saveFile, gameState);
      persistenceNotice = recovery.quarantine ? '已从备份恢复，原异常主存档已隔离' : '已从备份恢复主存档';
    } catch (error) {
      persistenceError = `已载入备份，但恢复主存档失败：${error.message}`;
    }
  }
  writeStartupSaveDiagnostics(loaded, saveFile);
  return { ok: true, loaded, saveFile };
}
async function refreshGameFromDisk(trigger = 'runtime-refresh') {
  if (!gameState || !saveWriteAllowed) return false;
  if (diskRefreshPromise) return diskRefreshPromise;
  diskRefreshPromise = (async () => {
    const saveFile = jsonPath('screen-fishing-save.json');
    const loaded = await readGameSave(saveFile);
    if (!['primary', 'backup'].includes(loaded.source)) {
      writeStartupSaveDiagnostics(loaded, saveFile, `${trigger}-read-failed`);
      return false;
    }
    let candidate = normalizeRuntimeState(loaded.value);
    if (petExplicitlyHidden) candidate = Game.suspend(candidate);
    else if (candidate.isPaused) candidate = Game.resume(candidate);
    if (!Persistence.shouldAdoptCandidate(gameState, candidate)) {
      writeStartupSaveDiagnostics({ ...loaded, source: `${loaded.source}-kept-memory` }, saveFile, trigger);
      return false;
    }
    gameState = candidate;
    saveProgressFloor = Persistence.progressSummary(candidate);
    saveLoadSource = loaded.source;
    persistenceError = null;
    if (loaded.source === 'backup') {
      try {
        const recovery = Persistence.restoreJsonFromBackup(saveFile, candidate);
        persistenceNotice = recovery.quarantine ? '已从备份恢复，原异常主存档已隔离' : '已从备份恢复主存档';
      } catch (error) {
        persistenceError = `已载入备份，但恢复主存档失败：${error.message}`;
      }
    } else if (trigger === 'second-instance') {
      persistenceNotice = '已重新读取本地存档';
    }
    writeStartupSaveDiagnostics(loaded, saveFile, trigger);
    return true;
  })().finally(() => { diskRefreshPromise = null; });
  return diskRefreshPromise;
}
function refreshGameFromDiskImmediately(trigger = 'repeat-launch') {
  if (!gameState || !saveWriteAllowed) return false;
  const saveFile = jsonPath('screen-fishing-save.json');
  const loaded = {
    ...Persistence.readJsonRecoverable(saveFile, null, { validate: isPlausibleSave }),
    attempts: 1
  };
  if (!['primary', 'backup'].includes(loaded.source)) {
    writeStartupSaveDiagnostics(loaded, saveFile, `${trigger}-read-failed`);
    return false;
  }
  let candidate = normalizeRuntimeState(loaded.value);
  if (petExplicitlyHidden) candidate = Game.suspend(candidate);
    else if (candidate.isPaused) candidate = Game.resume(candidate);
  if (!Persistence.shouldAdoptCandidate(gameState, candidate)) {
    writeStartupSaveDiagnostics({ ...loaded, source: `${loaded.source}-kept-memory` }, saveFile, trigger);
    return false;
  }
  gameState = candidate;
  saveProgressFloor = Persistence.progressSummary(candidate);
  saveLoadSource = loaded.source;
  persistenceError = null;
  if (loaded.source === 'backup') {
    try {
      const recovery = Persistence.restoreJsonFromBackup(saveFile, candidate);
      persistenceNotice = recovery.quarantine ? '已从备份恢复，原异常主存档已隔离' : '已从备份恢复主存档';
    } catch (error) {
      persistenceError = `已载入备份，但恢复主存档失败：${error.message}`;
    }
  } else {
    persistenceNotice = '已重新读取本地存档';
  }
  writeStartupSaveDiagnostics(loaded, saveFile, trigger);
  return true;
}
function currentLaunchRequest() {
  const value = Persistence.readJson(launchRequestFile);
  return value && typeof value.token === 'string' ? value : null;
}
function writeLaunchMonitorDiagnostics(event, request = null, error = null) {
  try {
    fs.writeFileSync(launchMonitorFile, JSON.stringify({
      generatedAt: new Date().toISOString(), event, processId: process.pid,
      enabled: launchSignalEnabled, ownToken: processLaunchToken,
      lastHandledLaunchToken, request, error: error ? String(error.message || error) : null
    }, null, 2), 'utf8');
  } catch { /* Diagnostics must never affect launch behavior. */ }
}
async function handleRepeatedLaunch(trigger = 'launch-signal') {
  if (!petWindow || !launchSignalEnabled) return false;
  const request = currentLaunchRequest();
  if (request?.token) {
    if (request.token === lastHandledLaunchToken) return false;
    lastHandledLaunchToken = request.token;
  } else if (trigger === 'launch-signal') return false;
  writeLaunchMonitorDiagnostics(`handling-${trigger}`, request);
  if (repeatedLaunchPromise) return repeatedLaunchPromise;
  repeatedLaunchPromise = (async () => {
    refreshGameFromDiskImmediately(trigger);
    writeLaunchMonitorDiagnostics(`handled-${trigger}`, request);
    if (IS_STALE_INSTANCE_VERIFY) {
      process.stdout.write(`POND_STALE_INSTANCE_VERIFY:${JSON.stringify(startupSaveDiagnostics({ source: saveLoadSource, attempts: 1, errors: {} }, jsonPath('screen-fishing-save.json'), trigger))}\n`);
      saveWriteAllowed = false;
      isQuitting = true;
      app.exit(0);
      return true;
    }
    showPet({ forceRefresh: true });
    showPanel();
    if (AQUARIUM_RUNTIME_ENABLED && aquariumVisibilitySetting()) showAquarium({ persist:false, forceRefresh:true });
    broadcastAll();
    return true;
  })().finally(() => { repeatedLaunchPromise = null; });
  return repeatedLaunchPromise;
}
function startLaunchRequestMonitor() {
  if (!launchSignalEnabled || launchSignalTimer) return;
  const poll = () => {
    const request = currentLaunchRequest();
    if (request?.token && request.token !== lastHandledLaunchToken) handleRepeatedLaunch('launch-signal');
  };
  writeLaunchMonitorDiagnostics('monitor-started', currentLaunchRequest());
  launchSignalTimer = setInterval(poll, LAUNCH_SIGNAL_POLL_MS);
  fs.watchFile(launchRequestFile, { interval: LAUNCH_SIGNAL_POLL_MS }, poll);
  launchSignalWatcherActive = true;
}
function loadWindowSettings() { return readJson(jsonPath('window-settings.json'), {}); }
function saveWindowSettings() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const current = loadWindowSettings();
  const petBounds = petWindow.getBounds();
  const display = screen.getDisplayMatching(petBounds);
  const area = display.workArea;
  const normalized = {
    x: area.width > petBounds.width ? (petBounds.x - area.x) / (area.width - petBounds.width) : 0,
    y: area.height > petBounds.height ? (petBounds.y - area.y) / (area.height - petBounds.height) : 0
  };
  try {
    atomicWriteJson(jsonPath('window-settings.json'), {
      ...current,
      pet: { bounds: petBounds, displayId: String(display.id), normalized },
      panel: panelWindow && !panelWindow.isDestroyed() ? panelWindow.getBounds() : current.panel,
      aquarium: aquariumWindow && !aquariumWindow.isDestroyed()
        ? (() => {
          const aquariumBounds = aquariumWindow.getBounds();
          const aquariumDisplay = screen.getDisplayMatching(aquariumBounds);
          return {
            bounds: aquariumBounds, displayId: String(aquariumDisplay.id),
            normalized: AquariumWindow.normalizedPosition(aquariumBounds, aquariumDisplay.workArea)
          };
        })()
        : current.aquarium
    });
  } catch (error) { persistenceError = error.message; }
}
function scheduleWindowSettingsSave() {
  clearTimeout(windowSaveTimer);
  windowSaveTimer = setTimeout(saveWindowSettings, 250);
}
function clampBounds(bounds, area, minGrab = 48) {
  return {
    x: Math.round(Math.max(area.x - bounds.width + minGrab, Math.min(bounds.x, area.x + area.width - minGrab))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - minGrab))),
    width: bounds.width,
    height: bounds.height
  };
}
function petDisplaySize(scale = gameState?.settings?.petScale || 1) {
  return { width: Math.round(184 + 192 * scale), height: Math.round(40 + 208 * scale) };
}
function petLayoutMetrics(bounds, scale = gameState?.settings?.petScale || 1) {
  if (!bounds) {
    if (!petWindow || petWindow.isDestroyed()) return null;
    bounds = petWindow.getBounds();
  }
  const bodyWidth = Math.round(192 * scale);
  const reserve = Math.max(0, bounds.width - bodyWidth);
  return { bodyWidth, reserve, bodyX: bounds.x + (petToolSide === 'left' ? reserve : 0), bodyTop: bounds.y + Math.max(0, bounds.height - Math.round(208 * scale)) };
}
function petBodyBounds(bounds) {
  if (!bounds) {
    if (!petWindow || petWindow.isDestroyed()) return null;
    bounds = petWindow.getBounds();
  }
  const metrics = petLayoutMetrics(bounds);
  return { x: metrics.bodyX, y: metrics.bodyTop, width: metrics.bodyWidth, height: Math.round(208 * (gameState?.settings?.petScale || 1)) };
}
function resultDisplaySize(scale = gameState?.settings?.petScale || 1) {
  // Keep the entire result card visually subordinate to the pet.  The prior
  // window reused the full 192px pet-body width and only reduced the fish art,
  // which still left a large panel floating over the desktop.
  const width = Math.round(Math.max(152, Math.min(200, 168 * scale)));
  // 168 x 176 is the approved review-card canvas. Keep that exact aspect ratio
  // at every pet scale so the live card cannot drift from the reviewed layout.
  return { width, height: Math.round(width * 22 / 21) };
}
function sendPetLayout() {
  const win = petWindow;
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false;
  const bounds = win.getBounds();
  const metrics = petLayoutMetrics(bounds);
  sendTo(win, 'window:pet-layout', {
    side: petToolSide, reserve: metrics.reserve, bodyLeft: metrics.bodyX - bounds.x,
    bodyTop: metrics.bodyTop - bounds.y, bodyWidth: metrics.bodyWidth,
    toolLeft: petToolSide === 'left' ? Math.max(8, metrics.bodyX - bounds.x - 52) : metrics.bodyX - bounds.x + metrics.bodyWidth + 12
  });
  return true;
}
function restoredPetBounds() {
  const saved = loadWindowSettings().pet;
  const displays = screen.getAllDisplays();
  const display = displays.find((item) => String(item.id) === String(saved?.displayId)) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const normalized = saved?.normalized || { x: 1, y: 1 };
  const size = petDisplaySize();
  return clampBounds({
    x: area.x + finite(normalized.x, 1) * Math.max(0, area.width - size.width),
    y: area.y + finite(normalized.y, 1) * Math.max(0, area.height - size.height),
    ...size
  }, area);
}
function restoredPanelBounds() {
  const saved = loadWindowSettings().panel;
  if (!saved || !Number.isFinite(Number(saved.x)) || !Number.isFinite(Number(saved.y))) return null;
  const display = screen.getDisplayMatching(saved);
  const area = display.workArea;
  return PanelLayout.restoredBounds(saved, area, PANEL_SIZE);
}
function aquariumSettings() {
  return gameState?.aquarium?.settings || {
    scale: 1, alwaysOnTop: true, inputLocked: false,
    shortcut: AQUARIUM_SHORTCUT_DEFAULT
  };
}
function aquariumVisibilitySetting() { return Boolean(gameState?.aquarium?.visible ?? aquariumSettings().visible); }
function restoredAquariumBounds() {
  const saved = loadWindowSettings().aquarium;
  const displays = screen.getAllDisplays();
  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const display = displays.find((item) => String(item.id) === String(saved?.displayId)) || cursorDisplay || screen.getPrimaryDisplay();
  return AquariumWindow.restoredBounds(saved, display, aquariumSettings().scale);
}
function browserOptions(size) {
  return {
    ...size, frame: false, show: false, maximizable: false, minimizable: false,
    fullscreenable: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  };
}
function createPetWindow() {
  petExplicitlyHidden = false;
  petWindow = new BrowserWindow({
    ...browserOptions(PET_SIZE), ...restoredPetBounds(), transparent: true, resizable: false,
    alwaysOnTop: gameState.settings.alwaysOnTop, skipTaskbar: true, hasShadow: false
  });
  petWindow.setAlwaysOnTop(gameState.settings.alwaysOnTop, 'floating');
  const createdWindow = petWindow;
  petWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  petWindow.once('ready-to-show', () => {
    if (createdWindow !== petWindow || createdWindow.isDestroyed()) return;
    showPet();
  });
  petWindow.webContents.once('did-finish-load', () => {
    if (createdWindow !== petWindow || createdWindow.isDestroyed() || createdWindow.webContents.isDestroyed()) return;
    broadcastAll(); sendPetLayout();
  });
  petWindow.on('blur', schedulePetPresentationRecovery);
  petWindow.webContents.on('render-process-gone', () => {
    if (isQuitting || !petWindow || petWindow.isDestroyed()) return;
    petWindow.webContents.reload();
    schedulePetPresentationRecovery();
  });
  petWindow.on('moved', () => {
    scheduleWindowSettingsSave();
    repositionAdjacentWindows();
    sendTo(petWindow, 'window:corner', cornerIdForBounds(petBodyBounds()));
    sendPetLayout();
  });
  petWindow.on('close', (event) => { if (!isQuitting) { event.preventDefault(); hidePet(); } });
}
function createPanelWindow() {
  const restored = restoredPanelBounds();
  panelWindow = new BrowserWindow({
    ...browserOptions(PANEL_SIZE), ...(restored || {}), minWidth: 480, minHeight: 420,
    resizable: true, transparent: false, backgroundColor: '#151a27',
    alwaysOnTop: false, skipTaskbar: false, title: '摸鱼搭子',
    icon: require('./src/application-icon').createApplicationIcon(nativeImage, __dirname)
  });
  require('./src/application-icon').applyTaskbarIcon(panelWindow, __dirname);
  const createdWindow = panelWindow;
  const readiness = require('./src/panel-readiness').createPanelReadiness(createdWindow);
  panelReadiness = readiness;
  createdWindow.loadFile(path.join(__dirname, 'src', 'panel.html')).catch(error => readiness.fail(error));
  createdWindow.on('close', (event) => { if (!isQuitting) { event.preventDefault(); panelShowRequest += 1; createdWindow.hide(); } });
  // The panel is an information workspace. Clicking another window must not
  // destroy the current route or scroll position; close is explicit only.
  panelWindow.on('resize', scheduleWindowSettingsSave);
  panelWindow.on('move', scheduleWindowSettingsSave);
}
function createResultWindow() {
  resultWindow = new BrowserWindow({
    ...browserOptions(resultDisplaySize()), transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, hasShadow: false
  });
  resultWindow.setAlwaysOnTop(true, 'floating');
  resultWindow.loadFile(path.join(__dirname, 'src', 'result.html'));
  resultWindow.on('close', (event) => { if (!isQuitting) { event.preventDefault(); resultWindow.hide(); } });
}
function sendAquariumLayout() {
  if (!aquariumWindow || aquariumWindow.isDestroyed()) return false;
  const bounds = aquariumWindow.getBounds();
  return sendTo(aquariumWindow, 'aquarium:window-layout', { ...bounds, scale: bounds.width / AquariumWindow.BASE_SIZE.width });
}
function sendAquariumVisibility() {
  return sendTo(aquariumWindow, 'aquarium:window-visibility', Boolean(aquariumWindow?.isVisible() && !aquariumWindow.isMinimized()));
}
function createAquariumWindow() {
  const settings = aquariumSettings();
  aquariumExplicitlyHidden = !aquariumVisibilitySetting();
  aquariumWindow = new BrowserWindow({
    ...browserOptions(AquariumWindow.BASE_SIZE), ...restoredAquariumBounds(),
    transparent: true, resizable: false, alwaysOnTop: settings.alwaysOnTop !== false,
    skipTaskbar: true, focusable: true, hasShadow: false
  });
  aquariumWindow.setAlwaysOnTop(settings.alwaysOnTop !== false, 'floating');
  aquariumWindow.setIgnoreMouseEvents(Boolean(settings.inputLocked), { forward: true });
  const createdWindow = aquariumWindow;
  aquariumWindow.loadFile(path.join(__dirname, 'aquarium.html'), IS_AQUARIUM_SMOKE ? { query: { demo:'1' } } : undefined);
  aquariumWindow.once('ready-to-show', () => {
    if (createdWindow !== aquariumWindow || createdWindow.isDestroyed()) return;
    if (!aquariumExplicitlyHidden) showAquarium({ persist: false });
  });
  aquariumWindow.webContents.once('did-finish-load', () => {
    if (createdWindow !== aquariumWindow || createdWindow.isDestroyed() || createdWindow.webContents.isDestroyed()) return;
    sendTo(createdWindow, 'game:update', publicSnapshot()); sendAquariumLayout(); sendAquariumVisibility();
  });
  aquariumWindow.on('show', sendAquariumVisibility);
  aquariumWindow.on('hide', sendAquariumVisibility);
  aquariumWindow.on('moved', () => { scheduleWindowSettingsSave(); sendAquariumLayout(); });
  aquariumWindow.on('minimize', () => {
    if (aquariumExplicitlyHidden || isQuitting) return;
    aquariumWindow.restore(); aquariumWindow.showInactive(); sendAquariumVisibility();
  });
  aquariumWindow.on('blur', scheduleAquariumPresentationRecovery);
  aquariumWindow.webContents.on('render-process-gone', () => {
    if (isQuitting || createdWindow.isDestroyed()) return;
    createdWindow.webContents.reload(); scheduleAquariumPresentationRecovery();
  });
  aquariumWindow.on('close', (event) => { if (!isQuitting) { event.preventDefault(); hideAquarium(); } });
}
function sendTo(win, channel, value) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false;
  try {
    if (win.webContents.isLoadingMainFrame()) return false;
    win.webContents.send(channel, value);
    return true;
  } catch (error) {
    if (!isQuitting) process.stderr.write(`POND_WINDOW_SEND_WARNING:${channel}:${error.message}\n`);
    return false;
  }
}
function assetSnapshot() {
  return (characterLibrary && assets ? characterLibrary.assets(assets) : assets) || { manifests: [], fallbackPet: 'assets/pet/v4-design-gate/canonical-seated-fishing.png', diagnostics: { fallbacks: ['not-loaded'] } };
}
function publicSnapshot() {
  return {
    state: gameState, catalog: Game.FISH, packs: Game.PACKS, rarities: Game.RARITIES,
    rarityNames: Game.rarityNames, achievements: Game.ACHIEVEMENTS, assets: assetSnapshot(), aquariumCatalog: AQUARIUM_RUNTIME_ENABLED ? (Game.AQUARIUM_CATALOG || null) : null,
    resultCard: resultCardOverride,
    characters: characterLibrary?.snapshot(),
    specialEventCatalog: SpecialEvents.runtimeRegistry(),
    app: { persistenceError, persistenceNotice, saveLoadSource, features: { aquarium: AQUARIUM_RUNTIME_ENABLED }, shortcuts: {
      pet: ShortcutSettings.displayAccelerator(currentShortcuts.pet),
      panel: ShortcutSettings.displayAccelerator(currentShortcuts.panel),
      fishing: ShortcutSettings.displayAccelerator(currentShortcuts.fishing),
      aquarium: ShortcutSettings.displayAccelerator(currentShortcuts.aquarium),
      petAccelerator: currentShortcuts.pet, panelAccelerator: currentShortcuts.panel, fishingAccelerator: currentShortcuts.fishing,
      aquariumAccelerator: currentShortcuts.aquarium,
      petRegistered: shortcutRegistered, panelRegistered: panelShortcutRegistered, fishingRegistered: fishingShortcutRegistered,
      aquariumRegistered: aquariumShortcutRegistered
    } }
  };
}
function broadcastAll() {
  const snapshot = publicSnapshot();
  for (const win of [petWindow, panelWindow, resultWindow, aquariumWindow]) sendTo(win, 'game:update', snapshot);
}
async function characterAction(event, action, id) {
  if (!panelWindow || event.sender !== panelWindow.webContents || !characterLibrary) return { ok: false, error: '角色库尚未就绪' };
  try {
    if (action === 'refresh') characterLibrary.reload();
    else if (action === 'select') characterLibrary.select(id);
    else if (action === 'folder') {
      const error = await shell.openPath(characterLibrary.root); if (error) throw Error('角色目录打开失败');
    } else if (action === 'import') {
      if (panelDialogOpen) return { ok: false, error: '请先关闭当前文件对话框' };
      panelDialogOpen = true;
      const result = await dialog.showOpenDialog(panelWindow, { title: '导入角色包文件夹', properties: ['openDirectory'] }).finally(() => { panelDialogOpen = false; });
      if (result.canceled) return { ok: true, canceled: true };
      characterLibrary.import(result.filePaths[0]);
    } else throw Error('不支持的角色操作');
    broadcastAll(); return { ok: true, snapshot: publicSnapshot() };
  } catch (error) { return { ok: false, error: error.message }; }
}
function dispatch(action, payload = {}) {
  if (['achievement-track', 'achievement-title', 'achievement-acknowledge'].includes(action)) {
    const previousState = gameState;
    const result = Game.applyAchievementAction(gameState, { type: action.replace('achievement-', ''), id: payload?.id });
    if (!result.ok) return { ok: false, reason: result.reason, snapshot: publicSnapshot() };
    gameState = result.state;
    if (!saveGame()) {
      gameState = previousState;
      broadcastAll();
      return { ok: false, reason: 'persistence-failed', snapshot: publicSnapshot() };
    }
    broadcastAll();
    return { ok: true, snapshot: publicSnapshot() };
  }
  // Resolve position at the actual cast, including first load, restored bounds
  // and tool-side changes; renderer move notifications are only advisory.
  if (action === 'cast') payload = { ...payload, corner: cornerIdForBounds(petBodyBounds()) };
  const beforeJson = JSON.stringify(gameState);
  gameState = Game.transition(gameState, action, Math.random, Date.now(), payload, assets?.timings);
  if (JSON.stringify(gameState) === beforeJson) return { ok: false, reason: 'invalid-state', snapshot: publicSnapshot() };
  if (gameState.fishingState === 'empty_reel' && gameState.currentResult?.type === 'random_unhook') { resultCardOverride = gameState.currentResult; showResult(); }
  else if (gameState.currentResult?.type === 'special') { resultCardOverride = null; }
  saveGame(); broadcastAll(); updateTrayMenu();
  return { ok: true, snapshot: publicSnapshot() };
}
function economyAction(action, payload = {}) {
  let result;
  if (action === 'switch-habitat') result = Game.switchHabitat(gameState, payload.habitat);
  else if (action === 'purchase-pack') result = Game.purchasePack(gameState, payload.packId);
  else if (action === 'purchase-equipment') result = Game.purchaseEquipment(gameState, payload.equipmentId);
  else if (action === 'equip-bait') result = Game.equipBait(gameState, payload.baitId ?? null);
  else if (action === 'sell-inventory') result = Game.sellInventory(gameState, payload.inventoryIds);
  else if (action === 'set-inventory-lock') result = Game.setInventoryLocked(gameState, payload.inventoryId, payload.locked);
  else return { ok: false, reason: 'unknown-action', snapshot: publicSnapshot() };
  if (!result?.ok) return { ...result, state: undefined, snapshot: publicSnapshot() };
  gameState = result.state;
  saveGame(); broadcastAll(); updateTrayMenu();
  return { ...result, state: undefined, snapshot: publicSnapshot() };
}
function aquariumLayoutModePayload(active) {
  const resolved = AquariumWindow.resolveActiveTank({ state:gameState });
  return { active:Boolean(active), habitat:resolved.habitat, tankId:resolved.tankId };
}
function aquariumAction(action, payload = {}) {
  if (!AQUARIUM_RUNTIME_ENABLED) return { ok: false, reason: 'aquarium-shelved', snapshot: publicSnapshot() };
  if (action === 'close-layout') {
    aquariumLayoutModeActive = false;
    if (aquariumWindow && !aquariumWindow.isDestroyed()) aquariumWindow.setIgnoreMouseEvents(Boolean(aquariumSettings().inputLocked), { forward:true });
    sendTo(aquariumWindow, 'aquarium:layout-mode', aquariumLayoutModePayload(false));
    return { ok:true, snapshot:publicSnapshot() };
  }
  const transition = Game.aquariumAction || Game.applyAquariumAction;
  if (typeof transition !== 'function') return { ok: false, reason: 'aquarium-unavailable', snapshot: publicSnapshot() };
  let result;
  try { result = transition(gameState, action, payload, Date.now()); }
  catch (error) { return { ok: false, reason: 'aquarium-action-error', error: error.message, snapshot: publicSnapshot() }; }
  if (!result?.ok || !result.state) return { ...(result || { ok:false, reason:'invalid-result' }), state: undefined, snapshot: publicSnapshot() };
  gameState = result.state;
  if (action === 'open-layout') {
    const active = payload.active !== false;
    aquariumLayoutModeActive = active;
    if (active && aquariumWindow && !aquariumWindow.isDestroyed()) aquariumWindow.setIgnoreMouseEvents(false);
    if (!active && aquariumWindow && !aquariumWindow.isDestroyed()) aquariumWindow.setIgnoreMouseEvents(Boolean(aquariumSettings().inputLocked), { forward:true });
    sendTo(aquariumWindow, 'aquarium:layout-mode', aquariumLayoutModePayload(active));
  } else if (action === 'save-layout') {
    aquariumLayoutModeActive = false;
    if (aquariumWindow && !aquariumWindow.isDestroyed()) aquariumWindow.setIgnoreMouseEvents(Boolean(aquariumSettings().inputLocked), { forward:true });
    sendTo(aquariumWindow, 'aquarium:layout-mode', aquariumLayoutModePayload(false));
  } else if (action === 'show-window') showAquarium({ persist:false });
  else if (action === 'hide-window') hideAquarium({ persist:false });
  if (action === 'set-setting') {
    if (Object.hasOwn(payload, 'scale')) setAquariumScale(aquariumSettings().scale, { persist:false });
    if (Object.hasOwn(payload, 'inputLocked')) setAquariumLock(aquariumSettings().inputLocked, { persist:false });
    if (Object.hasOwn(payload, 'alwaysOnTop') && aquariumWindow && !aquariumWindow.isDestroyed()) {
      if (aquariumSettings().alwaysOnTop === false) aquariumWindow.setAlwaysOnTop(false);
      else aquariumWindow.setAlwaysOnTop(true, 'floating');
    }
    if (Object.hasOwn(payload, 'visible')) {
      if (aquariumVisibilitySetting()) showAquarium({ persist:false }); else hideAquarium({ persist:false });
    }
  }
  saveGame(); broadcastAll(); updateTrayMenu();
  return { ...result, state: undefined, snapshot: publicSnapshot() };
}
function applySettingPatch(patch, { persist = true, broadcast = true } = {}) {
  const previousScale = gameState.settings.petScale;
  const { petShortcut: _petShortcut, panelShortcut: _panelShortcut, fishingShortcut: _fishingShortcut, ...safePatch } = patch || {};
  gameState = Game.applySettings(gameState, safePatch);
  if (Object.hasOwn(safePatch, 'alwaysOnTop')) petWindow?.setAlwaysOnTop(Boolean(gameState.settings.alwaysOnTop), 'floating');
  if (Object.hasOwn(safePatch, 'launchAtLogin')) app.setLoginItemSettings({ openAtLogin: Boolean(gameState.settings.launchAtLogin), path: process.execPath });
  if (gameState.settings.petScale !== previousScale && petWindow && !petWindow.isDestroyed()) {
    const old = petWindow.getBounds();
    const oldMetrics = petLayoutMetrics(old, previousScale);
    const next = petDisplaySize(gameState.settings.petScale);
    const area = screen.getDisplayMatching(old).workArea;
    const bodyWidth = Math.round(192 * gameState.settings.petScale);
    const reserve = next.width - bodyWidth;
    petToolSide = PetLayout.chooseToolSide(oldMetrics.bodyX, bodyWidth, reserve, area, petToolSide);
    const x = oldMetrics.bodyX - (petToolSide === 'left' ? reserve : 0);
    petWindow.setBounds({ x: Math.max(area.x, Math.min(Math.round(x), area.x + area.width - next.width)), y: Math.max(area.y, Math.min(old.y + old.height - next.height, area.y + area.height - next.height)), ...next });
    sendPetLayout();
    repositionAdjacentWindows();
  }
  if (persist) saveGame();
  if (broadcast) broadcastAll(); else sendTo(petWindow, 'game:update', publicSnapshot());
  return publicSnapshot();
}
function runFishingShortcut() {
  if (gameState.fishingState === 'idle') return dispatch('cast');
  if (['casting', 'waiting'].includes(gameState.fishingState)) return dispatch('early-reel');
  if (['bite_intro', 'bite_loop', 'bite_urgent', 'bite_ready'].includes(gameState.fishingState)) return dispatch('reel');
  return { ok: false, reason: 'fishing-action-busy', snapshot: publicSnapshot() };
}
function shortcutHandler(kind) { return kind === 'pet' ? togglePet : kind === 'panel' ? togglePanel : kind === 'fishing' ? runFishingShortcut : toggleAquarium; }
function shortcutSettingKey(kind) { return kind === 'pet' ? 'petShortcut' : kind === 'panel' ? 'panelShortcut' : kind === 'fishing' ? 'fishingShortcut' : 'shortcut'; }
function setShortcutRegistered(kind, value) {
  if (kind === 'pet') shortcutRegistered = value;
  else if (kind === 'panel') panelShortcutRegistered = value;
  else if (kind === 'fishing') fishingShortcutRegistered = value;
  else aquariumShortcutRegistered = value;
}
function registerInitialShortcuts() {
  const desired = (IS_SMOKE || IS_PACKAGE_VERIFY || IS_SOAK || IS_AQUARIUM_SMOKE) ? { ...SMOKE_SHORTCUTS, aquarium: AQUARIUM_SMOKE_SHORTCUT } : {
    pet: ShortcutSettings.normalizeAccelerator(gameState.settings.petShortcut) || Game.defaultSettings.petShortcut,
    panel: ShortcutSettings.normalizeAccelerator(gameState.settings.panelShortcut) || Game.defaultSettings.panelShortcut,
    fishing: ShortcutSettings.normalizeAccelerator(gameState.settings.fishingShortcut) || Game.defaultSettings.fishingShortcut,
    aquarium: ShortcutSettings.normalizeAccelerator(aquariumSettings().shortcut) || AQUARIUM_SHORTCUT_DEFAULT
  };
  const kinds = AQUARIUM_RUNTIME_ENABLED ? ['pet', 'panel', 'fishing', 'aquarium'] : ['pet', 'panel', 'fishing'];
  for (const kind of kinds) {
    currentShortcuts[kind] = desired[kind];
    setShortcutRegistered(kind, globalShortcut.register(desired[kind], shortcutHandler(kind)));
  }
}
function updateShortcut(kind, rawValue) {
  if (kind === 'aquarium' && !AQUARIUM_RUNTIME_ENABLED) return { ok:false, error:'桌面鱼缸功能已封存', snapshot:publicSnapshot() };
  const validation = ShortcutSettings.validateShortcutChange(kind, rawValue, currentShortcuts);
  if (!validation.ok) return { ...validation, snapshot: publicSnapshot() };
  const candidate = validation.accelerator;
  const old = currentShortcuts[kind];
  if (candidate === old) return { ok: true, accelerator: candidate, snapshot: publicSnapshot() };
  let registered = false;
  try { registered = globalShortcut.register(candidate, shortcutHandler(kind)); }
  catch { registered = false; }
  if (!registered) {
    return { ok: false, error: '该快捷键已被其他应用占用，原快捷键保持不变', snapshot: publicSnapshot() };
  }
  if (old) globalShortcut.unregister(old);
  currentShortcuts[kind] = candidate;
  setShortcutRegistered(kind, true);
  if (kind === 'aquarium') {
    const result = aquariumAction('set-setting', { shortcut: candidate });
    if (!result.ok) {
      globalShortcut.unregister(candidate);
      if (old) globalShortcut.register(old, shortcutHandler(kind));
      currentShortcuts[kind] = old; setShortcutRegistered(kind, Boolean(old && globalShortcut.isRegistered(old)));
      return { ok:false, error:'鱼缸快捷键设置未能保存，原快捷键保持不变', snapshot:publicSnapshot() };
    }
  } else gameState = Game.applySettings(gameState, { [shortcutSettingKey(kind)]: candidate });
  saveGame();
  if (tray) tray.setToolTip(`摸鱼搭子 · ${ShortcutSettings.displayAccelerator(currentShortcuts.pet)}`);
  broadcastAll();
  return { ok: true, accelerator: candidate, snapshot: publicSnapshot() };
}
function loadMeasurementMap() {
  const data = readJson(path.join(__dirname, 'data', 'fish-measurements.json'), {});
  if (Array.isArray(data.entries)) return Object.fromEntries(data.entries.map((entry) => [entry.fishId, entry]));
  return data.entries || data || {};
}
function tick() {
  const beforeState = gameState.fishingState;
  const beforeCatchId = gameState.currentResult?.catchId;
  gameState = Game.tick(gameState, Date.now(), Math.random, measurementMap, assets?.timings);
  if (gameState.fishingState === beforeState && gameState.currentResult?.catchId === beforeCatchId) return;
  if (gameState.fishingState === 'empty_reel' && gameState.currentResult?.type === 'random_unhook') { resultCardOverride = gameState.currentResult; showResult(); }
  else if (gameState.currentResult) resultCardOverride = null;
  saveGame(); broadcastAll();
  const catchId = gameState.currentResult?.catchId || gameState.currentResult?.eventId;
  if (gameState.fishingState === 'catch_land' && catchId && catchId !== lastResultCatchId) {
    lastResultCatchId = catchId; resultCardOverride = null; showResult();
  }
  updateTrayMenu();
}
function cornerIdForBounds(bounds) {
  if (!bounds) return null;
  const area = screen.getDisplayMatching(bounds).workArea;
  return PetLayout.cornerIdForBounds(bounds, area);
}
function movePet(bodyTargetX, y) {
  if (!petWindow || petWindow.isDestroyed()) return null;
  const current = petWindow.getBounds();
  const canonicalSize = petDisplaySize();
  const canonicalBounds = { ...current, ...canonicalSize };
  const metrics = petLayoutMetrics(canonicalBounds);
  const desiredBodyX = finite(bodyTargetX, metrics.bodyX);
  const display = screen.getDisplayNearestPoint({ x: Math.round(desiredBodyX + metrics.bodyWidth / 2), y: Math.round(finite(y, current.y) + canonicalSize.height / 2) });
  const area = display.workArea;
  const layout = PetLayout.layoutForBodyMove(desiredBodyX, metrics.bodyWidth, metrics.reserve, area, petToolSide);
  petToolSide = layout.side;
  const bounded = {
    x: Math.round(layout.windowX),
    y: Math.max(area.y, Math.min(Math.round(finite(y, current.y)), area.y + area.height - canonicalSize.height)),
    ...canonicalSize
  };
  // Always write the canonical size rather than feeding getBounds() back into
  // setBounds(). Mixed-DPI Windows can round a returned DIP width by one pixel;
  // recycling that value on every pointer move caused cumulative stretching.
  petWindow.setBounds(bounded);
  const moved = petWindow.getBounds();
  sendPetLayout();
  return { ...moved, toolSide: petToolSide, bodyX: Math.round(layout.bodyX) };
}
function adjacentBounds(size, preferred = 'right') {
  const pet = petWindow.getBounds();
  const area = screen.getDisplayMatching(pet).workArea;
  const right = pet.x + pet.width + 12;
  const left = pet.x - size.width - 12;
  let x = preferred === 'right' && right + size.width <= area.x + area.width ? right : left;
  if (x < area.x) x = Math.max(area.x, area.x + area.width - size.width);
  const y = Math.max(area.y, Math.min(pet.y + pet.height - size.height, area.y + area.height - size.height));
  return { x: Math.round(x), y: Math.round(y), width: size.width, height: size.height };
}
function resultBounds() {
  const pet = petBodyBounds();
  const size = resultDisplaySize();
  const area = screen.getDisplayMatching(pet).workArea;
  const above = pet.y - size.height - 8;
  let x = pet.x + Math.round((pet.width - size.width) / 2);
  let y = above;
  if (above < area.y) {
    y = pet.y + pet.height + 8;
  }
  x = Math.max(area.x, Math.min(x, area.x + area.width - size.width));
  y = Math.max(area.y, Math.min(y, area.y + area.height - size.height));
  return { x: Math.round(x), y: Math.round(y), ...size };
}
function repositionAdjacentWindows() {
  if (resultWindow?.isVisible()) resultWindow.setBounds(resultBounds());
}
async function showPanel(route) {
  const requestedRoute = route || { page: 'home' };
  const targetRoute = !AQUARIUM_ENABLED && String(requestedRoute.page || '').startsWith('aquarium') ? { page:'home' } : requestedRoute;
  const request = ++panelShowRequest;
  if (!panelWindow || panelWindow.isDestroyed() || panelReadiness?.failed) {
    if (panelWindow && !panelWindow.isDestroyed()) panelWindow.destroy();
    createPanelWindow();
  }
  const requestedWindow = panelWindow;
  try {
    await panelReadiness.promise;
    await new Promise(resolve => setImmediate(resolve));
    if (request !== panelShowRequest || requestedWindow !== panelWindow || requestedWindow.isDestroyed()) return { ok:true, cancelled:true };
    sendTo(requestedWindow, 'panel:navigate', targetRoute); broadcastAll();
    if (!requestedWindow.isVisible() && !loadWindowSettings().panel) requestedWindow.setBounds(adjacentBounds(PANEL_SIZE));
    if (requestedWindow.isMinimized()) requestedWindow.restore();
    requestedWindow.show();
    // Windows can apply the launcher's STARTUPINFO SW_HIDE to the first ShowWindow
    // call, even after Electron emits 'show'. Retry only if it is actually hidden.
    if (!requestedWindow.isVisible()) requestedWindow.show();
    if (!requestedWindow.isVisible()) throw new Error('信息面板未能显示，请重试');
    requestedWindow.focus();
    return { ok:true };
  } catch (error) {
    return { ok:false, reason:'panel-open-failed', message:error.message || '信息面板打开失败，请重试' };
  }
}
function togglePanel() { if (panelWindow?.isVisible()) panelWindow.hide(); else showPanel(); }
function showResult() {
  if (!resultWindow || resultWindow.isDestroyed()) createResultWindow();
  resultWindow.setBounds(resultBounds()); resultWindow.showInactive(); broadcastAll(); scheduleResultHide(RESULT_AUTO_HIDE_MS);
}
function hideResult() { clearTimeout(resultHideTimer); resultWindow?.hide(); return true; }
function scheduleResultHide(delay = RESULT_AUTO_HIDE_MS) { clearTimeout(resultHideTimer); resultHideTimer = setTimeout(hideResult, delay); }
function clearPetPresentationRecovery() {
  for (const timer of petPresentationRecoveryTimers) clearTimeout(timer);
  petPresentationRecoveryTimers.clear();
}
function restorePetPresentation() {
  if (isQuitting || petExplicitlyHidden || !petWindow || petWindow.isDestroyed()) return false;
  if (petWindow.isMinimized()) petWindow.restore();
  if (!petWindow.isVisible()) petWindow.showInactive();
  if (gameState.settings.alwaysOnTop) {
    // Full-screen screenshot overlays can leave a transparent Electron window
    // visible according to Chromium but behind the desktop compositor. Resetting
    // the topmost band repairs that stale Z-order without stealing focus.
    petWindow.setAlwaysOnTop(false);
    petWindow.moveTop();
    petWindow.setAlwaysOnTop(true, 'floating');
  }
  if (resultWindow?.isVisible()) {
    resultWindow.setAlwaysOnTop(false);
    resultWindow.moveTop();
    resultWindow.setAlwaysOnTop(true, 'floating');
  }
  return petWindow.isVisible();
}
function schedulePetPresentationRecovery() {
  if (isQuitting || petExplicitlyHidden) return;
  clearPetPresentationRecovery();
  for (const delay of PET_PRESENTATION_RECOVERY_DELAYS_MS) {
    const timer = setTimeout(() => {
      petPresentationRecoveryTimers.delete(timer);
      restorePetPresentation();
    }, delay);
    petPresentationRecoveryTimers.add(timer);
  }
}
function hidePet() {
  if (!petWindow?.isVisible()) return;
  petExplicitlyHidden = true;
  clearPetPresentationRecovery();
  gameState = Game.suspend(gameState); saveGame(); panelWindow?.hide(); hideResult(); petWindow.hide(); broadcastAll(); updateTrayMenu();
}
function showPet({ forceRefresh = false } = {}) {
  petExplicitlyHidden = false;
  clearPetPresentationRecovery();
  if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  if (gameState.isPaused) gameState = Game.resume(gameState);
  if (forceRefresh && petWindow.isVisible()) petWindow.hide();
  petWindow.showInactive();
  restorePetPresentation();
  saveGame(); broadcastAll(); updateTrayMenu();
}
function togglePet() { if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) hidePet(); else showPet(); }
function clearAquariumPresentationRecovery() {
  for (const timer of aquariumPresentationRecoveryTimers) clearTimeout(timer);
  aquariumPresentationRecoveryTimers.clear();
}
function restoreAquariumPresentation() {
  if (isQuitting || aquariumExplicitlyHidden || !aquariumWindow || aquariumWindow.isDestroyed()) return false;
  if (aquariumWindow.isMinimized()) aquariumWindow.restore();
  if (!aquariumWindow.isVisible()) aquariumWindow.showInactive();
  if (aquariumSettings().alwaysOnTop !== false) {
    aquariumWindow.setAlwaysOnTop(false);
    aquariumWindow.moveTop();
    aquariumWindow.setAlwaysOnTop(true, 'floating');
  }
  sendAquariumVisibility();
  return true;
}
function scheduleAquariumPresentationRecovery() {
  if (aquariumExplicitlyHidden || aquariumSettings().alwaysOnTop === false) return;
  clearAquariumPresentationRecovery();
  for (const delay of PET_PRESENTATION_RECOVERY_DELAYS_MS) {
    const timer = setTimeout(() => {
      aquariumPresentationRecoveryTimers.delete(timer);
      restoreAquariumPresentation();
    }, delay);
    aquariumPresentationRecoveryTimers.add(timer);
  }
}
function setAquariumVisibleSetting(visible) {
  const result = aquariumAction('set-setting', { visible: Boolean(visible) });
  return result.ok;
}
function hideAquarium({ persist = true } = {}) {
  aquariumExplicitlyHidden = true; clearAquariumPresentationRecovery();
  if (aquariumWindow && !aquariumWindow.isDestroyed()) aquariumWindow.hide();
  if (persist) setAquariumVisibleSetting(false);
  sendAquariumVisibility(); updateTrayMenu(); return true;
}
function showAquarium({ persist = true, forceRefresh = false } = {}) {
  if (!AQUARIUM_RUNTIME_ENABLED) return false;
  aquariumExplicitlyHidden = false; clearAquariumPresentationRecovery();
  if (!aquariumWindow || aquariumWindow.isDestroyed()) createAquariumWindow();
  aquariumExplicitlyHidden = false;
  if (forceRefresh && aquariumWindow.isVisible()) aquariumWindow.hide();
  aquariumWindow.showInactive(); restoreAquariumPresentation();
  if (persist) setAquariumVisibleSetting(true);
  sendAquariumLayout(); sendAquariumVisibility(); updateTrayMenu(); return true;
}
function toggleAquarium() {
  return aquariumWindow && !aquariumWindow.isDestroyed() && aquariumWindow.isVisible()
    ? hideAquarium() : showAquarium();
}
function setAquariumLock(locked, { persist = true } = {}) {
  const value = Boolean(locked);
  if (aquariumWindow && !aquariumWindow.isDestroyed()) aquariumWindow.setIgnoreMouseEvents(aquariumLayoutModeActive ? false : value, { forward: true });
  const operation = persist ? aquariumAction('set-setting', { inputLocked: value }) : { ok:true };
  if (!operation.ok && aquariumWindow && !aquariumWindow.isDestroyed()) aquariumWindow.setIgnoreMouseEvents(Boolean(aquariumSettings().inputLocked), { forward:true });
  updateTrayMenu(); return { ...operation, locked:operation.ok ? value : Boolean(aquariumSettings().inputLocked), snapshot:publicSnapshot() };
}
function setAquariumScale(rawScale, { persist = true } = {}) {
  if (!aquariumWindow || aquariumWindow.isDestroyed()) createAquariumWindow();
  const old = aquariumWindow.getBounds(); const display = screen.getDisplayMatching(old); const area = display.workArea;
  const next = AquariumWindow.displaySize(rawScale, area);
  const centerX = old.x + old.width / 2; const bottom = old.y + old.height;
  const bounds = AquariumWindow.clampBounds({ x:centerX-next.width/2, y:bottom-next.height, width:next.width, height:next.height }, area);
  aquariumWindow.setBounds(bounds); sendAquariumLayout(); scheduleWindowSettingsSave();
  if (persist) aquariumAction('set-setting', { scale:next.scale });
  return { ok:true, scale:next.scale, bounds, snapshot:publicSnapshot() };
}
function moveAquarium(x, y) {
  if (!aquariumWindow || aquariumWindow.isDestroyed()) return { ok:false, reason:'window-missing' };
  const current = aquariumWindow.getBounds(); const area = screen.getDisplayNearestPoint({ x:Math.round(finite(x,current.x)), y:Math.round(finite(y,current.y)) }).workArea;
  const next = AquariumWindow.movedBounds(finite(x,current.x), finite(y,current.y), aquariumSettings().scale, area);
  aquariumWindow.setBounds(next); sendAquariumLayout(); scheduleWindowSettingsSave(); return { ok:true, bounds:next };
}
function reclampAquariumWindow() {
  if (!aquariumWindow || aquariumWindow.isDestroyed()) return false;
  const current = aquariumWindow.getBounds(); const area = screen.getDisplayMatching(current).workArea;
  const size = AquariumWindow.displaySize(aquariumSettings().scale, area);
  aquariumWindow.setBounds(AquariumWindow.clampBounds({ ...current, width:size.width, height:size.height }, area));
  sendAquariumLayout(); scheduleWindowSettingsSave(); return true;
}
function createTrayIcon() {
  return require('./src/tray-icon').createTrayIcon(nativeImage, __dirname);
}
function updateTrayMenu() {
  if (!tray) return;
  const canCast = gameState.fishingState === 'idle';
  const biting = ['bite_intro', 'bite_loop', 'bite_urgent', 'bite_ready'].includes(gameState.fishingState);
  const canReel = ['waiting', 'casting'].includes(gameState.fishingState) || biting;
  const template = [
    { label: petWindow?.isVisible() ? '隐藏桌宠' : '显示桌宠', click: togglePet }
  ];
  if (AQUARIUM_RUNTIME_ENABLED) template.push(
    { label: aquariumWindow?.isVisible() ? '隐藏鱼缸' : '显示鱼缸', click: toggleAquarium },
    { label: aquariumSettings().inputLocked ? '解锁鱼缸交互' : '锁定鱼缸交互', click: () => setAquariumLock(!aquariumSettings().inputLocked) }
  );
  template.push(
    { label: '打开信息面板', click: () => showPanel() }, { type: 'separator' },
    { label: '抛竿', enabled: canCast, click: () => dispatch('cast', { corner: cornerIdForBounds(petBodyBounds()) }) },
    { label: biting ? '立即收杆' : '提前收杆', enabled: canReel, click: () => dispatch(biting ? 'reel' : 'early-reel') },
    { type: 'separator' }, { label: '退出', click: quitApp }
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
}
function createTray() { tray = new Tray(createTrayIcon()); tray.setToolTip(`摸鱼搭子 · ${ShortcutSettings.displayAccelerator(currentShortcuts.pet)}`); tray.on('click', togglePet); updateTrayMenu(); }
async function exportSave() {
  panelDialogOpen = true;
  const result = await dialog.showSaveDialog(panelWindow, { title: '导出摸鱼搭子存档', defaultPath: 'screen-fishing-save.json', filters: [{ name: 'JSON', extensions: ['json'] }] }).finally(() => { panelDialogOpen = false; });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  atomicWriteJson(result.filePath, gameState); return { ok: true, path: result.filePath };
}
async function importSave() {
  panelDialogOpen = true;
  const result = await dialog.showOpenDialog(panelWindow, { title: '导入摸鱼搭子存档', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] }).finally(() => { panelDialogOpen = false; });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const imported = readJson(result.filePaths[0]);
  if (!imported || typeof imported !== 'object') return { ok: false, error: '存档格式无效' };
  const backup = jsonPath(`screen-fishing-save.backup-${Date.now()}.json`);
  atomicWriteJson(backup, gameState); gameState = normalizeRuntimeState(imported);
  if (gameState.isPaused) gameState = Game.resume(gameState);
  saveGame({ allowProgressReset: true }); broadcastAll(); return { ok: true, backup };
}
function quitApp() {
  if (!gameState.isPaused) gameState = Game.suspend(gameState);
  saveGame(); saveWindowSettings(); isQuitting = true; app.quit();
}
function registerIpc() {
  ipcMain.handle('game:get', async () => {
    if (!IS_SMOKE && !IS_PACKAGE_VERIFY && !IS_SOAK && !IS_AQUARIUM_SMOKE) await refreshGameFromDisk('renderer-get');
    return publicSnapshot();
  });
  ipcMain.handle('game:action', (_event, action, payload) => dispatch(action, payload));
  ipcMain.handle('characters:action', characterAction);
  ipcMain.handle('game:economy', (_event, action, payload) => economyAction(action, payload));
  if (AQUARIUM_RUNTIME_ENABLED) ipcMain.handle('game:aquarium', (_event, action, payload) => aquariumAction(action, payload));
  ipcMain.handle('game:settings', (_event, patch) => applySettingPatch(patch));
  ipcMain.handle('game:preview-pet-scale', (_event, value) => applySettingPatch({ petScale: value }, { persist: false, broadcast: false }));
  ipcMain.handle('shortcut:update', (_event, kind, value) => updateShortcut(kind, value));
  ipcMain.handle('game:legacy-import', (_event, value) => {
    if (!value || gameState.castCount || gameState.history.length) return publicSnapshot();
    gameState = normalizeRuntimeState(value);
    if (gameState.isPaused) gameState = Game.resume(gameState);
    saveGame({ allowProgressReset: true }); broadcastAll(); return publicSnapshot();
  });
  ipcMain.handle('window:hide-pet', hidePet);
  ipcMain.handle('window:show-pet', showPet);
  ipcMain.handle('window:toggle-panel', togglePanel);
  ipcMain.handle('window:open-panel', (_event, route) => showPanel(route));
  ipcMain.handle('window:panel-ready', (event, value) => {
    if (!panelWindow || panelWindow.isDestroyed() || event.sender !== panelWindow.webContents) return false;
    panelReadiness?.rendered(value?.ok !== false);
    return true;
  });
  ipcMain.handle('window:close-panel', () => { panelShowRequest += 1; panelWindow?.hide(); });
  ipcMain.handle('window:move-pet', (_event, x, y) => movePet(x, y));
  ipcMain.handle('window:pet-bounds', () => petWindow?.getBounds());
  ipcMain.handle('window:set-click-through', (_event, ignore) => {
    if (!petWindow || petWindow.isDestroyed()) return false;
    petWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
    return true;
  });
  if (AQUARIUM_RUNTIME_ENABLED) {
    ipcMain.handle('aquarium:window:show', () => showAquarium());
    ipcMain.handle('aquarium:window:hide', () => hideAquarium());
    ipcMain.handle('aquarium:window:toggle', () => toggleAquarium());
    ipcMain.handle('aquarium:window:move', (_event, x, y) => moveAquarium(x, y));
    ipcMain.handle('aquarium:window:bounds', () => aquariumWindow && !aquariumWindow.isDestroyed() ? aquariumWindow.getBounds() : null);
    ipcMain.handle('aquarium:window:lock', (_event, locked) => setAquariumLock(locked));
    ipcMain.handle('aquarium:window:scale', (_event, scale) => setAquariumScale(scale));
  }
  ipcMain.handle('window:close-result', hideResult);
  ipcMain.handle('save:export', exportSave);
  ipcMain.handle('save:import', importSave);
  ipcMain.handle('window:quit', quitApp);
  ipcMain.handle('app:shortcut', () => publicSnapshot().app.shortcuts);
}
async function captureSmokePng(win, output) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // capturePage can otherwise return the compositor's previous surface
      // immediately after a route change. Two painted frames plus a short
      // settle keeps the visual artifact aligned with the DOM assertions.
      await win.capturePage();
      await new Promise((resolve) => setTimeout(resolve, 80));
      fs.writeFileSync(output, (await win.capturePage()).toPNG());
      return true;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
  process.stderr.write(`POND_SMOKE_CAPTURE_WARNING:${path.basename(output)}:${lastError?.message || 'capture failed'}\n`);
  return false;
}
function runSmokeTest() {
  setTimeout(async () => {
    petWindow.showInactive();
    const visibleBeforeHide = petWindow.isVisible();
    hidePet();
    const hiddenAfterHide = !petWindow.isVisible() && gameState.isPaused;
    showPet();
    const visibleAfterRestore = petWindow.isVisible() && !gameState.isPaused;
    petWindow.setAlwaysOnTop(false);
    petWindow.emit('blur');
    await new Promise((resolve) => setTimeout(resolve, PET_PRESENTATION_RECOVERY_DELAYS_MS[0] + 100));
    const presentationRecoveredAfterCaptureBlur = petWindow.isVisible() && petWindow.isAlwaysOnTop() && !gameState.isPaused;
    const preEdgeBounds = petWindow.getBounds();
    const preEdgeBodyX = petBodyBounds(preEdgeBounds).x;
    const edgeArea = screen.getDisplayMatching(preEdgeBounds).workArea;
    const edgeTargetBodyX = edgeArea.x + edgeArea.width - petLayoutMetrics(preEdgeBounds).bodyWidth;
    const edgeMove = movePet(edgeTargetBodyX, preEdgeBounds.y);
    const edgeLayoutFlipped = edgeMove.toolSide === 'left' && Math.abs(edgeMove.bodyX - edgeTargetBodyX) <= 1;
    const edgeFollowMove = movePet(edgeTargetBodyX - 1, preEdgeBounds.y);
    const edgeContinuousDrag = Math.abs(edgeFollowMove.bodyX - (edgeTargetBodyX - 1)) <= 1;
    const dragWidths = [];
    for (let index = 0; index < 12; index += 1) dragWidths.push(movePet(edgeTargetBodyX - (index % 2), preEdgeBounds.y).width);
    const edgeMovedBounds = petWindow.getBounds();
    const dragSizeInvariant = Math.max(...dragWidths) - Math.min(...dragWidths) <= 1
      && Math.max(...dragWidths) <= petDisplaySize().width + 1
      && edgeMovedBounds.height === petDisplaySize().height;
    const edgeBounds = petWindow.getBounds();
    movePet(preEdgeBodyX, preEdgeBounds.y);
    const beforeCornerState = gameState;
    gameState = Game.createInitialState();
    const cornerChecks = [];
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      gameState = { ...gameState, fishingState: 'idle', stateEndsAt: null, isPaused: false };
      const size = petDisplaySize();
      const targetX = corner.endsWith('left') ? edgeArea.x + 85 : edgeArea.x + edgeArea.width - 192 - 85;
      const targetY = corner.startsWith('top') ? edgeArea.y + 70 : edgeArea.y + edgeArea.height - size.height - 70;
      movePet(targetX, targetY);
      const cast = await petWindow.webContents.executeJavaScript("window.desktopPond.action('cast', {corner:'stale-renderer-value'})", true);
      cornerChecks.push(cast.ok && Object.hasOwn(gameState.cornerCasts, corner));
    }
    const achievementCornersRelaxed = cornerChecks.every(Boolean) && gameState.achievements.includes('corners');
    const achievementCornersCastAuthority = !Object.hasOwn(gameState.cornerCasts, 'stale-renderer-value')
      && Game.achievementProgress(Game.normalizeState(JSON.parse(JSON.stringify(gameState))), 'corners') === 4;
    const beforeFailureState = gameState;
    const beforeWriteAllowed = saveWriteAllowed;
    saveWriteAllowed = false;
    const failedPreferenceResults = [
      dispatch('achievement-track', { id: 'first-cast' }),
      dispatch('achievement-acknowledge'),
      dispatch('achievement-title', { id: '' })
    ];
    const achievementSaveFailureSafe = failedPreferenceResults.every(r => !r.ok && r.reason === 'persistence-failed')
      && gameState === beforeFailureState;
    saveWriteAllowed = beforeWriteAllowed;
    gameState = beforeCornerState;
    movePet(preEdgeBodyX, preEdgeBounds.y);
    saveGame(); broadcastAll();
    const stateBeforeActionSwitch = gameState;
    gameState = { ...gameState, fishingState: 'casting', stateStartedAt: Date.now(), stateEndsAt: Date.now() + 1000 };
    broadcastAll();
    const spriteVisibleDuringSwitch = await petWindow.webContents.executeJavaScript("!document.getElementById('sprite').hidden && getComputedStyle(document.getElementById('sprite')).backgroundImage !== 'none'", true);
    await new Promise((resolve) => setTimeout(resolve, 160));
    const switchedActionVisible = await petWindow.webContents.executeJavaScript("document.body.dataset.action === 'cast' && !document.getElementById('sprite').hidden", true);
    const noBlankDuringActionSwitch = spriteVisibleDuringSwitch && switchedActionVisible;
    gameState = stateBeforeActionSwitch;
    broadcastAll();
    const timerBeforeMenu = JSON.stringify({ stateEndsAt: gameState.stateEndsAt, biteDeadlineAt: gameState.biteDeadlineAt, fishingState: gameState.fishingState });
    const menuActionStartsAtFirstFrame = await petWindow.webContents.executeJavaScript("document.getElementById('petBody').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})); document.body.dataset.action === 'menu_greet' && document.body.dataset.actionFrame === '0'", true);
    await new Promise((resolve) => setTimeout(resolve, 220));
    const menuActionAdvanced = await petWindow.webContents.executeJavaScript("document.body.dataset.action === 'menu_greet' && Number(document.body.dataset.actionFrame) > 0", true);
    const menuActionOverride = menuActionStartsAtFirstFrame && menuActionAdvanced;
    const clickX = (petToolSide === 'left' ? petLayoutMetrics().reserve : 0) + 90;
    petWindow.webContents.sendInputEvent({ type: 'mouseDown', x: clickX, y: 100, button: 'left', clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    petWindow.webContents.sendInputEvent({ type: 'mouseUp', x: clickX, y: 100, button: 'left', clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const clickActionStartsAtFirstFrame = await petWindow.webContents.executeJavaScript("document.body.dataset.action === 'click_react' && document.body.dataset.actionFrame === '0'", true);
    const passiveClickFeedbackRemoved = await petWindow.webContents.executeJavaScript("document.getElementById('petFeedback').textContent === ''", true);
    await new Promise((resolve) => setTimeout(resolve, 190));
    const clickActionAdvanced = await petWindow.webContents.executeJavaScript("document.body.dataset.action === 'click_react' && Number(document.body.dataset.actionFrame) > 0", true);
    const visualOverridePreservedTimers = timerBeforeMenu === JSON.stringify({ stateEndsAt: gameState.stateEndsAt, biteDeadlineAt: gameState.biteDeadlineAt, fishingState: gameState.fishingState });
    const deprecatedSettingsRemoved = !Object.hasOwn(gameState.settings, 'reducedMotion') && !Object.hasOwn(gameState.settings, 'urgentMotion');
    const timerState = gameState;
    const timerStartedAt = Date.now() - 1400;
    gameState = { ...gameState, fishingState: 'waiting', stateStartedAt: timerStartedAt, stateEndsAt: Date.now() + 10000, castTimerStartedAt: timerStartedAt, castTimerElapsedMs: 0 };
    broadcastAll();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const castTimerVisible = await petWindow.webContents.executeJavaScript("!document.getElementById('castTimer').hidden && /^00:0[1-2]$/.test(document.getElementById('castTimer').textContent)", true);
    gameState = Game.applySettings(gameState, { showCastTimer: false });
    broadcastAll();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const castTimerToggleApplied = await petWindow.webContents.executeJavaScript("document.getElementById('castTimer').hidden", true);
    gameState = timerState;
    broadcastAll();
    const oldPetShortcut = currentShortcuts.pet;
    const shortcutUpdate = updateShortcut('pet', 'CommandOrControl+Alt+Shift+5');
    const shortcutUpdateApplied = shortcutUpdate.ok && globalShortcut.isRegistered('CommandOrControl+Alt+Shift+5') && !globalShortcut.isRegistered(oldPetShortcut);
    const shortcutDuplicateRejected = !updateShortcut('pet', currentShortcuts.panel).ok && globalShortcut.isRegistered('CommandOrControl+Alt+Shift+5');
    const navigationFish = Game.FISH[0];
    const navigationRareFish = Game.FISH.find((fish) => fish.rarity === 'rare');
    const navigationAt = Date.now();
    const navigationEntry = {
      catchId: 'smoke-history', id: 'smoke-history', at: navigationAt, resultId: navigationFish.id,
      name: navigationFish.name, type: 'fish', rarity: navigationFish.rarity, rarityName: navigationFish.rarityName,
      pack: navigationFish.pack, packName: navigationFish.packName, lengthCm: 12.3, weightKg: .12,
      size: '12.3 cm', weight: '120 g', first: true, recordLength: true, recordWeight: true,
      measurementVersion: 5, variant: 'iridescent', variantVersion: 1, probabilityVersion: 1,
      locked: true, autoLocked: true,
      valueCoins: Math.round(Game.calculateCatchValue(navigationFish, { lengthCm: 12.3, weightKg: .12 }, measurementMap[navigationFish.id]) * 8)
    };
    const rarityShowcase = ['rare', 'epic', 'legendary', 'mythic']
      .map((rarity) => Game.FISH.find((fish) => fish.rarity === rarity))
      .filter(Boolean);
    const smokeFish = [...new Map([navigationFish, ...rarityShowcase, ...Game.FISH].map((fish) => [fish.id, fish])).values()].slice(0, 18);
    const smokeInventory = smokeFish.map((fish, index) => {
      const lengthCm = 12.3 + index * 2;
      const weightKg = .12 + index * .04;
      const catchId = index === 0 ? navigationEntry.catchId : `smoke-inventory-${index}`;
      return {
        inventoryId: catchId, catchId, fishId: fish.id, resultId: fish.id,
        caughtAt: navigationAt - index * 1000, at: navigationAt - index * 1000,
        name: fish.name, rarity: fish.rarity, rarityName: fish.rarityName,
        pack: fish.pack, packName: fish.packName, lengthCm, weightKg,
        size: `${lengthCm.toFixed(1)} cm`, weight: Game.formatWeight(weightKg),
        measurementVersion: 5,
        variant: index === 0 ? 'iridescent' : ['normal', 'alternate', 'golden'][index % 3],
        variantVersion: 1, probabilityVersion: 1,
        locked: index === 0, autoLocked: index === 0,
        valueCoins: Math.round(Game.calculateCatchValue(fish, { lengthCm, weightKg }, measurementMap[fish.id]) * (index === 0 ? 8 : [1, 1.25, 3][index % 3]))
      };
    });
    gameState = {
      ...gameState,
      collection: {
        ...gameState.collection,
        [navigationFish.id]: { count: 1, firstAt: navigationAt, lastAt: navigationAt, maxLengthCm: 12.3, maxWeightKg: .12,
          variants: { normal: { count: 0, firstAt: null, maxLengthCm: 0, maxWeightKg: 0 }, alternate: { count: 0, firstAt: null, maxLengthCm: 0, maxWeightKg: 0 }, golden: { count: 0, firstAt: null, maxLengthCm: 0, maxWeightKg: 0 }, iridescent: { count: 1, firstAt: navigationAt, maxLengthCm: 12.3, maxWeightKg: .12 } } },
        [navigationRareFish.id]: { count: 1, firstAt: navigationAt, lastAt: navigationAt, maxLengthCm: 8.4, maxWeightKg: .04 }
      },
      history: [navigationEntry],
      inventory: smokeInventory,
      wallet: { balance: 20000, totalEarned: 0, totalSpent: 0 },
      ownedPacks: ['F1'], activeHabitat: 'freshwater',
      stats: { ...gameState.stats, totalCatchCount: 2, uniqueSpeciesCount: 2, rarity: { ...gameState.stats.rarity, [navigationFish.rarity]: 1, [navigationRareFish.rarity]: 1 }, packs: { ...gameState.stats.packs, [navigationFish.pack]: 2 }, packUnique: { ...gameState.stats.packUnique, [navigationFish.pack]: 2 } }
    };
    broadcastAll();
    showPanel();
    for (let attempt = 0; attempt < 30 && (!panelWindow.isVisible() || panelWindow.webContents.isLoadingMainFrame()); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const panelFirstOpenRendered = panelWindow.isVisible() && await panelWindow.webContents.executeJavaScript("Boolean(document.querySelector('.home-stats'))", true);
    panelWindow.blur();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const panelPersistsAfterBlur = panelWindow.isVisible();
    panelWindow.focus();
    const panelBounds = panelWindow.getBounds();
    panelWindow.setSize(800, 500);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const panelResizeBounds = panelWindow.getBounds();
    // Windows fractional DPI conversion may round an outer DIP bound by 1 px.
    const panelFreeResizeValid = Math.abs(panelResizeBounds.width - 800) <= 2 && Math.abs(panelResizeBounds.height - 500) <= 2;
    panelWindow.setSize(panelBounds.width, panelBounds.height);
    let homeAndCatalogScreenshots = false;
    let catalogKeyboardNavigation = false;
    let catalogNavigationRestored = false;
    let catalogScrollBounds = null;
    let visualMatrixScreenshots = false;
    let scaleSliderContinuous = false;
    let homeStatsCompact = false;
    let catalogGrouped = false;
    let catalogLongFishFit = false;
    let catalogRarityLabelsColored = false;
    let warehouseContract = false;
    let warehouseScrollPreserved = false;
    let warehouseSaleFlow = false;
    let shopContract = false;
    let settingsPackSelectorRemoved = false;
    let equipmentSettingsContract = false;
    let historyWeightPreserved = false;
    let sceneMenuContract = false;
    let habitatSwitchWorks = false;
    let variantManifestContract = false;
    let variantCatalogContract = false;
    let variantDetailContract = false;
      let variantWarehouseContract = false;
      let variantLockContract = false;
      let variantVisualScreenshots = false;
      let sharedToolbarContract = false;
      let catalogToolbarContract = false;
      let warehouseToolbarContract = false;
      let aquariumToolbarContract = false;
      let sharedSortDirectionContract = false;
      let catalogSearchFocusPreserved = false;
      let catalogVariantFilterContract = false;
      let aquariumWindowToggleContract = false;
      let multiTankUiContract = false;
      let tankHabitatCleanupContract = false;
      let layoutPreviewParity = false;
      const uiDebugBounds = {};
    try {
      const artifacts = path.join(__dirname, 'artifacts');
      fs.mkdirSync(artifacts, { recursive: true });
      sendTo(panelWindow, 'panel:navigate', { page: 'home' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const homeCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-home-1.0-smoke.png'));
      homeStatsCompact = await panelWindow.webContents.executeJavaScript(`(() => {
        const cards = [...document.querySelectorAll('.home-card')];
        const titles = cards.map((card) => card.querySelector('strong')?.textContent.trim());
        return document.querySelectorAll('.home-stats .stat').length === 3
          && !document.querySelector('.home-stats').textContent.includes('水草浅湾')
          && cards.length === 9 && titles.includes('角色库') && !document.querySelector('[data-action=hide-pet]') && cards.every((card) => !card.querySelector('small'))
          && titles.indexOf('特殊事件') + 1 === titles.indexOf('成就')
          && document.querySelector('.page-balance')?.textContent.includes('金币')
          && document.querySelector('.page-header h1')?.textContent.trim() === '个人记录'
          && document.querySelector('.page-header small')?.textContent.includes('最长记录')
          && document.querySelector('.page-header small')?.textContent.includes('最沉记录');
      })()`, true);
      sendTo(panelWindow, 'panel:navigate', { page: 'encyclopedia' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const catalogCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-catalog-1.0-smoke.png'));
      homeAndCatalogScreenshots = homeCaptured && catalogCaptured;
      catalogToolbarContract = await panelWindow.webContents.executeJavaScript(`(() => {
        const toolbar = document.querySelector('.unified-list-toolbar');
        return Boolean(toolbar)
          && toolbar.querySelectorAll('[data-action=list-sort][data-list-scope=catalog]').length === 1
          && toolbar.querySelector('[data-action=list-sort][data-list-scope=catalog][data-sort-mode=catalog]')
          && Boolean(toolbar.querySelector('[data-action=list-filter-toggle][data-list-scope=catalog]'))
          && Boolean(toolbar.querySelector('[data-list-search=catalog]'));
      })()`, true);
      sharedSortDirectionContract = await panelWindow.webContents.executeJavaScript(`(() => {
        const button = () => document.querySelector('[data-action=list-sort][data-list-scope=catalog][data-sort-mode=catalog]');
        button().click(); const catalogDown = button().textContent.trim().endsWith('↓');
        button().click(); const catalogUp = button().textContent.trim().endsWith('↑');
        return catalogDown && catalogUp;
      })()`, true);
      await panelWindow.webContents.executeJavaScript(`(() => { const input = document.querySelector('[data-list-search=catalog]'); input.focus(); input.value = '${navigationFish.name.slice(0, 1)}'; input.dispatchEvent(new InputEvent('input', { bubbles:true, data:'${navigationFish.name.slice(0, 1)}' })); })()`, true);
      await new Promise((resolve) => setTimeout(resolve, 30));
      catalogSearchFocusPreserved = await panelWindow.webContents.executeJavaScript(`document.activeElement?.dataset.listSearch === 'catalog' && document.activeElement.value === '${navigationFish.name.slice(0, 1)}' && document.querySelectorAll('.fish-catalog-card').length >= 1`, true);
      uiDebugBounds.catalogSearch = await panelWindow.webContents.executeJavaScript("({ active: document.activeElement?.dataset.listSearch || document.activeElement?.tagName, value: document.querySelector('[data-list-search=catalog]')?.value, cards: document.querySelectorAll('.fish-catalog-card').length })", true);
      await panelWindow.webContents.executeJavaScript("(() => { const input = document.querySelector('[data-list-search=catalog]'); input.value = ''; input.dispatchEvent(new InputEvent('input', { bubbles:true })); })()", true);
      catalogGrouped = await panelWindow.webContents.executeJavaScript(`(() => {
        const root = document.querySelector('.catalog-pack-list');
        const sections = [...document.querySelectorAll('[data-catalog-pack]')];
        const rank = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
        const ordered = sections.every((section) => {
          const values = [...section.querySelectorAll('.icon-card')].map((card) => {
            const rarityClass = [...card.classList].find((name) => name.startsWith('rarity-'));
            return rank[rarityClass?.slice(7)] ?? 99;
          });
          return values.every((value, index) => index === 0 || values[index - 1] <= value);
        });
        return root?.dataset.catalogOrder === 'F1,F2,S1,S2'
          && sections.map((section) => section.dataset.catalogPack).join(',') === 'F1,F2,S1,S2'
          && sections.every((section) => section.querySelectorAll('.icon-card').length === 38)
          && ordered
          && !/fish-\\d+/i.test(document.getElementById('app').textContent);
      })()`, true);
      uiDebugBounds.catalogLongFish = await panelWindow.webContents.executeJavaScript(`(() => {
        const checks = [['fish-50', 0.84], ['fish-52', 0.84], ['fish-97', 0.68], ['fish-107', 0.74]];
        const referenceCard = document.querySelector('.fish-catalog-card');
        const referenceBox = referenceCard?.getBoundingClientRect();
        return checks.map(([fishId, expectedScale]) => {
          const card = document.querySelector('[data-fish="' + fishId + '"]');
          const frame = card?.querySelector('.fish-frame');
          if (!card || !frame || !referenceBox) return { fishId, expectedScale, found: false };
          const cardBox = card.getBoundingClientRect();
          const scale = Number(card.dataset.catalogScale);
          const art = frame.querySelector(':scope > img, :scope > .pearl-layer');
          return { fishId, expectedScale, found: true, scale, cardWidth: cardBox.width, cardHeight: cardBox.height,
            frameCompact: frame.classList.contains('catalog-compact-art'), transform: art ? getComputedStyle(art).transform : '',
            cardSizeUnchanged: Math.abs(cardBox.width - referenceBox.width) < 0.5 && Math.abs(cardBox.height - referenceBox.height) < 0.5 };
        });
      })()`, true);
      catalogLongFishFit = uiDebugBounds.catalogLongFish.every((item) => item.found
        && Math.abs(item.scale - item.expectedScale) < 0.001
        && item.cardSizeUnchanged
        && (!item.frameCompact || item.transform !== 'none'));
      catalogRarityLabelsColored = await panelWindow.webContents.executeJavaScript(`(() => {
        const card = document.querySelector('[data-fish="${navigationRareFish.id}"]');
        const name = card?.querySelector('.card-name');
        const rarity = card?.querySelector('.catalog-rarity-band');
        const status = card?.querySelector('.variant-label');
        if (!card || !name || !rarity || !status) return false;
        const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
        const rarityColor = getComputedStyle(card).getPropertyValue('--rarity').trim();
        const probe = document.createElement('i'); document.body.appendChild(probe);
        probe.style.color = rarityColor; const rarityRgb = getComputedStyle(probe).color;
        probe.style.color = muted; const mutedRgb = getComputedStyle(probe).color; probe.remove();
        return getComputedStyle(card).borderColor === rarityRgb
          && getComputedStyle(rarity).backgroundColor === rarityRgb
          && getComputedStyle(name).color === mutedRgb
          && !status.textContent.includes('变体 ·')
          && /^已发现 [0-9]+\\/4 变体$/.test(status.textContent.trim());
      })()`, true);
      variantManifestContract = assets?.diagnostics?.variants?.valid === true
        && assets.diagnostics.variants.coverage?.entries === 152
        && assets.diagnostics.variants.coverage?.variants === 608;
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=list-filter-toggle][data-list-scope=catalog]').click()", true);
      for (const packId of ['F2', 'S1', 'S2']) {
        await panelWindow.webContents.executeJavaScript(`document.querySelector('[data-list-scope=catalog][data-list-field=packs][value=${packId}]').click()`, true);
      }
      for (const variantId of ['normal', 'alternate', 'golden']) {
        await panelWindow.webContents.executeJavaScript(`document.querySelector('[data-list-scope=catalog][data-list-field=variants][value=${variantId}]').click()`, true);
      }
      let variantCatalogVisible = false;
      for (let attempt = 0; attempt < 12 && !variantCatalogVisible; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        variantCatalogVisible = await panelWindow.webContents.executeJavaScript("document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches || Boolean(document.querySelector('[data-fish=\"fish-1\"] .variant-iridescent.is-visible'))", true);
      }
      variantCatalogContract = variantCatalogVisible && await panelWindow.webContents.executeJavaScript(`(() => {
        const card = document.querySelector('[data-fish="${navigationFish.id}"]');
        const frame = card?.querySelector('.variant-iridescent');
        return document.querySelector('[data-list-scope=catalog][data-list-field=variants][value=iridescent]')?.checked
          && card?.dataset.locked === 'false'
          && frame?.querySelectorAll('.pearl-layer').length === 3
          && !frame.querySelector('.unknown-fish');
      })()`, true);
      catalogVariantFilterContract = await panelWindow.webContents.executeJavaScript(`(() => {
        const selected = [...document.querySelectorAll('[data-list-scope=catalog][data-list-field=variants]')].filter((input) => input.checked).map((input) => input.value);
        const cards = [...document.querySelectorAll('.fish-catalog-card')];
        return selected.join(',') === 'iridescent' && cards.length === 38 && cards.every((card) => card.dataset.variant === 'iridescent');
      })()`, true);
      variantVisualScreenshots = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-catalog-iridescent-1.3-smoke.png'));
      for (const variantId of ['normal', 'alternate', 'golden']) {
        await panelWindow.webContents.executeJavaScript(`document.querySelector('[data-list-scope=catalog][data-list-field=variants][value=${variantId}]').click()`, true);
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
      catalogKeyboardNavigation = await panelWindow.webContents.executeJavaScript(`(() => {
        const cards = [...document.querySelectorAll('.catalog-grid .icon-card')];
        cards[0]?.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        return cards.indexOf(document.activeElement) === 1;
      })()`, true);
      await panelWindow.webContents.executeJavaScript(`(() => {
        const app = document.getElementById('app');
        app.scrollTop = Math.min(120, Math.max(1, app.scrollHeight - app.clientHeight));
        document.querySelector('[data-fish="${Game.FISH[0].id}"]').click();
      })()`, true);
      await new Promise((resolve) => setTimeout(resolve, 60));
      variantDetailContract = await panelWindow.webContents.executeJavaScript(`(() => {
        const cards = [...document.querySelectorAll('.variant-detail-card')];
        const iridescent = document.querySelector('[data-detail-variant="iridescent"]');
        return cards.length === 4
          && cards.map((card) => card.dataset.detailVariant).join(',') === 'normal,alternate,golden,iridescent'
          && iridescent?.classList.contains('found')
          && iridescent.querySelectorAll('.pearl-layer').length === 3
          && iridescent.textContent.includes('首次')
          && iridescent.textContent.includes('次数');
      })()`, true);
      let matrixCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-fish-detail-1.0-smoke.png'));
      await panelWindow.webContents.executeJavaScript("document.getElementById('app').scrollTop = document.getElementById('app').scrollHeight", true);
      await new Promise((resolve) => setTimeout(resolve, 80));
      matrixCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-fish-variant-detail-1.3-smoke.png')) && matrixCaptured;
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=back]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 60));
      catalogScrollBounds = await panelWindow.webContents.executeJavaScript("({ onlyF1: [...document.querySelectorAll('[data-list-scope=catalog][data-list-field=packs]')].filter((input) => input.checked).map((input) => input.value).join(',') === 'F1', scrollTop: document.getElementById('app').scrollTop, scrollHeight: document.getElementById('app').scrollHeight, clientHeight: document.getElementById('app').clientHeight })", true);
      catalogNavigationRestored = catalogScrollBounds.onlyF1 && catalogScrollBounds.scrollTop > 0;
      sendTo(panelWindow, 'panel:navigate', { page: 'warehouse' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const warehouseToolbarReport = await panelWindow.webContents.executeJavaScript(`(() => {
        const scope = 'warehouse'; const toolbar = document.querySelector('.unified-list-toolbar');
        const toggle = () => document.querySelector('[data-action=list-sort-toggle][data-list-scope=warehouse]');
        toggle().click();
        const menuOptions = document.querySelectorAll('[data-action=list-sort-option][data-list-scope=warehouse]').length;
        document.querySelector('[data-action=list-sort-option][data-list-scope=warehouse][data-sort-mode=capture]').click();
        const presence = Boolean(toolbar) && Boolean(toggle()) && menuOptions === 4;
        const directions = ['capture','catalog','rarity','variant'].every((mode) => {
          toggle().click(); document.querySelector('[data-action=list-sort-option][data-list-scope=warehouse][data-sort-mode=' + mode + ']').click();
          const first = toggle().textContent.trim().match(/[↑↓]/)?.[0];
          toggle().click(); document.querySelector('[data-action=list-sort-option][data-list-scope=warehouse][data-sort-mode=' + mode + ']').click();
          const second = toggle().textContent.trim().match(/[↑↓]/)?.[0];
          return Boolean(first && second && first !== second && !document.querySelector('.list-sort-menu'));
        });
        document.querySelector('[data-action=list-filter-toggle][data-list-scope=warehouse]').click();
        const before = document.querySelectorAll('.inventory-card').length;
        document.querySelector('[data-list-scope=warehouse][data-list-field=packs][value=F1]').click();
        const filteredCards = [...document.querySelectorAll('.inventory-card')];
        const filtered = filteredCards.length < before && filteredCards.every((card) => card.dataset.pack !== 'F1');
        document.querySelector('[data-list-scope=warehouse][data-list-field=packs][value=F1]').click();
        const input = document.querySelector('[data-list-search=warehouse]'); input.value = '${navigationFish.name}'; input.dispatchEvent(new InputEvent('input', { bubbles:true }));
        const searched = document.querySelectorAll('.inventory-card').length >= 1 && [...document.querySelectorAll('.inventory-card .card-name')].every((node) => node.textContent.includes('${navigationFish.name}'));
        const reset = document.querySelector('[data-list-search=warehouse]'); reset.value = ''; reset.dispatchEvent(new InputEvent('input', { bubbles:true }));
        return { presence, directions, filtered, searched, restored:document.querySelectorAll('.inventory-card').length === 18 };
      })()`, true);
      warehouseToolbarContract = Object.values(warehouseToolbarReport).every(Boolean);
      uiDebugBounds.warehouseToolbar = warehouseToolbarReport;
      const warehouseLayout = await panelWindow.webContents.executeJavaScript(`(() => {
        const grid = document.querySelector('.inventory-grid');
        const cards = [...document.querySelectorAll('.inventory-card')];
        const rarityMap = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说', mythic: '神话' };
        return {
          cards: cards.length,
          columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
          balance: document.querySelector('.page-header .page-balance')?.textContent || '',
          hasValues: [...document.querySelectorAll('.inventory-value')].every((node) => node.textContent.includes('金币')),
          allStructured: cards.every((card) => {
            const rarityClass = [...card.classList].find((name) => name.startsWith('rarity-'));
            const rarity = rarityClass?.slice(7);
            const variant = card.dataset.variant;
            const variantFooter = card.querySelector('.inventory-variant');
            return card.querySelector('.inventory-rarity')?.textContent.trim() === rarityMap[rarity]
              && variantFooter?.querySelector('strong')?.textContent.trim() === ({ normal: '原色', alternate: '异色', golden: '纯金', iridescent: '炫彩' })[variant]
              && variantFooter.childElementCount === 1
              && !variantFooter.textContent.includes('异色模板')
              && getComputedStyle(variantFooter).justifyContent === 'center'
              && card.querySelector('.card-name')?.classList.contains('variant-text-' + variant)
              && !card.querySelector('.variant-corner');
          }),
          variants: [...new Set(cards.map((card) => card.dataset.variant))].sort().join(','),
          rarities: [...new Set(cards.map((card) => [...card.classList].find((name) => name.startsWith('rarity-'))?.slice(7)))].sort().join(','),
          rarityFrames: cards.every((card) => {
            const rarityColor = getComputedStyle(card).getPropertyValue('--rarity').trim();
            const probe = document.createElement('i'); probe.style.color = rarityColor; document.body.appendChild(probe);
            const rarityRgb = getComputedStyle(probe).color; probe.remove();
            return getComputedStyle(card).boxShadow.includes(rarityRgb)
              && getComputedStyle(card.querySelector('.inventory-rarity')).backgroundColor === rarityRgb;
          })
        };
      })()`, true);
      warehouseContract = warehouseLayout.cards === 18 && warehouseLayout.columns >= 2 && warehouseLayout.balance.includes('20,000')
        && warehouseLayout.hasValues && warehouseLayout.allStructured && warehouseLayout.rarityFrames
        && warehouseLayout.variants === 'alternate,golden,iridescent,normal'
        && warehouseLayout.rarities === 'common,epic,legendary,mythic,rare';
      variantWarehouseContract = await panelWindow.webContents.executeJavaScript(`(() => {
        const card = document.querySelector('[data-inventory="${navigationEntry.catchId}"]');
        const sort = document.querySelector('[data-action=list-sort-toggle][data-list-scope=warehouse]');
        return Boolean(card?.querySelector('.variant-iridescent'))
          && card?.querySelectorAll('.pearl-layer').length === 3
          && Boolean(card?.querySelector('.lock-corner'))
          && getComputedStyle(card.querySelector('.card-name')).backgroundImage.includes('linear-gradient')
          && getComputedStyle(card.querySelector('.card-name')).textShadow === 'none'
          && getComputedStyle(card.querySelector('.inventory-variant strong')).webkitTextFillColor === 'rgba(0, 0, 0, 0)'
          && Boolean(sort);
      })()`, true);
      await panelWindow.webContents.executeJavaScript(`document.querySelector('[data-inventory="${navigationEntry.catchId}"]').click()`, true);
      await new Promise((resolve) => setTimeout(resolve, 70));
      const lockedDetail = await panelWindow.webContents.executeJavaScript("Boolean(document.querySelector('.protected-note')) && document.querySelector('[data-action=sell-detail]').disabled", true);
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=toggle-lock]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const unlockedDetail = await panelWindow.webContents.executeJavaScript("!document.querySelector('.protected-note') && !document.querySelector('[data-action=sell-detail]').disabled", true);
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=toggle-lock]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 120));
      variantLockContract = lockedDetail && unlockedDetail && gameState.inventory.find((entry) => entry.inventoryId === navigationEntry.catchId)?.locked === true;
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=back]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 70));
      await new Promise((resolve) => setTimeout(resolve, 300));
      matrixCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-warehouse-1.1-smoke.png')) && matrixCaptured;
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=toggle-bulk]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const warehouseScrollBefore = await panelWindow.webContents.executeJavaScript("(() => { const app = document.getElementById('app'); app.scrollTop = Math.min(260, app.scrollHeight - app.clientHeight); return app.scrollTop; })()", true);
      await new Promise((resolve) => setTimeout(resolve, 40));
      await panelWindow.webContents.executeJavaScript("document.querySelectorAll('.inventory-card')[10].click()", true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const warehouseScrollAfter = await panelWindow.webContents.executeJavaScript("document.getElementById('app').scrollTop", true);
      warehouseScrollPreserved = warehouseScrollBefore > 0 && warehouseScrollAfter >= warehouseScrollBefore - 2;
      await panelWindow.webContents.executeJavaScript("document.querySelectorAll('.inventory-card')[11].click(); document.querySelector('[data-action=confirm-bulk-sale]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const saleConfirmationComplete = await panelWindow.webContents.executeJavaScript("document.getElementById('detailModal').open && document.querySelectorAll('.sale-confirm-list li').length === 2 && document.querySelector('.confirm-total')?.textContent.includes('2 条鱼')", true);
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-modal-action=confirm-sale]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 180));
      warehouseSaleFlow = saleConfirmationComplete && gameState.inventory.length === 16 && gameState.wallet.balance > 20000;
      gameState = { ...gameState, wallet: { ...gameState.wallet, balance: 50000 } };
      broadcastAll();
      sendTo(panelWindow, 'panel:navigate', { page: 'shop' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const shopBefore = await panelWindow.webContents.executeJavaScript(`(() => {
        const f2 = document.querySelector('[data-buy-pack=F2]');
        const s1 = document.querySelector('[data-buy-pack=S1]');
        const s2 = document.querySelector('[data-buy-pack=S2]');
        const autoRod=document.querySelector('[data-buy-equipment=auto-cast-rod]');
        const fresh=document.querySelector('[data-buy-equipment=bait-fresh]');
        const moon=document.querySelector('[data-buy-equipment=bait-moon]');
        const star=document.querySelector('[data-buy-equipment=bait-star]');
        return { cards: document.querySelectorAll('.shop-card').length, sections:document.querySelectorAll('.shop-section').length, owned: document.querySelectorAll('.shop-card.owned').length,
          buys: document.querySelectorAll('[data-buy-pack]').length, f2Enabled: !f2.disabled,
          equipmentBuys:document.querySelectorAll('[data-buy-equipment]').length, firstEquipmentEnabled:!autoRod.disabled&&!fresh.disabled,
          laterEquipmentDisabled:moon.disabled&&star.disabled, squareIcons:[...document.querySelectorAll('.shop-icon-frame')].every(n=>Math.abs(n.getBoundingClientRect().width-n.getBoundingClientRect().height)<1),
          vertical:[...document.querySelectorAll('.shop-card')].every(n=>n.querySelector('.shop-icon-frame').getBoundingClientRect().bottom<=n.querySelector('h3').getBoundingClientRect().top+1),
          laterDisabled: s1.disabled && s2.disabled, prerequisiteText: s1.textContent.includes('需先解锁') && s2.textContent.includes('需先解锁') };
      })()`, true);
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-buy-pack=F2]').click(); document.querySelector('[data-modal-action=confirm-pack]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 180));
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-buy-pack=S1]').click(); document.querySelector('[data-modal-action=confirm-pack]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 180));
      for (const equipmentId of ['auto-cast-rod','bait-fresh','bait-moon','bait-star']) {
        await panelWindow.webContents.executeJavaScript(`document.querySelector('[data-buy-equipment=${equipmentId}]').click(); document.querySelector('[data-modal-action=confirm-equipment]').click()`, true);
        await new Promise((resolve) => setTimeout(resolve, 140));
      }
      shopContract = shopBefore.cards === 8 && shopBefore.sections === 2 && shopBefore.owned === 1 && shopBefore.buys === 3
        && shopBefore.equipmentBuys === 4 && shopBefore.firstEquipmentEnabled && shopBefore.laterEquipmentDisabled && shopBefore.squareIcons && shopBefore.vertical
        && shopBefore.f2Enabled && shopBefore.laterDisabled && shopBefore.prerequisiteText
        && gameState.ownedPacks.includes('F2') && gameState.ownedPacks.includes('S1')
        && Game.EQUIPMENT_ORDER.every((id)=>gameState.equipment.ownedIds.includes(id))
        && gameState.equipment.activeBaitId === 'bait-star' && gameState.settings.autoCastEnabled
        && gameState.wallet.totalSpent === Game.getPackPrice('F2') + Game.getPackPrice('S1') + Game.EQUIPMENT_ORDER.reduce((sum,id)=>sum+Game.EQUIPMENT_DEFINITIONS[id].priceCoins,0);
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=shop-tab][data-tab=aquarium]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 60));
      const tanksBeforePurchase = gameState.aquarium.tankInstances.length;
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=aquarium-buy-item][data-item=tank-basic]').click(); document.querySelector('[data-modal-action=confirm-aquarium-item]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const createdTankId = gameState.aquarium.activeTankId;
      const tankPurchaseWorked = gameState.aquarium.tankInstances.length === tanksBeforePurchase + 1
        && gameState.aquarium.tankInstances.some((tank) => tank.tankId === createdTankId && tank.skinId === 'tank-basic');
      sendTo(panelWindow, 'panel:navigate', { page: 'aquarium' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const aquariumToolbarReport = await panelWindow.webContents.executeJavaScript(`(() => {
        const scope = 'aquarium'; const toolbar = document.querySelector('.aquarium-manager-grid .unified-list-toolbar');
        const presence = Boolean(toolbar) && toolbar.querySelectorAll('[data-action=list-sort][data-list-scope=aquarium]').length === 4;
        const directions = ['capture','catalog','rarity','variant'].every((mode) => {
          document.querySelector('[data-action=list-sort][data-list-scope=' + scope + '][data-sort-mode=' + mode + ']').click();
          const first = document.querySelector('[data-action=list-sort][data-list-scope=' + scope + '][data-sort-mode=' + mode + ']').textContent.trim();
          document.querySelector('[data-action=list-sort][data-list-scope=' + scope + '][data-sort-mode=' + mode + ']').click();
          const second = document.querySelector('[data-action=list-sort][data-list-scope=' + scope + '][data-sort-mode=' + mode + ']').textContent.trim();
          return /[↑↓]$/.test(first) && /[↑↓]$/.test(second) && first.slice(-1) !== second.slice(-1);
        });
        document.querySelector('[data-action=list-filter-toggle][data-list-scope=aquarium]').click();
        const before = document.querySelectorAll('[data-action=aquarium-place-fish]').length;
        document.querySelector('[data-list-scope=aquarium][data-list-field=packs][value=F1]').click();
        const filteredCards = [...document.querySelectorAll('.aquarium-fish-card')];
        const filtered = filteredCards.length < before && filteredCards.every((card) => card.dataset.pack !== 'F1');
        document.querySelector('[data-list-scope=aquarium][data-list-field=packs][value=F1]').click();
        const input = document.querySelector('[data-list-search=aquarium]'); input.value = '${navigationFish.name}'; input.dispatchEvent(new InputEvent('input', { bubbles:true }));
        const searched = document.querySelectorAll('[data-action=aquarium-place-fish]').length >= 1;
        const reset = document.querySelector('[data-list-search=aquarium]'); reset.value = ''; reset.dispatchEvent(new InputEvent('input', { bubbles:true }));
        return { presence, directions, hasInventory:before > 0, filtered, searched };
      })()`, true);
      aquariumToolbarContract = Object.values(aquariumToolbarReport).every(Boolean);
      uiDebugBounds.aquariumToolbar = aquariumToolbarReport;
      matrixCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-aquarium-management-1.5-smoke.png')) && matrixCaptured;
      multiTankUiContract = tankPurchaseWorked && await panelWindow.webContents.executeJavaScript(`(() => {
        const cards = [...document.querySelectorAll('[data-action=aquarium-select-tank]')];
        const active = cards.find((card) => card.getAttribute('aria-pressed') === 'true');
        return cards.length === ${tanksBeforePurchase + 1} && active?.dataset.tankId === '${createdTankId}'
          && cards.every((card, index) => card.textContent.includes('鱼缸' + (index + 1)))
          && document.querySelector('[data-page=aquarium-layout]').dataset.tankId === '${createdTankId}';
      })()`, true);
      hideAquarium(); await new Promise((resolve) => setTimeout(resolve, 80));
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=aquarium-toggle-window]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const aquariumShownByPanel = aquariumWindow.isVisible();
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=aquarium-toggle-window]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 120));
      aquariumWindowToggleContract = aquariumShownByPanel && !aquariumWindow.isVisible();
      const placedInventoryId = await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=aquarium-place-fish]').dataset.inventory", true);
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=aquarium-place-fish]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=aquarium-tank-habitat][data-habitat=saltwater]').click(); document.querySelector('[data-modal-action=confirm-tank-habitat]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const switchedTank = gameState.aquarium.tankInstances.find((tank) => tank.tankId === createdTankId);
      tankHabitatCleanupContract = switchedTank?.habitat === 'saltwater'
        && !switchedTank.fish.some((entry) => entry.inventoryId === placedInventoryId)
        && !gameState.inventory.find((entry) => entry.inventoryId === placedInventoryId)?.displayLock;
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-action=aquarium-tank-habitat][data-habitat=freshwater]').click(); document.querySelector('[data-modal-action=confirm-tank-habitat]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-page=aquarium-layout]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await panelWindow.webContents.executeJavaScript("(() => { const substrate = document.querySelector('[data-layout-slot=substrateId]'); substrate.value = 'substrate-river-sand'; substrate.dispatchEvent(new Event('change', { bubbles:true })); })()", true);
      for (let attempt = 0; attempt < 20 && !layoutPreviewParity; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        layoutPreviewParity = await panelWindow.webContents.executeJavaScript(`(() => {
          const outer = document.getElementById('layoutPreview')?.getBoundingClientRect();
          const water = document.getElementById('layoutWaterPreview')?.getBoundingClientRect();
          const substrate = document.querySelector('[data-preview-fixed-kind=substrate]');
          const substrateRect = substrate?.getBoundingClientRect();
          const slices = [...document.querySelectorAll('[data-skin-slice]')];
          return outer && water && Math.abs(outer.width / outer.height - 512 / 288) < .02
            && Math.abs(water.width / water.height - 448 / 192) < .02
            && substrate?.querySelector('[data-alpha-cropped=true]')
            && Math.abs(substrateRect.width - water.width) < 1
            && Math.abs(substrateRect.height / water.height - 28 / 192) < .02
            && Math.abs(substrateRect.bottom - water.bottom) < 1
            && slices.length === 4 && slices.map((slice) => slice.dataset.skinSlice).sort().join(',') === 'bottom,left,right,top'
            && slices.every((slice) => slice.querySelector('[data-alpha-cropped=true]'));
        })()`, true);
      }
      sharedToolbarContract = catalogToolbarContract && warehouseToolbarContract && aquariumToolbarContract;
      uiDebugBounds.toolbars = { catalogToolbarContract, warehouseToolbarContract, aquariumToolbarContract };
      uiDebugBounds.layout = await panelWindow.webContents.executeJavaScript(`(() => {
        const outer = document.getElementById('layoutPreview')?.getBoundingClientRect(); const water = document.getElementById('layoutWaterPreview')?.getBoundingClientRect();
        const substrate = document.querySelector('[data-preview-fixed-kind=substrate]'); const substrateRect = substrate?.getBoundingClientRect();
        const slices = [...document.querySelectorAll('[data-skin-slice]')];
        return { outerRatio:outer?.width/outer?.height, waterRatio:water?.width/water?.height, substrate:Boolean(substrate), substrateAlpha:Boolean(substrate?.querySelector('[data-alpha-cropped=true]')), substrateWidth:substrateRect?.width, waterWidth:water?.width, substrateRatio:substrateRect?.height/water?.height, substrateBottomDelta:substrateRect?.bottom-water?.bottom, slices:slices.map((slice) => ({ kind:slice.dataset.skinSlice, alpha:Boolean(slice.querySelector('[data-alpha-cropped=true]')) })) };
      })()`, true);
      matrixCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-aquarium-layout-1.5-smoke.png')) && matrixCaptured;
      sendTo(panelWindow, 'panel:navigate', { page: 'achievements' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      matrixCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-achievements-1.0-smoke.png')) && matrixCaptured;
      await panelWindow.webContents.executeJavaScript("document.querySelector('[data-achievement]').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 40));
      matrixCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-achievement-dialog-1.0-smoke.png')) && matrixCaptured;
      await panelWindow.webContents.executeJavaScript("document.getElementById('detailModal').close()", true);
      sendTo(panelWindow, 'panel:navigate', { page: 'history' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      historyWeightPreserved = await panelWindow.webContents.executeJavaScript("document.querySelector('.history-row small')?.textContent.includes('120 g') === true", true);
      matrixCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-history-1.0-smoke.png')) && matrixCaptured;
      sendTo(panelWindow, 'panel:navigate', { page: 'settings' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      settingsPackSelectorRemoved = await panelWindow.webContents.executeJavaScript("!document.getElementById('activePack') && !document.getElementById('app').textContent.includes('启用鱼包')", true);
      equipmentSettingsContract = await panelWindow.webContents.executeJavaScript("!document.getElementById('autoCastEnabled').disabled && document.getElementById('autoCastEnabled').checked && document.getElementById('fishingShortcut').value.length > 0", true);
      const sliderContract = await panelWindow.webContents.executeJavaScript(`(() => {
        const slider = document.getElementById('petScale');
        slider.value = '0.91';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        return { step: slider.step, output: document.getElementById('petScaleValue').textContent };
      })()`, true);
      await new Promise((resolve) => setTimeout(resolve, 180));
      scaleSliderContinuous = sliderContract.step === '0.01' && sliderContract.output === '91%' && Math.abs(gameState.settings.petScale - .91) < .001;
      matrixCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-settings-1.0-smoke.png')) && matrixCaptured;
      await panelWindow.webContents.executeJavaScript("document.getElementById('app').scrollTop = document.getElementById('app').scrollHeight", true);
      await new Promise((resolve) => setTimeout(resolve, 40));
      matrixCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-settings-shortcuts-1.0-smoke.png')) && matrixCaptured;
      sendTo(panelWindow, 'panel:navigate', { page: 'home' });
      for (const [label, width, height] of [['min', 480, 420], ['default', 640, 560], ['max', 960, 840]]) {
        panelWindow.setSize(width, height);
        await new Promise((resolve) => setTimeout(resolve, 60));
        matrixCaptured = await captureSmokePng(panelWindow, path.join(artifacts, `panel-${label}-size-1.0-smoke.png`)) && matrixCaptured;
      }
      panelWindow.setSize(panelBounds.width, panelBounds.height);
      const toolStart = petWindow.getBounds();
      const toolStartBodyX = petBodyBounds(toolStart).x;
      const toolArea = screen.getDisplayMatching(toolStart).workArea;
      let toolCurrent = petWindow.getBounds();
      movePet(toolArea.x, toolCurrent.y);
      await petWindow.webContents.executeJavaScript("document.getElementById('petBody').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))", true);
      await new Promise((resolve) => setTimeout(resolve, 40));
      matrixCaptured = await captureSmokePng(petWindow, path.join(artifacts, 'pet-tools-right-1.0-smoke.png')) && matrixCaptured;
      sceneMenuContract = await petWindow.webContents.executeJavaScript(`(() => {
        const tools = document.getElementById('quickTools');
        document.getElementById('quickScene').click();
        return tools.children.length === 4 && !document.getElementById('scenePicker').hidden
          && !document.getElementById('sceneSaltwater').disabled;
      })()`, true);
      matrixCaptured = await captureSmokePng(petWindow, path.join(artifacts, 'pet-scene-picker-1.1-smoke.png')) && matrixCaptured;
      await petWindow.webContents.executeJavaScript("document.getElementById('sceneSaltwater').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 140));
      habitatSwitchWorks = gameState.activeHabitat === 'saltwater';
      toolCurrent = petWindow.getBounds();
      const rightBodyX = toolArea.x + toolArea.width - petLayoutMetrics(toolCurrent).bodyWidth;
      movePet(rightBodyX, toolCurrent.y);
      await petWindow.webContents.executeJavaScript("document.getElementById('petBody').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))", true);
      await new Promise((resolve) => setTimeout(resolve, 40));
      matrixCaptured = await captureSmokePng(petWindow, path.join(artifacts, 'pet-tools-left-1.0-smoke.png')) && matrixCaptured;
      toolCurrent = petWindow.getBounds();
      movePet(toolStartBodyX, toolStart.y);
      applySettingPatch({ petScale: 1 });
      visualMatrixScreenshots = matrixCaptured;
    } catch (error) { process.stderr.write(`POND_SMOKE_VISUAL_ERROR:${error.stack || error.message}\n`); }
    panelWindow.hide();
    let specialAnimationContract = false;
    let specialAnimationCaptured = false;
    let specialFrameSequenceContract = false;
    let specialHighResolutionContract = false;
    let specialFishStyleResetContract = false;
    let specialBottleAnimationContract = false;
    const specialSmokeEvent = SpecialEvents.byId('RS-001', SpecialEvents.runtimeRegistry());
    if (specialSmokeEvent) {
      const preSpecialFlightState = gameState;
      const specialFlightNow = Date.now();
      gameState = {
        ...gameState, fishingState: 'bite_loop', stateStartedAt: specialFlightNow,
        stateEndsAt: specialFlightNow + 30000, biteDeadlineAt: specialFlightNow + 30000,
        isPaused: false, currentResult: null, catchCommitAt: null, catchCommitted: false,
        pendingCatch: { encounterType: 'special', eventId: specialSmokeEvent.id, seriesId: specialSmokeEvent.seriesId, catchId: 'smoke-special-animation-v3' }
      };
      gameState = Game.transition(gameState, 'reel', Math.random, specialFlightNow, {}, assets?.timings);
      broadcastAll();
      const poses = [];
      const sequenceDeadline = Date.now() + 8000;
      while (Date.now() < sequenceDeadline) {
        await new Promise(resolve => setTimeout(resolve, 65));
        const pose = await petWindow.webContents.executeJavaScript(`(() => {
          const sprite = document.getElementById('catchSprite');
          return { state:document.body.dataset.state, hidden:sprite.hidden, image:sprite.style.backgroundImage,
            position:sprite.style.backgroundPosition, frame:Math.round(parseFloat(sprite.style.backgroundPosition) / 20),
            backgroundSize:sprite.style.backgroundSize, width:sprite.style.width, height:sprite.style.height,
            imageRendering:sprite.style.imageRendering, left:sprite.style.left, top:sprite.style.top };
        })()`, true);
        if (['reel_pull', 'catch_flight', 'catch_land', 'celebrating'].includes(pose.state)) poses.push(pose);
        if (pose.state === 'celebrating') break;
      }
      const phaseFrames = Object.fromEntries(['reel_pull', 'catch_flight', 'catch_land'].map(phase => [phase, [...new Set(poses.filter(pose => pose.state === phase).map(pose => pose.frame))]]));
      specialFrameSequenceContract = JSON.stringify(phaseFrames.reel_pull) === '[0,1]'
        && JSON.stringify(phaseFrames.catch_flight) === '[2,3,4]'
        && JSON.stringify(phaseFrames.catch_land) === '[4,5]'
        && poses.every((pose, index) => index === 0 || pose.frame >= poses[index - 1].frame);
      const flightPoses = poses.filter(pose => pose.state === 'catch_flight');
      specialAnimationContract = poses.length > 0 && poses.every(pose => !pose.hidden && pose.image.includes('RS-001-catch-strip.png'))
        && new Set(flightPoses.map(pose => `${pose.left}|${pose.top}`)).size > 1;
      const stripSize = nativeImage.createFromPath(path.join(__dirname, specialSmokeEvent.animationPath)).getSize();
      const iconSize = nativeImage.createFromPath(path.join(__dirname, specialSmokeEvent.iconPath)).getSize();
      specialHighResolutionContract = stripSize.width === 1536 && stripSize.height === 256
        && iconSize.width === 256 && iconSize.height === 256
        && specialSmokeEvent.frameWidth === 256 && specialSmokeEvent.frameHeight === 256
        && specialSmokeEvent.frameCount === 6 && specialSmokeEvent.displaySize === 64
        && poses.length > 0 && poses.every(pose => pose.width === '64px' && pose.height === '64px' && pose.backgroundSize === '600% 100%' && pose.imageRendering === 'auto');
      fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, 'artifacts', 'special-animation-smoke-v3.json'), JSON.stringify({ phaseFrames, stripSize, iconSize, poses }, null, 2));
      try {
        const artifacts = path.join(__dirname, 'artifacts');
        fs.mkdirSync(artifacts, { recursive: true });
        gameState = { ...gameState, fishingState: 'catch_flight', stateStartedAt: Date.now() - 500, stateEndsAt: Date.now() + 3000 };
        broadcastAll();
        await new Promise(resolve => setTimeout(resolve, 120));
        specialAnimationCaptured = await captureSmokePng(petWindow, path.join(artifacts, 'pet-special-event-flight-1.7-smoke.png'));
      } catch { specialAnimationCaptured = false; }
      hideResult();
      const bottleEvents = [...new Map(SpecialEvents.runtimeRegistry().filter(event => event.seriesId === 'drift_bottle').map(event => [event.bottleTheme, event])).values()];
      const bottleResults = [];
      for (const event of bottleEvents) {
        gameState = { ...preSpecialFlightState, fishingState: 'catch_flight', stateStartedAt: Date.now(), stateEndsAt: Date.now() + 10000,
          currentResult: null, pendingCatch: { encounterType: 'special', eventId: event.id, seriesId: event.seriesId } };
        broadcastAll();
        await new Promise(resolve => setTimeout(resolve, 100));
        const expectedFile = path.basename(event.animationPath);
        bottleResults.push(await petWindow.webContents.executeJavaScript(`(async () => {
          const sprite = document.getElementById('catchSprite');
          const url = sprite.style.backgroundImage.match(/url\\(["']?(.*?)["']?\\)$/)?.[1];
          if (!url || !url.includes(${JSON.stringify(expectedFile)})) return false;
          const image = new Image(); image.src = url;
          try { await image.decode(); } catch { return false; }
          return !sprite.hidden && image.naturalWidth === 1536 && image.naturalHeight === 256
            && sprite.style.width === '64px' && sprite.style.backgroundSize === '600% 100%';
        })()`, true));
      }
      specialBottleAnimationContract = bottleEvents.length === 4 && bottleResults.every(Boolean)
        && new Set(bottleEvents.map(event => event.animationPath)).size === 4;
      gameState = { ...preSpecialFlightState, fishingState: 'catch_flight', stateStartedAt: Date.now(), stateEndsAt: Date.now() + 10000,
        currentResult: null, pendingCatch: { fishId: Game.FISH[0].id, variant: 'normal', catchId: 'smoke-normal-after-special' } };
      broadcastAll();
      await new Promise(resolve => setTimeout(resolve, 120));
      specialFishStyleResetContract = await petWindow.webContents.executeJavaScript(`(() => {
        const sprite = document.getElementById('catchSprite');
        return !sprite.hidden && sprite.children.length === 0
          && !sprite.classList.contains('layered-airborne') && !sprite.classList.contains('unknown')
          && sprite.style.width === '64px' && sprite.style.height === '64px'
          && sprite.style.backgroundSize === '400% 100%' && sprite.style.imageRendering === ''
          && getComputedStyle(sprite).imageRendering === 'pixelated'
          && sprite.style.backgroundImage.includes('/fish/') && !sprite.style.backgroundImage.includes('/events/');
      })()`, true);
      gameState = preSpecialFlightState;
      broadcastAll();
    }
    const fish = Game.FISH[0];
    const preVariantFlightState = gameState;
    const variantFlightNow = Date.now();
    gameState = {
      ...gameState, fishingState: 'catch_flight', stateStartedAt: variantFlightNow,
      stateEndsAt: variantFlightNow + 10000,
      pendingCatch: { fishId: fish.id, variant: 'iridescent', catchId: 'smoke-iridescent-flight' }
    };
    broadcastAll();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const variantAirborneContract = await petWindow.webContents.executeJavaScript(`(() => {
      const sprite = document.getElementById('catchSprite');
      const dynamic = [...sprite.querySelectorAll('.airborne-cloud,.airborne-ribbon,.airborne-glint')];
      return !sprite.hidden && sprite.classList.contains('layered-airborne')
        && sprite.children.length === 5 && dynamic.length === 3
        && dynamic.every((node) => node.style.getPropertyValue('--mask').includes('mask-airborne'))
        && !sprite.classList.contains('unknown');
    })()`, true);
    try {
      const artifacts = path.join(__dirname, 'artifacts');
      fs.mkdirSync(artifacts, { recursive: true });
      variantVisualScreenshots = await captureSmokePng(petWindow, path.join(artifacts, 'pet-iridescent-airborne-1.3-smoke.png')) && variantVisualScreenshots;
    } catch { variantVisualScreenshots = false; }
    gameState = preVariantFlightState;
    gameState = {
      ...gameState,
      collection: { ...gameState.collection, [fish.id]: { count: 1, firstAt: Date.now(), lastAt: Date.now(), maxLengthCm: 12.3, maxWeightKg: .12 } },
      currentResult: {
        catchId: 'smoke-catch', resultId: fish.id, name: fish.name,
        rarity: fish.rarity, rarityName: fish.rarityName, pack: fish.pack,
        packName: fish.packName, size: '12.3 cm', weight: '120 g', first: true,
        variant: 'iridescent', variantVersion: 1, probabilityVersion: 1,
        locked: true, autoLocked: true
      }
    };
    broadcastAll();
    showResult();
    const resultDidNotTakeFocus = !resultWindow.isFocused();
    const resultShownBounds = resultWindow.getBounds();
    const resultPetBodyBounds = petBodyBounds();
    const resultAboveAndCentered = resultShownBounds.y + resultShownBounds.height <= resultPetBodyBounds.y
      && Math.abs((resultShownBounds.x + resultShownBounds.width / 2) - (resultPetBodyBounds.x + resultPetBodyBounds.width / 2)) <= 1;
    const resultCompact = resultShownBounds.width <= 200
      && resultShownBounds.width <= Math.round(resultPetBodyBounds.width * 0.88) + 1
      && resultShownBounds.height <= Math.round(resultPetBodyBounds.height * 0.88) + 1;
    // Capture the settled card rather than the middle of its 300 ms stepped
    // entrance, where the translated lower border is intentionally offscreen.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const resultFishArtEnlarged = await resultWindow.webContents.executeJavaScript(`(() => {
      const art = document.querySelector('.fish-art');
      const card = document.getElementById('catchCard');
      return art && card && art.getBoundingClientRect().width >= 70 && card.getBoundingClientRect().width <= 200;
    })()`, true);
    const variantResultContract = await resultWindow.webContents.executeJavaScript(`(() => {
      const card = document.getElementById('catchCard');
      const layers = [...document.querySelectorAll('.fish-art .pearl-layer')];
      return card.dataset.variant === 'iridescent' && card.classList.contains('has-pearl-layers')
        && layers.length === 3 && layers.every((node) => getComputedStyle(node).animationName !== 'none')
        && document.getElementById('fishImage').src.includes('iridescent')
        && document.getElementById('detailOverlay').src.includes('details');
    })()`, true);
    let resultCardCaptured = false;
    try {
      const artifacts = path.join(__dirname, 'artifacts');
      fs.mkdirSync(artifacts, { recursive: true });
      resultCardCaptured = await captureSmokePng(resultWindow, path.join(artifacts, 'result-1.0-smoke.png'));
    } catch { /* Visual capture is separately reported by the smoke result. */ }
    const canonicalResultLayout = await resultWindow.webContents.executeJavaScript(`(() => {
      const art = document.querySelector('.fish-art').getBoundingClientRect();
      const name = getComputedStyle(document.getElementById('fishName'));
      return { width: innerWidth, artWidth: art.width, nameFont: parseFloat(name.fontSize) };
    })()`, true);
    resultWindow.setSize(200, 210);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const scaledResultLayout = await resultWindow.webContents.executeJavaScript(`(() => {
      const art = document.querySelector('.fish-art').getBoundingClientRect();
      const name = getComputedStyle(document.getElementById('fishName'));
      return { width: innerWidth, artWidth: art.width, nameFont: parseFloat(name.fontSize) };
    })()`, true);
    const expectedResultScale = scaledResultLayout.width / canonicalResultLayout.width;
    const resultLayoutScalesWithWindow = Math.abs(scaledResultLayout.artWidth / canonicalResultLayout.artWidth - expectedResultScale) < .02
      && Math.abs(scaledResultLayout.nameFont / canonicalResultLayout.nameFont - expectedResultScale) < .02;
    resultWindow.setBounds(resultShownBounds);
    await resultWindow.webContents.executeJavaScript("document.getElementById('closeResult').click()", true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const resultCloseButtonWorks = !resultWindow.isVisible();
    showResult();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await resultWindow.webContents.executeJavaScript("document.getElementById('catchCard').click()", true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const resultClickOpenedPanel = panelWindow.isVisible();
    const resultHiddenAfterDetail = !resultWindow.isVisible();
    showResult();
    await new Promise((resolve) => setTimeout(resolve, 5200));
    const resultRemainsVisibleAfterFiveSeconds = resultWindow.isVisible();
    await new Promise((resolve) => setTimeout(resolve, RESULT_AUTO_HIDE_MS - 5200 + 200));
    const resultAutoHidden = !resultWindow.isVisible();
    let specialResultCardContract = false;
    let specialResultClickOpenedSeries = false;
    let specialResultCardCaptured = false;
    let specialHomeContract = false;
    let specialHomeCaptured = false;
    let specialSeriesPageCaptured = false;
    let randomUnhookCardContract = false;
    let randomUnhookCardCaptured = false;
    if (specialSmokeEvent) {
      const preSpecialResultState = gameState;
      const specialFoundAt = Date.now();
      gameState = {
        ...gameState,
        fishingState: 'catch_land', stateStartedAt: specialFoundAt, stateEndsAt: null,
        pendingCatch: null, catchCommitAt: null, catchCommitted: true, biteDeadlineAt: null,
        specialEventCollection: { schemaVersion: 1, entries: { 'RS-001': { count: 1, firstFoundAt: specialFoundAt, lastFoundAt: specialFoundAt } } },
        currentResult: {
          type: 'special', encounterType: 'special', eventId: specialSmokeEvent.id,
          catchId: 'smoke-special-result-v3',
          seriesId: specialSmokeEvent.seriesId, seriesName: specialSmokeEvent.seriesName,
          title: specialSmokeEvent.title, description: specialSmokeEvent.description,
          iconPath: specialSmokeEvent.iconPath, animationPath: specialSmokeEvent.animationPath,
          count: 1, first: true, firstFoundAt: specialFoundAt, lastFoundAt: specialFoundAt
        }
      };
      resultCardOverride = null;
      broadcastAll();
      showPanel({ page:'special-events' });
      await new Promise((resolve) => setTimeout(resolve, 150));
      specialHomeContract = await panelWindow.webContents.executeJavaScript(`(() => {
        const cards = [...document.querySelectorAll('.special-series-card')];
        return document.querySelector('h1')?.textContent === '特殊事件'
          && cards.length === 3
          && cards.map((card) => card.querySelector('strong')?.textContent).join('|') === '漂流瓶|科研标记|生态守护'
          && cards.map((card) => card.querySelector('small')?.textContent).join('|') === '已发现 0/30|已发现 1/10|已发现 0/20';
      })()`, true);
      try {
        const artifacts = path.join(__dirname, 'artifacts');
        fs.mkdirSync(artifacts, { recursive: true });
        specialHomeCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-special-events-home-1.7-smoke.png'));
      } catch { specialHomeCaptured = false; }
      panelWindow.hide();
      showResult();
      await new Promise((resolve) => setTimeout(resolve, 350));
      specialResultCardContract = await resultWindow.webContents.executeJavaScript(`(() => {
        const card = document.getElementById('catchCard');
        const image = document.getElementById('fishImage');
        return card.dataset.resultType === 'special'
          && document.getElementById('rarity').textContent === '科研标记'
          && document.getElementById('fishName').textContent === '断裂标记带'
          && document.getElementById('measure').textContent.includes('自然断开')
          && document.getElementById('badges').textContent.includes('首次发现')
          && image.src.includes('RS-001.png');
      })()`, true);
      try {
        const artifacts = path.join(__dirname, 'artifacts');
        fs.mkdirSync(artifacts, { recursive: true });
        specialResultCardCaptured = await captureSmokePng(resultWindow, path.join(artifacts, 'result-special-event-1.7-smoke.png'));
      } catch { specialResultCardCaptured = false; }
      await resultWindow.webContents.executeJavaScript("document.getElementById('catchCard').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 180));
      specialResultClickOpenedSeries = !resultWindow.isVisible() && panelWindow.isVisible()
        && await panelWindow.webContents.executeJavaScript(`(() => {
          const rows = [...document.querySelectorAll('.special-entry')];
          return document.querySelector('h1')?.textContent === '科研标记'
            && rows.length === 10
            && rows[0].classList.contains('discovered')
            && rows[0].textContent.includes('断裂标记带')
            && rows[0].querySelector('img')?.src.includes('RS-001.png');
        })()`, true);
      try {
        const artifacts = path.join(__dirname, 'artifacts');
        fs.mkdirSync(artifacts, { recursive: true });
        specialSeriesPageCaptured = await captureSmokePng(panelWindow, path.join(artifacts, 'panel-special-events-1.7-smoke.png'));
      } catch { specialSeriesPageCaptured = false; }
      panelWindow.hide();
      gameState = {
        ...preSpecialResultState, fishingState: 'empty_reel', pendingCatch: null,
        currentResult: { type: 'random_unhook', encounterType: 'fish', fishId: fish.id, at: Date.now() }
      };
      resultCardOverride = gameState.currentResult;
      broadcastAll();
      showResult();
      await new Promise((resolve) => setTimeout(resolve, 350));
      randomUnhookCardContract = await resultWindow.webContents.executeJavaScript(`(() => {
        const card = document.getElementById('catchCard');
        return card.dataset.resultType === 'random_unhook'
          && document.getElementById('fishName').textContent === '鱼已挣脱'
          && document.getElementById('badges').hidden && document.getElementById('badges').textContent === ''
          && document.querySelector('.catch-card small').textContent === '本次没有收获'
          && document.getElementById('fishImage').src.includes('random-escape-pattern.png');
      })()`, true);
      try {
        const artifacts = path.join(__dirname, 'artifacts');
        fs.mkdirSync(artifacts, { recursive: true });
        randomUnhookCardCaptured = await captureSmokePng(resultWindow, path.join(artifacts, 'result-random-unhook-1.7-smoke.png'));
      } catch { randomUnhookCardCaptured = false; }
      await resultWindow.webContents.executeJavaScript("document.getElementById('catchCard').click()", true);
      await new Promise((resolve) => setTimeout(resolve, 120));
      randomUnhookCardContract = randomUnhookCardContract && !resultWindow.isVisible() && !panelWindow.isVisible();
      gameState = preSpecialResultState;
      resultCardOverride = null;
      broadcastAll();
      showPanel({ page:'home' });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    let screenshotsCaptured = false;
    try {
      const artifacts = path.join(__dirname, 'artifacts');
      fs.mkdirSync(artifacts, { recursive: true });
      screenshotsCaptured = resultCardCaptured && await captureSmokePng(panelWindow, path.join(artifacts, 'panel-1.0-smoke.png'));
      screenshotsCaptured = await captureSmokePng(petWindow, path.join(artifacts, 'pet-1.0-smoke.png')) && screenshotsCaptured;
    } catch { /* Visual capture is separately reported by the smoke result. */ }
    const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    const result = {
      loaded: !petWindow.webContents.isLoadingMainFrame(), alwaysOnTop: petWindow.isAlwaysOnTop(),
      visibleBeforeHide, hiddenAfterHide, visibleAfterRestore, presentationRecoveredAfterCaptureBlur,
      achievementCornersRelaxed, achievementCornersCastAuthority, achievementSaveFailureSafe,
      panelCreated: Boolean(panelWindow && !panelWindow.isDestroyed()), panelVisible: panelWindow.isVisible(), panelResizable: panelWindow.isResizable(),
      panelFreeResizeValid,
      resultCreated: Boolean(resultWindow && !resultWindow.isDestroyed()), resultAutoHidden, resultNonOverlapping: !intersects(petBodyBounds(), resultWindow.getBounds()), resultAboveAndCentered, resultCompact, resultFishArtEnlarged, resultLayoutScalesWithWindow,
      resultDidNotTakeFocus, resultCloseButtonWorks, resultClickOpenedPanel, resultHiddenAfterDetail, shortcutRegistered, panelShortcutRegistered, fishingShortcutRegistered, shortcutUpdateApplied, shortcutDuplicateRejected, edgeLayoutFlipped, edgeContinuousDrag, dragSizeInvariant, scaleSliderContinuous, noBlankDuringActionSwitch,
      resultRemainsVisibleAfterFiveSeconds, resultTenSecondTimeout: RESULT_AUTO_HIDE_MS === 10000,
      trayIconDecoded: !createTrayIcon().isEmpty(), trayCreated: Boolean(tray && !tray.isDestroyed()),
      menuActionOverride, menuActionStartsAtFirstFrame, menuActionAdvanced, clickActionStartsAtFirstFrame, clickActionAdvanced, passiveClickFeedbackRemoved, visualOverridePreservedTimers, deprecatedSettingsRemoved,
      castTimerVisible, castTimerToggleApplied, panelFirstOpenRendered, panelPersistsAfterBlur,
      screenshotsCaptured, homeAndCatalogScreenshots, visualMatrixScreenshots, catalogKeyboardNavigation, catalogNavigationRestored,
      homeStatsCompact, catalogGrouped, catalogLongFishFit, catalogRarityLabelsColored, warehouseContract, warehouseScrollPreserved, warehouseSaleFlow, shopContract,
      settingsPackSelectorRemoved, equipmentSettingsContract, historyWeightPreserved, sceneMenuContract, habitatSwitchWorks,
      variantManifestContract, variantCatalogContract, variantDetailContract, variantWarehouseContract, variantLockContract, variantAirborneContract, variantResultContract,
      variantVisualScreenshots, sharedToolbarContract, sharedSortDirectionContract, catalogSearchFocusPreserved, catalogVariantFilterContract,
      specialAnimationContract, specialFrameSequenceContract, specialHighResolutionContract, specialFishStyleResetContract, specialBottleAnimationContract,
      specialAnimationCaptured, specialHomeContract, specialHomeCaptured, specialResultCardContract, specialResultClickOpenedSeries, specialResultCardCaptured, specialSeriesPageCaptured,
      randomUnhookCardContract, randomUnhookCardCaptured,
      aquariumWindowToggleContract, multiTankUiContract, tankHabitatCleanupContract, layoutPreviewParity,
      petBounds: petWindow.getBounds(), preEdgeBounds, edgeMovedBounds, catalogScrollBounds, panelBounds, panelResizeBounds, resultBounds: resultWindow.getBounds(), uiDebugBounds
    };
    process.stdout.write(`POND_SMOKE:${JSON.stringify(result)}\n`);
    isQuitting = true;
    app.exit(Object.entries(result).filter(([key]) => !key.endsWith('Bounds')).every(([, value]) => value === true) ? 0 : 1);
  }, 1200);
}
function runPackageVerify() {
  if (!panelWindow || panelWindow.isDestroyed()) createPanelWindow();
  if (!resultWindow || resultWindow.isDestroyed()) createResultWindow();
  setTimeout(async () => {
    const windows = BrowserWindow.getAllWindows();
    const petManifest = assets?.manifests?.find((item) => item.id === 'pet')?.data;
    const petActions = Object.values(petManifest?.actions || {});
    const petFrameCount = petActions.reduce((sum, action) => sum + Number(action.frameCount || 0), 0);
    const fishDiagnostic = assets?.diagnostics?.fish?.find((item) => item.id === 'fish');
    const variantDiagnostic = assets?.diagnostics?.variants;
    const uiDiagnostic = assets?.diagnostics?.ui?.find((item) => item.id === 'ui');
    const achievementDiagnostic = assets?.diagnostics?.ui?.find((item) => item.id === 'achievements');
    let aquariumFishEntries = 0;
    try { aquariumFishEntries = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'fish', 'aquarium', 'manifest.json'), 'utf8')).entries?.length || 0; }
    catch { aquariumFishEntries = 0; }
    const specialEventEntries = SpecialEvents.runtimeRegistry().length;
    const warehouseToolbarDebug = [];
    const initialBounds = panelWindow.getBounds();
    try {
      sendTo(panelWindow, 'panel:navigate', { page:'warehouse' });
      for (const [width, height] of [[480,420],[640,560],[1100,600]]) {
        panelWindow.setSize(width, height);
        await new Promise((resolve) => setTimeout(resolve, 140));
        warehouseToolbarDebug.push(await panelWindow.webContents.executeJavaScript(`(async () => {
          const main = document.getElementById('app');
          if(!main)return {valid:false,error:'missing-main'};
          main.scrollTop = 0;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const controls = ['[data-action="list-sort-toggle"]','[data-action="list-filter-toggle"]','.list-search','[data-action="toggle-bulk"]'].map(s=>document.querySelector(s));
          if(controls.some(n=>!n))return {valid:false};
          const rects=controls.map(n=>n.getBoundingClientRect());
          const inside=rects.every(r=>r.left>=0&&r.right<=innerWidth&&r.width>0&&r.height>=32);
          const overlap=rects.some((a,i)=>rects.slice(i+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top));
          document.querySelector('[data-action="list-sort-toggle"]').click();
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const header = document.querySelector('.page-header');
          if(!header)return {valid:false,error:'missing-header'};
          const maxScroll = Math.max(0, main.scrollHeight - main.clientHeight);
          main.scrollTop = Math.min(maxScroll, Math.max(80, header.offsetHeight + 16));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const headerRect = header.getBoundingClientRect();
          let headerProtected = true;
          for(let y=Math.ceil(headerRect.top+3);headerProtected&&y<=Math.floor(headerRect.bottom-3);y+=7){
            for(let x=Math.ceil(headerRect.left+3);x<=Math.floor(headerRect.right-14);x+=11){
              const top=document.elementFromPoint(x,y);
              if(top&&top!==header&&!header.contains(top)){headerProtected=false;break;}
            }
          }
          return {valid:inside&&!overlap&&headerProtected&&getComputedStyle(document.body).fontSize==='14px',headerProtected,width:innerWidth,height:innerHeight};
        })()`, true));
      }
    } catch (error) { warehouseToolbarDebug.push({valid:false,error:error.message}); }
    panelWindow.setBounds(initialBounds);
    const warehouseToolbarResponsive = warehouseToolbarDebug.length === 3 && warehouseToolbarDebug.every(item=>item.valid);
    const result = {
      executable: process.execPath,
      packaged: app.isPackaged,
      packageVersion: app.getVersion(),
      applicationName: app.getName(),
      panelTitle: panelWindow.getTitle(),
      panelHeading: await panelWindow.webContents.executeJavaScript("document.querySelector('.app-header strong')?.textContent || document.querySelector('header strong')?.textContent || ''"),
      characterLibrary: { version: characterLibrary?.snapshot().version, selectedId: characterLibrary?.selectedId, builtinAvailable: characterLibrary?.snapshot().entries.some(entry => entry.id === 'classic' && entry.status === 'ready') },
      features: { aquarium: AQUARIUM_ENABLED },
      windowCount: windows.length,
      loadedWindows: windows.filter((window) => !window.webContents.isLoadingMainFrame()).length,
      petVisible: Boolean(petWindow?.isVisible()),
      shortcuts: { pet: shortcutRegistered, panel: panelShortcutRegistered, fishing: fishingShortcutRegistered, aquarium: aquariumShortcutRegistered },
      assets: {
        noFallbacks: Array.isArray(assets?.diagnostics?.fallbacks) && assets.diagnostics.fallbacks.length === 0,
        petValid: assets?.diagnostics?.action?.valid === true,
        petActions: petActions.length,
        petFrames: petFrameCount,
        fishValid: fishDiagnostic?.valid === true,
        fishCoverage: fishDiagnostic?.coverage || null,
        variantsValid: variantDiagnostic?.valid === true,
        variantCoverage: variantDiagnostic?.coverage || null,
        uiIcons: uiDiagnostic?.valid === true ? uiDiagnostic.count : 0,
        achievementIcons: achievementDiagnostic?.valid === true ? achievementDiagnostic.count : 0,
        aquariumFishEntries,
        specialEventEntries
      },
      measurementEntries: Object.keys(measurementMap || {}).length,
      warehouseToolbarResponsive,
      warehouseToolbarDebug
    };
    const coverage = result.assets.fishCoverage || {};
    const valid = result.packaged
      && result.packageVersion === PACKAGE_VERSION
      && result.applicationName === APP_DISPLAY_NAME && result.panelTitle === APP_DISPLAY_NAME
      && result.panelHeading === APP_DISPLAY_NAME
      && result.characterLibrary.version === 1 && result.characterLibrary.builtinAvailable
      && result.windowCount === 3 && result.loadedWindows === 3 && result.petVisible
      && result.features.aquarium === false
      && result.shortcuts.pet && result.shortcuts.panel && result.shortcuts.fishing && !result.shortcuts.aquarium
      && result.assets.noFallbacks && result.assets.petValid
      && result.assets.petActions === 22 && result.assets.petFrames === 152
      && result.assets.fishValid
      && ['entries', 'icons', 'airborne', 'motions'].every((key) => coverage[key] === 152)
      && result.assets.variantsValid
      && result.assets.variantCoverage?.entries === 152
      && result.assets.variantCoverage?.variants === 608
      && result.assets.aquariumFishEntries === 0
      && result.assets.specialEventEntries === 60
      && result.assets.uiIcons === 23 && result.assets.achievementIcons === 71
      && result.measurementEntries === 152
      && result.warehouseToolbarResponsive;
    process.stdout.write(`POND_PACKAGE_VERIFY:${JSON.stringify(result)}\n`);
    isQuitting = true;
    app.exit(valid ? 0 : 1);
  }, 1400);
}
function runAquariumSmokeTest() {
  setTimeout(async () => {
    try {
      showAquarium({ persist:false });
      for (let attempt = 0; attempt < 40 && aquariumWindow.webContents.isLoadingMainFrame(); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      const display = screen.getDisplayMatching(aquariumWindow.getBounds()); const area = display.workArea;
      const initialBounds = aquariumWindow.getBounds();
      const renderer = await aquariumWindow.webContents.executeJavaScript(`(() => ({
        ready: document.body.dataset.assetStatus === 'ready',
        fishCount: Number(document.body.dataset.fishCount),
        unsupported: Number(document.body.dataset.unsupportedFishCount),
        bubbles: document.querySelectorAll('.bubble').length,
        menuButtons: document.querySelectorAll('#contextMenu [data-action]').length,
        artLayers: document.querySelectorAll('.art-layer').length,
        nodeCount: document.querySelectorAll('*').length,
        motionTicks: Number(document.body.dataset.motionTicks || 0),
        canvas: [document.getElementById('aquarium').offsetWidth, document.getElementById('aquarium').offsetHeight],
        fishClip: getComputedStyle(document.querySelector('.fish-layer')).clipPath,
        fullDragSurface: document.body.dataset.dragSurface,
        fishPointerEvents: getComputedStyle(document.querySelector('.fish-sprite')).pointerEvents,
        fishCardAbsent: !document.getElementById('fishCard'),
        sourceFacing: document.querySelector('.fish-sprite')?.dataset.sourceFacing
      }))()`, true);
      let orientationConsistent = true; let movingFishObserved = false;
      for (let sample = 0; sample < 8; sample += 1) {
        await new Promise((resolve) => setTimeout(resolve, 90));
        const motion = await aquariumWindow.webContents.executeJavaScript(`[...document.querySelectorAll('.fish-sprite')].map((fish) => ({ valid:fish.dataset.orientationValid === 'true', vx:Number(fish.dataset.velocityX || 0), nose:fish.dataset.noseDirection }))`, true);
        orientationConsistent = orientationConsistent && motion.every((fish) => fish.valid && (Math.abs(fish.vx) <= .0005 || (fish.vx > 0 ? fish.nose === 'right' : fish.nose === 'left')));
        movingFishObserved = movingFishObserved || motion.some((fish) => Math.abs(fish.vx) > .0005);
      }
      const pearlFramesLocked = await aquariumWindow.webContents.executeJavaScript(`(() => {
        const visual=document.querySelector('.fish-visual.iridescent'); const details=visual?.querySelector('.pearl-details');
        const masks=[...(visual?.querySelectorAll('.pearl-clouds,.pearl-ribbons,.pearl-glint') || [])];
        return Boolean(visual && details && visual.dataset.baseFrame === details.dataset.detailsFrame
          && masks.length === 3 && masks.every((layer) => layer.dataset.maskFrame === visual.dataset.baseFrame)
          && getComputedStyle(details).animationName === 'none'
          && masks.every((layer) => !getComputedStyle(layer).animationName.includes('mask-swim')));
      })()`, true);
      const pearlPaintContract = await aquariumWindow.webContents.executeJavaScript(`(async () => {
        const visual=document.querySelector('.fish-visual.iridescent'); const cloud=visual?.querySelector('.pearl-clouds');
        if(!visual||!cloud||!visual.dataset.maskSource)return false;
        const loaded=await new Promise((resolve)=>{const image=new Image();image.onload=()=>resolve(true);image.onerror=()=>resolve(false);image.src=visual.dataset.maskSource});
        const style=getComputedStyle(cloud); const before=style.backgroundPosition;
        await new Promise((resolve)=>setTimeout(resolve,420)); const after=getComputedStyle(cloud).backgroundPosition;
        return loaded && style.webkitMaskImage!=='none' && Number(style.opacity)>=.7
          && style.mixBlendMode==='color' && style.animationName.includes('pearl-cloud-drift') && before!==after;
      })()`, true);

      const beforeRendererDrag = aquariumWindow.getBounds();
      await aquariumWindow.webContents.executeJavaScript(`(async () => {
        const aquarium=document.getElementById('aquarium');
        aquarium.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:71,screenX:260,screenY:150}));
        await new Promise((resolve) => setTimeout(resolve,80));
        aquarium.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,buttons:1,pointerId:71,screenX:236,screenY:134}));
        await new Promise((resolve) => setTimeout(resolve,80));
        aquarium.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,pointerId:71,screenX:236,screenY:134}));
      })()`, true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const afterRendererDrag = aquariumWindow.getBounds();
      const fullSurfaceDragWorks = afterRendererDrag.x !== beforeRendererDrag.x || afterRendererDrag.y !== beforeRendererDrag.y;
      const aquariumDragSizeInvariant = afterRendererDrag.width === beforeRendererDrag.width && afterRendererDrag.height === beforeRendererDrag.height;

      await aquariumWindow.webContents.executeJavaScript("document.getElementById('aquarium').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:250,clientY:120}))", true);
      const contextMenuShown = await aquariumWindow.webContents.executeJavaScript("!document.getElementById('contextMenu').hidden", true);
      await new Promise((resolve) => setTimeout(resolve, 10100));
      const contextMenuAutoHidden = await aquariumWindow.webContents.executeJavaScript("document.getElementById('contextMenu').hidden", true);
      const layoutOpen = aquariumAction('open-layout', { active:true }); await new Promise((resolve) => setTimeout(resolve, 80));
      const layoutModeEntered = layoutOpen.ok && aquariumLayoutModeActive && await aquariumWindow.webContents.executeJavaScript("document.body.classList.contains('layout-mode')", true);
      const dragBeforeLayoutAttempt = aquariumWindow.getBounds();
      await aquariumWindow.webContents.executeJavaScript(`document.getElementById('aquarium').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:72,screenX:200,screenY:120}))`, true);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const dragDisabledInLayout = await aquariumWindow.webContents.executeJavaScript("document.body.dataset.dragState === 'idle'", true)
        && JSON.stringify(aquariumWindow.getBounds()) === JSON.stringify(dragBeforeLayoutAttempt);
      const layoutClose = aquariumAction('open-layout', { active:false }); await new Promise((resolve) => setTimeout(resolve, 50));
      const layoutModeExited = layoutClose.ok && !aquariumLayoutModeActive && await aquariumWindow.webContents.executeJavaScript("!document.body.classList.contains('layout-mode')", true);
      await aquariumWindow.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))", true);
      gameState = { ...gameState, wallet:{ ...(gameState.wallet || {}), balance:999999 } };
      const purchaseDecor = aquariumAction('purchase-item', { itemId:'rock-dragon', habitat:'freshwater' });
      const purchaseSkin = aquariumAction('purchase-item', { itemId:'tank-oak', habitat:'freshwater' });
      const active = AquariumWindow.resolveActiveTank({ state:gameState });
      const currentTank = active.tank;
      const saveDecorLayout = aquariumAction('save-layout', { tankId:active.tankId, habitat:'freshwater', layout:{
        ...currentTank,
        skinId:'tank-oak', substrateId:'substrate-river-sand',
        decor:[{ instanceId:'smoke-rock-dragon', itemId:'rock-dragon', x:.52, y:.76, layer:'mid', scale:1.75, flipX:false }]
      } });
      await new Promise((resolve) => setTimeout(resolve, 350));
      const dynamicLayout = await aquariumWindow.webContents.executeJavaScript(`(() => ({
        rendered:Boolean(document.querySelector('[data-item-id="rock-dragon"]')),
        path:document.querySelector('[data-item-id="rock-dragon"] img')?.getAttribute('src') || '',
        decorScale:document.querySelector('[data-item-id="rock-dragon"]')?.dataset.renderScale,
        activeTankId:document.body.dataset.activeTankId,
        activeTankSource:document.body.dataset.activeTankSource,
        activeSkin:document.body.dataset.activeSkin,
        skinPath:document.querySelector('[data-item-id="tank-oak"] img')?.getAttribute('src') || '',
        skinCropped:[...document.querySelectorAll('[data-item-id="tank-oak"] img')].every((image) => image.dataset.alphaCropped === 'true'),
        substrateCropped:document.querySelector('[data-fixed-kind="substrate"] img')?.dataset.alphaCropped === 'true',
        substrateBottom:(() => { const node=document.querySelector('[data-fixed-kind="substrate"]'); return node ? node.offsetTop + node.offsetHeight : -1; })(),
        nodeCount:document.querySelectorAll('*').length,
        layoutAssets:Number(document.body.dataset.layoutAssetCount || 0)
      }))()`, true);
      const initialFit = initialBounds.width <= area.width * .32 + 1 && initialBounds.height <= area.height * .32 + 1;
      const maxFit = initialBounds.width <= area.width * .40 + 1 && initialBounds.height <= area.height * .40 + 1;
      const continuousScale = setAquariumScale(1.03, { persist:false });
      const scaleContinuous = continuousScale.ok && Math.abs(continuousScale.scale - 1.03) < .011;
      const clampedScale = setAquariumScale(1.25, { persist:false });
      const scaleBounded = clampedScale.bounds.width <= area.width * .40 + 1 && clampedScale.bounds.height <= area.height * .40 + 1;
      const moved = moveAquarium(area.x - 9999, area.y - 9999);
      const moveClamped = moved.ok && moved.bounds.x >= area.x && moved.bounds.y >= area.y;
      const screenshotPath = path.join(__dirname, 'artifacts', 'aquarium-1.5-smoke.png');
      fs.mkdirSync(path.dirname(screenshotPath), { recursive:true });
      const screenshotCaptured = await captureSmokePng(aquariumWindow, screenshotPath);
      aquariumWindow.emit('blur'); await new Promise((resolve) => setTimeout(resolve, 1500));
      const presentationRecovered = aquariumWindow.isVisible() && aquariumWindow.isAlwaysOnTop();
      const ticksBeforeHide = await aquariumWindow.webContents.executeJavaScript('Number(document.body.dataset.motionTicks || 0)', true);
      hideAquarium({ persist:false }); await new Promise((resolve) => setTimeout(resolve, 220));
      const ticksWhileHidden = await aquariumWindow.webContents.executeJavaScript('Number(document.body.dataset.motionTicks || 0)', true);
      const hiddenStopsMotion = ticksBeforeHide === ticksWhileHidden;
      showAquarium({ persist:false }); await new Promise((resolve) => setTimeout(resolve, 180));
      const ticksAfterShow = await aquariumWindow.webContents.executeJavaScript('Number(document.body.dataset.motionTicks || 0)', true);
      const showResumesMotion = ticksAfterShow > ticksWhileHidden;
      const nodesLater = await aquariumWindow.webContents.executeJavaScript('document.querySelectorAll("*").length', true);
      const lockResult = setAquariumLock(true); const locked = lockResult.ok && aquariumSettings().inputLocked === true;
      const unlockResult = setAquariumLock(false); const unlocked = unlockResult.ok && aquariumSettings().inputLocked === false;
      aquariumWindow.minimize(); await new Promise((resolve) => setTimeout(resolve, 100));
      const minimizedRecovered = !aquariumWindow.isMinimized() && aquariumWindow.isVisible();
      const report = {
        windowCreated: Boolean(aquariumWindow && !aquariumWindow.isDestroyed()),
        loaded: !aquariumWindow.webContents.isLoadingMainFrame(),
        realAssetsLoaded: renderer.ready && renderer.artLayers === 7,
        fullFishManifest: (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname,'assets','fish','aquarium','manifest.json'),'utf8')).entries.length === 152; } catch { return false; } })(),
        fourFishRendered: renderer.fishCount === 4 && renderer.unsupported === 0,
        fishConfinedToWater: renderer.fishClip.includes('34px') && renderer.fishClip.includes('62px'),
        pearlDetailsFrameLocked: pearlFramesLocked,
        pearlPaintContract,
        fishFacingMatchesVelocity: orientationConsistent && movingFishObserved && renderer.sourceFacing === 'right',
        fishInteractionRemoved: renderer.fishPointerEvents === 'none' && renderer.fishCardAbsent,
        fullAquariumDrag: renderer.fullDragSurface === 'full-aquarium-left-button' && fullSurfaceDragWorks && dragDisabledInLayout,
        aquariumDragSizeInvariant,
        internalCanvasExact: renderer.canvas[0] === 512 && renderer.canvas[1] === 288,
        initialFit, maxFit, scaleContinuous, scaleBounded, moveClamped,
        shortcutRegistered: aquariumShortcutRegistered,
        contextActions: renderer.menuButtons === 4 && contextMenuShown && contextMenuAutoHidden,
        layoutModeEntered, layoutModeExited, presentationRecovered,
        activeTankResolved: purchaseSkin.ok && dynamicLayout.activeTankSource === 'instances' && dynamicLayout.activeTankId === active.tankId,
        purchasedLayoutRendered: purchaseDecor.ok && saveDecorLayout.ok && dynamicLayout.rendered && dynamicLayout.path.includes('assets/aquarium/catalog/rock-dragon.png') && dynamicLayout.layoutAssets >= 6,
        selectedSkinRendered: dynamicLayout.activeSkin === 'tank-oak' && dynamicLayout.skinPath.includes('assets/aquarium/catalog/tank-oak.png') && dynamicLayout.skinCropped,
        substrateGrounded: dynamicLayout.substrateCropped && dynamicLayout.substrateBottom === 226,
        decorScaleRendered: dynamicLayout.decorScale === '1.750',
        bubblePoolBounded: renderer.bubbles === 12,
        domStable: nodesLater === dynamicLayout.nodeCount,
        hiddenStopsMotion, showResumesMotion, lockToggleWorks: locked && unlocked, minimizedRecovered,
        screenshotCaptured,
        windowBounds: aquariumWindow.getBounds()
      };
      process.stdout.write(`POND_AQUARIUM_SMOKE:${JSON.stringify(report)}\n`);
      isQuitting = true; app.exit(Object.entries(report).filter(([key]) => !key.endsWith('Bounds')).every(([,value]) => value === true) ? 0 : 1);
    } catch (error) {
      process.stderr.write(`POND_AQUARIUM_SMOKE_ERROR:${error.stack || error}\n`);
      isQuitting = true; app.exit(1);
    }
  }, 500);
}
function runSoakTest() {
  const durationMs = Math.max(5000, finite(process.env.POND_SOAK_DURATION_MS, 60000));
  const intervalMs = Math.max(1000, finite(process.env.POND_SOAK_INTERVAL_MS, 5000));
  const startedAt = Date.now();
  if (process.env.POND_SOAK_FISHING === '1' && gameState.fishingState === 'idle') dispatch('cast');
  const aquariumMode = process.env.POND_SOAK_AQUARIUM === '1';
  if (aquariumMode) {
    const fishIds = ['fish-1','fish-1','fish-1','fish-2','fish-3','fish-4','fish-5','fish-6'];
    const inventory = fishIds.map((id,index) => {
      const fish = Game.FISH.find((item) => item.id === id);
      return {
        inventoryId:`aquarium-soak-${index}`, catchId:`aquarium-soak-${index}`, fishId:id, resultId:id,
        name:fish.name, type:'fish', rarity:fish.rarity, rarityName:fish.rarityName, pack:fish.pack, packName:fish.packName,
        lengthCm:8 + index * .5, weightKg:.008 + index * .001, variant:'iridescent', caughtAt:startedAt-index*1000,
        valueCoins:10, locked:false, autoLocked:false
      };
    });
    const decor = [
      ['rock-dragon',.18,.88,'mid'],['rock-dragon',.40,.88,'mid'],['rock-dragon',.62,.88,'mid'],['rock-volcanic',.84,.88,'mid'],
      ['plant-grass',.12,.76,'front'],['plant-grass',.34,.76,'front'],['plant-grass',.68,.76,'front'],['rock-round',.90,.90,'mid']
    ].map(([itemId,x,y,layer],index) => ({ instanceId:`soak-decor-${index}`, itemId, x, y, layer, scale:1, flipX:index%2===1 }));
    const fish = inventory.map((entry,index) => ({ inventoryId:entry.inventoryId, lane:['back','middle','front'][index%3], motionSeed:hashSeedForMain(entry.inventoryId) }));
    const aquariumBefore = gameState.aquarium || {};
    const instancesBefore = Array.isArray(aquariumBefore.tankInstances) ? aquariumBefore.tankInstances : [];
    const resolvedBefore = AquariumWindow.resolveActiveTank({ state:gameState });
    const targetTank = (resolvedBefore.habitat === 'freshwater' ? resolvedBefore.tank : null)
      || instancesBefore.find((entry) => entry.habitat === 'freshwater')
      || { tankId:'tank-1', name:'鱼缸1', habitat:'freshwater', skinId:'tank-basic', backgroundId:null, substrateId:'substrate-river-sand', effectId:null, fish:[], decor:[] };
    const stressedTank = { ...targetTank, habitat:'freshwater', effectId:'effect-soft-bubbles', fish, decor };
    const tankInstances = instancesBefore.some((entry) => entry.tankId === targetTank.tankId)
      ? instancesBefore.map((entry) => entry.tankId === targetTank.tankId ? stressedTank : entry)
      : [...instancesBefore, stressedTank];
    const aquarium = {
      ...aquariumBefore, visible:true, activeTankId:targetTank.tankId, activeHabitat:'freshwater', tankInstances,
      ownedItemIds:[...new Set([...(aquariumBefore.ownedItemIds || []),'rock-round','plant-grass','rock-dragon','rock-volcanic','effect-soft-bubbles'])]
    };
    gameState = Game.normalizeState({ ...gameState, inventory, aquarium });
    aquariumExplicitlyHidden = false; showAquarium({ persist:false }); broadcastAll();
  }
  const initialWindowCount = BrowserWindow.getAllWindows().length;
  const samples = [];
  const sample = async () => {
    const metrics = app.getAppMetrics();
    const windows = BrowserWindow.getAllWindows();
    const processes = metrics.map((metric) => ({
      type: metric.type, pid: metric.pid,
      workingSetMb: Number((finite(metric.memory?.workingSetSize) / 1024).toFixed(1)),
      privateMb: Number((finite(metric.memory?.privateBytes) / 1024).toFixed(1)),
      cpuPercent: Number(finite(metric.cpu?.percentCPUUsage).toFixed(2))
    }));
    let aquariumDiagnostics = null;
    if (aquariumMode && aquariumWindow && !aquariumWindow.isDestroyed() && !aquariumWindow.webContents.isLoadingMainFrame()) {
      try {
        aquariumDiagnostics = await aquariumWindow.webContents.executeJavaScript(`(() => ({
          visible: !document.body.classList.contains('paused'), fishCount:Number(document.body.dataset.fishCount || 0),
          layoutAssetCount:Number(document.body.dataset.layoutAssetCount || 0), motionTicks:Number(document.body.dataset.motionTicks || 0),
          nodeCount:document.querySelectorAll('*').length, bubbles:document.querySelectorAll('.bubble').length,
          activeBubbles:Number(document.body.dataset.activeBubbleCount || 0), schoolGroups:Number(document.body.dataset.schoolGroupCount || 0)
        }))()`, true);
      } catch { aquariumDiagnostics = null; }
    }
    const item = {
      at: Date.now(), elapsedMs: Date.now() - startedAt, alive: true,
      processCount: metrics.length,
      rssMb: Number(processes.reduce((sum, processMetric) => sum + processMetric.workingSetMb, 0).toFixed(1)),
      privateMb: Number(processes.reduce((sum, processMetric) => sum + processMetric.privateMb, 0).toFixed(1)),
      cpuPercent: Number(processes.reduce((sum, processMetric) => sum + processMetric.cpuPercent, 0).toFixed(2)),
      windowCount: windows.length, visibleCount: windows.filter((window) => window.isVisible()).length,
      fishingState: gameState.fishingState, aquarium:aquariumDiagnostics, processes
    };
    samples.push(item);
    process.stdout.write(`POND_SOAK_SAMPLE:${JSON.stringify(item)}\n`);
  };
  const sampler = setInterval(() => { sample().catch(() => {}); }, intervalMs);
  setTimeout(() => { sample().catch(() => {}); }, Math.min(1000, intervalMs));
  setTimeout(async () => {
    clearInterval(sampler);
    if (!samples.length || samples.at(-1).elapsedMs < durationMs - intervalMs) await sample();
    const first = samples[0]; const last = samples.at(-1);
    const elapsedHours = Math.max(1 / 3600, (last.at - first.at) / 3600000);
    const summary = {
      durationMs: Date.now() - startedAt, samples: samples.length,
      maxRssMb: Math.max(...samples.map((item) => item.rssMb)),
      maxPrivateMb: Math.max(...samples.map((item) => item.privateMb)),
      startRssMb: first.rssMb, endRssMb: last.rssMb,
      rssDeltaMb: Number((last.rssMb - first.rssMb).toFixed(1)),
      rssSlopeMbPerHour: Number(((last.rssMb - first.rssMb) / elapsedHours).toFixed(2)),
      startPrivateMb: first.privateMb, endPrivateMb: last.privateMb,
      privateDeltaMb: Number((last.privateMb - first.privateMb).toFixed(1)),
      privateSlopeMbPerHour: Number(((last.privateMb - first.privateMb) / elapsedHours).toFixed(2)),
      averageCpuPercent: Number((samples.reduce((sum, item) => sum + item.cpuPercent, 0) / samples.length).toFixed(2)),
      minProcessCount: Math.min(...samples.map((item) => item.processCount)),
      stableWindowCount: samples.every((item) => item.windowCount === initialWindowCount),
      alive: samples.every((item) => item.alive),
      aquariumStable: !aquariumMode || (samples.length > 1 && samples.every((item) => item.aquarium?.visible && item.aquarium.fishCount === 8 && item.aquarium.layoutAssetCount >= 8 && item.aquarium.bubbles === 12 && item.aquarium.activeBubbles === 12 && item.aquarium.schoolGroups >= 1)
        && samples.every((item) => item.aquarium.nodeCount === samples[0].aquarium.nodeCount)
        && samples.at(-1).aquarium.motionTicks > samples[0].aquarium.motionTicks)
    };
    process.stdout.write(`POND_SOAK_SUMMARY:${JSON.stringify(summary)}\n`);
    isQuitting = true;
    app.exit(summary.stableWindowCount && summary.alive && summary.aquariumStable ? 0 : 1);
  }, durationMs);
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  const startupSave = await loadGame();
  if (!startupSave.ok) {
    if (IS_SAVE_STARTUP_VERIFY) {
      process.stdout.write(`POND_SAVE_STARTUP_VERIFY:${JSON.stringify(startupSaveDiagnostics(startupSave.loaded, startupSave.saveFile))}\n`);
      isQuitting = true;
      app.exit(2);
      return;
    }
    const primary = startupSave.loaded.errors?.primary;
    const backup = startupSave.loaded.errors?.backup;
    const detail = [
      '检测到已有存档，但主存档与备份均无法安全读取。',
      '为防止空白状态覆盖原记录，程序已停止启动且不会写入游戏存档。',
      '',
      `存档路径：${startupSave.saveFile}`,
      `主存档：${primary?.code || 'READ_ERROR'} · ${primary?.message || '读取失败'}`,
      `备份：${backup?.code || 'READ_ERROR'} · ${backup?.message || '读取失败'}`
    ].join('\n');
    dialog.showErrorBox('摸鱼搭子：存档读取失败', detail);
    isQuitting = true;
    app.quit();
    return;
  }
  if (IS_SAVE_STARTUP_VERIFY) {
    process.stdout.write(`POND_SAVE_STARTUP_VERIFY:${JSON.stringify(startupSaveDiagnostics(startupSave.loaded, startupSave.saveFile))}\n`);
    saveWriteAllowed = false;
    isQuitting = true;
    app.exit(0);
    return;
  }
  assets = AssetRuntime.buildAssetSnapshot(__dirname, Game.FISH);
  characterLibrary = new CharacterLibrary({ root: path.join(app.getPath('userData'), 'characters'), appRoot: __dirname });
  measurementMap = loadMeasurementMap();
  const migratedMeasurements = Game.repairLegacyMeasurements(gameState, measurementMap);
  if (JSON.stringify(migratedMeasurements) !== JSON.stringify(gameState)) { gameState = migratedMeasurements; saveGame(); }
  if (!AQUARIUM_ENABLED) saveGame();
  try { atomicWriteJson(jsonPath('asset-diagnostics.json'), assets.diagnostics); }
  catch (error) { persistenceError = error.message; }
  registerIpc(); createPetWindow();
  if (AQUARIUM_RUNTIME_ENABLED) createAquariumWindow();
  registerInitialShortcuts(); createTray();
  if (AQUARIUM_RUNTIME_ENABLED) {
    screen.on('display-removed', reclampAquariumWindow);
    screen.on('display-metrics-changed', reclampAquariumWindow);
  }
  startLaunchRequestMonitor();
  tickTimer = setInterval(tick, TICK_MS);
  if (IS_STALE_INSTANCE_VERIFY) process.stdout.write('POND_STALE_INSTANCE_READY\n');
  powerMonitor.on('suspend', () => { gameState = Game.suspend(gameState); saveGame(); broadcastAll(); if (AQUARIUM_RUNTIME_ENABLED) sendTo(aquariumWindow, 'aquarium:window-visibility', false); });
  powerMonitor.on('lock-screen', () => { gameState = Game.suspend(gameState); saveGame(); broadcastAll(); if (AQUARIUM_RUNTIME_ENABLED) sendTo(aquariumWindow, 'aquarium:window-visibility', false); });
  powerMonitor.on('resume', () => { if (petWindow?.isVisible()) { gameState = Game.resume(gameState); saveGame(); broadcastAll(); } if (AQUARIUM_RUNTIME_ENABLED && !aquariumExplicitlyHidden) restoreAquariumPresentation(); });
  powerMonitor.on('unlock-screen', () => { if (petWindow?.isVisible()) { gameState = Game.resume(gameState); saveGame(); broadcastAll(); } if (AQUARIUM_RUNTIME_ENABLED && !aquariumExplicitlyHidden) restoreAquariumPresentation(); });
  if (IS_SMOKE) runSmokeTest();
  else if (IS_PACKAGE_VERIFY) runPackageVerify();
  else if (IS_AQUARIUM_SMOKE) runAquariumSmokeTest();
  else if (IS_SOAK) runSoakTest();
});
app.on('before-quit', () => {
  if (gameState && !gameState.isPaused) gameState = Game.suspend(gameState);
  saveGame(); isQuitting = true; clearInterval(tickTimer); clearInterval(launchSignalTimer);
  if (launchSignalWatcherActive) fs.unwatchFile(launchRequestFile);
  clearTimeout(windowSaveTimer); clearPetPresentationRecovery(); clearAquariumPresentationRecovery(); saveWindowSettings();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});
