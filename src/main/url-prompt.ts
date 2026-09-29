import { existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, nativeTheme } from 'electron';

function getDialogIcon(): string | undefined {
  const root = app.getAppPath();
  const ico = path.join(root, 'assets', 'icon.ico');
  if (process.platform === 'win32' && existsSync(ico)) return ico;
  const png = path.join(root, 'assets', 'icon.png');
  if (existsSync(png)) return png;
  return undefined;
}

export function promptEditTabUrl(
  parent: BrowserWindow,
  currentUrl = '',
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let submittedUrl: string | null = null;

    const isDark = nativeTheme.shouldUseDarkColors;
    const bg = isDark ? '#2b2b2b' : '#ffffff';
    const icon = getDialogIcon();

    const promptWin = new BrowserWindow({
      parent,
      modal: true,
      width: 470,
      height: 172,
      useContentSize: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: 'Edit Tab URL',
      backgroundColor: bg,
      ...(icon ? { icon } : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    if (icon) {
      promptWin.setIcon(icon);
    }

    promptWin.setMenu(null);
    promptWin.removeMenu();

    promptWin.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Alt') {
        event.preventDefault();
      }
    });

    const safeCurrentUrl = currentUrl.replace(/"/g, '&quot;');
    const primaryColor = isDark ? '#ffffff' : '#000000';
    const primaryTextColor = isDark ? '#000000' : '#ffffff';
    const primaryHoverBg = isDark ? '#e4e4e7' : '#262626';
    const primaryActiveBg = isDark ? '#d4d4d8' : '#404040';
    const primaryDisabledBg = isDark ? '#404040' : '#e0e0e0';
    const primaryDisabledText = isDark ? '#808080' : '#8c8c8c';
    const mainBg = isDark ? '#2b2b2b' : '#ffffff';
    const footerBg = isDark ? '#202020' : '#f0f0f0';
    const footerBorder = isDark ? '#333333' : '#dcdcdc';
    const textColor = isDark ? '#ffffff' : '#000000';
    const subtextColor = isDark ? '#a0a0a0' : '#5c5c5c';
    const inputBg = isDark ? '#1e1e1e' : '#ffffff';
    const inputBorder = isDark ? '#5a5a5a' : '#868686';
    const cancelBtnBg = isDark ? '#2b2b2b' : '#ffffff';
    const cancelBtnBorder = isDark ? '#5a5a5a' : '#adadad';
    const cancelBtnHover = isDark ? '#383838' : '#e5e5e5';

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Edit Tab URL</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
      -webkit-user-select: none;
      cursor: default;
    }
    body {
      font-family: "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
      font-size: 12px;
      color: ${textColor};
      background: ${mainBg};
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    .dialog-content {
      padding: 14px 16px 10px 16px;
      display: flex;
      gap: 14px;
      flex: 1;
    }
    .dialog-icon {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      margin-top: 2px;
    }
    .dialog-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .dialog-prompt {
      font-size: 12px;
      line-height: 16px;
      color: ${textColor};
      margin-bottom: 10px;
    }
    .input-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .input-label {
      font-size: 12px;
      color: ${textColor};
      flex-shrink: 0;
    }
    input {
      flex: 1;
      height: 24px;
      padding: 2px 7px;
      font-family: inherit;
      font-size: 12px;
      color: ${textColor};
      background: ${inputBg};
      border: 1px solid ${inputBorder};
      border-radius: 2px;
      outline: none;
      user-select: text;
      -webkit-user-select: text;
      cursor: text;
    }
    input:focus {
      border-color: ${primaryColor};
      box-shadow: 0 0 0 1px ${primaryColor};
    }
    .status-text {
      font-size: 11px;
      line-height: 14px;
      min-height: 14px;
      color: ${subtextColor};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .status-text.invalid {
      color: ${isDark ? '#ff9999' : '#c42b1c'};
    }
    .status-text.valid {
      color: ${isDark ? '#6ccb5f' : '#0f7b0f'};
    }
    .dialog-footer {
      height: 44px;
      background: ${footerBg};
      border-top: 1px solid ${footerBorder};
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 0 16px;
      gap: 8px;
      flex-shrink: 0;
    }
    .btn {
      min-width: 75px;
      height: 24px;
      padding: 0 12px;
      font-family: inherit;
      font-size: 12px;
      border-radius: 2px;
      outline: none;
      border: 1px solid transparent;
      transition: background 0.1s ease, border-color 0.1s ease;
    }
    .btn:focus-visible {
      outline: 2px solid ${primaryColor};
      outline-offset: 1px;
    }
    .btn-default {
      background: ${primaryColor};
      color: ${primaryTextColor};
      border-color: ${primaryColor};
      font-weight: 500;
    }
    .btn-default:hover:not(:disabled) {
      background: ${primaryHoverBg};
      border-color: ${primaryHoverBg};
    }
    .btn-default:active:not(:disabled) {
      background: ${primaryActiveBg};
      border-color: ${primaryActiveBg};
    }
    .btn-default:disabled {
      background: ${primaryDisabledBg};
      color: ${primaryDisabledText};
      border-color: ${primaryDisabledBg};
      cursor: default;
    }
    .btn-cancel {
      background: ${cancelBtnBg};
      color: ${textColor};
      border-color: ${cancelBtnBorder};
    }
    .btn-cancel:hover {
      background: ${cancelBtnHover};
    }
    .btn-cancel:active {
      filter: brightness(0.95);
    }
  </style>
</head>
<body>
  <div class="dialog-content">
    <div class="dialog-icon">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="13" stroke="${primaryColor}" stroke-width="1.8"/>
        <ellipse cx="16" cy="16" rx="6" ry="13" stroke="${primaryColor}" stroke-width="1.5"/>
        <line x1="3" y1="16" x2="29" y2="16" stroke="${primaryColor}" stroke-width="1.5"/>
        <line x1="5.5" y1="10.5" x2="26.5" y2="10.5" stroke="${primaryColor}" stroke-width="1.2"/>
        <line x1="5.5" y1="21.5" x2="26.5" y2="21.5" stroke="${primaryColor}" stroke-width="1.2"/>
      </svg>
    </div>
    <div class="dialog-main">
      <div class="dialog-prompt">Type the HTTPS address of the Axioo page to open:</div>
      <div class="input-row">
        <label for="urlInput" class="input-label">Open:</label>
        <input id="urlInput" type="text" autocomplete="off" spellcheck="false" value="${safeCurrentUrl}" />
      </div>
      <div id="statusText" class="status-text"></div>
    </div>
  </div>
  <div class="dialog-footer">
    <button type="button" class="btn btn-default" id="btnSubmit">OK</button>
    <button type="button" class="btn btn-cancel" id="btnCancel">Cancel</button>
  </div>
  <script>
    const input = document.getElementById('urlInput');
    const statusText = document.getElementById('statusText');
    const btnSubmit = document.getElementById('btnSubmit');
    const btnCancel = document.getElementById('btnCancel');

    document.addEventListener('contextmenu', function(e) {
      e.preventDefault();
    });
    document.addEventListener('dragover', function(e) {
      e.preventDefault();
    });
    document.addEventListener('drop', function(e) {
      e.preventDefault();
    });

    function isValidAxiooHost(host) {
      const h = host.toLowerCase().trim();
      if (h === 'axioo.store') return true;
      if (!h.endsWith('.axioo.store')) return false;
      const sub = h.slice(0, -'.axioo.store'.length);
      if (!sub) return false;
      return sub.split('.').every(function(label) {
        return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(label);
      });
    }

    function check(val) {
      const trimmed = val.trim();
      if (!trimmed) return { valid: false, message: 'URL cannot be empty' };
      try {
        const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
        const candidate = hasScheme ? trimmed : 'https://' + trimmed;
        const url = new URL(candidate);
        if (url.protocol !== 'https:') {
          return { valid: false, message: 'Only HTTPS protocol is supported' };
        }
        if (!isValidAxiooHost(url.hostname)) {
          return { valid: false, message: 'Address must be on axioo.store or *.axioo.store' };
        }
        if (url.port && url.port !== '443') {
          return { valid: false, message: 'Non-standard port is not allowed' };
        }
        return { valid: true, url: url.href };
      } catch (e) {
        return { valid: false, message: 'Invalid address format' };
      }
    }

    function update() {
      const res = check(input.value);
      if (res.valid) {
        statusText.className = 'status-text valid';
        statusText.textContent = res.url;
        btnSubmit.disabled = false;
      } else {
        statusText.className = 'status-text invalid';
        statusText.textContent = res.message;
        btnSubmit.disabled = true;
      }
      return res;
    }

    function doSubmit() {
      const res = update();
      if (res.valid) {
        document.title = 'SUBMIT:' + res.url;
      }
    }

    function doCancel() {
      document.title = 'CANCEL';
    }

    input.addEventListener('input', update);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        doCancel();
      }
    });

    btnSubmit.addEventListener('click', doSubmit);
    btnCancel.addEventListener('click', doCancel);

    window.addEventListener('keydown', function(e) {
      if (e.key === 'Alt') e.preventDefault();
      if (e.key === 'Escape') doCancel();
    });

    update();
    setTimeout(function() {
      input.focus();
      input.select();
    }, 40);
  </script>
</body>
</html>`;

    promptWin.on('page-title-updated', (event, title) => {
      event.preventDefault();
      if (title.startsWith('SUBMIT:')) {
        submittedUrl = title.slice('SUBMIT:'.length);
        promptWin.close();
      } else if (title === 'CANCEL') {
        promptWin.close();
      }
    });

    promptWin.once('ready-to-show', () => {
      promptWin.show();
      promptWin.focus();
    });

    promptWin.on('closed', () => {
      if (!settled) {
        settled = true;
        resolve(submittedUrl);
      }
    });

    void promptWin.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
  });
}
