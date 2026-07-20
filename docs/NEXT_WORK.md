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
   - Provider capability와 Events/Pod logs는 독립 module로 분리됐고, 빈 Event ref와 nil stream callback은 direct test로 fail-closed 동작을 검증한다.
   - Kubernetes list pagination은 독립 module에서 query/continue 보존과 page/item/byte/token cap, malformed/nil input fail-closed 동작을 direct test로 검증한다.
   - Kubernetes API client는 독립 module에서 URL/TLS/config와 bounded decode를 담당하며, unsafe URL·invalid CA·token/CA 파일 오류는 HTTP 전 safe code로 거부하고 로컬 경로를 노출하지 않는다.
   - Kubernetes graph builder는 독립 module/test로 분리돼 node/edge dedupe, dangling-edge 거부, safe Secret placeholder, metadata copy, layout lane을 검증한다.
   - Snapshot fetch와 resource assembly도 독립 module/test로 분리돼 diagnostics copy, empty identity 거부, safe Secret placeholder와 관계 보존을 검증한다.
   - Kubernetes resource/list/reference schema는 독립 type module로 분리됐고 Pod raw value를 보존하지 않는 계약과 pagination metadata를 direct test로 검증한다.
   - CRD discovery/version/status와 custom-resource reference inference는 독립 module/test로 분리됐다. CRD API path와 reference identity를 검증하고 depth/visit/collection/path/result 상한, deterministic order, raw value 비노출을 유지한다.
   - NetworkPolicy selector/peer/port/intent는 독립 module/test로 분리됐다. label key/value/operator와 rule/peer/port 수를 제한하고 malformed input은 summary와 inferred edge 모두 fail-closed 처리한다.
   - Workload/storage 상태와 condition/container/owner summary, Pod/Service/Ingress/Gateway/native reference 추론은 독립 module/test로 분리됐다. selector fallback 비교량과 reference collection/result 수를 제한하고 malformed host/method/name은 원문 요약과 phantom edge를 만들지 않는다.
   - Resource identity, labels, annotations, summary, UID, status, owner와 edge metadata는 공통 sanitizer에서 크기·문법·민감값을 검증한다. malformed/oversized 입력은 fail-closed 처리하고 last-applied manifest와 credential-like metadata는 redaction한다.
   - Cluster summary는 graph에 실제 반영된 고유 Namespace/Node/Pod만 집계한다. invalid/duplicate API 항목은 이름 없이 kind별 bounded diagnostic으로 합치고, accepted source가 아닌 항목은 reference placeholder를 만들 수 없다.
   - EndpointSlice 분석은 slice와 endpoint target/address identity, canonical address, duplicate, 개별·전체 endpoint/address 상한을 적용하고 partial observed 결과를 만들지 않는다. `ready`, `serving`, `terminating`은 Kubernetes nil 기본값을 포함해 별도 집계하며 Service summary가 관측 readiness, traffic readiness, draining 상태와 `publishNotReadyAddresses` 의도를 구분한다. Service selector와 NetworkPolicy peer는 첫 번째 유효 고유 Service/Pod/Namespace만 평가한다.
   - Workload/Pod status count는 공통 non-negative bounded scalar 경계를 사용하고 malformed 값은 `invalid` summary와 warning 상태로 fail-closed 처리한다.
   - Service schema/summary/status는 live/upload 독립 module에서 type 기본값, canonical single/dual-stack ClusterIP, IP family/policy 대응, ExternalName, port/name/protocol, targetPort/nodePort/appProtocol, internal/external traffic policy, healthCheckNodePort, loadBalancerClass/node-port allocation, ClientIP session timeout과 selector syntax/cardinality를 검증한다. `externalIPs`·source ranges·trafficDistribution은 bounded allowlist/count summary로 처리하고 deprecated `loadBalancerIP`는 주소를 보존하지 않는 marker로만 decode한다. invalid spec과 ExternalName selector는 Pod 비교 전에 차단하고 원격 원문 대신 `invalid`/safe summary와 kind-level diagnostic만 남긴다.
   - Ingress schema/summary/status도 live/upload 독립 module에서 class, rule/path, Service/resource backend와 port, TLS host/Secret, collection 상한을 검증한다. status load-balancer IP/hostname 원문은 보존하지 않고 address/port/error count만 요약하며 malformed spec/status는 warning과 kind-level diagnostic으로 표시하고 backend edge를 만들지 않는다.
   - Gateway listener/address와 route parent/backend/status condition도 live/upload 독립 module에서 공식 collection/문법 경계를 검증한다. 주소와 condition message 원문은 보존하지 않고 type/count만 요약하며 malformed spec/status는 warning diagnostic과 edge 추론 중단으로 fail-closed 처리한다.
   - HPA target/metric/status도 live/upload 독립 module에서 scale target API version, replica range, metric source/target/current type, Quantity와 condition collection을 검증한다. metric name·selector·quantity·condition message 원문은 보존하지 않고 type/count만 요약하며 malformed spec/status는 warning diagnostic과 edge 추론 중단으로 fail-closed 처리한다.
   - Workload Pod template image/reference/status는 live/upload 독립 module에서 container/image/ServiceAccount/imagePullSecret/env/volume collection과 identity를 검증한다. raw env value/key는 보존하지 않고 malformed template은 warning/invalid summary와 phantom edge 억제로 fail-closed 처리한다.
   - Pod runtime state/reason/restart/image는 live/upload 독립 module에서 phase, current/last state union, container identity, count와 image 문법을 검증한다. status message, imageID, containerID는 보존하지 않고 malformed runtime status는 warning/invalid summary와 kind-level diagnostic으로 fail-closed 처리한다.
   - Node capacity/allocatable/condition/runtime summary는 live/upload 독립 module에서 quantity, count, version, runtime 문법과 collection 상한을 검증한다. 주소와 machine/system/boot identifier, condition message는 보존하지 않고 malformed status는 warning/invalid summary와 kind-level diagnostic으로 fail-closed 처리한다.
   - PV/PVC/StorageClass summary는 live/upload 독립 module에서 quantity, access/volume mode, phase, reclaim/binding policy, provisioner와 collection 상한을 검증한다. CSI source, claimRef, parameters, mount option, storage Secret reference와 status message는 보존하지 않고 malformed spec은 warning/invalid summary와 storage edge 중단으로 fail-closed 처리한다.
   - ConfigMap summary는 live/upload 독립 module에서 data/binaryData key 문법, 중복, 합계 4,096개, immutable 값을 검증한다. live provider는 value를 디코딩·보존하지 않고 key index만 만들며 upload parser도 topology build 전에 value를 폐기한다. malformed map은 warning/invalid summary와 kind-level diagnostic으로 fail-closed 처리한다. 다음 provider 감사는 upload Secret data/stringData 값을 parse 직후 폐기하는 type/key-count 경계를 우선한다.

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
   - Saved-view control/summary와 folder/search/bulk/list JSX는 각각 표시 전용 panel/collection component로 분리됐다.
   - App sticky header와 connector/error 표시 formatter는 표시 component와 direct-tested pure module로 분리됐다.
   - API/storage/wire shape 변경 없이 shell은 controller 조정과 detail/list 연결만 담당한다.
   - 리소스 목록·saved view·Events·Logs export는 공용 browser download helper를 사용해 Blob URL lifecycle을 한 경계에서 관리한다.

