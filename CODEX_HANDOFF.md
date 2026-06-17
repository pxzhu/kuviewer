# Kuviewer Codex Handoff

## 작업 경로

- 프로젝트 루트는 이 저장소 checkout 경로다.
- 새 세션/VSCode/Codex는 저장소 루트에서 열 것.

## 프로젝트 목표

Kuviewer는 Kubernetes 리소스를 웹에서 시각적으로 보는 도구다. 우선순위는 다음과 같다.

- 터미널 없이 Cluster, Node, Namespace, Pod, Deployment, StatefulSet, Service, Secret, ConfigMap, PVC/PV 등을 토폴로지로 확인한다.
- YAML/JSON/ZIP 업로드만으로도 SaaS 정적 사이트처럼 토폴로지와 트래픽 흐름을 볼 수 있어야 한다.
- 나중에 실제 Kubernetes API, admin token, Azure 인증, 클러스터 내부 agent/백엔드 연결을 확장한다.
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
- NetworkPolicy는 `applies-to`와 함께 `allows-ingress` / `allows-egress` 정책 의도 edge를 표시한다. 이는 실제 CNI traffic 관측이 아니라 spec 기반 해석이며, `matchLabels`와 `In`/`NotIn`/`Exists`/`DoesNotExist` `matchExpressions`를 edge 추론에 사용하고 `ipBlock`은 summary-only로 둔다.
- `리소스 탐색`은 Kubernetes 리소스용 읽기 전용 목록/상세 패널을 제공한다. 목록은 ArrowUp/ArrowDown, Home/End, Enter-to-detail focus 키보드 탐색을 지원한다. 상세에는 접기/펼치기 가능한 metadata, labels/annotations, safe status/summary preview, raw manifest가 아닌 safe YAML preview, topology relations, live Events, live Pod logs 영역이 포함된다. 상세 패널은 섹션 점프 버튼과 로컬 키보드 탐색을 제공하지만 리소스 데이터는 저장하지 않는다.
- `리소스 탐색` saved view는 사용자가 명시 저장한 목록 필터만 `localStorage`에 보관한다. 저장 대상은 검색어, cluster, namespace, kind, status이며 리소스 데이터/Events/Logs/Secret value/admin token은 저장하지 않는다. 리소스 목록 표시 밀도는 `kuviewer_resource_list_density`, 로그 표시 밀도는 `kuviewer_log_density`에 각각 `comfortable | compact` UI preference만 저장한다.
- live Kubernetes mode에서는 선택 리소스의 core v1 Events를 `involvedObject` field selector로 조회한다. 현재 표시된 Events에는 브라우저 로컬 텍스트 필터, severity/type 필터, `all`/`1h`/`6h`/`24h`/`7d` 시간 범위 필터, 최신순/오래된순 정렬, 세션 한정 pinning을 적용할 수 있으며 필터 텍스트와 선택값, pinned Events는 저장하지 않는다. timestamp가 없거나 파싱 불가능한 Event는 `all` 시간 범위에서만 표시하고 정렬 시 timestamp가 있는 Event 뒤에 둔다. Warning/Error 성격 Events를 Normal보다 먼저 그룹화한다. RBAC/클러스터 차이로 Events 조회가 안 되면 전체 상세 실패 대신 빈 Events와 안전한 warning을 표시한다.
- live Kubernetes mode에서는 선택 Pod의 최근 200줄 logs를 버튼 클릭 시 조회하거나 현재 로그를 따라갈 수 있다. container/initContainer 선택과 previous terminated container 조회를 지원하고, follow 연결은 현재 로그에만 적용된다. logs는 저장하지 않으며, 브라우저는 follow 중 최근 500줄만 표시한다. follow는 stream 연결을 끊지 않고 일시정지/재개할 수 있으며 pause 중 수신된 로그는 최대 500줄 pending buffer에만 보관한다. 현재 표시된 로그에 한해 timestamp prefix 표시/시간 범위 필터, 수신순/최신순/오래된순 정렬, 로컬 텍스트 필터, 표시 밀도 전환, 사용자 클릭 기반 raw line clipboard 복사와 브라우저 로컬 `.log` 다운로드를 제공한다. timestamp가 없거나 파싱 불가능한 로그는 `all` 시간 범위에서만 표시하고 시간 정렬에서는 timestamp가 있는 로그 뒤에 둔다. RBAC/클러스터 차이로 조회가 안 되면 전체 상세 실패 대신 빈 Logs와 안전한 warning을 표시한다.
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
   - Pod logs 1차 범위, previous logs 조회, current-log follow, follow pause/resume, 로컬 로그 필터링, timestamp parsing/time range, sort toggle, raw line copy/download UX, 로그 표시 밀도 전환은 완료됐다.
   - 이벤트 필터링과 리소스 상세 UX 밀도 개선은 완료됐다.
   - 리소스 리스트 saved view/query preset은 완료됐다.
   - 리소스 관계 검색/그룹화와 토폴로지 이동 UX는 완료됐다.
   - 리소스 상세 섹션 점프/키보드 탐색과 Event severity grouping은 완료됐다.
   - 리소스 리스트 키보드 탐색, density preset, Event 시간 범위 필터, Event 정렬/세션 pinning은 완료됐다.
   - YAML Flow 독립 link preview thumbnail, 투명 favicon/apple-touch icon, D 기본/B Radar theme toggle은 완료됐다.
   - 다음 확장 후보는 resource detail layout polish 또는 log search highlighting refinements다.

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
