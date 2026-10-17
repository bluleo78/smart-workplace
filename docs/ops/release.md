# 릴리스·운영 반영 절차

Gen:iA Works 운영(prod, kubecontext `iacloud-prod-public`, namespace `smart-workplace`) 반영 방법. 설계 배경은 WP-436.

```
① 준비 (/release prepare, 사람 확인)   노트 커밋 → main 머지·push → vX.Y.Z 태그 push
② 빌드 (GitLab CI, 태그에서만)          verify-tag → build-images → checklist → GitLab Release (+ trivy)
③ 반영 (사람, 로컬)                     node deploy/release/release.mjs deploy X.Y.Z
④ 되돌리기·상태                         release.mjs rollback / status
```

- 버전: `v` + semver. 깨지는 변경 → major, 기능 → minor, 수정 → patch(사람이 확정). 태그는 옮기지 않는다 — 잘못 나갔으면 다음 patch.
- 이미지: `docker.io/iacloudops/genia-works-<앱>` (private). 릴리스마다 바뀐 앱만 새로 빌드하고 나머지는 이전 이미지를 승계한다. 운영은 태그가 아니라 **digest** 로 참조한다.
- 릴리스 매니페스트(앱별 repository·digest·원 빌드 버전): GitLab 패키지 `release-manifest/<버전>/release-manifest.json`.
- 노트: `releases/<버전>.md` — web 빌드에 들어가 앱 사용자 메뉴 「새 소식」으로 보인다(반영과 함께 나가고 롤백하면 함께 되돌아간다).

## ① 준비

Claude 세션에서 `/release prepare` — 범위 수집·버전 제안(`deploy/release/prepare.mjs plan`), 이슈 본문으로 노트 초안, 사람 확정, `releases/<버전>.md` 커밋·머지·push, 마지막 확인 뒤 태그 push. 절차는 `.claude/skills/release/SKILL.md`, 노트 형식·문장은 `docs/ops/release-notes.md`(릴리스 노트 작성 가이드)가 정본이다.

노트만 바뀐 push 와 태그 push 는 pre-push 회귀를 건너뛴다(`scripts/husky/pre-push.sh`). 코드 머지는 워크트리에서 머지 전에 `pnpm test:full` 을 통과시켜 두면, 같은 트리의 main push 에서 회귀를 다시 돌지 않는다.

## ② 빌드 — GitLab CI (`.gitlab-ci.yml`)

`vX.Y.Z` 태그 push 에서만 돈다(main push 에는 파이프라인 없음 — pre-push 가 이미 회귀를 돌렸다).

| 잡 | 하는 일 |
|---|---|
| verify-tag | 태그 형식, 태그 커밋이 `main`·`hotfix/*` 에 있는지, `releases/<버전>.md` 존재, 기준 태그 계산 |
| build-images | 바뀐 앱만 `:sha-<커밋>` 빌드 → 모두 성공하면 `:<버전>` 태그(승계 포함) → digest 검증 → 매니페스트 업로드 |
| checklist | 기준 릴리스 대비 배포 체크리스트 → GitLab Release 본문 |
| gitlab-release | Release 생성(매니페스트·노트 링크) |
| trivy-scan | 취약점·SBOM 기록(실패해도 릴리스를 막지 않는다) |

프로젝트 CI/CD 변수(Protected, `v*` 는 Protected tag): `DOCKERHUB_USERNAME`·`DOCKERHUB_TOKEN`(iacloudops push), `DHI_USERNAME`·`DHI_TOKEN`(dhi.io 베이스 pull). 비밀값 백업은 아래 「비밀값 백업·복구」. *(GitLab 설정·첫 파이프라인 검증은 WP-442)*

## ③ 반영

```sh
git fetch origin --tags
export CI_API_V4_URL=https://<gitlab>/api/v4 CI_PROJECT_ID=<id> GITLAB_TOKEN=<read_api 토큰>   # 매니페스트 다운로드
node deploy/release/release.mjs deploy 0.9.0
```

`deploy` 가 하는 일:
- 반영 전: 필수 Secret 존재·인계 상태 확인, 운영 릴리스 대비 체크리스트 출력 → ⚠(새 앱·Helm 에 없는 새 환경변수·마이그레이션·Helm 변경)가 있으면 확인 질문(`--yes` 로 생략).
- 태그 지점의 차트(`git archive v0.9.0 deploy/helm`)로 `helm upgrade --install --wait --timeout 15m`. `--atomic` 은 쓰지 않는다(자동 롤백이 마이그레이션 뒤 스키마와 어긋날 수 있어 사람이 판단).
- 반영 뒤: 앱 파드 이미지 digest = 매니페스트, api `/actuator/info`·web/admin `/version.json` 버전 = 원 빌드 버전. 어긋나면 종료 코드 1 + 다음 행동 안내.

