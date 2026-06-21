# Kuviewer

Kuviewer is a Kubernetes topology viewer focused on visualizing clusters, namespaces, nodes, workloads, pods, services, ConfigMaps, Secrets, and storage relationships in a web UI.

## Current direction

- First target: native Kubernetes
- Later validation: k3s, AKS, and other Kubernetes-compatible distributions
- Initial auth model: no user accounts; live connector uses a single admin token
- Primary data sources: browser-side YAML/JSON/ZIP upload, live Kubernetes API, and bundled mock data
- Upload mode is SaaS-friendly: manifests are parsed in the browser and are not sent to a backend by the frontend
- Future desktop-local idea: read-only CM/SSH session exploration can stay as a prototype, but it is not a downloadable product path
- Frontend: React, TypeScript, Vite, Tailwind CSS

## Current UI

- Source modes: `Upload YAML`, `Live Cluster`, and `Mock Demo`
- `Topology`: draggable React Flow resource relationship map with cluster and namespace zones
- `Flow`: YAML-derived traffic flow view
- `Resource Explorer`: read-only Kubernetes resource list, safe YAML/detail preview, topology relations, and live Events
- Purpose-built YAML Flow link preview, transparent favicon, and apple-touch icon assets for shared links and bookmarks
- Brand theme toggle: `D` YAML Flow is the default UI theme, while `B` Radar can be selected as a dark app theme without changing shared-link metadata
- Manual refresh, optional 30 second auto refresh, and last sync status for live mode
- Backend provider/status line for source, read-only mode, Secret handling, and static UI mode
- Connector diagnostics panel for backend source, API errors, sync time, and visible/total graph counts
- YAML/ZIP upload, topology JSON import/export, and Secret value hiding for uploaded manifests
- Flow evidence rows show source/target resources, YAML field paths, and observed/inferred confidence
- Broken Flow cards show routed Services with no visible backend Pod endpoints
- Flow filtering keeps the full path context while matching flows by the currently visible resources
- Empty filter results clear the detail panel instead of showing a stale resource
- Responsive graph stage keeps zoom/pan/drag inside the topology canvas and stores manual node positions per source
- Touch devices use an SVG topology renderer with pinch, wheel/trackpad, drag pan, zoom buttons, fit, and reset while keeping React Flow unmounted for mobile stability

## Desktop Local Prototype

Kuviewer keeps a desktop-local CM/SSH session prototype for future exploration, documented in [desktop/README.md](desktop/README.md), with a machine-checked spec in [desktop/packaging-spec.json](desktop/packaging-spec.json) and build notes in [desktop/BUILD_PREREQUISITES.md](desktop/BUILD_PREREQUISITES.md).

No desktop installer download path is active. Kuviewer does not publish desktop installer files, desktop release assets, or a public desktop download workflow. The current product path remains the web app plus the standalone server deployment. The desktop idea is limited to a read-only local shell prototype for CM/SSH session management, closer to VS Code Remote SSH than a browser feature.

The web app must not expose SSH. The prototype direction keeps CM/SSH multiple sessions as the desktop-local model. Existing local sidecar/API paths are prototype-only scaffolds and are not the desktop product default. Desktop icons are generated from the transparent YAML Flow PNG asset, committed under `desktop/src-tauri/icons`, and checked by the desktop spec validator.

The current desktop product UI includes a desktop-only CM/SSH session manager. It manages multiple safe metadata sessions with `name`, `host`, `port`, `user`, remote API host/port, status, description, credential availability, runtime status, last connection check result, and safe diagnostic metadata through Tauri commands: `desktop_cm_sessions`, `desktop_save_cm_session`, `desktop_select_cm_session`, `desktop_delete_cm_session`, `desktop_import_cm_session_private_key`, `desktop_delete_cm_session_credential`, `desktop_check_cm_session`, `desktop_cm_session_runtime`, `desktop_check_cm_session_runtime`, `desktop_start_cm_session_runtime`, and `desktop_stop_cm_session_runtime`. The session form is polished as desktop-only UI: it previews the safe endpoint tuple, offers quick remote API presets, can refill from the selected session, validates required metadata/ports before save, and can create a session clone draft from an existing session without adding browser persistence. Session clone drafts require an explicit save, use a conflict-safe `copy` suffix, and copy only safe editable metadata; credentials, credential availability, runtime profiles, selected state, and diagnostic history are not cloned. The session list can be searched in memory by safe metadata and diagnostic stage/message/hint only, and desktop CM diagnostic filtering can narrow the list by displayed diagnostic stage and severity without persisting the active filter state. Desktop CM diagnostic saved filters store only user-named stage/severity presets under `kuviewer_desktop_cm_diagnostic_filter_presets` as a desktop-only UI preference; they do not include session search text, session data, credentials, runtime profiles, diagnostic history, or export/import payloads. Desktop CM session grouping/favorites stores only session id, group, favorite, updatedAt, and collapsed group UI state under `kuviewer_desktop_cm_session_view_preferences`; it is not included in Tauri command payloads or session export/import JSON. Desktop CM session bulk actions add memory-only bulk selection for visible results/group rows, selected safe-metadata export, group move, favorite set/unset, and inline two-step selected delete; bulk selection itself is not persisted, exported, synced, or sent through Tauri commands. Desktop CM session saved layouts store only named layout preference metadata under `kuviewer_desktop_cm_session_layout_presets`: `name`, current session view preferences (`sessionId`, `group`, `favorite`, `updatedAt`, `collapsedGroups`), and preset `updatedAt`. The saved layout list can be searched in memory by preset name, summary, group, collapsed group, favorite count, and session count; that search query only filters the visible list and is not persisted or exported. Saved layout preset names can be renamed inline; rename draft/error state is memory-only, same-name saves are no-ops, duplicate names are rejected, and existing layout preferences are preserved. Saved layout presets can also be duplicated inline; the copy uses a collision-safe `copy` suffix, preserves the same safe layout preferences, and does not change session export/import, layout export/import, or Tauri schemas. Saved session layouts can be exported/imported separately with `kuviewer.desktop.cmSessionLayouts`; import adds new presets, skips invalid entries, prunes unknown session ids, and uses a layout conflict preview for same-name/different-layout imports. Conflict preview state is memory-only and same-name presets are not overwritten until the user explicitly chooses incoming, keep current, or rename incoming. Saved session layout import/export does not include search text, diagnostic filters, endpoint/session metadata, credentials, runtime profiles, diagnostics history, Events, logs, Tauri payloads, or the CM session export/import JSON. The selected-session summary shows credential, runtime, health, last-check status, and compact advanced diagnostics. Private keys can be imported only by the desktop Rust layer into the OS credential store and are never returned to browser JavaScript, app logs, JSON export, or repository files. Starting a CM tunnel/runtime writes a temporary owner-only key file outside the repository, opens an SSH tunnel from an ephemeral `127.0.0.1` port to the configured remote Kuviewer API host/port, verifies `/healthz`, and stores only the localhost runtime profile in `sessionStorage`. Runtime health/details are exposed as safe metadata only: localhost URL, remote API host/port, status, last health timestamp, safe health message, diagnostic stage, severity, message, and hint. A manual health recheck keeps the runtime profile fresh, and if the SSH child is gone or unhealthy the UI marks the session `runtime-lost` or `runtime-unhealthy`, clears the stale runtime profile when needed, and falls back out of live mode without storing secrets. The admin token remains session-only and the tunnel does not bypass live API authentication. No password, token, kubeconfig, cloud credential, Secret value, Event, log, raw SSH stderr, or private key body is stored.

