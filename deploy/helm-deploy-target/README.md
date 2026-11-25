# deploy-target Helm 차트

배포 담당 AI 에게 **앱 네임스페이스 하나만큼의 배포 권한**을 주는 차트입니다(WP-2142). 앱을 배포 자동화에 붙일 때 **앱마다 한 번** 설치합니다.
네임스페이스와 이름만 넣으면 모든 앱에 같은 모양의 최소 권한이 나옵니다.

- 이 차트는 권한만 만듭니다. AI Pod 를 이 계정으로 띄우는 일은 agent-runner 의 허용 표(`agent.serviceAccounts`, WP-2135)가 합니다.
- **사람이** `helm install` 로 적용합니다. 앱 배포 매니페스트(kustomization 등)에 넣지 않습니다. 배포 AI 가 자기 권한을 고치는 apply 를 하면 안 되기 때문입니다.

## 만드는 것

| 리소스 | 위치 | 내용 |
|---|---|---|
| ServiceAccount | `serviceAccount.namespace`(기본 `genia-agents`, AI Pod 가 뜨는 곳) | 토큰 Secret 은 만들지 않습니다. runner 가 agent 컨테이너에만 1시간짜리 투영 토큰을 꽂습니다 |
| Role + RoleBinding | `targetNamespace` | 아래 권한 표 |
| ClusterRole + ClusterRoleBinding (`namespaceAccess: true` 일 때만) | 클러스터 | `namespaces` 를 `targetNamespace` 이름 하나로 좁혀 get·patch |

권한 표(Role):

| 리소스 | 동작 | 쓰는 곳 |
|---|---|---|
| `apps/deployments` | get·list·watch·create·patch·update | apply, `rollout status`·`rollout undo` |
| `apps/replicasets` | get·list·watch | `rollout status`·`rollout history` |
| `services`, `networking.k8s.io/ingresses` | get·list·create·patch·update | apply |
| `pods`, `pods/log` | get·list | 반영 뒤 상태·로그 확인 |
| `resourcequotas` | get·list | 앱 매니페스트에 든 네임스페이스 쿼터를 apply 가 읽는다. 바뀌지 않으면 통과하고, 쿼터를 바꾸는 apply 는 거절된다(상한은 사람이 바꾼다) |

`secrets`·`configmaps`·`pods/exec`·`delete` 는 주지 않습니다. 배포 AI 가 앱 비밀값을 읽거나, 컨테이너에 들어가거나, 리소스를 지우지 못하게 하려는 것입니다.
앱에 이 밖의 리소스(statefulsets·cronjobs 등)가 있으면 `extraRules` 로 더합니다. 대상 네임스페이스 안에만 더해집니다.

## 값

| 값 | 기본 | 설명 |
|---|---|---|
| `targetNamespace` | (필수) | 배포할 앱의 네임스페이스 |
| `serviceAccount.name` | `deploy-<targetNamespace>` | 배포 AI Pod 가 쓸 ServiceAccount 이름 |
| `serviceAccount.namespace` | `genia-agents` | AI Pod 가 뜨는 네임스페이스(agent-runner 를 설치한 곳) |
| `serviceAccount.create` | `true` | `false` 면 이미 있는 ServiceAccount 에 권한만 묶습니다(아래 「AI 하나가 앱 여럿을 맡을 때」) |
| `namespaceAccess` | `false` | 앱 저장소의 `apply -k` 가 Namespace 리소스도 함께 apply 하면 켭니다 |
| `extraRules` | `[]` | Role rules 형식으로 더할 권한 |

## 설치

`<ctx>` 는 대상 클러스터의 kube context 입니다. 엉뚱한 클러스터에 설치하지 않게 **항상 `--kube-context` 를 적습니다**.
릴리스는 AI Pod 네임스페이스에 둡니다. 릴리스 이름은 앱마다 달라야 합니다(예: `deploy-<앱>`).

```bash
helm --kube-context <ctx> install deploy-factory-board deploy/helm-deploy-target -n genia-agents \
  --set targetNamespace=factory-board \
  --set namespaceAccess=true
```

설치한 뒤 권한을 확인합니다. 위 표의 권한은 `yes`, 그 밖은 `no` 여야 합니다.

```bash
SA=system:serviceaccount:genia-agents:deploy-factory-board
kubectl --context <ctx> auth can-i patch deployments -n factory-board --as=$SA        # yes
kubectl --context <ctx> auth can-i get pods --subresource=log -n factory-board --as=$SA # yes
kubectl --context <ctx> auth can-i get secrets -n factory-board --as=$SA             # no
kubectl --context <ctx> auth can-i create pods --subresource=exec -n factory-board --as=$SA # no
kubectl --context <ctx> auth can-i delete deployments -n factory-board --as=$SA      # no
kubectl --context <ctx> auth can-i patch deployments -n default --as=$SA             # no
```

## 배포 AI Pod 에 연결하기 (허용 표)

권한만으로는 아무 Pod 도 이 계정을 쓰지 않습니다. 배포 담당 AI 를 만든 뒤(실행 방식 「Claude Code (배포)」),
그 AI 의 id 와 이 ServiceAccount 이름을 agent-runner 의 허용 표에 적어 runner 를 업그레이드합니다.

```bash
helm --kube-context <ctx> get values agent-runner -n genia-agents > runner-values.yaml
# runner-values.yaml 에 더한다:
#   agent:
#     serviceAccounts:
#       "<AI id>": deploy-factory-board
helm --kube-context <ctx> upgrade agent-runner deploy/helm-agent-runner -n genia-agents -f runner-values.yaml
```

runner 가 그 AI 의 Pod 를 새 계정으로 다시 띄웁니다. Pod 안에서 `kubectl auth can-i patch deployments -n factory-board` 가 `yes` 면 연결된 것입니다.
허용 표의 동작과 알려진 한계(같은 노드의 특권 dind 가 토큰 파일을 읽을 수 있음)는 [agent-pod-contract.md](../../docs/integrations/agent-pod-contract.md) 「클러스터 권한 (WP-2135)」에 있습니다.

## AI 하나가 앱 여럿을 맡을 때

runner 허용 표는 AI 하나에 ServiceAccount 하나입니다. 같은 배포 AI 가 앱 여럿을 배포하려면 ServiceAccount 를 하나로 두고, 앱마다 권한만 묶습니다.

```bash
# 첫 앱 — ServiceAccount 를 만든다
helm --kube-context <ctx> install deploy-app-a deploy/helm-deploy-target -n genia-agents \
  --set targetNamespace=app-a --set serviceAccount.name=deploy-bot
# 다음 앱 — 같은 이름에 권한만 묶는다
helm --kube-context <ctx> install deploy-app-b deploy/helm-deploy-target -n genia-agents \
  --set targetNamespace=app-b --set serviceAccount.name=deploy-bot --set serviceAccount.create=false
```

## 테스트

```bash
node --test deploy/helm-deploy-target/tests/*.test.mjs   # 또는 pnpm test:helm
```
