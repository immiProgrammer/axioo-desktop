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
import { HOME_URL } from './navigation';

export default class MenuBuilder {
  mainWindow: BrowserWindow;

  getSiteContents: () => WebContents | null;

  onDataCleared?: () => void;

  onCheckForUpdates?: () => void;

  constructor(
    mainWindow: BrowserWindow,
    getSiteContents: () => WebContents | null,
    onDataCleared?: () => void,
    onCheckForUpdates?: () => void,
  ) {
    this.mainWindow = mainWindow;
    this.getSiteContents = getSiteContents;
    this.onDataCleared = onDataCleared;
    this.onCheckForUpdates = onCheckForUpdates;
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