체크리스트에서 볼 것:
- **새 앱** — 차트에 Deployment·Service·NetworkPolicy 가 있는지(converter 처럼 빠진 채 나가지 않게).
- **새 환경변수** — 기본값이 없으면 `smart-workplace-secrets` 나 차트 env 에 먼저 넣는다(Secret 은 아래 절차로 바꾸고 해당 앱 재기동).
- **마이그레이션** — 롤백해도 스키마는 되돌아가지 않는다. 이전 앱과 호환되지 않는 변경이면 롤백 계획을 먼저 세운다.

## ④ 되돌리기·상태

```sh
node deploy/release/release.mjs status      # 리비전·릴리스·앱별 digest 일치
node deploy/release/release.mjs rollback    # 마지막 정상 리비전으로(확인 질문)
```

- 반영이 실패해 새 리비전이 `failed` 로 남았으면 `rollback` 은 그 직전 정상(`deployed`) 리비전을 다시 적용한다. 새 리비전이 안 생긴 실패(렌더 오류 등)는 운영이 그대로이니 롤백하지 않는다 — `deploy` 출력이 어느 쪽인지 알려 준다.
- 전환 이전 리비전(values 에 `release.version` 이 없는, `:latest` 시대)으로는 되돌리지 않는다(`--force` 없이는 거부). 이유는 `deploy/helm/README.md`.
- 롤백한 뒤 다시 `rollback` 하면 방금 되돌린 새 릴리스로 앞으로 간다(Helm 기본 동작) — 출력의 ⚠ 를 확인한다.

## 핫픽스

운영 릴리스에 급한 수정만 얹을 때: `hotfix/<새 버전>` 브랜치를 운영 태그에서 만들어 수정 → 노트 → 태그(스킬 4절). CI 는 `hotfix/*` 의 태그도 받는다. 노트 파일은 main 에도 cherry-pick 한다.

## 비밀값 백업·복구

클러스터 Secret 은 Helm 밖에 있다(목록·생성 명령은 `deploy/helm/README.md`). 원본은 GitLab CI 의 file 타입 Protected 변수에 둔다.

| Secret | GitLab 변수 |
|---|---|
| `smart-workplace-secrets` | `HELM_APP_SECRETS_ENV` (KEY=VALUE 줄) |
| `dockerhub-pull` | `DOCKERHUB_USERNAME`·`DOCKERHUB_TOKEN` |
| `genia-works-internal-tls` | `TLS_INTERNAL_CRT`·`TLS_INTERNAL_KEY` |

복구: 변수 값을 파일로 받아 README 의 `kubectl create secret …` 를 실행한다. 값을 바꿨으면 GitLab 변수도 함께 고친다(둘이 어긋나면 복구 때 옛 값이 살아난다). `ENCRYPTION_MASTER_KEY` 는 절대 새로 만들지 않는다.

## 첫 전환 (v0.8.0 → v0.9.0, WP-445)

지금 운영은 `~/k8s/smart-workplace` 차트 + ghcr `:latest` 이미지(리비전 13). 전환 순서 *(WP-445 에서 리허설 결과로 확정)*:

1. 기준 릴리스 시드: `v0.8.0` 태그(지금 운영 이미지를 빌드한 커밋 — 10-17 기준 a5d66d059, converter 만 76c64fc5c. WP-445 에서 확정) + `node deploy/release/seed-baseline.mjs --upload` 로 현재 운영 digest 를 Docker Hub `:0.8.0` 으로 복사·매니페스트 업로드.
2. `/release prepare` 로 v0.9.0 노트·태그 → CI 빌드.
3. 전환 전 확인: 운영 매니페스트와 이 차트 렌더 비교(`deploy/helm/README.md` 「렌더·검증」), Secret 생성·인계(README), 모든 digest 를 클러스터에서 `dockerhub-pull` 로 받아 보기(db 파드가 한 번 재시작된다).
4. `node deploy/release/release.mjs deploy 0.9.0 --current 0.8.0`.
5. 되돌리기 리허설은 새 체계 릴리스끼리만. 전환 자체를 되돌려야 하면 이 도구가 아니라 `~/k8s` 차트로 수동 복구한다(전환 이전 리비전 rollback 금지).

전환이 끝나면 옛 배포 경로(`scripts/deploy.sh`·`scripts/update.sh`·ghcr 이미지)를 지운다.
