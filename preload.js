const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openBrowser: (url) => ipcRenderer.invoke('open-browser', url),
});
