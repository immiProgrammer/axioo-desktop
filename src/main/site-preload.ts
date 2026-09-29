import { ipcRenderer } from 'electron';

const FETCH_CHANNEL = 'axioo:fetch';
const ABORT_CHANNEL = 'axioo:fetch:abort';
const INTERNAL_URL_CHANNEL = 'axioo:internal-url';
const DESKTOP_START_CHANNEL = 'desktop-login:start';
const DESKTOP_TAKE_CHANNEL = 'desktop-login:take';
const DESKTOP_FINISH_CHANNEL = 'desktop-login:finish';
const BRIDGE_VERSION = 1;
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

type BridgeRequest = {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  credentials: 'include' | 'omit';
  body?: string;
  bodyBase64?: string;
};

type BridgeResponse = {
  status: number;
  statusText: string;
  url: string;
  redirected: boolean;
  headers: Record<string, string>;
  bodyBase64: string;
};

declare global {
  interface Window {
    __axiooFetch: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;
    __AXIOO_DESKTOP__: {
      version: number;
      fetch: Window['__axiooFetch'];
      startGoogleLogin: (callbackUrl: string) => Promise<{ opened: boolean }>;
      takeDesktopLogin: () => Promise<{
        userId: string;
        token: string;
        attempt: string;
      } | null>;
      finishDesktopLogin: (attempt: string) => void;
    };
  }
}

let counter = 0;
const nextRequestId = () => {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (value: string): ArrayBuffer => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer as ArrayBuffer;
};

const abortError = () =>
  new DOMException('The operation was aborted.', 'AbortError');

const readHeaders = (
  source: HeadersInit | undefined,
): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (!source) return headers;

  if (source instanceof Headers) {
    source.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
  } else if (Array.isArray(source)) {
    for (const entry of source) {
      if (Array.isArray(entry))
        headers[String(entry[0]).toLowerCase()] = entry[1];
    }
  } else {
    for (const [name, value] of Object.entries(source)) {
      if (typeof value === 'string') headers[name.toLowerCase()] = value;
    }
  }

  return headers;
};

const readBody = async (
  body: BodyInit,
): Promise<{ body?: string; bodyBase64?: string; contentType?: string }> => {
  if (typeof body === 'string') {
    return { body, contentType: 'text/plain;charset=UTF-8' };
  }
  if (body instanceof URLSearchParams) {
    return {
      body: body.toString(),
      contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
    };
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    throw new TypeError('__axiooFetch cannot send a streaming body.');
  }

  const encoded = new Response(body);
  const contentType = encoded.headers.get('content-type');
  return {
    bodyBase64: toBase64(new Uint8Array(await encoded.arrayBuffer())),
    ...(contentType ? { contentType } : {}),
  };
};

const buildResponse = (payload: BridgeResponse): Response => {
  if (payload.status < 100 || payload.status > 599) {
    throw new TypeError(`__axiooFetch received status ${payload.status}.`);
  }

  const body =
    NULL_BODY_STATUS.has(payload.status) || payload.bodyBase64 === ''
      ? null
      : fromBase64(payload.bodyBase64);
  const response = new Response(body, {
    status: payload.status,
    statusText: payload.statusText,
    headers: payload.headers,
  });
  Object.defineProperty(response, 'url', {
    value: payload.url,
    configurable: true,
  });
  Object.defineProperty(response, 'redirected', {
    value: payload.redirected,
    configurable: true,
  });
  return response;
};

const toRequestError = (error: unknown): Error => {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).replace(/^Error invoking remote method .*?: /, '');
  const name = /^(TypeError|RangeError): /.exec(message)?.[1] ?? 'TypeError';
  const text = message.replace(/^[A-Za-z]*Error: /, '');
  return name === 'RangeError' ? new RangeError(text) : new TypeError(text);
};

const prepare = async (
  input: string | URL | Request,
  init: RequestInit,
): Promise<BridgeRequest> => {
  const source = input instanceof Request ? input : undefined;
  const method = (init.method ?? source?.method ?? 'GET').toUpperCase();
  const headers = {
    ...(source ? readHeaders(source.headers) : {}),
    ...readHeaders(init.headers),
  };

  const url = new URL(
    source
      ? source.url
      : input instanceof URL
        ? input.href
        : String(input ?? ''),
    window.location.href,
  );
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('__axiooFetch only sends http and https requests.');
  }

  const body = init.body ?? (source?.body ? await source.arrayBuffer() : null);
  let payload: Pick<BridgeRequest, 'body' | 'bodyBase64'> = {};
  if (BODYLESS_METHODS.has(method)) {
    if (body !== null && body !== undefined) {
      throw new TypeError(`Request with ${method} method cannot have body.`);
    }
  } else if (body !== null && body !== undefined) {
    const serialized = await readBody(body);
    payload = { body: serialized.body, bodyBase64: serialized.bodyBase64 };
    if (serialized.contentType && headers['content-type'] === undefined) {
      headers['content-type'] = serialized.contentType;
    }
  }

  headers['user-agent'] ??= navigator.userAgent;
  headers['accept-language'] ??= navigator.languages.join(',');

  return {
    id: nextRequestId(),
    url: url.href,
    method,
    headers,
    credentials: init.credentials === 'omit' ? 'omit' : 'include',
    ...payload,
  };
};

const axiooFetch = async (
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> => {
  const signal = init.signal ?? undefined;
  if (signal?.aborted) throw abortError();

  const request = await prepare(input, init);
  const onAbort = () => ipcRenderer.send(ABORT_CHANNEL, request.id);
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    return buildResponse(
      (await ipcRenderer.invoke(FETCH_CHANNEL, request)) as BridgeResponse,
    );
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw toRequestError(error);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
};

const isStorePage = () => {
  if (window.top !== window) return false;
  try {
    // The main process owns the allow-list, so dev and production agree.
    return (
      ipcRenderer.sendSync(INTERNAL_URL_CHANNEL, window.location.href) === true
    );
  } catch {
    return false;
  }
};

if (isStorePage()) {
  Object.defineProperty(window, '__axiooFetch', {
    value: axiooFetch,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, '__AXIOO_DESKTOP__', {
    value: {
      version: BRIDGE_VERSION,
      fetch: axiooFetch,
      startGoogleLogin: (callbackUrl: string) =>
        ipcRenderer.invoke(DESKTOP_START_CHANNEL, callbackUrl),
      takeDesktopLogin: () => ipcRenderer.invoke(DESKTOP_TAKE_CHANNEL),
      finishDesktopLogin: (attempt: string) =>
        ipcRenderer.send(DESKTOP_FINISH_CHANNEL, attempt),
    },
    writable: false,
    configurable: false,
  });
}
