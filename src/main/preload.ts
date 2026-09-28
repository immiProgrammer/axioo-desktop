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

const makeButton = (label: string, icon: string, className: string) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `axioo-toolbar-button ${className}`;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  return button;
};

const menuIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
const backIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7M7 12h13"/></svg>';
const forwardIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5 7 7-7 7M17 12H4"/></svg>';
const theme = window.matchMedia('(prefers-color-scheme: dark)');
const titlebarBackground = () =>
  TitlebarColor.fromHex(theme.matches ? '#202124' : '#f6f8fb');

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
  const menu = makeButton('Open menu', menuIcon, 'axioo-menu-button');
  const logo = document.createElement('img');
  logo.className = 'axioo-toolbar-logo';
  logo.alt = '';
  logo.src = new URL('./axioo-icon.png', window.location.href).href;
  left.append(back, forward, menu);
  const center = document.createElement('div');
  center.className = 'axioo-toolbar-center';
  const title = document.createElement('span');
  title.className = 'axioo-toolbar-title';
  title.textContent = 'Axioo Desktop';
  center.append(logo, title);

  titlebar.titlebarElement.append(left, center);
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
  ipcRenderer.on('toolbar:title', (_event, pageTitle: string) => {
    title.textContent = pageTitle;
    title.title = pageTitle;
  });
  ipcRenderer.send('toolbar:command', 'ready');
});
