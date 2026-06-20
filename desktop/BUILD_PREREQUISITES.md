# Desktop Build Prerequisites

Kuviewer desktop code is currently a Tauri-based local shell prototype for read-only CM/SSH session exploration.

No desktop installer download path is active. The repository does not publish desktop installer files, desktop release assets, or a public desktop download workflow. Local desktop work should be treated as prototype validation only.

## Required Tools

- Node.js and npm for the existing `website` Vite build and the `desktop` package scripts.
- Go for compiling the bundled Kuviewer read-only API sidecar during Tauri runs.
- Rust and Cargo for compiling the Tauri shell.

The repository check does not install these tools. It verifies that the packaging spec stays aligned with the scaffold:

```bash
node scripts/check-desktop-packaging-spec.mjs
```

## Local Build Shape

Install desktop dependencies only when actively working on the desktop shell prototype:

```bash
cd desktop
npm install
npm run tauri:dev
```

The Tauri config builds the existing `website` app and the Go sidecar binary before dev/build runs. Bundle output is disabled while desktop downloads are de-scoped. The desktop shell remains read-only and must not request browser-side kube credentials.

The future desktop-local idea is a CM/SSH session manager with multiple sessions, similar to VS Code Remote SSH. The current implementation stores safe session metadata, imports private keys only through the Rust layer into the OS credential store, performs bounded connection checks, and starts a CM tunnel/runtime with a temporary owner-only key file outside the repository. Runtime start opens an SSH tunnel to the configured remote Kuviewer API host/port, verifies `/healthz`, and returns only a localhost profile stored in `sessionStorage`; runtime health/details include only safe localhost/remote endpoint metadata, health status, last health timestamp/message, bounded error text, and safe diagnostic stage/severity/message/hint metadata. Manual health recheck marks unhealthy or lost runtimes without exposing credentials, and runtime-lost cleanup clears stale live mode. Admin token authentication remains unchanged. The web app must not expose SSH. Existing local sidecar/API paths remain prototype-only scaffolds for validation and are not the desktop product default.

Desktop CM session export/import is limited to safe editable metadata and exists only in the desktop CM/SSH session manager UI. Export/import JSON never carries private key bodies, OS credential payloads, runtime profiles, diagnostic history, admin tokens, kubeconfigs, cloud credentials, Secret values, Events, or logs. Desktop CM connection profile polish is UI-only: quick API presets, selected-session refill, safe endpoint preview, and pre-save metadata validation do not create new browser storage or change the export/import JSON shape. Desktop CM diagnostic filtering is also desktop-only UI state; active stage/severity filter values are not exported. Desktop CM diagnostic saved filters persist only safe stage/severity preset metadata under `kuviewer_desktop_cm_diagnostic_filter_presets` and never carry session search text, session data, credentials, runtime profiles, diagnostic history, or export/import payloads.

The old remote server profile UX is prototype-only. It stores only the selected Kuviewer server URL in browser `localStorage`; admin tokens remain session-only, and profile changes clear the current token. The current CM/SSH session manager clears that legacy profile in desktop runtime and keeps it out of the product UI.

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

Default sidecar source is `mock` when the prototype sidecar is enabled. Use `KUVIEWER_DESKTOP_SIDECAR_SOURCE=kubernetes` only when the local environment has a safe Kubernetes credential source configured outside the browser. Use `KUVIEWER_DESKTOP_DISABLE_SIDECAR=1` for prototype testing. Do not commit generated sidecar binaries, kubeconfigs, admin tokens, Secret values, Events, or logs.

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

The smoke verifies CM/SSH session save/select, safe metadata export/import, private-key import command flow, connection check command flow, CM tunnel/runtime start/stop, runtime health recheck, runtime-lost cleanup, safe diagnostic UI/search, desktop CM diagnostic filtering, desktop CM diagnostic saved filters, sessionStorage-only runtime profile cleanup, credential deletion, and session deletion through a stubbed Tauri bridge. It confirms the web runtime does not expose SSH session UI, checks that no admin token or legacy API profile is stored, and verifies private key bodies are not captured by browser state.

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

## Safety Policy

- Do not commit certificates, private key material, kubeconfigs, admin tokens, cloud credentials, Secret values, Events, logs, generated sidecar binaries, or temp credential files.
- Keep browser-side SSH unavailable.
- Keep desktop runtime secrets in native Rust/OS credential boundaries only.
- Keep operational Kubernetes actions out of scope.
