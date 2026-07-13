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

3. Live Kubernetes connection hardening
   - Same-origin/API-base live mode, RBAC 부족 fallback, Events/Logs 권한 실패 UX를 실제 클러스터 기준으로 재검증한다.
   - Secret values, kubeconfig, cloud credential, private key는 계속 표시/저장/커밋하지 않는다.

4. Frontend code splitting
   - `ResourceExplorer.tsx`와 `DesktopCmSessionPanel.tsx`의 큰 UI state/helpers를 feature-local modules로 분리한다.
   - 우선순위는 hook ordering, keyboard navigation, localStorage preference boundary, export/import safe payload helpers다.

5. Bundle size cleanup
   - Vite build의 500 kB chunk warning을 줄이기 위해 Resource Explorer/Desktop prototype routes나 heavy panels의 lazy loading을 검토한다.

6. Local automation hygiene
   - `scripts/notify-telegram.mjs`처럼 CLI entrypoint와 reusable helper를 분리하는 패턴을 다른 scripts에도 적용한다.
   - Telegram token은 `TELEGRAM_BOT_TOKEN_TWO`를 우선 사용하고, 필요하면 `--require-token-source TELEGRAM_BOT_TOKEN_TWO`로 fallback을 금지한다.

## Current Guardrails

- Git 작업은 사용자가 명시 요청할 때만 한다.
- 작업 전/후 `website/dist`, `website/artifacts/visual-smoke`, `desktop/src-tauri/binaries`와 preview/Playwright/Tauri 프로세스를 정리한다.
- UI 작업 여부와 무관하게 작업 후 현재 화면 스크린샷을 남긴다.
- 작업 완료 전 typecheck/build/test/audit와 민감값 스캔을 수행한다.
