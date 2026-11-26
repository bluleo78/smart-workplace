# 앱 배포 자동화 연결

새 앱을 「운영 배포」 워크플로우에 붙이는 순서다(에픽 WP-2134). 연결하고 나면 배포 이슈를 배포 담당 AI 에게 맡기는 것으로 배포한다.
배포 담당 AI 가 나갈 내용을 정리하고, 사람이 승인하면 운영에 반영한다. 반영이 실패하면 되돌린다.
factory-board(DFB, 2026-11-26~27)를 실제로 연결한 순서 그대로 적었다. 예시 값은 그 앱의 것이다.

| 무엇 | 어디 | 누가 |
|---|---|---|
| 앱 네임스페이스 권한 | `deploy/helm-deploy-target` 차트 | 클러스터 운영자 |
| 배포 담당 AI | Works 설정 › 에이전트(실행 방식 「Claude Code (배포)」) | Works 관리자 |
| AI ↔ 권한 연결 | agent-runner Helm 값 `agent.serviceAccounts` | 클러스터 운영자 |
| 앱별 배포 값 | 앱 저장소 `.genia/deploy.yaml`(+ 배포 스크립트) | 앱 개발자 |
| 승인 흐름 | 프로젝트 워크플로우 「운영 배포」(`docs/workflows/deploy-flow.yaml`) | 프로젝트 소유자 |

## 전제

- **배포 담당 AI 는 앱과 같은 클러스터의 실행 위치에서 돈다.** 권한은 runner 가 Pod 에 꽂는 ServiceAccount 토큰뿐이고, 그 토큰은 자기 클러스터에서만 통한다. factory-board 는 운영 클러스터 `iacloud-prod-public` 의 앱이라 실행 위치 「운영 환경」(id 3)에 둔다.
- 앱 이미지는 앱 저장소의 CI 가 빌드·push 한다. 배포 담당 AI 는 이미지를 빌드하지 않고 태그만 바꿔 반영한다.
- genia-works 플러그인 0.1.79 이상(deploy 스킬)이 운영 Works 마켓플레이스에 나가 있어야 한다(v0.9.105 부터).

## 1. 앱 네임스페이스 권한을 설치한다

[deploy-target 차트](../../deploy/helm-deploy-target/README.md)를 앱마다 한 번 설치한다. ServiceAccount(AI Pod 네임스페이스 `genia-agents`)와 앱 네임스페이스 안의 Role·RoleBinding 이 생긴다.

```bash
helm --kube-context iacloud-prod-public install deploy-factory-board deploy/helm-deploy-target -n genia-agents \
  --set targetNamespace=factory-board \
  --set serviceAccount.name=deploy-bot \
  --set namespaceAccess=true
```

- `namespaceAccess=true` 는 앱 저장소의 `apply -k` 가 Namespace 리소스도 apply 할 때만 켠다(factory-board 의 `k8s/` 는 그렇다).
- 앱 매니페스트에 Deployment·Service·Ingress 말고 다른 리소스(statefulsets 등)가 있으면 `extraRules` 로 더한다.
- ResourceQuota 는 읽기만 준다. apply 할 때 바뀐 것이 없으면 통과하고, 쿼터를 바꾸는 apply 는 거절된다. 상한은 사람이 바꾼다.
- 차트 README 의 `kubectl auth can-i` 표로 yes·no 를 확인한다.
- 앱 매니페스트를 서버 dry-run 으로 먼저 돌려 본다. 권한이 모자란 리소스가 여기서 드러난다. factory-board 에서는 resourcequotas 읽기가 빠져 있었다.

  ```bash
  kubectl --context iacloud-prod-public apply -k <앱 k8s> --dry-run=server \
    --as=system:serviceaccount:genia-agents:deploy-bot
  ```

## 2. 배포 담당 AI 를 만든다

사용자 매뉴얼 15장(에이전트)의 화면 순서다.

1. **설정** → **에이전트** 에서 새 에이전트를 만든다(예: 「AI 배포 관리자」, `deploy@iacloud.kr`).
2. 상세 **실행** 에서 실행 방식 **Claude Code (배포)** 를 고른다. 이 방식은 dind 를 두지 않는다. CPU·메모리를 적게 쓰고, 대기열 라벨 기본값이 없어 담당자 없는 개발 이슈를 가져가지 않는다.
3. **작업 설정** 의 실행 환경을 앱과 같은 클러스터의 위치로 고른다(전제 참조).
4. **AI 계정**(Claude 구독)을 고르고, **저장소 연결** 에 앱 저장소 호스트의 토큰을 넣는다. GitLab 이면 clone 과 파이프라인 조회만 하므로 `read_api`·`read_repository` 로 충분하다.
5. 앱 프로젝트의 **멤버** 로 넣는다. 포함 이슈에 「운영 반영」 댓글을 다는 데도 필요하다.
6. AI 의 사용자 id(숫자)를 적어 둔다. 3번에서 쓴다. 상세 화면 주소 `/settings/agents/<id>` 의 숫자다. 목록의 **아이디** 열은 @멘션용 이름이라 이것이 아니다.

