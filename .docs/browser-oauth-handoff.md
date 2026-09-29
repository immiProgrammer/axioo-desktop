# Browser sign-in handoff for Axioo Desktop

## Implemented flow

1. The shared Google button checks `window.__AXIOO_DESKTOP__`. In the desktop app it asks Electron to start browser sign-in, passing the original safe callback URL. Ordinary browser sign-in keeps its existing behavior.
2. Electron creates a random attempt ID, saves it with the expected callback URL and a ten-minute expiry, then opens `https://axioo.store/desktop-google-start` in the default browser. If opening fails, Electron copies that Axioo URL to the clipboard.
3. The browser start page calls Better Auth's Google sign-in with `callbackURL` set to `/desktop-login?attempt=...&callbackUrl=...`. Google's registered callback stays `/api/auth/callback/google`. The OAuth state cookie and Google pages remain in the default browser.
4. After Better Auth redirects to `/desktop-login`, that browser page requests a handoff token. The Elysia token endpoint requires a valid Axioo session with `loginMethod=google`. Redis stores the user ID, attempt ID, and validated callback URL for two minutes. Each user has one active token; a new token invalidates the previous one.
5. The browser page opens `axioo-desktop://auth/complete` with the user ID, token, attempt ID, and callback URL. It also shows an **Open Axioo Desktop** button.
6. Electron accepts the link only when the attempt ID and callback URL match its pending attempt. It opens its own `/desktop-login` page and passes the token through a one-time preload call, keeping the token out of the page URL and saved tabs.
7. The desktop page posts the token and attempt ID to `/api/auth/desktop-redeem`. The server atomically consumes the Redis token, reads the user ID from the stored record, creates a Better Auth session, and sets its cookie in Electron's web session. The page verifies `/api/auth/get-session`, then uses `getSafeCallbackUrl()` to navigate to the original destination or `/`.

The user ID in the deep link is not trusted as authorization. The server's token record decides which user signs in. Expired and reused tokens fail. A denied Google sign-in does not issue a token.

## Code locations

- Website button: `C:/code/axioo/src/components/auth/google-sign-in-button.tsx`
- Browser start and completion pages: `C:/code/axioo/src/app/(public)/desktop-google-start/page.tsx` and `C:/code/axioo/src/app/(public)/desktop-login/page.tsx`
- Token route and Better Auth redemption: `C:/code/axioo/src/app/api/v1/[[...slug]]/routes/desktop-auth.ts` and `C:/code/axioo/src/server/better-auth/desktop-plugin.ts`
- Electron protocol, IPC, and navigation: `C:/code/axioo-desktop/src/main/main.ts`, `site-preload.ts`, `desktop-auth.ts`, and `tabs.ts`

## Release verification still needed

- Install the Windows installer and verify that `axioo-desktop://` returns to both a running and closed app. The Windows directory and NSIS installer build successfully, but an installed protocol handler has not been exercised yet.
- Complete a live Google sign-in against a configured Axioo server with Redis. Check the browser and Electron sessions separately.
- Repeat with denied consent, token expiry/reuse, a forged link, two attempts, and a callback into a tenant subdomain.
- Verify macOS and Linux protocol registration on those platforms before releasing those builds.
