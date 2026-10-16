const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getProtocolForwardHeaders } = require('../main/protocol-forwarding.ts');

const request = (options = {}, initiatorOrigin = 'https://axioo.store') =>
  Object.assign(
    new Request('https://axioo.store/api/auth/desktop-redeem', {
      method: 'POST',
      referrer: 'https://axioo.store/desktop-login',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    }),
    { initiatorOrigin },
  );

test('restores same-origin renderer POST origin and preserves content type', () => {
  const headers = getProtocolForwardHeaders(request());
  assert.equal(headers.get('origin'), 'https://axioo.store');
  assert.equal(headers.get('content-type'), 'application/json');
});

test('never replaces explicit origins, including opaque origins', () => {
  for (const origin of ['null', 'https://other.example']) {
    const headers = getProtocolForwardHeaders(request({ headers: { origin } }));
    assert.equal(headers.get('origin'), origin);
  }
});

test('does not trust cross-origin, missing, or opaque initiators even with a same-origin referrer', () => {
  for (const initiatorOrigin of [
    'https://other.example/',
    'https://tenant.axioo.store/',
    'http://axioo.store/',
    'https://axioo.store:444/',
    '',
    'null',
    undefined,
  ]) {
    const input = request();
    input.initiatorOrigin = initiatorOrigin;
    assert.equal(
      getProtocolForwardHeaders(input).get('origin'),
      null,
      String(initiatorOrigin),
    );
  }
});

test('works with a suppressed referrer when Electron supplies a trusted initiator', () => {
  assert.equal(
    getProtocolForwardHeaders(request({ referrer: '' })).get('origin'),
    'https://axioo.store',
  );
});

test('does not add origin to safe methods', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(
      getProtocolForwardHeaders(request({ method })).get('origin'),
      null,
    );
  }
});
