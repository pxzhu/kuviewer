# Kuviewer

Kuviewer is a read-only Kubernetes topology and resource explorer. It turns uploaded manifests, bundled mock data, or a live Kubernetes API into a visual resource graph, traffic-flow view, resource explorer, and snapshot comparison workspace.

## Product Direction

- Primary product: standalone web UI plus Go server
- Frontend UI foundation: HeroUI v3, React 19, Tailwind CSS v4, and Kuviewer B/D theme tokens
- First live target: native Kubernetes; local k3s validation is complete and AKS remains a validation target
- Authentication: no user accounts, one server-side admin token for protected live APIs
- Upload mode parses YAML/JSON/ZIP in the browser and does not send manifests to the backend
- Secret values, kubeconfigs, private keys, cloud credentials, and raw SSH errors are never displayed or persisted
- Desktop CM/SSH support is a local Tauri prototype only; the web app must not expose SSH
- The desktop prototype supports CM/SSH sessions only and does not bundle a local sidecar or direct Kubernetes credential profile
- No public desktop installer or download workflow is active

## Features

- Kubernetes resource topology with cluster and namespace zones
- Desktop React Flow renderer and lightweight mobile SVG pan/zoom renderer
- YAML-derived traffic-flow evidence and broken-route indicators
- Upload diagnostics for unsupported resources and parse errors
- Live connector diagnostics for authentication, RBAC, reachability, and optional APIs
- Resource Explorer with server-side filters, cursor pagination, facets, safe detail preview, Events, and Pod logs
- Pod logs with container selection, previous logs, follow, pause/resume, local search, time range, sort, copy, and download
- Saved resource views with grouping, search, reorder, bulk actions, import/export, URL sharing, and optional team sync
- Snapshot history and resource/relation/cluster diff with large-result windowing, safe JSON/CSV export, and count-only comparison between two validated diff reports
- Snapshot history metadata-only export without topology payloads
- Native workloads, storage, Ingress, Gateway API routes, NetworkPolicy selectors, CRDs, and safe custom-resource relation inference
- Bounded workload image summaries and safe Pod-template references without environment values or Secret contents
- Bounded Pod runtime state, reason, restart, and image summaries without runtime messages or container/image identifiers
- Bounded Node capacity, allocatable, condition, and runtime summaries without host identifiers or addresses
- Bounded PV, PVC, and StorageClass capacity, access, policy, provisioner, and binding summaries without CSI configuration or storage Secret references
- Bounded ConfigMap key-count and immutable summaries without decoding or retaining `data` or `binaryData` values
- Bounded concurrent live collection with safe partial-result diagnostics; incomplete resource lists are never merged into a snapshot
- HeroUI-backed application shell, Resource Explorer filters/sorting, Snapshot history selectors, Pod-log container selection, and accessible pressed/disabled/popover states

## Source Modes

### Upload

Upload YAML, JSON, ZIP, or a Kuviewer topology JSON. Manifest parsing happens in the browser. Secret resources expose only type, key count, and a values-hidden marker.

### Mock

Loads the bundled topology without a backend connection. This is the default demo and visual-smoke source.

### Live

Uses protected same-origin endpoints by default in production. Local Vite development keeps live mode disabled unless `VITE_API_BASE_URL` is configured.

The admin token is stored in `sessionStorage` only. The legacy localStorage token key is removed when auth state is read or cleared.

## Local Development

Frontend:

```bash
cd website
npm install
npm run dev
```

Server:

```bash
cd server
KUVIEWER_SOURCE=mock KUVIEWER_ADMIN_TOKEN=replace-me go run ./cmd/kuviewer-server
```

Production-style frontend build:

```bash
cd website
VITE_BASE_PATH=/ npm run build
```

## Verification

```bash
cd website
npm run typecheck
npm run test:unit
npm run build
VITE_BASE_PATH=/ npm run build
npm run test:visual
KUVIEWER_VISUAL_MODE=mock npm run test:visual
npm audit
npm audit --omit=dev

cd ../server
go test ./...
go vet ./...

cd ..
node scripts/check-desktop-packaging-spec.mjs

# Requires a disposable/current kubectl context and creates temporary labeled RBAC.
scripts/smoke-kubernetes-api.sh
```

