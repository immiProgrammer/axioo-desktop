/* eslint no-console: off, promise/always-return: off */
import './env';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from 'electron';
import { setupTitlebarAndAttachToWindow } from 'custom-electron-titlebar/main';
import log from 'electron-log';
import windowStateKeeper from 'electron-window-state';
import { createFetchBridge } from './fetch-bridge';
import { CAPTION_HEIGHT } from './layout';
import MenuBuilder from './menu';
import { getStoreUrl } from './navigation';
import { getSettingsStore } from './settings';
import { TabManager } from './tabs';
import startAutoUpdates from './updates';

const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 400;
let mainWindow: BrowserWindow | null = null;

/**
 * A packaged build carries the icon in the executable, so only development
 * needs one from disk. `app.getAppPath()` is the project root in dev, which
 * beats guessing at the build's output depth.
 */
function developmentIcon(): string | undefined {
  if (app.isPackaged) return undefined;
  const icon = path.join(app.getAppPath(), 'assets', 'icon.png');
  return existsSync(icon) ? icon : undefined;
}

if (process.env.NODE_ENV === 'production') {
  process.setSourceMapsEnabled(true);
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  void import('electron-debug')
    .then(({ default: debug }) => debug({ showDevTools: false }))
    .catch(console.error);
}

const createWindow = async () => {
  const windowState = windowStateKeeper({
    defaultWidth: 1024,
    defaultHeight: 728,
  });

  const icon = developmentIcon();
  const window = new BrowserWindow({
    show: false,
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    ...(icon ? { icon } : {}),
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: nativeTheme.shouldUseDarkColors ? '#2c2c2c' : '#f6f8fb',
            symbolColor: nativeTheme.shouldUseDarkColors
              ? '#f0f2f5'
              : '#1d2b41',
            height: CAPTION_HEIGHT,
          },
        }
      : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#2c2c2c' : '#f6f8fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });
  mainWindow = window;
  windowState.manage(window);
  const updateWindowTheme = () => {
    if (!window.isDestroyed()) {
      window.setBackgroundColor(
        nativeTheme.shouldUseDarkColors ? '#2c2c2c' : '#f6f8fb',
      );
    }
  };
  nativeTheme.on('updated', updateWindowTheme);

  const fetchBridge = createFetchBridge();
  const tabs = new TabManager(window, fetchBridge);

  const onToolbarCommand = (
    event: Electron.IpcMainEvent,
    command: 'back' | 'forward' | 'menu' | 'ready',
  ) => {
    if (event.sender !== window.webContents) return;
    if (command === 'back') tabs.goBack();
    else if (command === 'forward') tabs.goForward();
    else if (command === 'menu') Menu.getApplicationMenu()?.popup({ window });
    else if (command === 'ready') tabs.sync();
  };
  ipcMain.on('toolbar:command', onToolbarCommand);

  const onInternalUrlQuery = (event: Electron.IpcMainEvent, url: unknown) => {
    event.returnValue =
      tabs.activeSite === event.sender && typeof url === 'string'
        ? getStoreUrl(url) !== null
        : false;
  };
  ipcMain.on('axioo:internal-url', onInternalUrlQuery);

  window.on('closed', () => {
    nativeTheme.removeListener('updated', updateWindowTheme);
    ipcMain.removeListener('toolbar:command', onToolbarCommand);
    ipcMain.removeListener('axioo:internal-url', onInternalUrlQuery);
    fetchBridge.dispose();
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(window, () => tabs.activeSite);
  menuBuilder.buildMenu();
  window.setMenuBarVisibility(false);
  await setupTitlebarAndAttachToWindow(window, {
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    await window.loadURL(rendererUrl);
  } else {
    await window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  if (process.env.START_MINIMIZED) window.minimize();
  else window.show();
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function reportWindowError(error: unknown) {
  log.error('Failed to create the application window', error);
  mainWindow?.destroy();
  mainWindow = null;
}

function onActivate() {
  if (mainWindow === null) {
    void createWindow().catch(reportWindowError);
  }
}

app
  .whenReady()
  .then(async () => {
    getSettingsStore();
    await createWindow();
    startAutoUpdates();
    app.on('activate', onActivate);
  })
  .catch((error: unknown) => {
    reportWindowError(error);
    app.quit();
  });