Desktop CM session export/import is desktop-only and user-click driven. Export downloads `{ "schemaVersion": 1, "kind": "kuviewer.desktop.cmSessions", "items": [...] }` with only safe editable metadata: `name`, `host`, `port`, `user`, `remoteApiHost`, `remoteApiPort`, and optional `description`. Import accepts that bundle shape, `{ items }`, or a plain array, caps processing at 50 valid sessions, updates matching endpoint tuples, and skips invalid or duplicate entries. Export/import never includes private key bodies, OS credential payloads, credential availability as proof, runtime profiles, diagnostic history, admin tokens, kubeconfigs, cloud credentials, Secret values, Events, or logs.

Desktop CM saved session layout per-row conflict actions are desktop-only UI controls inside the memory-only layout conflict preview. They resolve one same-name layout conflict at a time with incoming, keep current, or rename incoming actions, leave remaining conflicts visible, and update only safe layout preference metadata. The conflict preview also supports keyboard active-row navigation and resolution: ArrowUp/ArrowDown, Home/End, Enter for incoming, K for keep current, R for rename incoming, and Escape to clear the active row. The active row state is browser memory only, ignores editable controls, and is not persisted, exported, synced, or sent through Tauri commands. The preview focuses itself when conflicts open, exposes labelled/described regions, safe row and action labels, `aria-current` active row state, and a screen-reader live summary without adding visible keyboard instruction text. The conflict preview also shows memory-only summary counts for total, resolved, remaining, incoming/current/rename resolutions, and import results; those summary counters are not persisted or exported.

Desktop CM saved layout bulk management is desktop-only UI state. Selection and delete confirmation are memory-only, visible-result selection follows the current layout search filter, selected export uses the existing `kuviewer.desktop.cmSessionLayouts` bundle shape, and selected delete uses inline two-step confirmation without storing endpoint/session metadata, credentials, runtime profiles, diagnostic history, Events, or logs.

Desktop CM saved layout folder polish stores only safe preset folder metadata in `kuviewer_desktop_cm_session_layout_presets`. Missing folders normalize to `General`; users can set a folder while saving a layout or edit a row folder inline, and the layout list renders by folder with separate collapse state under `kuviewer_desktop_cm_session_layout_collapsed_folders`. Folder metadata is preserved in layout import/export, but folder collapse state is UI-only and is not included in session export/import, layout export/import, Tauri payloads, credentials, runtime profiles, diagnostics, Events, or logs.

Desktop CM saved layout folder bulk move is desktop-only UI state. The bulk toolbar can move selected saved layout presets to a target folder while preserving the current selection and search query. The folder draft and selection state stay in browser memory; only the safe preset `folder` metadata is written to `kuviewer_desktop_cm_session_layout_presets`. This does not change session export/import, layout import/export schema, Tauri payloads, credentials, runtime profiles, diagnostics, Events, or logs.

Desktop CM saved layout folder filter is desktop-only UI state. The saved layout list can be narrowed to an existing folder, combines that folder filter with the layout search query, and uses filtered results for visible bulk selection. The active folder filter is kept in browser memory only and is not written to localStorage, sessionStorage, export/import JSON, Tauri payloads, credentials, runtime profiles, diagnostics, Events, or logs.

Desktop CM saved layout folder actions are desktop-only UI controls on each saved layout folder header. Users can select the currently visible presets in a folder or rename a folder, which moves every preset in that folder to the normalized target folder by updating only safe preset `folder` metadata. Folder action drafts and selections stay in browser memory; the feature does not change session export/import, layout export/import schema, Tauri payloads, credentials, runtime profiles, diagnostics, Events, or logs.

Desktop CM saved layout folder keyboard polish is desktop-only UI state. When the saved layout folder list has focus, ArrowUp/ArrowDown, Home/End, Enter, S, R, and Escape move the active folder, toggle collapse, select visible presets, start folder rename, or clear the active state. Active folder state, shortcut state, and rename drafts remain browser-memory only; only explicit folder rename writes safe preset `folder` metadata to `kuviewer_desktop_cm_session_layout_presets`.

