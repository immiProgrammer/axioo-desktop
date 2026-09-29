const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseDesktopLoginLink, safeCallbackUrl } = require('../main/desktop-auth.ts');

const attempt = 'A'.repeat(43);
const token = 'B'.repeat(43);

test('accepts only the desktop completion route and a store callback', () => {
  const link = new URL('axioo-desktop://auth/complete');
  link.searchParams.set('userId', 'user-123');
  link.searchParams.set('token', token);
  link.searchParams.set('attempt', attempt);
  link.searchParams.set('callbackUrl', 'https://shop.axioo.store/orders');
  assert.deepEqual(parseDesktopLoginLink(link.href), {
    userId: 'user-123', token, attempt,
    callbackUrl: 'https://shop.axioo.store/orders',
  });
  link.searchParams.set('callbackUrl', 'https://axioo.store.evil.test/');
  assert.equal(parseDesktopLoginLink(link.href), null);
  assert.equal(parseDesktopLoginLink(link.href.replace('/complete', '/other')), null);
});

test('rejects handoff pages as callback destinations', () => {
  assert.equal(safeCallbackUrl('/desktop-login?token=secret'), null);
  assert.equal(safeCallbackUrl('/orders'), 'https://axioo.store/orders');
});
