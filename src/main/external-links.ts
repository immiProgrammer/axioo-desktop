import { HOME_URL, getStoreUrl } from './navigation';

const MAX_APP_LINK_LENGTH = 4096;

export function parseAppLink(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_APP_LINK_LENGTH) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'axioo-desktop:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function getBrowserUrl(raw: unknown, ask: boolean): string | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    const isHttps = url.protocol === 'https:';
    const isLocalDev =
      new URL(HOME_URL).protocol === 'http:' &&
      url.protocol === 'http:' &&
      getStoreUrl(url.href) !== null;
    if (!isHttps && !isLocalDev) return null;
    if (!ask && getStoreUrl(url.href) === null) return null;
    return url.href;
  } catch {
    return null;
  }
}
