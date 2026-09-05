const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const {app,BrowserWindow,nativeImage}=require('electron');
const {createApplicationIcon,applyTaskbarIcon}=require('../src/application-icon');
const {PNG}=require('pngjs');
const root=path.resolve(__dirname,'..'),arg=process.argv.indexOf('--root'),assetRoot=arg>=0?path.resolve(process.argv[arg+1]):root;
const output=path.join(root,'artifacts/koi-window-icon');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'screen-fishing-icon-')));
app.whenReady().then(async()=>{
  const icon=createApplicationIcon(nativeImage,assetRoot);assert.equal(icon.isEmpty(),false);
  const ico=fs.readFileSync(path.join(assetRoot,'assets/ui/tray/screen-fishing.ico'));
  assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),8);
  const sizes=[];for(let i=0;i<8;i++){const at=6+i*16,n=ico.readUInt32LE(at+8),start=ico.readUInt32LE(at+12);const png=PNG.sync.read(ico.subarray(start,start+n));sizes.push(png.width);assert.equal(png.width,png.height);}
  assert.deepEqual(sizes,[16,20,24,32,48,64,128,256]);
  const win=new BrowserWindow({width:480,height:320,show:false,icon,skipTaskbar:false,title:'屏幕钓鱼 · 锦鲤图标验证',webPreferences:{sandbox:true}});
  applyTaskbarIcon(win,assetRoot);await win.loadURL('data:text/html,<title>Screen Fishing Icon Verification</title>');
  win.showInactive();
  const handle=win.getNativeWindowHandle();const hwnd=(handle.length===8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE())).toString();
  const result=await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/inspect-window-icon.ps1'),'-WindowHandle',hwnd,'-OutputDirectory',output],{windowsHide:true,timeout:30000},(err,stdout,stderr)=>err?reject(Error(stderr||err.message)):resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')))));
  const report={ok:true,assetRoot,icoSizes:sizes,nativeWindowIcons:result,appId:'screen-fishing.desktop',taskbarIcon:'assets/ui/tray/screen-fishing.ico'};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');win.destroy();console.log(JSON.stringify(report));app.exit(0);
}).catch(e=>{console.error(e.stack);app.exit(1)});
