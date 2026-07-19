# Kuviewer Codex Handoff

> 다음 작업 후보는 `docs/NEXT_WORK.md`를 기준으로 판단한다. 오래된 세부 완료 기록은 `docs/archive/2026-07-completed-work-summary.md`에 요약했다.

## Product Direction

- Kuviewer는 Kubernetes topology와 리소스 관계를 읽기 전용으로 탐색하는 web/server 제품이다.
- YAML/JSON/ZIP upload와 mock mode는 Kubernetes 연결 없이도 동작한다.
- Live mode는 same-origin API와 admin token을 사용한다.
- Secret value, kubeconfig, private key, cloud credential, raw SSH stderr는 표시하거나 저장하지 않는다.
- SSH/CM session UI는 Tauri desktop의 local prototype 전용이다. The web app must not expose SSH.
- Public desktop installer/download 경로는 제품 범위에서 제외한다.

## Current Capabilities

- Native Kubernetes workload, networking, storage, Gateway API, NetworkPolicy, CRD/custom resource topology
- Upload metadata와 parser diagnostics
- Desktop React Flow와 mobile SVG pan/zoom topology
- Resource Explorer list/detail, server filtering, cursor pagination, facets, saved/team views
- Live Events와 Pod logs, container/previous/follow/pause/filter/search/export
- Safe resource preview와 Secret redaction
- Snapshot history, resource/relation/cluster diff, large-result windowing, safe diff JSON/CSV export/import
- Snapshot history metadata-only JSON export
- Web security headers, no-store API policy, constant-time admin token comparison
- NasCR image release deployment과 SSH/self-hosted fallback/rollback diagnostics

## Architecture Notes

- `website/src/components/ResourceExplorer.tsx`는 list와 saved-view orchestration을 담당한다.
- Resource detail state는 `useResourceEventsController`와 `useResourceLogsController`로 분리돼 있다.
- Relations, Event groups, Log rows와 highlight renderer는 `website/src/components/resourceExplorer/` 아래 표시 component로 분리돼 있다.
- CSV export는 `website/src/features/export/safeCsv.ts`를 공통 사용해 formula injection과 NUL을 차단한다.
- Topology는 dispatcher, shared layout, mobile SVG, desktop React Flow renderer로 분리돼 있다.
- Desktop CM grouping/search/diagnostic view model은 `website/src/features/desktop/desktopCmSessionView.ts`에 둔다.
- Frontend pure helper regression은 `npm run test:unit`, end-to-end UI는 `npm run test:visual`로 검증한다.

## Runtime Boundaries

- Web: upload/mock/live Kubernetes API only. SSH controls 금지.
- Desktop: CM/SSH multiple-session prototype. Safe metadata만 local preference에 저장한다.
- Local sidecar/direct credential path는 explicit prototype flag가 없으면 기본 제품 경로에서 사용하지 않는다.
- Events/logs/snapshot history는 브라우저 메모리 중심이며 명시적 export 외에는 저장하지 않는다.

## Verification Baseline

```bash
cd website
npm run typecheck
npm run test:unit
npm run build
VITE_BASE_PATH=/ npm run build
npm run test:visual
KUVIEWER_VISUAL_MODE=mock npm run test:visual

cd ../server
go test ./...
```

추가 점검:

- `npm audit`와 `npm audit --omit=dev`
- token, kubeconfig, private key, Secret value, cloud credential, 개인 운영 URL 문자열 검사
- 작업 전후 preview/Playwright/Vite/Tauri 프로세스와 생성물 정리
- UI 변경 여부와 관계없이 현재 화면 스크린샷 확인

## Working Rules

- Git 작업은 사용자가 명시적으로 요청할 때만 한다.
- Git을 사용할 때는 목적 브랜치, 검증, PR, squash merge, tag 순서를 따른다.
- `website/dist`, `website/artifacts/visual-smoke`, `desktop/src-tauri/binaries`는 커밋하지 않는다.
- 새 기능보다 실제 Kubernetes 연결 검증과 큰 stateful component 축소를 우선한다.

## Remaining Work

1. 실제 native Kubernetes, k3s, AKS에서 capability/RBAC/Events/logs/pagination 검증
2. Resource Explorer Events/Logs의 남은 control surface를 표시 전용 section component로 추가 분리
3. Desktop CM local prototype의 layout/session UI 추가 모듈화 또는 archive 범위 축소
4. 필요성이 확인되면 snapshot diff report-to-report summary 비교 추가
5. scripts의 reusable helper/CLI entrypoint 분리 확대
