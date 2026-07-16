# Kuviewer Completed Work Summary

이 문서는 2026년 7월까지 누적된 긴 handoff 완료 로그를 기능 단위로 압축한 기록이다.

## Web And Topology

- Upload/mock/live source modes와 same-origin production API
- Native Kubernetes topology, Gateway API route types, NetworkPolicy expressions
- CRD discovery, custom resource instances, safe custom relation inference
- Mobile SVG pan/zoom과 desktop React Flow renderer 분리
- YAML Flow/Radar brand theme와 독립 favicon/OG assets

## Resource Explorer

- Safe list/detail, metadata/status/relations/Events/logs
- Secret redaction, annotations redaction, safe YAML preview
- Container/previous/follow/pause Pod logs와 local filter/search/sort/export
- Saved views, grouping/search/reorder/bulk/folder/team sync/conflict preview
- Server-side filter/cursor pagination/facets와 snapshot cache/in-flight sharing
- Keyboard navigation, density, detail section controls, health signals

## Snapshot Comparison

- Browser-memory history, rename/delete, baseline/current selection
- Resource/relation/cluster diff와 relation filters
- Large-result windowing, safe JSON/CSV export, strict diff JSON import preview
- Metadata-only history export

## Desktop Prototype

- Tauri shell와 local sidecar scaffolding
- Keychain-backed credential metadata and runtime prototype
- Desktop-only CM/SSH multiple sessions, diagnostics, import/export, filters
- Session grouping/favorites/bulk actions and saved layout management
- Public installer/download product path removed
- Web runtime SSH/CM controls remain hidden

## Deployment And Security

- Standalone Docker/Caddy deployment examples
- NasCR image release path
- SSH preflight, known-host pinning, upload retry/stream fallback, remote build fallback
- Self-hosted deploy fallback, rollout health, rollback, safe deploy-state metadata
- Security headers, no-store protected APIs, constant-time token checks

세부 변경은 Git history와 릴리스 태그를 기준으로 추적한다. 이 문서에는 credential, private key, kubeconfig, Secret value 또는 개인 운영 주소를 기록하지 않는다.
