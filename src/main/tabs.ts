import path from 'node:path';
import {
  app,
  clipboard,
  ipcMain,
  Menu,
  shell,
  WebContentsView,
} from 'electron';
import type { BrowserWindow, IpcMainEvent, WebContents } from 'electron';
import log from 'electron-log';
import type { FetchBridge } from './fetch-bridge';
import { SiteHistory } from './history';
import { buildLinkMenuTemplate } from './link-menu';
import { CONTENT_TOP } from './layout';
import {
  HOME_URL,
  createDebouncedSave,
  getExternalUrl,
  getInternalUrl,
  getRestorableStoreUrl,
  isGoogleAuthUrl,
  getSessionTabs,
  getStartupUrl,
} from './navigation';
import { getSettingsStore } from './settings';

export const TAB_STATE_CHANNEL = 'tabs:state';
export const TAB_COMMAND_CHANNEL = 'tabs:command';
export const LAYOUT_CHANNEL = 'layout:chrome';

export type TabState = {
  id: string;
  title: string;
  url: string;
  active: boolean;
};

const MAX_TABS = 32;
const MAX_RECENTLY_CLOSED = 10;
let nextTabId = 0;

type Tab = {
  id: string;
  view: WebContentsView;
  site: WebContents;
  history: SiteHistory;
  detachFetchBridge: () => void;
  title: string;
  url: string;
};

type PersistedTabs = {
  urls: string[];
  activeIndex: number;
};

// Every tab is its own WebContentsView, but only the active one is a child of
// the window; the rest are parked detached so they keep their session, history
// and login state without being painted.
export class TabManager {
  private readonly window: BrowserWindow;

  private readonly fetchBridge: FetchBridge;

  private readonly tabs = new Map<string, Tab>();

  private readonly attached = new Set<string>();

  private order: string[] = [];

  private activeId: string | null = null;

  private lastVisitedUrl: string | null = null;

  private recentlyClosed: string[] = [];

  private disposed = false;
  private readonly onGoogleSignIn: (sourceUrl: string) => void;

  private readonly persist = createDebouncedSave<PersistedTabs>(
    (state) => {
      const settings = getSettingsStore();
      settings.set('tabs', state);
      if (this.lastVisitedUrl) settings.set('lastUrl', this.lastVisitedUrl);
    },
    1_000,
    5_000,
  );

  constructor(
    window: BrowserWindow,
    fetchBridge: FetchBridge,
    onGoogleSignIn: (sourceUrl: string) => void,
  ) {
    this.window = window;
    this.fetchBridge = fetchBridge;
    this.onGoogleSignIn = onGoogleSignIn;
    ipcMain.on(TAB_COMMAND_CHANNEL, this.onTabCommand);
    this.window.on('resize', this.layout);
    this.window.on('enter-full-screen', this.onFullScreenChange);
    this.window.on('leave-full-screen', this.onFullScreenChange);
    this.window.on('close', this.flush);
    this.window.on('closed', this.dispose);
    app.on('before-quit', this.flush);
    this.restore();
  }

  get activeSite(): WebContents | null {
    const tab = this.activeId ? this.tabs.get(this.activeId) : undefined;
    return tab && !tab.site.isDestroyed() ? tab.site : null;
  }

  ownsSite(site: WebContents): boolean {
    return [...this.tabs.values()].some((tab) => tab.site === site);
  }

  reloadAll(): void {
    for (const tab of this.tabs.values()) {
      if (!tab.site.isDestroyed()) {
        tab.site.reload();
      }
    }
  }

  private onFullScreenChange = () => {
    this.layout();
  };

