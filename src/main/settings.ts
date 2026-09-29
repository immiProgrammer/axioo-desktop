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
};

let settingsStore: Store<AppSettings> | undefined;

export function getSettingsStore(): Store<AppSettings> {
  settingsStore ??= new Store<AppSettings>({ name: 'settings' });
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
