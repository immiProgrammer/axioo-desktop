export const HOME_URL = 'https://axioo.store/';

export function getStartupUrl(savedUrl: unknown): string {
  return typeof savedUrl === 'string'
    ? getStoreUrl(savedUrl) || HOME_URL
    : HOME_URL;
}

export function getStoreUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname;
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      (host !== 'axioo.store' && !host.endsWith('.axioo.store')) ||
      url.port
    ) {
      return null;
    }

    url.protocol = 'https:';
    return url.href;
  } catch {
    return null;
  }
}

export function getInternalUrl(rawUrl: string): string | null {
  const storeUrl = getStoreUrl(rawUrl);
  if (storeUrl) return storeUrl;

  try {
    const url = new URL(rawUrl);
    if (
      url.protocol === 'https:' &&
      url.hostname === 'accounts.google.com' &&
      !url.port &&
      (url.pathname === '/o/oauth2' || url.pathname.startsWith('/o/oauth2/'))
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
