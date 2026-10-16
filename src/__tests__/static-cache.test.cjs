const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');

process.env.APP_URL = 'https://axioo.store/';

const {
  isAxiooHost,
  isStaticAssetUrl,
  sanitizeStaticPath,
  getStaticMimeType,
  StaticCacheManager,
} = require('../main/static-cache.ts');

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axioo-test-cache-'));
});

afterEach(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

test('isAxiooHost matches axioo.store and all subdomains', () => {
  assert.equal(isAxiooHost('axioo.store'), true);
  assert.equal(isAxiooHost('https://axioo.store/'), true);
  assert.equal(isAxiooHost('https://tenant.axioo.store/dashboard'), true);
  assert.equal(isAxiooHost('https://sub.tenant.axioo.store/catalog'), true);
  assert.equal(isAxiooHost('https://evil.axioo.store.fake.com/'), false);
  assert.equal(isAxiooHost('https://otherdomain.com/'), false);
  assert.equal(isAxiooHost('https://google.com/'), false);
});

test('isAxiooHost supports dev baseUrl when configured', () => {
  const devBase = 'http://localhost:3000/';
  assert.equal(isAxiooHost('http://localhost:3000/test', devBase), true);
  assert.equal(isAxiooHost('http://tenant.localhost:3000/test', devBase), true);
});

test('isStaticAssetUrl identifies Next.js static asset URLs', () => {
  assert.equal(
    isStaticAssetUrl('https://axioo.store/_next/static/chunks/main.js'),
    true,
  );
  assert.equal(
    isStaticAssetUrl('https://store1.axioo.store/_next/static/css/app.css'),
    true,
  );
  assert.equal(
    isStaticAssetUrl('https://tenant.axioo.store/_next/static/media/logo.png'),
    true,
  );
  // Non-static asset routes
  assert.equal(isStaticAssetUrl('https://axioo.store/api/v1/version'), false);
  assert.equal(isStaticAssetUrl('https://axioo.store/dashboard'), false);
  assert.equal(
    isStaticAssetUrl('https://other.com/_next/static/chunks/main.js'),
    false,
  );
});

test('sanitizeStaticPath normalizes paths and blocks path traversal', () => {
  const chunkPath = sanitizeStaticPath('/_next/static/chunks/app/layout.js');
  assert.ok(chunkPath);
  assert.ok(chunkPath.includes('chunks'));
  assert.ok(chunkPath.endsWith('layout.js'));

  // Path traversal attempts must return null
  assert.equal(sanitizeStaticPath('/_next/static/../secret.txt'), null);
  assert.equal(
    sanitizeStaticPath('/_next/static/chunks/../../passwords.txt'),
    null,
  );
  assert.equal(sanitizeStaticPath('/_next/static/'), null);
  assert.equal(sanitizeStaticPath('/api/v1/version'), null);
});

test('getStaticMimeType resolves correct MIME types with charsets', () => {
  assert.equal(
    getStaticMimeType('main.js'),
    'application/javascript; charset=utf-8',
  );
  assert.equal(getStaticMimeType('style.css'), 'text/css; charset=utf-8');
  assert.equal(
    getStaticMimeType('manifest.json'),
    'application/json; charset=utf-8',
  );
  assert.equal(getStaticMimeType('font.woff2'), 'font/woff2');
  assert.equal(getStaticMimeType('icon.svg'), 'image/svg+xml');
  assert.equal(getStaticMimeType('image.webp'), 'image/webp');
  assert.equal(getStaticMimeType('image.png'), 'image/png');
  assert.equal(getStaticMimeType('unknown.xyz'), 'application/octet-stream');
});

test('StaticCacheManager serves cached file directly on CACHE HIT', async () => {
  const relativeFile = path.join('chunks', 'app-test.js');
  const fullPath = path.join(tempDir, relativeFile);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, 'console.log("Cached chunk!");', 'utf8');

  const manager = new StaticCacheManager({ cacheDir: tempDir });
  const mockRequest = new Request(
    'https://tenant.axioo.store/_next/static/chunks/app-test.js',
    { method: 'GET' },
  );

  const response = await manager.handleRequest(mockRequest);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Axioo-Cache'), 'HIT');
  assert.equal(
    response.headers.get('Content-Type'),
    'application/javascript; charset=utf-8',
  );

  const text = await response.text();
  assert.equal(text, 'console.log("Cached chunk!");');
});

