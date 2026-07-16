# Kuviewer Desktop Prototype

This directory contains a local Tauri prototype for read-only CM/SSH multiple-session exploration. It is not the primary Kuviewer product and no public installer/download path is active.

## Boundary

- Web Kuviewer must not expose SSH or desktop CM controls.
- Desktop CM/SSH is local-prototype-only.
- Operations remain read-only: no exec, port-forward, restart, scale, delete, apply, or edit.
- Private keys stay in the OS credential store and are never returned to browser JavaScript.
- Token, kubeconfig, cloud credential, Secret value, raw SSH stderr, Events, and logs are excluded from session/layout exports.

## Prototype Capabilities

- Multiple CM session metadata profiles
- OS credential-store import/delete
- SSH connection checks with safe diagnostics
- Local tunnel/runtime health metadata
- Safe session import/export
- Diagnostic filters and saved filter preferences
- Session groups, favorites, bulk actions, and saved layouts

Safe local preferences may contain session ids, group/folder names, favorites, collapsed state, and timestamps. Active selections, search, credentials, runtime details, and diagnostics history remain memory-only unless the documented safe metadata model explicitly says otherwise.

## Development

```bash
node scripts/check-desktop-packaging-spec.mjs
node scripts/build-desktop-sidecar.mjs --dry-run
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```

Run the desktop shell only for explicit prototype work. The local sidecar is not enabled by default in the web product path.

## Structure

- `src-tauri/`: Rust/Tauri commands and runtime management
- `src-tauri/icons/`: generated desktop icons
- `packaging-spec.json`: concise machine-readable prototype contract
- `BUILD_PREREQUISITES.md`: local toolchain and verification requirements

Generated `desktop/src-tauri/binaries` content is temporary and must not be committed.
