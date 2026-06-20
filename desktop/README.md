# Kuviewer Desktop Packaging Spike

This folder tracks the installable read-only desktop CM/SSH session explorer goal.

The recommended packaging path is Tauri first, with Electron kept as a fallback if the desktop shell needs browser APIs or extension behavior that Tauri cannot cover cleanly. The first installable targets are macOS `.dmg` and Windows `.exe`.

## Scope

- Reuse the existing React/Vite UI and Go read-only API.
- Keep the desktop app read-only: resource inventory, topology, relations, Events, and Pod logs.
- Keep upload/mock mode available without a server.
- Make the product direction desktop-only CM/SSH server connection profiles.
- Support multiple sessions in a VS Code Remote SSH style session list.
- The web app must not expose SSH.
- Treat existing local sidecar/API paths as prototype-only scaffolds, not the desktop product default.

## Scaffold

The current scaffold lives in `desktop/src-tauri` and points at the existing `website` app:

- dev URL: `http://127.0.0.1:5174/kuviewer/`
- production frontend dist: `../../website/dist`
- bundle targets: `dmg` and `nsis`
- bundle icons: `desktop/src-tauri/icons`
- capability: `desktop-readonly`

Install desktop dependencies only when actively working on desktop packaging:

```bash
cd desktop
npm install
npm run tauri:dev
```

The first real installer build should happen through the manual `desktop-package` workflow or a local packaging task after dependency install and platform prerequisites are available.

Build prerequisites, icon source policy, and signing boundaries are tracked in [BUILD_PREREQUISITES.md](BUILD_PREREQUISITES.md). The short version is:

- Node.js/npm, Go, and Rust/Cargo are required for local Tauri builds.
- macOS `.dmg` builds need Xcode Command Line Tools on macOS.
- Windows `.exe` builds need a Windows host or CI runner for the NSIS target.
- Desktop icons are generated from the transparent YAML Flow PNG and committed under `desktop/src-tauri/icons`.
- Signing is secret-gated in the manual desktop package workflow; unsigned builds are the default.
- Certificates, private keys, kubeconfigs, admin tokens, cloud credentials, Secret values, Events, and logs must never be committed.

## Security Defaults

- Do not ask users to paste kubeconfigs into the browser UI.
- Do not persist kubeconfigs, admin tokens, cloud credentials, private keys, Secret values, Events, or logs in the app bundle.
- Do not add operational actions such as exec, port-forward, restart, scale, delete, apply, or edit in the packaging spike.
- Treat prototype remote API and local sidecar settings as scaffold-only UI state outside the desktop product default.
- The desktop CM/SSH session manager keeps imported host private keys in the OS credential store and exposes only safe session metadata plus connection check results to the UI.

## CM/SSH Session Manager

The current desktop product UI is a CM/SSH session manager. It is desktop-only and the web app must not expose SSH.

The current implementation supports multiple sessions with safe metadata fields only:

- `name`
- `host`
- `port`
- `user`
- remote API host and port, defaulting to `127.0.0.1:18085`
- `description`
- status, runtime status, selection, updated timestamp, credential availability, credential store label, and last connection check status/message

The Tauri bridge exposes safe session commands: `desktop_cm_sessions`, `desktop_save_cm_session`, `desktop_select_cm_session`, `desktop_delete_cm_session`, `desktop_import_cm_session_private_key`, `desktop_delete_cm_session_credential`, `desktop_check_cm_session`, `desktop_cm_session_runtime`, `desktop_check_cm_session_runtime`, `desktop_start_cm_session_runtime`, and `desktop_stop_cm_session_runtime`. Private keys are imported from a local file path by Rust and written to macOS Keychain or Windows Credential Manager under the desktop CM/SSH credential service. Private key bodies are never returned to browser JavaScript, localStorage, JSON export, app logs, or repository files. Passwords, passphrases, tokens, kubeconfigs, cloud credentials, Secret values, Events, and logs are not stored or returned.

`desktop_check_cm_session` performs a bounded connection check. If a private key is available it runs an SSH no-op check with a temporary owner-only key file outside the repository and deletes that file after the check. If no private key is available it falls back to TCP/SSH banner reachability. Deleting a CM/SSH session also removes its stored credential when present. The UI receives only coarse statuses such as `reachable`, `unreachable`, or `credential-missing`, plus safe messages.