The Kubernetes smoke verifies capability/RBAC, snapshot cache reuse, cursor pagination, Events, fixed Pod logs, and Secret value exclusion. It removes its temporary namespace, cluster RBAC, token files, and server log by default. Visual smoke writes temporary files under `website/artifacts/visual-smoke`. Generated build and smoke directories should be removed after local work.

## Server Configuration

Common environment variables:

- `KUVIEWER_SOURCE=mock|kubernetes`
- `KUVIEWER_ADMIN_TOKEN`: required for protected APIs
- `KUVIEWER_STATIC_DIR`: built frontend directory
- `KUVIEWER_ALLOWED_ORIGIN`: optional explicit CORS origin
- `KUVIEWER_RESOURCE_VIEWS_FILE`: optional team saved-view persistence file

Protected endpoints require `Authorization: Bearer <admin-token>`:

- `GET /api/status`
- `GET /api/topology`
- `GET /api/resources`
- `GET /api/resources/{kind}/{namespace-or--}/{name}`
- `GET /api/resources/{kind}/{namespace-or--}/{name}/events`
- `GET /api/resources/{kind}/{namespace-or--}/{name}/logs`
- `GET /api/resources/{kind}/{namespace-or--}/{name}/logs/stream`
- `GET|PUT /api/resource-views`

`GET /healthz` remains unauthenticated for container and gateway health checks.

## Security Model

- Read-only Kubernetes permissions
- No Secret `data` or `stringData` values
- Protected API responses use `Cache-Control: no-store`
- CSP, frame denial, nosniff, referrer, and permissions security headers
- Constant-time admin token comparison
- Logs and Events are fetched only on explicit live-mode actions and are not stored by Kuviewer
- Pod log reads and follow streams use Kubernetes-compatible content negotiation, while retaining the 200-line, byte, and line-length bounds
- Export files are user-click generated and contain safe metadata only
- CSV exports neutralize spreadsheet formula prefixes and strip NUL bytes

Kubernetes application logs may contain sensitive application output. Grant `pods/log` only where that exposure is acceptable.

## Deployment

Standalone compose binds Kuviewer to localhost so a host gateway can route a dedicated domain to the internal port:

```bash
cp deploy/standalone/.env.example deploy/standalone/.env
docker compose --env-file deploy/standalone/.env -f deploy/standalone/docker-compose.yml up -d
```

The release workflow builds and pushes through the configured container registry, then performs health-checked rollout with rollback support. Repository secrets and registry credentials are not documented in this repository.

## Desktop Local Prototype

The Tauri scaffold is retained for local CM/SSH multiple-session exploration. It stores only safe session/view metadata in browser preferences and keeps private-key material in the OS credential store. It is not a downloadable product and does not alter the web product boundary.

See [desktop/README.md](desktop/README.md), [desktop/BUILD_PREREQUISITES.md](desktop/BUILD_PREREQUISITES.md), and [desktop/packaging-spec.json](desktop/packaging-spec.json).

## Project Notes

- Next work: [docs/NEXT_WORK.md](docs/NEXT_WORK.md)
- Current handoff: [CODEX_HANDOFF.md](CODEX_HANDOFF.md)
- k3s live validation: [docs/K3S_VALIDATION.md](docs/K3S_VALIDATION.md)
- Completed-work summary: [docs/archive/2026-07-completed-work-summary.md](docs/archive/2026-07-completed-work-summary.md)
- Sample manifests: `samples/`
- Kubernetes deployment: `deploy/kubernetes/`
- Standalone deployment: `deploy/standalone/`

Local Telegram task notifications use `scripts/notify-telegram.mjs`. The script prefers `TELEGRAM_BOT_TOKEN_TWO`, validates bot-token format and numeric chat ids before network access, reduces remote failures to bounded reason codes, and reports only readiness metadata without token/chat values or file paths. It is not part of product runtime behavior. Its helper contract is covered by `node --test scripts/lib/*.test.mjs`.
