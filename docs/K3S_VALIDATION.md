# k3s Live Validation

Kuviewer is validated against a disposable local k3s cluster with the repository smoke command:

```bash
scripts/smoke-kubernetes-api.sh
```

The July 2026 validation used Kubernetes `v1.35.0+k3s1` and proved the following contracts against the real API server:

- required namespace, node, Pod, and Service capabilities are readable with temporary read-only RBAC;
- Events, `pods/log`, and CRD discovery requests are authorized;
- optional Gateway API resources report `missing` instead of failing the snapshot when their CRDs are not installed;
- the first topology request is a cache miss and an immediate second request is an identical cache hit;
- Resource Explorer cursor pagination returns distinct pages and populated facets;
- resource Events and fixed container log endpoints return their bounded response shapes without fallback warnings;
- Secret reference nodes contain no `data`, `stringData`, or value field;
- the smoke namespace, ClusterRole, ClusterRoleBinding, token files, server process, and server log are removed on exit.

The smoke does not install Gateway API CRDs, persist Kubernetes credentials, print selected Pod identity, or expose log content. AKS remains the next live compatibility target.
