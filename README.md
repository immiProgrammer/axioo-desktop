# Axioo Desktop

An Electron desktop app for [axioo.store](https://axioo.store/). The main window loads the website and keeps `axioo.store` and its subdomains inside the app. Other web links open in the system browser. The remote page has no Node.js integration or preload bridge.

## Requirements

- Node.js 24 or newer
- npm 10 or newer

## Development

```sh
npm ci
npm start
```

## Build utilities

```sh
npm run build        # Compile main, preload, and renderer bundles
npm run preview      # Open the built app locally
npm run package      # Create an installer for the current platform
npm run lint         # Check source formatting and lint rules
npm test             # Check URL routing and save timing
npm run test:smoke   # Check remote-window startup (requires a desktop session and site access)
```

The main app code is in `src/main`. The local `src/renderer` and preload bundles remain in the build scaffold but are not loaded by the website window. `electron.vite.config.ts` controls bundling. `package.json` contains the product name, app ID, icons, platform targets, and installer output settings. Native dependencies, if added, belong in `release/app/package.json` so the existing rebuild helper can package them.

Window position, size, and maximized/full-screen state are restored automatically by `electron-window-state`. It writes `window-state.json` in Electron's user data directory when the window closes. `src/main/settings.ts` provides a separate `electron-store` instance (`settings.json` in the same directory). The last supported URL is saved there after 5 seconds without a URL change, within 15 seconds of continuous changes, and immediately on close. Only HTTPS URLs on `axioo.store` or its subdomains are restored. Add other settings from the main process when their fields are defined.

The auto-update client is installed and checks for updates in packaged builds that contain `app-update.yml`. Release publishing is not configured yet. Add your release destination and signing credentials before distributing updates. The package identity is currently `com.axioo.desktop`; change it if another application already uses that ID. Add platform icons in `build-resources` when the final branding is ready.

See [the release and auto-update checklist](.docs/release-and-auto-update.md) for the remaining setup steps.
