# Desktop Build Prerequisites

Kuviewer desktop code is currently a Tauri-based local shell prototype for read-only CM/SSH session exploration.

No desktop installer download path is active. The repository does not publish desktop installer files, desktop release assets, or a public desktop download workflow. Local desktop work should be treated as prototype validation only.

## Required Tools

- Node.js and npm for the existing `website` Vite build and the `desktop` package scripts.
- Go for compiling the bundled Kuviewer read-only API sidecar during Tauri runs.
- Rust and Cargo for compiling the Tauri shell.

The repository check does not install these tools. It verifies that the packaging spec stays aligned with the scaffold:

```bash
node scripts/check-desktop-packaging-spec.mjs
```

## Local Build Shape

Install desktop dependencies only when actively working on the desktop shell prototype:

```bash
cd desktop
npm install
npm run tauri:dev
```

The Tauri config builds the existing `website` app and the Go sidecar binary before dev/build runs. Bundle output is disabled while desktop downloads are de-scoped. The desktop shell remains read-only and must not request browser-side kube credentials.

The future desktop-local idea is a CM/SSH session manager with multiple sessions, similar to VS Code Remote SSH. The current implementation stores safe session metadata, imports private keys only through the Rust layer into the OS credential store, performs bounded connection checks, and starts a CM tunnel/runtime with a temporary owner-only key file outside the repository. Runtime start opens an SSH tunnel to the configured remote Kuviewer API host/port, verifies `/healthz`, and returns only a localhost profile stored in `sessionStorage`; runtime health/details include only safe localhost/remote endpoint metadata, health status, last health timestamp/message, bounded error text, and safe diagnostic stage/severity/message/hint metadata. Manual health recheck marks unhealthy or lost runtimes without exposing credentials, and runtime-lost cleanup clears stale live mode. Admin token authentication remains unchanged. The web app must not expose SSH. Existing local sidecar/API paths remain prototype-only scaffolds for validation and are not the desktop product default.

Desktop CM session export/import is limited to safe editable metadata and exists only in the desktop CM/SSH session manager UI. Export/import JSON never carries private key bodies, OS credential payloads, runtime profiles, diagnostic history, admin tokens, kubeconfigs, cloud credentials, Secret values, Events, or logs. Desktop CM connection profile polish is UI-only: quick API presets, selected-session refill, safe endpoint preview, session clone draft, and pre-save metadata validation do not create new browser storage or change the export/import JSON shape. Session clone drafts require explicit save, use a conflict-safe `copy` suffix, and copy only safe editable metadata; credential payloads, credential availability, runtime profiles, selected state, and diagnostic history are excluded. Desktop CM diagnostic filtering is also desktop-only UI state; active stage/severity filter values are not exported. Desktop CM diagnostic saved filters persist only safe stage/severity preset metadata under `kuviewer_desktop_cm_diagnostic_filter_presets` and never carry session search text, session data, credentials, runtime profiles, diagnostic history, or export/import payloads. Desktop CM session bulk actions keep bulk selection in browser memory only; selected safe-metadata export, group move, favorite set/unset, and inline two-step delete do not add Tauri payload fields or change the session export/import schema. Desktop CM session saved layouts persist only safe layout preference metadata under `kuviewer_desktop_cm_session_layout_presets`: preset name, session id/group/favorite/collapsed group view preferences, and preset update time. Saved layout preset rename updates only the preset name and timestamp, preserves the stored layout preferences, rejects duplicate names, and keeps rename draft/error state in browser memory only. Saved layout preset duplicate creates a collision-safe `copy` preset from the same safe layout preferences without changing session export/import, layout export/import, or Tauri schemas. Saved session layout import/export uses a separate `kuviewer.desktop.cmSessionLayouts` JSON bundle, imports new presets, prunes unknown session ids, and shows a memory-only layout conflict preview for same-name/different-layout imports before any overwrite. Same-name presets are changed only after incoming, keep current, or rename incoming is explicitly selected, and layout import/export never stores search text, diagnostic filters, endpoint/session metadata, credentials, runtime profiles, diagnostics history, Events, logs, Tauri payloads, or CM session export/import payloads.

Desktop CM saved session layout per-row conflict actions resolve one conflict row at a time inside that same memory-only preview. The unresolved rows stay visible, the last resolved row closes the preview, and only safe layout preference metadata is changed.

Desktop CM saved layout preset bulk management keeps selection and delete confirmation in browser memory only, supports visible-result selection, selected layout export, and inline two-step selected delete, and never changes CM session export/import, layout export/import, or Tauri schemas.

