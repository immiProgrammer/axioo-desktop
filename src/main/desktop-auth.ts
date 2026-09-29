import { HOME_URL, getStoreUrl } from './navigation';

export const DESKTOP_ATTEMPT = /^[A-Za-z0-9_-]{32,64}$/;

export type DesktopLoginLink = {
  userId: string;
  token: string;
  attempt: string;
  callbackUrl: string;
};

export function safeCallbackUrl(raw: string, baseUrl: string = HOME_URL) {
  try {
    const url = new URL(raw, baseUrl);
    if (
      url.pathname === '/desktop-login' ||
      url.pathname === '/desktop-google-start'
    ) {
      return null;
    }
    return getStoreUrl(url.href, baseUrl);
  } catch {
    return null;
  }
}

export function parseDesktopLoginLink(raw: string): DesktopLoginLink | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'axioo-desktop:' ||
      url.hostname !== 'auth' ||
      url.pathname !== '/complete' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      ['userId', 'token', 'attempt', 'callbackUrl'].some(
        (key) => url.searchParams.getAll(key).length !== 1,
      ) ||
      [...url.searchParams.keys()].some(
        (key) => !['userId', 'token', 'attempt', 'callbackUrl'].includes(key),
      )
    ) {
      return null;
    }
    const userId = url.searchParams.get('userId') ?? '';
    const token = url.searchParams.get('token') ?? '';
    const attempt = url.searchParams.get('attempt') ?? '';
    const callbackUrl = safeCallbackUrl(
      url.searchParams.get('callbackUrl') ?? '/',
    );
    if (
      userId.length < 1 ||
      userId.length > 128 ||
      !DESKTOP_ATTEMPT.test(token) ||
      !DESKTOP_ATTEMPT.test(attempt) ||
      !callbackUrl ||
      callbackUrl.length > 512
    ) {
      return null;
    }
    return { userId, token, attempt, callbackUrl };
  } catch {
    return null;
  }
}
