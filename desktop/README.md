# Kuviewer Desktop Packaging Spike

This folder tracks the installable read-only desktop cluster explorer goal.

The recommended packaging path is Tauri first, with Electron kept as a fallback if the desktop shell needs browser APIs or extension behavior that Tauri cannot cover cleanly. The first installable targets are macOS `.dmg` and Windows `.exe`.

## Scope

- Reuse the existing React/Vite UI and Go read-only API.
- Keep the desktop app read-only: resource inventory, topology, relations, Events, and Pod logs.
- Keep upload/mock mode available without a server.
- Start with remote API connection to an existing Kuviewer server.
- Launch a local Go sidecar from the Tauri runtime for localhost-only read-only API access.

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

- Node.js/npm and Rust/Cargo are required for local Tauri builds.
- macOS `.dmg` builds need Xcode Command Line Tools on macOS.
- Windows `.exe` builds need a Windows host or CI runner for the NSIS target.
- Desktop icons are generated from the transparent YAML Flow PNG and committed under `desktop/src-tauri/icons`.
- Signing is secret-gated in the manual desktop package workflow; unsigned builds are the default.
- Certificates, private keys, kubeconfigs, admin tokens, cloud credentials, Secret values, Events, and logs must never be committed.

## Security Defaults

- Do not ask users to paste kubeconfigs into the browser UI.
- Do not persist kubeconfigs, admin tokens, cloud credentials, private keys, Secret values, Events, or logs in the app bundle.
- Do not add operational actions such as exec, port-forward, restart, scale, delete, apply, or edit in the packaging spike.
- Treat desktop connection settings as URL-only UI profile state until a dedicated keychain-backed design is implemented.

## Remote Server Profile

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
- signed macOS `.dmg` build with Apple Developer ID certificate import and Apple notarization credentials when `signed` is enabled
- signed Windows NSIS `.exe` build with CurrentUser certificate-store import when `signed` is enabled

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

## Local Sidecar Runtime

The local sidecar path bundles the existing Go read-only API server as a localhost-only Tauri sidecar for users who want a desktop app that can inspect a connected cluster without a separate hosted Kuviewer server. Tauri builds the sidecar binary before dev/build packaging and registers it as the external binary base name `binaries/kuviewer-sidecar`.

Runtime boundary:

- Generated sidecar binaries are ignored by git.
- Tauri `externalBin` is enabled for `binaries/kuviewer-sidecar`.
- The Rust runtime launches the sidecar; frontend JavaScript still has no shell permission.
- The sidecar binds to `127.0.0.1:18086`.
- A per-launch admin token is generated in memory and exposed to the UI only through the `desktop_sidecar_profile` Tauri command.
- The browser stores that token in `sessionStorage`, not `localStorage`.
- Default sidecar source is `mock` so unsigned package smoke runs do not require cluster credentials.
- `KUVIEWER_DESKTOP_SIDECAR_SOURCE=kubernetes` can opt into the Kubernetes provider when a safe credential source is configured outside the browser.
- `KUVIEWER_DESKTOP_DISABLE_SIDECAR=1` disables local sidecar startup for remote-only testing.
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

Remote server profile remains available. If the user has already selected a different remote server URL, the desktop app does not overwrite that profile with the sidecar URL; clearing the remote profile allows the local sidecar profile to take over on the next launch.

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