## 3. runner 허용 표에 AI 를 넣는다

AI 의 Pod 가 1번의 ServiceAccount 를 쓰게 한다(WP-2135). 그 위치의 runner Helm 값 `agent.serviceAccounts` 에 `{AI id: ServiceAccount 이름}` 을 더해 업그레이드한다.

```bash
helm --kube-context iacloud-prod-public get values agent-runner -n genia-agents -o yaml > runner-values.yaml
# runner-values.yaml 에 더한다(기존 항목은 그대로):
#   agent:
#     serviceAccounts:
#       "118": deploy-bot
helm --kube-context iacloud-prod-public upgrade agent-runner deploy/helm-agent-runner -n genia-agents -f runner-values.yaml
```

- 차트는 지금 운영 runner 와 같은 릴리스 태그의 것을 쓴다(`git archive v<버전> deploy/helm-agent-runner | tar -x -C <폴더>`). 아니면 runner 이미지가 함께 바뀐다.
- runner 가 그 AI 의 Pod 를 새 계정으로 바로 다시 만든다.
- 확인은 Pod 안에서 한다.
  - `kubectl -n <앱 ns> auth can-i patch deployments` 가 `yes` 여야 한다.
  - `get secrets` 는 `no` 여야 한다.
  - `DOCKER_HOST` 환경변수가 없어야 한다.

## 4. 앱 저장소에 배포 설정을 넣는다

저장소 루트에 `.genia/deploy.yaml` 을 둔다. 형식은 플러그인 문서 [`plugins/genia-works/skills/deploy/config.md`](../../plugins/genia-works/skills/deploy/config.md) 다. factory-board 의 값:

```yaml
version: 1
target: { namespace: factory-board, deployment: factory-board, container: app }
image: { repository: docker.io/iacloudops/factory-board, tag: short-sha-8 }
ci: { branch: main, job: build-image }
deploy: { command: scripts/deploy.sh {tag}, timeout: 180 }
check: { url: https://genia-works.iacloud.kr/ext/factory-board/api/health, expect: 200 }
manifests: [k8s/]
```

factory-board 에서 걸린 것들:

- **배포 스크립트가 Pod 안에서 돌아야 한다.** Pod 에는 kubeconfig context 가 없다. `kubectl --context <이름>` 을 늘 붙이는 스크립트는 실패한다.
  - Pod 안(`KUBERNETES_SERVICE_HOST` 가 있음)이면 `--context` 를 빼게 고친다.
  - `${KUBE_CONTEXT:-기본값}` 은 빈 값도 기본값으로 바꾸므로 그 판정에 쓰지 않는다.
  - 고친 스크립트는 배포 담당 AI 의 Pod 에서 `apply --dry-run=server` 로 한 번 돌려 본다.
- **`target.container` 는 Deployment 의 실제 컨테이너 이름이다.** factory-board 는 `app` 이었다(앱 이름이 아님). `kubectl get deploy <이름> -o jsonpath='{.spec.template.spec.containers[*].name}'` 로 본다.
- **태그 규칙은 CI 가 push 하는 태그와 같아야 한다.** GitLab `CI_COMMIT_SHORT_SHA` 는 8자리라 `short-sha-8` 이다.
- **상태 주소는 로그인 없이 기대 상태를 내야 한다.** 앱 첫 화면이 Works 로그인 뒤에 있으면 안 된다. factory-board 는 화면 주소 대신 `/api/health` 를 쓴다. 배포 담당 AI 의 Pod 에서 `curl` 로 확인한다.
- 이미지 빌드 잡은 배포 담당 AI 의 Pod 에서 `gw-repo ci-job <커밋 40자> <잡 이름>` 으로 `PASS` 가 나오는지 본다.
- 저장소 안내 문서(CLAUDE.md·README)의 「배포는 사람이 한다」도 워크플로우 기준으로 고친다(DFB-6). 개발 AI 는 여전히 머지까지만 한다.

## 5. 「운영 배포」 워크플로우를 게시하고 켠다

