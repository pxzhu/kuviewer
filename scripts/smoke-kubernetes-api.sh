#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Smoke test Kuviewer against the current kubectl context.

This script creates temporary read-only Kubernetes RBAC, starts the Kuviewer
Go server with KUVIEWER_SOURCE=kubernetes, then verifies the live read-only
API surface with the admin token.

Environment variables:
  KUVIEWER_ADMIN_TOKEN             UI/API admin token. Default: generated smoke token
  KUVIEWER_SMOKE_BIND              Local bind address. Default: 127.0.0.1
  KUVIEWER_SMOKE_PORT              Local server port. Default: 18083
  KUVIEWER_SMOKE_NAMESPACE         Temp namespace. Default: kuviewer-smoke-<timestamp>
  KUVIEWER_SMOKE_TOKEN_DURATION    ServiceAccount token duration. Default: 1h
  KUVIEWER_SMOKE_KEEP_RESOURCES    Keep temp RBAC when set to 1. Default: 0
  KUVIEWER_SMOKE_HOLD              Keep server running when set to 1. Default: 0
  KUVIEWER_SMOKE_DRY_RUN           Only validate kubectl manifest when set to 1. Default: 0
  KUVIEWER_SMOKE_LOG               Server log path. Default: /tmp/kuviewer-kubernetes-smoke.log
  KUVIEWER_SMOKE_KEEP_LOG          Keep the server log when set to 1. Default: 0
  KUBECTL                          kubectl executable. Default: kubectl

Examples:
  scripts/smoke-kubernetes-api.sh
  KUVIEWER_SMOKE_HOLD=1 scripts/smoke-kubernetes-api.sh
  KUVIEWER_SMOKE_DRY_RUN=1 scripts/smoke-kubernetes-api.sh
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KUBECTL="${KUBECTL:-kubectl}"
ADMIN_TOKEN="${KUVIEWER_ADMIN_TOKEN:-kuviewer-smoke-$(date +%s)-$$}"
BIND_ADDR="${KUVIEWER_SMOKE_BIND:-127.0.0.1}"
PORT="${KUVIEWER_SMOKE_PORT:-18083}"
NAMESPACE="${KUVIEWER_SMOKE_NAMESPACE:-kuviewer-smoke-$(date +%s)}"
TOKEN_DURATION="${KUVIEWER_SMOKE_TOKEN_DURATION:-1h}"
KEEP_RESOURCES="${KUVIEWER_SMOKE_KEEP_RESOURCES:-0}"
HOLD_SERVER="${KUVIEWER_SMOKE_HOLD:-0}"
DRY_RUN="${KUVIEWER_SMOKE_DRY_RUN:-0}"
LOG_FILE="${KUVIEWER_SMOKE_LOG:-${TMPDIR:-/tmp}/kuviewer-kubernetes-smoke.log}"
KEEP_LOG="${KUVIEWER_SMOKE_KEEP_LOG:-0}"
SERVICE_ACCOUNT="kuviewer-smoke"
CLUSTER_ROLE="${NAMESPACE}-readonly"
CLUSTER_ROLE_BINDING="${NAMESPACE}-readonly"
SERVER_PID=""
TMP_DIR=""
RESOURCES_APPLIED="0"
LOG_CREATED="0"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi

  if [[ "$LOG_CREATED" == "1" && "$KEEP_LOG" != "1" ]]; then
    rm -f "$LOG_FILE"
  fi

  if [[ "$RESOURCES_APPLIED" == "1" && "$KEEP_RESOURCES" != "1" ]]; then
    "$KUBECTL" delete clusterrolebinding "$CLUSTER_ROLE_BINDING" --ignore-not-found >/dev/null 2>&1 || true
    "$KUBECTL" delete clusterrole "$CLUSTER_ROLE" --ignore-not-found >/dev/null 2>&1 || true
    "$KUBECTL" delete namespace "$NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

