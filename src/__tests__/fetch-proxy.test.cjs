const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  getBridgeResponse,
  getProxyBody,
  getProxyCredentials,
  getProxyHeaders,
  getProxyMethod,
  getProxyRequestId,
  getProxyUrl,
} = require('../main/fetch-proxy.ts');

test('only absolute http and https URLs are proxied', () => {
  assert.equal(
    getProxyUrl('https://axioo.store/api'),
    'https://axioo.store/api',
  );
  assert.equal(
    getProxyUrl('http://127.0.0.1:8080/x?y=1'),
    'http://127.0.0.1:8080/x?y=1',
  );
  for (const url of [
    undefined,
    null,
    42,
    '',
    '   ',
    '/api/cart',
    'axioo.store/api',
    'file:///tmp/secret',
    'data:text/plain,hi',
    'javascript:alert(1)',
    'chrome://settings',
  ]) {
    assert.throws(() => getProxyUrl(url), TypeError);
  }
});

test('the method is upper-cased and cannot smuggle extra tokens', () => {
  assert.equal(getProxyMethod('post'), 'POST');
  assert.equal(getProxyMethod(undefined), 'GET');
  assert.equal(getProxyMethod(''), 'GET');
  assert.equal(getProxyMethod('   '), 'GET');
  for (const method of ['GET POST', 'GET\r\nX-Evil: 1', 'A'.repeat(21), 7]) {
    assert.throws(() => getProxyMethod(method), TypeError);
  }
});

test('origin and framing headers are dropped while real ones survive', () => {
  assert.deepEqual(
    getProxyHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: 'https://axioo.store',
      Referer: 'https://axioo.store/cart',
      'Sec-Fetch-Mode': 'cors',
      'Content-Length': '999',
      Host: 'evil.example',
      'X-Bad\nName': 'value',
      'X-Injected': 'a\r\nX-Evil: b',
      'X-Number': 12,
      'X-Object': { a: 1 },
    }),
    {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-number': '12',
    },
  );
  assert.deepEqual(getProxyHeaders('nope'), {});
  assert.deepEqual(getProxyHeaders(null), {});
  assert.deepEqual(getProxyHeaders([['a', 'b']]), {});
});

test('bodies only travel with methods that allow them', () => {
  assert.deepEqual(getProxyBody('{"cart":1}', undefined, 'POST'), {
    body: '{"cart":1}',
  });
  assert.deepEqual(getProxyBody(undefined, 'aGk=', 'PUT'), {
    bodyBase64: 'aGk=',
  });
  assert.deepEqual(getProxyBody('ignored', 'aGk=', 'GET'), {});
  assert.deepEqual(getProxyBody('ignored', 'aGk=', 'HEAD'), {});
  assert.deepEqual(getProxyBody(null, null, 'DELETE'), {});
  assert.throws(
    () => getProxyBody(undefined, 'not base64!!', 'POST'),
    TypeError,
  );
});

test('cookies are sent unless the page asks to omit them', () => {
  assert.equal(getProxyCredentials(undefined), 'include');
  assert.equal(getProxyCredentials('same-origin'), 'include');
  assert.equal(getProxyCredentials('omit'), 'omit');
});

test('only short string ids can cancel a request', () => {
  assert.equal(getProxyRequestId('abc-1'), 'abc-1');
  assert.equal(getProxyRequestId(undefined), '');
  assert.equal(getProxyRequestId(''), '');
  assert.equal(getProxyRequestId(7), '');
  assert.equal(getProxyRequestId('x'.repeat(129)), '');
});

test('responses keep headers readable and hide cookies', () => {
  const response = getBridgeResponse(
    200,
    'OK',
    'https://axioo.store/api/cart',
    true,
    {
      'Content-Type': ['application/json'],
      'Cache-Control': ['no-store', 'max-age=0'],
      'Set-Cookie': ['session=secret'],
      'X-Single': 'one',
    },
    Buffer.from('{"items":2}', 'utf8'),
  );
  assert.equal(response.status, 200);
  assert.equal(response.statusText, 'OK');
  assert.equal(response.url, 'https://axioo.store/api/cart');
  assert.equal(response.redirected, true);
  assert.deepEqual(response.headers, {
    'content-type': 'application/json',
    'cache-control': 'no-store, max-age=0',
    'x-single': 'one',
  });
  assert.equal(
    Buffer.from(response.bodyBase64, 'base64').toString('utf8'),
    '{"items":2}',
  );
});

test('header injection through a status line is flattened', () => {
  const response = getBridgeResponse(
    500,
    'Bad\r\nX-Evil: yes',
    'https://axioo.store/api',
    false,
    { 'X-Thing': ['a\rb'] },
    new Uint8Array(0),
  );
  assert.equal(response.statusText, 'Bad  X-Evil: yes');
  assert.deepEqual(response.headers, { 'x-thing': 'a b' });
  assert.equal(response.bodyBase64, '');
});
