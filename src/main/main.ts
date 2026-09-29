/* eslint no-console: off, promise/always-return: off */
import './env';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
} from 'electron';
import { setupTitlebarAndAttachToWindow } from 'custom-electron-titlebar/main';
import log from 'electron-log';
import windowStateKeeper from 'electron-window-state';
import { createFetchBridge } from './fetch-bridge';
import {
  DESKTOP_ATTEMPT,
  parseDesktopLoginLink,
  safeCallbackUrl,
} from './desktop-auth';
import type { DesktopLoginLink } from './desktop-auth';
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
let pendingCompletion: DesktopLoginLink | null = null;

function receiveDesktopLink(raw: string) {
  const link = parseDesktopLoginLink(raw);
  if (!link) return;
  if (!tabManager || !mainWindow) {
    pendingLink = raw;
    return;
  }
  const expected = getSettingsStore().get('desktopLogin');
  if (
    !expected ||
    expected.expiresAt < Date.now() ||
    expected.attempt !== link.attempt ||
    expected.callbackUrl !== link.callbackUrl
  ) {
    log.warn('Ignored desktop sign-in link without a matching attempt');
    return;
  }
  pendingCompletion = link;
  const page = new URL('/desktop-login', HOME_URL);
  page.searchParams.set('attempt', link.attempt);
  page.searchParams.set('callbackUrl', link.callbackUrl);
  if (!tabManager.newTab(page.href)) {
    void tabManager.activeSite?.loadURL(page.href).catch(() => {
      log.error('Could not open desktop sign-in page');
    });
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function startGoogleLogin(sourceUrl: string, rawCallback: unknown) {
  if (!getStoreUrl(sourceUrl)) throw new Error('Invalid Axioo page');
  const callbackUrl = safeCallbackUrl(
    typeof rawCallback === 'string' ? rawCallback : '/',
    sourceUrl,
  );
  if (!callbackUrl || callbackUrl.length > 512) {
    throw new Error('Invalid sign-in return URL');
  }
  const attempt = randomBytes(32).toString('base64url');
  getSettingsStore().set('desktopLogin', {
    attempt,
    callbackUrl,
    expiresAt: Date.now() + 10 * 60_000,
  });
  const startUrl = new URL('/desktop-google-start', HOME_URL);
  startUrl.searchParams.set('attempt', attempt);
  if (callbackUrl !== HOME_URL) {
    startUrl.searchParams.set('callbackUrl', callbackUrl);
  }
  try {
    await shell.openExternal(startUrl.href);
    return { opened: true };
  } catch {
    clipboard.writeText(startUrl.href);
    return { opened: false };
  }
}

function registerDesktopLoginHandlers() {
  ipcMain.handle('desktop-login:start', async (event, rawCallback: unknown) => {
    if (event.sender !== tabManager?.activeSite) {
      throw new Error('Desktop sign-in must start from the active Axioo tab');
    }
    return startGoogleLogin(event.sender.getURL(), rawCallback);
  });

  ipcMain.handle('desktop-login:take', (event) => {
    if (event.sender !== tabManager?.activeSite) return null;
    try {
      const url = new URL(event.sender.getURL());
      if (url.pathname !== '/desktop-login') return null;
    } catch {
      return null;
    }
    const result = pendingCompletion;
    pendingCompletion = null;
    return result;
  });

  ipcMain.on('desktop-login:finish', (event, attempt: unknown) => {
    if (
      event.sender !== tabManager?.activeSite ||
      typeof attempt !== 'string' ||
      !DESKTOP_ATTEMPT.test(attempt)
    )
      return;
    try {
      if (new URL(event.sender.getURL()).pathname !== '/desktop-login') return;
    } catch {
      return;
    }
    const saved = getSettingsStore().get('desktopLogin');
    if (saved?.attempt === attempt) getSettingsStore().delete('desktopLogin');
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
  const tabs = new TabManager(window, fetchBridge, (sourceUrl) => {
    let callbackUrl = '/';
    try {
      callbackUrl = new URL(sourceUrl).searchParams.get('callbackUrl') ?? '/';
    } catch {
      // The normal sign-in button supplies the callback directly.
    }
    void startGoogleLogin(sourceUrl, callbackUrl).catch(() => {
      log.warn('Could not start Google sign-in in the default browser');
    });
  });
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
  );
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
      registerDesktopLoginHandlers();
      if (app.isPackaged) app.setAsDefaultProtocolClient('axioo-desktop');
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
