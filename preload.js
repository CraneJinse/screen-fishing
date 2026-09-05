const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const aquariumRuntimeEnabled = process.env.POND_SMOKE_TEST === '1'
  || process.env.POND_SOAK_TEST === '1'
  || process.env.POND_AQUARIUM_SMOKE_TEST === '1';
const desktopPond = {
  getSnapshot: () => ipcRenderer.invoke('game:get'),
  action: (action, payload) => ipcRenderer.invoke('game:action', action, payload),
  economyAction: (action, payload) => ipcRenderer.invoke('game:economy', action, payload),
  updateSettings: (patch) => ipcRenderer.invoke('game:settings', patch),
  previewPetScale: (value) => ipcRenderer.invoke('game:preview-pet-scale', value),
  updateShortcut: (kind, value) => ipcRenderer.invoke('shortcut:update', kind, value),
  importLegacyState: (value) => ipcRenderer.invoke('game:legacy-import', value),
  hidePet: () => ipcRenderer.invoke('window:hide-pet'),
  showPet: () => ipcRenderer.invoke('window:show-pet'),
  togglePanel: () => ipcRenderer.invoke('window:toggle-panel'),
  openPanel: (route) => ipcRenderer.invoke('window:open-panel', route),
  panelReady: (value) => ipcRenderer.invoke('window:panel-ready', value),
  closePanel: () => ipcRenderer.invoke('window:close-panel'),
  movePet: (x, y) => ipcRenderer.invoke('window:move-pet', x, y),
  getPetBounds: () => ipcRenderer.invoke('window:pet-bounds'),
  setClickThrough: (ignore) => ipcRenderer.invoke('window:set-click-through', ignore),
  closeResult: () => ipcRenderer.invoke('window:close-result'),
  exportSave: () => ipcRenderer.invoke('save:export'),
  importSave: () => ipcRenderer.invoke('save:import'),
  quit: () => ipcRenderer.invoke('window:quit'),
  shortcuts: () => ipcRenderer.invoke('app:shortcut'),
  onUpdate: (callback) => subscribe('game:update', callback),
  onCorner: (callback) => subscribe('window:corner', callback),
  onPetLayout: (callback) => subscribe('window:pet-layout', callback),
  onNavigate: (callback) => subscribe('panel:navigate', callback)
};
if (aquariumRuntimeEnabled) Object.assign(desktopPond, {
  aquariumAction: (action, payload) => ipcRenderer.invoke('game:aquarium', action, payload),
  showAquarium: () => ipcRenderer.invoke('aquarium:window:show'),
  hideAquarium: () => ipcRenderer.invoke('aquarium:window:hide'),
  toggleAquarium: () => ipcRenderer.invoke('aquarium:window:toggle'),
  moveAquarium: (x, y) => ipcRenderer.invoke('aquarium:window:move', x, y),
  getAquariumBounds: () => ipcRenderer.invoke('aquarium:window:bounds'),
  setAquariumLock: (locked) => ipcRenderer.invoke('aquarium:window:lock', locked),
  setAquariumScale: (scale) => ipcRenderer.invoke('aquarium:window:scale', scale),
  onAquariumLayout: (callback) => subscribe('aquarium:window-layout', callback),
  onAquariumVisibility: (callback) => subscribe('aquarium:window-visibility', callback),
  onAquariumLayoutMode: (callback) => subscribe('aquarium:layout-mode', callback)
});
contextBridge.exposeInMainWorld('desktopPond', desktopPond);