Desktop CM saved layout folder accessibility polish is desktop-only UI metadata. The saved layout folder list exposes a labelled list, active descendant, listitem rows, row count/action descriptions, toggle `aria-controls`, explicit folder action labels, rename editor group labels, and screen-reader live status that includes collapsed/expanded state. These accessibility fields do not add visible keyboard instruction text and do not change saved layout data, export/import JSON, Tauri payloads, credentials, runtime profiles, diagnostics, Events, or logs.

Desktop CM saved layout folder empty-state polish is desktop-only UI state. The saved layout area distinguishes no saved layouts, search-only empty results, folder-filter empty results, and selected-folder rows with zero visible presets while keeping safe search/folder context visible. Empty-state text and counts stay in browser memory only and do not change saved layout data, export/import JSON, Tauri payloads, credentials, runtime profiles, diagnostics, Events, or logs.

Desktop CM saved layout folder drag/reorder polish is desktop-only UI state. Folder headers and layout presets expose drag handles plus up/down controls, disabled while layout search or folder filter is active. Reorder writes only the existing `kuviewer_desktop_cm_session_layout_presets` array order; it adds no `order` field, no storage key, and no Tauri/export/import schema changes.

Desktop CM saved layout folder drag/reorder keyboard polish is desktop-only UI state. The focused folder list can move the active folder with `Shift+ArrowUp`, `Shift+ArrowDown`, `Shift+Home`, and `Shift+End`; focused folder or layout drag handles can use `ArrowUp`, `ArrowDown`, `Home`, and `End`. Keyboard reorder status is announced through screen-reader live text and stays browser-memory only. It still writes only the existing saved layout preset array order and adds no `order` field, storage key, export/import field, Tauri payload, credentials, runtime profile, diagnostics history, Events, or logs.

Desktop CM saved layout folder reorder focus polish is desktop-only UI state. After folder-list shortcut reorder, focus returns to the folder list; after folder or preset button/handle reorder, focus returns to the stable drag handle for the moved item. Focus target and focus status are browser-memory only, use `preventScroll`, and are not stored, exported, synced, or sent through Tauri.

Existing remote API profile, local sidecar, and direct Kubernetes/keychain paths remain prototype-only scaffolds. The local sidecar no longer starts by default in the desktop product path; it requires `KUVIEWER_DESKTOP_ENABLE_PROTOTYPE_SIDECAR=1` for explicit prototype work. The web app must not expose SSH.

The Flow view is intended to feel closer to real request movement than a generic resource graph. It derives paths such as:

```text
External client -> Ingress -> Service -> Pod -> Node
In-cluster client -> Service -> Pod -> Node
```

The first implementation uses the same topology edge contract as the graph. The real Kubernetes connector should build those edges from fields visible in `kubectl get ... -o yaml`, including Ingress backends, Service selectors, EndpointSlice endpoints, Pod `spec.nodeName`, and Pod ConfigMap/Secret/PVC references.

NetworkPolicy rendering is policy intent, not observed CNI traffic. Kuviewer parses `policyTypes`, `ingress`, `egress`, peers, and ports, then infers `allows-ingress` / `allows-egress` edges from selectors that can be resolved against the loaded Pod and Namespace labels. `matchLabels` and the `In`, `NotIn`, `Exists`, and `DoesNotExist` `matchExpressions` operators are evaluated; `ipBlock` remains summary-only.

## MVP flow

1. Build topology UI, source modes, upload parser, and traffic flow view.
2. Validate resource graph, traffic flow, filters, color modes, node dragging, and detail panel.
3. Add backend API with server-side admin token validation for live mode.
4. Add native Kubernetes read-only connector.
5. Add real sample infrastructure manifest and in-cluster deployment manifests.

## Local frontend

```bash
cd website
npm install
npm run dev
```

Development URL:

```text
http://127.0.0.1:5174
```

Suggested local/admin token:

```text
kuviewer-admin
```

Upload and Mock modes do not require a token. Live Cluster mode stores the entered token in `sessionStorage`, sends it as a `Bearer` token, and lets the server validate it. The local API server defaults to `kuviewer-admin` only when it listens on loopback; public binds such as `0.0.0.0:8080` require `KUVIEWER_ADMIN_TOKEN`.

## Upload mode

The default UI source is `Upload YAML`. It accepts:

- `.yaml` and `.yml` manifests, including multi-document YAML
- Kubernetes `List` JSON/YAML documents
- `.zip` archives containing YAML or JSON manifests
- exported Kuviewer topology JSON from the `Export` button

The parser builds the same topology contract as the live connector. It infers relationships from Kubernetes fields commonly visible in `kubectl get ... -o yaml`, including owner references, Ingress and Gateway route backends, Gateway route parent Gateways, Service selectors, Pod node scheduling, ServiceAccount use, ConfigMap/Secret env references, mounted volumes, PVC/PV bindings, StorageClass references, and safe CustomResource spec references. Secret values are never decoded or displayed; uploaded Secret summaries show type/key count only.

Before uploading, the UI lets you set a browser-local cluster name and cluster id for the bundle. Empty values fall back to `uploaded-bundle`, and the chosen cluster id is used in generated topology JSON exports. Upload diagnostics show skipped files, YAML/JSON parse errors, unsupported Kubernetes kinds, and import validation errors without displaying manifest body content.

## Local API server

The server currently exposes the same topology contract as the frontend mock data.

```bash
cd server
go run ./cmd/kuviewer-server
```

Default loopback server settings:

```text
KUVIEWER_LISTEN_ADDR=127.0.0.1:8080
KUVIEWER_ADMIN_TOKEN=kuviewer-admin
KUVIEWER_CORS_ORIGIN=
KUVIEWER_SOURCE=mock
KUVIEWER_RESOURCE_VIEWS_FILE=
```

Set `KUVIEWER_CORS_ORIGIN=http://127.0.0.1:5174` only when the Vite dev server calls a separately running local API server.

When `KUVIEWER_LISTEN_ADDR` is set to a non-loopback address, `KUVIEWER_ADMIN_TOKEN` must be set explicitly or the server exits before listening.

