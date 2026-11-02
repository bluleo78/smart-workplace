# AI 실행 위치 runner API 계약 (runner 작성자용)

> Pod 와 작업 공간 이미지 사이의 약속(리소스 이름·마운트·환경 변수)은 [agent-pod-contract.md](agent-pod-contract.md) 에 따로 있다.

Works 가 관리하는 AI(실행 템플릿이 「작업 공간」인 AI)를 실제로 띄우는 것은 **실행 위치**(쿠버네티스 클러스터 등)마다 설치한 **runner** 다. runner 는 이 문서의 API 로 「이 위치에 떠 있어야 할 AI」를 받아 가 Pod 를 맞추고, 본 상태를 Works 에 보고한다(WP-1249). Works 는 runner 를 부르지 않는다 — 언제나 runner 가 Works 를 부른다.

## 인증

- 모든 호출은 `Authorization: Bearer rt_…` — 관리자 화면 「AI 실행 위치」에서 위치를 만들거나 토큰을 재발급할 때 **한 번만** 보이는 runner 토큰이다.
- 토큰은 **한 워크스페이스의 한 위치**에 묶인다. 응답에는 그 위치의 AI 만 나오고, 보고도 그 위치의 AI 만 반영된다.
- 위치당 쓸 수 있는 토큰은 하나다. 재발급하면 옛 토큰은 바로 401 이 되고, 이 API 인스턴스에 열려 있던 옛 토큰의 변경 스트림도 닫힌다.
- runner 토큰은 아래 `/api/v1/agent-runtime/runner/**` 에서만 통한다. 다른 API 에 쓰면 401 이다. 거꾸로 사람 로그인·AI 키(`ak_`)·개인 토큰(`swp_`)으로 runner API 를 부르면 403 이다.
- 워크스페이스가 정지·삭제되면 토큰이 맞아도 401 이다.

## 엔드포인트

### 원하는 상태 — `GET /api/v1/agent-runtime/runner/desired`

이 위치에 **켜져 있어야 할(desired=RUN) AI 만** 싣는다. 위치를 지정하지 않은 AI 는 워크스페이스의 기본 위치에 속한다.

```json
{
  "locationId": 3,
  "locationName": "운영 클러스터",
  "generatedAt": "2026-11-01T10:00:00+09:00",
  "pollIntervalSeconds": 300,
  "mcpUrl": "https://genia-works.iacloud.kr/mcp",
  "apiUrl": "https://genia-works.iacloud.kr/api/v1",
  "agents": [
    {
      "agentUserId": 42,
      "username": "dev-ai",
      "tenantId": 1,
      "generation": 7,
      "applyNow": true,
      "templateName": "claude-code",
      "templateVersion": "1",
      "image": "ghcr.io/bluleo78/agent-claude-code:1",
      "resources": { "cpuRequest": "4", "memoryRequest": "8Gi", "cpuLimit": "8", "memoryLimit": "16Gi", "workDisk": "50Gi" },
      "sidecars": [{ "name": "dind", "image": "docker:27-dind", "privileged": true }],
      "plugins": [{ "marketplace": "genia-works", "name": "genia-works", "version": "latest" }],
      "config": { "model": "opus", "queue": "AI 개발팀" },
      "secrets": [
        { "name": "agent-key", "source": "WORKS", "version": 812, "rotateAfter": "2026-11-24T10:00:00+09:00" },
        { "name": "claude", "source": "WORKS", "version": 57, "rotateAfter": null },
        { "name": "repos", "source": "WORKS", "version": 1730505600000, "rotateAfter": null }
      ]
    }
  ]
}
```

