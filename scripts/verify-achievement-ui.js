'use strict';
// Only this application's own BrowserWindow and disposable in-memory states.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, BrowserWindow, ipcMain } = require('electron');
const Game = require('../src/game-state-runtime');
const Assets = require('../src/asset-runtime');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts', 'achievement-ui');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'pond-achievement-ui-')));
const report = { generatedAt: new Date().toISOString(), layouts: [], interactions: [], screenshots: [], errors: [] };
let snapshot;
const delay = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  fs.mkdirSync(out, { recursive: true });
  const state = Game.createInitialState(Date.now());
  state.castCount = 99;
  state.stats.totalCatchCount = 321;
  state.achievements = Game.ACHIEVEMENTS.filter(a => a.seriesId === 7 || a.number <= 6).map(a => a.id);
  state.achievementTimes = Object.fromEntries(state.achievements.map((id, i) => [id, Date.now() - i * 10000]));
  state.cornerCasts = { 'top-left': Date.now(), 'bottom-right': Date.now() };
  state.achievementNotice = { ids: state.achievements, source: 'retroactive', at: Date.now() };
  snapshot = { state, catalog: Game.FISH, achievements: Game.ACHIEVEMENTS, packs: Game.PACKS, rarities: Game.RARITIES,
    rarityNames: Game.rarityNames, specialEventCatalog: [], assets: Assets.buildAssetSnapshot(root, Game.FISH), app: { features: { aquarium: false } } };
  ipcMain.handle('game:get', () => snapshot);
  ipcMain.handle('window:panel-ready', (_event, value) => { assert.equal(value.ok, true); return true; });
  ipcMain.handle('game:action', (_event, name, payload) => {
    const result = Game.applyAchievementAction(snapshot.state, { type: name.replace('achievement-', ''), ...payload });
    if (result.ok) snapshot = { ...snapshot, state: result.state };
    return { ...result, snapshot };
  });
  ipcMain.handle('window:close-panel', () => true);
  const win = new BrowserWindow({ width: 960, height: 840, frame: false, show: false, backgroundColor: '#151a27',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('ERR_FILE_NOT_FOUND')) report.errors.push(event.message); });
  await win.loadFile(path.join(root, 'src/panel.html'));
  win.showInactive();
  const js = code => win.webContents.executeJavaScript(code);
  async function settle() { await delay(); await js('Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))'); await delay(); }
  async function capture(name) { await delay(300); fs.writeFileSync(path.join(out, name + '.png'), (await win.capturePage()).toPNG()); report.screenshots.push(name + '.png'); }
  async function change(id, value) { await js(`(()=>{const n=document.getElementById(${JSON.stringify(id)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('${id === 'achievementSearch' ? 'input' : 'change'}',{bubbles:true}));})()`); await settle(); }
  await settle();
  win.webContents.send('panel:navigate', { page: 'achievements' });
  await settle();
  for (const [width, height] of [[480, 420], [640, 560], [960, 840], [1280, 720], [1000, 420]]) {
    win.setSize(width, height); await settle();
    const metrics = await js(`(()=>{const main=document.getElementById('app'), rows=[...document.querySelectorAll('.achievement-row')];const problems=[];
      for(const row of rows){const children=[...row.children].map(n=>n.getBoundingClientRect());if(children[0].right>children[1].left||children[1].right>children[2].left)problems.push(row.dataset.achievement);const desc=row.querySelector('.achievement-condition');if(desc.scrollHeight>desc.clientHeight+1||getComputedStyle(desc).textOverflow==='ellipsis')problems.push('clipped:'+row.dataset.achievement);}
      return {width:innerWidth,height:innerHeight,rows:rows.length,horizontalOverflow:main.scrollWidth-main.clientWidth,problems,font:getComputedStyle(rows[0].querySelector('.achievement-copy>strong')).fontSize,descriptionFont:getComputedStyle(rows[0].querySelector('.achievement-condition')).fontSize,iconSize:rows[0].querySelector('.achievement-art').getBoundingClientRect().width,overviewFont:getComputedStyle(document.querySelector('.achievement-overview strong')).fontSize,invalidNaturalSizes:rows.filter(r=>{const i=r.querySelector('img');return i.naturalWidth!==256||i.naturalHeight!==256}).map(r=>r.dataset.achievement),missingIcons:document.querySelectorAll('.art-missing').length,gridColumns:getComputedStyle(document.querySelector('.achievement-list')).gridTemplateColumns.split(' ').length};})()`);
    assert.equal(metrics.rows, 71); assert.equal(metrics.gridColumns, 1); assert.equal(metrics.font, '16px'); assert.equal(metrics.descriptionFont, '13px'); assert.equal(metrics.iconSize, 64); assert.equal(metrics.overviewFont, '22px');
    assert.ok(metrics.horizontalOverflow <= 1); assert.deepEqual(metrics.problems, []);
    report.layouts.push(metrics); await capture(`achievements-${width}x${height}`);
  }
  win.setSize(960, 840); await settle();
  await js("document.querySelector('[data-achievement-action=filters]').click()"); await settle();
  assert.equal(await js("document.getElementById('achievementFilterControls').hidden"), false); report.interactions.push('expand-filter-controls');
  await change('achievementSeries', '4'); assert.equal(await js("document.querySelectorAll('.achievement-row').length"), 4); report.interactions.push('series-four-pack-filter');
  await change('achievementSeries', '');
  await change('achievementStatus', 'unlocked'); assert.equal(await js("document.querySelectorAll('.achievement-row').length"), state.achievements.length); report.interactions.push('status-filter');
  await change('achievementStatus', '');
  await change('achievementSearch', '找不到的成就'); assert.equal(await js("Boolean(document.querySelector('.achievement-empty'))"), true); await capture('empty-state');
  win.webContents.send('game:update', snapshot); await settle();
  assert.equal(await js("document.activeElement.id"), 'achievementSearch');
  assert.equal(await js("document.getElementById('achievementSearch').value"), '找不到的成就'); report.interactions.push('snapshot-preserves-search-focus');
  await js("document.querySelector('.achievement-empty button').click()"); await settle(); assert.equal(await js("document.querySelectorAll('.achievement-row').length"), 71); report.interactions.push('search-empty-reset');
  for (const id of ['first-cast', 'first-catch', 'ten-catches', 'catches-25']) {
    await js(`document.querySelector('[data-achievement="${id}"]').click()`); await settle();
    await js("document.querySelector('[data-achievement-action=track]').click()"); await settle();
    await js("document.getElementById('closeModal').click()"); await settle();
  }
  assert.equal(snapshot.state.achievementTracking.length, 3); report.interactions.push('three-tracking-limit-with-feedback');
  await change('achievementStatus', 'tracked'); assert.equal(await js("document.querySelectorAll('.achievement-row').length"), 3);
  await change('achievementStatus', ''); assert.equal(await js("document.querySelector('#achievementTitle') === null && !document.querySelector('.achievements-page').textContent.includes('称号')"), true); report.interactions.push('title-section-removed');
  await js("document.querySelector('[data-achievement-action=acknowledge]').click()"); await settle(); assert.equal(snapshot.state.achievementNotice, null); report.interactions.push('retroactive-summary-acknowledgement');
  await delay(2300);
  win.setSize(480, 420); await settle();
  await js("document.querySelector('.achievement-list').scrollIntoView({block:'start'});document.getElementById('app').scrollTop-=document.querySelector('.page-header').offsetHeight+12"); await settle();
  await capture('achievements-480x420-list');
  win.setSize(960, 840); await settle();
  await change('achievementSort', 'near'); assert.equal(await js("document.querySelector('.achievement-row').classList.contains('is-locked')"), true); report.interactions.push('near-completion-sort');
  await change('achievementSearch', '屏幕四角');
  await js("document.querySelector('[data-achievement=corners]').click()"); await settle();
  assert.equal(await js("document.querySelectorAll('.achievement-corners span').length"), 4);
  snapshot.state.cornerCasts['bottom-left'] = Date.now();
  await js("document.querySelector('[data-achievement-action=track]').focus()");
  win.webContents.send('game:update', snapshot); await settle();
  assert.equal(await js("document.querySelectorAll('.achievement-corners .done').length"), 3);
  assert.equal(await js("document.activeElement.dataset.achievementAction"), 'track');
  report.interactions.push('live-corner-detail-refresh-preserves-focus');
  await capture('corners-detail-wide');
  win.setSize(480,420); await settle(); await capture('corners-detail-480x420');
  const dialog = await js("(()=>{const n=document.getElementById('detailModal'),r=n.getBoundingClientRect();return {overflow:n.scrollWidth-n.clientWidth,left:r.left,right:r.right,height:r.height,windowHeight:innerHeight}})()");
  assert.ok(dialog.overflow<=1 && dialog.left>=0 && dialog.right<=480 && dialog.height<=dialog.windowHeight); report.interactions.push('corner-detail-four-regions-narrow-scroll');
  await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); await delay();
  assert.equal(await js("document.getElementById('detailModal').open"), false); report.interactions.push('keyboard-escape-dialog');
  await js("document.querySelector('[data-achievement=corners]').focus()");
  win.focus(); await delay();
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); await delay();
  assert.equal(await js("document.getElementById('detailModal').open"), true); report.interactions.push('keyboard-enter-detail');
  assert.deepEqual(report.errors, []);
  report.artComplete = report.layouts.every(l => l.missingIcons === 0 && l.invalidNaturalSizes.length === 0);
  if (process.argv.includes('--require-art')) assert.equal(report.artComplete, true, 'All 71 production icons must be installed');
  report.ok = true; fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:true,layouts:report.layouts.length,interactions:report.interactions.length,artComplete:report.artComplete,output:out})); app.quit();
}
app.whenReady().then(run).catch(error => { fs.mkdirSync(out,{recursive:true}); report.ok=false; report.error=error.stack; fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)); console.error(error.stack); app.exit(1); });
