# Kuviewer Desktop Local Prototype

This folder tracks a future desktop-local CM/SSH session prototype, not a public desktop distribution path.

No desktop installer download path is active. Kuviewer does not publish desktop installer files, desktop release assets, or a public desktop download workflow. The current product path remains the web app plus the standalone server deployment.

## Scope

- Reuse the existing React/Vite UI and Go read-only API.
- Keep the desktop shell read-only: resource inventory, topology, relations, Events, and Pod logs.
- Keep upload/mock mode available without a server.
- Explore desktop-only CM/SSH server connection profiles with multiple sessions in a VS Code Remote SSH style session list.
- The web app must not expose SSH.
- Treat existing local sidecar/API paths as prototype-only scaffolds, not the desktop product default.

## Scaffold

The current scaffold lives in `desktop/src-tauri` and points at the existing `website` app:

- dev URL: `http://127.0.0.1:5174/kuviewer/`
- production frontend dist: `../../website/dist`
- capability: `desktop-readonly`
- bundle output: disabled while desktop downloads are de-scoped
- bundle icons: `desktop/src-tauri/icons`

Install desktop dependencies only when actively working on the desktop shell prototype:

```bash
cd desktop
npm install
npm run tauri:dev
```

Build prerequisites and icon source policy are tracked in [BUILD_PREREQUISITES.md](BUILD_PREREQUISITES.md). Certificates, private keys, kubeconfigs, admin tokens, cloud credentials, Secret values, Events, and logs must never be committed.

## Security Defaults

- Do not ask users to paste kubeconfigs into the browser UI.
- Do not persist kubeconfigs, admin tokens, cloud credentials, private keys, Secret values, Events, or logs in the desktop shell.
- Do not add operational actions such as exec, port-forward, restart, scale, delete, apply, or edit.
- Treat prototype remote API and local sidecar settings as scaffold-only UI state outside the desktop product default.
- The desktop CM/SSH session manager keeps imported host private keys in the OS credential store and exposes only safe session metadata plus connection check results to the UI.

## CM/SSH Session Manager

The current desktop prototype UI is a CM/SSH session manager. It is desktop-only and the web app must not expose SSH.

The implementation supports multiple sessions with safe metadata fields only:

- `name`
- `host`
- `port`
- `user`
- remote API host and port, defaulting to `127.0.0.1:18085`
- `description`
- status, runtime status, selection, updated timestamp, credential availability, credential store label, and last connection check status/message

The Tauri bridge exposes safe session commands: `desktop_cm_sessions`, `desktop_save_cm_session`, `desktop_select_cm_session`, `desktop_delete_cm_session`, `desktop_import_cm_session_private_key`, `desktop_delete_cm_session_credential`, `desktop_check_cm_session`, `desktop_cm_session_runtime`, `desktop_check_cm_session_runtime`, `desktop_start_cm_session_runtime`, and `desktop_stop_cm_session_runtime`. Private keys are imported from a local file path by Rust and written to macOS Keychain or Windows Credential Manager under the desktop CM/SSH credential service. Private key bodies are never returned to browser JavaScript, localStorage, JSON export, app logs, or repository files. Passwords, passphrases, tokens, kubeconfigs, cloud credentials, Secret values, Events, and logs are not stored or returned.

`desktop_check_cm_session` performs a bounded connection check. If a private key is available it runs an SSH no-op check with a temporary owner-only key file outside the repository and deletes that file after the check. If no private key is available it falls back to TCP/SSH banner reachability. Deleting a CM/SSH session also removes its stored credential when present. The UI receives only coarse statuses such as `reachable`, `unreachable`, or `credential-missing`, plus safe messages.

