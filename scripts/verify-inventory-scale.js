'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {app,BrowserWindow,ipcMain}=require('electron'),G=require('../src/game-state-runtime'),Assets=require('../src/asset-runtime');
const root=path.resolve(__dirname,'..'),results=[],errors=[];let snapshot;
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'pond-inventory-scale-')));
app.on('window-all-closed',()=>{});
const assets=Assets.buildAssetSnapshot(root,G.FISH);
app.whenReady().then(async()=>{
 ipcMain.handle('game:get',()=>snapshot);ipcMain.handle('window:panel-ready',()=>true);ipcMain.handle('window:close-panel',()=>true);
 for(const count of [100,2000,10000]){
  const s=G.createInitialState();s.inventory=Array.from({length:count},(_,i)=>{const f=G.FISH[i%152];return{...f,resultId:f.id,fishId:f.id,inventoryId:`scale-${i}`,caughtAt:i,lengthCm:5,weightKg:.01,valueCoins:20,variant:'normal'};});
  snapshot={state:s,catalog:G.FISH,packs:G.PACKS,rarities:G.RARITIES,rarityNames:G.rarityNames,achievements:G.ACHIEVEMENTS,specialEventCatalog:[],assets,app:{features:{aquarium:false},shortcuts:{}}};
  const win=new BrowserWindow({width:960,height:840,show:false,webPreferences:{preload:path.join(root,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});await win.loadFile(path.join(root,'src/panel.html'));await new Promise(r=>setTimeout(r,100));
  const started=performance.now();win.webContents.send('panel:navigate',{page:'warehouse'});
  const metrics=await win.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(()=>{const app=document.getElementById('app');resolve({cards:document.querySelectorAll('.inventory-card').length,nodes:document.querySelectorAll('*').length,overflow:app.scrollWidth-app.clientWidth})},0))`);
  const renderMs=performance.now()-started;assert.equal(metrics.cards,count);assert.ok(metrics.overflow<=1);
  const ping=performance.now();await win.webContents.executeJavaScript('1+1');const responseMs=performance.now()-ping;
  results.push({count,renderMs,responseMs,...metrics});win.destroy();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'artifacts/inventory-scale-ui.json'),JSON.stringify({ok:true,results,errors},null,2));console.log(JSON.stringify(results));app.exit(0);
}).catch(e=>{console.error(e.stack);app.exit(1)});
