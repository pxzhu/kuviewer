# Kuviewer Next Work

이 문서는 다음 작업 판단에 필요한 현재 후보만 유지한다. 완료 이력은 `docs/archive/2026-07-completed-work-summary.md`를 본다.

## Recommended Order

1. Live Kubernetes connection verification
   - Native Kubernetes와 local k3s 검증은 완료했다. AKS에서 same-origin/API-base live mode를 추가 검증한다.
   - k3s smoke는 capability/RBAC, Events, fixed Pod logs, cache miss/hit, cursor pagination, CRD discovery와 Secret value 비노출을 실제 API로 검증한다.
   - 임시 namespace/ClusterRole/Binding/token/log에는 식별 가능한 smoke 범위와 trap 정리를 적용하며 기본적으로 잔여물을 남기지 않는다.
   - Capability/RBAC/reachability, Events, Pod logs, Gateway/CRD optional resources를 확인한다.
   - 10초 snapshot cache, in-flight sharing, server filter/cursor pagination을 실제 규모에서 측정한다.
   - 출력은 safe metadata로 제한하고 Secret value, token, kubeconfig, private key를 기록하지 않는다.
   - Gateway route는 v1 성공 시 종료하고 unavailable일 때만 v1alpha2 fallback하며, API 오류는 원격 body/path 없이 bounded code로 처리한다.
   - Core, workload, Gateway, CRD/CR, Events list는 selector를 보존한 `continue` pagination과 page/item/byte cap을 사용한다.
   - Optional API/CR instance는 최대 6개 bounded concurrency로 수집하고, 실패 항목은 safe snapshot diagnostics로 표시한다.
   - Fixed/follow Pod logs는 실제 Native API에서 검증했으며 `Accept: */*`, 200줄/byte/line cap을 유지한다.

2. Resource Explorer panel extraction
   - Resource fetch/pagination abort, selection anchor, keyboard/bulk action은 controller hook으로 분리됐다.
   - Resource list filtering/sorting/preferences/selection/export 모델은 feature module과 direct unit test로 분리됐다.
   - Events/Logs 요청·취소·stream 상태는 controller hook으로 분리됐다.
   - Events 필터/group/notification/export와 section model/action 조립은 Events section controller가 담당한다.
   - Logs 컨테이너/previous/follow/pause/search/export와 section model/action 조립은 Logs section controller가 담당한다.
   - Detail section open/active/focus 상태와 document keyboard listener는 controller hook으로 분리되고 shortcut 해석은 direct unit test로 검증한다.
   - Metadata/Status/Safe/YAML/Labels/Annotations rendering은 core detail component로 분리됐다.
   - Relations 검색/group/collapse/resource reset은 controller hook이 소유하고, Events resource reset도 Events controller 내부에서 처리한다.
   - Safe Preview 검색/match 상태와 section rendering은 resource id 경계의 독립 component로 분리됐다.
   - Relations, Events, Logs의 section/control/output은 표시 전용 component로 분리됐다.
   - Detail identity/density, section navigator/jump controls, overview header는 표시 전용 component로 분리됐다.
   - Resource list와 resource bulk toolbar는 표시 전용 component로 분리됐다.
   - Resource list sort/density/column toolbar와 query/facet/active-filter panel은 표시 전용 component로 분리됐다.
   - Active filter chip 계산은 pure helper와 direct unit test로 분리됐다.
   - Saved-view validation, storage, order/group, import/merge/conflict, team compare 모델은 feature module과 unit test로 분리됐다.
   - Saved-view UI state와 save/import/conflict/team sync/reorder action은 controller hook으로 분리됐다.
   - Saved-view control/summary/folder/search/bulk/list JSX는 표시 전용 panel component로 분리됐다.
   - API/storage/wire shape 변경 없이 shell은 controller 조정과 detail/list 연결만 담당한다.

3. Frontend regression coverage
   - App/Vite TypeScript config는 `noUnusedLocals`와 `noUnusedParameters`를 강제해 미사용 import, type, helper, controller return을 CI에서 차단한다.
   - `npm run test:unit`은 Desktop safe view와 diagnostic preset/reorder history, snapshot metadata/report summary, CSV 방어, Resource detail activity, saved-view model/storage helper를 검증한다.
   - Resource primary/page request generation, abort, stale completion 방지는 coordinator direct unit test로 검증한다.
   - Server pagination/filter/cursor/facet 계산은 별도 Go module과 direct unit test로 분리됐다.
   - Snapshot comparison reducer는 resource/relation/cluster 변화, clone 안정성, Secret-safe diff를 direct unit test로 검증한다.
   - Visual smoke는 주요 화면과 브라우저 통합에 집중해 CI 시간을 관리한다.

4. Desktop prototype scope reduction
   - Web product path는 standalone web/server를 유지하며 SSH/CM controls를 노출하지 않는다.
   - Desktop CM/SSH는 public installer가 없는 local prototype이다.
   - Local sidecar, direct Kubernetes bearer profile command, legacy browser server profile UI와 stale keychain smoke는 제거됐다.
   - Session layout validation/storage/import/export/reorder 모델은 panel에서 feature module로 분리되고 direct unit test가 추가됐다.
   - Diagnostic filter preset storage/normalization과 reorder history filter/time/test-id helper도 feature module로 분리됐다.
   - Connection profile form, selected session summary, safe diagnostics primitive와 presentation helper가 panel에서 분리됐다.
   - Session/layout UI를 더 분리할지, prototype archive로 축소할지 실제 사용 후 결정한다.

5. Snapshot comparison follow-up
   - Metadata-only history export는 완료됐다.
   - 검증된 Diff JSON 두 개의 exported/resource/relation/cluster 및 change-type 요약 증감 비교를 지원한다.
   - Report 비교 모델은 raw item payload를 전달하지 않고 safe count summary만 생성한다.
   - History와 선택값은 저장하지 않고 Secret 값은 모든 비교/export/import에서 제외한다.

6. Local automation hygiene
   - Telegram CLI는 reusable helper, direct unit test, bounded remote error code, required token-source guard를 사용한다.
   - SSH banner/endpoint diagnostics는 공용 probe helper와 allowlisted network reason code를 사용한다.
   - Desktop browser smoke의 HTTP readiness는 공용 helper에서 URL scheme과 timeout을 제한하고 원격 오류 원문을 버린다.
   - 다른 scripts도 보안/회귀 필요가 확인될 때 같은 CLI/helper 분리 패턴을 적용한다.
   - CI는 pull request와 수동 fallback에서만 실행하고, protected `main` merge 뒤의 중복 run은 만들지 않는다.

## Current Guardrails

- Git 작업은 사용자가 명시 요청할 때만 한다.
- 작업 전후 `website/dist`, `website/artifacts/visual-smoke`, `desktop/src-tauri/binaries`와 임시 프로세스를 정리한다.
- UI 작업 여부와 관계없이 작업 후 현재 화면 스크린샷을 남긴다.
- typecheck, unit/build/visual tests, backend tests, audit와 민감값 검사를 수행한다.
