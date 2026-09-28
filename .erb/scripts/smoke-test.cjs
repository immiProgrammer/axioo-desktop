const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const debugPort = Number(process.env.SMOKE_DEBUG_PORT || 9335);
const rendererPort = Number(process.env.PORT || 1212);
const windows = process.platform === 'win32';
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
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let output = '';
let exited = false;
let socket;
let toolbarSocket;
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
        try {
          const url = new URL(entry.url);
          return (
            url.protocol === 'https:' &&
            (url.hostname === 'axioo.store' ||
              url.hostname.endsWith('.axioo.store'))
          );
        } catch {
          return false;
        }
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
  function send(method, params = {}) {
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
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
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
        "Boolean(document.querySelector('.axioo-menu-button') && document.querySelector('.axioo-toolbar-logo') && document.querySelector('.axioo-back-button') && document.querySelector('.axioo-forward-button'))",
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
      'axioo-toolbar-button axioo-back-button',
      'axioo-toolbar-button axioo-forward-button',
      'axioo-toolbar-button axioo-menu-button',
    ],
  );
  assert.deepEqual(
    await evaluateToolbar(
      "[...document.querySelector('.axioo-toolbar-center').children].map((element) => element.className)",
    ),
    ['axioo-toolbar-logo', 'axioo-toolbar-title'],
  );
  await waitFor(
    () =>
      evaluateToolbar(
        "document.querySelector('.axioo-toolbar-logo').naturalWidth > 0",
      ),
    'Axioo logo',
  );
  assert.equal(
    await evaluateToolbar(
      "getComputedStyle(document.querySelector('.cet-titlebar')).height",
    ),
    '32px',
  );
  if (windows) {
    await waitFor(
      () =>
        evaluateToolbar(
          "navigator.windowControlsOverlay?.visible === true && navigator.windowControlsOverlay.getTitlebarAreaRect().height === 32 && getComputedStyle(document.querySelector('.cet-window-controls')).display === 'none'",
        ),
      'native Windows caption buttons',
    );
  }
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
        "window.location.protocol === 'https:' && window.location.hostname.endsWith('axioo.store') && document.readyState === 'complete'",
      ),
    'site ready',
  );
  const pageTitle = await evaluate('document.title');
  const expectedTitle = !pageTitle.trim()
    ? 'Axioo Store'
    : /axioo/i.test(pageTitle)
      ? pageTitle.trim()
      : `Axioo Store | ${pageTitle.trim()}`;
  await waitFor(
    () =>
      evaluateToolbar(
        `document.querySelector('.axioo-toolbar-title').textContent === ${JSON.stringify(expectedTitle)}`,
      ),
    'centered page title',
  );
  await evaluate("document.title = 'Orders'; true");
  await waitFor(
    () =>
      evaluateToolbar(
        "document.querySelector('.axioo-toolbar-title').textContent === 'Axioo Store | Orders'",
      ),
    'prefixed window title',
  );
  await evaluate("document.title = 'AxIoO Orders'; true");
  await waitFor(
    () =>
      evaluateToolbar(
        "document.querySelector('.axioo-toolbar-title').textContent === 'AxIoO Orders'",
      ),
    'title already containing Axioo',
  );
  await evaluate(`document.title = ${JSON.stringify(pageTitle)}; true`);
  const initialUrl = await evaluate('window.location.href');
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
  console.log(
    'Electron startup passed: Axioo Store is isolated and the custom title bar rendered.',
  );
}

main()
  .finally(async () => {
    socket?.close();
    toolbarSocket?.close();
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
