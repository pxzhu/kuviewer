# Desktop Build Prerequisites

Kuviewer desktop packaging is Tauri-first. The current repository contains a read-only shell scaffold and a checked packaging spec, but installer builds should only run after the local or CI environment has the prerequisites below.

## Required Tools

- Node.js and npm for the existing `website` Vite build and the `desktop` package scripts.
- Go for compiling the bundled Kuviewer read-only API sidecar during Tauri packaging.
- Rust and Cargo for compiling the Tauri shell.
- macOS `.dmg`: Xcode Command Line Tools on a macOS host.
- Windows `.exe`: a Windows host or CI runner for the NSIS target.

The repository check does not install these tools. It verifies that the packaging spec stays aligned with the scaffold:

```bash
node scripts/check-desktop-packaging-spec.mjs
```

## Local Build Shape

Install desktop dependencies only when actively working on the installer path:

```bash
cd desktop
npm install
npm run tauri:build
```

The Tauri config builds the existing `website` app and the Go sidecar binary before packaging. The desktop shell remains read-only and must not request browser-side kube credentials.

The installable product direction is a desktop-only CM/SSH session manager with multiple sessions, similar to VS Code Remote SSH. The current implementation is metadata-only: it stores session name, host, port, user, status, and description through safe Tauri commands. The web app must not expose SSH. Existing local sidecar/API packaging paths remain prototype-only scaffolds for validation and are not the desktop product default.

The old remote server profile UX is prototype-only. It stores only the selected Kuviewer server URL in browser `localStorage`; admin tokens remain session-only, and profile changes clear the current token. The current CM/SSH session manager clears that legacy profile in desktop runtime and keeps it out of the product UI.

## Package Versioning

The checked-in desktop package baseline remains `0.1.0`. For local or CI packaging, resolve a package version from the repository root before running Tauri:

```bash
node scripts/set-desktop-package-version.mjs --version 0.1.76 --dry-run
node scripts/set-desktop-package-version.mjs --version 0.1.0 --check
```

The manual `desktop-package` workflow accepts a `package_version` input and otherwise derives the version from a `v*` tag ref or falls back to `0.1.0`. The workflow mutates only its build workspace before packaging so release artifact names and Tauri installer metadata match the selected version. Do not commit certificates, private keys, credentials, kubeconfigs, admin tokens, Secret values, Events, logs, or accidental local version bumps.

Set `smoke_matrix=true` on the manual workflow to build both unsigned macOS `.dmg` and Windows `.exe` packages in one dispatch. Smoke matrix mode cannot be combined with signing and uploads outputs only as GitHub Actions artifact records, not release assets.

## Local Sidecar Runtime

The Go API server is still built as a desktop sidecar binary for prototype validation. It is no longer launched by default in the desktop product path. Generated sidecar binaries live under `desktop/src-tauri/binaries` by default and are ignored by git.

Dry-run the build plan:

```bash
node scripts/build-desktop-sidecar.mjs --target aarch64-apple-darwin --dry-run
node scripts/build-desktop-sidecar.mjs --list-targets
```

Build to a temporary directory for local smoke testing:

```bash
node scripts/build-desktop-sidecar.mjs --target aarch64-apple-darwin --out-dir /tmp/kuviewer-sidecar-smoke
```

When explicitly enabled with `KUVIEWER_DESKTOP_ENABLE_PROTOTYPE_SIDECAR=1`, the sidecar binds to `127.0.0.1:18086` and receives a per-launch admin token generated in memory by the Tauri runtime. Frontend JavaScript still does not receive shell permissions.

Default sidecar source is `mock` when the prototype sidecar is enabled. Use `KUVIEWER_DESKTOP_SIDECAR_SOURCE=kubernetes` only when the packaging environment has a safe Kubernetes credential source configured outside the browser. Use `KUVIEWER_DESKTOP_DISABLE_SIDECAR=1` for prototype testing. Do not commit generated sidecar binaries, kubeconfigs, admin tokens, Secret values, Events, or logs.

The old local-sidecar switch action is hidden from the current CM/SSH session manager UI.

## Keychain Credential Design

Direct desktop-to-cluster credentials are specified in [KEYCHAIN_CREDENTIAL_DESIGN.md](KEYCHAIN_CREDENTIAL_DESIGN.md). The design requires macOS Keychain and Windows Credential Manager for secret material, while browser `localStorage` may hold only safe profile ids/display metadata.

The first runtime implementation supports bearer-token profiles through `KUVIEWER_KUBE_TOKEN_FILE`, not browser-side kubeconfig import. Runtime token temp files must be outside the repository, owner-only where supported, and deleted when the sidecar stops.

