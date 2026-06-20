# Kuviewer Codex Handoff

## 작업 경로

- 프로젝트 루트는 이 저장소 checkout 경로다.
- 새 세션/VSCode/Codex는 저장소 루트에서 열 것.

## 프로젝트 목표

Kuviewer는 Kubernetes 리소스를 웹에서 시각적으로 보는 도구다. 우선순위는 다음과 같다.

- 터미널 없이 Cluster, Node, Namespace, Pod, Deployment, StatefulSet, Service, Secret, ConfigMap, PVC/PV 등을 토폴로지로 확인한다.
- YAML/JSON/ZIP 업로드만으로도 SaaS 정적 사이트처럼 토폴로지와 트래픽 흐름을 볼 수 있어야 한다.
- 나중에 실제 Kubernetes API, admin token, Azure 인증, 클러스터 내부 agent/백엔드 연결을 확장한다.
- 서버/클러스터 연결 시 리소스, 관계, Events, Logs를 읽기 전용으로 탐색할 수 있는 설치형 CM/SSH 세션 탐색 앱을 장기 목표에 둔다. macOS `.dmg`와 Windows `.exe` packaging 경로는 Tauri-first로 유지한다. 설치형 앱은 CM/SSH session manager multiple sessions 관리가 목표이며, web app must not expose SSH. 기존 local sidecar/API 경로는 prototype-only로 둔다.
- 기술 스택은 무료 사용 가능해야 하며, 프론트 디자인은 Tailwind CSS 기반이다.

## 현재 구현 상태

- 프론트: `website` 폴더의 React + Vite + Tailwind CSS.
- 기본 UI 테마는 D번 YAML Flow 브랜드 시안 기반의 밝은 문서-토폴로지 스타일이다. 헤더의 B/D 버튼으로 B번 Radar dark 테마를 선택할 수 있으며, 선택값은 UI preference로만 localStorage에 저장한다. 공유 썸네일은 테마와 무관하게 D번 YAML Flow 전용 asset을 사용한다.
- 토폴로지: `@xyflow/react` 기반이며 노드 드래그, fit/reset, 트래픽/시스템 토글이 있다.
- 데이터 소스 모드:
  - `YAML 업로드`: 프론트 단독 파싱 및 토폴로지 생성.
  - `목업 데모`: 복잡한 임의 Kubernetes 인프라 데이터 표시.
  - `실시간 클러스터`: API 설정이 있을 때만 연결.