test('StaticCacheManager background writes on CACHE MISS without blocking response', async () => {
  const manager = new StaticCacheManager({ cacheDir: tempDir });
  const assetPath = 'chunks/network-chunk.js';
  const targetFile = path.join(tempDir, assetPath);

  assert.equal(fs.existsSync(targetFile), false);

  // Mock Request
  const mockRequest = new Request(
    'https://tenant1.axioo.store/_next/static/chunks/network-chunk.js',
    { method: 'GET' },
  );

  // Use a simulated net.fetch by injecting into global if running outside Electron
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response('console.log("from network");', {
      status: 200,
      headers: { 'content-type': 'application/javascript' },
    });

  try {
    const response = await manager.handleRequest(mockRequest);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(body, 'console.log("from network");');

    // Wait a brief tick for background write to finish
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(fs.existsSync(targetFile), true);
    assert.equal(
      fs.readFileSync(targetFile, 'utf8'),
      'console.log("from network");',
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('StaticCacheManager forwards sign-in POST body with the renderer origin', async () => {
  const manager = new StaticCacheManager({ cacheDir: tempDir });
  const originalFetch = global.fetch;
  const body = JSON.stringify({ token: 'test-token' });
  global.fetch = async (input, options) => {
    assert.equal(input.url, 'https://axioo.store/api/auth/desktop-redeem');
    assert.equal(input.method, 'POST');
    assert.equal(await input.text(), body);
    assert.equal(options.headers.get('origin'), 'https://axioo.store');
    assert.equal(options.headers.get('content-type'), 'application/json');
    assert.equal(options.bypassCustomProtocolHandlers, true);
    return new Response(null, { status: 401 });
  };
  try {
    const response = await manager.handleRequest(
      Object.assign(
        new Request('https://axioo.store/api/auth/desktop-redeem', {
          method: 'POST',
          referrer: 'https://axioo.store/desktop-login',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
        { initiatorOrigin: 'https://axioo.store' },
      ),
    );
    assert.equal(response.status, 401);
    assert.equal(fs.readdirSync(tempDir).length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('StaticCacheManager purges cache when buildId changes', async () => {
  // Populate cache with dummy asset
  const dummyFile = path.join(tempDir, 'chunks', 'old-chunk.js');
  fs.mkdirSync(path.dirname(dummyFile), { recursive: true });
  fs.writeFileSync(dummyFile, 'old', 'utf8');

  // Create in-memory mock settings store
  const settingsData = new Map([['cachedBuildId', 'build-v1']]);
  const mockSettingsStore = {
    get: (key) => settingsData.get(key),
    set: (key, val) => settingsData.set(key, val),
    delete: (key) => settingsData.delete(key),
  };

  const manager = new StaticCacheManager({
    cacheDir: tempDir,
    settingsStore: mockSettingsStore,
  });

  // Mock version check returning new buildId: build-v2
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(JSON.stringify({ buildId: 'build-v2' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  try {
    const result = await manager.verifyBuildVersion(true);
    assert.equal(result.changed, true);
    assert.equal(result.buildId, 'build-v2');
    assert.equal(mockSettingsStore.get('cachedBuildId'), 'build-v2');

    // Old cache must be purged
    assert.equal(fs.existsSync(dummyFile), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('StaticCacheManager retains cache when buildId matches', async () => {
  const dummyFile = path.join(tempDir, 'chunks', 'same-chunk.js');
  fs.mkdirSync(path.dirname(dummyFile), { recursive: true });
  fs.writeFileSync(dummyFile, 'same', 'utf8');

  const settingsData = new Map([['cachedBuildId', 'build-v1']]);
  const mockSettingsStore = {
    get: (key) => settingsData.get(key),
    set: (key, val) => settingsData.set(key, val),
    delete: (key) => settingsData.delete(key),
  };

  const manager = new StaticCacheManager({
    cacheDir: tempDir,
    settingsStore: mockSettingsStore,
  });

  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(JSON.stringify({ buildId: 'build-v1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  try {
    const result = await manager.verifyBuildVersion(true);
    assert.equal(result.changed, false);
    assert.equal(result.buildId, 'build-v1');

    // Cache must still exist!
    assert.equal(fs.existsSync(dummyFile), true);
  } finally {
    global.fetch = originalFetch;
  }
});
