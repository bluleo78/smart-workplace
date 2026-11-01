# AI Pod ↔ 작업 공간 이미지 계약

runner(`apps/workplace-agent-runner`, WP-1251)가 만드는 Pod 와 작업 공간 이미지(`apps/workplace-agent-claude-code`, WP-1252)의 엔트리포인트가 이 문서 하나로 맞물린다. 두 쪽 테스트가 아래 값을 단언한다 — 값을 바꾸면 두 쪽을 함께 바꾼다. runner 가 Works 와 주고받는 API 는 [agent-runner-api.md](agent-runner-api.md) 다.

## 리소스

AI 한 명(`agentUserId`)마다 runner 가 설치된 네임스페이스에 아래 네 개를 둔다.

| 종류 | 이름 | 수명 |
|---|---|---|
| Pod | `agent-<agentUserId>` | generation 이 바뀌고 `applyNow` 일 때, 또는 모델 연결 version 이 Pod 를 만들 때와 달라졌을 때(아래 「모델 연결 교체」) 지우고 다시 만든다 |
| PersistentVolumeClaim | `agent-<id>-work` | generation 재생성 때 유지, desired 에서 빠지면 바로 삭제 |
| Secret | `agent-<id>` | 위와 같음 |
| ConfigMap | `agent-<id>` | desired 에서 빠지면 **마지막에** 삭제 — Pod 가 사라진 뒤 `STOPPED` 보고가 받아들여진 다음. 남아 있으면 「아직 STOPPED 를 보내지 못함」 표시다 |

## 라벨·어노테이션

| 대상 | 키 | 값 |
|---|---|---|
| 네 리소스 모두 | `app.kubernetes.io/managed-by` | `genia-agent-runner` |
| 네 리소스 모두 | `genia.works/agent` | `<agentUserId>` |
| 네 리소스 모두 | `genia.works/location` | `<locationId>` |
| Pod 만 | `genia.works/generation` | 그 Pod 가 반영한 generation |
| Pod 어노테이션 | `genia.works/claude-version` | Pod 를 만들 때 Secret 에 든 모델 연결 `version`(연결이 없으면 어노테이션 없음) |
| Secret 어노테이션 | `genia.works/agent-key-id` | 받은 AI 키 id(`keyId`) |
| Secret 어노테이션 | `genia.works/agent-key-rotate-after` | 받은 키의 `rotateAfter`(ISO-8601) |
| Secret 어노테이션 | `genia.works/claude-version` | 받은 모델 연결 `version` |

runner 는 `managed-by=genia-agent-runner` 라벨이 붙고 **`genia.works/location` 이 자기 위치(desired `locationId`)인** 리소스만 만지고 지운다 — 한 네임스페이스에 runner(위치)가 둘이어도 서로의 리소스를 지우지도 관찰 보고에 넣지도 않는다. 다른 위치의 리소스와 이름이 겹치면(같은 AI) 만들지 않고 `FAILED` 로 알린다. 그래도 **위치당 네임스페이스 하나**를 권장한다. 어노테이션은 runner 가 재시작해도 「이미 받은 키」를 알게 하는 유일한 기록이다 — AI 키를 다시 받으면 곧 교체(generation+1 → Pod 재생성)이기 때문이다.

## Secret 키

| 키 | 내용 |
|---|---|
| `agent-key` | AI 키 원문(`ak_…`). Pod 를 만들기 전에 반드시 있다 |
| `claude-token` | 모델 연결 원문 — provider 가 `anthropic` 일 때만. 연결이 없으면(`version` null) 키를 지운다 |

GitHub 토큰은 runner 가 복사하지 않는다 — 위치에 미리 만든 Secret(Helm `github.existingSecret`, 키 `token`)을 Pod 가 직접 마운트한다.

## 마운트

| 경로 | 출처 | 비고 |
|---|---|---|
| `/run/genia/config.json` | ConfigMap 키 `config.json` | 읽기 전용 |
| `/run/genia/agent-key` | Secret 키 `agent-key` | 읽기 전용 |
| `/run/genia/github-token` | 위치 Secret 키 `token` | 읽기 전용 |
| `/work` | PVC `agent-<id>-work` | 템플릿 `resources.workDisk` 크기, Helm `agent.storageClass` |
| `/dind` | emptyDir | agent·dind 컨테이너가 docker 소켓을 나눠 쓴다 |

## 환경 변수 (agent 컨테이너)

| 이름 | 값 |
|---|---|
| `GENIA_AGENT_NAME` | desired `username` |
| `GENIA_AGENT_GENERATION` | desired `generation` |
| `GENIA_WORKS_TENANT` | desired `tenantId` |
| `GENIA_WORKS_API_URL` | desired `apiUrl`(`/api/v1` 까지) |
| `GENIA_WORKS_MCP_URL` | desired `mcpUrl` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Secret `claude-token`(optional — 없으면 비움). env 라 Pod 시작 때 고정된다(아래 「모델 연결 교체」) |
| `DOCKER_HOST` | `unix:///dind/docker.sock` |

### 모델 연결 교체

`CLAUDE_CODE_OAUTH_TOKEN` 은 Secret 에서 env 로 들어가 Pod 를 시작할 때 고정된다. Works 는 연결을 다시 등록해도 `generation` 을 올리지 않는다(언제 다시 만들지는 runner 가 정한다). 그래서 runner 는 Secret 어노테이션 `genia.works/claude-version` 이 Pod 어노테이션의 것과 다르면(없음 ↔ 값 포함) `generation`·`applyNow` 와 무관하게 Pod 를 지우고 다음 회차에 다시 만든다 — 재등록은 대개 옛 토큰이 끊겼을 때라 쉴 때까지 기다리지 않는다. 템플릿 이미지가 허용 밖으로 바뀌었으면 지우지 않고 `FAILED` 로 알린다.

