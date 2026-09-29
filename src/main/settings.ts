import Store from 'electron-store';
import type { SessionTabs } from './navigation';

export type AppSettings = Record<string, unknown> & {
  lastUrl?: string;
  tabs?: SessionTabs;
};

let settingsStore: Store<AppSettings> | undefined;

export function getSettingsStore(): Store<AppSettings> {
  settingsStore ??= new Store<AppSettings>({ name: 'settings' });
  return settingsStore;
}
