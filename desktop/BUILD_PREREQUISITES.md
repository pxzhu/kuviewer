# Desktop Prototype Build Prerequisites

The desktop shell is a local prototype. Building it is optional for normal web/server development.

## Required Tools

- Node.js matching the website toolchain
- Go for the local sidecar binary
- Rust stable toolchain with Cargo
- Platform Tauri prerequisites

macOS development requires Xcode command-line tools. Windows development requires the supported Visual Studio C++ build tools and WebView2 runtime.

## Checks

```bash
node scripts/check-desktop-packaging-spec.mjs
node scripts/build-desktop-sidecar.mjs --dry-run
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```

The sidecar builder writes generated binaries to `desktop/src-tauri/binaries`. Remove that directory after verification.

## Security Requirements

- Do not put private keys, tokens, kubeconfigs, cloud credentials, Secret values, or raw SSH stderr in build output.
- The web app must not expose SSH or Desktop CM controls.
- Desktop session/layout export contains safe metadata only.
- No public installer or downloadable desktop release asset is produced by the current project workflow.