The current prototype adds safe metadata commands `desktop_kubernetes_profiles` and `desktop_select_kubernetes_profile`, plus `desktop_delete_kubernetes_profile_credential` for native credential removal. That prototype UI is hidden from the current CM/SSH session manager product path. For metadata smoke testing, use `KUVIEWER_DESKTOP_KUBE_API_SERVER`, optional `KUVIEWER_DESKTOP_KUBE_PROFILE_ID`, and optional `KUVIEWER_DESKTOP_KUBE_PROFILE_NAME` as metadata-only inputs. Do not put bearer tokens, kubeconfig YAML, private keys, cloud credentials, or Secret values in those variables.

For native OS store smoke, set `KUVIEWER_DESKTOP_KUBE_TOKEN_FILE` to a local token file path and `KUVIEWER_DESKTOP_KUBE_IMPORT_TOKEN_FILE=1` before startup. Rust reads the file, writes the token to macOS Keychain or Windows Credential Manager, and returns only safe metadata such as `credentialAvailable` to the UI. Keep token files outside the repository and delete local smoke files afterward.

Selecting a stored profile restarts the local sidecar with `KUVIEWER_SOURCE=kubernetes`, `KUVIEWER_KUBE_API_SERVER`, and `KUVIEWER_KUBE_TOKEN_FILE`, then returns `sidecar-kubernetes-active` metadata to the UI. Runtime token files use `0600-temp-dir-delete-on-sidecar-stop`, so they should be outside the repository and cleaned on sidecar stop/restart.

The active automated desktop runtime smoke uses a stubbed Tauri bridge rather than a real OS credential store. After building the frontend and starting preview, run:

```bash
node scripts/smoke-desktop-cm-sessions.mjs --url http://127.0.0.1:4174/kuviewer/
```

The smoke verifies metadata-only CM/SSH session save/select/delete, confirms the web runtime does not expose SSH session UI, and checks that no admin token or legacy API profile is stored.

The historical `scripts/smoke-desktop-keychain-runtime.mjs` helper remains available for prototype-only keychain runtime checks outside the current product UI.

## Icon Assets

The current source icons are the transparent YAML Flow app icons already used by the web app:

- `website/public/favicon-32x32.png`
- `website/public/favicon-192x192.png`
- `website/public/apple-touch-icon.png`

Platform-specific generated assets are committed under `desktop/src-tauri/icons` and are derived from the public app icon:

- `desktop/src-tauri/icons/32x32.png`
- `desktop/src-tauri/icons/128x128.png`
- `desktop/src-tauri/icons/128x128@2x.png`
- `desktop/src-tauri/icons/icon.png`
- `desktop/src-tauri/icons/icon.icns`
- `desktop/src-tauri/icons/icon.ico`

Regenerate them from the repository root with:

```bash
node scripts/generate-desktop-icons.mjs
```

The generator uses macOS `sips` for resizing and writes ICNS/ICO containers directly, so run it on macOS. Do not use cropped candidate thumbnails or screenshots as desktop icons.

## Signing Policy

Signing is secret-gated in the manual desktop packaging workflow and unsigned builds remain the default. Do not commit certificates, signing identities, password files, PFX files, private key material, kubeconfigs, admin tokens, cloud credentials, Secret values, Events, or logs.

Signed CI builds use temporary runner storage only:

- macOS: `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are required when `signed` is enabled. The workflow imports the Developer ID `.p12` into a temporary keychain, passes Apple notarization env vars to the Tauri build, and deletes the temporary keychain afterward.
- Windows: `WINDOWS_CERTIFICATE_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD` are required when `signed` is enabled. The workflow imports the PFX into the CurrentUser certificate store, injects the thumbprint into the CI workspace Tauri config, and removes the certificate afterward. Optional repository variable `WINDOWS_TIMESTAMP_URL` overrides the default timestamp server.

Signing config is generated only in the local or CI workspace:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Example" node scripts/configure-desktop-signing.mjs --macos --dry-run
WINDOWS_CERTIFICATE_THUMBPRINT=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA node scripts/configure-desktop-signing.mjs --windows --dry-run
```

Unsigned local test builds are acceptable for packaging development. Public installer release should wait until signing and notarization are explicitly configured and tested.

## Verified Dry Runs

An unsigned macOS `.dmg` dry-run succeeded on 2026-06-19 through the manual `desktop-package` workflow:

- run id: `27800527207`
- output: `Kuviewer_0.1.0_aarch64.dmg`
- artifact: `kuviewer-macos-dmg`
- artifact size: `7,125,256` bytes

This confirms the scaffold can produce a macOS DMG on GitHub-hosted macOS runners. The artifact remains unsigned.

An unsigned Windows `.exe` dry-run also succeeded on 2026-06-19 through the same manual workflow:

- run id: `27803179419`
- output: `Kuviewer_0.1.0_x64-setup.exe`
- artifact: `kuviewer-windows-exe`
- artifact size: `5,777,828` bytes

This confirms the scaffold can produce a Windows NSIS installer on GitHub-hosted Windows runners. The artifact remains unsigned.