The CM tunnel/runtime uses the stored private key only inside Rust. On start, Rust writes a temporary owner-only key file outside the repository, launches `ssh -N -L 127.0.0.1:{ephemeral-port}:{remoteApiHost}:{remoteApiPort}`, verifies `/healthz` through the tunnel, and returns only a safe localhost profile to the UI. The frontend stores that runtime profile in `sessionStorage` only, switches the source mode to Live Cluster, and still requires the normal admin token. The safe runtime profile includes only session id/name, localhost server URL, remote API host/port, local port, runtime status, start time, health status, last health timestamp/message, and a bounded error message when health fails. `desktop_check_cm_session_runtime` rechecks the SSH child and `/healthz` without returning credentials; if the child is missing or exited it clears the runtime profile, marks the session `runtime-lost`, removes temporary runtime files, and the UI falls back out of stale live mode. The runtime SSH child and temporary key file are removed on stop, start failure, app close, session delete, credential delete, and runtime-lost cleanup. This is tracked as `desktop-cm-runtime-health-details` / CM runtime health/details.

The desktop runtime can seed one metadata fixture for smoke work with `KUVIEWER_DESKTOP_CM_SESSION_HOST` plus optional `KUVIEWER_DESKTOP_CM_SESSION_ID`, `KUVIEWER_DESKTOP_CM_SESSION_NAME`, `KUVIEWER_DESKTOP_CM_SESSION_PORT`, `KUVIEWER_DESKTOP_CM_SESSION_USER`, `KUVIEWER_DESKTOP_CM_SESSION_REMOTE_API_HOST`, `KUVIEWER_DESKTOP_CM_SESSION_REMOTE_API_PORT`, and `KUVIEWER_DESKTOP_CM_SESSION_DESCRIPTION`.

## Prototype-only Remote API Profile

This section records the existing prototype-only remote API path. It is not the primary installable desktop direction; CM/SSH multiple sessions are the product target, and the web app must not expose SSH.

The desktop shell can store a single remote Kuviewer server URL profile at runtime. The profile is URL-only metadata under browser `localStorage` key `kuviewer_desktop_connection_profile`; it does not store admin tokens, kubeconfigs, cloud credentials, Secret values, Events, or logs.

Changing or clearing the remote server profile clears the current admin token and locks live mode, so the user must enter a token for the selected server again. The admin token continues to use `sessionStorage` only.

The remote server must allow the desktop app origin through `KUVIEWER_CORS_ORIGIN` when the API is not same-origin. The profile accepts `https` server URLs for remote hosts and `http` only for loopback hosts such as `127.0.0.1` or `localhost`; Kubernetes credential handling stays on the server side.

## Release Versioning

Desktop source files keep `0.1.0` as the checked-in fallback version until a desktop package release is intentionally cut. The manual `desktop-package` workflow resolves the package version at build time and updates only the CI workspace before Tauri builds installers.

Resolution order:

1. workflow `package_version` input
2. `KUVIEWER_DESKTOP_VERSION`
3. `GITHUB_REF_NAME` with a leading `v` stripped
4. fallback `0.1.0`

