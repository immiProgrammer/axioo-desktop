/* eslint no-console: off, promise/always-return: off */
import './env';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
} from 'electron';
import { setupTitlebarAndAttachToWindow } from 'custom-electron-titlebar/main';
import log from 'electron-log';
import windowStateKeeper from 'electron-window-state';
import { createFetchBridge } from './fetch-bridge';
import { getBrowserUrl, parseAppLink } from './external-links';
import { CAPTION_HEIGHT } from './layout';
import MenuBuilder from './menu';
import { getStoreUrl, HOME_URL } from './navigation';
import { getSettingsStore } from './settings';
import { TabManager } from './tabs';
import initAutoUpdates, { checkForUpdates } from './updates';

const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 400;
let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;
let pendingLink =
  process.argv.find((arg) => arg.startsWith('axioo-desktop://')) ?? null;
type DesktopEvent = {
  id: string;
  type: 'deep-link';
  url: string;
  openedUrl: string | null;
};
const pendingEvents: DesktopEvent[] = [];
const homeOrigin = new URL(HOME_URL).origin;

function sendPendingEvents(site: Electron.WebContents) {
  if (!tabManager?.ownsSite(site) || site.isDestroyed()) return;
  try {
    if (new URL(site.getURL()).origin !== homeOrigin) return;
  } catch {
    return;
  }
  for (const event of pendingEvents) site.send('desktop:event', event);
}

function receiveDesktopLink(raw: string) {
  const link = parseAppLink(raw);
  if (!link) return;
  if (!tabManager || !mainWindow) {
    pendingLink = raw;
    return;
  }
  const lastOpened = getSettingsStore().get('externalReturn');
  pendingEvents.push({
    id: randomUUID(),
    type: 'deep-link',
    url: link,
    openedUrl:
      lastOpened && lastOpened.expiresAt > Date.now() ? lastOpened.url : null,
  });
  if (pendingEvents.length > 8) pendingEvents.shift();
  const activeSite = tabManager.activeSite;
  let activeOrigin: string | null = null;
  try {
    activeOrigin = activeSite ? new URL(activeSite.getURL()).origin : null;
  } catch {
    // A new home tab will receive the event when it is ready.
  }
  if (activeOrigin !== homeOrigin && !tabManager.newTab(HOME_URL)) {
    void activeSite?.loadURL(HOME_URL).catch(() => {
      log.error('Could not open Axioo to handle the app link');
    });
  } else if (activeSite && activeOrigin === homeOrigin) {
    sendPendingEvents(activeSite);
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function registerDesktopBridgeHandlers() {
  ipcMain.handle(
    'desktop:open-external',
    async (event, rawUrl: unknown, rawAsk: unknown) => {
      if (
        event.sender !== tabManager?.activeSite ||
        !getStoreUrl(event.sender.getURL()) ||
        !mainWindow
      )
        return 'failed';
      const ask = rawAsk !== false;
      const url = getBrowserUrl(rawUrl, ask);
      if (!url) return 'failed';
      if (ask) {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['Open in browser', 'Copy link', 'Cancel'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
          message: 'Open this link outside Axioo Desktop?',
          detail: new URL(url).origin,
        });
        if (response === 2) return 'cancelled';
        if (response === 1) {
          clipboard.writeText(url);
          getSettingsStore().set('externalReturn', {
            url,
            expiresAt: Date.now() + 10 * 60_000,
          });
          return 'copied';
        }
      }
      getSettingsStore().set('externalReturn', {
        url,
        expiresAt: Date.now() + 10 * 60_000,
      });
      try {
        await shell.openExternal(url);
        return 'opened';
      } catch {
        getSettingsStore().delete('externalReturn');
        return 'failed';
      }
    },
  );

  ipcMain.on('desktop:event', (event, command: unknown) => {
    if (
      !tabManager?.ownsSite(event.sender) ||
      !getStoreUrl(event.sender.getURL())
    )
      return;
    if (!command || typeof command !== 'object') return;
    const input = command as { type?: unknown; id?: unknown };
    if (input.type === 'ready') {
      sendPendingEvents(event.sender);
    } else if (input.type === 'event-handled' && typeof input.id === 'string') {
      const index = pendingEvents.findIndex((item) => item.id === input.id);
      if (index >= 0) pendingEvents.splice(index, 1);
    } else if (input.type === 'clear-return') {
      getSettingsStore().delete('externalReturn');
    }
  });
}

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
            color: nativeTheme.shouldUseDarkColors ? '#171717' : '#f6f8fb',
            symbolColor: nativeTheme.shouldUseDarkColors
              ? '#f0f2f5'
              : '#1d2b41',
            height: CAPTION_HEIGHT,
          },
        }
      : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171717' : '#f6f8fb',
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
        nativeTheme.shouldUseDarkColors ? '#171717' : '#f6f8fb',
      );
    }
  };
  nativeTheme.on('updated', updateWindowTheme);

  const fetchBridge = createFetchBridge();
  const tabs = new TabManager(window, fetchBridge);
  tabManager = tabs;

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
      tabs.ownsSite(event.sender) && typeof url === 'string'
        ? getStoreUrl(url) !== null
        : false;
  };
  ipcMain.on('axioo:internal-url', onInternalUrlQuery);
  // A site's preload asks this synchronously. Install the listener before
  // restoring tabs, which starts loading their pages.
  tabs.start();

  window.on('closed', () => {
    nativeTheme.removeListener('updated', updateWindowTheme);
    ipcMain.removeListener('toolbar:command', onToolbarCommand);
    ipcMain.removeListener('axioo:internal-url', onInternalUrlQuery);
    fetchBridge.dispose();
    tabManager = null;
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(
    window,
    () => tabs.activeSite,
    () => tabs.reloadAll(),
    () => void checkForUpdates(window, true),
    () => tabs.getActiveTabUrl(),
    (url) => tabs.loadUrlInActiveTab(url),
  );
  tabs.onEditUrl = () => {
    void menuBuilder.editCurrentTabUrl();
  };
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
  if (pendingLink) {
    const link = pendingLink;
    pendingLink = null;
    receiveDesktopLink(link);
  }
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

function registerAppProtocol() {
  const scheme = 'axioo-desktop';
  const registered = process.defaultApp
    ? Boolean(process.argv[1]) &&
      app.setAsDefaultProtocolClient(scheme, process.execPath, [
        path.resolve(process.argv[1]),
      ])
    : app.setAsDefaultProtocolClient(scheme);
  if (!registered) log.warn('Could not register Axioo Desktop app links');
}

registerAppProtocol();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, args) => {
    const link = args.find((arg) => arg.startsWith('axioo-desktop://'));
    if (link) receiveDesktopLink(link);
    else mainWindow?.focus();
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    receiveDesktopLink(url);
  });
  app
    .whenReady()
    .then(async () => {
      getSettingsStore();
      registerDesktopBridgeHandlers();
      await createWindow();
      if (mainWindow) {
        initAutoUpdates(mainWindow);
      }
      app.on('activate', onActivate);
    })
    .catch((error: unknown) => {
      reportWindowError(error);
      app.quit();
    });
}