API endpoints:

```text
GET /healthz
GET /api/status
GET /api/topology
GET /api/resources
GET /api/resource-views
PUT /api/resource-views
GET /api/resources/{kind}/{namespace-or--}/{name}
GET /api/resources/{kind}/{namespace-or--}/{name}/events
GET /api/resources/{kind}/{namespace-or--}/{name}/logs
GET /api/resources/{kind}/{namespace-or--}/{name}/logs/stream
Authorization: Bearer <admin-token>
```

The resource explorer endpoints are read-only. They expose metadata, labels, redacted annotations, age/owner/uid summary, status, safe summary/preview data, safe YAML preview, and topology relations derived from the current snapshot. The YAML preview is generated from Kuviewer safe metadata and summaries, not from raw Kubernetes manifests. Secret values, `data`, and `stringData` are not returned. The resource list supports local keyboard navigation with ArrowUp/ArrowDown, Home/End, and Enter-to-detail focus. It also supports memory-only bulk selection for the current filter results with checkbox selection, Space toggle, Shift+Arrow/Home/End range selection, Ctrl/Cmd+A select all, and Escape clear. User-click copy/export actions are limited to safe inventory fields such as cluster, namespace, kind, name, status, counts, summary keys, and relation count. The detail panel provides a compact scope/age/owner/signals overview, section jump badges, status health signals, and local keyboard navigation for scanning read-only sections without storing resource data.

Resource health signals are computed in the browser from the existing safe status and summary fields. They highlight common read-only causes such as Pod readiness, restarts, workload replica gaps, Service endpoint gaps, Job failures, PVC/PV phase, routing summaries, and NetworkPolicy intent. They do not expose raw manifests or Secret values.

The Resource Explorer detail panel shows a compact resource identity header, active section indicator, open section count, and a section navigator for scanning `Metadata`, `Status`, `Safe Preview`, `YAML Preview`, `Labels`, `Annotations`, `Relations`, `Events`, and `Logs`. Users can jump to a section, expand every detail section, collapse every detail section, or restore the default detail sections (`Metadata`, `Status`, `Safe Preview`, `Relations`, `Events`) without changing resource data. When the detail panel has focus, keyboard shortcuts support `J/K` section navigation, `O` active-section toggle, `E` expand all, `C` collapse all, `R` default sections, and `1-9` direct section jumps; shortcuts are ignored inside editable controls. Safe Preview supports local key/value search with match highlighting and previous/next navigation for the selected resource. Detail section open state, navigator state, keyboard shortcut state, and Safe Preview search state are browser-memory UI state only and are not written to localStorage, URLs, saved views, team saved views, JSON export/import, or backend APIs.

Resource Explorer saved views store only the list filters the user explicitly saves: search text, cluster, namespace, kind, and status, plus the saved view name/group/order metadata. Saved views can be quick-applied from grouped sections, scanned through folder summary/chips with visible folder expand/collapse controls, filtered in-memory by saved view name/group/filter summary, reordered within each group by drag handle or up/down controls when search is clear, bulk-selected for selected-only export/group move/inline-confirm delete, updated by saving with the same name, renamed inline without changing filters, moved between groups, cleared from the current filter controls with the reset button, shared as a filter-only URL, exported as browser-local JSON with scope/timestamp filenames, imported back from array JSON or `{ "items": [...] }` JSON, and explicitly synced with a server-side team saved view collection when Live Cluster mode is unlocked with an admin token. Import/export actions show an in-page summary with filename, valid/skipped counts, folders, and import format, but the summary is not persisted. Resource Explorer filter changes quietly sync into the browser URL with `view=resources` plus optional `source`, `resourceQuery`, `resourceCluster`, `resourceNamespace`, `resourceKind`, and `resourceStatus` query parameters. Default filter values are omitted, invalid cluster/namespace/kind/status values fall back to `all` for the current data source, switching away from Resource Explorer removes the resource filter query, and browser back/forward restores the view, source, and filters. Local saved views use browser `localStorage` key `kuviewer_resource_view_presets`; saved view folder collapse state uses `kuviewer_resource_view_collapsed_groups` as UI preference only. The saved view search text, folder chip state beyond collapse preference, import/export summary, team compare preview, team sync summary, and bulk selection state are UI-only and are not persisted, exported, synced, or encoded in URLs; reorder controls are disabled while saved view search is active so hidden matches cannot be moved accidentally. Team saved views use `GET /api/resource-views` and `PUT /api/resource-views`, both protected by `Authorization: Bearer <admin-token>`, with response shape `{ "items": [...], "metadata": { "version": 0, "updatedAt": 0, "count": 0, "storage": "memory" } }`; PUT requests still send `{ "items": [...] }`, and older file-backed `{ "items": [...] }` payloads remain readable. Team load first shows a local-vs-team compare preview with new, changed, identical, local-only, skipped, max-limit-dropped counts, and server snapshot metadata. Team save first compares the current browser saved views with the server-side team collection and highlights new, changed, identical, server-only views, and the current server snapshot before replacing the team collection. Team load/save then shows an in-page sync summary with count, skipped items, folders, local-before count, conflict/new/duplicate counts, and the resulting snapshot version/update time/count/storage when available. To persist team saved views across server restarts, set `KUVIEWER_RESOURCE_VIEWS_FILE=/path/to/resource-views.json`; when unset, the server keeps them in memory only. Snapshot metadata describes only the saved view collection state and does not include resource data, Events, logs, Secret values, kubeconfigs, cloud credentials, private keys, or admin tokens. Both local and team saved views include only preset fields and do not store those sensitive values. Saved view rename/group/order/bulk edits, JSON import/export, and team sync are triggered by user clicks; local rename/group/order/bulk changes do not automatically write to the team store until the user reviews the compare preview and confirms team save. When imported or team views have the same name as a browser-local view but different filters, group, or order metadata, Kuviewer shows an inline conflict panel instead of silently overwriting; the user can prefer the incoming view, keep the current browser view, or rename the incoming view to keep both. The resource list sort preference stores only `{ field, direction }` under `kuviewer_resource_list_sort`; it is not included in saved view URLs, JSON export/import, or team saved views. The resource list column preference stores only optional column visibility under `kuviewer_resource_list_columns`; `Kind`, `Name`, and `Status` remain always visible and column preferences are not included in saved views or share URLs. The resource list density, resource detail density, and log density toggles store only `comfortable` or `compact` UI preferences under `kuviewer_resource_list_density`, `kuviewer_resource_detail_density`, and `kuviewer_log_density`. The live Events auto refresh toggle stores only `true` or `false` under `kuviewer_events_auto_refresh`, and the live Events warning notification toggle stores only `true` or `false` under `kuviewer_events_warning_notifications`.

