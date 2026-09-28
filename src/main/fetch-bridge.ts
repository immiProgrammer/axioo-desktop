import { ipcMain, net } from 'electron';
import type { ClientRequest, IncomingMessage, WebContents } from 'electron';
import log from 'electron-log';
import {
  ABORT_CHANNEL,
  FETCH_CHANNEL,
  MAX_BODY_BYTES,
  getBridgeResponse,
  getProxyBody,
  getProxyCredentials,
  getProxyHeaders,
  getProxyMethod,
  getProxyRequestId,
  getProxyUrl,
} from './fetch-proxy';
import type {
  BridgeRequest,
  BridgeResponse,
  ProxyRequest,
} from './fetch-proxy';

const tooLarge = () =>
  new RangeError(
    `Axioo fetch stopped a response larger than ${MAX_BODY_BYTES} bytes.`,
  );

const aborted = () => new Error('Axioo fetch request was aborted.');

function send(
  request: ProxyRequest,
  onClient: (client: ClientRequest) => void,
): Promise<BridgeResponse> {
  return new Promise<BridgeResponse>((resolve, reject) => {
    const clientRequest = net.request({
      url: request.url,
      method: request.method,
      headers: request.headers,
      redirect: 'follow',
      useSessionCookies: request.credentials === 'include',
      bypassCustomProtocolHandlers: true,
    });
    onClient(clientRequest);
    let settled = false;
    let finalUrl = request.url;
    let redirected = false;
    const chunks: Buffer[] = [];
    let received = 0;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clientRequest.abort();
      reject(error);
    };

    const succeed = (response: BridgeResponse) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };

    clientRequest.on('redirect', (_statusCode, _method, redirectUrl) => {
      finalUrl = redirectUrl;
      redirected = true;
      clientRequest.followRedirect();
    });
    clientRequest.on('response', (response: IncomingMessage) => {
      const declared = Number(response.headers['content-length']?.[0] ?? 0);
      if (declared > MAX_BODY_BYTES) {
        fail(tooLarge());
        return;
      }

      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_BODY_BYTES) {
          fail(tooLarge());
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        succeed(
          getBridgeResponse(
            response.statusCode,
            response.statusMessage ?? '',
            finalUrl,
            redirected,
            response.headers,
            Buffer.concat(chunks),
          ),
        );
      });
      response.on('aborted', () => fail(aborted()));
      response.on('error', (error: Error) => fail(error));
    });
    clientRequest.on('error', (error: Error) => fail(error));

    try {
      const body =
        request.body !== undefined
          ? Buffer.from(request.body, 'utf8')
          : request.bodyBase64 !== undefined
            ? Buffer.from(request.bodyBase64, 'base64')
            : undefined;

      if (body === undefined) clientRequest.end();
      else if (body.length > MAX_BODY_BYTES) fail(tooLarge());
      else clientRequest.end(body);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function registerFetchBridge(site: WebContents): () => void {
  const inflight = new Map<string, ClientRequest>();

  const handleFetch = async (
    event: Electron.IpcMainInvokeEvent,
    rawRequest: unknown,
  ): Promise<BridgeResponse> => {
    if (event.sender !== site || site.isDestroyed()) {
      throw new Error('The Axioo fetch bridge only serves the store window.');
    }

    const request = (
      rawRequest !== null && typeof rawRequest === 'object' ? rawRequest : {}
    ) as BridgeRequest;
    const method = getProxyMethod(request.method);
    const proxyRequest: ProxyRequest = {
      id: getProxyRequestId(request.id),
      url: getProxyUrl(request.url),
      method,
      headers: getProxyHeaders(request.headers),
      credentials: getProxyCredentials(request.credentials),
      ...getProxyBody(request.body, request.bodyBase64, method),
    };
    if (proxyRequest.credentials === 'omit') {
      delete proxyRequest.headers.cookie;
    }

    try {
      return await send(proxyRequest, (client) => {
        if (proxyRequest.id !== '') inflight.set(proxyRequest.id, client);
      });
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      log.warn(
        'Axioo fetch failed',
        proxyRequest.method,
        proxyRequest.url,
        reason,
      );
      throw reason;
    } finally {
      if (proxyRequest.id !== '') inflight.delete(proxyRequest.id);
    }
  };

  const handleAbort = (event: Electron.IpcMainEvent, rawId: unknown) => {
    if (event.sender !== site) return;
    const id = getProxyRequestId(rawId);
    if (id === '') return;
    inflight.get(id)?.abort();
    inflight.delete(id);
  };

  ipcMain.handle(FETCH_CHANNEL, handleFetch);
  ipcMain.on(ABORT_CHANNEL, handleAbort);

  return () => {
    ipcMain.removeHandler(FETCH_CHANNEL);
    ipcMain.removeListener(ABORT_CHANNEL, handleAbort);
    for (const client of inflight.values()) client.abort();
    inflight.clear();
  };
}