- **목록에 없는 AI 의 Pod 는 지운다.** 끄기·다른 위치로 옮기기·AI 삭제·사용 중지가 모두 같은 규칙이다. runner 는 자기가 만든 리소스에 라벨(예: AI id)을 붙여 두고 목록과 맞춘다.
- `tenantId` 는 Pod 환경변수 `GENIA_WORKS_TENANT` 로 넣는다. 여러 워크스페이스에 속한 AI 의 일할 워크스페이스를 정한다(Works 자동 발급 키는 이미 그 워크스페이스에 묶여 있어 헤더 없이도 그리로 들어가지만, 플러그인은 env 가 있으면 헤더를 함께 보낸다 — 같은 값이라 통한다).
- `generation` 은 Pod 환경변수 `GENIA_AGENT_GENERATION` 으로도 넣는다. 이 값이 있어야 Pod 안의 AI 가 상태를 보고한다(아래 「AI 상태 보고」 — 없으면 보고하지 않아 쉴 때 교체가 늦어진다).
- `mcpUrl`·`apiUrl` 은 Pod 의 MCP 주소와 `GENIA_WORKS_API_URL`(`/api/v1` 까지 포함) 로 넣는다.
- 실행 템플릿이 사라진 AI 는 싣지 않는다(띄울 방법이 없다 — 관리자 화면이 따로 알린다).

#### 언제 Pod 를 다시 만드나 — `generation` 과 `applyNow`

- runner 는 Pod 에 `generation` 을 라벨로 붙여 두고, **목록의 generation 이 Pod 의 것과 다를 때만** 다시 만든다. 이미지·자원·설정 같은 값만 바뀌고 generation 이 그대로면(예: Works 배포로 템플릿 이미지가 바뀜) 지금 Pod 를 두고, 다음에 다시 만들 때 반영한다.
- `applyNow` 는 Works 가 계산한다: `generation ≠ 마지막 보고한 observedGeneration` 이면서 다음 중 하나일 때.
  - 바로 적용(관리자가 켜기·다시 시작, 죽은 키 교체)이거나, 한 번도 뜬 적이 없다.
  - AI 가 쉬는 중(IDLE)이라고 보고했다. 단 그 보고가 지금 Pod 의 `startedAt` 보다 먼저 왔으면 옛 Pod 의 보고라 쓰지 않는다.
  - AI 키 교체가 아직 확인되지 않았는데(새 Pod 가 관찰되지 않음) 지금 Pod 가 쓰는 옛 키(그 워크스페이스에서 가장 오래된 활성 자동 발급 키)가 **24시간 안에 만료된다** — AI 가 오래 일하는 중이어도 죽을 키로 계속 돌지 않게.
  - `applyNow=false` 면 **지금 Pod 를 그대로 둔다**(AI 가 하던 일을 마치게). AI 가 쉬는 중이라고 보고하면 Works 가 변경 이벤트를 내고, runner 가 다시 조회하면 `applyNow=true` 가 된다.
  - 목록에 새로 나타난 AI(Pod 없음)는 `applyNow` 와 상관없이 띄운다.

#### 끄기는 즉시 정지(hard stop)

AI 를 끄면 desired 목록에서 빠지고, runner 는 그 Pod 를 바로 지운다. Pod 는 SIGTERM 유예 시간 안에서 정리하고 끝난다. **쉴 때까지 기다렸다 끄는 동작은 없다.** (AI 의 상태 보고가 「끄는 중이면 새 이슈를 집지 말라」는 답을 받는 것은 지워지는 Pod 를 위한 안전장치일 뿐이다.)

#### 비밀값

응답에는 원문이 없다. `secrets` 는 `{name, source, version, rotateAfter}` 다.

| name | source | 원문은 어디서 |
|---|---|---|
| `agent-key` | `WORKS` | `POST …/agents/{id}/agent-key`(아래). `version` = 지금 쓸 수 있는 Works 자동 발급 키 id(아직 없으면 `null`). 모든 AI 에 실린다. |
| `claude` | `WORKS` | `GET …/agents/{id}/secrets/claude`(아래). `version` = 관리자가 AI 에 등록한 활성 모델 연결 id(없으면 `null`). 템플릿이 요구할 때만 실린다. |
| `repos` | `WORKS` | `GET …/agents/{id}/secrets/repos`(아래). `version` = 그 AI 의 저장소 토큰 등록·교체·폐기 시각(epoch 밀리초) 중 가장 늦은 것 — 하나도 없으면 `null`. 템플릿이 `repo`(옛 이름 `github`)를 요구할 때만 실린다. 옛 `github`/`LOCATION`(위치 Secret)은 없어졌다. |

