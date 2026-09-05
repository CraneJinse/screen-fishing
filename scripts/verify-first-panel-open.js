const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,ipcMain}=require('electron');
const root=path.resolve(__dirname,'..'),events=[];
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
const appArg=process.argv.indexOf('--app-root');
const appRoot=appArg>=0?path.resolve(process.argv[appArg+1]):root;
const mode=process.argv.includes('--slow')?'slow':process.argv.includes('--failure')?'failure':'normal';
let failedSnapshot=false;
process.env.POND_STALE_INSTANCE_VERIFY='1';
process.env.POND_STALE_INSTANCE_VERIFY_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'screen-fishing-first-panel-'));
const profileArg=process.argv.indexOf('--profile');
if(profileArg>=0){
  const profile=path.resolve(process.argv[profileArg+1]);
  for(const name of ['screen-fishing-save.json','window-settings.json']){
    const file=path.join(profile,name);
    if(fs.existsSync(file))fs.copyFileSync(file,path.join(process.env.POND_STALE_INSTANCE_VERIFY_DIR,name));
  }
}
const record=(event,data={})=>events.push({at:Date.now(),event,...data});
const originalHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(name,listener)=>originalHandle(name,async(...args)=>{
  if(name==='window:open-panel')record('open-panel-ipc');
  if(name==='window:panel-ready')record('panel-rendered',args[1]);
  if(name==='game:get'&&args[0].sender.getURL().endsWith('/src/panel.html')){
    if(mode==='slow')await new Promise(r=>setTimeout(r,650));
    if(mode==='failure'&&!failedSnapshot){failedSnapshot=true;throw Error('Injected first snapshot failure');}
  }
  return listener(...args);
});
app.on('browser-window-created',(_event,win)=>{
  if(mode==='slow'){
    const emit=win.emit.bind(win);
    win.emit=(name,...args)=>{if(name==='ready-to-show'&&win.webContents.getURL().endsWith('/src/panel.html')){setTimeout(()=>emit(name,...args),400);return true;}return emit(name,...args);};
  }
  for(const event of ['show','hide','focus','blur','ready-to-show'])win.on(event,()=>record(event,{id:win.id,url:win.webContents.getURL()}));
  for(const event of ['did-start-loading','did-finish-load','did-stop-loading','dom-ready'])win.webContents.on(event,()=>record(event,{id:win.id,url:win.webContents.getURL()}));
});
require(path.join(appRoot,'main.js'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,timeout=10000){const start=Date.now();while(Date.now()-start<timeout){const r=await fn();if(r)return r;await delay(30);}throw Error('Timed out');}
async function input(win,point,button){win.webContents.sendInputEvent({type:'mouseMove',x:point.x,y:point.y});win.webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,button,clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:point.x,y:point.y,button,clickCount:1});await delay(80);}
app.whenReady().then(async()=>{
  const pet=await waitFor(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/src/index.html')));
  await waitFor(()=>pet.isVisible()&&!pet.webContents.isLoadingMainFrame());await delay(350);
  await pet.webContents.executeJavaScript("window.__inputTrace=[];for(const type of ['pointerdown','pointerup','click','contextmenu','blur','focus'])window.addEventListener(type,e=>window.__inputTrace.push({type,target:e.target.id}),true)");
  const checks=[];
  for(let i=0;i<2;i++){
    const body=await pet.webContents.executeJavaScript("(()=>{const r=document.getElementById('petBody').getBoundingClientRect();return {x:Math.round(r.left+r.width*.5),y:Math.round(r.top+r.height*.6)}})()");
    await input(pet,body,'right');
    const button=await pet.webContents.executeJavaScript("(()=>{const n=document.getElementById('quickPanel'),r=n.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),visible:r.width>0}})()");
    record('button-before-click',{attempt:i+1,...button});
    await input(pet,button,'left');await delay(1500);
    const panel=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/src/panel.html'));
    const rendered=panel&&!panel.webContents.isLoadingMainFrame()?await panel.webContents.executeJavaScript("Boolean(document.querySelector('.home-stats'))"):false;
    checks.push({attempt:i+1,menuVisible:button.visible,panelExists:Boolean(panel),visible:Boolean(panel?.isVisible()),rendered,feedback:await pet.webContents.executeJavaScript("document.getElementById('petFeedback').textContent")});
    if(panel)panel.hide();
  }
  const panelShow=events.find(e=>e.event==='show'&&e.url.endsWith('/src/panel.html'));
  const paint=events.find(e=>e.event==='ready-to-show'&&e.id===panelShow?.id),data=events.find(e=>e.event==='panel-rendered'&&e.ok);
  const orderCorrect=Boolean(panelShow&&paint&&data&&panelShow.at>=paint.at&&panelShow.at>=data.at);
  const report={ok:orderCorrect&&checks.every((c,i)=>mode==='failure'&&i===0?c.menuVisible&&!c.visible&&c.feedback.includes('失败'):c.menuVisible&&c.visible&&c.rendered),mode,appRoot,orderCorrect,checks,events,input:await pet.webContents.executeJavaScript('window.__inputTrace')};
  fs.writeFileSync(path.join(root,`artifacts/first-panel-${mode}-report.json`),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));app.exit(report.ok?0:1);
}).catch(e=>{console.error(e.stack);fs.writeFileSync(path.join(root,'artifacts/first-panel-open-report.json'),JSON.stringify({ok:false,error:e.message,events},null,2));app.exit(1)});
