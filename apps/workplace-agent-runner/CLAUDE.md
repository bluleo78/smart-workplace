# CLAUDE.md (workplace-agent-runner)

루트 [CLAUDE.md](../../CLAUDE.md) 와 함께 본다. 본 문서는 agent-runner 단독 사항만 다룬다.

## 이 앱의 목적

실행 위치(쿠버네티스 네임스페이스 하나)에 설치하는 **runner**(WP-1251). Works 의 runner API
([agent-runner-api.md](../../docs/integrations/agent-runner-api.md))에서 「이 위치에 떠 있어야 할 AI」를 받아
AI 마다 Pod·Secret·ConfigMap(pvc 방식이면 PVC 도)을 맞추고, 본 상태를 60초마다 보고한다. 리소스 모양(이름·라벨·마운트·env·dind)은
[agent-pod-contract.md](../../docs/integrations/agent-pod-contract.md) 하나로 작업 공간 이미지(WP-1252)와 맞물린다 — 바꾸면 두 쪽을 함께 바꾼다.

## 절대 규칙

- **runner 라벨(`app.kubernetes.io/managed-by=genia-agent-runner`)이 없거나 `genia.works/location` 이 내 위치가 아닌 리소스는 만지지 않는다.**
  나열은 라벨 셀렉터로, 위치는 `ownedByLocation` 으로 거른다(한 네임스페이스에 runner 가 둘이어도 서로 지우지 않게). 같은 이름의 남의 리소스가
  있으면 만들지 않고 FAILED 로 알린다. 네임스페이스 범위 API 만 쓴다.
- **`POST …/agent-key` 는 곧 키 교체(generation+1 → Pod 재생성)다.** 받은 `keyId`·`rotateAfter` 를 원문과 같은 apply 로
  Secret 어노테이션에 적고, 그것과 desired 의 `version` 을 비교해 다를 때만 부른다(`secretFetches`). runner 재시작만으로는 부르지 않는다.
- **키·토큰 원문은 로그·오류 메시지에 남기지 않는다.** k8s 오류는 `ClusterError`(`k8s/cluster.ts` 의 `wrap`)로 — 종류·이름·HTTP 상태·
  Status.reason 과 서버 message 첫 줄(200자)만 담고, Secret 은 서버 message 도 뺀다. 응답 본문 원문은 쓰지 않는다.
- runner 토큰은 파일(`RUNNER_TOKEN_FILE`)에서만 읽는다.

## 구조

| 파일 | 하는 일 |
|---|---|
| `src/config.ts` | env → `RunnerConfig`(잘못된 값이면 시작 실패) |
| `src/works/client.ts` | runner API 모양·`WorksClient`·fetch 구현 |
| `src/works/events.ts` | 변경 스트림(SSE) — `agent-runtime.changed` 만 조정 트리거, 헤더 30초·무데이터 90초 제한, 1→30초 백오프, 401 은 1분 |
| `src/k8s/manifest.ts` | 계약대로 Pod·PVC·ConfigMap·Secret 을 만드는 순수 함수 |
| `src/k8s/cluster.ts` | `ClusterApi`·`@kubernetes/client-node` 구현(server-side apply, fieldManager `genia-agent-runner`) |
| `src/plan.ts` | `ownedByLocation`·`collectActual`·`emptyActual`·`planReconcile`·`checkImages`(순수) |
| `src/secrets.ts` | `secretFetches` — 언제 원문(agent-key·claude·login·repos)을 다시 받을지(순수) |
| `src/observe.ts` | `toObserved` — Pod → phase, metrics 수량 해석(순수) |
| `src/reconciler.ts` | 조정 한 회차(AI 별 동시 4명, STOPPED 는 회차 끝에 200명씩 모아 보냄)·관찰 보고·`ReconcileLoop`(트리거 합치기, `retry` — 일시 오류 5초·지우는 중 기다림 15초·거절 30초, 주기 조회) |
| `src/screen.ts`·`src/works/screenSocket.ts`·`src/k8s/exec.ts` | 작업 화면 보기(WP-1277) — SSE `agent-runtime.screen` 을 받으면 Works 로 화면 소켓(`…/runner/screen/{sessionId}`)을 열고 AI Pod 에 exec 로 `agent-screen` 을 붙여 바이트를 잇는다. 보기 전용이면 입력 바이트를 버리고, 입력 허용으로 바뀌면 `--input` 으로 다시 붙는다. 입력은 `SCREEN_ALLOW_INPUT=true`(차트 `screen.allowInput`, 기본 꺼짐)일 때만 받는다 — 셸 권한과 같다. 한 runner 에 동시 10개 |
| `src/main.ts` | 배선·`/healthz`(`HEALTH_PORT`, 기본 8080, 마지막 조정 성공 10분 안이면 200) |