**언제 다시 받나**: runner 쪽 Secret 에 받은 버전을 적어 두고, `version` 이 그것과 다르거나(`null` → 값 포함) `rotateAfter` 가 지났을 때만 원문 엔드포인트를 부른다. `agent-key.version` 이 `null` 이면 Pod 를 띄우기 전에 먼저 받는다. `claude.version` 이 `null` 이면 연결이 없는 것이다(Pod 는 띄울 수 있지만 모델을 부를 수 없다). `repos.version` 이 `null` 이면 등록된 저장소 토큰이 없는 것이다(남은 `repo-*` 키를 지운다). `repos` 참조가 아예 없어도 같다.

### AI 키 받기 — `POST /api/v1/agent-runtime/runner/agents/{agentUserId}/agent-key`

Works 가 그 AI 의 키(`ak_…`)를 새로 발급해 **원문을 이 응답으로만 한 번** 준다(`Cache-Control: no-store`). Pod 의 Secret 에 담아 AI 키로 쓴다.

```json
{ "keyId": 812, "plaintext": "ak_…", "expiresAt": "2026-12-01T10:00:00+09:00", "rotateAfter": "2026-11-24T10:00:00+09:00" }
```

- **이 위치에서 켜져 있는(desired 목록에 있는) AI 만** 받는다. 꺼진 AI·다른 위치의 AI·없는 AI 는 404(`errors.code=RUNNER_AGENT_NOT_FOUND`).
- 키 수명은 30일, `rotateAfter` = 만료 7일 전. 관리자 화면 키 목록에는 「Works 자동 발급」으로 보이고 그 워크스페이스 관리자가 회수할 수 있다(회수하면 그 키는 바로 401 — `version` 은 다음으로 쓸 수 있는 키 또는 `null` 로 바뀌니 다시 받는다). 다른 워크스페이스가 같은 AI 에 발급한 키는 목록에 보이지 않고 회수도 404 다. 만료된 키는 목록에 「만료됨」으로 보이다가, 만료 하루 뒤 정기 정리가 회수 시각을 남긴다(그 뒤로는 회수된 키로 보인다).
- **키는 토큰의 워크스페이스에 묶인다.** 같은 AI 를 두 워크스페이스에서 Works 가 띄우면 키 사슬(발급·교체·정리·끄기·상한·desired 의 `agent-key.version`)이 워크스페이스마다 따로다 — 한쪽의 교체·끄기가 다른 쪽 Pod 의 키를 끊지 않는다. 이 키로 일반 API 를 부르면 헤더 없이도 그 워크스페이스로 들어가고, `X-On-Behalf-Of-Tenant` 로 다른 워크스페이스를 밝히면 401 이다(그 워크스페이스의 ACTIVE 멤버십은 여전히 필요하다).
- **교체 규칙.** Pod 안의 MCP 연결·알림 감시는 시작할 때 키를 읽어 들고 있어 **새 키는 Pod 를 다시 만들어야 반영된다.**
  - **교체** — 이미 쓸 수 있는 자동 발급 키가 있고 그 키가 Pod 에 쓰인 것이 확인됐는데(아래 「재시도」가 아님) 새로 받으면, Works 가 같은 트랜잭션에서 그 AI 의 `generation` 을 1 올리고(쉴 때 적용 — 아직 반영되지 않은 바로 적용이 걸려 있으면 그대로 바로 적용) 변경 이벤트를 낸다. runner 는 평소 규칙(`generation`·`applyNow`)대로 AI 가 쉴 때 새 키로 Pod 를 다시 만든다. 이 generation 올리기는 관리자가 남긴 설정·「누가 바꿨는지」를 바꾸지 않는다.
  - 옛 키는 그때 줄이지 않는다 — 지금 Pod 가 계속 쓴다(`rotateAfter` 덕에 남은 수명이 7일 이상, 24시간 안으로 줄면 위 `applyNow` 규칙이 쉬기를 기다리지 않는다). 새 `generation` 을 반영한 Pod 를 관찰 보고(`observedGeneration ≥ 교체 generation`)로 알리면, Works 가 그 AI 의 그 워크스페이스 옛 자동 발급 키를 **5분 뒤 만료**로 줄인다.
  - **재시도** — 받은 키가 아직 어떤 Pod 에도 쓰였다고 확인되지 않았으면(그 키를 받을 때의 `generation` 을 반영한 Pod 가 아직 관찰 보고되지 않음 — 끄기 전 Pod 의 관찰 값은 치지 않는다) 응답을 놓친 재시도로 보고 **generation 을 다시 올리지 않는다.** 같은 교체 generation 으로 새 키를 주고 전달되지 않은 앞 키는 바로 만료·회수한다. 응답을 놓쳤으면 그냥 다시 부르면 된다.
  - **죽은 키 교체** — 쓸 수 있는 자동 발급 키가 없는데 전에 있었고(관리자 회수·만료) Pod 가 떠 있었으면(관찰 보고가 있음), 그 Pod 는 이미 인증되지 않아 쉬는 중을 보고할 수도 없다. 새 키를 받으면 Works 가 `generation` 을 올리고 **바로 적용**으로 바꾼다. 이미 바로 적용이 걸려 있으면(끄고 다시 켬·다시 시작 직후 — runner 가 어차피 새 Pod 를 만든다) 올리지 않는다.
  - 첫 발급(그 워크스페이스에 자동 발급 키가 한 번도 없었음)은 `generation` 을 올리지 않는다.
