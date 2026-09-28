const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createDebouncedUrlSave,
  getExternalUrl,
  getInternalUrl,
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

test('Google OAuth URLs stay in the app without broadening the Google allowlist', () => {
  assert.equal(
    getInternalUrl('https://accounts.google.com/o/oauth2'),
    'https://accounts.google.com/o/oauth2',
  );
  assert.equal(
    getInternalUrl(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=abc',
    ),
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=abc',
  );
  assert.equal(
    getInternalUrl('https://accounts.google.com/o/oauth2evil'),
    null,
  );
  assert.equal(getInternalUrl('https://accounts.google.com/signin/'), null);
  assert.equal(getInternalUrl('http://accounts.google.com/o/oauth2'), null);
  assert.equal(
    getInternalUrl('https://accounts.google.com:444/o/oauth2'),
    null,
  );
  assert.equal(
    getInternalUrl('https://accounts.google.com.evil.test/o/oauth2'),
    null,
  );
  assert.equal(getStoreUrl('https://accounts.google.com/o/oauth2'), null);
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
