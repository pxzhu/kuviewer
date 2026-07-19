# Kuviewer Next Work

이 문서는 다음 작업 판단에 필요한 현재 후보만 유지한다. 완료 이력은 `docs/archive/2026-07-completed-work-summary.md`를 본다.

## Recommended Order

1. Live Kubernetes connection verification
   - Native Kubernetes, k3s, AKS에서 same-origin/API-base live mode를 검증한다.
   - Capability/RBAC/reachability, Events, Pod logs, Gateway/CRD optional resources를 확인한다.
   - 10초 snapshot cache, in-flight sharing, server filter/cursor pagination을 실제 규모에서 측정한다.
   - 출력은 safe metadata로 제한하고 Secret value, token, kubeconfig, private key를 기록하지 않는다.

2. Resource Explorer panel extraction
   - Events/Logs 요청·취소·stream 상태는 controller hook으로 분리됐다.
   - Relations, Events, Logs의 section/control/output은 표시 전용 component로 분리됐다.
   - Resource list와 resource bulk toolbar는 표시 전용 component로 분리됐다.
   - Saved-view validation, storage, order/group, import/merge/conflict, team compare 모델은 feature module과 unit test로 분리됐다.
   - Saved-view UI state와 save/import/conflict/team sync/reorder action은 controller hook으로 분리됐다.
   - Saved-view control/summary/folder/search/bulk/list JSX는 표시 전용 panel component로 분리됐다.
   - API/storage/wire shape 변경 없이 렌더링 범위와 회귀 위험을 줄인다.

3. Frontend regression coverage
   - `npm run test:unit`은 Desktop safe view, snapshot metadata, CSV 방어, Resource detail activity, saved-view model/storage helper를 검증한다.
   - Server pagination/filter/cursor/facet 계산은 별도 Go module과 direct unit test로 분리됐다.
   - Snapshot comparison reducer는 resource/relation/cluster 변화, clone 안정성, Secret-safe diff를 direct unit test로 검증한다.
   - Visual smoke는 주요 화면과 브라우저 통합에 집중해 CI 시간을 관리한다.

4. Desktop prototype scope reduction
   - Web product path는 standalone web/server를 유지하며 SSH/CM controls를 노출하지 않는다.
   - Desktop CM/SSH는 public installer가 없는 local prototype이다.
   - Session/layout UI를 더 분리할지, prototype archive로 축소할지 실제 사용 후 결정한다.

5. Snapshot comparison follow-up
   - Metadata-only history export는 완료됐다.
   - Diff report-to-report summary 비교는 실제 사용 요구가 확인될 때만 추가한다.
   - History와 선택값은 저장하지 않고 Secret 값은 모든 비교/export/import에서 제외한다.

6. Local automation hygiene
   - CLI entrypoint와 reusable helper 분리 패턴을 다른 scripts에도 적용한다.
   - Telegram은 `TELEGRAM_BOT_TOKEN_TWO`를 우선하고 필요하면 required token-source guard를 사용한다.

## Current Guardrails

- Git 작업은 사용자가 명시 요청할 때만 한다.
- 작업 전후 `website/dist`, `website/artifacts/visual-smoke`, `desktop/src-tauri/binaries`와 임시 프로세스를 정리한다.
- UI 작업 여부와 관계없이 작업 후 현재 화면 스크린샷을 남긴다.
- typecheck, unit/build/visual tests, backend tests, audit와 민감값 검사를 수행한다.