  private layout = () => {
    if (this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const top = this.window.isFullScreen() ? 0 : CONTENT_TOP;
    const active = this.activeId ? this.tabs.get(this.activeId) : undefined;
    if (active && !active.view.webContents.isDestroyed()) {
      active.view.setBounds({
        x: 0,
        y: top,
        width,
        height: Math.max(0, height - top),
      });
    }
    if (this.window.webContents.isDestroyed()) return;
    this.window.webContents.send(LAYOUT_CHANNEL, {
      tabStripVisible: !this.window.isFullScreen(),
      // On Windows, native caption buttons occupy 138px and the auto-update
      // button occupies 34px directly next to minimize, giving 172px inset.
      // On other platforms, the update button sits at the right edge with 36px inset.
      rightInset: process.platform === 'win32' ? 172 : 36,
    });
  };

  private onTabCommand = (event: IpcMainEvent, command: unknown) => {
    if (event.sender !== this.window.webContents) return;
    if (typeof command !== 'string') return;
    this.runCommand(command);
  };

  private runCommand(command: string) {
    const [action, ...args] = command.split(':');
    switch (action) {
      case 'new':
        this.newTab();
        break;
      case 'close':
        if (args[0]) this.closeTab(args[0]);
        else this.closeTab(this.activeId ?? '');
        break;
      case 'select':
        if (args[0]) this.activate(args[0]);
        break;
      case 'reopen':
        this.reopenClosedTab();
        break;
      case 'next':
        this.activateRelative(1);
        break;
      case 'previous':
        this.activateRelative(-1);
        break;
      case 'first':
        this.activateIndex(0);
        break;
      case 'last':
        this.activateIndex(-1);
        break;
      case 'activate': {
        const position = Number(args[0]);
        if (Number.isInteger(position) && position > 0) {
          this.activateIndex(position - 1);
        }
        break;
      }
      case 'move': {
        const to = Number(args[1]);
        if (args[0] && Number.isInteger(to)) this.moveTab(args[0], to);
        break;
      }
      default:
        break;
    }
  }

  private activateIndex(index: number) {
    const id =
      index < 0 ? this.order[this.order.length - 1] : this.order[index];
    if (id) this.activate(id);
  }

  private activateRelative(delta: number) {
    if (this.order.length === 0) return;
    const current = this.activeId ? this.order.indexOf(this.activeId) : 0;
    const next = (current + delta + this.order.length) % this.order.length;
    this.activate(this.order[next]);
  }

  private getState(): TabState[] {
    return this.order.map((id) => {
      const tab = this.tabs.get(id);
      return {
        id,
        title: tab ? tab.title : 'Axioo Store',
        url: tab ? tab.url : '',
        active: id === this.activeId,
      };
    });
  }

  private sendState() {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) {
      return;
    }
    this.window.webContents.send(TAB_STATE_CHANNEL, this.getState());
  }