- **끄기·AI 삭제·사용 중지·실행 설정 삭제·「내부 · 기본」 전환** 때 그 AI 의 자동 발급 키는 5분 뒤 만료로 줄어든다(지워지는 Pod 가 SIGTERM 유예 안에 마무리할 시간). 관리자가 직접 발급한 키는 건드리지 않는다.
- 관리자가 발급하는 키의 상한(AI 당 20개)은 관리자 발급 키만 센다. 자동 발급 키는 이 상한에 들지 않고 막히지도 않는다 — 교체 규칙이 AI·워크스페이스마다 두세 개(현재 키·교체 전 키·정리 유예 중인 키)로 묶는다.
- 같은 AI 의 키를 Pod 에 쓴 뒤 짧은 간격으로 거듭 받지 않는다 — 받을 때마다 교체가 되어 Pod 가 다시 만들어진다. 받은 원문은 로그에 남기지 않는다.

### 모델 연결 받기 — `GET /api/v1/agent-runtime/runner/agents/{agentUserId}/secrets/claude`

관리자가 그 AI 에 등록한 활성 모델 연결의 원문(`Cache-Control: no-store`).

```json
{ "version": 57, "provider": "anthropic", "payload": "sk-ant-oat01-…" }
```

- `provider` 가 `anthropic` 이면 `payload` 는 토큰, `opencode`(OpenAI 호환) 면 provider 설정 JSON 문자열이다.
- 이 위치에서 켜져 있는 AI 만(아니면 404 `RUNNER_AGENT_NOT_FOUND`), 등록된 연결이 없으면 404(`RUNNER_SECRET_NOT_FOUND`).
- 관리자가 연결을 다시 등록하면 `version` 이 바뀐다 — 다시 받아 Secret 을 바꾼다. 이것은 `generation` 을 올리지 않는다(Pod 를 언제 다시 만들지는 runner 가 정한다).

### 저장소 토큰 받기 — `GET /api/v1/agent-runtime/runner/agents/{agentUserId}/secrets/repos`

그 AI 에 관리자가 등록한 저장소 토큰 전부의 원문(`Cache-Control: no-store`). 활성만, host 오름차순.

