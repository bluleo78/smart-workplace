# agent-runner Helm 차트

AI 가 실제로 도는 곳(실행 위치 = 쿠버네티스 네임스페이스 하나)마다 **한 번** 설치하는 차트입니다.
runner 는 Works 에서 「이 위치에 떠 있어야 할 AI」를 받아 AI 마다 Pod·Secret·ConfigMap(작업 디스크를 PVC 로 둘 때는 PVC 도)을 만들고 정리합니다.
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

2. **이미지 pull secret 을 만듭니다.** runner·작업 공간 이미지는 비공개 Docker Hub(`iacloudops`)에 있어 기본값이
   `dockerhub-pull` 을 runner 와 AI Pod 모두에 씁니다(운영 차트와 같은 이름). 읽기 전용 토큰으로 만듭니다.

   ```bash
   kubectl --context <ctx> -n <ns> create secret docker-registry dockerhub-pull \
     --docker-server=https://index.docker.io/v1/ --docker-username=<계정> --docker-password="$(cat ./dockerhub-token.txt)"
   ```

3. **관리자 화면 「AI 실행 위치」에서 위치를 만들고 runner 토큰(`rt_…`)을 발급**해 파일(예 `./runner-token.txt`)에 저장합니다.
   토큰은 발급 때 한 번만 보입니다.

4. **설치합니다.** 토큰은 `--set-file` 로 넘기거나(차트가 Secret 을 만듭니다), 미리 만든 Secret 을 `existingSecret` 으로 가리킵니다.
   `--set runnerToken=rt_…` 처럼 명령줄에 원문을 쓰지 마세요(셸 기록·프로세스 목록에 남습니다).

   ```bash
   helm --kube-context <ctx> install agent-runner deploy/helm-agent-runner -n <ns> \
     --set works.url=https://genia-works.iacloud.kr \
     --set image.tag=<릴리스 버전> \
     --set-file runnerToken=./runner-token.txt
   ```

   **Works 에 내부 IP 로 닿아야 하는 클러스터**(공인 주소로 닿지 않는 사내 클러스터 등)면 Works 호스트 이름을 그 IP 로 푸는
   `hostAliases` 를 더합니다. runner 와 runner 가 띄우는 AI Pod 모두에 들어갑니다. 대괄호는 zsh 가 glob 으로 읽으므로 따옴표로 감쌉니다.
   관리자 화면의 설치 순서에서 **Works 에 내부 IP 로 접속하는 경우 (선택)** 칸에 IP 를 넣으면 이 두 줄이 명령에 들어갑니다.

   ```bash
     --set 'hostAliases[0].ip=192.168.100.72' \
     --set 'hostAliases[0].hostnames[0]=genia-works.iacloud.kr' \
   ```

   미리 만든 Secret 을 쓰려면(키 `token`):

   ```bash
   kubectl --context <ctx> -n <ns> create secret generic runner-token --from-file=token=./runner-token.txt
   # 설치 때 --set-file runnerToken=… 대신 --set existingSecret=runner-token
   ```

5. 관리자 화면에서 위치가 「연결됨」으로 바뀌는지 확인합니다(runner 가 60초마다 상태를 보고합니다).
   「설치 대기」에서 넘어가지 않으면 runner 로그를 봅니다. `fetch failed`·timeout 이 거듭 보이면 이 클러스터에서 Works 주소에
   닿지 못하는 것이므로 위의 `hostAliases`(내부 IP)를 넣어 `helm upgrade` 합니다.

   ```bash
   kubectl --context <ctx> -n <ns> logs deploy/agent-runner --tail=50
   ```

**AI 저장소 토큰은 이 차트에 넣지 않습니다.** 관리자 화면의 AI 상세 › 저장소 연결에서 AI 마다·저장소 호스트마다 넣습니다
(Works 에 암호화해 저장되고 runner 가 받아 Pod 에 꽂습니다). 대상 저장소의 Contents · Pull requests 쓰기 권한이 필요합니다.
예전 설치(`github.existingSecret`)가 만든 위치 Secret 은 더 쓰지 않으므로 업그레이드 뒤 지워도 됩니다.

```bash
kubectl --context <ctx> -n <ns> delete secret github-token
```