  private pushChromeState() {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) {
      return;
    }
    const tab = this.activeId ? this.tabs.get(this.activeId) : undefined;
    const site = tab && !tab.site.isDestroyed() ? tab.site : null;
    this.window.webContents.send('toolbar:history', {
      canGoBack: Boolean(
        site &&
        (tab?.history.canGoBack() || site.navigationHistory.canGoBack()),
      ),
      canGoForward: Boolean(
        site &&
        (tab?.history.canGoForward() || site.navigationHistory.canGoForward()),
      ),
    });
    this.sendTitle(site?.getTitle() ?? '');
  }

  private sendTitle(pageTitle: string) {
    if (this.window.isDestroyed()) return;
    const trimmed = pageTitle.trim();
    const title = !trimmed
      ? 'Axioo Store'
      : /axioo/i.test(trimmed)
        ? trimmed
        : `Axioo Store | ${trimmed}`;
    this.window.setTitle(title);
  }

  private trackUrl(tab: Tab, url: string) {
    tab.url = url;
    const storeUrl = getRestorableStoreUrl(url);
    if (!storeUrl) return;
    tab.title = this.getTabTitle(tab, storeUrl);
    if (this.activeId === tab.id) this.lastVisitedUrl = storeUrl;
    this.sendState();
    this.schedulePersist();
  }

  private getTabTitle(tab: Tab, url: string): string {
    const title = tab.site.isDestroyed() ? '' : tab.site.getTitle().trim();
    if (title) return title;
    try {
      return new URL(url).pathname.split('/').filter(Boolean).pop() ?? url;
    } catch {
      return 'Axioo Store';
    }
  }

  private createTab(url: string, activate = true): Tab | null {
    if (this.order.length >= MAX_TABS) return null;

    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../preload/site-preload.js'),
        nodeIntegration: false,
        contextIsolation: false,
        sandbox: true,
        webviewTag: false,
      },
    });
    const site = view.webContents;
    const tab: Tab = {
      id: `tab-${Date.now().toString(36)}-${(nextTabId += 1).toString(36)}`,
      view,
      site,
      history: new SiteHistory(),
      detachFetchBridge: this.fetchBridge.attach(site),
      title: 'Axioo Store',
      url,
    };
    this.tabs.set(tab.id, tab);
    this.order.push(tab.id);
    this.wireTab(tab);
    if (activate) this.activate(tab.id);
    void site.loadURL(url).catch(() => {
      log.error('Failed to load Axioo Store');
    });
    return tab;
  }

  private wireTab(tab: Tab) {
    const { site } = tab;

    const recordHistory = (url: string, inPage: boolean) => {
      void site
        .executeJavaScript('window.history.length', true)
        .then((length: number) => {
          if (inPage) tab.history.recordInPage(url, length);
          else tab.history.recordDocument(url, length);
          if (this.activeId === tab.id) this.pushChromeState();
          return length;
        })
        .catch(() => {
          if (this.activeId === tab.id) this.pushChromeState();
        });
    };

    site.on('did-finish-load', () => {
      if (this.activeId === tab.id) this.pushChromeState();
    });
    site.on('page-title-updated', (_event, pageTitle) => {
      tab.title = pageTitle.trim() || 'Axioo Store';
      if (this.activeId === tab.id) this.sendTitle(pageTitle);
      this.sendState();
    });
    site.on('did-navigate', (_event, url) => {
      recordHistory(url, false);
      this.trackUrl(tab, url);
    });
    site.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      recordHistory(url, true);
      this.trackUrl(tab, url);
    });
    site.on('will-navigate', (event) =>
      this.handleNavigation(event, event.url, site),
    );
    site.on('will-redirect', (event) => {
      if (event.isMainFrame) this.handleNavigation(event, event.url, site);
    });
    site.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return;
        log.error('Failed to load page', errorDescription);
        if (!this.window.isDestroyed() && !this.window.isVisible()) {
          this.window.show();
        }
      },
    );
    site.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (this.handleShortcut(input, site)) event.preventDefault();
    });
    site.on('context-menu', (_event, params) => {
      this.showLinkMenu(params.linkURL);
    });
    site.setWindowOpenHandler(({ url }) => {
      if (isGoogleAuthUrl(url)) {
        this.onGoogleSignIn(site.getURL());
        return { action: 'deny' };
      }
      const internalUrl = getInternalUrl(url);
      setImmediate(() => {
        if (this.disposed) return;
        if (internalUrl) this.createTab(internalUrl);
        else this.openExternal(url);
      });
      return { action: 'deny' };
    });
  }

  private handleNavigation(
    event: Electron.Event,
    url: string,
    site: WebContents,
  ) {
    if (isGoogleAuthUrl(url)) {
      event.preventDefault();
      this.onGoogleSignIn(site.getURL());
      return;
    }
    const internalUrl = getInternalUrl(url);
    if (internalUrl === url) return;

    event.preventDefault();
    if (!internalUrl) {
      this.openExternal(url);
      return;
    }
    setImmediate(() => {
      if (this.disposed || site.isDestroyed()) return;
      void site.loadURL(internalUrl).catch(() => {
        log.error('Failed to load internal URL');
      });
    });
  }

  private openExternal(url: string) {
    const externalUrl = getExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl).catch(() => {
        log.error('Failed to open external URL');
      });
    } else {
      log.warn('Ignoring invalid external URL');
    }
  }

  private handleShortcut(input: Electron.Input, site: WebContents) {
    const command = process.platform === 'darwin' ? input.meta : input.control;
    const key = input.key.toLowerCase();

    // F5 refreshes without a modifier, so it has to be read before the
    // command-key gate below.
    if (key === 'f5') {
      this.reloadSite(site, input.shift);
      return true;
    }
    if (!command) return false;

    if (key === 't') {
      if (input.shift) this.reopenClosedTab();
      else this.newTab();
      return true;
    }
    if (key === 'w') {
      this.closeTab(this.activeId ?? '');
      return true;
    }
    if (key === 'r') {
      this.reloadSite(site, input.shift);
      return true;
    }
    if (key === 'tab') {
      this.activateRelative(input.shift ? -1 : 1);
      return true;
    }
    if (/^[1-9]$/.test(key)) {
      this.activateIndex(Number(key) - 1);
      return true;
    }
    return false;
  }

  private showLinkMenu(linkURL: string) {
    const link = linkURL.trim();
    const template = buildLinkMenuTemplate(link, {
      openInNewTab: () => this.createTab(link),
      openLink: () => this.openExternal(link),
      copyLink: () => clipboard.writeText(link),
    });
    if (!template.length) return;
    Menu.buildFromTemplate(template).popup({ window: this.window });
  }

  private reloadSite(site: WebContents, hard: boolean) {
    if (site.isDestroyed()) return;
    if (hard) site.reloadIgnoringCache();
    else site.reload();
  }

  newTab(url: string = HOME_URL) {
    return this.createTab(url);
  }

  activate(id: string) {
    const tab = this.tabs.get(id);
    if (!tab || tab.site.isDestroyed()) return;

    const current = this.activeId ? this.tabs.get(this.activeId) : undefined;
    if (current && current.id !== tab.id) {
      this.detach(current);
    }
    if (!this.attached.has(tab.id)) {
      this.window.contentView.addChildView(tab.view);
      this.attached.add(tab.id);
    }
    this.activeId = tab.id;
    const storeUrl = getRestorableStoreUrl(tab.url);
    if (storeUrl) this.lastVisitedUrl = storeUrl;
    this.layout();
    tab.site.focus();
    this.schedulePersist();
    this.sendState();
    this.pushChromeState();
  }

  private detach(tab: Tab) {
    if (!this.attached.delete(tab.id)) return;
    this.window.contentView.removeChildView(tab.view);
  }

  closeTab(id: string) {
    const index = this.order.indexOf(id);
    if (index < 0) return;
    const tab = this.tabs.get(id);
    this.order.splice(index, 1);
    this.tabs.delete(id);
    if (tab) {
      this.detach(tab);
      const storeUrl = getRestorableStoreUrl(tab.url);
      if (storeUrl && this.recentlyClosed.length < MAX_RECENTLY_CLOSED) {
        this.recentlyClosed.push(storeUrl);
      }
    }

    if (this.activeId === id) {
      this.activeId = null;
      this.activate(
        this.order[Math.min(index, this.order.length - 1)] ??
          this.order[this.order.length - 1] ??
          '',
      );
    }
    if (this.order.length === 0) this.newTab();
    else {
      this.schedulePersist();
      this.sendState();
      this.pushChromeState();
    }

    tab?.detachFetchBridge();
    if (tab && !tab.site.isDestroyed()) tab.site.close();
  }

  private reopenClosedTab() {
    const url = this.recentlyClosed.pop();
    if (url) this.newTab(url);
  }

  moveTab(id: string, toIndex: number) {
    const from = this.order.indexOf(id);
    if (from < 0) return;
    const target = Math.min(Math.max(toIndex, 0), this.order.length - 1);
    if (from === target) return;
    this.order.splice(from, 1);
    this.order.splice(target, 0, id);
    this.schedulePersist();
    this.sendState();
  }

  goBack() {
    const tab = this.activeId ? this.tabs.get(this.activeId) : undefined;
    if (!tab || tab.site.isDestroyed()) return;
    if (tab.history.canGoBack()) {
      void tab.site
        .executeJavaScript('window.history.back()')
        .catch((error: unknown) => {
          log.error('Failed to go back', error);
        });
    } else if (tab.site.navigationHistory.canGoBack()) {
      tab.site.navigationHistory.goBack();
    }
  }

  goForward() {
    const tab = this.activeId ? this.tabs.get(this.activeId) : undefined;
    if (!tab || tab.site.isDestroyed()) return;
    if (tab.history.canGoForward()) {
      void tab.site
        .executeJavaScript('window.history.forward()')
        .catch((error: unknown) => {
          log.error('Failed to go forward', error);
        });
    } else if (tab.site.navigationHistory.canGoForward()) {
      tab.site.navigationHistory.goForward();
    }
  }

  reload() {
    const site = this.activeSite;
    if (site) site.reload();
  }

  focusActive() {
    this.activeSite?.focus();
    this.pushChromeState();
  }

  // The chrome renderer can finish loading after the tabs were created, and
  // any state sent before that is dropped, so it asks for a full sync.
  sync() {
    this.layout();
    this.sendState();
    this.focusActive();
  }

  private schedulePersist() {
    this.persist.schedule(this.snapshot());
  }

  private snapshot(): PersistedTabs {
    const urls = this.order
      .map((id) => {
        const tab = this.tabs.get(id);
        if (!tab) return null;
        const currentUrl =
          !tab.site.isDestroyed() && tab.site.getURL()
            ? tab.site.getURL()
            : tab.url;
        return getRestorableStoreUrl(currentUrl);
      })
      .filter((url): url is string => url !== null);
    const activeIndex = this.activeId ? this.order.indexOf(this.activeId) : 0;
    return { urls, activeIndex: Math.max(activeIndex, 0) };
  }

  persistNow = () => {
    const state = this.snapshot();
    if (state.urls.length > 0) {
      const settings = getSettingsStore();
      settings.set('tabs', state);
      if (this.lastVisitedUrl) {
        settings.set('lastUrl', this.lastVisitedUrl);
      }
    }
    this.persist.flush();
  };

  private flush = () => {
    this.persistNow();
  };

  private restore() {
    const settings = getSettingsStore();
    const session = getSessionTabs(settings.get('tabs'));
    const urls = session?.urls ?? [getStartupUrl(settings.get('lastUrl'))];
    urls.slice(0, MAX_TABS).forEach((url) => this.createTab(url, false));
    if (this.order.length === 0) this.createTab(HOME_URL, false);
    this.lastVisitedUrl = getRestorableStoreUrl(urls[urls.length - 1] ?? '');
    this.activate(
      this.order[Math.min(session?.activeIndex ?? 0, this.order.length - 1)] ??
        this.order[0] ??
        '',
    );
  }

  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.persistNow();
    app.removeListener('before-quit', this.flush);
    ipcMain.removeListener(TAB_COMMAND_CHANNEL, this.onTabCommand);
    this.window.removeListener('resize', this.layout);
    this.window.removeListener('enter-full-screen', this.onFullScreenChange);
    this.window.removeListener('leave-full-screen', this.onFullScreenChange);
    this.window.removeListener('close', this.flush);
    this.window.removeListener('closed', this.dispose);
    for (const tab of this.tabs.values()) {
      tab.detachFetchBridge();
      if (!tab.site.isDestroyed()) tab.site.close();
    }
    this.tabs.clear();
    this.attached.clear();
    this.order = [];
    this.activeId = null;
  };
}
