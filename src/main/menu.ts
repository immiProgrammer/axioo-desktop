import {
  Menu,
  shell,
  BrowserWindow,
  MenuItemConstructorOptions,
  WebContents,
} from 'electron';

export default class MenuBuilder {
  mainWindow: BrowserWindow;

  getSiteContents: () => WebContents | null;

  constructor(
    mainWindow: BrowserWindow,
    getSiteContents: () => WebContents | null,
  ) {
    this.mainWindow = mainWindow;
    this.getSiteContents = getSiteContents;
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

  buildDarwinTemplate(): MenuItemConstructorOptions[] {
    const subMenuAbout: MenuItemConstructorOptions = { role: 'appMenu' };
    const subMenuEdit: MenuItemConstructorOptions = { role: 'editMenu' };
    const subMenuWindow: MenuItemConstructorOptions = { role: 'windowMenu' };
    const subMenuView: MenuItemConstructorOptions = {
      label: 'View',
      submenu: this.buildViewTemplate(),
    };
    const subMenuHelp: MenuItemConstructorOptions = {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click() {
            shell.openExternal('https://electronjs.org');
          },
        },
        {
          label: 'Documentation',
          click() {
            shell.openExternal(
              'https://github.com/electron/electron/tree/main/docs#readme',
            );
          },
        },
        {
          label: 'Community Discussions',
          click() {
            shell.openExternal('https://www.electronjs.org/community');
          },
        },
        {
          label: 'Search Issues',
          click() {
            shell.openExternal('https://github.com/electron/electron/issues');
          },
        },
      ],
    };

    return [subMenuAbout, subMenuEdit, subMenuView, subMenuWindow, subMenuHelp];
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

  buildDefaultTemplate(): MenuItemConstructorOptions[] {
    const templateDefault: MenuItemConstructorOptions[] = [
      {
        label: '&File',
        submenu: [{ role: 'close' }],
      },
      { role: 'editMenu' },
      {
        label: '&View',
        submenu: this.buildViewTemplate(),
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Learn More',
            click() {
              shell.openExternal('https://electronjs.org');
            },
          },
          {
            label: 'Documentation',
            click() {
              shell.openExternal(
                'https://github.com/electron/electron/tree/main/docs#readme',
              );
            },
          },
          {
            label: 'Community Discussions',
            click() {
              shell.openExternal('https://www.electronjs.org/community');
            },
          },
          {
            label: 'Search Issues',
            click() {
              shell.openExternal('https://github.com/electron/electron/issues');
            },
          },
        ],
      },
    ];

    return templateDefault;
  }
}
