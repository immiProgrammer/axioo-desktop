/* eslint promise/always-return: off */
import { ipcRenderer } from 'electron';
import {
  createTitlebarOnDOMContentLoaded,
  TitlebarColor,
} from 'custom-electron-titlebar';

type HistoryState = {
  canGoBack: boolean;
  canGoForward: boolean;
};

type TabState = {
  id: string;
  title: string;
  url: string;
  active: boolean;
};

type ChromeLayout = {
  tabStripVisible: boolean;
  rightInset: number;
};

const TAB_COMMAND_CHANNEL = 'tabs:command';
const TAB_STATE_CHANNEL = 'tabs:state';
const LAYOUT_CHANNEL = 'layout:chrome';

const makeButton = (label: string, icon: string, className: string) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `axioo-toolbar-button ${className}`;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  return button;
};

const backIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7M7 12h13"/></svg>';
const forwardIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5 7 7-7 7M17 12H4"/></svg>';
const newTabIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const closeIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
const theme = window.matchMedia('(prefers-color-scheme: dark)');
const titlebarBackground = () =>
  TitlebarColor.fromHex(theme.matches ? '#2c2c2c' : '#f6f8fb');

void createTitlebarOnDOMContentLoaded({
  backgroundColor: titlebarBackground(),
  removeMenuBar: true,
  titleHorizontalAlignment: 'left',
  shadow: false,
}).then((titlebar) => {
  titlebar.titleElement.hidden = true;

  const left = document.createElement('div');
  left.className = 'axioo-toolbar-left';
  const back = makeButton('Back', backIcon, 'axioo-back-button');
  const forward = makeButton('Forward', forwardIcon, 'axioo-forward-button');
  back.disabled = true;
  forward.disabled = true;
  // The app icon doubles as the menu affordance, so no hamburger glyph.
  const menu = makeButton('Open menu', '', 'axioo-menu-button');
  const menuIcon = document.createElement('img');
  menuIcon.className = 'axioo-menu-icon';
  menuIcon.alt = '';
  menuIcon.src = new URL('./axioo-icon.png', window.location.href).href;
  menu.append(menuIcon);
  left.append(menu, back, forward);
  titlebar.titlebarElement.append(left);
  const syncStripOffset = () => {
    document.documentElement.style.setProperty(
      '--axioo-toolbar-width',
      `${Math.round(left.getBoundingClientRect().width)}px`,
    );
  };
  syncStripOffset();
  window.addEventListener('resize', syncStripOffset);
  theme.addEventListener('change', () => {
    titlebar.updateBackground(titlebarBackground());
  });
  menu.addEventListener('click', () =>
    ipcRenderer.send('toolbar:command', 'menu'),
  );
  back.addEventListener('click', () =>
    ipcRenderer.send('toolbar:command', 'back'),
  );
  forward.addEventListener('click', () =>
    ipcRenderer.send('toolbar:command', 'forward'),
  );
  ipcRenderer.on('toolbar:history', (_event, state: HistoryState) => {
    back.disabled = !state.canGoBack;
    forward.disabled = !state.canGoForward;
  });

  const strip = document.createElement('div');
  strip.className = 'axioo-tab-strip';
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'Open tabs');
  const list = document.createElement('div');
  list.className = 'axioo-tab-list';
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'axioo-tab-new';
  addButton.title = 'New tab';
  addButton.setAttribute('aria-label', 'New tab');
  addButton.innerHTML = newTabIcon;
  strip.append(list, addButton);
  document.body.append(strip);
  if (process.platform === 'darwin') {
    document.body.classList.add('axioo-mac');
  }

  let draggedId: string | null = null;
  let draggedElement: Element | null = null;
  let dropIndex = 0;

  const dropIndexAt = (clientX: number) => {
    let index = 0;
    for (const element of list.children) {
      if (element === draggedElement) continue;
      const bounds = element.getBoundingClientRect();
      if (clientX > bounds.left + bounds.width / 2) index += 1;
    }
    return index;
  };

  const renderTabs = (tabs: TabState[]) => {
    list.textContent = '';
    for (const tab of tabs) {
      const element = document.createElement('div');
      element.className = 'axioo-tab';
      element.dataset.tabId = tab.id;
      element.draggable = true;
      element.title = tab.url;
      element.setAttribute('role', 'tab');
      element.tabIndex = tab.active ? 0 : -1;
      if (tab.active) {
        element.classList.add('axioo-tab-active');
        element.setAttribute('aria-selected', 'true');
      } else {
        element.setAttribute('aria-selected', 'false');
      }

      const label = document.createElement('span');
      label.className = 'axioo-tab-title';
      label.textContent = tab.title;
      element.append(label);

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'axioo-tab-close';
      close.title = 'Close tab';
      close.setAttribute('aria-label', `Close ${tab.title}`);
      close.innerHTML = closeIcon;
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        ipcRenderer.send(TAB_COMMAND_CHANNEL, `close:${tab.id}`);
      });
      element.append(close);

      element.addEventListener('click', () =>
        ipcRenderer.send(TAB_COMMAND_CHANNEL, `select:${tab.id}`),
      );
      element.addEventListener('mousedown', (event) => {
        // A middle press on the overflow container would otherwise start a
        // horizontal auto-scroll; the press is reserved for closing the tab.
        if (event.button === 1) {
          event.preventDefault();
          event.stopPropagation();
        }
      });
      element.addEventListener('auxclick', (event) => {
        if (event.button === 1) {
          event.preventDefault();
          event.stopPropagation();
          ipcRenderer.send(TAB_COMMAND_CHANNEL, `close:${tab.id}`);
        }
      });
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          ipcRenderer.send(TAB_COMMAND_CHANNEL, `select:${tab.id}`);
        }
      });
      element.addEventListener('dragstart', (event) => {
        draggedId = tab.id;
        draggedElement = element;
        element.classList.add('axioo-tab-dragging');
        event.dataTransfer?.setData('text/plain', tab.id);
      });
      element.addEventListener('dragend', () => {
        draggedId = null;
        draggedElement = null;
        element.classList.remove('axioo-tab-dragging');
        list.classList.remove('axioo-tab-list-dragging');
      });
      element.addEventListener('dragover', (event) => {
        if (!draggedId) return;
        event.preventDefault();
        dropIndex = dropIndexAt(event.clientX);
      });

      list.append(element);
    }
  };

  list.addEventListener('mousedown', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  list.addEventListener('dragover', (event) => {
    if (!draggedId) return;
    event.preventDefault();
    dropIndex = dropIndexAt(event.clientX);
    list.classList.add('axioo-tab-list-dragging');
  });
  list.addEventListener('dragleave', () => {
    list.classList.remove('axioo-tab-list-dragging');
  });
  list.addEventListener('drop', (event) => {
    event.preventDefault();
    list.classList.remove('axioo-tab-list-dragging');
    if (draggedId) {
      ipcRenderer.send(TAB_COMMAND_CHANNEL, `move:${draggedId}:${dropIndex}`);
    }
    draggedId = null;
    draggedElement = null;
  });

  addButton.addEventListener('click', () =>
    ipcRenderer.send(TAB_COMMAND_CHANNEL, 'new'),
  );

  ipcRenderer.on(TAB_STATE_CHANNEL, (_event, tabs: TabState[]) => {
    renderTabs(Array.isArray(tabs) ? tabs : []);
  });
  ipcRenderer.on(LAYOUT_CHANNEL, (_event, layout: ChromeLayout) => {
    const visible = layout?.tabStripVisible !== false;
    strip.hidden = !visible;
    if (layout && layout.rightInset > 0) {
      document.documentElement.style.setProperty(
        '--axioo-tabs-right',
        `${layout.rightInset}px`,
      );
    }
  });
  ipcRenderer.send('toolbar:command', 'ready');
});