- UI는 주요 문구를 한글화했다. Kubernetes 리소스 Kind, 실제 리소스 이름, raw status/value는 식별성을 위해 일부 영어를 유지한다.
- `/kuviewer` 하위 배포를 위해 Vite base를 `/kuviewer/`로 설정했다.
- standalone subdomain 배포를 위해 `VITE_BASE_PATH=/`로 루트 경로 빌드도 가능하게 했다.
- `VITE_API_BASE_URL`이 없으면 API base URL은 빈 값으로 처리한다. 정적 업로드/목업 모드는 API 없이 동작한다.
- 기본 visual smoke URL은 `http://127.0.0.1:4174/kuviewer/`다.
- standalone 배포는 별도 subdomain을 host gateway에서 내부 `127.0.0.1:18085`로 라우팅하는 구성을 기준으로 한다.
- 설치형 클러스터 탐색 앱 packaging spike와 Tauri desktop shell scaffold는 `desktop/packaging-spec.json`, `desktop/README.md`, `desktop/package.json`, `desktop/src-tauri/*`, `scripts/check-desktop-packaging-spec.mjs`로 시작했다. 권장 방향은 Tauri-first, fallback은 Electron이며, 첫 대상은 macOS `.dmg`와 Windows `.exe`다. 제품 방향은 CM/SSH session manager multiple sessions를 관리하는 설치형 앱이며, web app must not expose SSH. 현재 구현은 desktop-only CM/SSH session manager로 `desktop_cm_sessions`, `desktop_save_cm_session`, `desktop_select_cm_session`, `desktop_delete_cm_session`, `desktop_import_cm_session_private_key`, `desktop_delete_cm_session_credential`, `desktop_check_cm_session` Tauri command를 통해 `name/host/port/user/status/description/credentialAvailable/lastCheckStatus` 같은 safe metadata와 연결 확인 결과만 프론트에 반환한다. Private key는 Rust layer가 OS credential store에만 저장하고 브라우저 state/localStorage/export/log에는 본문을 노출하지 않는다. Remote API, local sidecar, direct API/keychain runtime 경로는 prototype-only scaffold로 남기고 desktop product default로 보지 않는다. local sidecar는 `KUVIEWER_DESKTOP_ENABLE_PROTOTYPE_SIDECAR=1`일 때만 시작한다. `desktop-readonly` capability는 shell/fs 권한 없이 `core:default`만 허용한다. Desktop build prerequisites, generated `.icns`/`.ico` icon assets, icon source policy, signing boundaries는 `desktop/BUILD_PREREQUISITES.md`와 machine-checked packaging spec에 기록했다. `.github/workflows/desktop-package.yml`은 manual-only package workflow이며 unsigned build가 기본이다. 2026-06-19에 run `27800527207`로 unsigned macOS DMG dry-run이 성공했고 `Kuviewer_0.1.0_aarch64.dmg` artifact가 업로드됐다. 같은 날 run `27803179419`로 unsigned Windows NSIS EXE dry-run이 성공했고 `Kuviewer_0.1.0_x64-setup.exe` artifact가 업로드됐다. Desktop package workflow는 `package_version` 입력, `KUVIEWER_DESKTOP_VERSION`, `v*` tag ref, fallback `0.1.0` 순서로 package version을 resolve하고 CI workspace의 `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`만 빌드 전에 맞춘다. 업로드 artifact 이름은 `kuviewer-macos-dmg-{version}` / `kuviewer-windows-exe-{version}` 형태를 쓴다. `smoke_matrix` 입력은 unsigned macOS DMG와 Windows EXE package smoke를 한 dispatch에서 실행하고 산출물은 GitHub Actions artifact로만 보관한다. `signed` 입력을 켜면 macOS는 CI secrets의 Developer ID `.p12`를 임시 runner keychain에 import하고 Apple notarization env를 Tauri build에 넘긴 뒤 keychain을 삭제한다. Windows는 CI secrets의 PFX를 CurrentUser certificate store에 import하고 thumbprint를 CI workspace Tauri config에 주입한 뒤 certificate를 삭제한다. CI는 desktop packaging spec check, CM/SSH session runtime smoke, sidecar build dry-run check를 실행한다.
- 기존 keychain prototype 기록은 `desktop/KEYCHAIN_CREDENTIAL_DESIGN.md`에 남아 있다. 해당 prototype은 macOS Keychain과 Windows Credential Manager를 쓰고, `desktop_kubernetes_profiles`, `KUVIEWER_DESKTOP_KUBE_TOKEN_FILE`, `scripts/smoke-desktop-keychain-runtime.mjs`로 safe metadata/runtime smoke를 검증할 수 있지만, 현재 제품 UI에서는 숨겨져 있고 active smoke는 `scripts/smoke-desktop-cm-sessions.mjs`다.
- NetworkPolicy는 `applies-to`와 함께 `allows-ingress` / `allows-egress` 정책 의도 edge를 표시한다. 이는 실제 CNI traffic 관측이 아니라 spec 기반 해석이며, `matchLabels`와 `In`/`NotIn`/`Exists`/`DoesNotExist` `matchExpressions`를 edge 추론에 사용하고 `ipBlock`은 summary-only로 둔다.
- `리소스 탐색`은 Kubernetes 리소스용 읽기 전용 목록/상세 패널을 제공한다. 목록은 ArrowUp/ArrowDown, Home/End, Enter-to-detail focus 키보드 탐색과 현재 필터 결과에 대한 memory-only bulk selection을 지원한다. bulk selection은 checkbox, Space toggle, Shift+Arrow/Home/End range selection, Ctrl/⌘+A 전체 선택, Escape 해제를 지원한다. bulk copy/export는 사용자 클릭으로만 실행하고 cluster/namespace/kind/name/status/count/summary key/relation count 같은 safe inventory만 포함한다. 상세에는 scope/age/owner/signals 요약, 섹션 점프 배지, 접기/펼치기 가능한 metadata, labels/annotations, safe status/summary preview, raw manifest가 아닌 safe YAML preview, topology relations, live Events, live Pod logs 영역이 포함된다. Status 섹션은 기존 safe status/summary에서 Pod readiness, restarts, replica gap, Service endpoint gap, Job failure, PVC/PV phase, routing/policy intent 같은 health signals를 계산해 표시한다. 상세 패널은 로컬 키보드 탐색을 제공하지만 리소스 데이터는 저장하지 않는다.
- `리소스 탐색` saved view는 사용자가 명시 저장한 목록 필터와 name/group/order metadata만 보관한다. 저장 대상은 검색어, cluster, namespace, kind, status, group, order이며 quick apply, grouped sections, folder summary/chips와 보이는 folder 전체 접기/펼치기, saved view name/group/filter summary 기반 in-memory 검색, 검색 해제 상태에서 group 내부 drag handle/up-down 순서 변경, bulk selection 기반 선택 export/group 이동/inline confirm 삭제, 같은 이름 업데이트, inline rename, group 이동, 현재 필터 매칭/미저장 표시, 필터 초기화, 필터 전용 URL 공유, scope/timestamp 파일명 JSON export, array 또는 `{ items }` JSON import를 지원한다. Import/export summary는 파일명, valid/skipped 수, folder 목록, import 형식만 화면 메모리에 표시한다. Resource Explorer 필터 변경은 `view=resources`와 선택적 `source`/`resourceQuery`/`resourceCluster`/`resourceNamespace`/`resourceKind`/`resourceStatus` query로 조용히 동기화된다. 기본 필터는 URL에서 생략하고, 현재 데이터에 없는 값은 `all`로 fallback하며, topology/traffic 이동 시 resource filter query를 제거하고, 브라우저 back/forward는 view/source/filter를 복원한다. 개인 quick cache는 `localStorage` key `kuviewer_resource_view_presets`를 쓰고, saved view folder collapse UI preference는 `kuviewer_resource_view_collapsed_groups`를 쓴다. Saved view 검색어, folder chip 상태 중 collapse preference 외 항목, import/export summary, team compare preview, team sync summary, bulk selection 상태는 UI-only라 localStorage/team saved view/export/import/URL에 저장하지 않으며, 검색 중에는 숨겨진 항목 순서가 바뀌지 않도록 reorder control을 비활성화한다. Live Cluster/admin token 상태에서는 `GET/PUT /api/resource-views`로 서버 공용 team saved view를 명시적으로 불러오거나 저장할 수 있다. Team API 응답은 `{ items, metadata }` shape이며 metadata에는 saved view collection용 version, updatedAt, count, storage만 포함한다. Team load는 local-vs-team compare preview에서 신규/변경/동일/로컬 전용/skipped/max-limit 제외 예정 count와 서버 snapshot metadata를 확인한 뒤 명시 반영한다. Team save도 현재 브라우저 saved view와 서버 team collection을 먼저 비교하고 신규/변경/동일/서버 제외 예정 항목과 현재 서버 snapshot을 보여준 뒤 팀 저장을 실행한다. Team load/save 완료 후에는 count, skipped, folder 목록, local-before count, conflict/new/duplicate count와 snapshot version/update time/count/storage를 화면 요약으로 표시한다. 서버 영속 저장은 `KUVIEWER_RESOURCE_VIEWS_FILE`이 설정된 경우에만 JSON file-backed store를 쓰고, 설정하지 않으면 runtime memory store를 쓴다. 기존 `{ items }` 파일은 migration 없이 계속 읽을 수 있고, 저장 시 metadata가 함께 기록된다. JSON export/import와 team sync 모두 preset 필드와 안전한 collection metadata만 포함하며 리소스 데이터/Events/Logs/Secret value/admin token/kubeconfig/cloud credential/private key는 저장하지 않는다. rename/group/order/bulk edit/JSON export/import/team sync는 사용자 클릭으로만 실행하며 local rename/group/order/bulk 변경은 사용자가 compare preview를 확인하고 팀 저장을 실행하기 전까지 team store에 자동 반영하지 않는다. import/team load에서 같은 이름+다른 필터 또는 group/order metadata 차이는 inline conflict panel로 해결하며, incoming 우선/현재 유지/이름 바꿔 둘 다 보관을 선택할 수 있다. 리소스 목록 정렬 preference는 `kuviewer_resource_list_sort`에 `{ field, direction }`만 저장하고 saved view/URL/team sync에는 포함하지 않는다. 리소스 목록 컬럼 preference는 `kuviewer_resource_list_columns`에 선택 컬럼 표시 여부만 저장하며 `Kind`/`Name`/`Status`는 항상 표시하고 saved view/URL/team sync에는 포함하지 않는다. 리소스 목록/상세/로그 표시 밀도는 각각 `kuviewer_resource_list_density`, `kuviewer_resource_detail_density`, `kuviewer_log_density`에 `comfortable | compact` UI preference만 저장한다. live Events 자동 새로고침과 warning 알림은 각각 `kuviewer_events_auto_refresh`, `kuviewer_events_warning_notifications`에 boolean UI preference만 저장한다.
- live Kubernetes mode에서는 선택 리소스의 core v1 Events를 `involvedObject` field selector로 조회한다. 리소스 선택 시 자동 조회하고, 사용자가 같은 리소스 Events를 수동 새로고침하거나 30초 자동 새로고침을 켤 수 있으며 조회 중/마지막 조회 시각은 화면에만 표시한다. 현재 표시된 Events에는 브라우저 로컬 텍스트 필터, severity/type 필터, `all`/`1h`/`6h`/`24h`/`7d` 시간 범위 필터, 최신순/오래된순 정렬, 세션 한정 pinning을 적용할 수 있으며 현재 보이는 Events만 사용자 클릭으로 CSV/JSON 브라우저 로컬 파일로 내보낼 수 있다. Warning 알림 preference가 켜져 있으면 초기 조회는 baseline만 잡고 이후 수동/자동 새로고침에서 새 Warning/Error Event가 보일 때 앱 내부 banner, 세션 한정 `NEW` 표시, `NEW N` count, `NEW만` 필터, `NEW 지우기` 액션을 제공한다. banner 닫기는 marker를 유지하고, 표시 지우기 또는 Events header의 `NEW 지우기`는 banner/marker/NEW-only 필터를 함께 초기화한다. 브라우저 시스템 알림 권한은 사용하지 않는다. 필터 텍스트와 선택값, pinned Events, refresh 상태, notification 상태/이력, NEW marker/filter, Event records, export 파일은 저장하지 않는다. Warning count는 detail badge/Signals/Events header에 표시하고, Event card는 type/reason/source/absolute time/relative age를 분리해 보여준다. timestamp가 없거나 파싱 불가능한 Event는 `all` 시간 범위에서만 표시하고 정렬 시 timestamp가 있는 Event 뒤에 두며 `timestamp unknown`으로 표시한다. Warning/Error 성격 Events를 Normal보다 먼저 그룹화한다. RBAC/클러스터 차이로 Events 조회가 안 되면 전체 상세 실패 대신 빈 Events와 안전한 warning을 표시한다.
- live Kubernetes mode에서는 선택 Pod의 최근 200줄 logs를 버튼 클릭 시 조회하거나 현재 로그를 따라갈 수 있다. container/initContainer 선택과 previous terminated container 조회를 지원하고, follow 연결은 현재 로그에만 적용된다. logs는 저장하지 않으며, 브라우저는 follow 중 최근 500줄만 표시한다. follow는 stream 연결을 끊지 않고 일시정지/재개할 수 있으며 pause 중 수신된 로그는 최대 500줄 pending buffer에만 보관한다. 현재 표시된 로그에 한해 timestamp prefix 표시/시간 범위 필터, 수신순/최신순/오래된순 정렬, 로컬 텍스트 필터, 검색 match count/current position, Enter/Shift+Enter와 이전/다음 버튼 이동, 표시 밀도 전환, 사용자 클릭 기반 raw line clipboard 복사와 브라우저 로컬 `.log` 다운로드를 제공한다. timestamp가 없거나 파싱 불가능한 로그는 `all` 시간 범위에서만 표시하고 시간 정렬에서는 timestamp가 있는 로그 뒤에 둔다. RBAC/클러스터 차이로 조회가 안 되면 전체 상세 실패 대신 빈 Logs와 안전한 warning을 표시한다.
- live/upload/mock mode에서 `CustomResourceDefinition` 정의 리소스를 read-only inventory node로 표시한다. group/kind/plural/scope/served versions/storage version summary를 보여준다. CRD 정의가 있으면 matching custom resource instance도 `CustomResource` 노드로 표시하되 raw spec/status 값은 숨기고 field count/condition summary와 안전한 spec reference 관계를 보여준다.
- Secret value, `data`, `stringData`, kubeconfig, cloud credential, private key는 계속 표시/저장/커밋하지 않는다. annotation은 민감해 보이는 key/value를 redaction한다.