decode_base64() {
  local input="$1"
  local output="$2"

  if printf '%s' "$input" | base64 --decode >"$output" 2>/dev/null; then
    return 0
  fi

  printf '%s' "$input" | base64 -D >"$output"
}

apply_rbac() {
  local apply_args=(apply -f -)
  if [[ "$DRY_RUN" == "1" ]]; then
    apply_args=(apply --dry-run=client --validate=false -f -)
  fi

  "$KUBECTL" "${apply_args[@]}" <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${NAMESPACE}
  labels:
    app.kubernetes.io/name: kuviewer-smoke
    app.kubernetes.io/managed-by: kuviewer-smoke
    kuviewer.io/ephemeral: "true"
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${SERVICE_ACCOUNT}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/name: kuviewer-smoke
    app.kubernetes.io/managed-by: kuviewer-smoke
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ${CLUSTER_ROLE}
  labels:
    app.kubernetes.io/name: kuviewer-smoke
    app.kubernetes.io/managed-by: kuviewer-smoke
rules:
  - apiGroups: [""]
    resources:
      - namespaces
      - nodes
      - pods
      - serviceaccounts
      - services
      - configmaps
      - events
      - persistentvolumes
      - persistentvolumeclaims
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources:
      - pods/log
    verbs: ["get"]
  - apiGroups: ["discovery.k8s.io"]
    resources:
      - endpointslices
    verbs: ["get", "list"]
  - apiGroups: ["apps"]
    resources:
      - deployments
      - replicasets
      - statefulsets
      - daemonsets
    verbs: ["get", "list"]
  - apiGroups: ["batch"]
    resources:
      - jobs
      - cronjobs
    verbs: ["get", "list"]
  - apiGroups: ["autoscaling"]
    resources:
      - horizontalpodautoscalers
    verbs: ["get", "list"]
  - apiGroups: ["networking.k8s.io"]
    resources:
      - ingresses
      - networkpolicies
    verbs: ["get", "list"]
  - apiGroups: ["gateway.networking.k8s.io"]
    resources:
      - gateways
      - httproutes
      - grpcroutes
      - tlsroutes
      - tcproutes
    verbs: ["get", "list"]
  - apiGroups: ["storage.k8s.io"]
    resources:
      - storageclasses
    verbs: ["get", "list"]
  - apiGroups: ["apiextensions.k8s.io"]
    resources:
      - customresourcedefinitions
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ${CLUSTER_ROLE_BINDING}
  labels:
    app.kubernetes.io/name: kuviewer-smoke
    app.kubernetes.io/managed-by: kuviewer-smoke
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ${CLUSTER_ROLE}
subjects:
  - kind: ServiceAccount
    name: ${SERVICE_ACCOUNT}
    namespace: ${NAMESPACE}
EOF
}

require_command "$KUBECTL"
require_command curl
require_command go
require_command base64
require_command jq