**AI 작업 디스크**는 기본으로 노드 로컬 폴더 `/var/lib/genia-agents/agent-<id>` 입니다(`agent.workDisk`). StorageClass 가 없거나
NFS 처럼 느린 클러스터에서도 그대로 뜹니다. AI 는 처음 뜬 노드에 고정돼 다시 시작해도 같은 폴더를 씁니다 — 그 노드가 사라지면
「켜는 중」에 머무르므로 관리자 화면에서 AI 를 끄고 다시 켜면 다른 노드에서 새 폴더로 뜹니다. AI 를 꺼도 노드의 폴더는 지우지 않습니다
(다음에 같은 노드에 뜨면 이어 씁니다). 디스크를 비우려면 아래 「삭제」의 폴더 정리를 봅니다. PVC 로 두려면 `agent.workDisk.type: pvc` 와
`agent.storageClass` 를 넣습니다.

**CPU·메모리 사용량(선택)**: 관리자 화면의 AI 상태에 CPU·메모리를 보려면 클러스터에 metrics-server 가 있어야 합니다. 없으면 runner 가
「사용량을 잴 수 없음」을 알리고 화면에 「알 수 없음」과 이유가 보입니다(WP-1280). 클러스터 전체에 한 번 설치하며 약 0.1코어·200Mi 를 예약합니다.

```bash
kubectl --context <ctx> apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.7.2/components.yaml
```

위치 값(노드 지정·톨러레이션 등)은 `values.yaml` 의 `hostAliases`·`agent.*` 를 `-f my-values.yaml` 로 넘깁니다.
공용 `hostAliases` 는 runner 와 AI Pod 모두에, `agent.hostAliases` 는 AI Pod 에만(예: 사내 GitLab 이름 풀이) 들어갑니다.

```yaml
# Works 에 내부 IP 로 닿는 위치 — runner·AI Pod 모두
hostAliases:
  - { ip: 192.168.100.72, hostnames: [genia-works.iacloud.kr] }
agent:
  nodeSelector: { pool: agents }
  tolerations:
    - { key: dedicated, operator: Equal, value: agents, effect: NoSchedule }
  # AI Pod 에만 더할 이름 풀이
  hostAliases:
    - { ip: 10.0.0.5, hostnames: [gitlab.iacloud.kr] }
  # 작업 디스크 폴더를 바꿀 때(기본 /var/lib/genia-agents). PVC 로 두려면 type: pvc 와 storageClass
  workDisk:
    type: hostPath
    hostPath: /data/genia-agents
  # 자체서명 인증서를 쓰는 저장소(예: 사내 GitLab)가 있으면 그 CA — AI Pod 가 시스템 CA 와 합쳐 쓴다.
  # 이미 이 네임스페이스에 ConfigMap(키 ca.crt)이 있으면 pem 대신 existingConfigMap: <이름>
  caBundle:
    pem: |
      -----BEGIN CERTIFICATE-----
      ...
      -----END CERTIFICATE-----
```

사내 GitLab 의 CA 는 `openssl s_client -connect gitlab.iacloud.kr:443 -showcerts </dev/null` 로 받은 체인의 루트(자체서명이면 그 인증서)를 씁니다. 바꾼 CA 는 AI 가 다음에 다시 시작할 때부터 쓰입니다.

## 업그레이드

`helm upgrade` 는 runner 만 새 버전으로 바꿉니다(Recreate — 잠깐 runner 가 없는 동안에도 AI Pod 는 그대로 돕니다).
`agent.*` 위치 값을 바꾸면 **새로 뜨는 AI Pod 부터** 적용됩니다. 이미 떠 있는 Pod 에도 반영하려면 관리자 화면에서 AI 를 다시 시작하세요.

**위치 GitHub Secret(`github.existingSecret`)을 쓰던 위치를 올릴 때(WP-1268)** — 새 runner 는 위치 Secret 을 Pod 에 넣지 않고
AI 마다 등록한 저장소 토큰만 넣습니다. **업그레이드 전에** 관리자 화면 AI 상세 › **저장소 연결** 에서 이 위치에서 도는 AI 마다 토큰을
연결하세요. 연결하지 않은 채 Pod 가 다시 만들어지면(설정 변경·다시 시작·노드 장애) 그 AI 는 저장소를 받거나 PR 을 올리지 못합니다.
옮긴 뒤 `kubectl --context <ctx> -n <ns> delete secret github-token` 으로 옛 Secret 을 지웁니다.

