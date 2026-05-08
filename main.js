const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// ── 单实例锁：第二次启动时在当前进程再开一个新窗口 ──────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已有实例在运行，退出当前进程（已有实例会收到 second-instance 事件）
  app.quit();
} else {
  app.on('second-instance', () => {
    // 每次重复启动，就新建一个浏览器窗口
    createBrowserWindow();
  });
}

app.whenReady().then(() => {
  createBrowserWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createBrowserWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function createBrowserWindow(initialUrl) {
  const browserWin = new BrowserWindow({
    width: 900,
    height: 760,
    minWidth: 250,
    minHeight: 180,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'browser-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  browserWin.loadFile('browser.html');

  // 拦截 webview 内的新窗口请求，改用无边框窗口打开
  browserWin.webContents.on('did-attach-webview', (_, webviewContents) => {
    webviewContents.setWindowOpenHandler(({ url }) => {
      if (url && url !== 'about:blank') createBrowserWindow(url);
      return { action: 'deny' };
    });
  });

  browserWin.webContents.once('did-finish-load', () => {
    browserWin.webContents.send('win-id', browserWin.id);
    if (initialUrl) {
      if (!/^https?:\/\//i.test(initialUrl)) initialUrl = 'https://' + initialUrl;
      browserWin.webContents.send('initial-url', initialUrl);
    }
  });

  // ── 鼠标位置轮询 ───────────────────────────────────────────────
  let stealthMode = false;
  const SIDE_ZONE = 30; // 窗口左右各扩展 30px 占位触发区
  let prevState = 'outside'; // 'inside' | 'side' | 'outside'

  const pollTimer = setInterval(() => {
    if (browserWin.isDestroyed()) { clearInterval(pollTimer); return; }
    const cursor = screen.getCursorScreenPoint();
    const b = browserWin.getBounds();

    const inWin = cursor.x >= b.x && cursor.x <= b.x + b.width &&
                  cursor.y >= b.y && cursor.y <= b.y + b.height;
    const inSide = !inWin &&
                   cursor.x >= b.x - SIDE_ZONE && cursor.x <= b.x + b.width + SIDE_ZONE &&
                   cursor.y >= b.y && cursor.y <= b.y + b.height;

    const curState = inWin ? 'inside' : inSide ? 'side' : 'outside';
    if (curState === prevState) return;

    if (curState === 'inside') {
      // 进入窗口主区域：完全显示 + 可交互
      browserWin.setIgnoreMouseEvents(false);
      browserWin.setOpacity(1);
      browserWin.webContents.send('mouse-entered');
      // 窗口重新可见时恢复视频播放
      browserWin.webContents.send(`resume-video-${browserWin.id}`);
    } else if (curState === 'side') {
      // 进入左右占位区：显示窗口但保持鼠标穿透（不干扰底层窗口内容）
      if (stealthMode) {
        browserWin.setOpacity(1);
        browserWin.setIgnoreMouseEvents(true, { forward: true });
        // 从 outside 进入侧边区：窗口刚变可见，恢复视频播放
        if (prevState === 'outside') {
          browserWin.webContents.send(`resume-video-${browserWin.id}`);
        }
      }
      // 从窗口内移出时通知渲染层隐藏顶栏
      if (prevState === 'inside') {
        browserWin.webContents.send('mouse-left');
      }
    } else {
      // 离开所有区域：触发隐身
      if (prevState === 'inside') {
        browserWin.webContents.send('mouse-left');
      }
      if (stealthMode) {
        browserWin.setOpacity(0);
        browserWin.setIgnoreMouseEvents(true, { forward: true });
        // 隐身隐藏时暫停网页内视频
        browserWin.webContents.send(`pause-video-${browserWin.id}`);
      }
    }

    prevState = curState;
  }, 80);

  browserWin.on('closed', () => clearInterval(pollTimer));

  // ── 拖拽 ────────────────────────────────────────────────────────
  let dragging = false;
  let dragAnchorCursor = null;
  let dragAnchorWin    = null;

  const dragStartCh = `drag-start-${browserWin.id}`;
  const dragMoveCh  = `drag-move-${browserWin.id}`;
  const dragEndCh   = `drag-end-${browserWin.id}`;

  const dragStartHandler = () => {
    if (browserWin.isDestroyed()) return;
    dragging = true;
    dragAnchorCursor = screen.getCursorScreenPoint();
    dragAnchorWin    = browserWin.getPosition();
  };
  const dragMoveHandler = () => {
    if (!dragging || browserWin.isDestroyed()) return;
    const cur = screen.getCursorScreenPoint();
    browserWin.setPosition(
      dragAnchorWin[0] + cur.x - dragAnchorCursor.x,
      dragAnchorWin[1] + cur.y - dragAnchorCursor.y
    );
  };
  const dragEndHandler = () => { dragging = false; };

  ipcMain.on(dragStartCh, dragStartHandler);
  ipcMain.on(dragMoveCh,  dragMoveHandler);
  ipcMain.on(dragEndCh,   dragEndHandler);

  // ── Stealth 模式开关 ────────────────────────────────────────────
  const stealthChannel = `stealth-mode-${browserWin.id}`;
  const stealthHandler = (_, enabled) => {
    stealthMode = enabled;
    if (!enabled) {
      browserWin.setIgnoreMouseEvents(false);
      browserWin.setOpacity(1);
    }
  };
  ipcMain.on(stealthChannel, stealthHandler);

  // ── 最小化 / 最大化 ─────────────────────────────────────────────
  const minChannel = `minimize-${browserWin.id}`;
  const maxChannel = `maximize-${browserWin.id}`;
  const minHandler = () => { if (!browserWin.isDestroyed()) browserWin.minimize(); };
  const maxHandler = () => {
    if (browserWin.isDestroyed()) return;
    browserWin.isMaximized() ? browserWin.unmaximize() : browserWin.maximize();
  };
  ipcMain.on(minChannel, minHandler);
  ipcMain.on(maxChannel, maxHandler);

  browserWin.on('closed', () => {
    ipcMain.removeListener(dragStartCh,    dragStartHandler);
    ipcMain.removeListener(dragMoveCh,     dragMoveHandler);
    ipcMain.removeListener(dragEndCh,      dragEndHandler);
    ipcMain.removeListener(stealthChannel, stealthHandler);
    ipcMain.removeListener(minChannel,     minHandler);
    ipcMain.removeListener(maxChannel,     maxHandler);
    clearInterval(pollTimer);
  });
}

// 点击链接开新无边框窗口（保留备用）
ipcMain.on('open-new-window', (_, url) => {
  createBrowserWindow(url);
});
