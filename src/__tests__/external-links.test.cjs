const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getBrowserUrl, parseAppLink } = require('../main/external-links.ts');

test('accepts app links without interpreting the website payload', () => {
  assert.equal(
    parseAppLink('axioo-desktop://auth/complete?attempt=value'),
    'axioo-desktop://auth/complete?attempt=value',
  );
  assert.equal(
    parseAppLink('axioo-desktop://other/action'),
    'axioo-desktop://other/action',
  );
  assert.equal(parseAppLink('https://axioo.store/'), null);
  assert.equal(
    parseAppLink('axioo-desktop://auth/action#fragment'),
    'axioo-desktop://auth/action#fragment',
  );
  assert.equal(parseAppLink('axioo-desktop://auth:password@host/action'), null);
});

test('direct external opening is limited to trusted site URLs', () => {
  assert.equal(
    getBrowserUrl(
      'https://axioo.store/api/v1/desktop-auth/google-start',
      false,
    ),
    'https://axioo.store/api/v1/desktop-auth/google-start',
  );
  assert.equal(getBrowserUrl('https://example.com/', false), null);
  assert.equal(
    getBrowserUrl('https://example.com/', true),
    'https://example.com/',
  );
  assert.equal(getBrowserUrl('file:///tmp/secret', true), null);
  assert.equal(getBrowserUrl('javascript:alert(1)', true), null);
});
