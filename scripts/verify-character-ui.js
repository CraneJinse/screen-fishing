'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { PNG } = require('pngjs');
const { CharacterLibrary } = require('../src/character-library');
const Game = require('../src/game-state-runtime'), Assets = require('../src/asset-runtime');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'artifacts/character-ui');
const disposable = fs.mkdtempSync(path.join(os.tmpdir(), 'pond-character-ui-'));
app.setPath('userData', disposable);
const delay = n => new Promise(r => setTimeout(r, n));
async function run() {
  fs.mkdirSync(output, { recursive: true });
  const library = new CharacterLibrary({ root: path.join(disposable, 'characters'), appRoot: root });
  const fixture = path.join(disposable, 'fixture'); fs.mkdirSync(fixture);
  fs.cpSync(path.join(root, 'assets/pet/v1-runtime/actions'), path.join(fixture, 'actions'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'action-manifest.json'), JSON.stringify(library.template));
  const strip = PNG.sync.read(fs.readFileSync(path.join(fixture, 'actions/idle.png'))), png = new PNG({ width: 384, height: 416 });
  PNG.bitblt(strip, png, 0, 0, 384, 416, 0, 0); fs.writeFileSync(path.join(fixture, 'preview.png'), PNG.sync.write(png));
  const design = { character: '同一套原版美术的测试副本，仅用于验证切换，不作为新角色交付。', boat: '木船', rod: '原版钓组' };
  fs.writeFileSync(path.join(fixture, 'character.json'), JSON.stringify({ format: 'screen-fishing-character', schemaVersion: 1, id: 'qa-copy', name: '验证副本', description: '不随游戏分发', status: 'ready', preview: 'preview.png', actionManifest: 'action-manifest.json', design }));
  library.import(fixture);
  const draft = path.join(disposable, 'draft'); fs.mkdirSync(draft); fs.writeFileSync(path.join(draft, 'character.json'), JSON.stringify({ format: 'screen-fishing-character', schemaVersion: 1, id: 'qa-draft', name: '未完成设计', status: 'draft', design })); library.import(draft);
  let state = Game.createInitialState(Date.now()); state.fishingState = 'waiting'; state.stateEndsAt = Date.now() + 300000;
  const before = JSON.stringify(state), baseAssets = Assets.buildAssetSnapshot(root, Game.FISH), errors = [];
  const snapshot = () => ({ state, catalog: Game.FISH, packs: Game.PACKS, rarities: Game.RARITIES, rarityNames: Game.rarityNames, achievements: Game.ACHIEVEMENTS, assets: library.assets(baseAssets), characters: library.snapshot(), app: { features: { aquarium: false }, shortcuts: {} } });
  const windowFor = () => { const w = new BrowserWindow({ width: 640, height: 560, show: false, frame: false, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } }); w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); }); return w; };
  const panel = windowFor(), pet = windowFor();
  ipcMain.handle('game:get', snapshot); ipcMain.handle('window:panel-ready', () => true); ipcMain.handle('window:set-click-through', () => true); ipcMain.handle('game:legacy-import', snapshot);
  ipcMain.handle('characters:action', (event, action, id) => {
    assert.equal(event.sender, panel.webContents);
    try { if (action === 'select') library.select(id); else if (action === 'refresh') library.reload(); else if (action === 'import') return { ok: true, canceled: true }; else return { ok: false, error: '验证失败提示' };
      const value = snapshot(); panel.webContents.send('game:update', value); pet.webContents.send('game:update', value); return { ok: true, snapshot: value };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  await panel.loadFile(path.join(root, 'src/panel.html')); await pet.loadFile(path.join(root, 'src/index.html')); await delay(800);
  await panel.webContents.executeJavaScript('document.querySelector("[data-page=characters]").click()'); await delay(200);
  await panel.webContents.executeJavaScript('document.querySelector("[data-character-id=design-04]").click()'); await delay(600);
  assert.equal(library.selectedId, 'design-04');
  assert.equal(JSON.stringify(state), before);
  const lemon = await pet.webContents.executeJavaScript('({id:document.body.dataset.character,url:document.querySelector("#sprite").style.backgroundImage,visible:!document.querySelector("#sprite").hidden})');
  assert.equal(lemon.id, 'design-04'); assert(lemon.visible && lemon.url.includes('design-04'));
  const layouts = [];
  for (const [width, height] of [[480,420],[640,560],[960,720]]) {
    panel.setSize(width, height); await delay(120);
    const layout = await panel.webContents.executeJavaScript(`(() => { const cards=[...document.querySelectorAll('.character-card')], controls=[...document.querySelectorAll('.character-tools button')]; return {width:innerWidth, count:cards.length, fits:cards.every(c=>{const r=c.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})&&document.documentElement.scrollWidth===innerWidth, buttons:controls.every(b=>b.getBoundingClientRect().height>=32),draftDisabled:document.querySelector('[data-character-id="qa-draft"]').disabled}; })()`);
    assert(layout.fits && layout.buttons && layout.count === 4 && layout.draftDisabled); layouts.push(layout);
  }
  await panel.webContents.executeJavaScript('document.querySelector("[data-character-id=qa-copy]").click()'); await delay(600);
  assert.equal(library.selectedId, 'qa-copy');
  const custom = await pet.webContents.executeJavaScript('({id:document.body.dataset.character,url:document.querySelector("#sprite").style.backgroundImage,visible:!document.querySelector("#sprite").hidden})');
  assert.equal(custom.id, 'qa-copy'); assert(custom.visible && custom.url.includes('qa-copy'));
  assert.equal(JSON.stringify(state), before);
  const phases = [];
  for (const phase of ['bite_ready','casting','catch_flight','catch_land']) {
    state = { ...state, fishingState: phase, stateStartedAt: Date.now() }; const phaseBefore = JSON.stringify(state);
    const next = library.selectedId === 'classic' ? 'qa-copy' : 'classic';
    await panel.webContents.executeJavaScript(`window.desktopPond.characterAction('select',${JSON.stringify(next)})`); await delay(240);
    assert.equal(JSON.stringify(state), phaseBefore); phases.push(phase);
  }
  await panel.webContents.executeJavaScript('document.querySelector("[data-character=import]").click()'); await delay(150); assert.equal(library.snapshot().entries.length, 4);
  await panel.webContents.executeJavaScript('document.querySelector("[data-character=folder]").click()'); await delay(100);
  assert.equal(await panel.webContents.executeJavaScript('document.querySelector("#toast").textContent'), '验证失败提示');
  fs.writeFileSync(path.join(output, 'library.png'), (await panel.capturePage()).toPNG());
  library.packs.delete('qa-copy'); library.packs.delete('qa-draft'); library.select('design-04');
  panel.webContents.send('game:update', snapshot()); await delay(300);
  assert.equal(library.snapshot().entries.length, 2);
  fs.writeFileSync(path.join(output, 'bundled-characters.png'), (await panel.capturePage()).toPNG());
  library.select('classic'); library.packs.clear(); panel.webContents.send('game:update', snapshot()); await delay(2400);
  assert(await panel.webContents.executeJavaScript('document.querySelector("#toast").hidden'));
  fs.writeFileSync(path.join(output, 'library-default.png'), (await panel.capturePage()).toPNG());
  assert.deepEqual(errors, []);
  const report = { ok: true, layouts, rendererSwitched: custom, statePreserved: true, phases, importCancel: true, errorFeedback: true, fixtureOnly: true };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  panel.destroy(); pet.destroy(); app.quit();
}
app.whenReady().then(run).catch(error => { console.error(error.stack); app.exit(1); });
