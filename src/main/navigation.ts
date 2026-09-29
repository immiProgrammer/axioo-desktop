export const PRODUCTION_HOME_URL = 'https://axioo.store/';

const PRODUCTION_HOST = new URL(PRODUCTION_HOME_URL).hostname;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const isProductionHost = (host: string) =>
  host === PRODUCTION_HOST || host.endsWith(`.${PRODUCTION_HOST}`);

const isSameStoreHost = (host: string, baseHost: string) => {
  if (host === baseHost) return true;
  return LOOPBACK_HOSTS.has(host) && LOOPBACK_HOSTS.has(baseHost);
};

const resolveHomeUrl = () => {
  const configured = process.env.APP_URL;
  if (!configured) return PRODUCTION_HOME_URL;

  try {
    const url = new URL(configured);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {
    // Fall through to the production URL below.
  }
  console.warn('Ignoring invalid APP_URL, using', PRODUCTION_HOME_URL);
  return PRODUCTION_HOME_URL;
};

export const HOME_URL = resolveHomeUrl();

export function getStartupUrl(
  savedUrl: unknown,
  baseUrl: string = HOME_URL,
): string {
  return typeof savedUrl === 'string'
    ? getRestorableStoreUrl(savedUrl, baseUrl) || baseUrl
    : baseUrl;
}

export function getRestorableStoreUrl(
  rawUrl: string,
  baseUrl: string = HOME_URL,
): string | null {
  const storeUrl = getStoreUrl(rawUrl, baseUrl);
  if (!storeUrl) return null;
  const path = new URL(storeUrl).pathname;
  if (
    path === '/desktop-login' ||
    path === '/desktop-google-start' ||
    path.startsWith('/api/auth/')
  )
    return null;
  return storeUrl;
}

export function isGoogleAuthUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'accounts.google.com' &&
      !url.port
    );
  } catch {
    return false;
  }
}

export function getStoreUrl(
  rawUrl: string,
  baseUrl: string = HOME_URL,
): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

    const base = new URL(baseUrl);
    if (isProductionHost(base.hostname)) {
      if (!isProductionHost(url.hostname) || url.port) return null;
    } else if (!isSameStoreHost(url.hostname, base.hostname)) {
      return null;
    }

    url.protocol = base.protocol;
    return url.href;
  } catch {
    return null;
  }
}

export function getInternalUrl(
  rawUrl: string,
  baseUrl: string = HOME_URL,
): string | null {
  const storeUrl = getStoreUrl(rawUrl, baseUrl);
  if (storeUrl) return storeUrl;
  return null;
}

export type SessionTabs = {
  urls: string[];
  activeIndex: number;
};

export function getSessionTabs(
  raw: unknown,
  baseUrl: string = HOME_URL,
): SessionTabs | null {
  if (raw === null || typeof raw !== 'object') return null;
  const { urls, activeIndex } = raw as {
    urls?: unknown;
    activeIndex?: unknown;
  };
  if (!Array.isArray(urls)) return null;

  const storeUrls = urls
    .filter((url): url is string => typeof url === 'string')
    .map((url) => getRestorableStoreUrl(url, baseUrl))
    .filter((url): url is string => url !== null);
  if (storeUrls.length === 0) return null;

  const index =
    typeof activeIndex === 'number' && Number.isInteger(activeIndex)
      ? activeIndex
      : 0;
  return {
    urls: storeUrls,
    activeIndex: Math.min(Math.max(index, 0), storeUrls.length - 1),
  };
}

export function getExternalUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol === 'https:' ||
      url.protocol === 'http:' ||
      url.protocol === 'mailto:' ||
      url.protocol === 'tel:'
    ) {
      return url.href;
    }
  } catch {
    // Invalid URLs are not passed to the operating system.
  }
  return null;
}

export function createDebouncedSave<T>(
  save: (value: T) => void,
  debounceMs = 5_000,
  maxWaitMs = 15_000,
) {
  let pending: { value: T } | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (maxWaitTimer) clearTimeout(maxWaitTimer);
    debounceTimer = undefined;
    maxWaitTimer = undefined;

    if (pending !== null) {
      const { value } = pending;
      pending = null;
      save(value);
    }
  };

  const schedule = (value: T) => {
    pending = { value };
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, debounceMs);
    maxWaitTimer ??= setTimeout(flush, maxWaitMs);
  };

  return { schedule, flush };
}

export function createDebouncedUrlSave(
  save: (url: string) => void,
  debounceMs?: number,
  maxWaitMs?: number,
) {
  return createDebouncedSave(save, debounceMs, maxWaitMs);
}