## 최근 변경 파일

- `website/vite.config.ts`: `base: '/kuviewer/'` 추가.
- `website/vite.config.ts`: `VITE_BASE_PATH`로 `/` 또는 `/kuviewer/` base 선택 가능.
- `Dockerfile`: standalone Docker build 기본 base를 `/`로 설정하고 `VITE_API_BASE_URL` build arg를 추가.
- `deploy/standalone/*`: localhost-only compose와 env 예시 추가.
- `deploy/gateway/Caddyfile.kuviewer.example`: `kuviewer.example.com -> 127.0.0.1:18085` gateway 예시 추가.
- `website/public/robots.txt`, `website/public/sitemap.xml`: placeholder public URL 기준 검색 노출용 파일 추가.
- `website/src/services/topologyApi.ts`: `VITE_API_BASE_URL` 없을 때 API 호출 비활성화.
- `website/scripts/visual-smoke.mjs`: 기본 검증 URL을 `/kuviewer/` preview 경로로 변경.
- 이전 작업에서 한글화 및 토폴로지/트래픽 UI 개선 파일:
  - `website/src/app/App.tsx`
  - `website/src/components/*`
  - `website/src/features/topology/useTopology.ts`
  - `website/src/features/upload/parseKubernetesFiles.ts`

## 검증된 명령

