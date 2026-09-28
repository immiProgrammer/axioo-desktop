/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build`, this file is compiled to
 * `./release/app/dist/main/main.js` using electron-vite.
 */
import { app, BrowserWindow, shell } from 'electron';
import log from 'electron-log';
import windowStateKeeper from 'electron-window-state';
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

let mainWindow: BrowserWindow | null = null;

if (process.env.NODE_ENV === 'production') {
  process.setSourceMapsEnabled(true);
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  void import('electron-debug')
    .then(({ default: debug }) => debug())
    .catch(console.error);
}

const createWindow = async () => {
  const settings = getSettingsStore();
  const savedUrl = settings.get('lastUrl');
  const startUrl = getStartupUrl(savedUrl);
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  mainWindow = window;
  windowState.manage(window);

  window.on('ready-to-show', () => {
    if (process.env.START_MINIMIZED) {
      window.minimize();
    } else {
      window.show();
    }
  });

  window.on('close', () => {
    const currentUrl = getStoreUrl(window.webContents.getURL());
    if (currentUrl) urlSave.schedule(currentUrl);
    urlSave.flush();
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(window);
  menuBuilder.buildMenu();

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
      void window.loadURL(internalUrl).catch((error: unknown) => {
        log.error('Failed to load internal URL', error);
      });
    } else {
      openExternal(url);
    }
  };

  window.webContents.on('will-navigate', (event) => {
    handleNavigation(event, event.url);
  });
  window.webContents.on('will-redirect', (event) => {
    if (event.isMainFrame) handleNavigation(event, event.url);
  });
  window.webContents.on('did-navigate', (_event, url) => {
    const storeUrl = getStoreUrl(url);
    if (storeUrl) urlSave.schedule(storeUrl);
  });
  window.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    const storeUrl = getStoreUrl(url);
    if (storeUrl) urlSave.schedule(storeUrl);
  });
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      log.error('Failed to load page', errorDescription, validatedURL);
      if (!window.isDestroyed() && !window.isVisible()) window.show();
    },
  );

  window.webContents.setWindowOpenHandler(({ url }) => {
    const internalUrl = getInternalUrl(url);
    setImmediate(() => {
      if (internalUrl && !window.isDestroyed()) {
        void window.loadURL(internalUrl).catch((error: unknown) => {
          log.error('Failed to load internal URL', error);
        });
      } else if (!internalUrl) {
        openExternal(url);
      }
    });
    return { action: 'deny' };
  });

  void window.loadURL(startUrl).catch((error: unknown) => {
    log.error('Failed to load Axioo Store', error);
  });
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function reportWindowError(error: unknown) {
  log.error('Failed to create the application window', error);
  mainWindow?.destroy();
  mainWindow = null;
}

function onActivate() {
  // Reopening a macOS window must not initialize another updater.
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
