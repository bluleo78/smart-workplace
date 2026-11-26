# 저장소 배포 설정 `.genia/deploy.yaml`

deploy 스킬(WP-2143)이 읽는 앱별 값이다. 배포 순서(준비 → 승인 → 반영 → 확인 → 실패 시 되돌리기)는 스킬이 정하고, 앱마다 다른 이름·명령·주소만 이 파일에 둔다. 저장소 루트의 `.genia/deploy.yaml` 하나이며, 낼 커밋의 파일을 읽는다(운영 반영도 그 커밋의 설정·스크립트·매니페스트로 한다).

## 예 (factory-board)

```yaml
version: 1
target:
  namespace: factory-board        # 반영할 네임스페이스
  deployment: factory-board       # 이미지 태그를 볼·되돌릴 Deployment
  container: factory-board        # 선택 — 컨테이너가 여럿일 때 이미지를 볼 컨테이너 이름(없으면 첫 컨테이너)
image:
  repository: docker.io/iacloudops/factory-board
  tag: short-sha-8                # 태그 규칙 — 커밋 SHA 앞 8자리
ci:
  branch: main                    # 낼 커밋을 고르는 브랜치(이슈가 커밋을 정하지 않았을 때 그 끝)
  job: build-image                # 이미지를 빌드·push 하는 CI 잡 이름
deploy:
  command: scripts/deploy.sh {tag}   # 저장소 루트에서 부를 배포 명령 — {tag} 는 낼 태그로 바뀐다
  timeout: 300                    # 선택 — rollout 을 기다릴 초(기본 300)
check:
  url: https://genia-works.iacloud.kr/ext/factory-board/api/health
  expect: 200                     # 선택 — 기대 HTTP 상태(기본 200)
manifests: [k8s/]                 # 선택 — 사이 변경에서 매니페스트 변경으로 따로 보여 줄 경로
```

## 칸

| 칸 | 필수 | 뜻 |
|---|---|---|
| `version` | 예 | 형식 판. 지금은 `1` 만 |
| `target.namespace` · `target.deployment` | 예 | 지금 운영 태그를 읽고(`kubectl get deploy`), 반영 뒤 `rollout status`·실패 시 `rollout undo` 할 대상 |
| `target.container` | 아니오 | 이미지를 읽을 컨테이너. 없으면 첫 컨테이너 |
| `image.repository` | 예 | 운영 이미지 저장소. 지금 운영 이미지가 이 저장소가 아니면 `blocked` |
| `image.tag` | 예 | `short-sha-<n>`(n = 7~40) — 커밋 SHA 앞 n 자리. **CI 가 push 하는 태그와 같아야 한다**(GitLab `CI_COMMIT_SHORT_SHA` 는 8자리) |
| `ci.branch` | 예 | 낼 커밋을 고르는 브랜치 |
| `ci.job` | 예 | 이미지 빌드 잡 이름 — `gw-repo ci-job <SHA> <잡>` 으로 성공을 확인한다 |
| `deploy.command` | 예 | 배포 명령. `{tag}` 자리 하나가 꼭 있어야 한다 |
| `deploy.timeout` | 아니오 | rollout 대기 초(기본 300) |
| `check.url` | 예 | 반영 뒤 확인할 상태 주소. **로그인 없이** 기대 상태를 내야 한다(Works 로그인 뒤에 있는 화면 주소는 안 된다) |
| `check.expect` | 아니오 | 기대 HTTP 상태(기본 200) |
| `manifests` | 아니오 | 매니페스트 경로 목록 — 준비 의견에 이 경로의 변경을 따로 적는다 |

## 배포 명령이 지킬 것

- **클러스터 권한은 Pod 의 ServiceAccount 하나뿐이다.** 배포 담당 AI 의 Pod 에는 kubeconfig context 가 없고, runner 허용 목록(WP-2135)이 꽂은 ServiceAccount 토큰만 있다. 명령은 `--context` 없이(또는 `KUBE_CONTEXT` 가 비었을 때 빼고) 돌아야 한다. `${KUBE_CONTEXT:-기본값}` 은 빈 값도 기본값으로 바꾸니 쓰지 않는다.
- **권한은 deploy-target 차트(`deploy/helm-deploy-target`)가 준 만큼이다** — Deployment·Service·Ingress 만들기·고치기, Pod·로그 읽기. Secret·exec·지우기는 없다. 그 밖의 리소스를 바꾸는 명령이면 차트의 `extraRules` 를 먼저 늘린다.
- **이미지를 빌드하지 않는다.** 빌드·push 는 CI 가 하고, 명령은 태그만 바꿔 반영한다.
- **같은 태그로 다시 불러도 안전해야 한다**(apply 처럼).
- 실패하면 0 이 아닌 값으로 끝난다. 스킬은 그것과 `rollout status` 로 실패를 가른다.

## 이 파일이 없거나 틀리면

준비 단계가 `blocked` 로 끝나고 사유(없는 칸·틀린 값)를 준비 의견에 적는다 — 아무것도 반영하지 않는다.