```zsh
cd website
npm run typecheck
npm run build
npm run preview
npm run test:visual
```

통과 확인된 항목:

- TypeScript typecheck 통과.
- Vite build 통과.
- `dist/index.html` asset 경로가 `/kuviewer/assets/...`로 생성됨.
- `http://127.0.0.1:4174/kuviewer/` 200 확인.
- `/kuviewer/assets/...js` 200 확인.
- Playwright visual smoke 통과: desktop/mobile, 업로드 모드, 토폴로지, 트래픽 흐름, 노드 드래그.

## 로컬 확인 URL

preview 서버 실행 후 사용:

```text
http://127.0.0.1:4174/kuviewer/?source=upload
http://127.0.0.1:4174/kuviewer/?source=mock
```

운영 배포 목표 경로 예시:

```text
https://kuviewer.example.com/
```

## 다음 할 일

1. Git/브랜치 관리
   - 현재 저장소는 독립 Git repo다.
   - 첫 커밋은 `f2eeb7a chore(repo): bootstrap kuviewer repository`.
   - 작업 브랜치 규칙은 계속 `feat/*`, `fix/*`, `docs/*`, `chore/*`를 따른다.

2. standalone subdomain 배포 연결
   - Docker image를 `VITE_BASE_PATH=/` 기준으로 빌드한다.
   - `deploy/standalone/.env.example`을 `.env`로 복사하고 admin token placeholder를 교체한다.
   - `docker compose --env-file deploy/standalone/.env -f deploy/standalone/docker-compose.yml up -d`.
   - host gateway는 `kuviewer.example.com -> 127.0.0.1:18085` 같은 형태로 라우팅한다.
   - 기존 웹사이트와 외부 443을 공유할 수 있다.