The active Resource Explorer filter chips are derived from the current search/cluster/namespace/kind/status controls. Each chip can clear one filter, while `Clear all` uses the same reset behavior as the saved view reset button. The chip UI is not a saved view field and is not written to localStorage, team saved views, JSON export/import, or URLs beyond the existing filter query parameters.

In live Kubernetes mode, `/api/resources/{kind}/{namespace-or--}/{name}/events` reads core v1 Events with an `involvedObject` field selector and returns newest events first. The Resource Explorer fetches Events when a live resource is selected, lets the user manually refresh the selected resource's Events, and can auto refresh the selected resource's Events every 30 seconds when the Events toggle is enabled. Loading and last-refreshed status are shown without storing them. The Resource Explorer can filter the currently displayed Events locally in the browser by text, severity/type, and time range (`all`, `1h`, `6h`, `24h`, `7d`), sort them newest-first or oldest-first, pin important events to the top of the current detail view, export the currently visible Events as browser-local CSV or JSON files after a user click, and group unpinned events by severity/type so Warning/Error style events appear before Normal events. When the in-app warning notification preference is enabled, the initial Events fetch only establishes a baseline; later manual or automatic refreshes show an in-app banner, session-only `NEW` chip, `NEW N` count, optional `NEW only` filter, and `NEW clear` action for newly observed Warning/Error Events. The banner can be dismissed without clearing markers, or the markers can be cleared from the banner or Events header to remove the banner, `NEW` markers, and `NEW only` filter. This does not use browser system notification permissions. Warning counts are surfaced in the detail badges, and Event cards show type, reason, source, absolute timestamp, and relative age for quick scanning. Missing or unparseable timestamps appear only in the `all` time range, sort after timestamped Events, and render as `timestamp unknown`. Event filter text, severity selection, time range, sort order, pinned Events, refresh status, notification state/history, `NEW` markers, `NEW only` filter, exported files, and Event records are not persisted by Kuviewer. If Events are unavailable because of RBAC or API differences, Kuviewer returns an empty event list with a safe warning instead of failing the whole resource detail panel. Upload and mock modes keep returning an empty event list.

In live Kubernetes mode, `/api/resources/Pod/{namespace}/{name}/logs` reads the selected Pod's recent logs with `tailLines=200`. Add `?container=name` to read a specific container or initContainer, and `?previous=true` to read the previous terminated container instance when Kubernetes has one. `/logs/stream` uses the same query shape and follows current Pod logs as newline-delimited JSON; the browser keeps only the latest 500 displayed lines for the active connection. Follow mode can be paused without closing the stream; paused lines stay in a browser-memory pending buffer until the user clicks resume, and the pending buffer is capped at 500 lines. The Resource Explorer can filter the currently displayed log lines locally in the browser, show match count/current position, jump to previous/next matches with buttons or Enter/Shift+Enter, parse timestamp prefixes for display and time range filtering (`all`, `1h`, `6h`, `24h`, `7d`), sort by received/newest/oldest order, switch between comfortable and compact log display density, and copy or download the currently displayed or loaded raw lines when the user clicks the controls. Logs without parseable timestamps remain visible in the `all` range only and sort after timestamped lines in time-based order. Filter text, match position, time range selection, sort order, pause state, pending logs, copied text, downloaded files, and log lines are not persisted by Kuviewer. Downloads are generated as browser-local `.log` files only after a user click. Logs are read-only, fetched only when the user clicks the logs controls, and are not stored by Kuviewer. Kubernetes logs can contain application secrets, so grant `pods/log` only to clusters where this exposure is acceptable. Upload and mock modes show a logs empty state.

The Resource Explorer relation panel groups related resources by direction and edge type, supports local relation search, and can open a related node directly in the topology view. Relation search text is not stored.

Live and upload modes also surface `CustomResourceDefinition` objects as read-only inventory nodes. Kuviewer shows the CRD group, kind, plural name, scope, served versions, and storage version. When a CRD definition is available, Kuviewer can also show matching custom resource instances as `CustomResource` nodes with safe metadata, CRD context, spec/status field counts, condition summaries, and inferred references to existing Services, Secrets, ConfigMaps, ServiceAccounts, or other known CustomResources. It does not expose raw custom resource spec or status values.

To make the frontend read from the API server, create `website/.env.local`:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8080
```

Then restart `npm run dev`.

In production/static builds, the frontend defaults to the same origin API when `VITE_API_BASE_URL` is not set. For example, a page served from `http://127.0.0.1:8080` calls `http://127.0.0.1:8080/api/topology`.

## Kubernetes API source

The first Kubernetes provider is implemented as a read-only snapshot reader using the Kubernetes REST API.

In-cluster mode:

```bash
KUVIEWER_SOURCE=kubernetes \
KUVIEWER_ADMIN_TOKEN=your-ui-token \
go run ./cmd/kuviewer-server
```

When running inside a Pod, Kuviewer reads:

```text
KUBERNETES_SERVICE_HOST
KUBERNETES_SERVICE_PORT
/var/run/secrets/kubernetes.io/serviceaccount/token
/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
```