## 자원

네임스페이스 `ResourceQuota`(Helm `quota.*`, 기본 켜짐 — `requests.cpu`·`requests.memory`)는 requests 가 없는 컨테이너가 하나라도 있으면 Pod 를 승인에서 거절한다. 그래서 runner 는 **모든 컨테이너에 requests 를 둔다.**

| 컨테이너 | requests | limits |
|---|---|---|
| agent | 템플릿 `cpuRequest`·`memoryRequest` → 없으면 템플릿 limit → 없으면 **cpu `1`·memory `2Gi`** | 템플릿 `cpuLimit`·`memoryLimit`(있을 때만) |
| dind | Helm `dind.resources`(env `DIND_RESOURCES`, 기본 **cpu `500m`·memory `1Gi`**) | 같은 값(기본 **cpu `4`·memory `6Gi`**) |
| 그 밖의 sidecar | **cpu `100m`·memory `128Mi`** | 없음 |

클러스터가 Pod 등을 거절하면(쿼터·PodSecurity·검증) runner 는 그 AI 를 `FAILED` 로 보고하고(message: 종류·이름·HTTP 상태·서버 사유 한 줄 — Secret 은 사유만) 30초 뒤 다시 본다.

## config.json

```json
{
  "agent": { "userId": 42, "username": "dev-ai", "tenantId": 1, "generation": 7 },
  "works": { "apiUrl": "https://genia-works.iacloud.kr/api/v1", "mcpUrl": "https://genia-works.iacloud.kr/mcp" },
  "template": { "name": "claude-code", "version": "1" },
  "config": { "model": "opus", "queue": "AI 개발팀" },
  "plugins": [{ "marketplace": "genia-works", "name": "genia-works", "version": "0.1.31" }]
}
```

`config` 는 desired 의 `config` 그대로, `plugins` 는 desired 의 `plugins` 그대로다.

## 사용자·디스크 배치

- agent 컨테이너는 UID/GID **1001**, `runAsNonRoot: true`. Pod `securityContext.fsGroup: 1001`.
- `HOME=/home/agent` — 이미지 안(휘발). Claude Code 설정·플러그인·genia-works 키는 시작할 때마다 새로 만든다 — 재생성된 Pod 에 옛 키·옛 플러그인이 남아 새 값을 가리지 않게.
- genia-works 플러그인은 엔트리포인트가 `GENIA_WORKS_API_URL` 의 origin + `/claude/marketplace.json` 에 닿으면 그 마켓플레이스를 지우고 다시 더해 Works 서버의 버전으로 받는다(이미지의 주소와 같아도). 닿지 않으면 이미지에 굳힌 버전으로 뜬다. `settings.json` 의 마켓플레이스 주소도 그 결과에 맞춘다.
- AI 키(`agent-key`)는 플러그인의 키 저장(`gw-keys add`)으로 놓는다 — AI 키 형식(`ak_…`)이 아니면 엔트리포인트가 한 줄 사유로 끝난다.
- `/work` 에는 다시 받기 비싼 것만 둔다.

| 경로 | 용도 |
|---|---|
| `/work/agents/<username>/` | AI 폴더(start-agent 의 「홈/AI 이름」) — `agent.conf`, `state/`, `repos/<프로젝트 키>` |
| `/work/tmp` | `TMPDIR` |
| `/work/.cache` | `XDG_CACHE_HOME`, `PLAYWRIGHT_BROWSERS_PATH=/work/.cache/ms-playwright` |
| `/work/.gradle` | `GRADLE_USER_HOME` |
| `/work/.pnpm-store` | `npm_config_store_dir` |

## dind

템플릿 sidecar 이름이 `dind` 이면 runner 가 고정으로 배선한다(템플릿에는 이름·이미지·privileged 만 있다).

- `securityContext.privileged: true`
- args: `--host=unix:///dind/docker.sock --group=1001`(agent 사용자가 소켓을 쓸 수 있게)
- env: `DOCKER_TLS_CERTDIR=""`
- `/var/lib/docker` 는 emptyDir(Helm `dind.storageLimit`, 기본 20Gi), `/dind` 마운트
- resources: Helm `dind.resources`(위 「자원」)

다른 이름의 sidecar 는 배선 없이 이름·이미지·privileged 만으로 컨테이너를 만든다(쿼터용 기본 requests 만 붙인다).

## 위치 값

nodeSelector·tolerations·hostAliases·storageClass·imagePullSecrets 는 위치(Helm 값)마다 하나다. runner 가 env 로 받아 그 위치의 모든 AI Pod 에 똑같이 넣는다. 작업 공간 이미지는 비공개 Docker Hub 에 있어 Helm 기본값이 `dockerhub-pull` 이다.

## 시작·종료

- `automountServiceAccountToken: false` — AI 는 쿠버네티스 API 를 쓰지 않는다(기본값이면 네임스페이스 기본 서비스 계정 토큰이 마운트된다).
- `restartPolicy: Always` — 컨테이너가 죽으면 kubelet 이 그 자리에서 다시 띄운다. Pod 를 지우고 다시 만드는 것(교체)은 runner 만 한다.
- `terminationGracePeriodSeconds` 기본 60(Helm `terminationGraceSeconds`).
- 엔트리포인트는 SIGTERM 을 받으면 work-loop 칸들을 정리하고 종료 코드 0 으로 끝낸다.
- **work-loop 가 DRAIN·RESTART 를 받고 멈춰도 엔트리포인트는 끝내지 않는다.** 끝내면 kubelet 이 같은 generation 으로 다시 띄워 헛돈다. 새 설정은 runner 가 Pod 를 지우고 다시 만들어서 반영한다.
