const path=require('node:path');
const {createTrayIcon}=require('./tray-icon');
const APP_ID='screen-fishing.desktop';
function createApplicationIcon(nativeImage,root=path.resolve(__dirname,'..')){
  const image=nativeImage.createFromPath(path.join(root,'assets/ui/tray/screen-fishing-256.png'));
  return image.isEmpty()?createTrayIcon(nativeImage,root).resize({width:256,height:256}):image;
}
function applyTaskbarIcon(window,root=path.resolve(__dirname,'..')){
  if(process.platform==='win32')window.setAppDetails({appId:APP_ID,relaunchDisplayName:"摸鱼搭子",appIconPath:path.join(root,'assets/ui/tray/screen-fishing.ico'),appIconIndex:0});
}
module.exports={APP_ID,createApplicationIcon,applyTaskbarIcon};