The resolved version is written consistently to `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, and `desktop/src-tauri/Cargo.toml` for that package build. Uploaded workflow artifacts include the version in their artifact names, for example `kuviewer-macos-dmg-0.1.76` and `kuviewer-windows-exe-0.1.76`; generated installer filenames still follow Tauri platform conventions.

Local version checks can be run from the repository root:

```bash
node scripts/set-desktop-package-version.mjs --version 0.1.0 --check
node scripts/set-desktop-package-version.mjs --version 0.1.76 --dry-run
```

Do not commit accidental local version bumps unless the repository is intentionally moving to a new desktop package baseline.

## Validation

Run the packaging spec check from the repository root:

```bash
node scripts/check-desktop-packaging-spec.mjs
```

The check keeps the scaffold honest by verifying the target artifacts, read-only security defaults, Tauri config, Rust manifest, package scripts, and capability permissions.

## Manual Package Workflow

GitHub Actions includes a `desktop-package` workflow for installer experiments:

- manual `workflow_dispatch` only
- unsigned macOS `.dmg` build by default
- optional Windows `.exe` build
- `smoke_matrix` input for one-dispatch unsigned macOS `.dmg` and Windows `.exe` package smoke
- signed macOS `.dmg` build with Apple Developer ID certificate import and Apple notarization credentials when `signed` is enabled
- signed Windows NSIS `.exe` build with CurrentUser certificate-store import when `signed` is enabled

The `smoke_matrix` input is unsigned-only and cannot be combined with `signed`. It uploads package outputs as GitHub Actions artifact records for validation only; it does not publish release assets.

The workflow references secret names only. Certificate files, private keys, passwords, kubeconfigs, admin tokens, cloud credentials, Secret values, Events, and logs must remain outside the repository.

## Signing And Notarization

Signed desktop package builds remain manual and secret-gated. Leave `signed` disabled for unsigned smoke builds.

Required macOS secrets:

- `APPLE_CERTIFICATE_BASE64`: base64-encoded Developer ID `.p12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

When `signed` is enabled, the macOS job imports the `.p12` into a temporary GitHub runner keychain, configures the CI workspace Tauri config with the signing identity, runs the Tauri DMG build with Apple notarization environment variables, and deletes the temporary keychain afterward.

Required Windows secrets:

- `WINDOWS_CERTIFICATE_BASE64`: base64-encoded PFX
- `WINDOWS_CERTIFICATE_PASSWORD`

When `signed` is enabled, the Windows job imports the PFX into `Cert:\CurrentUser\My`, writes the imported certificate thumbprint into the CI workspace Tauri config, runs the Tauri NSIS build, and removes the certificate from the runner store afterward. `WINDOWS_TIMESTAMP_URL` can be set as a repository variable; if omitted, the workflow uses `http://timestamp.digicert.com`.

The helper script is intentionally CI-workspace only:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Example" node scripts/configure-desktop-signing.mjs --macos --dry-run
WINDOWS_CERTIFICATE_THUMBPRINT=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA node scripts/configure-desktop-signing.mjs --windows --dry-run
```

## Prototype-only Local Sidecar Runtime

The local sidecar path bundles the existing Go read-only API server as a localhost-only Tauri sidecar for prototype validation. It is no longer the desktop product default. Tauri still builds the sidecar binary before dev/build packaging and registers it as the external binary base name `binaries/kuviewer-sidecar`.

Runtime boundary:

- Generated sidecar binaries are ignored by git.
- Tauri `externalBin` is enabled for `binaries/kuviewer-sidecar`.
- The Rust runtime launches the sidecar only when `KUVIEWER_DESKTOP_ENABLE_PROTOTYPE_SIDECAR=1`; frontend JavaScript still has no shell permission.
- The sidecar binds to `127.0.0.1:18086`.
- A per-launch admin token is generated in memory and exposed to the UI only through the `desktop_sidecar_profile` Tauri command.
- The browser stores that token in `sessionStorage`, not `localStorage`.
- Default sidecar source is `mock` when the prototype sidecar is explicitly enabled, so unsigned package smoke runs do not require cluster credentials.
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

## Verified Dry Runs

The first unsigned macOS package dry-run completed on 2026-06-19 through GitHub Actions run `27800527207`.

- workflow: `desktop-package`
- ref: `main`
- commit: `d525971d7415a6053eb8f45d92f5a3573654e3cd`
- output: `Kuviewer_0.1.0_aarch64.dmg`
- uploaded artifact: `kuviewer-macos-dmg`
- uploaded artifact size: `7,125,256` bytes
- signing: disabled

The first unsigned Windows package dry-run completed on 2026-06-19 through GitHub Actions run `27803179419`.

- workflow: `desktop-package`
- ref: `main`
- commit: `b754c549ee2a2766c7f2d32257e4ee66a426aeb2`
- output: `Kuviewer_0.1.0_x64-setup.exe`
- uploaded artifact: `kuviewer-windows-exe`
- uploaded artifact size: `5,777,828` bytes
- signing: disabled

The dry-run records are also stored in [packaging-spec.json](packaging-spec.json). These artifacts are unsigned builds for packaging validation, not public signed releases.
