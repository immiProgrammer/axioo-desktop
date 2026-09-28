# Browser sign-in handoff for Axioo Desktop

This is an implementation plan, not an enabled feature. The goal is to start Google sign-in from Axioo Desktop, complete it in the user's default browser, and return to the Electron window with an Axioo session.

## Current behavior

- The main window loads `https://axioo.store/`. `src/main/navigation.ts` currently keeps `axioo.store` and `accounts.google.com` inside Electron; other links go through `shell.openExternal()` in `src/main/main.ts`.
- The observed Google request redirects to `https://axioo.store/api/auth/callback/google`. That callback currently runs in whichever browser received the Google redirect.
- The system browser and Electron have separate cookie stores. Completing the web callback in the system browser does not sign in Electron automatically. Opening only the generated Google URL externally can also split an OAuth transaction that began in Electron.
- `src/main/main.ts` currently logs complete external URLs. This must be changed before any handoff URL contains a login code.

## Proposed flow

Keep the existing **web** Google OAuth client and its Axioo server callback. Add a separate, one-time handoff from the website to the desktop app. Start the entire web OAuth transaction in the default browser rather than opening a Google URL generated inside Electron.

1. Electron asks the Axioo server to create a pending desktop login transaction. Keep a random correlation value in Electron memory until this attempt ends.
2. Electron opens an Axioo **start** URL with `shell.openExternal()`. The browser visits Axioo first, then the website starts Google OAuth in that same browser session.
3. Google redirects back to the existing Axioo web callback. The server verifies OAuth state, completes sign-in in the browser, and creates a short-lived, single-use handoff code tied to the pending desktop transaction and signed-in user.
4. The browser's completion page opens a custom link such as `axioo-desktop://auth/complete?code=...&state=...`. Provide an **Open Axioo Desktop** button if automatic opening is blocked or needs user confirmation.
5. Electron receives the link, verifies the expected scheme, path, code format, and correlation value, then focuses its existing window.
6. Electron redeems the handoff code with the Axioo server. The server establishes an Axioo session in **Electron's** browser session, for example through a dedicated HTTPS completion endpoint that sets a `Secure`, `HttpOnly` cookie and redirects to a clean store URL.

The deep link carries only a short-lived handoff code. Do not put Google authorization codes, Google access tokens, refresh tokens, or the Axioo session cookie in the deep link. A browser cookie must not be copied into Electron.

## Website and authentication server work

- [ ] Confirm how the current `/api/auth/callback/google` implementation stores OAuth state and the web session. Ensure the browser starts and finishes that transaction without relying on Electron cookies.
- [ ] Add a desktop login start endpoint and a pending transaction record with an expiry, random correlation value, and cancellation handling. Limit outstanding attempts.
- [ ] After successful Google callback, create a one-use handoff code bound to that transaction and user. Redeem it atomically; reject expired, reused, mismatched, or cancelled codes.
- [ ] Add a browser completion page that invokes the desktop deep link and has a manual return button. Show an ordinary error and retry path if sign-in or handoff fails.
- [ ] Add a desktop completion endpoint that creates the session in Electron's web session and immediately redirects to a clean `https://axioo.store/` page. Use `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on code-bearing responses.
- [ ] Decide whether the website's existing auth library supports creating a desktop session this way or needs a dedicated session-exchange endpoint. Do not assume its browser callback alone will authenticate the app.

## Electron work

- [ ] Register a unique `axioo-desktop://` protocol for installed builds and configure installer/package metadata for Windows, macOS, and Linux as needed. Keep development registration separate from the installed app so they do not compete for the same protocol.
- [ ] Add a single-instance lock. Receive deep links from startup arguments and `second-instance` on Windows/Linux, and `open-url` on macOS. Restore and focus the main window when a valid link arrives.
- [ ] Validate the incoming deep link and match its correlation value to the pending login before redeeming the code. Ignore unrelated or replayed links.
- [ ] Route the sign-in action to the browser-based Axioo start URL. When switching to this flow, stop sending Google OAuth pages into the Electron window; leave ordinary store navigation inside it.
- [ ] After handoff, load the server's desktop completion endpoint in the main window, then verify the authenticated store page loads. Keep the final URL on `axioo.store`.
- [ ] Redact login codes, OAuth `state`, and similar query parameters from terminal and file logs. The current external-link log prints full URLs.
- [ ] Exclude OAuth callback and desktop completion URLs from `lastUrl` persistence, even though they are under `axioo.store`. Restore a normal store URL on the next launch.
- [ ] Handle timeout, cancellation, browser closed without signing in, app already open, app cold start, and a second login attempt while one is pending.

## Verification before release

- [ ] Test the **packaged and installed** app's protocol registration; a development run alone does not prove OS link handling.
- [ ] Test Windows first, then macOS and Linux if those builds will be released. Verify both a running app and a closed app return to the same authenticated store session.
- [ ] Test the default browser with multiple Google profiles, denied consent, network loss, expired/reused handoff codes, a forged deep link, and two sign-in attempts.
- [ ] Confirm the browser's Axioo session and Electron's Axioo session are independent, and that no auth code appears in saved settings, logs, or the final address bar.

## Alternative

A separate **Desktop app** Google OAuth client can use the system browser, PKCE, and a temporary `127.0.0.1` loopback listener to return the Google authorization code directly to Electron. The Axioo backend would still need to turn that result into an Axioo session for the embedded store. For this website wrapper, the web callback plus one-time desktop handoff above reuses more of the current sign-in flow.

## References

- [Google OAuth policy on embedded user agents](https://developers.google.com/identity/protocols/oauth2/policies)
- [Google OAuth for desktop apps, PKCE, and loopback redirects](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Electron deep links and platform-specific callbacks](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)
- [Electron sessions and cookies](https://www.electronjs.org/docs/latest/api/session)
