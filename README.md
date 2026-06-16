# Kuviewer

Kuviewer is a Kubernetes topology viewer focused on visualizing clusters, namespaces, nodes, workloads, pods, services, ConfigMaps, Secrets, and storage relationships in a web UI.

## Current direction

- First target: native Kubernetes
- Later validation: k3s, AKS, and other Kubernetes-compatible distributions
- Initial auth model: no user accounts; live connector uses a single admin token
- Primary data sources: browser-side YAML/JSON/ZIP upload, live Kubernetes API, and bundled mock data
- Upload mode is SaaS-friendly: manifests are parsed in the browser and are not sent to a backend by the frontend
- Frontend: React, TypeScript, Vite, Tailwind CSS

## Current UI

- Source modes: `Upload YAML`, `Live Cluster`, and `Mock Demo`
- `Topology`: draggable React Flow resource relationship map with cluster and namespace zones
- `Flow`: YAML-derived traffic flow view
- `Resource Explorer`: read-only Kubernetes resource list, safe YAML/detail preview, topology relations, and live Events
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
```

Set `KUVIEWER_CORS_ORIGIN=http://127.0.0.1:5174` only when the Vite dev server calls a separately running local API server.

When `KUVIEWER_LISTEN_ADDR` is set to a non-loopback address, `KUVIEWER_ADMIN_TOKEN` must be set explicitly or the server exits before listening.

API endpoints:

```text
GET /healthz
GET /api/status
GET /api/topology
GET /api/resources
GET /api/resources/{kind}/{namespace-or--}/{name}
GET /api/resources/{kind}/{namespace-or--}/{name}/events
GET /api/resources/{kind}/{namespace-or--}/{name}/logs
GET /api/resources/{kind}/{namespace-or--}/{name}/logs/stream
Authorization: Bearer <admin-token>
```

The resource explorer endpoints are read-only. They expose metadata, labels, redacted annotations, age/owner/uid summary, status, safe summary/preview data, safe YAML preview, and topology relations derived from the current snapshot. The YAML preview is generated from Kuviewer safe metadata and summaries, not from raw Kubernetes manifests. Secret values, `data`, and `stringData` are not returned. The resource list supports local keyboard navigation with ArrowUp/ArrowDown, Home/End, and Enter-to-detail focus. The detail panel provides section jump controls and local keyboard navigation for scanning read-only sections without storing resource data.

Resource Explorer saved views store only the list filters the user explicitly saves: search text, cluster, namespace, kind, and status. Saved views use browser `localStorage` key `kuviewer_resource_view_presets` and do not store resource data, Events, logs, Secret values, or admin tokens. The log density toggle stores only the UI preference `comfortable` or `compact` under `kuviewer_log_density`.

In live Kubernetes mode, `/api/resources/{kind}/{namespace-or--}/{name}/events` reads core v1 Events with an `involvedObject` field selector and returns newest events first. The Resource Explorer can filter the currently displayed Events locally in the browser by text, severity/type, and time range (`all`, `1h`, `6h`, `24h`, `7d`), sort them newest-first or oldest-first, pin important events to the top of the current detail view, and group unpinned events by severity/type so Warning/Error style events appear before Normal events. Missing or unparseable timestamps appear only in the `all` time range and sort after timestamped Events. Event filter text, severity selection, time range, sort order, and pinned Events are not persisted by Kuviewer. If Events are unavailable because of RBAC or API differences, Kuviewer returns an empty event list with a safe warning instead of failing the whole resource detail panel. Upload and mock modes keep returning an empty event list.

In live Kubernetes mode, `/api/resources/Pod/{namespace}/{name}/logs` reads the selected Pod's recent logs with `tailLines=200`. Add `?container=name` to read a specific container or initContainer, and `?previous=true` to read the previous terminated container instance when Kubernetes has one. `/logs/stream` uses the same query shape and follows current Pod logs as newline-delimited JSON; the browser keeps only the latest 500 displayed lines for the active connection. The Resource Explorer can filter the currently displayed log lines locally in the browser, switch between comfortable and compact log display density, and copy the currently displayed or loaded lines to the clipboard when the user clicks the copy controls. Filter text, copied text, and log lines are not persisted by Kuviewer. Logs are read-only, fetched only when the user clicks the logs controls, and are not stored by Kuviewer. Kubernetes logs can contain application secrets, so grant `pods/log` only to clusters where this exposure is acceptable. Upload and mock modes show a logs empty state.

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
