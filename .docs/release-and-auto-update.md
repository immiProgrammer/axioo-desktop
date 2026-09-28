# Release publishing and auto-update setup

This is the setup checklist for **Axioo Desktop**. GitHub Releases is the intended example; choose the actual destination before enabling publishing. Do not use the `electron-react-boilerplate/electron-react-boilerplate` repository from the reference project.

## Current state

- `electron-builder`, `electron-updater`, `electron-log`, and `@electron/notarize` are installed.
- `src/main/updates.ts` checks once at startup in a packaged app **only when** `app-update.yml` exists. Development builds do not check for updates.
- `npm run package` builds local installers with `--publish never`. There is no release publishing workflow or `build.publish` configuration yet.
- The current version is `0.1.0` in both `package.json` and `release/app/package.json`. The app ID is `com.axioo.desktop`.
- `C:\code\axioo-desktop` currently has no Git metadata or remote. `C:\code\electron-react-boilerplate` is the reference repository, not Axioo's release destination.
- The existing macOS `afterSign` hook in `.erb/scripts/notarize.js` expects `CI=true`, `APPLE_ID`, `APPLE_ID_PASS`, and `APPLE_TEAM_ID`. `mac.notarize` is `false` because this custom hook handles notarization.

## Before enabling releases

- [ ] Choose the GitHub **OWNER/REPO** that will host Axioo Desktop releases. Decide whether releases are public; private-repository update access needs additional authentication design.
- [ ] Put this project in that repository and set its Git remote. Do not point the release configuration at the reference boilerplate repository.
- [ ] Confirm the final `productName` and `appId` in `package.json`. Keep the app ID stable once users have installed a release.
- [ ] Add the final platform icons under `build-resources` and test their appearance in installers.
- [ ] Keep the `version` values in the root and `release/app` package files aligned for every release.

## Configure the update source

- [ ] Add the target repository to the root `package.json` and set `build.publish` to GitHub. Replace `OWNER` and `REPO` with the actual values:

  ```json
  {
    "repository": {
      "type": "git",
      "url": "git+https://github.com/OWNER/REPO.git"
    },
    "build": {
      "publish": {
        "provider": "github",
        "owner": "OWNER",
        "repo": "REPO"
      }
    }
  }
  ```

  Merge those fields into the existing `package.json`; keep its other `build` settings. Electron-builder will generate the packaged `app-update.yml` and release metadata for the configured provider. Do not call `autoUpdater.setFeedURL()` for this setup.

- [ ] Keep Windows `nsis` and Linux `AppImage` targets if those platforms will receive updates. Confirm the macOS build produces both DMG and ZIP; the ZIP is needed for macOS update metadata. The current macOS target is `default`.

## Configure signing and notarization

- [ ] For macOS, provide a Developer ID Application signing certificate to CI using `CSC_LINK` and `CSC_KEY_PASSWORD`. Set the repository secrets `APPLE_ID`, `APPLE_ID_PASS` (an app-specific password), and `APPLE_TEAM_ID` for the existing notarization hook. Verify that notarization actually succeeds rather than relying on its skip message.
- [ ] For Windows, configure a code-signing certificate or another supported signing method. With a certificate file, use `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` in CI. Keep the signing identity consistent across updates.
- [ ] Store credentials only in GitHub Actions secrets. Never put tokens, certificates, or passwords in `package.json`, workflow source, or the app bundle.

## Add a release workflow

- [ ] Add `.github/workflows/release.yml` in the **Axioo Desktop** repository. Trigger it on version tags such as `v0.1.0`, and give the release job `permissions: contents: write`.
- [ ] Build on separate Windows, macOS, and Linux runners for the platforms being released. On each runner: check out the tagged commit, install Node 24, run `npm ci`, run `npm run build`, then run `npx electron-builder --publish always`. Set `GH_TOKEN` to `${{ secrets.GITHUB_TOKEN }}` for publishing and pass the relevant signing secrets to the matching platform job.
- [ ] Keep `npm run package` for local, non-publishing builds. The release workflow must explicitly use `--publish always`; `npm run package` always uses `--publish never`.
- [ ] Check that the workflow attaches installers **and** generated update files such as `latest.yml`, `latest-mac.yml`, and `latest-linux.yml` to the same release. Publish the GitHub draft release only after all intended platform jobs succeed; draft releases are not visible to normal update checks.

## First release and update test

- [ ] Build and publish a signed first release using a tag matching the root package version, for example `v0.1.0` for version `0.1.0`.
- [ ] Install that release on each supported OS. Confirm the app starts and its packaged resources contain `app-update.yml`.
- [ ] Increment both package versions, for example to `0.1.1`, then build and publish `v0.1.1` with the same app ID and signing identity.
- [ ] Launch the previously installed version, verify it finds the new release, downloads it, and updates successfully. Check the `electron-log` file for update errors.

## References

- [Electron-builder v26 publish configuration](https://www.electron.build/v26/docs/publish/)
- [Electron-builder v26 auto-update guide](https://www.electron.build/v26/docs/features/auto-update/)
- [Electron-builder v26 GitHub Actions guide](https://www.electron.build/v26/docs/features/github-actions/)
- [Electron-builder v26 macOS notarization guide](https://www.electron.build/v26/docs/notarization/)
- [Electron-builder v26 troubleshooting](https://www.electron.build/v26/docs/troubleshooting/)