if [[ ! "$NAMESPACE" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ || ${#NAMESPACE} -gt 63 ]]; then
  echo "KUVIEWER_SMOKE_NAMESPACE must be a DNS label with at most 63 characters" >&2
  exit 1
fi
if [[ ! "$PORT" =~ ^[0-9]+$ || "$PORT" -lt 1 || "$PORT" -gt 65535 ]]; then
  echo "KUVIEWER_SMOKE_PORT must be between 1 and 65535" >&2
  exit 1
fi
if [[ "$BIND_ADDR" != "127.0.0.1" && "$BIND_ADDR" != "localhost" ]]; then
  echo "KUVIEWER_SMOKE_BIND must be a loopback address" >&2
  exit 1
fi
if [[ ${#ADMIN_TOKEN} -lt 16 || ${#ADMIN_TOKEN} -gt 512 || "$ADMIN_TOKEN" == *$'\n'* || "$ADMIN_TOKEN" == *$'\r'* ]]; then
  echo "KUVIEWER_ADMIN_TOKEN must be 16-512 characters without line breaks" >&2
  exit 1
fi
if [[ ! "$TOKEN_DURATION" =~ ^[1-9][0-9]*(s|m|h)$ ]]; then
  echo "KUVIEWER_SMOKE_TOKEN_DURATION must use a positive s, m, or h duration" >&2
  exit 1
fi

CONTEXT="$($KUBECTL config current-context 2>/dev/null || true)"
if [[ -z "$CONTEXT" ]]; then
  echo "kubectl has no current context" >&2
  exit 1
fi

echo "kubectl context: $CONTEXT"
echo "temporary namespace: $NAMESPACE"

if [[ "$DRY_RUN" != "1" ]]; then
  RESOURCES_APPLIED="1"
fi
apply_rbac
if [[ "$DRY_RUN" == "1" ]]; then
  echo "dry-run completed; no resources were created and server was not started"
  exit 0
fi

API_SERVER="$($KUBECTL config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
if [[ -z "$API_SERVER" ]]; then
  echo "could not read Kubernetes API server from kubeconfig" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kuviewer-smoke.XXXXXX")"
CA_FILE=""
CA_DATA="$($KUBECTL config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' 2>/dev/null || true)"
if [[ -n "$CA_DATA" ]]; then
  CA_FILE="$TMP_DIR/ca.crt"
  decode_base64 "$CA_DATA" "$CA_FILE"
else
  CA_PATH="$($KUBECTL config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority}' 2>/dev/null || true)"
  if [[ -n "$CA_PATH" ]]; then
    CA_FILE="$CA_PATH"
  fi
fi

INSECURE_SKIP_TLS="$($KUBECTL config view --raw --minify -o jsonpath='{.clusters[0].cluster.insecure-skip-tls-verify}' 2>/dev/null || true)"
if [[ -z "$CA_FILE" && "$INSECURE_SKIP_TLS" != "true" ]]; then
  echo "warning: kubeconfig has no CA file/data; using insecure TLS skip for this smoke run" >&2
  INSECURE_SKIP_TLS="true"
fi

if ! KUBE_TOKEN="$($KUBECTL -n "$NAMESPACE" create token "$SERVICE_ACCOUNT" --duration="$TOKEN_DURATION" 2>/dev/null)"; then
  KUBE_TOKEN="$($KUBECTL -n "$NAMESPACE" create token "$SERVICE_ACCOUNT")"
fi
TOKEN_FILE="$TMP_DIR/kubernetes-token"
AUTH_HEADER_FILE="$TMP_DIR/admin-header"
umask 077
printf '%s' "$KUBE_TOKEN" >"$TOKEN_FILE"
printf 'Authorization: Bearer %s' "$ADMIN_TOKEN" >"$AUTH_HEADER_FILE"
unset KUBE_TOKEN

api_get() {
  curl -fsS --header "@$AUTH_HEADER_FILE" "$@"
}

STATIC_DIR=""
if [[ -f "$ROOT_DIR/website/dist/index.html" ]]; then
  STATIC_DIR="$ROOT_DIR/website/dist"
fi

echo "starting Kuviewer server on http://${BIND_ADDR}:${PORT}"
LOG_CREATED="1"
(
  cd "$ROOT_DIR/server"
  export KUVIEWER_SOURCE=kubernetes
  export KUVIEWER_ADMIN_TOKEN="$ADMIN_TOKEN"
  export KUVIEWER_LISTEN_ADDR="${BIND_ADDR}:${PORT}"
  export KUVIEWER_CORS_ORIGIN=""
  export KUVIEWER_KUBE_API_SERVER="$API_SERVER"
  export KUVIEWER_KUBE_TOKEN_FILE="$TOKEN_FILE"
  export KUVIEWER_CLUSTER_ID="${KUVIEWER_CLUSTER_ID:-$CONTEXT}"
  export KUVIEWER_CLUSTER_NAME="${KUVIEWER_CLUSTER_NAME:-$CONTEXT}"
  if [[ -n "$CA_FILE" ]]; then
    export KUVIEWER_KUBE_CA_FILE="$CA_FILE"
  fi
  if [[ "$INSECURE_SKIP_TLS" == "true" ]]; then
    export KUVIEWER_KUBE_INSECURE_SKIP_TLS_VERIFY=true
  fi
  if [[ -n "$STATIC_DIR" ]]; then
    export KUVIEWER_STATIC_DIR="$STATIC_DIR"
  fi
  go run ./cmd/kuviewer-server
) >"$LOG_FILE" 2>&1 &
SERVER_PID="$!"

for attempt in {1..30}; do
  if curl -fsS "http://${BIND_ADDR}:${PORT}/healthz" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo "Kuviewer server exited before health check passed" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi
  sleep 1
  if [[ "$attempt" == "30" ]]; then
    echo "Kuviewer server did not become healthy" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi
done

BASE_URL="http://${BIND_ADDR}:${PORT}"
FIRST_HEADERS="$TMP_DIR/topology-first.headers"
SECOND_HEADERS="$TMP_DIR/topology-second.headers"
STATUS_JSON="$(api_get "$BASE_URL/api/status")"
CAPABILITIES_JSON="$(api_get "$BASE_URL/api/capabilities")"
TOPOLOGY_JSON="$(api_get --dump-header "$FIRST_HEADERS" "$BASE_URL/api/topology")"
SECOND_TOPOLOGY_JSON="$(api_get --dump-header "$SECOND_HEADERS" "$BASE_URL/api/topology")"

echo "validating status and capabilities"
jq -e '.mode == "api" and .source == "kubernetes" and .readOnly == true and .secrets == "hidden"' <<<"$STATUS_JSON" >/dev/null
jq -e '
  .source == "kubernetes"
  and ([.items[] | select(.required == true and .status != "available")] | length == 0)
  and any(.items[]; .id == "observability/events" and .status == "available")
  and any(.items[]; .id == "extensions/crds" and .status == "available")
  and any(.items[]; .id == "policy/secret-values" and .status == "protected")
' <<<"$CAPABILITIES_JSON" >/dev/null
echo "validating topology safety and cache"
jq -e '.clusters | length == 1' <<<"$TOPOLOGY_JSON" >/dev/null
jq -e '.nodes | length > 0' <<<"$TOPOLOGY_JSON" >/dev/null
jq -e '.edges | type == "array"' <<<"$TOPOLOGY_JSON" >/dev/null
jq -e 'all(
  .nodes[] | select(.kind == "Secret");
  ((.summary | has("data")) | not)
  and ((.summary | has("stringData")) | not)
  and ((.summary | has("value")) | not)
)' <<<"$TOPOLOGY_JSON" >/dev/null
echo "topology shape and Secret policy: ok"
cmp -s <(printf '%s' "$TOPOLOGY_JSON") <(printf '%s' "$SECOND_TOPOLOGY_JSON")
echo "cached topology identity: ok"
grep -Eiq '^X-Kuviewer-Snapshot-Cache:[[:space:]]*miss[[:space:]]*$' "$FIRST_HEADERS"
echo "first topology cache state: miss"
grep -Eiq '^X-Kuviewer-Snapshot-Cache:[[:space:]]*hit[[:space:]]*$' "$SECOND_HEADERS"
echo "second topology cache state: hit"

echo "validating resource pagination"
RESOURCE_PAGE_ONE="$(api_get "$BASE_URL/api/resources?limit=1&sort=name&direction=asc")"
RESOURCE_CURSOR="$(jq -r '.metadata.nextCursor // empty' <<<"$RESOURCE_PAGE_ONE")"
jq -e '.metadata.total > 1 and .metadata.returned == 1 and (.metadata.facets.kinds | length > 0)' <<<"$RESOURCE_PAGE_ONE" >/dev/null
if [[ -z "$RESOURCE_CURSOR" ]]; then
  echo "resource pagination did not return a cursor" >&2
  exit 1
fi
RESOURCE_PAGE_TWO="$(api_get --get --data-urlencode "cursor=$RESOURCE_CURSOR" --data-urlencode "limit=1" --data-urlencode "sort=name" --data-urlencode "direction=asc" "$BASE_URL/api/resources")"
jq -e --arg first_id "$(jq -r '.items[0].id' <<<"$RESOURCE_PAGE_ONE")" '.metadata.returned == 1 and .items[0].id != $first_id' <<<"$RESOURCE_PAGE_TWO" >/dev/null

echo "validating Pod Events and fixed logs"
POD_JSON="$(jq -c '
  ([.nodes[] | select(
    .kind == "Pod"
    and (.namespace | startswith("kuviewer-"))
    and (.summary.containerNames | type == "array")
    and (.summary.containerNames | length > 0)
  )] + [.nodes[] | select(
    .kind == "Pod"
    and .namespace != ""
    and (.summary.containerNames | type == "array")
    and (.summary.containerNames | length > 0)
  )]) | first // empty
' <<<"$TOPOLOGY_JSON")"
if [[ -z "$POD_JSON" ]]; then
  echo "topology did not contain a Pod suitable for Events/Logs smoke" >&2
  exit 1
fi
POD_NAMESPACE="$(jq -r '.namespace' <<<"$POD_JSON")"
POD_NAME="$(jq -r '.name' <<<"$POD_JSON")"
POD_CONTAINER="$(jq -r '.summary.containerNames[0]' <<<"$POD_JSON")"
EVENTS_JSON="$(api_get "$BASE_URL/api/resources/Pod/$POD_NAMESPACE/$POD_NAME/events")"
LOGS_JSON="$(api_get --get --data-urlencode "container=$POD_CONTAINER" "$BASE_URL/api/resources/Pod/$POD_NAMESPACE/$POD_NAME/logs")"
jq -e '(.items | type == "array") and ((.warning // "") == "")' <<<"$EVENTS_JSON" >/dev/null
jq -e '(.lines | type == "array") and ((.warning // "") == "") and .tailLines == 200' <<<"$LOGS_JSON" >/dev/null

echo "status response:"
printf '%s\n' "$STATUS_JSON" | jq '{mode, source, readOnly, secrets, static}'
printf 'capabilities: '
printf '%s\n' "$CAPABILITIES_JSON" | jq -r '"available=\([.items[] | select(.status == "available")] | length) optional-missing=\([.items[] | select(.status == "missing")] | length) protected=\([.items[] | select(.status == "protected")] | length)"'
printf 'topology counts: '
printf '%s\n' "$TOPOLOGY_JSON" | jq -r '"clusters=\(.clusters | length) nodes=\(.nodes | length) edges=\(.edges | length) diagnostics=\(.diagnostics // [] | length)"'
printf 'resource pagination: '
printf '%s\n' "$RESOURCE_PAGE_ONE" | jq -r '"total=\(.metadata.total) page-size=\(.metadata.returned) next-cursor=yes"'
printf 'resource activity: '
jq -nr --argjson events "$(jq '.items | length' <<<"$EVENTS_JSON")" --argjson lines "$(jq '.lines | length' <<<"$LOGS_JSON")" '"events=\($events) log-lines=\($lines)"'

echo "smoke test passed"
if [[ -n "$STATIC_DIR" ]]; then
  echo "web UI: http://${BIND_ADDR}:${PORT}"
  echo "admin token: <redacted; set KUVIEWER_ADMIN_TOKEN before running if browser login is needed>"
fi
if [[ "$KEEP_LOG" == "1" ]]; then
  echo "server log retained: ${LOG_FILE}"
fi

if [[ "$HOLD_SERVER" == "1" ]]; then
  echo "holding server; press Ctrl-C to stop"
  wait "$SERVER_PID"
fi