3. Frontend regression coverage
   - App/Vite TypeScript config는 `noUnusedLocals`와 `noUnusedParameters`를 강제해 미사용 import, type, helper, controller return을 CI에서 차단한다.
   - `npm run test:unit`은 Desktop safe view와 diagnostic preset/reorder test-id, snapshot metadata/report summary, CSV 방어, Resource detail activity, saved-view model/storage helper를 검증한다.
   - Resource primary/page request generation, abort, stale completion 방지는 coordinator direct unit test로 검증한다.
   - Server pagination/filter/cursor/facet 계산은 별도 Go module과 direct unit test로 분리됐다.
   - Snapshot comparison reducer는 resource/relation/cluster 변화, clone 안정성, Secret-safe diff를 direct unit test로 검증한다.
   - Upload topology JSON import는 독립 sanitizer와 direct unit test로 collection cap, duplicate/dangling reference 거부, Secret/민감 metadata redaction을 검증한다.
   - CustomResource reference inference는 독립 bounded traversal과 direct unit test로 native/custom scope, cycle, depth, path, result cap을 검증한다.
   - Upload Gateway listener/address와 route parent/backend/status condition은 독립 parser module과 malformed-input/topology integration test로 검증한다.
   - Upload HPA target/metric/status는 독립 parser module과 malformed-input/topology integration test로 검증한다.
   - NetworkPolicy LabelSelector 평가는 독립 pure module에서 Kubernetes key/value/operator 문법, namespace scope, malformed/oversized fail-closed 동작을 검증한다.
   - Visual smoke는 주요 화면과 브라우저 통합에 집중해 CI 시간을 관리한다.

4. Desktop prototype scope reduction
   - Web product path는 standalone web/server를 유지하며 SSH/CM controls를 노출하지 않는다.
   - Desktop CM/SSH는 public installer가 없는 local prototype이다.
   - Local sidecar, direct Kubernetes bearer profile command, legacy browser server profile UI와 stale keychain smoke는 제거됐다.
   - Session layout validation/storage/import/export/reorder 모델은 panel에서 feature module로 분리되고 direct unit test가 추가됐다.
   - Diagnostic filter preset storage/normalization은 feature module로 분리됐고, core reorder test-id helper만 유지한다. 비핵심 reorder history/filter/density UI는 제거됐다.
   - Connection profile form, selected session summary, safe diagnostics primitive와 presentation helper가 panel에서 분리됐다.
   - Session group/card/bulk toolbar와 saved-layout toolbar/import conflict/folder/preset list는 표시 모듈로 분리됐다.
   - Saved-layout state/import conflict/selection controller와 transient focus/keyboard/drag reorder controller가 분리됐다. 실제 CM 사용 흐름 검증 후 prototype 유지 또는 archive 범위를 결정한다.
   - App shell에 있던 session/runtime load, subscription, credential/check/start/stop action은 desktop-only controller hook으로 분리됐으며 Tauri API의 lazy 경계는 유지한다.

5. Snapshot comparison follow-up
   - Metadata-only history export는 완료됐다.
   - 검증된 Diff JSON 두 개의 exported/resource/relation/cluster 및 change-type 요약 증감 비교를 지원한다.
   - Report 비교 모델은 raw item payload를 전달하지 않고 safe count summary만 생성한다.
   - History와 선택값은 저장하지 않고 Secret 값은 모든 비교/export/import에서 제외한다.
   - 스코프·변경 유형·검색·관계 유형 필터와 count 계산은 pure view model과 direct unit test로 분리돼 UI component가 safe result 렌더만 담당한다.

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
