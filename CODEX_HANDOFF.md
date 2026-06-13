# Kuviewer Codex Handoff

## 실제 작업 경로

- 프로젝트 루트: `/Users/pxzhu/vscode/kuviewer`
- 이전에 잘못 잡혔던 경로: `/Users/pxzhu/Desktop/vscode/kuviewer`
- 위 잘못된 경로에 만들었던 심볼릭 링크는 제거했음.
- 새 세션/VSCode/Codex는 아래처럼 실제 폴더에서 열 것.

```zsh
cd /Users/pxzhu/vscode/kuviewer
code .
```

## 프로젝트 목표

Kuviewer는 Kubernetes 리소스를 웹에서 시각적으로 보는 도구다. 우선순위는 다음과 같다.

- 터미널 없이 Cluster, Node, Namespace, Pod, Deployment, StatefulSet, Service, Secret, ConfigMap, PVC/PV 등을 토폴로지로 확인한다.
- YAML/JSON/ZIP 업로드만으로도 SaaS 정적 사이트처럼 토폴로지와 트래픽 흐름을 볼 수 있어야 한다.
- 나중에 실제 Kubernetes API, admin token, Azure 인증, 클러스터 내부 agent/백엔드 연결을 확장한다.
- 기술 스택은 무료 사용 가능해야 하며, 프론트 디자인은 Tailwind CSS 기반이다.

## 현재 구현 상태

- 프론트: `website` 폴더의 React + Vite + Tailwind CSS.
- 토폴로지: `@xyflow/react` 기반이며 노드 드래그, fit/reset, 트래픽/시스템 토글이 있다.
- 데이터 소스 모드:
  - `YAML 업로드`: 프론트 단독 파싱 및 토폴로지 생성.
  - `목업 데모`: 복잡한 임의 Kubernetes 인프라 데이터 표시.
  - `실시간 클러스터`: API 설정이 있을 때만 연결.
- UI는 주요 문구를 한글화했다. Kubernetes 리소스 Kind, 실제 리소스 이름, raw status/value는 식별성을 위해 일부 영어를 유지한다.
- `/kuviewer` 하위 배포를 위해 Vite base를 `/kuviewer/`로 설정했다.
- `VITE_API_BASE_URL`이 없으면 API base URL은 빈 값으로 처리한다. 정적 업로드/목업 모드는 API 없이 동작한다.
- 기본 visual smoke URL은 `http://127.0.0.1:4174/kuviewer/`다.

## 최근 변경 파일

- `website/vite.config.ts`: `base: '/kuviewer/'` 추가.
- `website/src/services/topologyApi.ts`: `VITE_API_BASE_URL` 없을 때 API 호출 비활성화.
- `website/scripts/visual-smoke.mjs`: 기본 검증 URL을 `/kuviewer/` preview 경로로 변경.
- 이전 작업에서 한글화 및 토폴로지/트래픽 UI 개선 파일:
  - `website/src/app/App.tsx`
  - `website/src/components/*`
  - `website/src/features/topology/useTopology.ts`
  - `website/src/features/upload/parseKubernetesFiles.ts`

## 검증된 명령

```zsh
cd /Users/pxzhu/vscode/kuviewer/website
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

운영 배포 목표 경로:

```text
https://nebbixh.com/kuviewer
```

## 다음 할 일

1. Git 초기화/분리 관리 결정
   - 현재 `/Users/pxzhu/vscode/kuviewer`는 git repo가 아님.
   - 프론트 정적 배포 중심이면 별도 repo로 관리해도 괜찮음.
   - server/API까지 같이 배포할 계획이면 같은 repo 유지가 버전 매칭에 유리함.

2. 정적 배포 연결
   - `website/dist`를 `nebbixh.com/kuviewer` 하위에 서빙.
   - 서버는 SPA fallback을 `/kuviewer/* -> /kuviewer/index.html`로 잡아두는 것이 안전함.
   - 현재 앱은 React Router를 쓰지 않고 query string 중심이라 fallback 의존도는 낮지만, 새로고침 안정성을 위해 권장.

3. 업로드 모드 강화
   - 더 많은 Kubernetes kind 지원 여부 검토: Job, CronJob, NetworkPolicy, HPA 등.
   - YAML 파싱 경고 UI를 더 친절하게 표시.
   - 업로드된 파일 묶음의 cluster/name metadata 입력 옵션 검토.

4. 실제 Kubernetes 연결 설계
   - 브라우저에 kube credential을 직접 넣지 않는 방향 유지.
   - 선택지는 백엔드 API 또는 클러스터 내부 read-only agent.
   - live mode는 `VITE_API_BASE_URL` 또는 같은 origin proxy가 있을 때만 활성화.
   - RBAC는 read-only로 시작하고 Secret 값은 숨김 유지.

5. 배포 전 추가 검증
   - `npm run build` 후 `dist` 파일만 nginx/static server에 올려 `/kuviewer`에서 확인.
   - `KUVIEWER_VISUAL_URL=https://nebbixh.com/kuviewer/ npm run test:visual`로 운영 URL smoke 검증.

## 중요한 메모

- 프론트 코드만으로 가능한 범위: YAML/JSON/ZIP 업로드, 파싱, 토폴로지 생성, 트래픽 흐름 추론, 필터링, 내보내기.
- 프론트 코드만으로 하면 안 되는 범위: 실제 kube API 호출, `kubectl`, `az login`, kube credential 저장/전달.
- admin token 기본값은 로컬 개발에서 `kuviewer-admin`으로 사용했지만, 정적 업로드 모드에서는 필요 없다.
