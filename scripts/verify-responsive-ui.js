'use strict';

// Render the production pages with disposable in-memory fixtures; never open a
// player save or capture any other application's window.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, BrowserWindow, ipcMain } = require('electron');
const Game = require('../src/game-state-runtime');
const Events = require('../src/special-events');
const Assets = require('../src/asset-runtime');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'responsive-ui');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'screen-fishing-responsive-')));
const delay = (ms = 70) => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
const report = { generatedAt: new Date().toISOString(), panels: [], results: [], interactions: [] };
let snapshot;
let lastRoute;
let closedResults = 0;

function fixture() {
  const state = Game.createInitialState(Date.now());
  state.inventory = Game.FISH.slice(0, 24).map((fish, i) => ({
    inventoryId: `review-${i}`, catchId: `review-${i}`, resultId: fish.id, fishId: fish.id,
    name: fish.name, rarity: fish.rarity, rarityName: fish.rarityName, pack: fish.pack, packName: fish.packName,
    lengthCm: 12.3, weightKg: .012, size: '12.3 cm', weight: '12 g', valueCoins: 12345,
    variant: ['normal', 'alternate', 'golden', 'iridescent'][i % 4], locked: i === 3,
    caughtAt: Date.now(), at: Date.now(), measurementVersion: 5
  }));
  state.history = state.inventory.map(item => ({ ...item, type: 'fish' }));
  Object.assign(state.stats, {
    uniqueSpeciesCount: 24,
    totalCatchCount: 24,
    largestLengthCm: 128.46,
    largestWeightKg: 18.724
  });
  state.wallet.balance = 123456789;
  state.equipment = { ownedIds: [...Game.EQUIPMENT_ORDER], activeBaitId: 'bait-moon' };
  state.settings.autoCastEnabled = true;
  for (const item of state.inventory) state.collection[item.fishId] = {
    count: 1, firstAt: Date.now(), maxLengthCm: 12.3, maxWeightKg: .012,
    variants: { [item.variant]: { count: 1, firstAt: Date.now(), maxLengthCm: 12.3, maxWeightKg: .012 } }
  };
  state.specialEventCollection = { schemaVersion: 1, entries: Object.fromEntries(
    Events.runtimeRegistry().map(item => [item.id, { count: 2, firstFoundAt: Date.now(), lastFoundAt: Date.now() }])) };
  return { state, catalog: Game.FISH, packs: Game.PACKS, rarities: Game.RARITIES,
    rarityNames: Game.rarityNames, achievements: Game.ACHIEVEMENTS,
    specialEventCatalog: Events.runtimeRegistry(),
    assets: Assets.buildAssetSnapshot(root, Game.FISH),
    app: { features: { aquarium: false }, shortcuts: { pet: 'Ctrl+Shift+M', panel: 'Ctrl+Shift+P', fishing: 'Ctrl+Shift+Space', petRegistered: true, panelRegistered: true, fishingRegistered: true } } };
}
function windowFor(width, height) {
  const win = new BrowserWindow({ width, height, frame: false, show: false, backgroundColor: '#151a27',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  return win;
}
async function settle(win) {
  await delay();
  await win.webContents.executeJavaScript('Promise.all([...document.images].map(img => img.decode().catch(() => {})))');
  await delay(30);
}
async function capture(win, name) {
  await delay(320);
  fs.writeFileSync(path.join(output, `${name}.png`), (await win.capturePage()).toPNG());
}
async function navigate(win, route) {
  win.webContents.send('panel:navigate', route);
  await settle(win);
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  snapshot = fixture();
  ipcMain.handle('game:get', () => snapshot);
  ipcMain.handle('window:panel-ready', (_event, value) => { assert.equal(value.ok, true); return true; });
  ipcMain.handle('window:close-result', () => { closedResults++; return true; });
  ipcMain.handle('window:open-panel', (_event, route) => { lastRoute = route; return true; });
  ipcMain.handle('window:close-panel', () => true);
  const panel = windowFor(640, 560);
  await panel.loadFile(path.join(root, 'src/panel.html'));
  panel.showInactive();
  await settle(panel);
  const routes = ['home', 'encyclopedia', 'warehouse', 'special-events', 'special-event-detail',
    'shop', 'achievements', 'characters', 'history', 'settings', 'help', 'fish-detail', 'inventory-detail', 'catch-detail'];
  for (const [width, height] of [[480, 420], [640, 560], [800, 700], [960, 840], [1280, 720], [1000, 420]]) {
    panel.setSize(width, height);
    for (const page of routes) {
      await navigate(panel, { page, seriesId: 'research_salvage', fishId: 'fish-1', inventoryId: 'review-3', catchId: 'review-3' });
      const metrics = await panel.webContents.executeJavaScript(`(() => {
        const main = document.getElementById('app');
        const rect = main.getBoundingClientRect();
        const nodes = [...main.querySelectorAll('button,input,select,.special-entry,.detail-card')].filter(n => n.getClientRects().length);
        const overflow = nodes.filter(n => { const r=n.getBoundingClientRect(); return r.left < rect.left-1 || r.right > rect.right+1; }).map(n=>n.className || n.id);
        const grid = document.querySelector('.catalog-grid,.inventory-grid,.special-series-grid,.home-grid,.achievement-list,.shop-grid');
        return { width:innerWidth,height:innerHeight,bodyFont:getComputedStyle(document.body).fontSize,
          buttonFont:getComputedStyle(document.querySelector('.back-button')||document.querySelector('.home-card')).fontSize,
          overflow, scrollOverflow:main.scrollWidth-main.clientWidth,
          columns:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').length:0,
          iconWidth:document.querySelector('.special-series-card img')?.getBoundingClientRect().width,
          titleFont:document.querySelector('.special-series-card strong')?getComputedStyle(document.querySelector('.special-series-card strong')).fontSize:null };
      })()`);
      report.panels.push({ page, ...metrics });
      assert.equal(metrics.bodyFont, '14px', `${page} base font changed`);
      assert.equal(metrics.buttonFont, '14px', `${page} button font changed`);
      assert.equal(metrics.overflow.length, 0, `${page} ${width}: overflowing ${metrics.overflow}`);
      assert.ok(metrics.scrollOverflow <= 1, `${page} ${width}: horizontal scroll ${metrics.scrollOverflow}`);
      if (page === 'home') assert.deepEqual(await panel.webContents.executeJavaScript(`(() => ({
        cards: document.querySelectorAll('.home-card').length,
        characters: !!document.querySelector('[data-page=characters]'),
        hidePet: !!document.querySelector('[data-action=hide-pet]'),
        title: document.querySelector('.page-header h1')?.textContent,
        records: document.querySelector('.page-header small')?.textContent
      }))()`), {
        cards: 9,
        characters: true,
        hidePet: false,
        title: '个人记录',
        records: '最长记录 128.5 cm · 最沉记录 18.72 kg'
      });
      if (page === 'special-events') { assert.equal(metrics.iconWidth, 88); assert.equal(metrics.titleFont, '18px'); }
      if (page === 'shop') {
        const shop = await panel.webContents.executeJavaScript(`(() => ({
          sections:document.querySelectorAll('.shop-section').length,
          cards:document.querySelectorAll('.shop-card').length,
          squareIcons:[...document.querySelectorAll('.shop-icon-frame')].every(n=>Math.abs(n.getBoundingClientRect().width-n.getBoundingClientRect().height)<1),
          equipmentNames:[...document.querySelectorAll('.equipment-card h3')].map(n=>n.textContent),
          activeBait:document.querySelector('.equipment-card.equipped h3')?.textContent,
          vertical:[...document.querySelectorAll('.shop-card')].every(n=>{const i=n.querySelector('.shop-icon-frame').getBoundingClientRect(),t=n.querySelector('h3').getBoundingClientRect();return i.bottom<=t.top+1})
        }))()`);
        assert.deepEqual(shop.equipmentNames, ['自动抛竿鱼竿','鲜香饵团','月光磷虾','星虹秘饵']);
        assert.equal(shop.sections, 2); assert.equal(shop.cards, 8); assert.equal(shop.squareIcons, true); assert.equal(shop.vertical, true); assert.equal(shop.activeBait, '月光磷虾');
      }
      if (page === 'settings') {
        assert.ok(await panel.webContents.executeJavaScript("!document.getElementById('autoCastEnabled').disabled && document.getElementById('fishingShortcut').value.length>0"));
      }
      if (['special-events', 'warehouse', 'home', 'shop'].includes(page) && [480, 800, 960, 1280].includes(width)) await capture(panel, `${page}-${width}x${height}`);
      if (page === 'encyclopedia') {
        assert.ok(await panel.webContents.executeJavaScript(`(() => {
          const cards=[...document.querySelector('.catalog-grid').querySelectorAll('.icon-card')];
          const columns=getComputedStyle(cards[0].parentElement).gridTemplateColumns.split(' ').length;
          cards[0].focus();cards[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
          return document.activeElement===cards[columns];
        })()`), `keyboard columns ${width}`);
      }
    }
  }
  for (const page of ['encyclopedia', 'warehouse', 'special-events']) {
    const samples = report.panels.filter(row => row.page === page);
    assert.ok(samples.find(row => row.width === 1280).columns > samples.find(row => row.width === 480).columns, `${page} grid never reflows`);
  }
  // Scrolled content must remain visually below the shared sticky page header.
  // Check the actual painted element at a grid of points instead of relying on
  // bounding boxes: normal content is allowed to pass underneath, but it must
  // never win hit testing over the opaque header.
  for (const [width, height] of [[480, 420], [800, 700], [960, 840]]) {
    panel.setSize(width, height);
    for (const page of routes) {
      await navigate(panel, { page, seriesId: 'research_salvage', fishId: 'fish-1', inventoryId: 'review-3', catchId: 'review-3' });
      if (page === 'warehouse') {
        await panel.webContents.executeJavaScript("document.querySelector('[data-action=list-sort-toggle]')?.click()");
        await settle(panel);
      }
      const occlusion = await panel.webContents.executeJavaScript(`(async () => {
        const main = document.getElementById('app');
        const header = main?.querySelector('.page-header');
        if (!main || !header) return { page:'${page}', width:${width}, skipped:true, leaks:[] };
        const maxScroll = Math.max(0, main.scrollHeight - main.clientHeight);
        main.scrollTop = Math.min(maxScroll, Math.max(80, header.offsetHeight + 16));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const rect = header.getBoundingClientRect();
        const leaks = [];
        for (let y = Math.ceil(rect.top + 3); y <= Math.floor(rect.bottom - 3); y += 7) {
          for (let x = Math.ceil(rect.left + 3); x <= Math.floor(rect.right - 14); x += 11) {
            const top = document.elementFromPoint(x, y);
            if (top && top !== header && !header.contains(top)) {
              leaks.push(top.id || String(top.className || top.tagName));
            }
          }
        }
        return { page:'${page}', width:${width}, skipped:maxScroll===0, scrollTop:main.scrollTop,
          headerZ:getComputedStyle(header).zIndex, leaks:[...new Set(leaks)] };
      })()`);
      report.interactions.push({ stickyHeader: occlusion });
      assert.deepEqual(occlusion.leaks, [], `${page} ${width}: content painted above sticky header: ${occlusion.leaks}`);
      if (page === 'warehouse') await capture(panel, `warehouse-scrolled-menu-${width}x${height}`);
    }
  }
  // Narrow toolbar controls still filter, search and open the bulk-sale UI.
  panel.setSize(480, 420);
  await navigate(panel, { page: 'warehouse' });
  const toolbar = await panel.webContents.executeJavaScript(`(() => {
    if (!document.querySelector('.list-sort-menu')) document.querySelector('[data-action="list-sort-toggle"]').click();
    const sortOptions=document.querySelectorAll('.list-sort-menu button').length;
    document.querySelector('.list-sort-menu button').click();
    document.querySelector('[data-action="list-filter-toggle"]').click();
    const filterVisible=!!document.querySelector('.multi-filter-panel');
    const input=document.querySelector('.list-search');input.value='不存在的鱼';input.dispatchEvent(new Event('input',{bubbles:true}));
    const empty=!!document.querySelector('.empty-state');
    const reset=document.querySelector('.list-search');reset.value='';reset.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-action="toggle-bulk"]').click();
    return {sortOptions,filterVisible,empty,bulk:document.querySelectorAll('.inventory-check').length>0};
  })()`);
  assert.deepEqual(toolbar, { sortOptions: 4, filterVisible: true, empty: true, bulk: true });
  report.interactions.push(toolbar);
  await capture(panel, 'warehouse-bulk-filter-480');
  snapshot.state.equipment = { ownedIds: [], activeBaitId: null };
  snapshot.state.settings.autoCastEnabled = false;
  panel.webContents.send('game:update', snapshot);
  await navigate(panel, { page: 'settings' });
  const lockedEquipmentSettings = await panel.webContents.executeJavaScript(`(() => ({
    autoDisabled:document.getElementById('autoCastEnabled').disabled,
    autoUnchecked:!document.getElementById('autoCastEnabled').checked,
    fishingShortcut:document.getElementById('fishingShortcut').value
  }))()`);
  assert.equal(lockedEquipmentSettings.autoDisabled, true);
  assert.equal(lockedEquipmentSettings.autoUnchecked, true);
  assert.equal(lockedEquipmentSettings.fishingShortcut, 'Ctrl+Shift+Space');
  report.interactions.push(lockedEquipmentSettings);
  panel.hide();

  const result = windowFor(168, 176);
  await result.loadFile(path.join(root, 'src/result.html'));
  result.showInactive();
  const cases = Events.runtimeRegistry().map(event => ({ ...event, type: 'special', eventId: event.id,
    first: event.id.endsWith('001'), count: 1234 }));
  cases.push({ type: 'random_unhook' });
  for (const variant of ['normal', 'alternate', 'golden', 'iridescent']) cases.push({
    ...snapshot.state.inventory[0], type: 'fish', variant, first: true, recordLength: true
  });
  for (const [width, height] of [[152, 159], [168, 176], [200, 210]]) {
    result.setSize(width, height);
    for (const item of cases) {
      snapshot.resultCard = item;
      result.webContents.send('game:update', snapshot);
      await settle(result);
      const metrics = await result.webContents.executeJavaScript(`(() => {
        const card=document.getElementById('catchCard');
        const nodes=[...card.children].filter(n=>!n.hidden);const bounds=card.getBoundingClientRect();
        const rects=nodes.map(n=>{const r=n.getBoundingClientRect();return {id:n.id||n.className,top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}});
        return { rects,overlap:rects.some((r,i)=>i>0&&r.top<rects[i-1].bottom-.5),
          outside:rects.some(r=>r.bottom>bounds.bottom-2||r.right>bounds.right-2||r.left<bounds.left+2),
          imageContained:(()=>{const a=document.querySelector('.fish-art').getBoundingClientRect(),i=document.getElementById('fishImage').getBoundingClientRect();return i.top>=a.top-1&&i.bottom<=a.bottom+1})(),
          badgesHidden:document.getElementById('badges').hidden,hintHidden:card.querySelector('small').hidden,
          description:document.getElementById('measure').textContent, imageLoaded:document.getElementById('fishImage').naturalWidth>0,
          forbidden:card.textContent.includes('随机脱钩 · 不影响其他进度')||card.textContent.includes('点击查看收藏') };
      })()`);
      report.results.push({ id: item.id || item.type + ':' + (item.variant || ''), width, ...metrics });
      assert.ok(!metrics.overlap && !metrics.outside, `${item.id || item.type} ${width}: ${JSON.stringify(metrics)}`);
      assert.ok(metrics.imageLoaded && metrics.imageContained && !metrics.forbidden, `image overflow ${item.id || item.type} ${width}`);
      if (item.type === 'special') { assert.equal(metrics.description, item.description); assert.ok(metrics.hintHidden); }
      if (item.type === 'random_unhook') assert.ok(metrics.badgesHidden);
      if (['DB-027','RS-001','EC-001'].includes(item.id) || item.type !== 'special') await capture(result, `result-${item.id || item.type+'-'+item.variant}-${width}`);
    }
  }
  for (const item of [cases[0], { type: 'random_unhook' }, cases.at(-1)]) {
    snapshot.resultCard=item;result.webContents.send('game:update',snapshot);await settle(result);
    lastRoute=null;const before=closedResults;
    await result.webContents.executeJavaScript("document.getElementById('catchCard').click()");await delay();
    assert.equal(closedResults,before+1);
    assert.equal(lastRoute?.page||null,item.type==='special'?'special-event-detail':item.type==='fish'?'fish-detail':null);
  }
  assert.deepEqual(errors, []);
  report.ok = true;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok:true, panels:report.panels.length, resultCards:report.results.length, output }));
  app.quit();
}
app.whenReady().then(run).catch(error => {
  report.ok=false;report.error=error.stack;report.consoleErrors=errors;
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.error(error.stack);app.exit(1);
});
