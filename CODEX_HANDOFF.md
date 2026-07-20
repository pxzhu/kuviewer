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
- Pull request `validate` CI와 tag-only deploy를 분리해 merge 후 중복 CI를 실행하지 않으며, `main`은 GitHub branch protection으로 PR과 required check를 강제한다.
- App/Vite TypeScript는 `noUnusedLocals`와 `noUnusedParameters`를 강제해 dead code가 typecheck/CI를 통과하지 못하게 한다.

## Architecture Notes

- `website/src/components/ResourceExplorer.tsx`는 resource filter controller와 list/detail 연결을 담당한다.
- Resource list 표시 설정 toolbar와 query/facet/active-filter panel은 `website/src/components/resourceExplorer/` 아래 표시 component로 분리돼 있다.
- Active filter chip 계산은 `resourceViewState.ts`의 pure helper와 direct unit test로 검증한다.
- Resource fetch/pagination abort, selection anchor, keyboard/bulk action은 `website/src/features/resources/useResourceListController.ts`가 담당한다.
- Resource request generation과 primary/page abort 계약은 `resourceListRequestCoordinator.ts`에 두고 direct unit test로 검증한다.
- Resource list/bulk rendering은 `website/src/components/resourceExplorer/ResourceExplorerListPanel.tsx`로 분리돼 있다.
- Resource list filtering/sorting/preferences/selection/export 모델은 `website/src/features/resources/resourceListModel.ts`에 두고 direct unit test로 검증한다.
- Saved-view validation/storage/order/import/conflict/team compare 모델은 `website/src/features/resources/resourceViewPresets.ts`에 둔다.
- Saved-view UI state와 save/import/conflict/team sync/reorder action은 `website/src/features/resources/useResourceViewPresetsController.ts`가 담당한다.
- Saved-view action/summary rendering은 `ResourceViewPresetsPanel.tsx`, folder/search/bulk/list rendering은 `ResourceViewPresetCollection.tsx`가 담당한다.
- Resource API filter/sort/cursor/facet 계산은 `server/internal/httpapi/resource_list.go`에 두고 HTTP integration과 순수 helper test를 함께 유지한다.
- Resource detail state는 `useResourceEventsController`, `useResourceLogsController`, `useResourceRelationsController`로 분리되며 각 controller가 resource-bound reset을 소유한다.
- Events filter/group/notification/export와 표시용 model/action 조립은 `useResourceEventsSectionController.ts`가 담당한다.
- Logs container/previous/follow/pause/search/export와 표시용 model/action 조립은 `useResourceLogsSectionController.ts`가 담당한다.
- Resource detail section open/active/focus와 document keyboard listener는 `useResourceDetailSectionsController.ts`가 담당하고 shortcut 해석은 `resourceDetailShortcut.ts` pure helper로 검증한다.
- Metadata/Status/Safe/YAML/Labels/Annotations rendering은 `ResourceCoreDetailSections.tsx`가 담당한다.
- Resource detail identity/density, section navigation/jump controls, overview header는 `ResourceExplorerDetailHeader.tsx` 표시 component가 담당한다.
- App sticky header의 theme/view controls, sync 상태, refresh/lock rendering은 `AppHeader.tsx`가 담당하고 오류 표시는 `appHeaderPresentation.ts`의 bounded formatter로 제한한다.
- Safe Preview 검색/match 상태와 rendering은 `ResourceSafePreviewSection.tsx`가 담당하며, 저장하지 않고 resource id가 바뀌면 초기화한다.
- Relations, Events, Logs section과 highlight renderer는 `website/src/components/resourceExplorer/` 아래 표시 component로 분리돼 있다.
- CSV export는 `website/src/features/export/safeCsv.ts`를 공통 사용해 formula injection과 NUL을 차단한다.
- Topology는 dispatcher, shared layout, mobile SVG, desktop React Flow renderer로 분리돼 있다.
- Upload topology JSON import의 size/identity/reference validation과 Secret/민감 metadata redaction은 `importTopologySnapshot.ts`의 독립 보안 경계와 direct unit test로 검증한다.
- Upload CustomResource의 native/custom `*Ref/*Name` 관계 추론은 `customResourceReferences.ts`에서 cycle/depth/value/path/result 상한을 적용하고 direct unit test로 검증한다.
- Upload Gateway route의 parent/backend 참조와 host/method 요약은 `gatewayRouteReferences.ts`에서 분리하고, 공통 Kubernetes object 접근은 `kubernetesObject.ts`의 fail-closed helper를 사용한다.
- Upload NetworkPolicy LabelSelector 평가는 `labelSelector.ts`에서 Kubernetes key/value/operator 문법과 size cap을 검증하며 malformed selector는 fail-closed 처리한다.
- Desktop CM grouping/search/diagnostic view model은 `website/src/features/desktop/desktopCmSessionView.ts`에 둔다.
- Desktop CM layout의 validation, storage, import/export, folder/preset ordering은 `website/src/features/desktop/desktopCmSessionLayouts.ts`에 두고 direct unit test로 검증한다.
- Desktop CM saved-layout UI state, import conflict, selection, keyboard/drag reorder orchestration은 `useDesktopCmSessionLayouts.ts`가 담당한다.
- Desktop CM saved-layout의 transient focus, keyboard/drag reorder orchestration은 `useDesktopCmSessionLayoutReorder.ts`로 한 단계 더 분리돼 있다.
- App shell의 Desktop CM session/runtime 수명주기와 safe 상태 전이는 `useDesktopCmSessionController.ts`가 담당하며, 웹 경로는 Tauri API를 dynamic import로만 접근한다.
- Desktop CM diagnostic preset은 독립 feature module과 direct unit test로 검증하며, core reorder는 test-id 정규화와 실제 desktop smoke로 고정한다.
- Desktop CM 연결 폼과 선택 세션 요약은 `website/src/components/desktopCm/` 표시 컴포넌트로 분리하고, safe error/status/validation은 `desktopCmSessionPresentation.ts` direct unit test로 고정한다.
- Frontend pure helper regression은 `npm run test:unit`, end-to-end UI는 `npm run test:visual`로 검증한다.
- Local automation helper regression은 `node --test scripts/lib/*.test.mjs`로 검증하며 Telegram 원격 오류 원문은 출력하지 않는다.
- Desktop smoke preview readiness도 공용 helper를 사용하고 HTTP(S) URL과 bounded timeout만 허용한다.
- SSH endpoint probe는 공용 helper에서 입력·응답 크기·오류 코드를 제한하고 대상 host를 로그에 출력하지 않는다.
- Kubernetes API client 오류는 safe reason/status code만 유지하며 endpoint path와 원격 응답 body를 전달하지 않는다.
- Kubernetes list는 `continue` pagination을 사용하고 page/item/byte 상한 내에서 완료된 결과만 snapshot에 반영한다.
- Live snapshot의 optional API와 CR instance 수집은 최대 6개 동시 요청으로 제한하고, 부분 실패는 원격 body/path 없이 resource와 allowlisted reason code만 `diagnostics`에 남긴다.
- 2026-07-20 Native Kubernetes 실검증에서 capability/topology/Secret redaction/cursor/cache/Events와 fixed/follow Pod logs를 확인했다. Pod log content negotiation은 일부 API server의 `text/plain` 406을 피하도록 `Accept: */*`를 사용한다.
- Kubernetes capability probing은 `kubernetes_capabilities.go`, Events/fixed/follow Pod logs와 line cap은 `kubernetes_activity.go`가 담당한다. 빈 Event ref와 nil stream callback은 네트워크 호출 전에 fail-closed 처리한다.
- Kubernetes list pagination은 `kubernetes_pagination.go`에서 selector/continue token을 보존하면서 page/item/byte/token cap을 적용한다. malformed query, nil client/output, invalid limits는 HTTP 요청 전에 bounded error로 거부한다.

## Runtime Boundaries

- Web: upload/mock/live Kubernetes API only. SSH controls 금지.
- Desktop: CM/SSH multiple-session prototype. Safe metadata만 local preference에 저장한다.
- Desktop prototype은 CM/SSH session만 지원하며 local sidecar/direct Kubernetes credential command와 legacy browser profile UI는 제거됐다.
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

1. AKS에서 capability/RBAC/Events/logs/pagination 검증 (Native Kubernetes와 local k3s 실검증 완료)
2. Desktop CM local prototype의 실제 CM 사용 흐름 검증 후 유지 또는 archive 범위 결정
3. Desktop CM session group/card/bulk toolbar와 saved-layout toolbar/conflict/folder/preset list는 표시 모듈로 분리됐고, saved-layout state와 reorder controller도 독립 hook으로 분리됐다.
4. scripts의 반복 코드가 다시 확인될 때 reusable helper/CLI entrypoint 분리 확대