The CM tunnel/runtime uses the stored private key only inside Rust. On start, Rust writes a temporary owner-only key file outside the repository, launches an SSH local forward from an ephemeral `127.0.0.1` port to the configured remote Kuviewer API host/port, verifies `/healthz`, and returns only a safe localhost profile to the UI. The frontend stores that runtime profile in `sessionStorage` only, switches the source mode to Live Cluster, and still requires the normal admin token. The safe runtime profile includes only session id/name, localhost server URL, remote API host/port, local port, runtime status, start time, health status, last health timestamp/message, and a bounded error message when health fails. `desktop_check_cm_session_runtime` rechecks the SSH child and `/healthz` without returning credentials; if the child is missing or exited it clears the runtime profile, marks the session `runtime-lost`, removes temporary runtime files, and the UI falls back out of stale live mode. The runtime SSH child and temporary key file are removed on stop, start failure, app close, session delete, credential delete, and runtime-lost cleanup. This is tracked as `desktop-cm-runtime-health-details` / CM runtime health/details.

The desktop runtime can seed one metadata fixture for smoke work with `KUVIEWER_DESKTOP_CM_SESSION_HOST` plus optional `KUVIEWER_DESKTOP_CM_SESSION_ID`, `KUVIEWER_DESKTOP_CM_SESSION_NAME`, `KUVIEWER_DESKTOP_CM_SESSION_PORT`, `KUVIEWER_DESKTOP_CM_SESSION_USER`, `KUVIEWER_DESKTOP_CM_SESSION_REMOTE_API_HOST`, `KUVIEWER_DESKTOP_CM_SESSION_REMOTE_API_PORT`, and `KUVIEWER_DESKTOP_CM_SESSION_DESCRIPTION`.

## Prototype-only Remote API Profile / Remote Server Profile

This section records the existing prototype-only remote API path. It is not the primary desktop direction; CM/SSH multiple sessions are the product target, and the web app must not expose SSH.

The desktop shell can store a single remote Kuviewer server URL profile at runtime. The profile is URL-only metadata under browser `localStorage` key `kuviewer_desktop_connection_profile`; it does not store admin tokens, kubeconfigs, cloud credentials, Secret values, Events, or logs.

Changing or clearing the remote server profile clears the current admin token and locks live mode, so the user must enter a token for the selected server again. The admin token continues to use `sessionStorage` only.

The remote server must allow the desktop app origin through `KUVIEWER_CORS_ORIGIN` when the API is not same-origin. The profile accepts `https` server URLs for remote hosts and `http` only for loopback hosts such as `127.0.0.1` or `localhost`; Kubernetes credential handling stays on the server side.

## Validation

Run the desktop spec check from the repository root:

```bash
node scripts/check-desktop-packaging-spec.mjs
```

The check keeps the scaffold honest by verifying the de-scoped desktop download policy, read-only security defaults, Tauri config, Rust manifest, package scripts, icon assets, CM/SSH runtime metadata, and capability permissions.

## Prototype-only Local Sidecar Runtime

The local sidecar path builds the existing Go read-only API server as a localhost-only Tauri sidecar for prototype validation. It is no longer the desktop product default. Tauri still builds the sidecar binary before dev/build runs and registers it as the external binary base name `binaries/kuviewer-sidecar`.

Runtime boundary:

- Generated sidecar binaries are ignored by git.
- Tauri `externalBin` is enabled for `binaries/kuviewer-sidecar`.
- The Rust runtime launches the sidecar only when `KUVIEWER_DESKTOP_ENABLE_PROTOTYPE_SIDECAR=1`; frontend JavaScript still has no shell permission.
- The sidecar binds to `127.0.0.1:18086`.
- A per-launch admin token is generated in memory and exposed to the UI only through the `desktop_sidecar_profile` Tauri command.
- The browser stores that token in `sessionStorage`, not `localStorage`.
- Default sidecar source is `mock` when the prototype sidecar is explicitly enabled.
- `KUVIEWER_DESKTOP_SIDECAR_SOURCE=kubernetes` can opt into the Kubernetes provider when a safe credential source is configured outside the browser.
- `KUVIEWER_DESKTOP_DISABLE_SIDECAR=1` still disables local sidecar startup for prototype testing.
- Browser-side kubeconfig entry remains out of scope.
- Secret values, kubeconfigs, cloud credentials, Events, logs, and admin tokens must not be persisted.
- Operational actions remain out of scope.