3. 업로드 모드 강화
   - Job, CronJob, NetworkPolicy, HPA는 업로드/라이브 provider의 1차 지원 대상에 포함됐다.
   - NetworkPolicy ingress/egress intent summary와 `allows-ingress` / `allows-egress` edge 추론이 포함됐다.
   - Gateway/HTTPRoute/GRPCRoute/TLSRoute/TCPRoute는 Gateway API CRD가 있는 환경에서 optional 1차 지원 대상에 포함됐다.
   - 업로드 bundle의 cluster name/id 입력과 YAML 파싱/지원 kind 경고 UI가 포함됐다.
   - Resource Explorer Events/상세 강화는 완료됐다.
   - CRD discovery, custom resource instance discovery, custom relation inference 1차 범위는 완료됐다.
   - 읽기 전용 safe YAML preview는 완료됐다.
   - Pod logs 1차 범위, previous logs 조회, current-log follow, follow pause/resume, 로컬 로그 필터링, timestamp parsing/time range, sort toggle, log search highlighting/navigation, raw line copy/download UX, 로그 표시 밀도 전환은 완료됐다.
   - 이벤트 필터링과 리소스 상세 UX 밀도 개선은 완료됐다.
   - 리소스 리스트 saved view/query preset과 saved view polish는 완료됐다.
   - 리소스 관계 검색/그룹화와 토폴로지 이동 UX는 완료됐다.
   - 리소스 상세 섹션 점프/키보드 탐색과 Event severity grouping은 완료됐다.
   - 리소스 리스트 키보드 탐색, density preset, Event 시간 범위 필터, Event 정렬/세션 pinning은 완료됐다.
   - live Resource Explorer Events 수동 새로고침과 마지막 조회 상태 표시는 완료됐다.
   - live Resource Explorer Events 30초 자동 새로고침 preference는 완료됐다.
   - Resource Explorer Event detail polish와 Warning badge/relative time 표시는 완료됐다.
   - YAML Flow 독립 link preview thumbnail, 투명 favicon/apple-touch icon, D 기본/B Radar theme toggle은 완료됐다.
   - 리소스 상세 layout polish는 완료됐다.
   - Resource Explorer health signals refinement는 완료됐다.
   - Resource Explorer Events CSV/JSON export는 완료됐다.
   - Resource Explorer Events warning notification preference는 완료됐다.
   - Resource Explorer Events notification polish는 완료됐다.
   - Resource Explorer saved view sharing/export와 URL state sync는 완료됐다.
   - Resource detail table density polish는 완료됐다.
   - Resource Explorer server-side/team saved views는 완료됐다.
   - Resource Explorer table sorting은 완료됐다.
   - Resource Explorer saved view conflict polish는 완료됐다.
   - Resource Explorer table column polish는 완료됐다.
   - Resource Explorer saved view rename UX는 완료됐다.
   - Resource Explorer resource list bulk selection/read-only actions는 완료됐다.
   - Resource Explorer resource list keyboard multi-select polish는 완료됐다.
   - Resource Explorer saved view grouping은 완료됐다.
   - Resource Explorer saved view search/filter는 완료됐다.
   - Resource Explorer saved view drag/reorder는 완료됐다.
   - Resource Explorer saved view bulk management는 완료됐다.
   - Resource Explorer saved view folder polish는 완료됐다.
   - Resource Explorer saved view import/export polish는 완료됐다.
   - Resource Explorer saved view team sync polish는 완료됐다.
   - Resource Explorer saved view team compare preview는 완료됐다.
   - Resource Explorer saved view team snapshot metadata는 완료됐다.
   - 설치형 클러스터 탐색 앱 packaging spike는 완료됐다.
   - Tauri desktop shell scaffold는 완료됐다.
   - Desktop icon/signing/build prerequisites는 완료됐다.
   - Desktop generated `.icns`/`.ico` assets and signing CI scaffold는 완료됐다.
   - Desktop package workflow unsigned macOS DMG dry-run은 완료됐다.
   - Desktop package workflow unsigned Windows EXE dry-run은 완료됐다.
   - Desktop remote server connection profile UX는 완료됐다.
   - Desktop release artifact/versioning polish는 완료됐다.
   - Desktop signing/notarization CI path는 완료됐다.
   - Local sidecar evaluation scaffold는 완료됐다.
   - Local sidecar runtime launch integration은 완료됐다.
   - Desktop sidecar source/profile 설정 UX는 완료됐다.
   - Keychain-backed cluster credential design은 완료됐다.
   - Keychain-backed bearer-token profile runtime metadata prototype은 완료됐다.
   - OS credential store read/write helper와 native credential 삭제 UX는 완료됐다.
   - selected keychain profile로 sidecar restart/live Kubernetes 연결은 완료됐다.
   - Native credential runtime smoke 자동화는 완료됐다.
   - Desktop package smoke matrix 확장은 완료됐다.
   - Desktop-only CM/SSH session manager metadata-only 1차 구현은 완료됐다.
   - Desktop SSH credential store + connection check는 완료됐다.
   - 다음 확장 후보는 CM session tunnel/runtime integration이다.

4. 실제 Kubernetes 연결 설계
   - 브라우저에 kube credential을 직접 넣지 않는 방향 유지.
   - 선택지는 백엔드 API 또는 클러스터 내부 read-only agent.
   - live mode는 `VITE_API_BASE_URL` 또는 같은 origin proxy가 있을 때만 활성화.
   - RBAC는 read-only로 시작하고 Secret 값은 숨김 유지.

5. 배포 전 추가 검증
   - `npm run build` 후 `dist` 파일만 nginx/static server에 올려 `/kuviewer`에서 확인.
   - `KUVIEWER_VISUAL_URL=https://kuviewer.example.com/ npm run test:visual`처럼 운영 URL smoke 검증.

## 중요한 메모

- 프론트 코드만으로 가능한 범위: YAML/JSON/ZIP 업로드, 파싱, 토폴로지 생성, 트래픽 흐름 추론, 필터링, 내보내기.
- 프론트 코드만으로 하면 안 되는 범위: 실제 kube API 호출, `kubectl`, `az login`, kube credential 저장/전달.
- admin token 기본값은 로컬 개발에서 `kuviewer-admin`으로 사용했지만, 정적 업로드 모드에서는 필요 없다.