External API mode:

```bash
KUVIEWER_SOURCE=kubernetes \
KUVIEWER_KUBE_API_SERVER=https://your-api-server:6443 \
KUVIEWER_KUBE_BEARER_TOKEN=your-readonly-token \
KUVIEWER_KUBE_CA_FILE=/path/to/ca.crt \
go run ./cmd/kuviewer-server
```

Supported snapshot resources in the first provider:

- Namespace
- Node
- Pod
- ServiceAccount
- Service
- EndpointSlice
- ConfigMap
- Deployment
- ReplicaSet
- StatefulSet
- DaemonSet
- Job
- CronJob
- HorizontalPodAutoscaler
- Ingress
- Gateway
- HTTPRoute
- GRPCRoute
- TLSRoute
- TCPRoute
- NetworkPolicy
- PersistentVolume
- PersistentVolumeClaim
- StorageClass
- CustomResourceDefinition
- CustomResource instances when the API group/resource is readable
- referenced Secret metadata only
- live core v1 Events for the selected resource detail
- live Pod logs and current-log follow for the selected Pod detail

Secret list/read RBAC is intentionally not granted. Secret nodes are created from Pod references such as `envFrom`, `env.valueFrom`, `volumes.secret`, and `imagePullSecrets`, and values are never displayed. Events, Pod logs, and CustomResourceDefinition read RBAC are granted for read-only resource detail and CRD inventory context. Custom resource instance discovery uses the CRD storage version, falling back to the first served version, and stays optional: RBAC/API failures for a custom resource list do not break the topology. The default Kubernetes manifest does not grant wildcard custom-resource instance access; grant only the specific API groups/resources you want Kuviewer to inventory.

### Real sample infrastructure

Apply [deploy/sample-infra/kuviewer-demo.yaml](deploy/sample-infra/kuviewer-demo.yaml) to create a real Kubernetes topology for UI validation:

```bash
kubectl apply -f deploy/sample-infra/kuviewer-demo.yaml
```

It creates sample namespaces with real Kubernetes objects:

- `kuviewer-demo`: gateway/API/db/node-agent baseline topology
- `kuviewer-commerce`: orders API, queue StatefulSet, Ingress, Secret/ConfigMap references
- `kuviewer-observability`: telemetry Deployment, telemetry-agent DaemonSet, ConfigMap mounts
- Services and EndpointSlices for gateway/API/db/queue/telemetry traffic
- Job, CronJob, HorizontalPodAutoscaler, and NetworkPolicy resources for expanded topology validation
- NetworkPolicy ingress/egress intent examples, including namespaceSelector + podSelector matching
- ConfigMap, Secret reference, ServiceAccount, PVC, PV, and StorageClass relationships

Gateway API resources are optional because they require Gateway API CRDs. Kuviewer supports Gateway, HTTPRoute, GRPCRoute, and optional TLSRoute/TCPRoute when those CRDs are installed. Apply [deploy/sample-infra/gateway-api-demo.yaml](deploy/sample-infra/gateway-api-demo.yaml) only on clusters where Gateway API resources are installed:

```bash
kubectl apply -f deploy/sample-infra/gateway-api-demo.yaml
```

Remove it when done:

```bash
kubectl delete namespace kuviewer-demo kuviewer-commerce kuviewer-observability --ignore-not-found
kubectl delete namespace kuviewer-gateway-demo --ignore-not-found
```

Do not commit real tokens, kubeconfigs, private keys, Kubernetes Secret values, or cloud credentials.

### Kubernetes smoke test from macOS

Use [scripts/smoke-kubernetes-api.sh](scripts/smoke-kubernetes-api.sh) to test the real Kubernetes provider against the current `kubectl` context. The script creates temporary read-only RBAC, starts Kuviewer locally with `KUVIEWER_SOURCE=kubernetes`, verifies `/api/status` and `/api/topology`, then removes the temporary resources.

Dry-run the temporary manifest first:

```bash
KUVIEWER_SMOKE_DRY_RUN=1 scripts/smoke-kubernetes-api.sh
```

Run the actual smoke test:

```bash
scripts/smoke-kubernetes-api.sh
```

Keep the local Kubernetes-backed web UI running after the smoke checks:

```bash
KUVIEWER_SMOKE_HOLD=1 scripts/smoke-kubernetes-api.sh
```

Default local smoke URL and token:

```text
http://127.0.0.1:18083
kuviewer-admin
```

### Visual smoke test

The website includes a Playwright visual smoke script for checking source modes, topology view, node dragging, traffic flow view, and desktop/mobile horizontal overflow.

Install the Chromium browser once if Playwright asks for it:

```bash
cd website
npx playwright install chromium
```

Run against a local Kuviewer server:

```bash
cd website
KUVIEWER_VISUAL_URL=http://127.0.0.1:18084 \
KUVIEWER_ADMIN_TOKEN=kuviewer-admin \
npm run test:visual
```

Run the upload-mode smoke without needing a live Kubernetes API:

```bash
cd website
KUVIEWER_VISUAL_MODE=upload \
KUVIEWER_VISUAL_URL=http://127.0.0.1:18084 \
npm run test:visual
```

Screenshots are written to `website/artifacts/visual-smoke` by default.

Supported visual modes:

```text
KUVIEWER_VISUAL_MODE=live
KUVIEWER_VISUAL_MODE=upload
KUVIEWER_VISUAL_MODE=mock
```

Useful overrides:

```bash
KUVIEWER_ADMIN_TOKEN=your-ui-token \
KUVIEWER_SMOKE_PORT=18084 \
KUVIEWER_SMOKE_HOLD=1 \
scripts/smoke-kubernetes-api.sh
```

## Single-container build

The root [Dockerfile](Dockerfile) builds the React frontend and Go API server into one image. The Docker image defaults to root-path static assets for standalone subdomain deployment.