## 동작 요점

- desired 에 있고 Pod 없음 → 만든다(applyNow 무관). generation 이 다르면 `applyNow=true` 일 때만 Pod 를 지우고 다음 회차에 다시 만든다(PVC·Secret 유지).
- 모델 연결 교체: Pod 어노테이션 `genia.works/claude-version`(만들 때 Secret 의 version)이 Secret 의 것과 다르면(없음 ↔ 값 포함) generation·applyNow 와
  무관하게 Pod 를 다시 만든다 — 토큰이 env 로 고정되고 Works 는 재등록에 generation 을 올리지 않기 때문. 허용 밖 이미지면 지우지 않는다.
- 로그인 정보(WP-1296, Gen:iA·ChatGPT): desired 의 `login`(WORKS) 참조 version 이 Secret 어노테이션 `genia.works/login-version` 과 다르면 `GET …/secrets/login` 으로 받아 Secret 키 `login-info`·어노테이션에 적고, 참조가 없거나 version null·404 면 둘 다 지운다(claude 와 같은 규칙, provider 검사 없음 — 서버가 템플릿 계정과 맞을 때만 version 을 싣는다). 못 받으면 옛 값을 두고 AI 키는 적는다. 원문은 로그에 남기지 않는다.
  Pod 는 Secret 에 login version 이 있을 때만 `/run/genia/login-info`(subPath `login-info`)·env `GENIA_LOGIN_VERSION`·Pod 어노테이션 `login-version` 을 넣고, Secret 의 version 이 Pod 의 것과 다르면(없음 ↔ 값 포함) 모델 연결 교체처럼 바로 Pod 를 다시 만든다. `NON_ANTHROPIC_MESSAGE` 실패는 `claude` 참조에만 쓴다.
- 저장소 토큰(WP-1268): desired 의 `repos`(WORKS) 참조 version 이 Secret 어노테이션 `genia.works/repos-version` 과 다르면 `GET …/secrets/repos` 로 받아 Secret 의 `repo-<kind>-<host>` 키를 모두 바꿔 넣고(어노테이션 `repo-hosts` 에 `kind:host` 목록), 참조가 없거나 version null 이면 `repo-*` 키·두 어노테이션을 지운다.
  Pod 는 만들 때 `repo-hosts` 로 볼륨 `repo-tokens`(Secret `agent-<id>`, items `<kind>/<host>`)를 `/run/genia/repo-tokens` 에 마운트하고(호스트 없으면 없음) 어노테이션 `genia.works/repos-version` 을 적는다.
  gh 로그인이 Pod 시작 때 고정되므로 Secret 의 version 이 Pod 의 것과 다르면 모델 연결 교체처럼 Pod 를 다시 만든다. 위치 GitHub Secret(`GITHUB_SECRET_NAME`)은 없어졌다.
- agent-key 는 desired `version` 이 null 이거나 기록과 다를 때, 또는 기록한 rotate-after 가 지났을 때만 받는다. 끄기·위치 이동으로 5분 유예에 든 키는
  Works 가 desired 에서 `version=null` 로 내므로 「수명을 줄였는지」는 Works 한 곳이 정한다(runner 는 desired 의 `rotateAfter` 를 견주지 않는다).
