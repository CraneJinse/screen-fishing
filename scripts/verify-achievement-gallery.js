'use strict';
// This local review window owns its fixture profile; no player save is loaded.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts', 'achievement-gallery');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'pond-achievement-gallery-')));
const report = { generatedAt: new Date().toISOString(), variants: [], series: [], interactions: [], screenshots: [], errors: [] };
const delay = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: 1280, height: 900, frame: false, show: false, backgroundColor: '#151b29', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.on('console-message', event => { if (event.level === 'error') report.errors.push(event.message); });
  await win.loadFile(path.join(root, 'src/achievement-gallery.html'));
  win.showInactive();
  const js = code => win.webContents.executeJavaScript(code);
  async function settle() { await delay(); await js('Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))'); await delay(); }
  async function change(id, value) { await js(`(()=>{const n=document.getElementById(${JSON.stringify(id)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('${id === 'search' ? 'input' : 'change'}',{bubbles:true}));})()`); await settle(); }
  async function capture(name) { await delay(300); fs.writeFileSync(path.join(out, name + '.png'), (await win.capturePage()).toPNG()); report.screenshots.push(name + '.png'); }
  await settle();
  const initial = await js("[...document.querySelectorAll('#gallery img')].map(i=>({src:i.getAttribute('src'),width:i.naturalWidth,height:i.naturalHeight,error:i.dataset.assetError||null}))");
  assert.equal(initial.length, 71); assert.ok(initial.every(i => i.width === 256 && i.height === 256 && !i.error));
  report.icons = initial; report.interactions.push('all-71-production-images-256x256');
  for (const size of ['64', '128', '256']) {
    await change('size', size);
    for (const theme of ['dark', 'light']) {
      await change('theme', theme);
      const metrics = await js("(()=>{const images=[...document.querySelectorAll('#gallery img')];return {count:images.length,displaySizes:[...new Set(images.map(i=>i.getBoundingClientRect().width))],light:document.body.classList.contains('light'),horizontalOverflow:document.documentElement.scrollWidth-innerWidth,background:getComputedStyle(document.body).backgroundColor};})()");
      assert.equal(metrics.count,71); assert.deepEqual(metrics.displaySizes,[Number(size)]); assert.equal(metrics.light,theme==='light'); assert.ok(metrics.horizontalOverflow<=1);
      report.variants.push({ size, theme, ...metrics });
      await capture(`gallery-${size}-${theme}`);
    }
  }
  const series = await js('PondAchievements.ACHIEVEMENT_SERIES.map(s=>({id:String(s.id),count:s.achievementIds.length}))');
  for (const item of series) {
    await change('series', item.id);
    const count = await js("document.querySelectorAll('#gallery article').length");
    assert.equal(count,item.count); report.series.push({id:item.id,count});
  }
  await change('series','all');
  await change('search','屏幕四角'); assert.equal(await js("document.querySelectorAll('#gallery article').length"),1);
  assert.equal(await js("document.querySelector('#gallery article').dataset.achievementId"),'corners');
  await capture('gallery-corners-search'); report.interactions.push('name-search');
  await change('search','065'); assert.equal(await js("document.querySelectorAll('#gallery article').length"),1); report.interactions.push('original-number-search');
  await change('search','不存在的成就'); assert.equal(await js("document.getElementById('empty').hidden"),false); assert.equal(await js("document.querySelectorAll('#gallery article').length"),0); report.interactions.push('search-empty-state');
  await change('search',''); await change('size','64'); await change('theme','dark');
  win.setSize(480,420); await settle();
  const narrow=await js("({overflow:document.documentElement.scrollWidth-innerWidth,count:document.querySelectorAll('#gallery article').length})");
  assert.ok(narrow.overflow<=1); assert.equal(narrow.count,71); report.interactions.push('narrow-gallery-no-horizontal-overflow'); await capture('gallery-480x420');
  assert.deepEqual(report.errors,[]);
  report.ok=true; fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:true,icons:71,sizeThemeVariants:report.variants.length,series:report.series.length,interactions:report.interactions.length,output:out})); app.quit();
}).catch(error => { fs.mkdirSync(out,{recursive:true});report.ok=false;report.error=error.stack;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.error(error.stack);app.exit(1); });
