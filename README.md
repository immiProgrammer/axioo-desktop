# Axioo Desktop

A small Electron desktop app with a plain HTML, CSS, and TypeScript window. The main process, preload script, and renderer are built with electron-vite. React is not required.

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
npm run test:smoke   # Check startup and preload IPC (requires a desktop session)
```

The app source is in `src/main` and `src/renderer`. `electron.vite.config.ts` controls bundling. `package.json` contains the product name, app ID, icons, platform targets, and installer output settings. Native dependencies, if added, belong in `release/app/package.json` so the existing rebuild helper can package them.

Window position, size, and maximized/full-screen state are restored automatically by `electron-window-state`. It writes `window-state.json` in Electron's user data directory when the window closes. `src/main/settings.ts` provides a separate `electron-store` instance for other small JSON settings (`settings.json` in the same directory). Add the settings you want to save from the main process when their fields are defined.

The auto-update client is installed and checks for updates in packaged builds that contain `app-update.yml`. Release publishing is not configured yet. Add your release destination and signing credentials before distributing updates. The package identity is currently `com.axioo.desktop`; change it if another application already uses that ID. Add platform icons in `build-resources` when the final branding is ready.

See [the release and auto-update checklist](.docs/release-and-auto-update.md) for the remaining setup steps.
