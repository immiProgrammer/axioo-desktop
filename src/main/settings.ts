import Store from 'electron-store';

export type AppSettings = Record<string, unknown> & {
  lastUrl?: string;
};

let settingsStore: Store<AppSettings> | undefined;

export function getSettingsStore(): Store<AppSettings> {
  settingsStore ??= new Store<AppSettings>({ name: 'settings' });
  return settingsStore;
}
