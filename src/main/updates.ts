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
let initialized = false;

function broadcastStatus(window: BrowserWindow, status: UpdateStatus) {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send('updates:status', status);
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
  log.info(`Checking for updates (manual: ${manual})...`);
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

export async function installUpdate(window: BrowserWindow): Promise<void> {
  if (updateDownloaded) {
    const { response } = await dialog.showMessageBox(window, {
      type: 'question',
      buttons: ['Restart & Install', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Ready',
      message: 'A new version of Axioo Desktop is ready to install.',
      detail: 'The application will restart to complete the update.',
    });
    if (response === 0) {
      autoUpdater.quitAndInstall();
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
    broadcastStatus(mainWindow, {
      state: 'available',
      version: info.version,
      message: `Update v${info.version} available. Downloading...`,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    broadcastStatus(mainWindow, {
      state: 'up-to-date',
      version: info.version || app.getVersion(),
      message: `Axioo Desktop is up to date (v${info.version || app.getVersion()})`,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    broadcastStatus(mainWindow, {
      state: 'downloading',
      percent: Math.round(progress.percent),
      message: `Downloading update... (${Math.round(progress.percent)}%)`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    broadcastStatus(mainWindow, {
      state: 'ready',
      version: info.version,
      message: `Update v${info.version} downloaded. Click to install.`,
    });
  });

  autoUpdater.on('error', (error: Error) => {
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
