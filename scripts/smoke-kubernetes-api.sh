#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Smoke test Kuviewer against the current kubectl context.

This script creates temporary read-only Kubernetes RBAC, starts the Kuviewer
Go server with KUVIEWER_SOURCE=kubernetes, then verifies /api/status and
/api/topology with the admin token.

Environment variables:
  KUVIEWER_ADMIN_TOKEN             UI/API admin token. Default: kuviewer-admin
  KUVIEWER_SMOKE_BIND              Local bind address. Default: 127.0.0.1
  KUVIEWER_SMOKE_PORT              Local server port. Default: 18083
  KUVIEWER_SMOKE_NAMESPACE         Temp namespace. Default: kuviewer-smoke-<timestamp>
  KUVIEWER_SMOKE_TOKEN_DURATION    ServiceAccount token duration. Default: 1h
  KUVIEWER_SMOKE_KEEP_RESOURCES    Keep temp RBAC when set to 1. Default: 0
  KUVIEWER_SMOKE_HOLD              Keep server running when set to 1. Default: 0
  KUVIEWER_SMOKE_DRY_RUN           Only validate kubectl manifest when set to 1. Default: 0
  KUVIEWER_SMOKE_LOG               Server log path. Default: /tmp/kuviewer-kubernetes-smoke.log
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
ADMIN_TOKEN="${KUVIEWER_ADMIN_TOKEN:-kuviewer-admin}"
BIND_ADDR="${KUVIEWER_SMOKE_BIND:-127.0.0.1}"
PORT="${KUVIEWER_SMOKE_PORT:-18083}"
NAMESPACE="${KUVIEWER_SMOKE_NAMESPACE:-kuviewer-smoke-$(date +%s)}"
TOKEN_DURATION="${KUVIEWER_SMOKE_TOKEN_DURATION:-1h}"
KEEP_RESOURCES="${KUVIEWER_SMOKE_KEEP_RESOURCES:-0}"
HOLD_SERVER="${KUVIEWER_SMOKE_HOLD:-0}"
DRY_RUN="${KUVIEWER_SMOKE_DRY_RUN:-0}"
LOG_FILE="${KUVIEWER_SMOKE_LOG:-${TMPDIR:-/tmp}/kuviewer-kubernetes-smoke.log}"
SERVICE_ACCOUNT="kuviewer-smoke"
CLUSTER_ROLE="${NAMESPACE}-readonly"
CLUSTER_ROLE_BINDING="${NAMESPACE}-readonly"
SERVER_PID=""
TMP_DIR=""
RESOURCES_APPLIED="0"

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
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${SERVICE_ACCOUNT}
  namespace: ${NAMESPACE}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ${CLUSTER_ROLE}
rules:
  - apiGroups: [""]
    resources:
      - namespaces
      - nodes
      - pods
      - serviceaccounts
      - services
      - configmaps
      - persistentvolumes
      - persistentvolumeclaims
    verbs: ["get", "list"]
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
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ${CLUSTER_ROLE_BINDING}
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

CONTEXT="$($KUBECTL config current-context 2>/dev/null || true)"
if [[ -z "$CONTEXT" ]]; then
  echo "kubectl has no current context" >&2
  exit 1
fi

echo "kubectl context: $CONTEXT"
echo "temporary namespace: $NAMESPACE"

apply_rbac
if [[ "$DRY_RUN" == "1" ]]; then
  echo "dry-run completed; no resources were created and server was not started"
  exit 0
fi
RESOURCES_APPLIED="1"

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

STATIC_DIR=""
if [[ -f "$ROOT_DIR/website/dist/index.html" ]]; then
  STATIC_DIR="$ROOT_DIR/website/dist"
fi

echo "starting Kuviewer server on http://${BIND_ADDR}:${PORT}"
(
  cd "$ROOT_DIR/server"
  export KUVIEWER_SOURCE=kubernetes
  export KUVIEWER_ADMIN_TOKEN="$ADMIN_TOKEN"
  export KUVIEWER_LISTEN_ADDR="${BIND_ADDR}:${PORT}"
  export KUVIEWER_CORS_ORIGIN=""
  export KUVIEWER_KUBE_API_SERVER="$API_SERVER"
  export KUVIEWER_KUBE_BEARER_TOKEN="$KUBE_TOKEN"
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

STATUS_JSON="$(curl -fsS -H "Authorization: Bearer ${ADMIN_TOKEN}" "http://${BIND_ADDR}:${PORT}/api/status")"
TOPOLOGY_JSON="$(curl -fsS -H "Authorization: Bearer ${ADMIN_TOKEN}" "http://${BIND_ADDR}:${PORT}/api/topology")"

echo "status response:"
if command -v jq >/dev/null 2>&1; then
  printf '%s\n' "$STATUS_JSON" | jq .
  printf 'topology counts: '
  printf '%s\n' "$TOPOLOGY_JSON" | jq -r '"clusters=\(.clusters | length) nodes=\(.nodes | length) edges=\(.edges | length)"'
else
  printf '%s\n' "$STATUS_JSON"
  printf 'topology response bytes: '
  printf '%s' "$TOPOLOGY_JSON" | wc -c | tr -d ' '
  printf '\n'
fi

echo "smoke test passed"
if [[ -n "$STATIC_DIR" ]]; then
  echo "web UI: http://${BIND_ADDR}:${PORT}"
  echo "admin token: ${ADMIN_TOKEN}"
fi
echo "server log: ${LOG_FILE}"

if [[ "$HOLD_SERVER" == "1" ]]; then
  echo "holding server; press Ctrl-C to stop"
  wait "$SERVER_PID"
fi
