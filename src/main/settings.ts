import Store from 'electron-store';
import { parseBaseUrl } from './navigation';
import type { SessionTabs } from './navigation';

export type AppSettings = Record<string, unknown> & {
  baseUrl?: string;
  lastUrl?: string;
  tabs?: SessionTabs;
  externalReturn?: {
    url: string;
    expiresAt: number;
  };
  cachedBuildId?: string;
};

let settingsStore: Store<AppSettings> | undefined;

export function getSettingsStore(): Store<AppSettings> {
  try {
    settingsStore ??= new Store<AppSettings>({ name: 'settings' });
  } catch {
    settingsStore ??= new Store<AppSettings>({
      name: 'settings',
      cwd: process.cwd(),
    });
  }
  return settingsStore;
}

export function getConfiguredBaseUrl(
  store: Store<AppSettings> = getSettingsStore(),
): string | null {
  const raw = store.get('baseUrl');
  return parseBaseUrl(raw);
}

export function setConfiguredBaseUrl(
  url: string,
  store: Store<AppSettings> = getSettingsStore(),
): boolean {
  const valid = parseBaseUrl(url);
  if (!valid) return false;
  store.set('baseUrl', valid);
  return true;
}

export function clearConfiguredBaseUrl(
  store: Store<AppSettings> = getSettingsStore(),
): void {
  store.delete('baseUrl');
}

export function getCachedBuildId(
  store: Store<AppSettings> = getSettingsStore(),
): string | null {
  const raw = store.get('cachedBuildId');
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export function setCachedBuildId(
  buildId: string,
  store: Store<AppSettings> = getSettingsStore(),
): void {
  store.set('cachedBuildId', buildId.trim());
}

export function clearCachedBuildId(
  store: Store<AppSettings> = getSettingsStore(),
): void {
  store.delete('cachedBuildId');
}
