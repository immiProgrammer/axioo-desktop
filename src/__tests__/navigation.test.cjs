const assert = require('node:assert/strict');
const { test } = require('node:test');

// This suite describes production behaviour, so pin the base URL before the
// module reads it.
process.env.APP_URL = 'https://axioo.store/';
const { SiteHistory } = require('../main/history.ts');
const {
  createDebouncedUrlSave,
  getExternalUrl,
  getInternalUrl,
  getRestorableStoreUrl,
  getStoreUrl,
  getStartupUrl,
  HOME_URL,
} = require('../main/navigation.ts');

test('only axioo.store and its HTTPS subdomains stay in the app', () => {
  assert.equal(getInternalUrl(HOME_URL), HOME_URL);
  assert.equal(
    getInternalUrl('https://shop.eu.axioo.store/account?x=1'),
    'https://shop.eu.axioo.store/account?x=1',
  );
  assert.equal(
    getInternalUrl('http://www.axioo.store/cart'),
    'https://www.axioo.store/cart',
  );
  assert.equal(getInternalUrl('https://axioo.store.evil.example/'), null);
  assert.equal(getInternalUrl('https://evil.example/axioo.store'), null);
  assert.equal(getInternalUrl('https://axioo.store:444/'), null);
  assert.equal(getInternalUrl('file:///tmp/example'), null);
});

test('a dev base URL only keeps its own host and ports inside the app', () => {
  const dev = 'http://localhost:3000/';
  assert.equal(getInternalUrl(dev, dev), dev);
  assert.equal(
    getInternalUrl('http://localhost:3000/cart?x=1', dev),
    'http://localhost:3000/cart?x=1',
  );
  assert.equal(
    getInternalUrl('http://127.0.0.1:3000/cart', dev),
    'http://127.0.0.1:3000/cart',
  );
  assert.equal(getStoreUrl('https://localhost:3000/cart', dev), dev + 'cart');
  assert.equal(
    getStoreUrl('http://localhost:4000/api', dev),
    'http://localhost:4000/api',
  );
  assert.equal(getStoreUrl('https://axioo.store/cart', dev), null);
  assert.equal(getStoreUrl('http://example.com/', dev), null);
  assert.equal(getStartupUrl('http://localhost:3000/cart', dev), dev + 'cart');
  assert.equal(getStartupUrl('https://axioo.store/cart', dev), dev);
  assert.equal(getStartupUrl(undefined, dev), dev);
  assert.equal(
    getInternalUrl('https://accounts.google.com/o/oauth2', dev),
    null,
  );
});

test('a dev.axioo.store base keeps its configured port and tenant hosts', () => {
  const dev = 'http://dev.axioo.store:3000/';
  assert.equal(getInternalUrl(dev, dev), dev);
  assert.equal(
    getInternalUrl('http://shop.dev.axioo.store:3000/sign-in', dev),
    'http://shop.dev.axioo.store:3000/sign-in',
  );
  assert.equal(
    getInternalUrl('https://dev.axioo.store:3000/sign-in', dev),
    dev + 'sign-in',
  );
  assert.equal(getInternalUrl('http://dev.axioo.store/sign-in', dev), null);
  assert.equal(
    getInternalUrl('http://dev.axioo.store:4000/sign-in', dev),
    null,
  );
  assert.equal(getInternalUrl('https://axioo.store/sign-in', dev), null);
  assert.equal(getInternalUrl('https://dev.axioo.store.evil.test/', dev), null);
});

test('handoff URLs are never restored on startup', () => {
  assert.equal(
    getRestorableStoreUrl('https://axioo.store/desktop-login?token=secret'),
    null,
  );
  assert.equal(
    getRestorableStoreUrl(
      'https://axioo.store/api/auth/callback/google?code=secret',
    ),
    null,
  );
  assert.equal(
    getStartupUrl('https://axioo.store/desktop-login?token=secret'),
    HOME_URL,
  );
});

test('invalid or external saved URLs start at the Axioo home page', () => {
  for (const savedUrl of [
    undefined,
    null,
    123,
    '',
    'not a url',
    'javascript:alert(1)',
    'https://example.com/',
    'https://axioo.store.evil.example/',
    'https://accounts.google.com/o/oauth2',
  ]) {
    assert.equal(getStartupUrl(savedUrl), HOME_URL);
  }
  assert.equal(
    getStartupUrl('https://shop.axioo.store/cart'),
    'https://shop.axioo.store/cart',
  );
});

test('only ordinary web and contact links can be opened externally', () => {
  assert.equal(
    getExternalUrl('https://example.com/path'),
    'https://example.com/path',
  );
  assert.equal(
    getExternalUrl('mailto:team@example.com'),
    'mailto:team@example.com',
  );
  assert.equal(getExternalUrl('javascript:alert(1)'), null);
  assert.equal(getExternalUrl('file:///tmp/example'), null);
  assert.equal(getExternalUrl('not a url'), null);
});

test('URL saves wait five seconds after the last change', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const saver = createDebouncedUrlSave((url) => writes.push(url));

  saver.schedule('https://axioo.store/first');
  context.mock.timers.tick(4_000);
  saver.schedule('https://axioo.store/second');
  context.mock.timers.tick(4_999);
  assert.deepEqual(writes, []);
  context.mock.timers.tick(1);
  assert.deepEqual(writes, ['https://axioo.store/second']);
});

test('continuous URL changes save the latest value within fifteen seconds', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const saver = createDebouncedUrlSave((url) => writes.push(url));

  saver.schedule('https://axioo.store/first');
  context.mock.timers.tick(4_000);
  saver.schedule('https://axioo.store/second');
  context.mock.timers.tick(4_000);
  saver.schedule('https://axioo.store/third');
  context.mock.timers.tick(4_000);
  saver.schedule('https://axioo.store/fourth');
  context.mock.timers.tick(2_999);
  assert.deepEqual(writes, []);
  context.mock.timers.tick(1);
  assert.deepEqual(writes, ['https://axioo.store/fourth']);
});

test('closing flushes the latest URL immediately and only once', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const saver = createDebouncedUrlSave((url) => writes.push(url));

  saver.schedule('https://axioo.store/checkout');
  saver.flush();
  context.mock.timers.tick(15_000);
  assert.deepEqual(writes, ['https://axioo.store/checkout']);
});

test('in-page history enables the available direction and handles a new branch', () => {
  const history = new SiteHistory();
  history.recordDocument('https://axioo.store/', 1);
  assert.equal(history.canGoBack(), false);
  assert.equal(history.canGoForward(), false);

  history.recordInPage('https://axioo.store/products', 2);
  assert.equal(history.canGoBack(), true);
  assert.equal(history.canGoForward(), false);

  history.recordInPage('https://axioo.store/', 2);
  assert.equal(history.canGoBack(), false);
  assert.equal(history.canGoForward(), true);

  history.recordInPage('https://axioo.store/cart', 2);
  assert.equal(history.canGoBack(), true);
  assert.equal(history.canGoForward(), false);
});
