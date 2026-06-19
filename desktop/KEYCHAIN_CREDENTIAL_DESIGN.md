# Desktop Keychain Credential Design

This document defines the first credential boundary for a future installable Kuviewer desktop app that connects directly to a Kubernetes API server through the local sidecar.

The current implementation does not store Kubernetes credentials yet. This design is the guardrail for that future runtime work.

## Goals

- Keep Kubernetes credentials out of browser JavaScript.
- Store secret credential material only in the operating system credential store.
- Keep the local sidecar read-only and localhost-only.
- Support a first runtime scope of bearer-token Kubernetes profiles.
- Preserve upload/mock and remote server profile modes.
- Keep Secret values, kubeconfigs, cloud credentials, private keys, Events, and logs out of repository files and browser storage.

## Non-Goals

- No exec, shell, port-forward, restart, scale, delete, apply, or edit actions.
- No browser-side kubeconfig paste/import flow.
- No storage of kubeconfig YAML in `localStorage`, IndexedDB, exported JSON, team saved views, logs, or resource snapshots.
- No raw Secret values or Kubernetes Secret `data` / `stringData` exposure.
- No cloud login flow, OIDC refresh flow, client certificate key import, or exec-provider support in the first credential runtime.

## Storage Model

The desktop UI may store only safe profile metadata in browser `localStorage`:

- profile id
- display name
- Kubernetes API server host
- selected context/cluster/user names when safe to display
- last selected profile id

Secret material must stay in the OS credential store:

- macOS: Keychain generic password item under service `com.kuviewer.desktop.kubernetes`
- Windows: Credential Manager generic credential under target prefix `KuviewerDesktop/Kubernetes/`

The browser must never receive bearer tokens, kubeconfig bodies, client keys, or cloud credentials. Frontend JavaScript receives only safe metadata and sidecar connection status.

## Import Flow

Credential import must be native-side only:

1. The Tauri/Rust layer opens a native file picker or native credential entry dialog.
2. Rust reads and parses kubeconfig content.
3. Rust extracts the selected profile fields and validates that the first runtime scope is bearer-token compatible.
4. Rust stores secret material in the OS credential store.
5. Rust returns only safe profile metadata to the UI.

If the kubeconfig requires unsupported auth, the UI should show an unsupported-auth warning without storing the file content.

## Runtime Flow

When the user selects a keychain-backed Kubernetes profile:

1. Rust reads the selected credential from the OS credential store.
2. Rust creates a private runtime temp directory.
3. Rust writes the bearer token to a temp token file with owner-only permissions (`0600` on Unix-like platforms).
4. Rust writes a CA bundle file only when needed.
5. Rust starts the sidecar with:
   - `KUVIEWER_SOURCE=kubernetes`
   - `KUVIEWER_KUBE_API_SERVER=<safe api server URL>`
   - `KUVIEWER_KUBE_TOKEN_FILE=<runtime temp token file>`
   - `KUVIEWER_KUBE_CA_FILE=<runtime temp ca file>` when needed
6. Rust does not pass Kubernetes bearer tokens through browser state or saved app profile metadata.
7. Rust deletes runtime temp files when the sidecar exits or the app closes.

Desktop runtime code should avoid `KUVIEWER_KUBE_BEARER_TOKEN` for keychain-backed profiles because process environment values are easier to inspect than private temp files.

## Security Rules

- Browser `localStorage` remains URL/profile metadata only.
- Admin token remains per-launch and `sessionStorage` only.
- Keychain/Credential Manager entries are never committed, exported, synced, or logged.
- Runtime temp files are generated outside the repository and removed on shutdown.
- Sidecar binds only to loopback.
- RBAC remains read-only.
- Secret values remain hidden.
- Operational actions remain out of scope.

## First Runtime Scope

The first implementation should accept:

- Kubernetes API server URL
- bearer token
- optional CA bundle
- optional insecure-skip flag only when explicitly accepted by the user

The following should remain future work:

- client certificate/private key auth
- cloud provider login helpers
- OIDC refresh token storage
- exec-provider auth
- multi-cluster switching without sidecar restart

## Validation Expectations

The repository check should verify:

- the packaging spec references this document
- the browser profile module does not handle kubeconfig content
- desktop docs mention macOS Keychain and Windows Credential Manager
- keychain-backed runtime uses token file handoff rather than browser token persistence
- generated credentials, temp files, kubeconfigs, private keys, Secret values, Events, and logs are not committed

