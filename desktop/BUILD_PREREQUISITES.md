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

The Tauri config builds the existing `website` app before packaging. The desktop shell remains read-only and must not request browser-side kube credentials.

Remote server profile UX is runtime-only. It stores only the selected Kuviewer server URL in browser `localStorage`; admin tokens remain session-only, and profile changes clear the current token. Remote hosts should use `https`; plain `http` is limited to loopback development servers. Remote servers that are not same-origin must set `KUVIEWER_CORS_ORIGIN` for the desktop app origin.

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

Future signing should use local keychains or CI secrets:

- macOS: Apple Developer ID certificate and notarization credentials.
- Windows: Windows code-signing certificate on a Windows runner or from CI secrets.

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