The final runtime image uses a supported Alpine release and runs as the non-root `kuviewer` user.

```bash
docker build -t kuviewer:local .
docker run --rm -p 127.0.0.1:8080:8080 \
  -e KUVIEWER_ADMIN_TOKEN=kuviewer-admin \
  kuviewer:local
```

Local container URL:

```text
http://127.0.0.1:8080
```

The default container build leaves `VITE_API_BASE_URL` empty, so the public UI starts with Upload and Mock modes and does not automatically call the live API. To intentionally enable same-origin live API mode, rebuild with:

```bash
docker build \
  --build-arg VITE_BASE_PATH=/ \
  --build-arg VITE_API_BASE_URL=/api \
  -t kuviewer:live .
```

For the older `/kuviewer/` subpath preview build, keep using `npm run build` from `website`, or pass `--build-arg VITE_BASE_PATH=/kuviewer/` to Docker.

## Shared 443 subdomain deployment

Kuviewer can run as a separate service while sharing the server's external HTTPS port with the existing website. The host-level gateway routes by the request domain:

```text
www.example.com       -> 127.0.0.1:8080
kuviewer.example.com  -> 127.0.0.1:18085
```

The two services share external `443`, but they use different localhost ports behind the gateway.

Build the standalone image:

```bash
docker build --build-arg VITE_BASE_PATH=/ -t kuviewer:local .
```

Create the runtime env from the example and replace the placeholder admin token before starting:

```bash
cp deploy/standalone/.env.example deploy/standalone/.env
docker compose --env-file deploy/standalone/.env -f deploy/standalone/docker-compose.yml up -d
```

The tracked compose file binds Kuviewer only to localhost:

```text
127.0.0.1:18085 -> container:8080
```

Gateway example:

```caddyfile
www.example.com {
  reverse_proxy 127.0.0.1:8080
}

kuviewer.example.com {
  reverse_proxy 127.0.0.1:18085
}
```

The same example is tracked at [deploy/gateway/Caddyfile.kuviewer.example](deploy/gateway/Caddyfile.kuviewer.example). Replace the example domains with your own DNS names; TLS stays the responsibility of the host-level gateway.

Local checks:

```bash
curl -fsS http://127.0.0.1:18085/healthz
curl -fsS http://127.0.0.1:18085/robots.txt
curl -fsS http://127.0.0.1:18085/sitemap.xml
```

Visual smoke against the standalone service:

```bash
cd website
KUVIEWER_VISUAL_URL=http://127.0.0.1:18085/ npm run test:visual
```

## GitHub Actions deploy

Kuviewer can deploy without a container registry. The workflow in `.github/workflows/deploy.yml` first validates SSH access and remote runtime prerequisites, then builds `kuviewer:local` on the GitHub runner, saves it as a compressed image archive, uploads that archive to the server over SSH/SCP, updates the Git checkout, loads the image with Docker, and runs the standalone compose file.

If GitHub-hosted runners cannot receive an SSH banner from the server network path, `.github/workflows/deploy-self-hosted.yml` provides an SSH-free manual fallback. It requires a GitHub Actions self-hosted runner on the target server or an internal network that can run Docker locally, with runner labels `self-hosted` and `kuviewer-deploy`. This workflow does not use `SERVER_SSH_KEY`, `SERVER_SSH_KNOWN_HOSTS`, `ssh-keyscan`, SSH, or SCP. It checks out the selected ref on the self-hosted runner, builds a candidate `kuviewer` image locally, copies tracked files into `DEPLOY_PATH` with `git archive`, preserves the untracked `deploy/standalone/.env`, runs the standalone compose file, performs the same bounded `/healthz` check, and writes the same safe `$DEPLOY_PATH/.kuviewer/deploy-state.json` metadata. It is `workflow_dispatch` only so it does not race the tag-based SSH deploy path.

Required repository secrets:

```text
SERVER_FHOST
SERVER_FUSER
SERVER_PORT
SERVER_SSH_KEY
```

Optional non-credential SSH pin. A repository variable is preferred because this is public host-key data, not a credential; the workflow also accepts a secret with the same name for compatibility:

```text
SERVER_SSH_KNOWN_HOSTS
```

Deploy SSH preflight uses the same required secrets and does not require a registry or extra credential. It validates the SSH port range, checks TCP reachability to the SSH endpoint, verifies that an SSH banner is received before host key scanning, pins the SSH host key with `StrictHostKeyChecking=yes`, checks remote `git`, `curl`, `gzip`, Docker/Compose availability, verifies `DEPLOY_PATH` and `/tmp` writability, and confirms `deploy/standalone/.env` when an existing checkout is already present. When `SERVER_SSH_KNOWN_HOSTS` is set as a repository variable or secret, the workflow writes that pinned public host key data directly to `known_hosts`, preferring the secret if both exist. Otherwise, host key scan retries run six times, scan `ed25519`, `ecdsa`, then `rsa` sequentially, accept non-empty scan output even when one scan command exits non-zero, and include an IPv4 keyscan fallback without disabling strict host key checking. Runner-side image archives and temporary SSH material are removed in an always-run cleanup step.

To prepare the optional host key pin without printing the key body in logs:

```bash
node scripts/prepare-deploy-known-hosts.mjs --host <server-host> --port <server-port> --out /tmp/kuviewer-known-hosts
gh variable set SERVER_SSH_KNOWN_HOSTS < /tmp/kuviewer-known-hosts
```

The helper also supports validating an existing known_hosts file and setting the repository variable or secret directly:

```bash
node scripts/prepare-deploy-known-hosts.mjs --from-file /tmp/kuviewer-known-hosts --set-variable
```

If `ssh-keyscan` is blocked but you can run commands on the server, generate the same pin from public SSH host key files. These `.pub` files are public keys, not private keys:

