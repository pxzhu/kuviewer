# Desktop Prototype Build Prerequisites

The desktop shell is a local prototype. Building it is optional for normal web/server development.

## Required Tools

- Node.js matching the website toolchain
- Rust stable toolchain with Cargo
- Platform Tauri prerequisites

macOS development requires Xcode command-line tools. Windows development requires the supported Visual Studio C++ build tools and WebView2 runtime.

## Checks

```bash
node scripts/check-desktop-packaging-spec.mjs
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --check
cargo check --locked --manifest-path desktop/src-tauri/Cargo.toml
```

## Security Requirements

- Do not put private keys, tokens, kubeconfigs, cloud credentials, Secret values, or raw SSH stderr in build output.
- The web app must not expose SSH or Desktop CM controls.
- Desktop session/layout export contains safe metadata only.
- Local sidecar and direct Kubernetes API profile commands are not part of the desktop prototype.
- No public installer or downloadable desktop release asset is produced by the current project workflow.
