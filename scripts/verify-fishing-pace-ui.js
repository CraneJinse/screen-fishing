'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {app,BrowserWindow,ipcMain}=require('electron'),G=require('../src/game-state-runtime'),Assets=require('../src/asset-runtime');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts/fishing-icon-ui'),delay=ms=>new Promise(r=>setTimeout(r,ms));
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'pond-pace-ui-')));app.on('window-all-closed',()=>{});
const snapshot={state:G.createInitialState(),assets:Assets.buildAssetSnapshot(root,G.FISH),specialEventCatalog:require('../src/special-events').runtimeRegistry()};
let actions=[],win;const errors=[],results=[];
ipcMain.handle('game:get',()=>snapshot);ipcMain.handle('window:set-click-through',()=>true);
ipcMain.handle('game:action',(_,action)=>{actions.push(action);snapshot.state=G.transition(snapshot.state,action,()=>.5);return snapshot;});
ipcMain.handle('window:pet-bounds',()=>win.getBounds());ipcMain.handle('window:move-pet',()=>true);
app.whenReady().then(async()=>{fs.mkdirSync(out,{recursive:true});
 win=new BrowserWindow({width:280,height:230,show:false,frame:false,backgroundColor:'#151a27',webPreferences:{preload:path.join(root,'preload.js'),contextIsolation:true,sandbox:true}});
 win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
 await win.loadFile(path.join(root,'src/index.html'));await delay(800);
 for(const scale of [.75,1,1.25])for(const state of ['waiting','bite_urgent','bite_loop','bite_ready']){
 snapshot.state={...G.createInitialState(),castCount:6,settings:{...G.defaultSettings,petScale:scale},fishingState:state,stateStartedAt:Date.now(),stateEndsAt:state==='bite_ready'?null:Date.now()+30000,pendingCatch:{encounterType:'fish',fishId:G.FISH[0].id,randomUnhook:false,variant:'normal'}};
 win.setSize(Math.ceil(280*scale),Math.ceil(230*scale));win.webContents.send('game:update',snapshot);await delay(500);
 const ui=await win.webContents.executeJavaScript(`(()=>{const signal=document.getElementById('biteSignal'),body=document.getElementById('petBody');return {state:document.body.dataset.state,action:document.body.dataset.action,hidden:signal.hidden,signalAnimation:getComputedStyle(signal).animationName,signalImage:getComputedStyle(signal).backgroundImage,border:getComputedStyle(signal).borderTopWidth,shadow:getComputedStyle(signal).boxShadow,text:signal.textContent,bodyAnimation:getComputedStyle(body).animationName,reelDisabled:document.getElementById('quickReel').disabled,castDisabled:document.getElementById('quickCast').disabled}})()`);
 assert.equal(ui.hidden,state==='waiting');assert.equal(ui.border,'0px');assert.equal(ui.shadow,'none');assert.equal(ui.text,'');assert.ok(ui.signalImage.includes(state==='bite_urgent'?'bite-red.svg':'bite-yellow.svg'));assert.equal(ui.action,['bite_loop','bite_urgent'].includes(state)?'bite_loop':'waiting');
 if(state==='bite_ready'){assert.equal(ui.signalAnimation,'none');assert.equal(ui.bodyAnimation,'none');assert.equal(ui.reelDisabled,false);assert.equal(ui.castDisabled,true);}
 fs.writeFileSync(path.join(out,`${state}-${scale}.png`),(await win.capturePage()).toPNG());results.push({scale,...ui});
 }
 await win.webContents.executeJavaScript("document.getElementById('quickReel').click()");await delay(100);assert.equal(actions.at(-1),'reel');assert.equal(snapshot.state.fishingState,'reel_pull');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:true,results,quickReel:true,errors},null,2));console.log(JSON.stringify({ok:true,layouts:results.length,quickReel:true}));app.exit(0);
}).catch(e=>{console.error(e);app.exit(1);});
