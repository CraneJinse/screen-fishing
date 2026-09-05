// A cold panel is presentable only after native paint readiness and its first
// successful data render. Keep this state bound to the actual window instance.
function createPanelReadiness(window, { timeoutMs = 15000 } = {}) {
  let painted=false, rendered=false, loaded=false, settled=false, failed=false;
  let resolve, reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  // A window may be prepared without an open request (package verification).
  promise.catch(()=>{});
  const timer=setTimeout(()=>fail(new Error('信息面板加载超时，请重试')),timeoutMs);
  function complete(){if(!settled&&painted&&rendered&&loaded){settled=true;clearTimeout(timer);resolve();}}
  function fail(error){failed=true;if(!settled){settled=true;clearTimeout(timer);reject(error instanceof Error?error:new Error(String(error)));}}
  window.once('ready-to-show',()=>{painted=true;complete();});
  window.webContents.once('did-finish-load',()=>{loaded=true;complete();});
  window.webContents.once('render-process-gone',()=>fail(new Error('信息面板加载中断，请重试')));
  window.once('closed',()=>fail(new Error('信息面板已关闭')));
  return {promise,fail,get failed(){return failed;},rendered(ok=true){if(ok){rendered=true;complete();}else fail(new Error('信息面板数据加载失败，请重试'));}};
}
module.exports={createPanelReadiness};
