/* eslint no-console: off, promise/always-return: off */
import path from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  WebContentsView,
} from 'electron';
import { setupTitlebarAndAttachToWindow } from 'custom-electron-titlebar/main';
import log from 'electron-log';
import windowStateKeeper from 'electron-window-state';
import { SiteHistory } from './history';
import MenuBuilder from './menu';
import {
  createDebouncedUrlSave,
  getExternalUrl,
  getInternalUrl,
  getStoreUrl,
  getStartupUrl,
} from './navigation';
import { getSettingsStore } from './settings';
import startAutoUpdates from './updates';

const TITLEBAR_HEIGHT = 32;
let mainWindow: BrowserWindow | null = null;

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
  const settings = getSettingsStore();
  const startUrl = getStartupUrl(settings.get('lastUrl'));
  const urlSave = createDebouncedUrlSave((url) => {
    settings.set('lastUrl', url);
  });
  const windowState = windowStateKeeper({
    defaultWidth: 1024,
    defaultHeight: 728,
  });

  const window = new BrowserWindow({
    show: false,
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 640,
    minHeight: 400,
    titleBarStyle: 'hidden',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202124' : '#f6f8fb',
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
        nativeTheme.shouldUseDarkColors ? '#202124' : '#f6f8fb',
      );
    }
  };
  nativeTheme.on('updated', updateWindowTheme);

  const siteView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  const site = siteView.webContents;
  const history = new SiteHistory();
  window.contentView.addChildView(siteView);

  const resizeSiteView = () => {
    const [width, height] = window.getContentSize();
    const top = window.isFullScreen() ? 0 : TITLEBAR_HEIGHT;
    siteView.setBounds({
      x: 0,
      y: top,
      width,
      height: Math.max(0, height - top),
    });
  };
  resizeSiteView();
  window.on('resize', resizeSiteView);
  window.on('enter-full-screen', resizeSiteView);
  window.on('leave-full-screen', resizeSiteView);

  const sendHistoryState = () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send('toolbar:history', {
      canGoBack: history.canGoBack() || site.navigationHistory.canGoBack(),
      canGoForward:
        history.canGoForward() || site.navigationHistory.canGoForward(),
    });
  };
  const sendTitle = (pageTitle: string) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    const trimmedTitle = pageTitle.trim();
    const title = !trimmedTitle
      ? 'Axioo Store'
      : /axioo/i.test(trimmedTitle)
        ? trimmedTitle
        : `Axioo Store | ${trimmedTitle}`;
    window.setTitle(title);
    window.webContents.send('toolbar:title', title);
  };
  site.on('did-finish-load', sendHistoryState);
  window.webContents.on('did-finish-load', sendHistoryState);
  site.on('page-title-updated', (_event, pageTitle) => sendTitle(pageTitle));
  site.on('did-finish-load', () => sendTitle(site.getTitle()));
  window.webContents.on('did-finish-load', () => sendTitle(site.getTitle()));

  const recordHistory = (url: string, inPage: boolean) => {
    void site
      .executeJavaScript('window.history.length', true)
      .then((length: number) => {
        if (inPage) history.recordInPage(url, length);
        else history.recordDocument(url, length);
        sendHistoryState();
      })
      .catch(() => sendHistoryState());
  };

  const onToolbarCommand = (
    event: Electron.IpcMainEvent,
    command: 'back' | 'forward' | 'menu' | 'ready',
  ) => {
    if (event.sender !== window.webContents) return;
    if (command === 'back' && history.canGoBack()) {
      void site
        .executeJavaScript('window.history.back()')
        .catch((error: unknown) => {
          log.error('Failed to go back', error);
        });
    } else if (command === 'back' && site.navigationHistory.canGoBack()) {
      site.navigationHistory.goBack();
    } else if (command === 'forward' && history.canGoForward()) {
      void site
        .executeJavaScript('window.history.forward()')
        .catch((error: unknown) => {
          log.error('Failed to go forward', error);
        });
    } else if (command === 'forward' && site.navigationHistory.canGoForward()) {
      site.navigationHistory.goForward();
    } else if (command === 'menu') {
      Menu.getApplicationMenu()?.popup({ window });
    } else if (command === 'ready') {
      sendTitle(site.getTitle());
    }
    sendHistoryState();
  };
  ipcMain.on('toolbar:command', onToolbarCommand);

  window.on('ready-to-show', () => {
    if (process.env.START_MINIMIZED) window.minimize();
    else window.show();
  });

  window.on('close', () => {
    const currentUrl = getStoreUrl(site.getURL());
    if (currentUrl) urlSave.schedule(currentUrl);
    urlSave.flush();
  });

  window.on('closed', () => {
    nativeTheme.removeListener('updated', updateWindowTheme);
    ipcMain.removeListener('toolbar:command', onToolbarCommand);
    site.close();
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(window, site);
  menuBuilder.buildMenu();
  window.setMenuBarVisibility(false);
  await setupTitlebarAndAttachToWindow(window);

  const openExternal = (url: string) => {
    const externalUrl = getExternalUrl(url);
    if (externalUrl) {
      console.info('Opening external URL in default browser:', externalUrl);
      void shell.openExternal(externalUrl).catch((error: unknown) => {
        log.error('Failed to open external URL', externalUrl, error);
      });
    } else {
      console.warn('Cannot open invalid external URL:', url);
    }
  };

  const handleNavigation = (event: Electron.Event, url: string) => {
    const internalUrl = getInternalUrl(url);
    if (internalUrl === url) return;

    event.preventDefault();
    if (internalUrl) {
      void site.loadURL(internalUrl).catch((error: unknown) => {
        log.error('Failed to load internal URL', error);
      });
    } else {
      openExternal(url);
    }
  };

  site.on('will-navigate', (event) => {
    handleNavigation(event, event.url);
  });
  site.on('will-redirect', (event) => {
    if (event.isMainFrame) handleNavigation(event, event.url);
  });
  site.on('did-navigate', (_event, url) => {
    recordHistory(url, false);
    const storeUrl = getStoreUrl(url);
    if (storeUrl) urlSave.schedule(storeUrl);
  });
  site.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    recordHistory(url, true);
    const storeUrl = getStoreUrl(url);
    if (storeUrl) urlSave.schedule(storeUrl);
  });
  site.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      log.error('Failed to load page', errorDescription, validatedURL);
      if (!window.isDestroyed() && !window.isVisible()) window.show();
    },
  );

  site.setWindowOpenHandler(({ url }) => {
    const internalUrl = getInternalUrl(url);
    setImmediate(() => {
      if (internalUrl && !window.isDestroyed()) {
        void site.loadURL(internalUrl).catch((error: unknown) => {
          log.error('Failed to load internal URL', error);
        });
      } else if (!internalUrl) {
        openExternal(url);
      }
    });
    return { action: 'deny' };
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    await window.loadURL(rendererUrl);
  } else {
    await window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  void site.loadURL(startUrl).catch((error: unknown) => {
    log.error('Failed to load Axioo Store', error);
  });
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
