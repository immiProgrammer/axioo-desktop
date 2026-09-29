import {
  Menu,
  shell,
  BrowserWindow,
  MenuItemConstructorOptions,
  WebContents,
  dialog,
  session,
} from 'electron';
import log from 'electron-log';
import { HOME_URL, parseBaseUrl } from './navigation';
import {
  clearConfiguredBaseUrl,
  getConfiguredBaseUrl,
  setConfiguredBaseUrl,
} from './settings';
import { promptEditTabUrl } from './url-prompt';

export default class MenuBuilder {
  mainWindow: BrowserWindow;

  getSiteContents: () => WebContents | null;

  onDataCleared?: () => void;

  onCheckForUpdates?: () => void;

  getActiveUrl?: () => string | null;

  onNavigateActive?: (url: string) => void;

  constructor(
    mainWindow: BrowserWindow,
    getSiteContents: () => WebContents | null,
    onDataCleared?: () => void,
    onCheckForUpdates?: () => void,
    getActiveUrl?: () => string | null,
    onNavigateActive?: (url: string) => void,
  ) {
    this.mainWindow = mainWindow;
    this.getSiteContents = getSiteContents;
    this.onDataCleared = onDataCleared;
    this.onCheckForUpdates = onCheckForUpdates;
    this.getActiveUrl = getActiveUrl;
    this.onNavigateActive = onNavigateActive;
  }

  buildMenu(): Menu {
    if (
      process.env.NODE_ENV === 'development' ||
      process.env.DEBUG_PROD === 'true'
    ) {
      this.setupDevelopmentEnvironment();
    }

    const template =
      process.platform === 'darwin'
        ? this.buildDarwinTemplate()
        : this.buildDefaultTemplate();

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    return menu;
  }

  setupDevelopmentEnvironment(): void {
    this.mainWindow.webContents.on('context-menu', (_, props) => {
      const site = this.getSiteContents();
      if (!site) return;
      const { x, y } = props;

      Menu.buildFromTemplate([
        {
          label: 'Inspect element',
          click: () => {
            site.inspectElement(x, y);
          },
        },
      ]).popup({ window: this.mainWindow });
    });
  }

  getCurrentUrl(): string | null {
    if (this.getActiveUrl) {
      const url = this.getActiveUrl();
      if (url) return url;
    }
    const site = this.getSiteContents();
    return site && !site.isDestroyed() ? site.getURL() : null;
  }

  navigateActive(url: string): void {
    if (this.onNavigateActive) {
      this.onNavigateActive(url);
      return;
    }
    const site = this.getSiteContents();
    if (site && !site.isDestroyed()) {
      void site.loadURL(url).catch((err) => {
        log.error('Failed to navigate active tab', err);
      });
    }
  }

  async editCurrentTabUrl(): Promise<void> {
    if (this.mainWindow.isDestroyed()) return;
    const currentUrl = this.getCurrentUrl() || '';
    const newUrl = await promptEditTabUrl(this.mainWindow, currentUrl);
    if (!newUrl) return;

    const verified = parseBaseUrl(newUrl);
    if (!verified) {
      await dialog.showMessageBox(this.mainWindow, {
        type: 'error',
        title: 'Invalid URL',
        message:
          'The URL must be an HTTPS URL on axioo.store or *.axioo.store.',
      });
      return;
    }

    this.navigateActive(verified);
  }

  async setBaseUrlToCurrentTab(): Promise<void> {
    if (this.mainWindow.isDestroyed()) return;
    const currentUrl = this.getCurrentUrl();
    if (!currentUrl) {
      await dialog.showMessageBox(this.mainWindow, {
        type: 'warning',
        title: 'Set Base URL',
        message: 'No active tab URL is available to set as Base URL.',
      });
      return;
    }

    const verified = parseBaseUrl(currentUrl);
    if (!verified) {
      await dialog.showMessageBox(this.mainWindow, {
        type: 'warning',
        title: 'Set Base URL',
        message: 'The current tab URL is not a valid Axioo store URL.',
        detail: `Current URL: ${currentUrl}\n\nBase URL must be an HTTPS URL on axioo.store or *.axioo.store.`,
      });
      return;
    }

    const success = setConfiguredBaseUrl(verified);
    if (success) {
      await dialog.showMessageBox(this.mainWindow, {
        type: 'info',
        title: 'Base URL Updated',
        message: 'Base URL has been set to the current tab:',
        detail: verified,
      });
    } else {
      await dialog.showMessageBox(this.mainWindow, {
        type: 'error',
        title: 'Set Base URL',
        message: 'Failed to update Base URL setting.',
      });
    }
  }

