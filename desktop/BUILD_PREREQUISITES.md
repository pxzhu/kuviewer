# Desktop Build Prerequisites

Kuviewer desktop packaging is Tauri-first. The current repository contains a read-only shell scaffold and a checked packaging spec, but installer builds should only run after the local or CI environment has the prerequisites below.

## Required Tools

- Node.js and npm for the existing `website` Vite build and the `desktop` package scripts.
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

Remote server profile UX is runtime-only. It stores only the selected Kuviewer server URL in browser `localStorage`; admin tokens remain session-only, and profile changes clear the current token. Remote hosts should use `https`; plain `http` is limited to loopback development servers. Remote servers that are not same-origin must set `KUVIEWER_CORS_ORIGIN` for the desktop app origin.

## Package Versioning

The checked-in desktop package baseline remains `0.1.0`. For local or CI packaging, resolve a package version from the repository root before running Tauri:

```bash
node scripts/set-desktop-package-version.mjs --version 0.1.76 --dry-run
node scripts/set-desktop-package-version.mjs --version 0.1.0 --check
```

The manual `desktop-package` workflow accepts a `package_version` input and otherwise derives the version from a `v*` tag ref or falls back to `0.1.0`. The workflow mutates only its build workspace before packaging so release artifact names and Tauri installer metadata match the selected version. Do not commit certificates, private keys, credentials, kubeconfigs, admin tokens, Secret values, Events, logs, or accidental local version bumps.

## Local Sidecar Runtime

The Go API server is built as a desktop sidecar binary and launched by the Rust Tauri runtime. Generated sidecar binaries live under `desktop/src-tauri/binaries` by default and are ignored by git.

Dry-run the build plan:

```bash
node scripts/build-desktop-sidecar.mjs --target aarch64-apple-darwin --dry-run
node scripts/build-desktop-sidecar.mjs --list-targets
```

Build to a temporary directory for local smoke testing:

```bash
node scripts/build-desktop-sidecar.mjs --target aarch64-apple-darwin --out-dir /tmp/kuviewer-sidecar-smoke
```

The sidecar binds to `127.0.0.1:18086` and receives a per-launch admin token generated in memory by the Tauri runtime. The UI reads only the sidecar URL, source, and token through the `desktop_sidecar_profile` Tauri command, then stores the token in `sessionStorage`. Frontend JavaScript still does not receive shell permissions.

Default sidecar source is `mock` for installer smoke builds. Use `KUVIEWER_DESKTOP_SIDECAR_SOURCE=kubernetes` only when the packaging environment has a safe Kubernetes credential source configured outside the browser. Use `KUVIEWER_DESKTOP_DISABLE_SIDECAR=1` for remote-profile-only testing. Do not commit generated sidecar binaries, kubeconfigs, admin tokens, Secret values, Events, or logs.

The desktop UI can show the detected local sidecar source next to the remote server URL profile and includes an explicit local-sidecar switch action. That switch re-queries the Tauri sidecar profile command for the current per-launch token and keeps the token session-only.

## Keychain Credential Design

Direct desktop-to-cluster credentials are specified in [KEYCHAIN_CREDENTIAL_DESIGN.md](KEYCHAIN_CREDENTIAL_DESIGN.md). The design requires macOS Keychain and Windows Credential Manager for secret material, while browser `localStorage` may hold only safe profile ids/display metadata.

The first runtime implementation supports bearer-token profiles through `KUVIEWER_KUBE_TOKEN_FILE`, not browser-side kubeconfig import. Runtime token temp files must be outside the repository, owner-only where supported, and deleted when the sidecar stops.

The current prototype adds safe metadata commands `desktop_kubernetes_profiles` and `desktop_select_kubernetes_profile`, plus `desktop_delete_kubernetes_profile_credential` for native credential removal. For metadata smoke testing, use `KUVIEWER_DESKTOP_KUBE_API_SERVER`, optional `KUVIEWER_DESKTOP_KUBE_PROFILE_ID`, and optional `KUVIEWER_DESKTOP_KUBE_PROFILE_NAME` as metadata-only inputs. Do not put bearer tokens, kubeconfig YAML, private keys, cloud credentials, or Secret values in those variables.

For native OS store smoke, set `KUVIEWER_DESKTOP_KUBE_TOKEN_FILE` to a local token file path and `KUVIEWER_DESKTOP_KUBE_IMPORT_TOKEN_FILE=1` before startup. Rust reads the file, writes the token to macOS Keychain or Windows Credential Manager, and returns only safe metadata such as `credentialAvailable` to the UI. Keep token files outside the repository and delete local smoke files afterward.

Selecting a stored profile restarts the local sidecar with `KUVIEWER_SOURCE=kubernetes`, `KUVIEWER_KUBE_API_SERVER`, and `KUVIEWER_KUBE_TOKEN_FILE`, then returns `sidecar-kubernetes-active` metadata to the UI. Runtime token files use `0600-temp-dir-delete-on-sidecar-stop`, so they should be outside the repository and cleaned on sidecar stop/restart.

The automated runtime smoke uses a stubbed Tauri bridge rather than a real OS credential store. After building the frontend and starting preview, run:

```bash
node scripts/smoke-desktop-keychain-runtime.mjs --url http://127.0.0.1:4174/kuviewer/
```

The smoke verifies `desktop_kubernetes_profiles`, stored profile selection, session-only sidecar token handoff, live mode switching, and active credential deletion fallback. It must not create macOS Keychain or Windows Credential Manager entries.

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