1. 앱 프로젝트 › 워크플로우 › **워크플로우 만들기**(이름 「운영 배포」)를 연다.
2. YAML 보기에 [`docs/workflows/deploy-flow.yaml`](../workflows/deploy-flow.yaml) 을 붙여 넣는다.
3. `roles` 의 `members` 를 바꾼다. 「배포 담당」은 2번의 AI, 「승인자」는 승인할 사람이다.
4. 게시한다. 검사 문제가 0 이어야 한다.
5. **켜기 스위치를 켠다.** 게시만으로는 꺼져 있다. 시작 조건이 「배포 담당 역할에게 담당 지정」이라, 꺼진 채 배포 이슈를 맡기면 실행이 생기지 않는다.

- 흐름은 배포 준비(AI) → 배포 승인(사람, 하루 지나면 다시 알림) → 운영 반영(AI) 이다.
  - 준비가 막히면 「배포 막힘 확인」으로 간다.
  - 반영이 실패하면 되돌린 뒤 승인으로 돌아간다.
- 노드 지시는 deploy 스킬을 부를 뿐이라 앱 값을 적지 않는다. 앱별 값은 모두 4번 파일에 있다.
- 개발용 워크플로우(예: 「데모 개발」)는 그대로 머지까지만 한다. 그 지시의 「운영 배포는 사람이 한다」를 「배포는 「운영 배포」 워크플로우가 한다」로 고친다.

## 6. 첫 배포 이슈로 확인한다

1. 앱 프로젝트에 배포 이슈를 만들어 배포 담당 AI 에게 맡긴다. 본문에 낼 커밋을 적을 수 있고, 없으면 `ci.branch` 끝을 낸다.
2. **배포 준비** 의견에 다음이 보이는지 본다.
   - 지금 → 낼 태그
   - 배포 설정·스크립트 변경 경고(있을 때)
   - 이미지 빌드 잡
   - 포함 이슈·커밋
   - 매니페스트 변경
3. **배포 승인** 에서 승인한다.
4. **운영 반영** 이 `deployed` 로 끝나면 확인한다.
   - 운영 이미지 태그
   - 상태 주소
   - 포함 이슈의 「운영 반영(<태그>) — <배포 이슈>」 댓글
5. 같은 커밋으로 배포 이슈를 한 번 더 내서 배포 준비가 `nothing` 으로 끝나는지 본다.

factory-board 첫 배포(DFB-8)는 맡긴 뒤 약 2분 만에 끝났다(준비 24초, 승인 뒤 반영 28초). 같은 태그로 낸 DFB-9 는 12초 만에 `nothing` 으로 끝났다.

## 알려진 위험

- **같은 노드의 특권 dind 가 토큰 파일에 닿을 수 있다**(WP-2139, 보류).
  - 배포 담당 AI 의 ServiceAccount 토큰은 그 Pod 의 agent 컨테이너에만 꽂힌다. 하지만 노드의 kubelet 폴더에는 파일로 있다.
  - 그래서 같은 노드에 뜬 다른 AI 의 특권 dind 가 노드 디스크를 마운트하면 읽을 수 있다.
  - 전용 노드·위치로 떼어 놓는 것은 아직 하지 않았다(리소스 부족).
  - 그동안 권한을 앱 네임스페이스 하나, Secret·exec·지우기 없음으로 좁혀 피해 범위를 줄인다.
- **일반 AI 의 GitLab 토큰 범위가 넓다**(WP-2140, 보류). 개발 AI 의 저장소 토큰으로 앱 저장소의 배포 스크립트·`.genia/deploy.yaml` 을 바꿀 수 있다.
  - 배포 준비가 이 두 파일의 변경을 의견 맨 위에 경고로 올린다.
  - 승인자는 그 경고를 보고 승인한다.
- **되돌림은 Deployment 만 한다.** `rollout undo` 는 Service·Ingress 변경을 되돌리지 않는다. 그런 변경이 든 배포가 실패하면 반영 의견에 그렇다고 남고, 나머지는 사람이 본다.

## 운영 중 바꿀 때

- **배포 담당 AI 를 바꿀 때**
  - runner 허용 표의 id 를 바꾼다. 뺀 AI 의 Pod 는 runner 가 권한 없이 다시 만든다.
  - 워크플로우 「배포 담당」 구성원도 바꾼다.
- **AI 하나가 앱 여럿을 맡을 때**: 두 번째 앱부터 차트를 `serviceAccount.create=false`, `serviceAccount.name=<같은 이름>` 으로 설치해 권한만 더한다(차트 README).
- **플러그인 deploy 스킬이 바뀔 때**: 릴리스로 운영 마켓플레이스에 나간 뒤 배포 담당 AI 의 Pod 를 다시 만들어야 새 스킬을 쓴다. 관리자 화면에서 AI 를 다시 시작하거나 Pod 를 지운다.