  async clearBaseUrlSetting(): Promise<void> {
    if (this.mainWindow.isDestroyed()) return;
    const current = getConfiguredBaseUrl();
    if (!current) {
      await dialog.showMessageBox(this.mainWindow, {
        type: 'info',
        title: 'Base URL',
        message: 'No custom Base URL is configured.',
        detail: `Using default: ${HOME_URL}`,
      });
      return;
    }

    clearConfiguredBaseUrl();
    await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: 'Base URL Reset',
      message: 'Base URL has been reset to default:',
      detail: HOME_URL,
    });
  }

  async clearAllData(): Promise<void> {
    if (this.mainWindow.isDestroyed()) return;

    const { response } = await dialog.showMessageBox(this.mainWindow, {
      type: 'warning',
      buttons: ['Clear Data', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Clear Browsing Data',
      message: 'Clear all browsing data?',
      detail:
        'This will clear cookies, cache, local storage, and sign-in sessions for all sites, including Google and other third-party accounts.',
    });

    if (response !== 0) return;

    try {
      await session.defaultSession.clearStorageData({
        storages: [
          'cookies',
          'filesystem',
          'indexdb',
          'localstorage',
          'shadercache',
          'serviceworkers',
          'cachestorage',
        ],
      });
      await session.defaultSession.clearCache();
      await session.defaultSession.clearAuthCache();
      await session.defaultSession.clearHostResolverCache();

      if (this.onDataCleared) {
        this.onDataCleared();
      } else {
        const site = this.getSiteContents();
        if (site && !site.isDestroyed()) {
          site.reload();
        }
      }

      if (!this.mainWindow.isDestroyed()) {
        await dialog.showMessageBox(this.mainWindow, {
          type: 'info',
          buttons: ['OK'],
          title: 'Clear Browsing Data',
          message:
            'All browsing data, cookies, and sessions have been cleared.',
        });
      }
    } catch (error) {
      log.error('Failed to clear browsing data', error);
      if (!this.mainWindow.isDestroyed()) {
        await dialog.showMessageBox(this.mainWindow, {
          type: 'error',
          buttons: ['OK'],
          title: 'Clear Browsing Data',
          message: 'Failed to clear browsing data.',
        });
      }
    }
  }

  buildDarwinTemplate(): MenuItemConstructorOptions[] {
    const subMenuAbout: MenuItemConstructorOptions = { role: 'appMenu' };
    const subMenuFile: MenuItemConstructorOptions = {
      label: 'File',
      submenu: [
        {
          label: 'Edit Current Tab URL...',
          accelerator: 'Cmd+L',
          click: () => {
            void this.editCurrentTabUrl();
          },
        },
        {
          label: 'Set Current Tab as Base URL',
          click: () => {
            void this.setBaseUrlToCurrentTab();
          },
        },
        {
          label: 'Clear Base URL',
          click: () => {
            void this.clearBaseUrlSetting();
          },
        },
        { type: 'separator' },
        {
          label: 'Clear All Browsing Data...',
          accelerator: 'Cmd+Shift+Backspace',
          click: () => {
            void this.clearAllData();
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    };
    const subMenuEdit: MenuItemConstructorOptions = { role: 'editMenu' };
    const subMenuTab: MenuItemConstructorOptions = {
      label: 'Tab',
      submenu: [
        {
          label: 'Edit Current Tab URL...',
          accelerator: 'Cmd+L',
          click: () => {
            void this.editCurrentTabUrl();
          },
        },
        {
          label: 'Set Current Tab as Base URL',
          click: () => {
            void this.setBaseUrlToCurrentTab();
          },
        },
        {
          label: 'Clear Base URL',
          click: () => {
            void this.clearBaseUrlSetting();
          },
        },
      ],
    };
    const subMenuWindow: MenuItemConstructorOptions = { role: 'windowMenu' };
    const subMenuView: MenuItemConstructorOptions = {
      label: 'View',
      submenu: this.buildViewTemplate(),
    };
    const subMenuHelp: MenuItemConstructorOptions = {
      label: 'Help',
      submenu: this.buildHelpTemplate(),
    };

    return [
      subMenuAbout,
      subMenuFile,
      subMenuEdit,
      subMenuTab,
      subMenuView,
      subMenuWindow,
      subMenuHelp,
    ];
  }

  buildViewTemplate(): MenuItemConstructorOptions[] {
    const development =
      process.env.NODE_ENV === 'development' ||
      process.env.DEBUG_PROD === 'true';
    return [
      ...(development
        ? ([
            {
              label: 'Reload Page',
              click: () => this.getSiteContents()?.reload(),
            },
            {
              label: 'Toggle Developer Tools',
              click: () => this.getSiteContents()?.toggleDevTools(),
            },
          ] as MenuItemConstructorOptions[])
        : []),
      { role: 'togglefullscreen' },
    ];
  }

  buildHelpTemplate(): MenuItemConstructorOptions[] {
    return [
      {
        label: 'Check for Updates...',
        click: () => {
          if (this.onCheckForUpdates) {
            this.onCheckForUpdates();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Axioo Website',
        click() {
          shell.openExternal(HOME_URL);
        },
      },
    ];
  }

  buildDefaultTemplate(): MenuItemConstructorOptions[] {
    const templateDefault: MenuItemConstructorOptions[] = [
      {
        label: '&File',
        submenu: [
          {
            label: 'Edit Current Tab URL...',
            accelerator: 'Ctrl+L',
            click: () => {
              void this.editCurrentTabUrl();
            },
          },
          {
            label: 'Set Current Tab as Base URL',
            click: () => {
              void this.setBaseUrlToCurrentTab();
            },
          },
          {
            label: 'Clear Base URL',
            click: () => {
              void this.clearBaseUrlSetting();
            },
          },
          { type: 'separator' },
          {
            label: 'Clear All Browsing Data...',
            accelerator: 'Ctrl+Shift+Delete',
            click: () => {
              void this.clearAllData();
            },
          },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      {
        label: '&Tab',
        submenu: [
          {
            label: 'Edit Current Tab URL...',
            accelerator: 'Ctrl+L',
            click: () => {
              void this.editCurrentTabUrl();
            },
          },
          {
            label: 'Set Current Tab as Base URL',
            click: () => {
              void this.setBaseUrlToCurrentTab();
            },
          },
          {
            label: 'Clear Base URL',
            click: () => {
              void this.clearBaseUrlSetting();
            },
          },
        ],
      },
      { role: 'editMenu' },
      {
        label: '&View',
        submenu: this.buildViewTemplate(),
      },
      {
        label: 'Help',
        submenu: this.buildHelpTemplate(),
      },
    ];

    return templateDefault;
  }
}
