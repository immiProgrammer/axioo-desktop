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
    ? getStoreUrl(savedUrl, baseUrl) || baseUrl
    : baseUrl;
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

  try {
    const url = new URL(rawUrl);
    if (
      url.protocol === 'https:' &&
      url.hostname === 'accounts.google.com' &&
      !url.port
    ) {
      return url.href;
    }
  } catch {
    // Invalid URLs cannot be opened inside the app.
  }
  return null;
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

export function createDebouncedUrlSave(
  save: (url: string) => void,
  debounceMs = 5_000,
  maxWaitMs = 15_000,
) {
  let pendingUrl: string | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (maxWaitTimer) clearTimeout(maxWaitTimer);
    debounceTimer = undefined;
    maxWaitTimer = undefined;

    if (pendingUrl !== null) {
      const url = pendingUrl;
      pendingUrl = null;
      save(url);
    }
  };

  const schedule = (url: string) => {
    pendingUrl = url;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, debounceMs);
    maxWaitTimer ??= setTimeout(flush, maxWaitMs);
  };

  return { schedule, flush };
}