Desktop CM saved layout preset folder polish stores only safe preset folder metadata with each saved layout, normalizes missing folders to `General`, preserves folder metadata in layout import/export, and keeps folder collapse state in a separate UI preference that is never exported/imported or sent through Tauri.

Desktop CM saved layout preset folder bulk move is desktop-only UI state. It moves selected saved layout presets to a target folder from the bulk toolbar, keeps the selection and folder draft in browser memory, and writes only safe preset folder metadata to `kuviewer_desktop_cm_session_layout_presets`. It does not change CM session export/import, layout import/export schema, Tauri commands, credentials, runtime profiles, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder filter is desktop-only UI state. It filters saved layout presets to one existing folder, combines with layout search, and keeps the active filter in browser memory only. It is not persisted, exported/imported, sent through Tauri, or mixed with credentials, runtime profiles, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder actions are desktop-only UI controls. They select visible presets in a folder or rename a folder by updating only safe preset folder metadata. Action drafts and selection state stay in browser memory and are not persisted, exported/imported, sent through Tauri, or mixed with credentials, runtime profiles, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder keyboard polish is desktop-only UI state. Folder-list shortcuts move an active folder, toggle collapse, select visible presets, start rename, or clear active state. Active folder state, shortcut state, and rename drafts remain browser memory only; explicit rename writes only safe preset folder metadata.

Desktop CM saved layout preset folder accessibility polish is desktop-only UI metadata. Folder rows expose labelled list/listitem semantics, active descendant, safe count/action descriptions, toggle controls, action labels, rename editor labels, and collapsed/expanded live status without adding visible keyboard instruction text or changing export/import/Tauri/session data.

