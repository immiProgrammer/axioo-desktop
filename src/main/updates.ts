import { existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'up-to-date'
  | 'error';

export type UpdateStatus = {
  state: UpdateState;
  version?: string;
  percent?: number;
  message?: string;
};

const GITHUB_REPO = 'immiProgrammer/axioo-desktop';
let updateDownloaded = false;
let isDownloading = false;
let manualCheckPending = false;
let initialized = false;
let promptOpen = false;

function broadcastStatus(window: BrowserWindow, status: UpdateStatus) {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send('updates:status', status);
}

function quitAndInstallSilently() {
  setImmediate(() => {
    app.removeAllListeners('window-all-closed');
    autoUpdater.quitAndInstall(true, true);
  });
}

function isNewerVersion(remoteTag: string, currentVersion: string): boolean {
  const clean = (v: string) => v.replace(/^v/i, '').trim();
  const rParts = clean(remoteTag)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const cParts = clean(currentVersion)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(rParts.length, cParts.length); i += 1) {
    const r = rParts[i] ?? 0;
    const c = cParts[i] ?? 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}

export async function checkForUpdates(
  window: BrowserWindow,
  manual = false,
): Promise<void> {
  if (updateDownloaded) {
    if (manual) {
      await installUpdate(window);
    }
    return;
  }

  if (isDownloading) {
    if (manual) {
      manualCheckPending = true;
    }
    return;
  }

  log.info(`Checking for updates (manual: ${manual})...`);
  if (manual) {
    manualCheckPending = true;
  }
  broadcastStatus(window, {
    state: 'checking',
    message: 'Checking for updates...',
  });

  const updateConfig = path.join(process.resourcesPath, 'app-update.yml');
  const hasConfig = app.isPackaged && existsSync(updateConfig);

  if (hasConfig) {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      manualCheckPending = false;
      log.error('AutoUpdater check error:', error);
      broadcastStatus(window, {
        state: 'error',
        message: 'Failed to check for updates.',
      });
      if (manual && !window.isDestroyed()) {
        await dialog.showMessageBox(window, {
          type: 'error',
          buttons: ['OK'],
          title: 'Update Check Failed',
          message: 'Unable to check for updates right now.',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return;
  }

  // Development or unpackaged fallback via GitHub Releases API
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { 'User-Agent': 'Axioo-Desktop' },
      },
    );

    if (response.status === 404) {
      manualCheckPending = false;
      const current = app.getVersion();
      broadcastStatus(window, {
        state: 'up-to-date',
        version: current,
        message: `Axioo Desktop is up to date (v${current})`,
      });
      if (manual && !window.isDestroyed()) {
        await dialog.showMessageBox(window, {
          type: 'info',
          buttons: ['OK'],
          title: 'No Updates Available',
          message: 'You are using the latest version of Axioo Desktop.',
          detail: `Version v${current} is currently up to date.`,
        });
      }
      return;
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = (await response.json()) as { tag_name?: string };
    const latestTag = data.tag_name ?? '';
    const current = app.getVersion();
    manualCheckPending = false;

    if (latestTag && isNewerVersion(latestTag, current)) {
      broadcastStatus(window, {
        state: 'available',
        version: latestTag,
        message: `New version ${latestTag} is available!`,
      });
      if (manual && !window.isDestroyed()) {
        const { response: choice } = await dialog.showMessageBox(window, {
          type: 'info',
          buttons: ['View Release', 'Later'],
          defaultId: 0,
          cancelId: 1,
          title: 'Update Available',
          message: `A new version of Axioo Desktop (${latestTag}) is available!`,
          detail: 'Would you like to open GitHub to view and download it?',
        });
        if (choice === 0) {
          void shell.openExternal(
            `https://github.com/${GITHUB_REPO}/releases/latest`,
          );
        }
      }
    } else {
      broadcastStatus(window, {
        state: 'up-to-date',
        version: current,
        message: `Axioo Desktop is up to date (v${current})`,
      });
      if (manual && !window.isDestroyed()) {
        await dialog.showMessageBox(window, {
          type: 'info',
          buttons: ['OK'],
          title: 'Up to Date',
          message: 'Axioo Desktop is up to date.',
          detail: `Version v${current} is the latest available.`,
        });
      }
    }
  } catch (err) {
    manualCheckPending = false;
    log.error('GitHub release check error:', err);
    broadcastStatus(window, {
      state: 'error',
      message: 'Unable to check for updates (offline or network error).',
    });
    if (manual && !window.isDestroyed()) {
      await dialog.showMessageBox(window, {
        type: 'error',
        buttons: ['OK'],
        title: 'Update Check Failed',
        message: 'Could not connect to update servers.',
        detail: 'Please verify your internet connection and try again later.',
      });
    }
  }
}

export async function installUpdate(
  window: BrowserWindow,
  version?: string,
): Promise<void> {
  if (updateDownloaded) {
    if (promptOpen || window.isDestroyed()) return;
    promptOpen = true;
    try {
      const versionLabel = version ? ` (v${version})` : '';
      const { response } = await dialog.showMessageBox(window, {
        type: 'question',
        buttons: ['Restart & Install', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update Ready',
        message: `A new version of Axioo Desktop${versionLabel} is ready to install.`,
        detail:
          'Axioo Desktop will automatically update and reopen right away.',
      });
      if (response === 0) {
        quitAndInstallSilently();
      }
    } finally {
      promptOpen = false;
    }
  } else {
    void shell.openExternal(
      `https://github.com/${GITHUB_REPO}/releases/latest`,
    );
  }
}

export default function initAutoUpdates(mainWindow: BrowserWindow): void {
  if (initialized) return;
  initialized = true;

  log.transports.file.level = 'info';
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    broadcastStatus(mainWindow, {
      state: 'checking',
      message: 'Checking for updates...',
    });
  });

  autoUpdater.on('update-available', (info) => {
    isDownloading = true;
    broadcastStatus(mainWindow, {
      state: 'available',
      version: info.version,
      message: `Update v${info.version} available. Downloading...`,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    isDownloading = false;
    const wasManual = manualCheckPending;
    manualCheckPending = false;
    const current = info.version || app.getVersion();
    broadcastStatus(mainWindow, {
      state: 'up-to-date',
      version: current,
      message: `Axioo Desktop is up to date (v${current})`,
    });
    if (wasManual && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['OK'],
        title: 'Up to Date',
        message: 'Axioo Desktop is up to date.',
        detail: `Version v${current} is the latest available.`,
      });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    isDownloading = true;
    broadcastStatus(mainWindow, {
      state: 'downloading',
      percent: Math.round(progress.percent),
      message: `Downloading update... (${Math.round(progress.percent)}%)`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    isDownloading = false;
    updateDownloaded = true;
    const wasManual = manualCheckPending;
    manualCheckPending = false;
    broadcastStatus(mainWindow, {
      state: 'ready',
      version: info.version,
      message: `Update v${info.version} downloaded. Click to install.`,
    });
    if (wasManual && !mainWindow.isDestroyed()) {
      void installUpdate(mainWindow, info.version);
    }
  });

  autoUpdater.on('error', (error: Error) => {
    isDownloading = false;
    manualCheckPending = false;
    log.error('Auto-update error:', error);
    broadcastStatus(mainWindow, {
      state: 'error',
      message: error?.message || 'Update check error',
    });
  });

  ipcMain.on('updates:check', () => {
    void checkForUpdates(mainWindow, true);
  });

  ipcMain.on('updates:install', () => {
    void installUpdate(mainWindow);
  });

  // If packaged and app-update.yml exists, run initial background check after launch
  const updateConfig = path.join(process.resourcesPath, 'app-update.yml');
  if (app.isPackaged && existsSync(updateConfig)) {
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) {
        void checkForUpdates(mainWindow, false);
      }
    }, 4000);
  }
}