```json
{ "version": 1730505600000, "tokens": [
  { "kind": "GITHUB", "host": "github.com", "token": "ghp_…" },
  { "kind": "GITLAB", "host": "gitlab.iacloud.kr", "token": "glpat-…" } ] }
```

- 이 위치에서 켜져 있는 AI 만(아니면 404 `RUNNER_AGENT_NOT_FOUND`). 등록이 없으면 `version: null`·빈 `tokens`(404 가 아니다).
- 토큰을 등록·교체·폐기하면 `version` 이 바뀐다 — 다시 받아 Secret 의 `repo-*` 키를 모두 바꾼다. 이것은 `generation` 을 올리지 않는다. gh 로그인이 Pod 시작 때 고정되므로 runner 가 Pod 를 다시 만든다(계약 문서 「저장소 토큰」).
- 받을 때마다 Works 가 각 토큰의 「최근 사용」을 갱신한다. 받은 원문은 로그에 남기지 않는다.

### 관찰 상태 보고 — `POST /api/v1/agent-runtime/runner/observed`

```json
{
  "agents": [
    { "agentUserId": 42, "observedGeneration": 7, "phase": "RUNNING", "message": null,
      "cpuMillicores": 1200, "memoryBytes": 3221225472, "startedAt": "2026-11-01T09:58:00+09:00" }
  ],
  "metricsAvailable": true
}
```

- `phase`: `STARTING` · `RUNNING` · `STOPPING` · `STOPPED` · `FAILED` 중 하나(그 밖은 400). `observedGeneration` 은 그 Pod 가 반영한 generation 이다. `message` 500자, 한 번에 200명까지.
- **이 위치의 AI 만** 반영한다(꺼진 AI 의 `STOPPING`·`STOPPED` 도 받는다 — 지운 뒤 `STOPPED` 를 보내야 관리자 화면이 「끄는 중」에서 「꺼짐」으로 바뀐다). 없는 AI·다른 위치의 AI 는 `ignored` 로 돌려준다. AI 를 다른 위치로 옮긴 뒤 옛 위치가 보낸 보고도 `ignored` 다.
- 응답: `{"updated": 1, "ignored": []}`. 보고는 generation 도, 원하는 상태도 바꾸지 않는다.
- `observedGeneration` 은 줄지 않는다 — 늦게 도착한 옛 Pod 보고(더 작은 값)는 그 칸을 되돌리지 않고, 값이 없는 보고는 그대로 둔다.
- 새 Pod 가 보이면(`phase=STARTING`, `startedAt` 이 바뀜, `observedGeneration` 이 오름) 옛 Pod 가 보고한 AI 상태(쉬는 중 등)를 지운다. 단 그 AI 보고가 새 Pod 의 `startedAt` 뒤에 왔으면 새 Pod 의 것이라 남긴다. `startedAt` 을 함께 보내야 이 판정이 정확하다.
- `metricsAvailable`(선택, WP-1280): 이 위치에서 CPU·메모리 사용량을 잴 수 있는지. 사용량 API(`metrics.k8s.io`)가 **없으면(404) `false`**, 조회가 되면 `true`, 일시 오류(그 밖의 실패)면 **보내지 않는다** — 서버는 값이 올 때만 위치에 적고, 없으면 마지막 값을 둔다. 관리자 화면은 `false` 인 위치의 AI CPU·메모리 칸에 「알 수 없음」과 이유(metrics-server 없음)를 보인다. 실행 위치 응답(`GET /api/v1/admin/agent-locations`)에 같은 이름으로 실린다(`null` = 아직 모름).
- **변화가 없어도 60초마다 보낸다.** CPU·메모리 갱신과 함께, 관리자 화면의 위치 연결 상태가 이 호출로 정해진다(마지막 호출이 2분 안이면 「연결됨」). desired 조회만 5분마다 하면 그 사이 「끊김」으로 보인다.

### 변경 스트림 — `GET /api/v1/agent-runtime/runner/events`