Desktop CM saved layout preset folder empty-state polish is desktop-only UI state. It distinguishes initial no-layout, search empty, folder-filter empty, and selected-folder zero-visible-preset states with safe search/folder context only. It does not persist empty-state state, change export/import/Tauri schemas, or mix with credentials, runtime profiles, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder drag/reorder polish is desktop-only UI state. Folder rows and preset chips can be reordered with drag handles or up/down controls when layout search and folder filter are clear. Reorder persists only the existing saved layout preset array order and does not add an `order` field, storage key, export/import field, Tauri payload, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder drag/reorder keyboard polish is desktop-only UI state. Folder-list focus can reorder the active folder with `Shift+ArrowUp`, `Shift+ArrowDown`, `Shift+Home`, and `Shift+End`; focused folder and preset drag handles can reorder with `ArrowUp`, `ArrowDown`, `Home`, and `End`. Reorder keyboard status is screen-reader live text and memory-only. The persisted change is still only the existing saved layout preset array order, with no `order` field, storage key, export/import field, Tauri payload, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder focus polish is desktop-only UI state. Folder-list shortcut reorder restores focus to the folder list, and folder/preset button or handle reorder restores focus to the moved item's drag handle. Focus target/status are memory-only, use `preventScroll`, and do not add storage, export/import fields, Tauri payload fields, credential data, runtime profiles, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder focus accessibility polish is desktop-only UI metadata. Folder list and drag handles expose a focus restoration description, the focus live status is an atomic `status` region, and announcements use human-readable folder/preset/list labels instead of internal test ids. Focus labels/status remain memory-only and do not add storage, export/import fields, Tauri payload fields, credential data, runtime profiles, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder disabled-state polish is desktop-only derived UI metadata. Disabled reorder controls expose safe reason text for active layout search, folder filter, first/last edge position, and insufficient folders/presets through titles and `aria-describedby`. Disabled reasons remain memory-only and do not add storage, export/import fields, Tauri payload fields, credential data, runtime profiles, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status wording polish is desktop-only UI text. Reorder status messages use stable `Reorder ready`, `Reorder unavailable`, `Reorder unchanged`, `Reorder complete`, and `Focus restored` prefixes; successful keyboard moves include final position counts and drag/drop moves announce the before-target relation. Status wording remains memory-only and does not add storage, export/import fields, Tauri payload fields, credential data, runtime profiles, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history polish is desktop-only UI state. The panel keeps the latest five reorder/focus status messages in browser memory, displays them newest-first with a latest summary, and provides a clear action. Status history adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history filter polish is desktop-only UI state. The panel filters reorder history by safe scope and status prefix, shows matched/total counts and an empty state, and includes a filter clear action. Filter state stays in browser memory and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp polish is desktop-only UI state. The panel shows relative age, exact local timestamp, ISO `dateTime`, and timestamp title/aria labels for reorder history rows, plus age on the latest summary. Timestamp display state stays in browser memory and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp accessibility polish is desktop-only UI state. The panel exposes timestamp history as a labelled region with hidden assistive help, atomic live summary text, newest-first list labeling, and row aria labels with safe scope/message/timestamp metadata. Accessibility display state stays in browser memory and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp responsive polish is desktop-only UI layout state. The panel keeps desktop timestamp history rows dense while narrow widths wrap filters, actions, latest summary text, status messages, and timestamp metadata without adding horizontal overflow. Responsive display state stays in browser memory and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp density polish is desktop-only UI state. The panel provides comfortable and compact row density for timestamp history; compact mode reduces row padding, timestamp chip height, and timestamp font size without changing exact timestamp metadata or accessibility labels. Density state stays in browser memory and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset polish is desktop-only UI state. The panel provides quick presets for all entries, completed reorders, focus restoration, and blocked reorder states; presets apply safe scope/status filters and density together without persisting preset state. Filter preset state stays in browser memory and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset accessibility polish is desktop-only UI state. The panel links the filter preset group to hidden help and an atomic live active-preset summary, and each preset button exposes a safe scope/status/density label. Accessibility preset state stays in browser memory and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset keyboard polish is desktop-only UI state. The panel provides one roving tab stop for filter presets, Arrow/Home/End focus movement, Enter/Space activation, hidden keyboard help, and live focus status. Keyboard preset state stays in browser memory and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset shortcut hint polish is desktop-only UI state. The panel adds hidden shortcut hint text, `aria-keyshortcuts`, and safe button titles for the preset shortcuts without adding static visible shortcut copy. Shortcut hint metadata stays in browser memory/rendered DOM and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset discoverability smoke polish is desktop-only UI state. The panel adds a compact visible help icon with safe title/aria text for the same Arrow/Home/End/Enter/Space shortcuts and smoke coverage for visibility, group description linkage, and no saved layout persistence. Discoverability hint metadata stays in browser memory/rendered DOM and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help focus polish is desktop-only UI state. The visible help icon is a focusable button with Enter/Space shortcut metadata; focusing it announces the action, and activating it moves focus to the active reorder history preset or the first preset fallback. Help focus state stays in browser memory/rendered DOM and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip placement polish is desktop-only UI state. The visible help button includes a compact hover/focus tooltip linked with `aria-describedby`, viewport-clamped bottom inline placement, and a small anchored arrow with safe shortcut and focus-action text. Help tooltip placement metadata stays in browser memory/rendered DOM and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip contrast polish is desktop-only UI state. The tooltip uses high-contrast safe color tokens for text, surface, border, shadow, and arrow, and the desktop smoke checks rendered text/background contrast at a 7:1 minimum. Help tooltip contrast metadata stays in browser memory/rendered DOM and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip contrast accessibility polish is desktop-only UI metadata. The help button and preset group reference a hidden contrast note that names the 7:1 minimum and UI-only policy, while the tooltip exposes the same minimum ratio as safe rendered metadata. Help tooltip contrast accessibility metadata stays in browser memory/rendered DOM and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip focus-visible polish is desktop-only UI metadata. The help button uses a high-contrast keyboard focus ring with safe outline, ring, and offset tokens so keyboard users can see the tooltip entry point clearly. Help tooltip focus-visible metadata stays in browser memory/rendered DOM and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip focus-visible accessibility polish is desktop-only UI metadata. The help button and preset group reference a hidden focus-visible note that describes the high-contrast outline, ring, and offset policy for keyboard users without adding visible instruction text. Help tooltip focus-visible accessibility metadata stays in browser memory/rendered DOM and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip focus-visible keyboard smoke polish is desktop-only verification metadata. The desktop smoke tabs from the density controls to the help button and verifies the `:focus-visible` outline, ring, tooltip visibility, and safe live status without adding visible instruction text. Help tooltip focus-visible keyboard smoke metadata stays in rendered DOM/test state and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip focus-visible visual polish is desktop-only UI metadata. The help button uses a solid focus-visible visual token that changes background, border, icon color, shadow, and scale so the keyboard focus target is visually distinct from hover and idle states. Help tooltip focus-visible visual metadata stays in rendered DOM/test state and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip focus-visible visual regression polish is desktop-only verification metadata. The help button exposes stable visual-regression marker/state/token attributes, and the desktop smoke compares idle, hover, and keyboard focus-visible rendered styles so regressions in color, shadow, scale, tooltip visibility, or storage leakage are caught. Help tooltip focus-visible visual regression metadata stays in rendered DOM/test state and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip focus-visible visual regression screenshot polish is desktop-only verification metadata. The desktop smoke captures a focused help button plus tooltip PNG clip under the smoke artifact directory, validates the PNG signature, byte size, and clipped dimensions, and treats the image as disposable test output only. Help tooltip focus-visible visual regression screenshot metadata stays in rendered DOM/test artifacts and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip focus-visible visual regression screenshot cleanup polish is desktop-only verification metadata. Before capture, the desktop smoke removes only its known focused-help PNG filename from the smoke output directory so stale screenshots cannot satisfy the check, then verifies the path is empty before writing a fresh PNG. Screenshot cleanup state stays in rendered DOM/test artifacts and adds no storage key, order field, export/import field, Tauri payload field, credential data, runtime profile, diagnostic history, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip focus-visible visual regression screenshot metadata polish is desktop-only verification metadata. The desktop smoke writes a same-directory JSON sidecar with safe artifact facts only: schema/kind, file name, visual marker/token, capture timestamp, PNG byte length, dimensions, and clip dimensions. The sidecar deliberately excludes URLs, tokens, credentials, kubeconfigs, Secret values, runtime profiles, diagnostics, Events, and logs, and remains disposable test output only.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip focus-visible visual regression screenshot metadata cleanup polish keeps those disposable artifacts from accumulating. After the desktop smoke verifies the focused-help PNG and safe sidecar, it removes both known filenames and verifies they no longer exist. The cleanup never scans arbitrary directories and does not change storage, export/import, Tauri payloads, credentials, runtime profiles, diagnostics, Events, or logs.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip focus-visible visual regression screenshot artifact directory hygiene polish verifies the smoke output directory itself stays tidy. The desktop smoke writes a known sentinel file before screenshot cleanup, proves screenshot cleanup preserves that unrelated sentinel, then explicitly removes the sentinel and verifies the directory has no remaining files. This checks scoped cleanup behavior without storing app data or deleting arbitrary paths.

