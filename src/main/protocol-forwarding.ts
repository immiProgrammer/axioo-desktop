/** Preserve the renderer's origin when Electron converts a request for protocol.handle. */
export function getProtocolForwardHeaders(
  request: Request & { initiatorOrigin?: string },
): Headers {
  const headers = new Headers(request.headers);
  if (
    headers.has('origin') ||
    ['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())
  ) {
    return headers;
  }

  try {
    // Electron supplies this independently of the page-controlled referrer.
    // Never infer the source from the destination or referrer alone.
    const source = new URL(request.initiatorOrigin ?? '');
    const target = new URL(request.url);
    if (
      (source.protocol === 'https:' || source.protocol === 'http:') &&
      source.origin === target.origin
    ) {
      headers.set('Origin', source.origin);
    }
  } catch {
    // Missing or opaque initiators cannot establish a trusted source.
  }
  return headers;
}
