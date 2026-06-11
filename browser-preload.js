const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  // 主进程 → 渲染层
  onWinId:       (cb) => ipcRenderer.on('win-id',       (_, id) => cb(id)),
  onMouseEntered:(cb) => ipcRenderer.on('mouse-entered',()      => cb()),
  onMouseLeft:   (cb) => ipcRenderer.on('mouse-left',   ()      => cb()),

  // 渲染层 → 主进程
  setStealthMode: (winId, enabled) => ipcRenderer.send(`stealth-mode-${winId}`, enabled),
  dragStart:    (winId) => ipcRenderer.send(`drag-start-${winId}`),
  dragMove:     (winId) => ipcRenderer.send(`drag-move-${winId}`),
  dragEnd:      (winId) => ipcRenderer.send(`drag-end-${winId}`),
  minimizeWin:  (winId) => ipcRenderer.send(`minimize-${winId}`),
  maximizeWin:  (winId) => ipcRenderer.send(`maximize-${winId}`),
  pinWin:       (winId, enabled) => ipcRenderer.send(`pin-${winId}`, enabled),
  openNewWindow:(url)   => ipcRenderer.send('open-new-window', url),

  // 主进程 → 渲染层（新窗口带初始 URL）
  onInitialUrl: (cb) => ipcRenderer.on('initial-url', (_, url) => cb(url)),

  // 主进程 → 渲染层：隐身隐藏时暫停视频
  onPauseVideo:  (winId, cb) => ipcRenderer.on(`pause-video-${winId}`,  () => cb()),

  // 主进程 → 渲染层：窗口重新显示时恢复视频
  onResumeVideo: (winId, cb) => ipcRenderer.on(`resume-video-${winId}`, () => cb()),
});