- `text/event-stream`. 붙으면 첫 코멘트 `:connected`, 이후 30초마다 `:ping` 코멘트가 온다.
- 이 위치의 원하는 상태가 바뀌면(켜기·끄기·설정 변경·위치 이동·기본 위치 이동·AI 삭제·AI 키 교체, AI 가 쉬는 중이라 교체할 때가 됨 — 마지막은 AI 상태 보고(WP-1250) 이후) 커밋 뒤에 이벤트가 온다.

  ```
  event:agent-runtime.changed
  data:{"locationId":3}
  ```

  받으면 desired 를 다시 조회한다. 이벤트에는 내용이 없다 — 늘 desired 가 기준이다.
- 연결은 30분이면 서버가 닫는다. 바로 다시 붙는다(토큰을 다시 검증받는다). 위치당 연결은 3개까지이고, 넘으면 가장 오래된 연결이 닫힌다.
- **이벤트는 빨리 알기 위한 최선 노력이다.** 스트림은 API 인스턴스 메모리에 있어 API 를 여러 대 띄우면 다른 인스턴스에서 난 변경은 오지 않을 수 있고, 끊긴 동안의 변경도 다시 보내지 않는다. **정합성은 `pollIntervalSeconds`(300초)마다의 desired 조회가 맞춘다** — 스트림이 붙어 있어도 주기 조회를 멈추지 않는다.

### 작업 화면(WP-1277)

관리자가 Works 화면에서 실행 중인 AI 의 터미널(tmux)을 보거나 키를 칠 수 있게, runner 가 Works 로 화면 전용 WebSocket 을 연다. Works 는 관리자 브라우저 소켓과 이 소켓을 세션 id 로 짝지어 프레임을 넘긴다(API 한 대 메모리 — [multi-instance.md](../ops/multi-instance.md)).

1. **화면 열기 알림 — 변경 스트림 이벤트.** 관리자 브라우저가 붙으면 그 AI 의 실제 위치 스트림으로 온다.

   ```
   event:agent-runtime.screen
   data:{"sessionId":"6f1c…-uuid","agentUserId":12}
   ```

2. **화면 소켓 — `GET /api/v1/agent-runtime/runner/screen/{sessionId}` (WebSocket 업그레이드).** 다른 runner API 와 같이 `Authorization: Bearer rt_…` 로 인증한다. 세션의 테넌트·위치가 토큰의 것과 같아야 하고(다른 위치의 유효한 토큰도 403), 세션당 runner 소켓은 하나다(두 번째는 403). 알림을 받고 **15초 안에** 붙지 않으면 Works 가 세션을 닫는다(브라우저에 「실행 환경에 연결하지 못했어요」).
3. **프레임** — 한 프레임은 64KB 까지.

   | 방향 | 종류 | 내용 |
   |---|---|---|
   | runner → Works | 바이너리 | 터미널 출력. 그대로 브라우저로 간다 |
   | runner → Works | 텍스트 | `{"type":"status","state":"attached"\|"ended","reason"?}` · `{"type":"windows","items":[{"index","name","width","height","active"}]}` · `{"type":"input","enabled":bool,"allowed":bool}` · `{"type":"error","message"}` — 그대로 브라우저로 간다 |
   | Works → runner | 텍스트 | `{"type":"resize","cols","rows"}` · `{"type":"window","index"}` · `{"type":"input","enabled":bool}` (브라우저 요청을 그대로). 그 밖의 종류는 Works 가 버린다 |
   | Works → runner | 바이너리 | 키 입력. **runner 가 `{"type":"input","enabled":true}` 를 보낸 뒤에만** 온다 |

   - **입력은 runner 가 켰다고 알릴 때 열린다.** 브라우저의 `{"type":"input","enabled":true}` 는 runner 로 넘길 뿐이고, Works 는 runner 가 `{"type":"input","enabled":true,…}` 를 보낸 순간부터 키 입력을 넘기며 그때 세션 기록(`input_enabled_at/by`)과 감사 로그 「작업 화면 입력 허용」을 남긴다. 위치가 입력을 허용하지 않으면(차트 `screen.allowInput` 끔) runner 는 `{"type":"error","message":"이 실행 환경은 작업 화면 입력을 허용하지 않아요"}` 로 답하고 켜지 않는다. runner 가 `enabled:false` 를 보내면(또는 브라우저가 끄기를 보내면 바로) 키 입력을 다시 버린다.
   - 같은 AI 의 다른 화면이 이미 입력 중이면 Works 는 브라우저의 켜기 요청을 runner 로 넘기지 않고 브라우저에 `{"type":"error","message":"다른 관리자가 이미 입력 중이에요"}` 를 보낸다. 그 사이 runner 가 켰다고 알려 와도 Works 는 runner 에 `{"type":"input","enabled":false}` 를 보내고 그 알림을 넘기지 않는다.
   - 넘긴 키 입력은 약 1초마다 감사 기록(`agent_screen_input`, 제어 문자는 `\x1b` 표기)에 남는다. 세션당 1MB 까지이고, 넘으면 「[기록 상한 — 이후 입력은 기록하지 않음]」 한 줄을 남기고 기록만 멈춘다(입력은 계속 넘긴다).
