const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

require('dotenv').config({ quiet: true });

// Mirrors the app: an unusable APP_URL falls back to the production URL.
const siteUrl = (() => {
  try {
    return new URL(process.env.APP_URL || 'https://axioo.store/');
  } catch {
    return new URL('https://axioo.store/');
  }
})();
const siteIsProduction =
  siteUrl.hostname === 'axioo.store' ||
  siteUrl.hostname.endsWith('.axioo.store');
const matchesSite = (rawUrl) => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  return siteIsProduction
    ? url.protocol === 'https:' &&
        (url.hostname === siteUrl.hostname ||
          url.hostname.endsWith(`.${siteUrl.hostname}`))
    : url.origin === siteUrl.origin;
};

const debugPort = Number(process.env.SMOKE_DEBUG_PORT || 9335);
const rendererPort = Number(process.env.PORT || 1212);
const windows = process.platform === 'win32';
// A throwaway profile keeps the restored tab session deterministic and never
// touches the developer's real settings.
const userDataDir = path.join(os.tmpdir(), `axioo-smoke-${process.pid}`);
fs.rmSync(userDataDir, { recursive: true, force: true });
const child = spawn(
  windows ? 'npm.cmd' : 'npm',
  [
    'start',
    '--',
    '--remoteDebuggingPort',
    String(debugPort),
    ...(process.env.CI && process.platform === 'linux' ? ['--noSandbox'] : []),
  ],
  {
    detached: !windows,
    shell: windows,
    env: {
      ...process.env,
      APPDATA: userDataDir,
      XDG_CONFIG_HOME: userDataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let output = '';
let exited = false;
let socket;
let toolbarSocket;
const extraSockets = [];
child.stdout.on('data', (data) => {
  output += data;
});
child.stderr.on('data', (data) => {
  output += data;
});
child.on('exit', () => {
  exited = true;
});
child.on('error', (error) => {
  output += error.stack;
  exited = true;
});

async function waitFor(check, description, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`npm start exited before ${description}`);
    const value = await check();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function main() {
  const target = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      return targets.find((entry) => {
        if (entry.type !== 'page') return false;
        return matchesSite(entry.url);
      });
    } catch {
      return null;
    }
  }, 'Axioo Store window');

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const requests = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (requests.has(message.id)) {
      requests.get(message.id)(message);
      requests.delete(message.id);
    }
  });
  function command(targetSocket, method, params = {}) {
    id += 1;
    const requestId = id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        requests.delete(requestId);
        reject(new Error(`Timed out: ${method}`));
      }, 15_000);
      requests.set(requestId, (message) => {
        clearTimeout(timeout);
        if (message.error || message.result?.exceptionDetails) {
          reject(new Error(JSON.stringify(message)));
        } else resolve(message.result);
      });
      targetSocket.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  function send(method, params = {}) {
    return command(socket, method, params);
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return result.result.value;
  }
  await send('Runtime.enable');
  assert.equal(await evaluate('typeof window.require'), 'undefined');

  const toolbarTarget = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      return targets.find(
        (entry) =>
          entry.type === 'page' &&
          entry.url === `http://localhost:${rendererPort}/`,
      );
    } catch {
      return null;
    }
  }, 'local title bar');
  toolbarSocket = new WebSocket(toolbarTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    toolbarSocket.addEventListener('open', resolve, { once: true });
    toolbarSocket.addEventListener('error', reject, { once: true });
  });
  let toolbarRequestId = 0;
  const evaluateToolbar = (expression) =>
    new Promise((resolve, reject) => {
      toolbarRequestId += 1;
      const requestId = toolbarRequestId;
      const onMessage = ({ data }) => {
        const message = JSON.parse(data);
        if (message.id !== requestId) return;
        toolbarSocket.removeEventListener('message', onMessage);
        if (message.error || message.result?.exceptionDetails) {
          reject(new Error(JSON.stringify(message)));
        } else resolve(message.result.result.value);
      };
      toolbarSocket.addEventListener('message', onMessage);
      toolbarSocket.send(
        JSON.stringify({
          id: requestId,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        }),
      );
    });
  const titlebarReady = await waitFor(
    () =>
      evaluateToolbar(
        "Boolean(document.querySelector('.axioo-menu-button') && document.querySelector('.axioo-menu-button .axioo-menu-icon') && document.querySelector('.axioo-back-button') && document.querySelector('.axioo-forward-button'))",
      ),
    'custom title bar controls',
  );
  assert.equal(titlebarReady, true);
  await waitFor(
    () => evaluateToolbar("document.visibilityState === 'visible'"),
    'visible application window',
    10_000,
  );
  assert.deepEqual(
    await evaluateToolbar(
      "[...document.querySelector('.axioo-toolbar-left').children].map((element) => element.className)",
    ),
    [
      'axioo-toolbar-button axioo-menu-button',
      'axioo-toolbar-button axioo-back-button',
      'axioo-toolbar-button axioo-forward-button',
    ],
  );
  assert.equal(
    await evaluateToolbar(
      "(() => { const buttons = [...document.querySelector('.axioo-toolbar-left').children].map((button) => button.getBoundingClientRect()); return Math.round(buttons[0].left) === 0 && buttons.every((bounds, index) => index === 0 || Math.round(bounds.left - buttons[index - 1].right) <= 2); })()",
    ),
    true,
    'the menu button should start flush at the window edge with no gaps',
  );
  await waitFor(
    () =>
      evaluateToolbar(
        "(() => { const icon = document.querySelector('.axioo-menu-button .axioo-menu-icon'); return icon && icon.naturalWidth > 0 && icon.getBoundingClientRect().width === 24; })()",
      ),
    'menu button icon',
  );
  assert.equal(
    await evaluateToolbar(
      "getComputedStyle(document.querySelector('.cet-titlebar')).height",
    ),
    '30px',
  );
  if (windows) {
    await waitFor(
      () =>
        evaluateToolbar(
          "navigator.windowControlsOverlay?.visible === true && navigator.windowControlsOverlay.getTitlebarAreaRect().height === 30 && getComputedStyle(document.querySelector('.cet-window-controls')).display === 'none'",
        ),
      'native Windows caption buttons',
    );
  }
  const stripStyle = await waitFor(
    () =>
      evaluateToolbar(
        "(() => { const strip = document.querySelector('.axioo-tab-strip'); if (!strip) return null; const style = getComputedStyle(strip); return { top: style.top, height: style.height, hidden: strip.hidden }; })()",
      ),
    'tab strip',
  );
  assert.equal(stripStyle.top, '0px');
  assert.equal(stripStyle.height, '30px');
  assert.equal(stripStyle.hidden, false);
  // The strip must paint above the library's opaque .cet-titlebar, otherwise
  // the tabs exist in the DOM but are hidden behind the caption.
  assert.equal(
    await evaluateToolbar(
      "(() => { const tab = document.querySelector('.axioo-tab'); const bounds = tab.getBoundingClientRect(); const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2); return Boolean(hit && hit.closest('.axioo-tab-strip')); })()",
    ),
    true,
    'the tab strip must be the visible layer on the caption row',
  );
  assert.equal(
    await evaluateToolbar(
      "(() => { const button = document.querySelector('.axioo-tab-new'); const bounds = button.getBoundingClientRect(); const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2); return Boolean(hit && hit.closest('.axioo-tab-strip')); })()",
    ),
    true,
    'the new tab button must be clickable',
  );
  await waitFor(
    () =>
      evaluateToolbar(
        "document.querySelectorAll('.axioo-tab').length === 1 && document.querySelector('.axioo-tab').classList.contains('axioo-tab-active')",
      ),
    'restored tab',
  );
  assert.equal(
    await evaluateToolbar(
      "document.querySelector('.axioo-back-button').disabled",
    ),
    true,
  );
  assert.equal(
    await evaluateToolbar(
      "document.querySelector('.axioo-forward-button').disabled",
    ),
    true,
  );
  await waitFor(
    () =>
      evaluate(
        `window.location.protocol === ${JSON.stringify(siteUrl.protocol)} && window.location.hostname === ${JSON.stringify(siteUrl.hostname)} && document.readyState === 'complete'`,
      ),
    'site ready',
  );
  assert.equal(await evaluate('typeof window.__axiooFetch'), 'function');
  assert.equal(await evaluate('window.__AXIOO_DESKTOP__.version'), 1);
  const bridged = await evaluate(
    "__axiooFetch(location.origin + '/').then((response) => response.text().then((body) => ({ status: response.status, length: body.length })), (error) => ({ error: String(error) }))",
  );
  assert.ok(
    typeof bridged.status === 'number' && bridged.status >= 100,
    `Axioo fetch bridge did not return a response: ${JSON.stringify(bridged)}`,
  );
  assert.ok(bridged.length > 0, 'Axioo fetch bridge returned an empty body');
  const pageTitle = await evaluate('document.title');
  const activeTabTitle = () =>
    evaluateToolbar(
      "document.querySelector('.axioo-tab-active .axioo-tab-title')?.textContent ?? ''",
    );
  await waitFor(
    () =>
      activeTabTitle().then(
        (value) => value === (pageTitle.trim() || 'Axioo Store'),
      ),
    'page title shown in the active tab',
  );
  await evaluate("document.title = 'Orders'; true");
  await waitFor(
    () => activeTabTitle().then((value) => value === 'Orders'),
    'tab title follows the page title',
  );
  await evaluate("document.title = 'AxIoO Orders'; true");
  await waitFor(
    () => activeTabTitle().then((value) => value === 'AxIoO Orders'),
    'tab title keeps a page title that already mentions Axioo',
  );
  await evaluate(`document.title = ${JSON.stringify(pageTitle)}; true`);
  const initialUrl = await evaluate('window.location.href');

  // Tabs live on the caption row, so the site view only clears that row.
  const chromeHeight = await evaluateToolbar('window.innerHeight');
  const siteHeight = await evaluate('window.innerHeight');
  assert.equal(
    chromeHeight - siteHeight,
    30,
    'the site view should start under the 30px caption that also holds the tab strip',
  );

  const connectTo = async (pageTarget) => {
    const pageSocket = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      pageSocket.addEventListener('open', resolve, { once: true });
      pageSocket.addEventListener('error', reject, { once: true });
    });
    pageSocket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (requests.has(message.id)) {
        requests.get(message.id)(message);
        requests.delete(message.id);
      }
    });
    const evaluatePage = (expression) =>
      new Promise((resolve, reject) => {
        const requestId = (id += 1);
        const onMessage = ({ data }) => {
          const message = JSON.parse(data);
          if (message.id !== requestId) return;
          pageSocket.removeEventListener('message', onMessage);
          if (message.error || message.result?.exceptionDetails) {
            reject(new Error(JSON.stringify(message)));
          } else resolve(message.result.result.value);
        };
        pageSocket.addEventListener('message', onMessage);
        pageSocket.send(
          JSON.stringify({
            id: requestId,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true, awaitPromise: true },
          }),
        );
      });
    return { pageSocket, evaluatePage };
  };
  const pressCtrl = async (key, targetSocket = socket) => {
    const code = `Key${key.toUpperCase()}`;
    const params = {
      key,
      code,
      windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
      nativeVirtualKeyCode: key.toUpperCase().charCodeAt(0),
      modifiers: 2,
    };
    // rawKeyDown is the only CDP key type that reaches before-input-event.
    await command(targetSocket, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      ...params,
    });
    await command(targetSocket, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...params,
    });
  };
  const pressKey = async (key, targetSocket = socket, modifiers = 0) => {
    const virtualKeyCodes = { F5: 116 };
    const name = key.toUpperCase();
    const virtualKeyCode = virtualKeyCodes[name] ?? name.charCodeAt(0);
    const params = {
      key,
      code: key.length === 1 ? `Key${name}` : name,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      modifiers,
    };
    // rawKeyDown is the only CDP key type that reaches before-input-event.
    await command(targetSocket, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      ...params,
    });
    await command(targetSocket, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...params,
    });
  };
  const tabCount = () =>
    evaluateToolbar("document.querySelectorAll('.axioo-tab').length");
  const activeTabIndex = () =>
    evaluateToolbar(
      "[...document.querySelectorAll('.axioo-tab')].findIndex((tab) => tab.classList.contains('axioo-tab-active'))",
    );

  const tabIds = () =>
    evaluateToolbar(
      "[...document.querySelectorAll('.axioo-tab')].map((tab) => tab.dataset.tabId)",
    );
  await waitFor(
    () => evaluateToolbar("Boolean(document.querySelector('.axioo-tab'))"),
    'first tab id',
  );
  const originalId = (await tabIds())[0];

  await evaluateToolbar("document.querySelector('.axioo-tab-new').click()");
  await waitFor(async () => (await tabCount()) === 2, 'second tab', 15_000);
  assert.equal(await activeTabIndex(), 1);
  assert.equal(
    await evaluateToolbar(
      "(() => { const widths = [...document.querySelectorAll('.axioo-tab')].map((tab) => Math.round(tab.getBoundingClientRect().width)); return widths.every((width) => width === widths[0]); })()",
    ),
    true,
    'every tab should use the same fixed width',
  );
  assert.equal(
    await evaluateToolbar(
      "(() => { const tabs = [...document.querySelectorAll('.axioo-tab')]; const last = tabs[tabs.length - 1].getBoundingClientRect(); const add = document.querySelector('.axioo-tab-new').getBoundingClientRect(); const gap = add.left - last.right; return gap > 0 && gap <= 12; })()",
    ),
    true,
    'the new-tab button should sit right after the last tab',
  );
  assert.equal(
    await evaluateToolbar(
      "(() => { const tab = document.querySelector('.axioo-tab'); const bounds = tab.getBoundingClientRect(); const close = tab.querySelector('.axioo-tab-close').getBoundingClientRect(); return Math.abs((close.top + close.height / 2) - (bounds.top + bounds.height / 2)) < 1; })()",
    ),
    true,
    'the close button should sit vertically centered on the tab',
  );
  assert.equal(
    await evaluateToolbar(
      "getComputedStyle(document.querySelector('.axioo-tab-close')).backgroundImage",
    ),
    'none',
    'the close button itself should have no gradient',
  );
  const fade = await evaluateToolbar(
    "(() => { const active = document.querySelector('.axioo-tab-active'); const idle = document.querySelector('.axioo-tab:not(.axioo-tab-active)'); const style = getComputedStyle(active, '::after'); return { background: style.backgroundImage, width: style.width, opacity: style.opacity, closeZIndex: getComputedStyle(active.querySelector('.axioo-tab-close')).zIndex, activeTitle: getComputedStyle(active.querySelector('.axioo-tab-title')).opacity, idleOpacity: getComputedStyle(idle, '::after').opacity, idleTitle: getComputedStyle(idle.querySelector('.axioo-tab-title')).opacity }; })()",
  );
  assert.match(
    fade.background,
    /gradient/,
    'the fade behind the close button should be a gradient',
  );
  assert.ok(parseFloat(fade.width) > 0, 'the fade should have width');
  assert.equal(fade.opacity, '1', 'the active tab should show the fade');
  assert.equal(
    fade.closeZIndex,
    '1',
    'the close button should paint above the fade',
  );
  assert.equal(
    fade.activeTitle,
    '1',
    'the active tab title should stay opaque',
  );
  assert.equal(fade.idleOpacity, '0', 'an idle tab should hide the fade');
  assert.equal(fade.idleTitle, '1', 'an idle tab title should be fully opaque');
  assert.equal(
    await evaluateToolbar(
      "(() => { const title = getComputedStyle(document.querySelector('.axioo-tab-active .axioo-tab-title')); return title.maskImage !== 'none' || title.webkitMaskImage !== 'none'; })()",
    ),
    true,
    'the active tab title should fade out under the close button',
  );
  // Hover cannot be forced on this window, so assert the rules that show the
  // fade, the masked title and the close button while hovering.
  assert.equal(
    await evaluateToolbar(
      "(() => { const selectors = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).flatMap((rule) => (rule.selectorText || '').split(',').map((part) => part.trim())); return ['.axioo-tab:hover::after', '.axioo-tab:hover .axioo-tab-title', '.axioo-tab:hover .axioo-tab-close'].every((selector) => selectors.includes(selector)); })()",
    ),
    true,
    'hovering a tab should reveal the fade, mask the title and show the close button',
  );
  assert.equal(
    await evaluateToolbar(
      "(() => { const rule = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).find((entry) => (entry.selectorText || '').split(',').map((part) => part.trim()).includes('.axioo-menu-button:hover:not(:disabled)')); return Boolean(rule) && /background:\\s*transparent/.test(rule.cssText); })()",
    ),
    true,
    'the menu button should keep a transparent hover background',
  );
  const freshId = (await tabIds())[1];
  const secondTarget = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json();
    return targets.find(
      (entry) =>
        entry.type === 'page' &&
        entry.id !== target.id &&
        matchesSite(entry.url),
    );
  }, 'second tab window');
  const second = await connectTo(secondTarget);
  extraSockets.push(second.pageSocket);
  const secondBridge = await waitFor(
    () =>
      second
        .evaluatePage(
          '({ fn: typeof window.__axiooFetch, hasApi: Boolean(window.__AXIOO_DESKTOP__), state: document.readyState, href: window.location.href })',
        )
        .then((info) => (info?.fn === 'function' ? info : null)),
    'fetch bridge for the second tab',
    25_000,
  );
  assert.equal(secondBridge.fn, 'function');
  assert.equal(secondBridge.hasApi, true);
  assert.equal(
    await second.evaluatePage('window.__AXIOO_DESKTOP__.version'),
    1,
  );
  const expectedTabTitle = pageTitle.trim() || 'Axioo Store';
  await waitFor(
    () =>
      evaluateToolbar(
        `document.querySelectorAll('.axioo-tab-title')[1].textContent === ${JSON.stringify(expectedTabTitle)}`,
      ),
    'second tab title',
    20_000,
  );

  // Reorder the tabs the way a drag-and-drop would, then confirm the order
  // swapped while the active tab stayed active.
  assert.equal(
    await evaluateToolbar(`(() => {
      const tabs = [...document.querySelectorAll('.axioo-tab')];
      const dataTransfer = new DataTransfer();
      tabs[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      const bounds = tabs[1].getBoundingClientRect();
      const clientX = bounds.left + bounds.width * 0.9;
      tabs[1].dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX, dataTransfer }));
      tabs[1].dispatchEvent(new DragEvent('drop', { bubbles: true, clientX, dataTransfer }));
      tabs[0].dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
      return true;
    })()`),
    true,
  );
  await waitFor(
    async () => {
      const ids = await tabIds();
      return ids[0] === freshId && ids[1] === originalId;
    },
    'reordered tabs',
    10_000,
  );
  assert.equal(await activeTabIndex(), 0);

  // The reordered tab is active, so its view owns the keyboard shortcuts.
  await pressCtrl('T', second.pageSocket);
  await waitFor(async () => (await tabCount()) === 3, 'third tab', 15_000);
  await pressCtrl('W', second.pageSocket);
  await waitFor(async () => (await tabCount()) === 2, 'closed tab', 15_000);
  assert.equal(await activeTabIndex(), 1);
  assert.equal((await tabIds())[1], originalId);

  // F5 and Ctrl+R both refresh the active tab; a marker set on the live
  // document disappears only if the page really reloaded.
  for (const [label, press] of [
    ['F5', async () => pressKey('F5', socket)],
    ['Ctrl+R', async () => pressKey('R', socket, 2)],
  ]) {
    await evaluate('window.__axiooReloadProbe = 1; true');
    // A key sent while the renderer swaps documents can miss its ack; the
    // reload itself is what matters and is asserted below.
    await press().catch(() => {});
    await waitFor(
      async () => (await evaluate('window.__axiooReloadProbe')) !== 1,
      `${label} reloads the active tab`,
      25_000,
    );
  }
  await waitFor(
    () => evaluate('document.readyState === "complete"'),
    'page ready after reload',
    25_000,
  );

  await evaluateToolbar(
    `[...document.querySelectorAll('.axioo-tab')].find((tab) => tab.dataset.tabId === ${JSON.stringify(freshId)}).querySelector('.axioo-tab-close').click()`,
  );
  await waitFor(
    async () => (await tabCount()) === 1,
    'last extra tab closed',
    15_000,
  );
  assert.equal(await activeTabIndex(), 0);
  assert.equal((await tabIds())[0], originalId);
  assert.equal(await evaluate('window.location.href'), initialUrl);

  await evaluate(
    "window.history.pushState({}, '', '#titlebar-history-smoke'); true",
  );
  await waitFor(
    () =>
      evaluateToolbar("!document.querySelector('.axioo-back-button').disabled"),
    'enabled Back button after navigation',
    10_000,
  );
  await evaluateToolbar("document.querySelector('.axioo-back-button').click()");
  await waitFor(
    () =>
      evaluateToolbar(
        "!document.querySelector('.axioo-forward-button').disabled",
      ),
    'enabled Forward button after going back',
    10_000,
  );
  assert.equal(await evaluate('window.location.href'), initialUrl);
  await evaluateToolbar(
    "document.querySelector('.axioo-forward-button').click()",
  );
  await waitFor(
    () => evaluate('window.location.hash === "#titlebar-history-smoke"'),
    'forward navigation',
    10_000,
  );
  await evaluateToolbar("document.querySelector('.axioo-back-button').click()");
  await waitFor(
    () => evaluate('window.location.href === ' + JSON.stringify(initialUrl)),
    'return to the starting URL',
    10_000,
  );

  // A middle press must close the tab and never become an auto-scroll gesture
  // on the overflowing tab list.
  const middleClick = await evaluateToolbar(
    "(() => { const tab = document.querySelector('.axioo-tab'); const init = { bubbles: true, cancelable: true, button: 1 }; const press = tab.dispatchEvent(new MouseEvent('mousedown', init)); const release = tab.dispatchEvent(new MouseEvent('auxclick', init)); return { pressPrevented: press === false, releasePrevented: release === false, listPrevented: document.querySelector('.axioo-tab-list').dispatchEvent(new MouseEvent('mousedown', init)) === false }; })()",
  );
  assert.equal(
    middleClick.pressPrevented,
    true,
    'middle press should be default-prevented',
  );
  assert.equal(
    middleClick.listPrevented,
    true,
    'the tab list should not start scrolling on a middle press',
  );
  assert.equal(
    middleClick.releasePrevented,
    true,
    'the closing auxclick should be default-prevented',
  );
  await waitFor(
    async () => (await tabCount()) === 1 && (await tabIds())[0] !== originalId,
    'middle click closes the tab and opens a fresh home tab',
    15_000,
  );

  console.log(
    'Electron startup passed: Axioo Store is isolated and the custom title bar rendered.',
  );
  console.log(
    'Tab system passed: tabs open, switch, reorder, close, keep sessions, and share the fetch bridge.',
  );
}

main()
  .finally(async () => {
    socket?.close();
    toolbarSocket?.close();
    for (const extra of extraSockets) extra.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    if (windows) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else if (child.pid) {
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
        if (signal === 'SIGTERM') await delay(1000);
      }
    }
  })
  .catch((error) => {
    console.error(error);
    console.error(output);
    process.exitCode = 1;
  });
