export const FETCH_CHANNEL = 'axioo:fetch';
export const ABORT_CHANNEL = 'axioo:fetch:abort';
export const BRIDGE_VERSION = 1;
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

export type BridgeRequest = {
  id?: unknown;
  url?: unknown;
  method?: unknown;
  headers?: unknown;
  credentials?: unknown;
  body?: unknown;
  bodyBase64?: unknown;
};

export type BridgeResponse = {
  status: number;
  statusText: string;
  url: string;
  redirected: boolean;
  headers: Record<string, string>;
  bodyBase64: string;
};

export type ProxyRequest = {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  credentials: 'include' | 'omit';
  body?: string;
  bodyBase64?: string;
};

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_METHOD = /^[A-Z][A-Z0-9-]{0,19}$/;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

const BLOCKED_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'origin',
  'proxy-authorization',
  'referer',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-user',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function getProxyUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new TypeError('Axioo fetch needs a URL string.');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TypeError(`Axioo fetch cannot read the URL: ${rawUrl}`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new TypeError(
      `Axioo fetch only sends http and https requests, received ${url.protocol}`,
    );
  }

  return url.href;
}

export function getProxyMethod(rawMethod: unknown): string {
  if (rawMethod === undefined || rawMethod === null) return 'GET';

  if (typeof rawMethod !== 'string') {
    throw new TypeError(
      `Axioo fetch received an unsupported method: ${String(rawMethod)}`,
    );
  }

  const method = rawMethod.trim() === '' ? 'GET' : rawMethod.toUpperCase();
  if (!ALLOWED_METHOD.test(method)) {
    throw new TypeError(
      `Axioo fetch received an unsupported method: ${rawMethod}`,
    );
  }

  return method;
}

export function getProxyHeaders(rawHeaders: unknown): Record<string, string> {
  if (
    rawHeaders === null ||
    typeof rawHeaders !== 'object' ||
    Array.isArray(rawHeaders)
  ) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;

    const key = name.toLowerCase();
    if (!HEADER_NAME.test(key) || BLOCKED_HEADERS.has(key)) continue;

    const text = String(value);
    if (/[\0\r\n]/.test(text)) continue;

    headers[key] = text;
  }

  return headers;
}

export function getProxyCredentials(
  rawCredentials: unknown,
): 'include' | 'omit' {
  return rawCredentials === 'omit' ? 'omit' : 'include';
}

export function getProxyBody(
  rawBody: unknown,
  rawBodyBase64: unknown,
  method: string,
): { body?: string; bodyBase64?: string } {
  if (BODYLESS_METHODS.has(method)) return {};

  if (typeof rawBody === 'string') return { body: rawBody };

  if (typeof rawBodyBase64 === 'string' && rawBodyBase64 !== '') {
    if (!BASE64.test(rawBodyBase64)) {
      throw new TypeError('Axioo fetch received a body that is not base64.');
    }
    return { bodyBase64: rawBodyBase64 };
  }

  return {};
}

export function getProxyRequestId(rawId: unknown): string {
  if (typeof rawId !== 'string' || rawId === '' || rawId.length > 128) {
    return '';
  }
  return rawId;
}

export function getBridgeResponse(
  status: number,
  statusText: string,
  url: string,
  redirected: boolean,
  rawHeaders: Record<string, string | string[]>,
  body: Uint8Array,
): BridgeResponse {
  const headers: Record<string, string> = {};
  for (const [name, values] of Object.entries(rawHeaders)) {
    const key = name.toLowerCase();
    if (key === 'set-cookie') continue;
    const value = (Array.isArray(values) ? values.join(', ') : String(values))
      .replace(/[\0\r\n]/g, ' ')
      .trim();
    if (value !== '') headers[key] = value;
  }

  return {
    status,
    statusText: statusText.replace(/[\0\r\n]/g, ' ').trim(),
    url,
    redirected,
    headers,
    bodyBase64: Buffer.from(body).toString('base64'),
  };
}