**작업 화면 보기를 쓰려면(WP-1277)** — 차트가 runner 의 Role 에 `pods/exec`(create·get)을 더합니다. runner 는 이 권한으로 AI Pod 의
`/opt/genia/bin/agent-screen` 만 부릅니다. 옛 차트의 runner 는 이 권한이 없어, 관리자가 작업 화면을 열면
「실행 환경 runner 에 작업 화면 권한(pods/exec)이 없어요」가 뜹니다 — 차트를 올리면 풀립니다. 작업 공간 이미지도 `agent-screen` 이 든 버전이어야 합니다.
보기는 늘 되고, **관리자가 AI 화면에 키를 치는 입력은 `screen.allowInput: true` 로 켜야만** 보입니다(기본 꺼짐). 입력은 사실상 AI 작업 공간의
셸입니다 — AI 의 접속 키·저장소 토큰·모델 연결 토큰을 읽을 수 있고, 특권 dind 의 docker 소켓으로 노드에까지 닿을 수 있습니다. 이 클러스터를
운영하는 쪽이 그 위험을 받아들일 때만 켜세요. 입력한 내용은 Works 감사 기록에 남습니다.

**작업 디스크를 PVC 로 쓰던 위치를 올릴 때(WP-1270)** — 기본값이 노드 로컬 폴더로 바뀌지만, 이미 PVC 가 있는 AI 는 끌 때까지 그 PVC 를
계속 씁니다(작업 폴더를 잃지 않게). 끄면 PVC 가 지워지고 다음에 켤 때부터 노드 폴더를 씁니다. 계속 PVC 로 두려면 `agent.workDisk.type: pvc`.

## 삭제 — AI Pod 정리 주의

**`helm uninstall` 은 runner 가 만든 AI Pod·Secret·ConfigMap(과 PVC)을 지우지 않습니다**(차트가 만든 리소스가 아니기 때문).
그대로 두면 AI 가 계속 돌고 작업 디스크도 남습니다. 순서대로 정리하세요.

1. 관리자 화면에서 이 위치의 모든 AI 를 끄고(또는 위치에서 뺍니다), runner 가 Pod 를 정리하고 STOPPED 를 보고할 때까지 기다립니다.
2. 남은 것이 없는지 확인합니다.

   ```bash
   kubectl --context <ctx> -n <ns> get pods,pvc,secret,configmap -l app.kubernetes.io/managed-by=genia-agent-runner
   ```

3. 그 뒤에 `helm --kube-context <ctx> uninstall agent-runner -n <ns>`.
4. 작업 디스크까지 버릴 때만 정리합니다 — 안에 아직 PR 로 올리지 않은 작업이 있을 수 있습니다.
   - 노드 로컬 폴더(기본): AI 가 떴던 각 노드에서 `/var/lib/genia-agents/agent-<id>` 를 지웁니다. runner 는 노드의 폴더를 지우지 않습니다.
   - PVC 방식: 위 라벨 셀렉터로 `kubectl delete pvc` 를 합니다.

## 값

필수: `works.url`, `image.tag`, 그리고 `runnerToken`(`--set-file`) 또는 `existingSecret`. 나머지는 `values.yaml` 의 주석을 봅니다.

- runner 는 `/healthz`(8080)를 **readinessProbe 로만** 씁니다. Works 가 10분 넘게 죽으면 503 이 되는데, 생존 검사로 쓰면 Works 장애 동안 runner 가 계속 재시작되기 때문입니다.
- Role 은 이 네임스페이스에만 걸립니다(ClusterRole 없음). 네임스페이스 `ResourceQuota`(`quota.*`)로 AI 가 늘어도 노드를 다 먹지 않게 합니다.
- 쿼터가 `requests.cpu`·`requests.memory` 를 걸기 때문에 runner 는 AI Pod 의 모든 컨테이너에 requests 를 둡니다. dind 는 `dind.resources`
  (기본 requests 250m/512Mi·limits 2/4Gi)로 바꿉니다. 쿼터에 걸려 Pod 가 거절되면 관리자 화면에 그 AI 가 `FAILED`(사유: 쿼터 초과 등)로 보입니다.

## 테스트

```bash
node --test deploy/helm-agent-runner/tests/*.test.mjs   # 또는 pnpm test:helm
helm lint deploy/helm-agent-runner --set works.url=https://x.test --set image.tag=1 --set runnerToken=rt_x
```
