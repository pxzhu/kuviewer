# Kuviewer

Kuviewer is a Kubernetes topology viewer focused on visualizing clusters, namespaces, nodes, workloads, pods, services, ConfigMaps, Secrets, and storage relationships in a web UI.

## Current direction

- First target: native Kubernetes
- Later validation: k3s, AKS, and other Kubernetes-compatible distributions
- Initial auth model: no user accounts; live connector uses a single admin token
- Primary data sources: browser-side YAML/JSON/ZIP upload, live Kubernetes API, and bundled mock data
- Upload mode is SaaS-friendly: manifests are parsed in the browser and are not sent to a backend by the frontend
- Future packaging goal: an installable read-only desktop CM/SSH session explorer for macOS `.dmg` and Windows `.exe` distribution
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

## Desktop Packaging Goal

Kuviewer also tracks an installable read-only desktop cluster explorer path for users who want a local app that can connect through CM/SSH server sessions and inspect managed environments. The current Tauri-first scaffold is documented in [desktop/README.md](desktop/README.md), with a machine-checked target spec in [desktop/packaging-spec.json](desktop/packaging-spec.json) and build prerequisites in [desktop/BUILD_PREREQUISITES.md](desktop/BUILD_PREREQUISITES.md).

The desktop product direction is CM/SSH session management with multiple sessions, closer to VS Code Remote SSH than a browser feature. The web app must not expose SSH. Existing local sidecar/API paths are prototype-only scaffolds and are not the desktop product default.

The default packaging direction is Tauri first, with Electron as a fallback only if needed. Initial release targets are macOS `.dmg` and Windows `.exe`. The scaffold points at the existing Vite UI and keeps a `desktop-readonly` capability with no frontend shell or filesystem permissions. Desktop icons are generated from the transparent YAML Flow PNG asset, committed under `desktop/src-tauri/icons`, and checked by the packaging spec validator. A manual desktop package workflow can build unsigned `.dmg` / `.exe` artifacts, resolve package versions from a workflow input or `v*` tag ref, and include that version in uploaded artifact names. Its `smoke_matrix` input runs both unsigned macOS and Windows package smoke jobs in one dispatch and stores outputs only as GitHub Actions artifact uploads, not release assets.

The current desktop product UI includes a desktop-only CM/SSH session manager. It manages multiple metadata-only sessions with `name`, `host`, `port`, `user`, status, and description through safe Tauri commands: `desktop_cm_sessions`, `desktop_save_cm_session`, `desktop_select_cm_session`, and `desktop_delete_cm_session`. No password, private key, token, kubeconfig, cloud credential, Secret value, Event, or log is stored. Actual SSH connection checks, credential-store import, and CM tunnel runtime are the next desktop milestones.

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

Resource Explorer saved views store only the list filters the user explicitly saves: search text, cluster, namespace, kind, and status, plus the saved view name/group/order metadata. Saved views can be quick-applied from grouped sections, scanned through folder summary/chips with visible folder expand/collapse controls, filtered in-memory by saved view name/group/filter summary, reordered within each group by drag handle or up/down controls when search is clear, bulk-selected for selected-only export/group move/inline-confirm delete, updated by saving with the same name, renamed inline without changing filters, moved between groups, cleared from the current filter controls with the reset button, shared as a filter-only URL, exported as browser-local JSON with scope/timestamp filenames, imported back from array JSON or `{ "items": [...] }` JSON, and explicitly synced with a server-side team saved view collection when Live Cluster mode is unlocked with an admin token. Import/export actions show an in-page summary with filename, valid/skipped counts, folders, and import format, but the summary is not persisted. Resource Explorer filter changes quietly sync into the browser URL with `view=resources` plus optional `source`, `resourceQuery`, `resourceCluster`, `resourceNamespace`, `resourceKind`, and `resourceStatus` query parameters. Default filter values are omitted, invalid cluster/namespace/kind/status values fall back to `all` for the current data source, switching away from Resource Explorer removes the resource filter query, and browser back/forward restores the view, source, and filters. Local saved views use browser `localStorage` key `kuviewer_resource_view_presets`; saved view folder collapse state uses `kuviewer_resource_view_collapsed_groups` as UI preference only. The saved view search text, folder chip state beyond collapse preference, import/export summary, team compare preview, team sync summary, and bulk selection state are UI-only and are not persisted, exported, synced, or encoded in URLs; reorder controls are disabled while saved view search is active so hidden matches cannot be moved accidentally. Team saved views use `GET /api/resource-views` and `PUT /api/resource-views`, both protected by `Authorization: Bearer <admin-token>`, with response shape `{ "items": [...], "metadata": { "version": 0, "updatedAt": 0, "count": 0, "storage": "memory" } }`; PUT requests still send `{ "items": [...] }`, and older file-backed `{ "items": [...] }` payloads remain readable. Team load first shows a local-vs-team compare preview with new, changed, identical, local-only, skipped, max-limit-dropped counts, and server snapshot metadata. Team save first compares the current browser saved views with the server-side team collection and highlights new, changed, identical, server-only views, and the current server snapshot before replacing the team collection. Team load/save then shows an in-page sync summary with count, skipped items, folders, local-before count, conflict/new/duplicate counts, and the resulting snapshot version/update time/count/storage when available. To persist team saved views across server restarts, set `KUVIEWER_RESOURCE_VIEWS_FILE=/path/to/resource-views.json`; when unset, the server keeps them in memory only. Snapshot metadata describes only the saved view collection state and does not include resource data, Events, logs, Secret values, kubeconfigs, cloud credentials, private keys, or admin tokens. Both local and team saved views include only preset fields and do not store those sensitive values. Saved view rename/group/order/bulk edits, JSON import/export, and team sync are triggered by user clicks; local rename/group/order/bulk changes do not automatically write to the team store until the user reviews the compare preview and confirms team save. When imported or team views have the same name as a browser-local view but different filters, group, or order metadata, Kuviewer shows an inline conflict panel instead of silently overwriting; the user can prefer the incoming view, keep the current browser view, or rename the incoming view to keep both. The resource list sort preference stores only `{ field, direction }` under `kuviewer_resource_list_sort`; it is not included in saved view URLs, JSON export/import, or team saved views. The resource list column preference stores only optional column visibility under `kuviewer_resource_list_columns`; `Kind`, `Name`, and `Status` remain always visible and column preferences are not included in saved views or share URLs. The resource list density, resource detail density, and log density toggles store only `comfortable` or `compact` UI preferences under `kuviewer_resource_list_density`, `kuviewer_resource_detail_density`, and `kuviewer_log_density`. The live Events auto refresh toggle stores only `true` or `false` under `kuviewer_events_auto_refresh`, and the live Events warning notification toggle stores only `true` or `false` under `kuviewer_events_warning_notifications`.

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

Kuviewer can deploy without a container registry. The workflow in `.github/workflows/deploy.yml` builds `kuviewer:local` on the GitHub runner, saves it as a compressed image archive, uploads that archive to the server over SSH/SCP, updates the Git checkout, loads the image with Docker, and runs the standalone compose file.

Required repository secrets:

```text
SERVER_FHOST
SERVER_FUSER
SERVER_PORT
SERVER_SSH_KEY
```

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