4. **수명** — Works 가 25초마다 양쪽에 ping 을 보낸다. 30분 동안 오간 프레임이 없거나 연 지 4시간이 지나면 닫는다. 한쪽이 닫히면 다른 쪽도 닫힌다 — runner 쪽 소켓이 닫히면 화면 세션은 끝난 것이다(다시 붙지 않는다). Works 가 닫을 때는 브라우저에 `{"type":"status","state":"ended","reason":"…"}` 를 먼저 보낸다.

## AI 상태 보고 — `PUT /api/v1/agent-runtime/me/status` (Pod 안의 AI 가 부름)

runner 가 아니라 **Pod 안의 AI** 가 자기 AI 키(`Authorization: Bearer ak_…`, 위 `agent-key`)로 부른다(WP-1250). 플러그인 스크립트 `gw-status` 가 이 호출을 하고, `GENIA_AGENT_GENERATION` 이 없으면(Works 가 띄운 AI 가 아니면) 부르지 않는다. 여러 워크스페이스에 속한 AI 는 `X-On-Behalf-Of-Tenant: <GENIA_WORKS_TENANT>` 를 함께 보낸다(플러그인이 env 가 있으면 붙인다).

```json
{ "state": "IDLE", "issueKey": null, "nextCheckAt": "2026-11-01T12:00:00+09:00", "generation": 7 }
```

- `state`: `IDLE`(쉬는 중) · `WORKING`(이슈 처리 중) · `BLOCKED` 중 하나(필수, 그 밖은 400). `issueKey` 32자. `generation` 은 Pod 의 `GENIA_AGENT_GENERATION`.
- 응답 `{"desired": "RUN" | "DRAIN" | "RESTART"}`:
  - AI 가 꺼졌으면(desired=STOP) `DRAIN` — 지워지는 Pod 가 새 이슈를 집지 않게 하는 **안전장치일 뿐**이다. 끄기는 위 「끄기는 즉시 정지」대로 runner 가 바로 Pod 를 지운다.
  - 보낸 `generation` 이 지금 설정보다 작으면, desired 의 `applyNow` 와 같은 판정(위 「언제 Pod 를 다시 만드나」 — 이번 보고까지 반영해서)이 참이면 `RESTART`(곧 다시 띄워진다 — 바로 적용, 이번 보고가 쉬는 중, 지금 Pod 의 옛 키가 24시간 안에 만료 등), 아니면 `DRAIN`(새 이슈를 집지 않고 쉰다 — 쉬면 runner 가 다시 띄운다).
  - 그 밖은 `RUN`.
