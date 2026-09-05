const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createPanelReadiness}=require('../src/panel-readiness');
function fixture(timeoutMs=1000){const win=new EventEmitter();win.webContents=new EventEmitter();return {win,gate:createPanelReadiness(win,{timeoutMs})};}
for(const order of ['plr','prl','lpr','lrp','rpl','rlp'])test(`cold panel waits for native paint, load and data render: ${order}`,async()=>{
  const {win,gate}=fixture();let done=false;gate.promise.then(()=>{done=true;});
  for(const [i,key] of [...order].entries()){
    if(key==='p')win.emit('ready-to-show');if(key==='l')win.webContents.emit('did-finish-load');if(key==='r')gate.rendered();
    await Promise.resolve();assert.equal(done,i===2);
  }await gate.promise;assert.equal(gate.failed,false);
});
test('render failure rejects the request and marks the window for retry',async()=>{const {gate}=fixture();gate.rendered(false);await assert.rejects(gate.promise,/数据加载失败/);assert.equal(gate.failed,true);});
test('closed and crashed windows cannot satisfy a pending first-open request',async()=>{for(const type of ['closed','render-process-gone']){const {win,gate}=fixture();(type==='closed'?win:win.webContents).emit(type);await assert.rejects(gate.promise);assert.equal(gate.failed,true);}});
test('missing renderer acknowledgement times out instead of silently losing the request',async()=>{const {win,gate}=fixture(10);win.emit('ready-to-show');win.webContents.emit('did-finish-load');await assert.rejects(gate.promise,/超时/);});
