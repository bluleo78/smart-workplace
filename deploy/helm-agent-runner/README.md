# agent-runner Helm 차트

AI 가 실제로 도는 곳(실행 위치 = 쿠버네티스 네임스페이스 하나)마다 **한 번** 설치하는 차트입니다.
runner 는 Works 에서 「이 위치에 떠 있어야 할 AI」를 받아 AI 마다 Pod·PVC·Secret·ConfigMap 을 만들고 정리합니다.
Pod 의 모양은 [agent-pod-contract.md](../../docs/integrations/agent-pod-contract.md) 를 따릅니다.

운영 차트(`deploy/helm`)와 별개입니다 — 이 차트는 Works 가 도는 클러스터가 아니어도 됩니다(Works 에 https 로 닿기만 하면 됩니다).

## 설치 순서

> **위치당 네임스페이스 하나**를 권장합니다. runner 는 자기 위치 라벨(`genia.works/location`)의 리소스만 만지므로 한 네임스페이스에
> 두 위치를 설치해도 서로 지우지는 않지만, 같은 AI 를 두 위치에 두면 이름(`agent-<id>`)이 겹쳐 뒤의 쪽이 `FAILED` 가 됩니다.

`<ns>` 는 이 위치의 네임스페이스, `<ctx>` 는 대상 클러스터의 kube context 입니다. **항상 `--kube-context` 를 적어** 엉뚱한 클러스터에 설치하지 않게 합니다.

1. **네임스페이스를 만들고 privileged 라벨을 붙입니다.** AI Pod 의 docker(dind) 사이드카가 privileged 라서 필요합니다.

   ```bash
   kubectl --context <ctx> create namespace <ns>
   kubectl --context <ctx> label ns <ns> pod-security.kubernetes.io/enforce=privileged
   ```

2. **GitHub 토큰 Secret 을 만듭니다(키 이름은 `token`).** AI 가 저장소를 읽고 브랜치·PR 을 올리는 데 쓰며, 대상 저장소의
   **Contents · Pull requests 쓰기** 권한이 필요합니다. 토큰을 명령줄에 쓰지 않도록 파일로 넘깁니다.

   ```bash
   kubectl --context <ctx> -n <ns> create secret generic github-token --from-file=token=./github-token.txt
   ```

3. **이미지 pull secret 을 만듭니다.** runner·작업 공간 이미지는 비공개 Docker Hub(`iacloudops`)에 있어 기본값이
   `dockerhub-pull` 을 runner 와 AI Pod 모두에 씁니다(운영 차트와 같은 이름). 읽기 전용 토큰으로 만듭니다.

   ```bash
   kubectl --context <ctx> -n <ns> create secret docker-registry dockerhub-pull \
     --docker-server=https://index.docker.io/v1/ --docker-username=<계정> --docker-password="$(cat ./dockerhub-token.txt)"
   ```

4. **관리자 화면 「AI 실행 위치」에서 위치를 만들고 runner 토큰(`rt_…`)을 발급**해 파일(예 `./runner-token.txt`)에 저장합니다.
   토큰은 발급 때 한 번만 보입니다.

5. **설치합니다.** 토큰은 `--set-file` 로 넘기거나(차트가 Secret 을 만듭니다), 미리 만든 Secret 을 `existingSecret` 으로 가리킵니다.
   `--set runnerToken=rt_…` 처럼 명령줄에 원문을 쓰지 마세요(셸 기록·프로세스 목록에 남습니다).

   ```bash
   helm --kube-context <ctx> install agent-runner deploy/helm-agent-runner -n <ns> \
     --set works.url=https://genia-works.iacloud.kr \
     --set image.tag=<릴리스 버전> \
     --set github.existingSecret=github-token \
     --set-file runnerToken=./runner-token.txt
   ```

   미리 만든 Secret 을 쓰려면(키 `token`):

   ```bash
   kubectl --context <ctx> -n <ns> create secret generic runner-token --from-file=token=./runner-token.txt
   # 설치 때 --set-file runnerToken=… 대신 --set existingSecret=runner-token
   ```

6. 관리자 화면에서 위치가 「연결됨」으로 바뀌는지 확인합니다(runner 가 60초마다 상태를 보고합니다).

위치 값(노드 지정·톨러레이션 등)은 `values.yaml` 의 `agent.*` 를 `-f my-values.yaml` 로 넘깁니다.

```yaml
agent:
  nodeSelector: { pool: agents }
  tolerations:
    - { key: dedicated, operator: Equal, value: agents, effect: NoSchedule }
  hostAliases:
    - { ip: 10.0.0.5, hostnames: [genia-works.iacloud.kr] }
  storageClass: fast-ssd
```

## 업그레이드

`helm upgrade` 는 runner 만 새 버전으로 바꿉니다(Recreate — 잠깐 runner 가 없는 동안에도 AI Pod 는 그대로 돕니다).
`agent.*` 위치 값을 바꾸면 **새로 뜨는 AI Pod 부터** 적용됩니다. 이미 떠 있는 Pod 에도 반영하려면 관리자 화면에서 AI 를 다시 시작하세요.

## 삭제 — AI Pod 정리 주의

**`helm uninstall` 은 runner 가 만든 AI Pod·PVC·Secret·ConfigMap 을 지우지 않습니다**(차트가 만든 리소스가 아니기 때문).
그대로 두면 AI 가 계속 돌고 작업 디스크도 남습니다. 순서대로 정리하세요.

1. 관리자 화면에서 이 위치의 모든 AI 를 끄고(또는 위치에서 뺍니다), runner 가 Pod 를 정리하고 STOPPED 를 보고할 때까지 기다립니다.
2. 남은 것이 없는지 확인합니다.

   ```bash
   kubectl --context <ctx> -n <ns> get pods,pvc,secret,configmap -l app.kubernetes.io/managed-by=genia-agent-runner
   ```

3. 그 뒤에 `helm --kube-context <ctx> uninstall agent-runner -n <ns>`. 작업 디스크(PVC)까지 버릴 때만 위 라벨 셀렉터로 `kubectl delete pvc` 를 합니다 — 안에 아직 PR 로 올리지 않은 작업이 있을 수 있습니다.

## 값

필수: `works.url`, `image.tag`, `github.existingSecret`, 그리고 `runnerToken`(`--set-file`) 또는 `existingSecret`. 나머지는 `values.yaml` 의 주석을 봅니다.

- runner 는 `/healthz`(8080)를 **readinessProbe 로만** 씁니다. Works 가 10분 넘게 죽으면 503 이 되는데, 생존 검사로 쓰면 Works 장애 동안 runner 가 계속 재시작되기 때문입니다.
- Role 은 이 네임스페이스에만 걸립니다(ClusterRole 없음). 네임스페이스 `ResourceQuota`(`quota.*`)로 AI 가 늘어도 노드를 다 먹지 않게 합니다.
- 쿼터가 `requests.cpu`·`requests.memory` 를 걸기 때문에 runner 는 AI Pod 의 모든 컨테이너에 requests 를 둡니다. dind 는 `dind.resources`
  (기본 requests 500m/1Gi·limits 4/6Gi)로 바꿉니다. 쿼터에 걸려 Pod 가 거절되면 관리자 화면에 그 AI 가 `FAILED`(사유: 쿼터 초과 등)로 보입니다.

## 테스트

```bash
node --test deploy/helm-agent-runner/tests/*.test.mjs   # 또는 pnpm test:helm
helm lint deploy/helm-agent-runner --set works.url=https://x.test --set image.tag=1 --set github.existingSecret=gh --set runnerToken=rt_x
```