- 보고는 관리자 화면의 AI 상태(`observed.agentState`·`agentIssueKey`·`agentNextCheckAt`)로 보인다. generation·원하는 상태는 바꾸지 않는다.
- **쉬는 중으로 바뀐** 보고(앞 보고가 `IDLE` 이 아니었음 — 새 Pod 가 보여 AI 상태가 지워진 뒤 첫 보고 포함)인데 아직 반영하지 않은 generation 이 있으면(generation ≠ 마지막 observedGeneration) Works 가 그 AI 의 실제 위치로 `agent-runtime.changed` 를 낸다 — runner 가 다시 조회하면 `applyNow=true` 다. 이미 쉬는 중이던 AI 가 다음 확인마다 `IDLE` 을 거듭 보고해도 이벤트를 다시 내지 않는다(놓친 이벤트는 주기 조회가 맞춘다).
- 실행 설정이 없는 AI(외부에서 돌리는 AI)나 워크스페이스가 정해지지 않은 호출은 아무것도 저장하지 않고 `RUN` 이다. AI 키(`ak_`)가 아닌 인증(사람 로그인·개인 토큰 등)으로 부르면 403(`AGENT_STATUS_AGENT_ONLY`).

## 맡는 프로젝트 — `GET /api/v1/agent-runtime/me/projects` (AI 가 부름)

AI 가 자기 키(`Authorization: Bearer ak_…`)로 부른다(WP-1275). Works 가 띄운 AI 만이 아니라 사람이 띄운 AI(start-agent)도 쓴다 — 플러그인 `gw-agent-projects --assigned` 가 이 호출을 하고 「키<탭>저장소 주소<탭>브랜치」 줄로 바꾼다. 작업 공간 엔트리포인트(부팅 때 칸 열기)·알림 감시(칸 없는 프로젝트 알림 — WP-1272)·work-loop 의 「새 프로젝트 확인」이 모두 이것을 부른다. 여러 워크스페이스에 속한 AI 는 `X-On-Behalf-Of-Tenant` 를 함께 보낸다.

```json
[{ "projectKey": "WP", "name": "Works", "repositoryUrl": "https://github.com/acme/works.git", "repositoryBranch": null, "repositoryHost": "github.com" }]
```

- 그 AI 가 **실제 멤버**(직접 멤버 또는 멤버로 둔 부서 — 관리자라 보이기만 하는 프로젝트·공개 열람은 치지 않는다)이고 **연결된 저장소**가 있으며 지워지지 않은 프로젝트만, 키 순으로. 키는 폴더·tmux 칸 이름이 되므로 `^[A-Za-z0-9_-]+$` 형식이 아니면 뺀다. 관리자 화면의 「맡는 프로젝트」와 같은 목록이다.
- `repositoryBranch` 가 null 이면 저장소의 기본 브랜치를 쓴다. `repositoryHost` 는 저장소 주소의 호스트(소문자)를 서버가 계산한 값이다(읽을 수 없으면 null) — 저장소 토큰을 맞출 때 호스트 기준이다. 맡는 프로젝트가 없으면 `[]`.
- 워크스페이스가 정해지지 않은 호출(여러 워크스페이스에 속한 AI 가 헤더 없이 부름)은 400(`AGENT_WORKSPACE_REQUIRED`) — `[]` 이면 「맡은 프로젝트 없음」과 구분되지 않는다. AI 키(`ak_`)가 아닌 인증으로 부르면 403(`AGENT_PROJECTS_AGENT_ONLY`).

## 오류

본문은 다른 API 와 같은 모양(`status`·`message`·`errors`)이다.

| 상태 | 언제 |
|---|---|
| 400 | 관찰 보고 형식이 틀림(`phase` 값, 200명 초과, `agents` 없음 등) |
| 401 | 토큰 없음·모르는 토큰·재발급으로 회수된 토큰·정지된 워크스페이스, 또는 runner 토큰으로 다른 API 호출 |
| 403 | runner 토큰이 아닌 인증으로 runner API 호출 |
| 404 | 토큰의 위치가 없음(`errors.code=AGENT_LOCATION_NOT_FOUND`), 비밀값을 받으려는 AI 가 이 위치에서 켜져 있지 않음(`RUNNER_AGENT_NOT_FOUND`), 모델 연결이 없음(`RUNNER_SECRET_NOT_FOUND`) |
