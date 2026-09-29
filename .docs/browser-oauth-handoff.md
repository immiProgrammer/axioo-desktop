# Browser sign-in handoff for Axioo Desktop

## Bridge contract

The desktop app exposes `window.__AXIOO_DESKTOP__` on trusted Axioo pages. Version 2 adds three handoff utilities:

- `openExternal(url, ask = true)` returns `opened`, `copied`, `cancelled`, or `failed`. The default opens a native dialog with **Open in browser**, **Copy link**, and **Cancel**. `ask = false` opens a trusted Axioo HTTPS URL directly. The main process validates both the sender and URL.
- `onEvent(handler)` receives queued desktop events. A deep-link event has an ID, the `axioo-desktop://` URL, and the last URL the app opened or copied. Electron does not parse the login payload.
- `sendEvent({ type: "ready" })` requests queued events; `event-handled` acknowledges one; `clear-return` removes the saved outbound URL after the website completes its flow.

This is the stable contract. The website chooses the login provider, browser start route, return path, token format, messages, and redirect. Electron handles the native dialog, default browser, protocol registration, window focus, and event delivery. A change to those native capabilities or to the bridge contract still requires a desktop release.

## Google flow

1. The website Google button detects the bridge, generates a random attempt ID, and calls `openExternal()` with the Axioo `/api/v1/desktop-auth/google-start` URL. The URL carries the attempt and validated callback. Electron stores that outbound URL for ten minutes after the user opens or copies it.
2. The default browser requests the public Elysia start route. The route calls Better Auth `auth.api.signInSocial()` and forwards its OAuth state cookie and Google redirect in the same browser response. Google's registered callback remains `/api/auth/callback/google`.
3. After Google sign-in, Better Auth sends the browser to `/desktop-login`. That page requests a short-lived token from the protected Elysia endpoint. Only a Google-authenticated browser session can issue it. Redis has one `desktop-login:<userId>` key with the token hash, attempt ID, callback, and a two-minute expiry. A newer token replaces the previous one.
4. The browser opens `axioo-desktop://auth/complete` with the user ID, token, attempt ID, and callback. It also provides a manual **Open Axioo Desktop** link.
5. Electron queues the app link and opens a trusted Axioo tab. The website receives it through `onEvent()`, confirms that its attempt and callback match the outbound URL Electron recorded, and stores the completion in the tab's session storage. The token is never put in the website page URL.
6. The website opens its `/desktop-login` page inside Electron and posts the token to the Better Auth redemption endpoint. The server atomically compares and deletes the single Redis key, creates a desktop session, and sets Better Auth's session cookie in Electron. The website verifies the session, clears the pending outbound URL, and navigates to the safe callback or `/`.

The user ID in the app link is only a lookup key. The Redis record decides which account signs in. A link without a matching outbound attempt cannot switch the desktop account.

## Code locations

- Desktop bridge and app links: `src/main/main.ts`, `site-preload.ts`, and `external-links.ts`
- Website button and event handler: `C:/code/axioo/src/components/auth/google-sign-in-button.tsx` and `desktop-link-handler.tsx`
- Website start and token routes: `C:/code/axioo/src/app/api/v1/[[...slug]]/routes/desktop-auth.ts`
- Website browser and desktop completion page: `C:/code/axioo/src/app/(public)/desktop-login/page.tsx`
- Token storage and redemption: `C:/code/axioo/src/server/better-auth/desktop-handoff.ts` and `desktop-plugin.ts`

## Release verification

- On Windows in development, restart the Electron process after changing the main process. It registers `axioo-desktop://` with the Electron executable and the project entry path. Open the browser page's **Open Axioo Desktop** link and accept any browser prompt to verify the handler.
- The browser prompt may call the handler **Electron** during `electron-vite dev` because Windows launches `electron.exe`. The packaged Windows executable uses the configured **Axioo Desktop** product name.
- Install the Windows build and verify `axioo-desktop://` returns to both a running and closed app.
- Complete a live Google sign-in with the default browser, Redis, and Electron. Check that the browser and Electron have separate sessions.
- Check copy, cancel, failed browser launch, token expiry and reuse, two attempts, forged links, and tenant callback URLs.
- Verify protocol registration on macOS and Linux before releasing those builds.
