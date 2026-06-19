# Desktop Keychain Credential Design

This document defines the first credential boundary for a future installable Kuviewer desktop app that connects directly to a Kubernetes API server through the local sidecar.

The current implementation includes a safe runtime metadata prototype plus native OS credential store helpers. It can expose desktop Kubernetes profile metadata through native Tauri commands and can store/delete bearer-token material in macOS Keychain or Windows Credential Manager without returning the token to browser JavaScript. Selecting a profile with a stored credential restarts the local sidecar in Kubernetes mode through a runtime token file.

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

The current runtime token file policy is `0600-temp-dir-delete-on-sidecar-stop`: Rust creates a private temp directory, writes the token file with owner-only permissions where supported, and deletes that file when the sidecar stops, restarts, or the app closes.

## Runtime Metadata Prototype

The current desktop shell exposes only safe profile metadata through native Tauri commands:

- `desktop_kubernetes_profiles`: returns profile id, display name, API server URL, auth type, credential store label, selected state, and status.
- `desktop_select_kubernetes_profile`: marks a known metadata profile as selected and returns the same safe metadata shape.
- `desktop_delete_kubernetes_profile_credential`: deletes the native credential for a known profile id and returns updated safe metadata.

For local smoke testing, Rust may create one metadata-only profile from these safe environment variables:

- `KUVIEWER_DESKTOP_KUBE_API_SERVER`
- `KUVIEWER_DESKTOP_KUBE_PROFILE_ID`
- `KUVIEWER_DESKTOP_KUBE_PROFILE_NAME`

Those variables must not contain bearer tokens, kubeconfig content, client keys, cloud credentials, or Secret values. The prototype labels this fixture as `runtime-env-metadata-fixture` until a native credential is present.

## OS Credential Store Runtime

The desktop runtime can import a bearer token from a local token file into the OS credential store when all of these are set before app startup:

- `KUVIEWER_DESKTOP_KUBE_API_SERVER`
- `KUVIEWER_DESKTOP_KUBE_TOKEN_FILE`
- `KUVIEWER_DESKTOP_KUBE_IMPORT_TOKEN_FILE=1`

Optional metadata remains `KUVIEWER_DESKTOP_KUBE_PROFILE_ID` and `KUVIEWER_DESKTOP_KUBE_PROFILE_NAME`. The token file path is read only by Rust, capped at 64 KiB, trimmed, and then stored natively. The browser receives only `credentialAvailable: true`, `credentialStore`, and safe status text. It never receives the token, token file content, kubeconfig body, client key, cloud credential, or Secret value.

Current native backing:

- macOS: Security.framework generic password item under service `com.kuviewer.desktop.kubernetes`.
- Windows: Credential Manager generic credential under target `com.kuviewer.desktop.kubernetes/{profileId}`.

Deleting a credential through `desktop_delete_kubernetes_profile_credential` removes only the native secret material and leaves safe profile metadata in memory for the current desktop session.

## Sidecar Runtime Integration

When `desktop_select_kubernetes_profile` selects a profile whose native credential is available, Rust reads the token from the OS store, writes a runtime temp token file, stops the current sidecar, and starts a new localhost sidecar with `KUVIEWER_SOURCE=kubernetes`, `KUVIEWER_KUBE_API_SERVER`, and `KUVIEWER_KUBE_TOKEN_FILE`. The returned metadata status becomes `sidecar-kubernetes-active`.

The UI then re-reads `desktop_sidecar_profile`, stores only the per-launch admin token in `sessionStorage`, switches to live mode, and keeps the Kubernetes token out of browser state. If the native credential is deleted while active, Rust stops the Kubernetes sidecar, cleans the runtime token file, and falls back to the default local sidecar profile.

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

The first implementation accepts:

- Kubernetes API server URL
- bearer token

The following should remain future work:

- optional CA bundle
- optional insecure-skip flag only when explicitly accepted by the user
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
- native OS credential store helpers exist for write, read-check, and delete without returning secrets to the browser
- selected keychain profiles restart the sidecar with `KUVIEWER_KUBE_TOKEN_FILE`
- generated credentials, temp files, kubeconfigs, private keys, Secret values, Events, and logs are not committed
