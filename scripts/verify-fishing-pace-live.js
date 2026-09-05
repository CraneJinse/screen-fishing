'use strict';
// Run with Electron via a parent that keeps stdout/stderr open. Profile is disposable.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {app,ipcMain,BrowserWindow}=require('electron'),G=require('../src/game-state-runtime');
const profile=process.env.POND_PACE_VERIFY_DIR;if(!profile)throw Error('Disposable test profile required');
process.env.POND_STALE_INSTANCE_VERIFY='1';process.env.POND_STALE_INSTANCE_VERIFY_DIR=profile;
const resume=process.argv.includes('--resume'),out=path.resolve(__dirname,'../artifacts'),file=path.join(profile,'screen-fishing-save.json');
if(!resume){fs.mkdirSync(profile,{recursive:true});const s=G.createInitialState();s.settings.petShortcut='Control+Alt+Shift+F10';s.settings.panelShortcut='Control+Alt+Shift+F11';fs.writeFileSync(file,JSON.stringify(s));}
const handlers=new Map(),original=ipcMain.handle.bind(ipcMain);ipcMain.handle=(k,f)=>{handlers.set(k,f);return original(k,f);};require('../main');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout){const start=Date.now();while(Date.now()-start<timeout){const x=await fn();if(x)return x;await delay(50);}throw Error('Timed out');}
(async()=>{await until(()=>handlers.has('game:get'),10000);const snapshot=()=>handlers.get('game:get')();
 if(!resume){await until(async()=>(await snapshot()).state.fishingState==='idle',5000);const start=Date.now();handlers.get('game:action')({},'cast');const bite=await until(async()=>{const s=(await snapshot()).state;return s.fishingState==='bite_intro'&&s;},12000);const firstMs=Date.now()-start;assert(firstMs>=9800&&firstMs<11500);
 const pending=bite.pendingCatch;const ready=await until(async()=>{const s=(await snapshot()).state;return s.fishingState==='bite_ready'&&s;},32000);assert.deepEqual(ready.pendingCatch,pending);assert.equal(ready.catches,0);
 await delay(200);const disk=JSON.parse(fs.readFileSync(file));assert.equal(disk.fishingState,'bite_ready');assert.deepEqual(disk.pendingCatch,pending);
 fs.writeFileSync(path.join(out,'fishing-pace-live.json'),JSON.stringify({firstMs,readyAfterMs:Date.now()-start,heldCatch:true,persisted:true},null,2));
 }else{const before=(await snapshot()).state;assert.equal(before.fishingState,'bite_ready');assert.equal(before.catches,0);
 await until(()=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/src/index.html')&&!w.webContents.isLoading()),10000);await handlers.get('window:show-pet')();await until(()=>BrowserWindow.getAllWindows().some(w=>w.isVisible()),5000);await handlers.get('window:hide-pet')();assert.equal((await snapshot()).state.isPaused,true);await handlers.get('window:show-pet')();assert.equal((await snapshot()).state.fishingState,'bite_ready');assert.deepEqual((await snapshot()).state.pendingCatch,before.pendingCatch);
 handlers.get('game:action')({},'reel');const caught=await until(async()=>{const s=(await snapshot()).state;return s.catches===1&&s;},12000);assert.equal(caught.history.length,1);assert.equal(caught.currentResult.catchId,before.pendingCatch.catchId);
 const report=JSON.parse(fs.readFileSync(path.join(out,'fishing-pace-live.json')));Object.assign(report,{ok:true,restartRestored:true,hideShowPreserved:true,reelAfterRestart:true});fs.writeFileSync(path.join(out,'fishing-pace-live.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
 app.exit(0);
})().catch(e=>{console.error(e);app.exit(1);});