- 클러스터가 apply·delete 를 거절하면(400·403·422 — 쿼터·PodSecurity·검증) 그 AI 를 FAILED(사유 한 줄)로 보고하고 30초 뒤 다시 본다.
  404·409·429·5xx·네트워크 오류는 일시 오류로 5초 재시도. 지우는 중인 Pod·PVC 가 사라지기만 기다리는 회차는 15초. desired 에서 빠진 AI 의 거절은 로그로만 남긴다(관찰 보고가 STOPPING/STOPPED 라).
- 모든 컨테이너에 requests 를 둔다(네임스페이스 쿼터 승인) — agent 는 템플릿 값(없으면 limit, 그것도 없으면 cpu 1·memory 2Gi), dind 는 `DIND_RESOURCES`,
  그 밖의 사이드카는 cpu 100m·memory 128Mi. 계약 문서 「자원」.
- desired 에서 빠짐 → Pod·PVC·Secret 삭제. ConfigMap 은 Pod 가 사라지고 STOPPED 보고가 받아들여진 뒤 마지막에 지운다 — 남아 있으면
  「아직 STOPPED 못 보냄」 표시라 runner 가 재시작해도 STOPPED 를 보낸다. 이미 deletionTimestamp 가 있는 리소스엔 삭제를 다시 내지 않고,
  ConfigMap 이 지워졌는데 PVC 만 Terminating 이면 STOPPED 도 다시 보내지 않는다.
- 작업 디스크는 기본 노드 로컬 폴더(`AGENT_WORK_DISK_TYPE=hostPath`) — PVC 를 만들지 않고, Pod 가 처음 배치된 노드를 Secret 어노테이션
  `genia.works/work-node` 에 적어 다시 만드는 Pod 를 그 노드에 고정한다(init 컨테이너 `work-owner` 가 폴더 주인을 1001 로). 노드 폴더는 지우지 않는다.
  `pvc` 방식에서만 PVC 를 만들고 지우는 중인 PVC 를 기다린다. 예전 PVC 가 남아 있으면 방식과 무관하게 desired 에서 빠질 때 지운다.
- PVC 는 없을 때만 만든다. ConfigMap 은 Pod 를 만들 때만 쓴다(config.json 에 generation 이 있어 keep 중인 Pod 를 흔들지 않게).
- 메모리 상태는 마지막 desired 와 AI 별 실패 사유뿐 — 나머지 기록은 모두 클러스터에 있다.

## env (Helm 차트 `deploy/helm-agent-runner` 가 넣는다)

`WORKS_URL`, `RUNNER_TOKEN_FILE`, `NAMESPACE`, `ALLOWED_IMAGE_PREFIXES`(쉼표), `AGENT_NODE_SELECTOR`·`AGENT_TOLERATIONS`·`AGENT_HOST_ALIASES`(JSON),
`AGENT_WORK_DISK_TYPE`(hostPath·pvc, 기본 hostPath), `AGENT_WORK_HOST_PATH`(기본 /var/lib/genia-agents), `AGENT_STORAGE_CLASS`(pvc 만), `AGENT_CA_CONFIGMAP`(추가 CA ConfigMap — 키 `ca.crt` 를 AI Pod `/run/genia/ca` 에 꽂는다, WP-1276), `DIND_STORAGE_LIMIT`(기본 20Gi), `DIND_RESOURCES`(JSON, 기본 requests 250m/512Mi·limits 2/4Gi),
`AGENT_IMAGE_PULL_SECRETS`(쉼표), `SCREEN_ALLOW_INPUT`(true·false, 기본 false — 작업 화면 입력 허용, WP-1277), `TERMINATION_GRACE_SECONDS`(기본 60), `HEALTH_PORT`(기본 8080 — 차트는 넣지 않는다).

로컬 실행은 `pnpm --filter @smart-workplace/workplace-agent-runner start:local`(KUBECONFIG·env 필요). `dev` 스크립트는 일부러 없다 —
루트 `pnpm dev` 가 클러스터를 만지는 runner 를 띄우지 않게.

## 테스트

`pnpm --filter @smart-workplace/workplace-agent-runner test` — k8s·Works 는 `src/testing/fakes.ts` 의 가짜를 끼워 실제 클러스터 없이 돈다.
