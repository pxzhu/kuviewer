# Kuviewer Next Work

이 문서는 `CODEX_HANDOFF.md`의 긴 완료 로그 대신 다음 작업 판단에 필요한 현재 후보만 요약한다.

## Recommended Order

1. Documentation pruning
   - `CODEX_HANDOFF.md`의 반복적인 Desktop CM documentation-checker 완료 로그를 archival summary로 접는다.
   - 완료 로그와 실제 후보를 분리해 다음 작업 선택 비용을 낮춘다.

2. Runtime architecture decision
   - Web product path는 standalone web/server 배포로 유지한다.
   - Desktop CM/SSH code는 public installer/download가 아닌 local prototype으로 유지하거나 별도 archive 범위로 줄인다.
   - Web app에는 SSH/CM controls를 노출하지 않는다.

3. Live Kubernetes connection verification
   - Safe resource capability probe와 connector matrix, 10초 기본 snapshot cache/in-flight request sharing, Resource API server-side filter/cursor pagination은 구현됐다. Same-origin/API-base live mode, authentication/RBAC/reachability/server 진단, capability 분류와 대규모 resource page loading을 실제 클러스터 기준으로 재검증한다.
   - Secret values, kubeconfig, cloud credential, private key는 계속 표시/저장/커밋하지 않는다.

4. Snapshot comparison refinement
   - Cluster summary, 관계 변경 drill-down, 80개 초과 결과 windowing, relation-type grouping/multi-filter, safe JSON/CSV export, 최대 8개 browser-memory baseline/current history, history rename/inline-confirm delete, strict versioned diff JSON validation/read-only preview는 구현됐다.
   - 다음은 diff report끼리의 summary 비교 또는 history metadata export가 실제 사용에 필요한지 검토한다.
   - history와 선택값은 저장하지 않고 Secret 값은 비교 결과와 import preview에도 노출하지 않는다.

5. Remaining bundle cleanup
   - Desktop CM API와 Resource Explorer list/detail을 별도 lazy chunk로 분리했다.
   - TopologyCanvas도 dispatcher, shared layout, mobile SVG, desktop React Flow entry로 분리했고 React Flow JS/CSS는 desktop renderer에서만 로드한다.
   - Resource Explorer detail workspace의 shared types, health/overview 계산, Event/Log/Relation activity helper, UI primitives를 stateful orchestrator에서 분리했고 실제 앱 소스를 검사하지 않던 typecheck script도 project-reference 검증으로 수정했다.
   - 다음은 stateful Events/Logs controller hook과 큰 JSX section을 별도 panel component로 분리한다.

6. Local automation hygiene
   - `scripts/notify-telegram.mjs`처럼 CLI entrypoint와 reusable helper를 분리하는 패턴을 다른 scripts에도 적용한다.
   - Telegram token은 `TELEGRAM_BOT_TOKEN_TWO`를 우선 사용하고, 필요하면 `--require-token-source TELEGRAM_BOT_TOKEN_TWO`로 fallback을 금지한다.

## Current Guardrails

- Git 작업은 사용자가 명시 요청할 때만 한다.
- 작업 전/후 `website/dist`, `website/artifacts/visual-smoke`, `desktop/src-tauri/binaries`와 preview/Playwright/Tauri 프로세스를 정리한다.
- UI 작업 여부와 무관하게 작업 후 현재 화면 스크린샷을 남긴다.
- 작업 완료 전 typecheck/build/test/audit와 민감값 스캔을 수행한다.
