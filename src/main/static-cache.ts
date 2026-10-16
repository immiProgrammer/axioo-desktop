import fs from 'node:fs';
import path from 'node:path';
import { app, net, session } from 'electron';
import type { Session } from 'electron';
import log from 'electron-log';
import { HOME_URL, isProductionHost } from './navigation';
import { getProtocolForwardHeaders } from './protocol-forwarding';
import {
  getCachedBuildId,
  getConfiguredBaseUrl,
  setCachedBuildId,
} from './settings';
import type { AppSettings } from './settings';
import type Store from 'electron-store';

const MIME_MAP: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function getStaticMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

export function isAxiooHost(
  rawUrlOrHost: string | URL,
  baseUrl: string = HOME_URL,
): boolean {
  try {
    let hostname: string;
    if (rawUrlOrHost instanceof URL) {
      hostname = rawUrlOrHost.hostname;
    } else if (rawUrlOrHost.includes('://')) {
      hostname = new URL(rawUrlOrHost).hostname;
    } else {
      hostname = rawUrlOrHost.split(':')[0].trim().toLowerCase();
    }

    if (isProductionHost(hostname)) {
      return true;
    }

    const baseHost = new URL(baseUrl).hostname;
    if (
      hostname === baseHost ||
      (baseHost && hostname.endsWith(`.${baseHost}`))
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function isStaticAssetUrl(
  rawUrl: string | URL,
  baseUrl: string = HOME_URL,
): boolean {
  try {
    const url = typeof rawUrl === 'string' ? new URL(rawUrl) : rawUrl;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (!url.pathname.startsWith('/_next/static/')) return false;
    return isAxiooHost(url, baseUrl);
  } catch {
    return false;
  }
}

export function sanitizeStaticPath(pathname: string): string | null {
  if (!pathname.startsWith('/_next/static/')) return null;
  const rawSubpath = pathname.slice('/_next/static/'.length);
  if (!rawSubpath) return null;

  const normalized = path.posix.normalize(rawSubpath);
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.startsWith('..') ||
    path.posix.isAbsolute(normalized) ||
    normalized.includes('\0')
  ) {
    return null;
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((s) => s === '..')) {
    return null;
  }

  return path.join(...segments);
}

function getDefaultCacheDir(): string {
  try {
    return path.join(app.getPath('userData'), 'next-static-cache');
  } catch {
    return path.join(process.cwd(), '.cache', 'next-static-cache');
  }
}

export type StaticCacheOptions = {
  cacheDir?: string;
  baseUrl?: string;
  settingsStore?: Store<AppSettings>;
};

export class StaticCacheManager {
  readonly cacheDir: string;

  private readonly explicitBaseUrl?: string;

  private readonly settingsStore?: Store<AppSettings>;

  private registered = false;

  private verifyingPromise: Promise<{
    changed: boolean;
    buildId: string | null;
  }> | null = null;

  private lastVerifiedAt = 0;

  private inFlight = new Map<string, Promise<GlobalResponse>>();

  constructor(options: StaticCacheOptions = {}) {
    this.cacheDir = options.cacheDir ?? getDefaultCacheDir();
    this.explicitBaseUrl = options.baseUrl;
    this.settingsStore = options.settingsStore;
  }

  getBaseUrl(): string {
    if (this.explicitBaseUrl) return this.explicitBaseUrl;
    try {
      return getConfiguredBaseUrl(this.settingsStore) ?? HOME_URL;
    } catch {
      return HOME_URL;
    }
  }

  getStoredBuildId(): string | null {
    try {
      return getCachedBuildId(this.settingsStore);
    } catch {
      return null;
    }
  }

  setStoredBuildId(buildId: string): void {
    try {
      setCachedBuildId(buildId, this.settingsStore);
    } catch {
      // Ignore errors if store is unavailable
    }
  }

  register(targetSession?: Session): void {
    if (this.registered) return;
    const sess = targetSession ?? session?.defaultSession;
    if (!sess) {
      log.warn(
        'Axioo static cache: session is not available for registration.',
      );
      return;
    }

    try {
      sess.protocol.handle('https', (request) => this.handleRequest(request));
      this.registered = true;
      log.info(
        'Axioo static cache: HTTPS protocol handler registered successfully.',
      );
    } catch (err) {
      log.error(
        'Axioo static cache: failed to register protocol handler:',
        err,
      );
    }
  }

  async handleRequest(request: GlobalRequest): Promise<GlobalResponse> {
    const fetchFn = (net?.fetch ?? fetch) as typeof fetch;
    const method = request.method?.toUpperCase() ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      return fetchFn(
        request as Request,
        {
          headers: getProtocolForwardHeaders(request as Request),
          bypassCustomProtocolHandlers: true,
        } as RequestInit,
      );
    }

    const url = new URL(request.url);
    const relativePath = sanitizeStaticPath(url.pathname);
    if (!relativePath || !isStaticAssetUrl(url, this.getBaseUrl())) {
      return fetchFn(
        request as Request,
        {
          bypassCustomProtocolHandlers: true,
        } as RequestInit,
      );
    }

    const targetFile = path.join(this.cacheDir, relativePath);
    const resolvedTarget = path.resolve(targetFile);
    const resolvedCacheDir = path.resolve(this.cacheDir);
    if (
      !resolvedTarget.startsWith(resolvedCacheDir) &&
      resolvedTarget !== resolvedCacheDir
    ) {
      return fetchFn(
        request as Request,
        {
          bypassCustomProtocolHandlers: true,
        } as RequestInit,
      );
    }

    // 1. CACHE HIT: serve instantly from local disk with 0 network latency
    if (fs.existsSync(targetFile)) {
      try {
        const content = fs.readFileSync(targetFile);
        const mime = getStaticMimeType(targetFile);
        return new Response(method === 'HEAD' ? null : content, {
          status: 200,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(content.byteLength),
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Axioo-Cache': 'HIT',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (err) {
        log.warn(
          `Axioo static cache: failed to read cached file ${targetFile}:`,
          err,
        );
      }
    }

    // 2. CACHE MISS: Deduplicate in-flight fetches
    const inFlightKey = relativePath;
    const existing = this.inFlight.get(inFlightKey);
    if (existing) {
      return existing.then((res) => res.clone());
    }

    const fetchPromise = (async () => {
      try {
        const response = await fetchFn(
          request as Request,
          {
            bypassCustomProtocolHandlers: true,
          } as RequestInit,
        );

        if (response.status === 200 && method === 'GET') {
          // Clone response so the caller stream is not blocked or consumed
          const diskClone = response.clone();
          void this.saveToDiskBackground(targetFile, diskClone);
        }

        return response;
      } finally {
        this.inFlight.delete(inFlightKey);
      }
    })();

    this.inFlight.set(inFlightKey, fetchPromise);
    return fetchPromise;
  }

  private async saveToDiskBackground(
    targetFile: string,
    responseClone: GlobalResponse,
  ): Promise<void> {
    try {
      const arrayBuffer = await responseClone.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const dir = path.dirname(targetFile);
      await fs.promises.mkdir(dir, { recursive: true });
      const tempFile = `${targetFile}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      await fs.promises.writeFile(tempFile, buffer);
      await fs.promises.rename(tempFile, targetFile);
    } catch (err) {
      log.warn(
        `Axioo static cache: failed to write background cache for ${targetFile}:`,
        err,
      );
    }
  }

  async verifyBuildVersion(
    force = false,
  ): Promise<{ changed: boolean; buildId: string | null }> {
    const now = Date.now();
    if (!force && this.verifyingPromise) {
      return this.verifyingPromise;
    }
    if (!force && now - this.lastVerifiedAt < 3_000) {
      return { changed: false, buildId: this.getStoredBuildId() };
    }

    this.verifyingPromise = (async () => {
      try {
        const baseUrl = this.getBaseUrl();
        const versionUrl = new URL('/api/v1/version', baseUrl).href;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4_000);

        let res: GlobalResponse;
        try {
          const fetchFn = net?.fetch ?? fetch;
          res = await fetchFn(versionUrl, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
            bypassCustomProtocolHandlers: true,
          } as RequestInit);
        } finally {
          clearTimeout(timeoutId);
        }

        if (!res.ok) {
          log.warn(
            `Axioo static cache: version check returned status ${res.status}`,
          );
          return { changed: false, buildId: this.getStoredBuildId() };
        }

        const data = (await res.json()) as { buildId?: unknown };
        const remoteBuildId =
          typeof data.buildId === 'string' && data.buildId.trim()
            ? data.buildId.trim()
            : null;

        if (!remoteBuildId) {
          return { changed: false, buildId: this.getStoredBuildId() };
        }

        const storedBuildId = this.getStoredBuildId();
        if (storedBuildId !== remoteBuildId) {
          log.info(
            `Axioo static cache: buildId changed from "${storedBuildId ?? 'none'}" to "${remoteBuildId}". Purging cache.`,
          );
          await this.purgeCache();
          this.setStoredBuildId(remoteBuildId);
          return { changed: true, buildId: remoteBuildId };
        }

        return { changed: false, buildId: remoteBuildId };
      } catch (err) {
        log.warn(
          'Axioo static cache: version check failed (offline or timeout):',
          err,
        );
        return { changed: false, buildId: this.getStoredBuildId() };
      } finally {
        this.lastVerifiedAt = Date.now();
        this.verifyingPromise = null;
      }
    })();

    return this.verifyingPromise;
  }

  async purgeCache(): Promise<void> {
    try {
      if (fs.existsSync(this.cacheDir)) {
        await fs.promises.rm(this.cacheDir, { recursive: true, force: true });
        log.info('Axioo static cache: disk directory cleared.');
      }
    } catch (err) {
      log.error('Axioo static cache: failed to remove cache directory:', err);
    }

    try {
      const sess = session?.defaultSession;
      if (sess) {
        await sess.clearCache();
      }
    } catch (err) {
      log.warn(
        'Axioo static cache: session.clearCache failed or unavailable:',
        err,
      );
    }
  }
}

let staticCacheManagerInstance: StaticCacheManager | null = null;

export function getStaticCacheManager(): StaticCacheManager {
  staticCacheManagerInstance ??= new StaticCacheManager();
  return staticCacheManagerInstance;
}