Desktop CM saved layout preset folder reorder status history timestamp filter preset help tooltip focus-visible visual regression screenshot artifact manifest polish adds a disposable manifest for that smoke artifact set. The manifest lists only known file names, media types, roles, transient cleanup policy, and safe PNG dimensions/byte length for the focused-help screenshot. It does not include URLs, credentials, kubeconfigs, Secret values, runtime profiles, diagnostics, Events, logs, or raw app data, and hygiene cleanup removes it before the smoke exits.

The old remote server profile UX is prototype-only. It stores only the selected Kuviewer server URL in browser `localStorage`; admin tokens remain session-only, and profile changes clear the current token. The current CM/SSH session manager clears that legacy profile in desktop runtime and keeps it out of the product UI.

## Local Sidecar Runtime

The Go API server is still built as a desktop sidecar binary for prototype validation. It is no longer launched by default in the desktop product path. Generated sidecar binaries live under `desktop/src-tauri/binaries` by default and are ignored by git.

Dry-run the build plan:

```bash
node scripts/build-desktop-sidecar.mjs --target aarch64-apple-darwin --dry-run
node scripts/build-desktop-sidecar.mjs --list-targets
```

Build to a temporary directory for local smoke testing:

```bash
node scripts/build-desktop-sidecar.mjs --target aarch64-apple-darwin --out-dir /tmp/kuviewer-sidecar-smoke
```

When explicitly enabled with `KUVIEWER_DESKTOP_ENABLE_PROTOTYPE_SIDECAR=1`, the sidecar binds to `127.0.0.1:18086` and receives a per-launch admin token generated in memory by the Tauri runtime. Frontend JavaScript still does not receive shell permissions.

Default sidecar source is `mock` when the prototype sidecar is enabled. Use `KUVIEWER_DESKTOP_SIDECAR_SOURCE=kubernetes` only when the local environment has a safe Kubernetes credential source configured outside the browser. Use `KUVIEWER_DESKTOP_DISABLE_SIDECAR=1` for prototype testing. Do not commit generated sidecar binaries, kubeconfigs, admin tokens, Secret values, Events, or logs.

The old local-sidecar switch action is hidden from the current CM/SSH session manager UI.

## Keychain Credential Design

Direct desktop-to-cluster credentials are specified in [KEYCHAIN_CREDENTIAL_DESIGN.md](KEYCHAIN_CREDENTIAL_DESIGN.md). The design requires macOS Keychain and Windows Credential Manager for secret material, while browser `localStorage` may hold only safe profile ids/display metadata.

