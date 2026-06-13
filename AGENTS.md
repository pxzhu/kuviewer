# Kuviewer Agent Rules

## Git rules

이 프로젝트의 Git 작업은 `/Users/pxzhu/vscode/website/GIT_WORKFLOW.md`의 Git 규칙을 기준으로 한다.

핵심 규칙:

1. `main` 브랜치에서 직접 커밋하지 않는다.
2. 작업이 커밋까지 필요하면 `feat/*`, `fix/*`, `docs/*`, `chore/*` 같은 목적 브랜치를 먼저 만든다.
3. 커밋 전 `git status`와 `git diff`로 변경 범위를 확인한다.
4. UI 변경은 typecheck/build와 실제 화면 QA를 수행한다.
5. token, kubeconfig, private key, Secret value, cloud credential은 커밋하지 않는다.
6. 커밋 메시지는 `type(scope): summary` 형식을 사용한다.

## Project rules

1. 초기 구현은 mock data first로 진행한다.
2. 인증은 MVP에서 사용자 계정 없이 `no-auth + admin token` 방식으로 둔다.
3. 실제 Kubernetes 연결 전까지 Secret value는 어떤 형태로도 표시하지 않는다.
4. native Kubernetes를 1차 기준으로 설계하고, k3s/AKS는 후속 검증 대상으로 둔다.
5. 프론트엔드는 Tailwind CSS를 사용한다.
