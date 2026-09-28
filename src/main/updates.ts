import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

let started = false;

export default function startAutoUpdates(): void {
  if (!app.isPackaged || started) return;

  // electron-builder writes this file only when a publish provider is configured.
  const updateConfig = path.join(process.resourcesPath, 'app-update.yml');
  if (!existsSync(updateConfig)) return;

  started = true;
  log.transports.file.level = 'info';
  autoUpdater.logger = log;
  autoUpdater.on('error', (error: Error) => {
    log.error('Auto-update error', error);
  });
  void autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
    log.error('Failed to check for updates', error);
  });
}
