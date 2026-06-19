# Kuviewer Desktop Packaging Spike

This folder tracks the installable read-only desktop cluster explorer goal.

The recommended packaging path is Tauri first, with Electron kept as a fallback if the desktop shell needs browser APIs or extension behavior that Tauri cannot cover cleanly. The first installable targets are macOS `.dmg` and Windows `.exe`.

## Scope

- Reuse the existing React/Vite UI and Go read-only API.
- Keep the desktop app read-only: resource inventory, topology, relations, Events, and Pod logs.
- Keep upload/mock mode available without a server.
- Start with remote API connection to an existing Kuviewer server.
- Evaluate a local Go sidecar only after the shell scaffold is stable.

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
- Treat desktop connection settings as UI/session state until a dedicated keychain-backed design is implemented.

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
- signing secret validation only when the `signed` input is enabled

The workflow references secret names only. Certificate files, private keys, passwords, kubeconfigs, admin tokens, cloud credentials, Secret values, Events, and logs must remain outside the repository.

## Verified Dry Run

The first unsigned macOS package dry-run completed on 2026-06-19 through GitHub Actions run `27800527207`.

- workflow: `desktop-package`
- ref: `main`
- commit: `d525971d7415a6053eb8f45d92f5a3573654e3cd`
- output: `Kuviewer_0.1.0_aarch64.dmg`
- uploaded artifact: `kuviewer-macos-dmg`
- uploaded artifact size: `7,125,256` bytes
- signing: disabled

The dry-run record is also stored in [packaging-spec.json](packaging-spec.json). The artifact is an unsigned build for packaging validation, not a public signed release.