Build plan dry-run:

```bash
node scripts/build-desktop-sidecar.mjs --target aarch64-apple-darwin --dry-run
node scripts/build-desktop-sidecar.mjs --list-targets
```

Local binary smoke builds can target a temporary directory so the repository stays clean:

```bash
node scripts/build-desktop-sidecar.mjs --target aarch64-apple-darwin --out-dir /tmp/kuviewer-sidecar-smoke
```

The old remote server profile and local sidecar switch panel are hidden from the current product UI. They remain in source only as prototype scaffolding while the CM/SSH session manager takes over the desktop path.

## Prototype-only Keychain Credential Design

The direct-cluster desktop path is documented in [KEYCHAIN_CREDENTIAL_DESIGN.md](KEYCHAIN_CREDENTIAL_DESIGN.md). It keeps Kubernetes credentials out of browser JavaScript and stores secret material only in macOS Keychain or Windows Credential Manager.

The first runtime scope is bearer-token Kubernetes profiles. Rust reads the selected OS credential, creates a private runtime temp token file, passes `KUVIEWER_KUBE_TOKEN_FILE` to the localhost sidecar, and deletes that temp file on sidecar stop or restart. Browser `localStorage` remains safe profile metadata only, and operational actions remain out of scope.

The current runtime prototype exposes safe metadata through `desktop_kubernetes_profiles` and `desktop_select_kubernetes_profile`, but `DesktopKubernetesProfilePanel` is hidden from the current product UI. It can also delete stored native credentials with `desktop_delete_kubernetes_profile_credential`. Local smoke tests can provide metadata only with `KUVIEWER_DESKTOP_KUBE_API_SERVER`, optional `KUVIEWER_DESKTOP_KUBE_PROFILE_ID`, and optional `KUVIEWER_DESKTOP_KUBE_PROFILE_NAME`.

For native secret import smoke, Rust can read a local token file and write it to macOS Keychain or Windows Credential Manager when `KUVIEWER_DESKTOP_KUBE_TOKEN_FILE` and `KUVIEWER_DESKTOP_KUBE_IMPORT_TOKEN_FILE=1` are set before startup. The token file content is never sent to browser JavaScript; the UI sees only safe metadata such as `credentialAvailable`.

Selecting a profile with a stored credential restarts the local sidecar with `KUVIEWER_SOURCE=kubernetes`, `KUVIEWER_KUBE_API_SERVER`, and `KUVIEWER_KUBE_TOKEN_FILE`. The returned profile status becomes `sidecar-kubernetes-active`, and the UI switches to live mode using only the sidecar URL/source descriptor plus the per-launch sidecar admin token in `sessionStorage`. Runtime token files follow `0600-temp-dir-delete-on-sidecar-stop`: they are written outside the repository and deleted when the sidecar stops or restarts. Deleting the active native credential stops the Kubernetes sidecar, clears the live token, deletes runtime token files, and falls back to the default local sidecar. Bearer tokens, kubeconfig bodies, private keys, cloud credentials, and Secret values must not be passed through browser state.

`scripts/smoke-desktop-cm-sessions.mjs` is the active CI desktop smoke. It verifies CM/SSH session save/select/delete, private-key import command flow, connection check, CM tunnel/runtime start/stop, runtime health recheck, runtime-lost cleanup, sessionStorage-only runtime profile cleanup, confirms the web runtime does not expose SSH session UI, and checks that old sidecar/keychain panels are hidden. `scripts/smoke-desktop-keychain-runtime.mjs` remains as a historical prototype smoke helper.

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