The first runtime implementation supports bearer-token profiles through `KUVIEWER_KUBE_TOKEN_FILE`, not browser-side kubeconfig import. Runtime token temp files must be outside the repository, owner-only where supported, and deleted when the sidecar stops.

The current prototype adds safe metadata commands `desktop_kubernetes_profiles` and `desktop_select_kubernetes_profile`, plus `desktop_delete_kubernetes_profile_credential` for native credential removal. That prototype UI is hidden from the current CM/SSH session manager product path. For metadata smoke testing, use `KUVIEWER_DESKTOP_KUBE_API_SERVER`, optional `KUVIEWER_DESKTOP_KUBE_PROFILE_ID`, and optional `KUVIEWER_DESKTOP_KUBE_PROFILE_NAME` as metadata-only inputs. Do not put bearer tokens, kubeconfig YAML, private keys, cloud credentials, or Secret values in those variables.

For native OS store smoke, set `KUVIEWER_DESKTOP_KUBE_TOKEN_FILE` to a local token file path and `KUVIEWER_DESKTOP_KUBE_IMPORT_TOKEN_FILE=1` before startup. Rust reads the file, writes the token to macOS Keychain or Windows Credential Manager, and returns only safe metadata such as `credentialAvailable` to the UI. Keep token files outside the repository and delete local smoke files afterward.

Selecting a stored profile restarts the local sidecar with `KUVIEWER_SOURCE=kubernetes`, `KUVIEWER_KUBE_API_SERVER`, and `KUVIEWER_KUBE_TOKEN_FILE`, then returns `sidecar-kubernetes-active` metadata to the UI. Runtime token files use `0600-temp-dir-delete-on-sidecar-stop`, so they should be outside the repository and cleaned on sidecar stop/restart.

The active automated desktop runtime smoke uses a stubbed Tauri bridge rather than a real OS credential store. After building the frontend and starting preview, run:

```bash
node scripts/smoke-desktop-cm-sessions.mjs --url http://127.0.0.1:4174/kuviewer/
```

The smoke verifies CM/SSH session save/select, safe metadata clone drafts, safe metadata export/import, desktop CM session bulk selection/actions, desktop CM session saved layouts, desktop CM session layout preset rename, desktop CM session layout preset duplicate, desktop CM session layout folder filter/actions/empty state/drag reorder/drag reorder keyboard/reorder focus/reorder focus accessibility/reorder disabled-state/reorder status wording/reorder status history/reorder status history filter/reorder status history timestamp/reorder status history timestamp accessibility/reorder status history timestamp responsive/reorder status history timestamp density/reorder status history timestamp filter preset/filter preset discoverability/filter preset help focus/filter preset help tooltip/help tooltip placement/help tooltip contrast/help tooltip contrast accessibility/help tooltip focus-visible/help tooltip focus-visible accessibility/help tooltip focus-visible keyboard smoke/help tooltip focus-visible visual polish/help tooltip focus-visible visual regression polish/help tooltip focus-visible visual regression screenshot polish/help tooltip focus-visible visual regression screenshot cleanup polish/help tooltip focus-visible visual regression screenshot metadata polish/help tooltip focus-visible visual regression screenshot metadata cleanup polish/help tooltip focus-visible visual regression screenshot artifact directory hygiene polish/help tooltip focus-visible visual regression screenshot artifact manifest polish, desktop CM session layout import/export, layout conflict preview actions, per-row conflict actions, private-key import command flow, connection check command flow, CM tunnel/runtime start/stop, runtime health recheck, runtime-lost cleanup, safe diagnostic UI/search, desktop CM diagnostic filtering, desktop CM diagnostic saved filters, sessionStorage-only runtime profile cleanup, credential deletion, and session deletion through a stubbed Tauri bridge. It confirms the web runtime does not expose SSH session UI, checks that no admin token or legacy API profile is stored, and verifies private key bodies are not captured by browser state.

The historical `scripts/smoke-desktop-keychain-runtime.mjs` helper remains available for prototype-only keychain runtime checks outside the current product UI.

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

## Safety Policy

- Do not commit certificates, private key material, kubeconfigs, admin tokens, cloud credentials, Secret values, Events, logs, generated sidecar binaries, or temp credential files.
- Keep browser-side SSH unavailable.
- Keep desktop runtime secrets in native Rust/OS credential boundaries only.
- Keep operational Kubernetes actions out of scope.