```bash
node scripts/prepare-deploy-known-hosts.mjs \
  --host <server-host> \
  --port <server-port> \
  --from-public-key /etc/ssh/ssh_host_ed25519_key.pub \
  --from-public-key /etc/ssh/ssh_host_ecdsa_key.pub \
  --from-public-key /etc/ssh/ssh_host_rsa_key.pub \
  --set-variable
```

If you cannot run the helper from a trusted local/server shell, the manual `deploy-known-hosts-bootstrap` workflow can populate the repository variable. It first tries `ssh-keyscan`; if keyscan is blocked, it only falls back to SSH `accept-new` when the workflow input `trust_first_connection` is exactly `I_UNDERSTAND_TOFU`. That fallback is trust-on-first-use, so prefer the helper or a copied server `.pub` host key when available. The workflow stores only the public SSH host key pin in `SERVER_SSH_KNOWN_HOSTS` and does not build, upload, deploy, roll back, or mutate the server.

If a workflow reports `ssh-banner-timeout`, TCP opened but the SSH server did not send an SSH banner. Verify that `SERVER_PORT` is the SSH port, `sshd` is listening on that port, cloud/firewall rules allow GitHub-hosted runners, and no proxy or tarpit sits in front of SSH. The same banner check can be run from a trusted shell:

```bash
node scripts/check-ssh-banner.mjs --host <server-host> --port <server-port>
```

For a broader no-credential check, run the manual `deploy-ssh-endpoint-diagnostics` workflow or the local helper below. It classifies the endpoint as TCP reachable/unreachable, SSH banner detected/missing, HTTP response detected/missing, and TLS handshake detected/missing without using the deploy private key or changing the server:

```bash
node scripts/diagnose-ssh-endpoint.mjs --host <server-host> --port <server-port>
```

On the server, check the daemon and listener before retrying the GitHub workflow:

```bash
sudo systemctl status ssh --no-pager
sudo sshd -T | grep -E '^(port|listenaddress) '
sudo ss -ltnp | grep sshd
```

If both the workflow keyscan fallback and the helper cannot collect host keys, SSH is not reachable from that network path; verify the server SSH service, port, DNS/IP, and firewall before rerunning the tag deploy.

Before creating a new release tag, the manual `deploy-preflight` workflow can validate only the deploy connection path. It checks required secrets, SSH TCP reachability, the optional pinned host key, strict SSH connection setup, remote `git`/`curl`/`gzip`/Docker/Compose availability, `DEPLOY_PATH`, existing `deploy/standalone/.env`, and temporary write access. It does not build an image, upload files, run compose, roll back, or change the server deployment.

Tag deploy bounds each SCP image upload attempt to 300 seconds, retries up to three times, and caps the whole upload step at 18 minutes. A timed-out attempt prints `scp-upload-timeout`, other failed attempts print `scp-upload-failed`, and the workflow removes the partial remote image tar before retrying. If upload timeouts repeat, run `deploy-ssh-endpoint-diagnostics` and verify SSH/network throughput or use the self-hosted fallback below.

For the self-hosted fallback, install/configure the runner outside this repository and assign the `kuviewer-deploy` label. The runner user needs access to Docker/Compose, `git`, `curl`, and `tar`. Prepare `DEPLOY_PATH` once with an untracked env file before running the workflow:

```bash
mkdir -p /opt/kuviewer/deploy/standalone
cp deploy/standalone/.env.example /opt/kuviewer/deploy/standalone/.env
# edit KUVIEWER_ADMIN_TOKEN before the first deploy
```

The self-hosted workflow preserves that env file and never prints it. It stores no SSH credential, kubeconfig, cloud credential, private key, admin token, raw logs, or Secret value.

Deploy rollback is local to the server. Before loading the new `kuviewer:local` image, the workflow preserves the existing image as `kuviewer:rollback-${GITHUB_RUN_ID}` when one exists. If the new compose rollout does not pass the bounded `/healthz` retry loop, the workflow retags that preserved image back to `kuviewer:local`, recreates compose, checks health again, and still fails the GitHub Actions run so the failed release is visible. The server writes safe deploy metadata to `$DEPLOY_PATH/.kuviewer/deploy-state.json`, including run id, ref, sha, timestamps, image ids, result, and rollback result. It does not print raw container logs, `.env` content, tokens, kubeconfigs, private keys, cloud credentials, or Secret values.

Optional repository variables, shown with example values:

```text
DEPLOY_PATH=/opt/kuviewer
HEALTH_URL=http://127.0.0.1:18085/healthz
```

Server prerequisite for the selected `DEPLOY_PATH`:

```bash
cd /opt/kuviewer
cp deploy/standalone/.env.example deploy/standalone/.env
# edit KUVIEWER_ADMIN_TOKEN before the first deploy
```

Deployment triggers:

- Push a release tag matching `v*.*.*`: deploys that tag after confirming the tagged commit is contained in `origin/main`.
- Manual `workflow_dispatch`: deploys the selected branch, tag, or SHA for controlled operations.
- Manual `deploy-self-hosted` `workflow_dispatch`: deploys the selected branch, tag, or SHA from a labeled self-hosted runner without SSH/SCP.

## Native Kubernetes install draft

The first manifest is available at [deploy/kubernetes/kuviewer.yaml](deploy/kubernetes/kuviewer.yaml).

Before applying it, change the placeholder admin token:

```yaml
stringData:
  admin-token: change-me
```

Then apply and port-forward:

```bash
kubectl apply -f deploy/kubernetes/kuviewer.yaml
kubectl -n kuviewer port-forward svc/kuviewer 8080:8080
```

Open:

```text
http://127.0.0.1:8080
```

The draft RBAC intentionally does not grant `secrets` read access. Secret nodes are inferred from Pod references only. It grants read-only `events` and `pods/log` access so Resource Explorer can show selected-resource Events, recent Pod logs, and current-log follow when the cluster allows it. It also grants CRD definition read access, but it does not grant wildcard custom-resource instance access. Add narrow read rules for specific custom API groups/resources only when you want those instances to appear.
