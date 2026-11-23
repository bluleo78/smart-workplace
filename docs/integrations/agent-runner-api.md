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
      "resources": { "cpuRequest": "2", "memoryRequest": "4Gi", "cpuLimit": "8", "memoryLimit": "16Gi", "workDisk": "50Gi" },
      "sidecars": [{ "name": "dind", "image": "docker:29.9.3-dind@sha256:7bf70dcb85c822e3fa6f2d332143e474b99147b9d7b39102b0cfe8b04a7dd61b", "privileged": true }],
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

- runner 는 Pod 에 `generation` 을 라벨로 붙여 두고, **목록의 generation 이 Pod 의 것과 다를 때만** 다시 만든다. Works 배포로 작업 공간 이미지나 genia-works 플러그인 버전이 바뀌면 Works 가 기동 때 켜져 있는(한 번이라도 뜬) AI 의 generation 을 올리고 쉴 때 적용을 건다(걸려 있는 바로 적용은 그대로) — 쉬는 AI 는 곧, 일하는 AI 는 `DRAIN` 뒤 쉴 때 새 버전으로 다시 뜬다. 플러그인 버전 비교는 배포가 `AGENT_PLUGIN_VERSION` 을 넣을 때만 한다(비면 이미지 digest 만 비교 — 전달은 WP-1707). 자원·보조 컨테이너 같은 그 밖의 템플릿 값만 바뀐 것은 여전히 다음에 다시 만들 때 반영한다.
- `applyNow` 는 Works 가 계산한다: `generation ≠ 마지막 보고한 observedGeneration` 이면서 다음 중 하나일 때.
  - 바로 적용(관리자가 켜기·다시 시작, 죽은 키 교체)이거나, 한 번도 뜬 적이 없다.
  - AI 가 쉬는 중(IDLE)이라고 보고했다. 단 그 보고가 지금 Pod 의 `startedAt` 보다 먼저 왔으면 옛 Pod 의 보고라 쓰지 않는다.
  - 지금 Pod 의 컨테이너가 시작에 실패했다고 보고했고(아래 「칸 차단 보고」) 진행 중인 일이 없다(WP-1969). 시작도 못 한 컨테이너는 `IDLE` 을 보고할 수 없어 기다리면 설정이 영영 나가지 않기 때문이다.
    - 지금 Pod 의 차단: 차단의 `generation` 이 `observedGeneration` 과 같고(모르는 값이면 아님) 지금 Pod 보다 앞선 Pod 의 것이 아니다.
    - 진행 중인 일이 없음은 셋 중 하나다.
      1. 합친 AI 상태가 `IDLE` 이다.
      2. 상태가 없고, 남은 칸이 없거나 쉬던 오래된 칸뿐이다.
      3. 상태가 없고, 일하다 끊긴 칸의 마지막 보고가 차단한 Pod 의 `podStartedAt` 보다 30초 넘게 앞선다.
    - 그 밖에는 기다린다: `WORKING`·`BLOCKED`, 그 Pod 에서 일하다 보고가 끊긴 AI, 끊긴 칸이 있는데 차단에 `podStartedAt` 이 없어 가를 수 없는 AI.
    - 한계: 3 은 서버가 받은 시각과 Pod 시계를 견주므로 노드 시계가 30초 넘게 어긋나면 잘못 가를 수 있다(WP-1968).
  - 지금 Pod 가 시작에 실패했다고 runner 가 관찰했고(`phase=FAILED`, 차단 보고 없이도) 진행 중인 일이 없다(WP-2000). 기다리면 설정이 영영 나가지 않는 것은 위와 같다. 진행 중인 일이 없음의 기준은 위와 같되 기준 시각이 다르다 — 차단이면 차단한 Pod, 관찰 실패면 지금 Pod 시작(관찰한 `started_at` 과 보고가 올려 둔 Pod 시작 중 늦은 쪽)이고, 모르면 기다린다. 새 generation 이 반영되면(`observedGeneration` 갱신) 다시 만들기는 되풀이되지 않는다. 일이 있으면 끊지 않고 쉴 때까지 둔다.
  - AI 키 교체가 아직 확인되지 않았는데(새 Pod 가 관찰되지 않음) 지금 Pod 가 쓰는 옛 키(그 워크스페이스에서 가장 오래된 활성 자동 발급 키)가 **24시간 안에 만료된다** — AI 가 오래 일하는 중이어도 죽을 키로 계속 돌지 않게.
  - `applyNow=false` 면 **지금 Pod 를 그대로 둔다**(AI 가 하던 일을 마치게). AI 가 쉬는 중이라고 보고하거나, 칸 보고(`BLOCKED`·`OK`)·AI 상태 보고·관찰 보고(예: `phase=FAILED`)로 위 `applyNow` 가 거짓에서 참이 되면 Works 가 변경 이벤트를 내고(WP-1969·WP-2000 — 보고 한 번에 한 번이며, 이미 참이던 AI 나 사유만 바뀐 보고는 내지 않는다), runner 가 다시 조회하면 `applyNow=true` 가 된다.
  - 목록에 새로 나타난 AI(Pod 없음)는 `applyNow` 와 상관없이 띄운다.

#### 끄기는 즉시 정지(hard stop)

AI 를 끄면 desired 목록에서 빠지고, runner 는 그 Pod 를 바로 지운다. Pod 는 SIGTERM 유예 시간 안에서 정리하고 끝난다. **쉴 때까지 기다렸다 끄는 동작은 없다.** (AI 의 상태 보고가 「끄는 중이면 새 이슈를 집지 말라」는 답을 받는 것은 지워지는 Pod 를 위한 안전장치일 뿐이다.)

#### 비밀값

응답에는 원문이 없다. `secrets` 는 `{name, source, version, rotateAfter}` 다.

| name | source | 원문은 어디서 |
|---|---|---|
| `agent-key` | `WORKS` | `POST …/agents/{id}/agent-key`(아래). `version` = 지금 쓸 수 있는 Works 자동 발급 키 id(아직 없으면 `null`). 모든 AI 에 실린다. |
| `claude` | `WORKS` | `GET …/agents/{id}/secrets/claude`(아래). `version` = 관리자가 AI 에 등록한 활성 모델 연결 id(없으면 `null`). 템플릿이 요구할 때만 실린다. |
| `login` | `WORKS` | `GET …/agents/{id}/secrets/login`(아래). `version` = 활성 AI 계정(자격증명) id(OpenAI 호환은 아래 「로그인 정보 받기」의 계산 값) — **활성 계정의 종류가 템플릿이 요구하는 계정(`genia`→Gen:iA 로그인, `chatgpt`→ChatGPT 로그인, `opencode`→OpenAI 호환 연결)과 같을 때만**, 연결이 없거나 다른 종류면 `null`. 템플릿이 `genia`·`chatgpt`·`opencode` 를 요구할 때만 실린다. |
| `repos` | `WORKS` | `GET …/agents/{id}/secrets/repos`(아래). `version` = 그 AI 의 저장소 토큰 등록·교체·폐기 시각(epoch 밀리초) 중 가장 늦은 것 — 하나도 없으면 `null`. 템플릿이 `repo`(옛 이름 `github`)를 요구할 때만 실린다. 옛 `github`/`LOCATION`(위치 Secret)은 없어졌다. |

`login` 참조와 별개로 각 AI 항목에는 `loginRevision`(숫자, 로그인이 없으면 `null`)이 실린다(WP-1450). 서버가 같은 계정의 ChatGPT 로그인을 갱신하면 `login.version` 은 그대로고 `loginRevision` 만 오른다 — runner 는 이것이 Secret 어노테이션 `genia.works/login-revision` 과 다르면 `login-info` 만 다시 받아 Secret 을 갱신하고 **Pod 는 다시 만들지 않는다**(Pod 교체는 `login.version` 이 바뀔 때만). 이렇게 `loginRevision` 만 올라 다시 받았는데 `404` 면(복호화 실패·일시적 템플릿 불일치) 옛 `login-info`·`login-version` 을 그대로 두고 `login-revision` 도 적지 않아 다음 회차에 다시 받는다(경고 로그만).

**언제 다시 받나**: runner 쪽 Secret 에 받은 버전을 적어 두고, `version` 이 그것과 다르거나(`null` → 값 포함) `rotateAfter` 가 지났을 때만 원문 엔드포인트를 부른다. `agent-key.version` 이 `null` 이면 Pod 를 띄우기 전에 먼저 받는다. `claude.version` 이 `null` 이면 연결이 없는 것이다(Pod 는 띄울 수 있지만 모델을 부를 수 없다). `repos.version` 이 `null` 이면 등록된 저장소 토큰이 없는 것이다(남은 `repo-*` 키를 지운다). `repos` 참조가 아예 없어도 같다. `login.version` 이 `null` 이거나 `login` 참조가 없으면 남은 로그인 정보를 지운다(서버가 종류를 맞춰 보내므로 runner 는 `provider` 를 따로 검사하지 않는다).

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

### 로그인 정보 받기 — `GET /api/v1/agent-runtime/runner/agents/{agentUserId}/secrets/login`

그 AI 의 활성 AI 계정 중 템플릿이 요구하는 종류(Gen:iA·ChatGPT 로그인, OpenCode 템플릿은 OpenAI 호환 연결)의 원문(`Cache-Control: no-store`). `claude` 엔드포인트와 같은 헤더를 쓴다.

```json
{ "version": 88, "provider": "genia", "payload": "{\"…\": \"…\"}" }
```

- `payload` 는 서버가 다듬어 저장한 로그인 정보 — Gen:iA Code·Codex 가 쓰는 `auth.json` 내용(JSON 문자열)이다. runner 는 이 값을 Secret 키 `login-info` 에 그대로 넣고 해석하지 않는다.
- **OpenCode 템플릿(WP-1410)**: `provider` 는 `opencode`(OpenAI 호환 연결)이고 `payload` 는 등록 때 저장된 연결 정보 원문 JSON 객체(`providerId`·`options`{`baseURL`·`apiKey`…}, 등록 요청에 넣었으면 `npm`·`name`·`models` — 화면 등록은 넣지 않는다, 이미지 입력을 지정했으면 `vision`)에 `"defaultModel"` 필드 하나를 더한 것이다. `defaultModel` 은 그 AI 에 지정한 모델이 이 연결의 `providerId/` 로 시작하고 모델 id 가 비지 않을 때만 그 값, 아니면(옛 Claude 기본값·다른 연결의 값·지정 없음) `null` 이다. `version` 은 연결 행 id 가 아니라 「연결 행 id + 지정 모델 + 연결 원문(암호문)」의 SHA-256 앞 8바이트를 53비트로 줄인 양수다 — desired 의 `login.version` 과 같은 함수로 계산하므로 둘이 같고, 모델만 바꾸거나 같은 연결의 `vision` 을 고쳐도 바뀐다(생각의 깊이 등 Pod 에 넘기지 않는 설정은 그대로). 같은 경로·같은 Secret 키라 runner 는 달리 할 일이 없다(해석하지 않는다). Pod 가 이것으로 `opencode.json` 을 만드는 규칙은 계약 문서 「OpenCode 연결 정보」.
- 404 인 경우: 이 위치에서 켜져 있지 않은 AI(`RUNNER_AGENT_NOT_FOUND`), 활성 연결이 없음, 활성 연결의 종류가 템플릿 계정과 다름(둘 다 `RUNNER_SECRET_NOT_FOUND`). runner 는 `RUNNER_SECRET_NOT_FOUND` 를 「지운다」로 읽는다.
- `version` 의 뜻은 desired `login.version` 과 같다 — 활성 계정 id 이고(OpenAI 호환은 위 계산 값), 계정을 다시 등록하면 바뀐다. 이것은 `generation` 을 올리지 않는다. 로그인 파일이 Pod 시작 때 시딩되므로 runner 가 Pod 를 다시 만든다(계약 문서 「로그인 정보」).
- `claude` 와 같이 받아도 「최근 사용」(`last_used_at`)을 갱신하지 않는다. 받은 원문은 로그에 남기지 않는다.

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
  "metricsAvailable": true,
  "quota": { "capacity": 12 }
}
```

- `phase`: `STARTING` · `RUNNING` · `STOPPING` · `STOPPED` · `FAILED` 중 하나(그 밖은 400). `observedGeneration` 은 그 Pod 가 반영한 generation 이다. 단 클러스터가 Pod·PVC·ConfigMap 만들기를 거절해(쿼터 등) Pod 가 없는 `FAILED` 는 desired generation 을 싣는다 — Works 가 「이 요청의 실패」로 받는다. Secret 거절은 키가 전달되지 않았으므로 싣지 않는다(`null`). `message` 500자, 한 번에 200명까지.
- `failedGeneration`(선택, WP-2019): runner 실패 기록이 있을 때 그 실패가 난 desired generation, 없으면 `null`(생략도 같다 — 옛 runner). 옛 Pod 가 남아 있어 `observedGeneration` 이 뒤처져도 새 설정 실패를 알리는 칸이다. `phase=FAILED` 이고 `failedGeneration` ≥ 현재 desired generation 이면 Works 가 「오류」로 보인다(관찰 generation 이 `null` 이어도). 서버는 보고 값을 그대로 덮어쓴다 — `null` 이면 저장 칸도 지워진다. 0 이상 정수만 받는다(음수는 400). runner 는 미뤄 둔 generation(떠 있는 Pod 의 generation ≠ desired 이고 `applyNow=false` — 끝나 버렸거나 지워지는 중인 Pod 는 일하는 AI 가 없고 다음 Pod 가 desired generation 으로 뜨므로 제외)의 실패에는 실패 종류(이미지 검사·이름 충돌·Secret·클러스터 거절)와 무관하게 싣지 않는다(`null`) — 쉴 때로 미룬 실패가 이미 FAILED 로 보이고, 실으면 「켜기」가 일하는 Pod 를 끊기 때문이다. Works 는 `failedGeneration` ≥ generation 이면 적용 안내(`pendingApply`)를 비운다.
- **이 위치의 AI 만** 반영한다(꺼진 AI 의 `STOPPING`·`STOPPED` 도 받는다 — 지운 뒤 `STOPPED` 를 보내야 관리자 화면이 「끄는 중」에서 「꺼짐」으로 바뀐다). 없는 AI·다른 위치의 AI 는 `ignored` 로 돌려준다. AI 를 다른 위치로 옮긴 뒤 옛 위치가 보낸 보고는 `ignored` 다 — 예외는 꺼진 AI(desired `STOP`)의 `STOPPING`·`STOPPED` 보고 하나로, 어느 위치에서 와도 받는다(WP-1751). 그래서 꺼진 AI 를 옮긴 뒤에도 옛 위치 runner 가 Pod 를 지우고 `STOPPED` 를 보내면 「꺼짐」이 된다.
- 응답: `{"updated": 1, "ignored": []}`. 보고는 generation 도, 원하는 상태도 바꾸지 않는다.
- `observedGeneration` 은 줄지 않는다 — 늦게 도착한 옛 Pod 보고(더 작은 값)는 그 칸을 되돌리지 않고, 값이 없는 보고는 그대로 둔다.
- 새 Pod 가 보이면(`phase=STARTING`, `startedAt` 이 바뀜, `observedGeneration` 이 오름) 옛 Pod 가 보고한 AI 상태(쉬는 중 등)를 지운다. 단 그 AI 보고가 새 Pod 의 `startedAt` 뒤에 왔으면 새 Pod 의 것이라 남긴다. `startedAt` 을 함께 보내야 이 판정이 정확하다.
- `metricsAvailable`(선택, WP-1280): 이 위치에서 CPU·메모리 사용량을 잴 수 있는지. 사용량 API(`metrics.k8s.io`)가 **없으면(404) `false`**, 조회가 되면 `true`, 일시 오류(그 밖의 실패)면 **보내지 않는다** — 서버는 값이 올 때만 위치에 적고, 없으면 마지막 값을 둔다. 관리자 화면은 `false` 인 위치의 AI CPU·메모리 칸에 「알 수 없음」과 이유(metrics-server 없음)를 보인다. 실행 위치 응답(`GET /api/v1/admin/agent-locations`)에 같은 이름으로 실린다(`null` = 아직 모름).
- `quota`(선택, WP-1819): `{ "capacity": number | null }` — 이 위치 네임스페이스 쿼터로 띄울 수 있는 최대 AI 수(자원 키마다 떠 있는 AI 수 + floor(max(0, hard − used) ÷ AI Pod 1개 요청량)의 최솟값 — 컨트롤러가 센 used 를 그대로 쓰고, 지금 떠 있는 AI 를 포함한 총량이다. `pods` hard 는 Pod 1개당 1, 별칭 키가 여럿이면 가장 빡빡한 값, used 를 못 읽는 키는 hard 전체로 센다). 요청량은 띄울 수 있는 AI(허용 밖 이미지·모델 연결 종류 때문에 막힌 AI 는 뺌) 중 가장 큰 값이다. runner 는 `QUOTA_NAME` 이 없으면(차트가 쿼터를 끔) `capacity: null` 을 보내 묵은 경고를 지우고, 첫 묶음(batch)에만 싣는다. **생략하면 저장된 값을 그대로 둔다**(runner 가 쿼터를 읽지 못함 — 403·5xx·네트워크 오류, 또는 desired AI 가 없음), `capacity: null` 이면 쿼터 없음으로 지운다. 음수는 400. 실행 위치 응답에 `quotaCapacity` 로 실리며, 관리자 화면이 최대 AI 수가 이보다 크면 경고한다.
- **변화가 없어도 60초마다 보낸다.** CPU·메모리 갱신과 함께, 관리자 화면의 위치 연결 상태가 이 호출로 정해진다(마지막 호출이 2분 안이면 「연결됨」). desired 조회만 5분마다 하면 그 사이 「끊김」으로 보인다.

### 변경 스트림 — `GET /api/v1/agent-runtime/runner/events`

- `text/event-stream`. 붙으면 첫 코멘트 `:connected`, 이후 30초마다 `:ping` 코멘트가 온다.
- 이 위치의 원하는 상태가 바뀌면(켜기·끄기·설정 변경·위치 이동·기본 위치 이동·AI 삭제·AI 키 교체, AI 가 쉬는 중이라 교체할 때가 됨 — AI 상태 보고(WP-1250) 이후, 칸 보고(`BLOCKED`·`OK`)·AI 상태 보고·관찰 보고(예: `FAILED`)로 미뤄 둔 교체의 `applyNow` 가 참이 됨 — WP-1969·WP-2000) 커밋 뒤에 이벤트가 온다.

  ```
  event:agent-runtime.changed
  data:{"locationId":3}
  ```

  받으면 desired 를 다시 조회한다. 이벤트에는 내용이 없다 — 늘 desired 가 기준이다.
- 연결은 30분이면 서버가 닫는다. 바로 다시 붙는다(토큰을 다시 검증받는다). 위치당 연결은 3개까지이고, 넘으면 가장 오래된 연결이 닫힌다.
- **이벤트는 빨리 알기 위한 최선 노력이다.** 스트림은 API 인스턴스 메모리에 있어 API 를 여러 대 띄우면 다른 인스턴스에서 난 변경은 오지 않을 수 있고, 끊긴 동안의 변경도 다시 보내지 않는다. **정합성은 `pollIntervalSeconds`(300초)마다의 desired 조회가 맞춘다** — 스트림이 붙어 있어도 주기 조회를 멈추지 않는다.
- 클러스터 쪽 변화(AI Pod 를 kubectl 로 지움·노드 재시작으로 Pod 가 Completed/Error 로 끝남)는 Works 가 알 수 없어 이벤트가 없다. runner 는 이것을 주기 조회와 따로 `CLUSTER_CHECK_SECONDS`(기본 30초)마다 클러스터 목록만 보고 알아채, 어긋났으면 desired 를 새로 받는 조정을 깨운다(WP-1501). 이 다시 보기는 Works 를 부르지 않는다.

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
{ "state": "IDLE", "issueKey": null, "nextCheckAt": "2026-11-01T12:00:00+09:00", "generation": 7, "slot": "WP", "podStartedAt": "2026-11-01T11:40:00Z" }
```

- `state`: `IDLE`(쉬는 중) · `WORKING`(이슈 처리 중) · `BLOCKED` 중 하나(필수, 그 밖은 400). `issueKey` 32자. `generation` 은 Pod 의 `GENIA_AGENT_GENERATION`.
- `podStartedAt`(WP-1913): 보고한 **Pod(컨테이너)가 뜬 시각**(ISO-8601 UTC — 플러그인은 `now - /proc/uptime + /proc/1/stat 의 starttime/Hz` 로 계산한다. `/proc/1` **mtime 은 쓰지 않는다** — dentry 가 지워졌다 다시 조회되면 컨테이너 시작보다 늦게 갱신돼 옛 Pod 보고를 걸러 내지 못한다). 서버가 끝나는 중인 옛 Pod 의 늦은 보고를 지금 Pod 의 보고와 갈라 쓴다(아래 「칸 차단 백스톱」 ②). 서버가 보고를 **받은** 시각으로는 이 판정을 못 한다 — 옛 Pod 의 늦은 보고도 새 Pod 가 뜬 뒤에 도착해 받은 시각이 늘 지금이기 때문이다. 없으면(옛 플러그인·시각을 못 읽은 이미지) 견주지 않고 그대로 믿는다.
  - (WP-1958) **같은 generation 으로 재시작해도** 끝나는 중인 옛 Pod 의 늦은 보고가 새 Pod 의 상태를 덮지 않게, 서버가 지금 Pod 시작(관찰한 `started_at` 과 칸·차단 보고가 올려 둔 Pod 시작 중 늦은 쪽 = `max(started_at, reported_pod_started_at)`)보다 **30초 넘게 앞선** 보고를 **통째로** 버린다 — 칸 쓰기·합치기·칸 차단 백스톱 모두 하지 않고 INFO 로그만 남기며, 응답은 저장된 행 기준의 원하는 상태다.
  - 받은 보고의 값은 지금 Pod 시작을 끌어올리고(`reported_pod_started_at`), runner 가 관찰 보고로 null 이 아니면서 저장된 보고 값보다 **30초 넘게** 늦은 `started_at` 을 알리면 그 값은 비워진다(30초 안의 차이, 같거나 더 이른 `started_at` — null 보고 뒤 옛 Pod 의 `startTime` 을 다시 관찰한 경우 — 은 비우지 않는다). 시각만으로는 Pod 를 가를 수 없어 시작 시각이 바뀐 것만으로는 비우지 않는다. 그래서 남는 한계(WP-1968): 두 노드의 시계 차가 두 Pod 시작 사이 시간보다 30초 넘게 크면(시계 빠른 노드의 옛 Pod 뒤에 느린 노드로 재시작) 새 Pod 보고가 옛 것으로 버려지며, generation 이 올라도 같다. 노드 시계가 30초 넘게 뒤로 맞춰지면 같은 Pod 의 보고도 버려진다. 서버 시각보다 30초 넘게 앞선 값은 시계 이상이라 버린다(없는 값처럼 — 칸에 싣지도, 기준을 올리지도 않는다). 플러그인 `gw-status` 도 계산 결과가 지금보다 뒤(미래)면 `podStartedAt` 을 싣지 않는다.
- `slot`(WP-1409): 보고한 **칸** — 한 Pod 안의 work-loop 하나, 값은 그 칸의 프로젝트 키(플러그인은 칸 env `GENIA_WORKS_PROJECT` 를 싣는다). 형식 `^[A-Za-z0-9_-]{0,32}$`(아니면 400), 서버는 대문자로 바꿔 저장한다(`wp` 와 `WP` 는 같은 칸). 없거나 빈 값이면 `''` 칸 — 옛 플러그인·외부 구성은 지금처럼 한 칸으로 동작한다.
- **여러 칸의 보고를 합친다**(WP-1409). 서버는 칸마다 마지막 보고를 남기고, 모든 칸을 아래 규칙으로 합친 값을 AI 상태로 쓴다 — 한 칸이 일하는 중에 다른 칸이 쉬는 중을 보고해도 AI 는 작업 중이다.
  - `WORKING` 칸이 하나라도 있으면 `WORKING` · 아니면 `BLOCKED` 칸이 하나라도 있으면 `BLOCKED` · 모두 `IDLE` 이면 `IDLE`.
  - 현재 이슈 = `WORKING`·`BLOCKED` 칸의 이슈 키(칸 키 순, 중복 제외).
  - 다음 확인 = `IDLE` 칸 중 가장 이른 `nextCheckAt`(일하는 칸이 보낸 값은 쓰지 않는다).
  - 지금 Pod 가 뜨기 전의 칸 보고(옛 Pod 의 칸. 30초는 API 서버와 runner·kubelet 시계 차이 여유)는 합치기에서 빼고 지운다(방금 보고한 칸은 남긴다). 칸이 보고한 Pod 시작(`pod_started_at`)을 가졌으면 그 값이 지금 Pod 시작(`max(started_at, reported_pod_started_at)`) − 30초보다 앞선 칸이고(WP-1958), 값이 없는 칸(옛 플러그인)은 예전처럼 `reported_at` 이 관찰한 `started_at` − 30초보다 앞선 칸이다(관찰값이 없으면 가르지 않는다). runner 가 관찰 보고로 새 Pod 의 `startedAt` 을 알릴 때도 같은 규칙으로 옛 칸을 지우고 남은 칸으로 다시 합친다 — Pod 를 다시 만들면 옛 칸이 합친 상태를 붙잡지 않는다.
  - 마지막 보고가 6시간(`workplace.agent-runtime.slot-stale-after`)보다 오래된 칸은 죽은 칸으로 보고 합치기에서 뺀다(행은 남는다 — 다시 보고하면 이어진다). 살아 있는 칸은 매 턴 끝마다 보고하므로, 죽은 칸의 마지막 `WORKING` 이 미뤄 둔 교체를 영영 막지 않게 하는 상한이다.
  - **칸 차단 백스톱**: 남아 있던 진입점 차단(아래 「칸 차단 보고」)은 정상 칸 보고가 오는 순간 비우지만, 아래 두 조건을 **모두** 만족할 때만 비운다 — ① 보고 `generation` 이 차단 `generation` 이상일 때(차단 `generation` 이 null 인 **옛 이미지의 차단**은 지금 원하는 `generation` 이 아니라 **지금 돌고 있는 Pod 의 `observedGeneration`** 과 견준다 — 원하는 값과 견주면 교체가 미뤄진 동안 지금 Pod 가 `gen-1` 로 보고해 칸이 영영 비워지지 않고 건강한 AI 가 FAILED 로 남는다; `observedGeneration` 도 없으면 견주지 않는다; `generation` 을 싣지 않은 보고는 견주지 않고 그대로 믿는다), ② 보고에 실은 `podStartedAt` 이 차단을 보고한 Pod 의 시작(`pane_blocked_pod_started_at`, WP-1958 — 있으면 이쪽) 또는 지금 Pod 의 `started_at`(없으면) 의 `− 30초` 이후일 때(그보다 앞선 보고는 끝나는 중인 옛 Pod 의 것이라 새 Pod 진입점이 다시 보고하기 전에 「오류」를 지우면 안 된다; `podStartedAt` 이 없으면 견주지 않고 그대로 믿는다; `pane_blocked_pod_started_at` 이 없는 차단은 지금 Pod 를 아직 관찰하지 않아 `started_at` 이 없으면 견주지 않는다; `pane_blocked_pod_started_at` 이 있으면 `started_at` 이 null 이어도 그 값과 견준다). **화면에 보이던 것(`currentPaneBlocked`)을 비울 때만** 관리자 화면 알림을 보낸다(가려진 옛 사유를 비우는 동작은 화면이 그대로라 알림 없음).
- 응답 `{"desired": "RUN" | "DRAIN" | "RESTART"}`:
  - AI 가 꺼졌으면(desired=STOP) `DRAIN` — 지워지는 Pod 가 새 이슈를 집지 않게 하는 **안전장치일 뿐**이다. 끄기는 위 「끄기는 즉시 정지」대로 runner 가 바로 Pod 를 지운다.
  - 보낸 `generation` 이 지금 설정보다 작으면, desired 의 `applyNow` 와 같은 판정(위 「언제 Pod 를 다시 만드나」 — 이번 보고까지 반영해서)이 참이면 `RESTART`(곧 다시 띄워진다 — 바로 적용, 합친 상태가 쉬는 중(**모든 칸이 쉼**), 지금 Pod 의 옛 키가 24시간 안에 만료 등), 아니면 `DRAIN`(새 이슈를 집지 않고 쉰다 — 쉬면 runner 가 다시 띄운다).
  - 그 밖은 `RUN`.
- 합친 값은 관리자 화면의 AI 상태(`observed.agentState`·`agentIssueKey`(목록의 첫 키 — 옛 화면 호환)·`agentIssueKeys`(현재 이슈 모두, 보고 없으면 `[]`)·`agentNextCheckAt`)로 보인다. 관리자 AI 목록 요약(`/api/v1/admin/agent-runtime-summaries`)도 `agentIssueKeys` 를 싣는다. generation·원하는 상태는 바꾸지 않는다.
- 합친 상태가 **쉬는 중으로 바뀐** 보고(모든 칸이 쉬게 된 보고 — 앞의 합친 상태가 `IDLE` 이 아니었음 — 새 Pod 가 보여 AI 상태가 지워진 뒤 첫 보고 포함)인데 아직 반영하지 않은 generation 이 있으면(generation ≠ 마지막 observedGeneration) Works 가 그 AI 의 실제 위치로 `agent-runtime.changed` 를 낸다 — runner 가 다시 조회하면 `applyNow=true` 다. 한 칸이 아직 일하면 다른 칸의 `IDLE` 보고는 `DRAIN` 을 받고 이벤트도 없다 — 마지막 일하던 칸이 `IDLE` 을 보고하는 순간 그 칸이 `RESTART` 를 받고 이벤트가 한 번 나간다. 이미 쉬는 중이던 AI 가 다음 확인마다 `IDLE` 을 거듭 보고해도 이벤트를 다시 내지 않는다(놓친 이벤트는 주기 조회가 맞춘다).
- 실행 설정이 없는 AI(외부에서 돌리는 AI)나 워크스페이스가 정해지지 않은 호출은 아무것도 저장하지 않고 `RUN` 이다. AI 키(`ak_`)가 아닌 인증(사람 로그인·개인 토큰 등)으로 부르면 403(`AGENT_ONLY`).

## 칸 차단 보고 — `PUT /api/v1/agent-runtime/me/pane` (Pod 안 진입점이 부름)

작업 공간 진입점이 칸을 띄우지 못하면(설정 오류·로그인 오류 등) **못 띄운 사실과 이유**를 자기 AI 키(`Authorization: Bearer ak_…`)로 알려 서버에 남긴다(WP-1913) — 관리자 화면의 AI 목록이 「오류」와 이유를 보여 주기 위해서다. 위 「AI 상태 보고」와 달리 보고하는 쪽이 Pod 안 **진입점(스크립트)** 이다. 여러 워크스페이스에 속한 AI 는 `X-On-Behalf-Of-Tenant: <GENIA_WORKS_TENANT>` 를 함께 보낸다. 서버는 템플릿을 보지 않고 보고로만 판정한다 — 지금 `BLOCKED` 를 보내는 진입점은 감독을 `run_supervisor tick` 으로 도는 codex·genia-code·opencode 뿐이고, claude-code 는 `run_supervisor boot` 라 보내지 않는다(WP-1969).

```json
{ "state": "BLOCKED", "message": "설정 오류: …", "generation": 7, "podStartedAt": "2026-11-01T11:40:00Z" }
```

```json
{ "state": "OK", "generation": 7, "podStartedAt": "2026-11-01T11:40:00Z" }
```

- `state`: `BLOCKED`(칸을 못 띄움) 또는 `OK`(다시 띄웠다 — 앞서 남긴 차단 보고를 지운다). 그 밖의 값은 400.
- `message`: 차단 이유, 500자 이하(501자를 넘으면 400). `BLOCKED` 일 때만 필요(없으면 400), `OK` 에는 쓰지 않는다. 길이·제어 문자 정제는 UTF-16 코드 유닛 기준이다(자바 `String.length()`) — 늘리는 쪽은 없다고 믿고 호출 쪽이 같은 단위로 자른다.
- `generation`: 그 Pod 의 `GENIA_AGENT_GENERATION`(숫자). **지금 실행 설정의 `generation` 과 다르면 그 보고는 무시한다**(저장도 지우지도 않음. 예외는 아래뿐) — 끝나는 중인 옛 Pod 의 늦은 차단이 새 generation 을 덮거나, 옛 Pod 의 `OK` 가 지금 차단을 지우지 않게(WP-1913 리뷰 반려 ①). 없으면(null) 그대로 믿는다 — 플러그인을 아직 갈아끼우지 않은 이미지가 계속 보고할 수 있게. 예외로 AI 가 켜져 있고(`desired` RUN) 적용이 쉴 때 적용(IDLE)으로 미뤄진 동안 지금 도는 Pod 의 `observedGeneration` 과 같은 보고는 아래대로 받는다(WP-1969). 꺼졌거나 다시 시작이 걸린 AI 의 같은 보고는 무시한다.
  - `BLOCKED`: 저장된 차단의 `generation` 이 없거나 더 새롭지 않을 때 저장한다. 받은 `BLOCKED` 로 위 `applyNow` 가 거짓에서 참이 되는 순간(켜져 있는 AI 에 한함) 그 AI 의 실제 위치로 `agent-runtime.changed` 를 한 번 낸다(같은 보고가 거듭돼도 다시 내지 않고, 같은 컨테이너의 칸이 아직 일하면 내지 않는다).
  - `OK`: 저장된 차단이 그 Pod 의 것(위 「지금 Pod 의 차단」)일 때만 받아 지운다 — 회복한 Pod 를 다시 띄우지 않게.
- `podStartedAt`(WP-1958): 보고한 Pod 가 뜬 시각(ISO-8601 UTC — 위 「AI 상태 보고」의 `podStartedAt` 과 같은 값·계산). **같은 generation 으로 재시작해도** 끝나는 중인 옛 Pod 의 늦은 `BLOCKED`·`OK` 가 새 Pod 의 차단을 덮거나 지우지 않게, 서버가 지금 Pod 시작(관찰한 `started_at` 과 칸·차단 보고가 올려 둔 Pod 시작 중 늦은 쪽)보다 **30초 넘게 앞선** 보고를 저장 없이 무시한다(204, INFO 로그). 받은 보고의 값은 지금 Pod 시작을 끌어올리고, `BLOCKED` 는 `pane_blocked_pod_started_at` 으로 저장해 읽을 때 지금 Pod 보다 30초 넘게 앞선 차단을 가린다. 서버 시각보다 30초 넘게 앞선 값은 시계 이상이라 버린다(없는 값처럼). 없으면(옛 플러그인·시각을 못 읽은 이미지) 견주지 않고 지금처럼 믿는다 — 다만 `applyNow` 판정은 다르다(위 「언제 Pod 를 다시 만드나」).
- **`BLOCKED` 는 칸을 다시 합친다**(WP-1969): 받아들인 `BLOCKED`(옛 Pod 로 버려지지 않은 것)는 차단을 기록한 뒤 칸 테이블의 모든 칸을 위 「AI 상태 보고」와 같은 규칙으로 다시 합쳐 `agent_*` 칸에 쓴다 — 컨테이너만 재시작해 새 컨테이너가 시작에 실패하면 `BLOCKED` 만 오는데, 보고가 올려 둔 새 Pod 시작보다 30초 넘게 앞선 앞 컨테이너의 `WORKING` 칸이 이때 빠져 AI 가 영영 작업 중으로 남지 않는다. 직전과 같은 메시지의 거듭된 `BLOCKED` 도 합친다(옛 칸이 아직 남았을 수 있다) — 알림은 보이는 값이 바뀔 때만(차단 또는 합친 AI 상태) 한 번 나간다. runner 가 새 Pod 의 `startedAt` 을 아직 관찰하지 못했고(값 없음) 합친 AI 상태도 이미 비어 있으면 합치지 않는다 — 시각 없는 옛 칸을 가를 기준이 없어, 합치면 이미 지운 상태가 되살아나기 때문이다. AI 상태가 남아 있으면 합친다. `OK` 도 합치지 않는다.
- 응답은 늘 `204`(본문 없음) — **보고는 최선 노력이라 실패해도 진입점은 계속된다**(gw-models 와 같다). 워크스페이스가 정해지지 않았거나 실행 설정이 없는 AI 는 저장 없이 204.
- 본문 검증 실패는 400, AI 키(`ak_`)가 아닌 인증(사람 로그인·개인 토큰 등)으로 부르면 403(`AGENT_ONLY`).
- 저장 위치: 실행 설정 행의 `pane_blocked_message`(500자)·`pane_blocked_at`·`pane_blocked_generation`·`pane_blocked_pod_started_at` 칸. runner 가 쓰는 관찰 보고 칸과 **분리해 두고 읽을 때만 합친다** — 진입점 보고와 runner 관찰 보고가 서로의 값을 덮어쓰지 않는다. 읽는 쪽은 저장한 사유가 지금 `generation` 과 같고 지금 Pod 가 뜬 뒤(`pane_blocked_at` ≥ `started_at − 30초` — API 서버와 runner·kubelet 시계 차이 여유, 위 칸 거르기와 같은 30초. 진입점 차단은 시작 몇 초 안에 오므로 시계가 몇 초만 어긋나도 지금 Pod 의 차단이 가려진다)에 남은 것만 합친다 — 설정을 고쳐 새 generation 이 뜨거나 재시작해 새 Pod 가 뜨면 옛 사유가 「오류」로 남지 않는다.

## 로그인 계정 모델 목록 보고 — `PUT /api/v1/agent-runtime/me/models` (Pod 안의 AI 가 부름)

로그인 정보(`genia`·`chatgpt`)로 연결된 AI 가 **자기 프로그램이 쓸 수 있는 모델 목록**을 알린다(WP-1297). 서버가 저장된 ChatGPT 로그인으로 모델을 조회하면 1회용 refresh token 을 써서 Pod 안 프로그램의 로그인이 풀리므로, 목록은 Pod 안에서 뽑아(Codex 는 `codex debug models`) 자기 AI 키(`Authorization: Bearer ak_…`)로 보고한다. 플러그인 스크립트 `gw-models < models.json` 이 이 호출을 하고(표준 입력은 `{"models":[…]}` 그대로 — 스크립트가 `jq` 로 `loginVersion` 을 덧붙인다), `GENIA_AGENT_GENERATION` 이 없으면(Works 가 띄운 AI 가 아니면)·`GENIA_LOGIN_VERSION` 이 없으면(로그인 없음) 부르지 않는다. 여러 워크스페이스에 속한 AI 는 `X-On-Behalf-Of-Tenant: <GENIA_WORKS_TENANT>` 를 함께 보낸다(플러그인이 env 가 있으면 붙인다).

```json
{ "loginVersion": 42, "models": [{ "id": "gpt-6-luna", "label": "GPT-6-Luna", "efforts": ["low", "medium", "high"] }] }
```

- `loginVersion`: 필수(숫자, 없으면 400). Pod 가 받은 로그인 정보의 `version`(= AI 계정 연결 행 id, env `GENIA_LOGIN_VERSION`) — desired 의 `login.version`·`RunnerLoginSecretResponse.version` 과 같은 값이다. **지금 활성 연결 행 id 와 같을 때만 저장한다.** 관리자가 로그인을 바꾼 직후 옛 로그인으로 떠 있던 Pod 가 보고해도 옛 계정의 목록이 새 연결의 목록으로 저장되지 않는다.
- `models`: 필수, 최대 100개, 화면에 보일 순서대로. `id` 는 필수이고 템플릿 「모델」 칸에 저장할 수 있는 꼴과 같다(영문·숫자와 `. _ : / @ [ ] -`, 1~128자 — 어기면 400). `label` 은 200자 이하(없으면 id 로 보인다). `efforts` 는 이 모델이 받는 생각의 깊이 단계로 소문자 영문(`[a-z]{1,16}`) 최대 10개, 낮은 순(없으면 알 수 없음). 같은 `id` 가 거듭 오면 앞의 것만 남긴다.
- 응답은 늘 `204`(본문 없음) — 보고는 최선 노력이라 Pod 가 연결 교체 중의 어긋남으로 실패 신호를 받지 않게 한다.
  - **저장하는 때**: 이 AI 의 활성 연결이 로그인 계정(`genia`·`chatgpt`)이고 `loginVersion` 이 그 연결 행 id 와 같을 때만. AI(워크스페이스)당 보고 하나를 덮어쓰며, 그때의 활성 연결 행 id 를 함께 적는다(`agent_reported_model`).
  - **저장 없이 204 로 무시하는 때**: 활성 연결이 없거나 로그인 계정이 아닐 때(Claude 구독·OpenAI 호환), `loginVersion` 이 활성 연결 행 id 와 다를 때(옛 로그인의 Pod), 워크스페이스가 정해지지 않은 호출. 관리자가 연결을 바꾸는 사이에 옛 Pod 가 보고해도 오류가 되지 않는다.
- 조회: 관리자 화면의 「모델」 칸이 쓰는 `GET /api/v1/admin/agents/{userId}/models` 가 로그인 계정이면 저장된 보고를 `{provider, models:[{id,label,efforts}]}` 로 돌려준다(`efforts` 는 다른 계정과 같게 대문자 `LOW`…). **보고 당시의 연결 행이 지금의 활성 행과 같을 때만** 쓰고, 보고가 없거나 연결을 다른 계정으로 바꿨으면(새 행) 빈 목록이다 — Pod 가 다시 부팅·보고하면 채워진다. 화면은 빈 목록을 「AI 를 한 번 켜면 그 계정의 모델 목록이 보여요」로 안내한다.
- 본문 검증 실패는 400, AI 키(`ak_`)가 아닌 인증(사람 로그인·개인 토큰 등)으로 부르면 403(`AGENT_ONLY`).

## 로그인 받기·올리기 — `GET`·`PUT /api/v1/agent-runtime/me/login` (Pod 안의 AI 가 부름)

ChatGPT 로그인(`chatgpt`)의 갱신 토큰은 1회용이라, 한 계정을 쓰는 Pod 들이 각자 갱신하면 로그인이 풀린다. 그래서 묶인 계정은 **서버가 만료 전에 갱신**하고(`server_refresh_ready` 인 계정만 — 사람이 넣었거나 교체한 계정, Pod 가 더 새 로그인을 올린 계정), Pod 는 자기 AI 키(`Authorization: Bearer ak_…`)로 이 API 를 5분마다 불러 갱신된 `auth.json` 을 받아 간다(WP-1450). 서버가 갱신하면 `loginRevision` 만 올라 runner 는 Pod 를 다시 만들지 않고 Secret 의 `login-info` 만 새로 받는다 — 하지만 `login-info` 는 subPath 로 마운트돼 Secret 이 바뀌어도 떠 있는 Pod 안 파일은 그대로라 Pod 가 이 API 로 직접 받는다(Secret 갱신은 다음에 다시 만들어지는 Pod 를 위한 것). 영구 갱신 실패(갱신 토큰 무효)면 계정은 `RELOGIN_REQUIRED` 가 되고 `server_refresh_ready` 도 내려가 사람이 원문을 교체하거나 Pod 가 더 새 로그인을 올릴 때까지 서버는 갱신을 시도하지 않는다. 만료 전 토큰은 마지막 갱신 뒤 `min-interval`(기본 12시간)이 지나야 다시 갱신한다. 여러 워크스페이스에 속한 AI 는 `X-On-Behalf-Of-Tenant: <GENIA_WORKS_TENANT>` 를 함께 보낸다.

### 받기 — `GET /api/v1/agent-runtime/me/login[?revision=<번호>]`

```json
{ "version": 42, "revision": 7, "provider": "chatgpt", "payload": "{\"auth_mode\":\"chatgpt\", …}" }
```

- `version`: 지금 desired 의 `login.version`(`loginVersion`, = Pod 의 `GENIA_LOGIN_VERSION`)과 같은 값. Pod 의 값과 다르면 로그인 선택이 바뀐 직후라 runner 가 곧 Pod 를 교체한다 — Pod 는 덮어쓰지 않는다.
- `revision`: 로그인 **내용**이 바뀔 때마다(서버 갱신·Pod 올리기) 오르는 번호. 원문 교체(`version` 변경)와는 별개 축이다. `payload` 는 `auth.json` 원문이다.
- `revision` 쿼리가 서버의 현재 번호와 같으면 원문을 풀지 않고 본문 없이 `204`(바뀐 것 없음).
- 상태: `200`(본문) · `204`(바뀐 것 없음) · `404`(묶인 genia·chatgpt 계정이 없거나 이 AI 의 템플릿과 맞지 않음 — 저장본을 읽을 수 없을 때도) · `403`(`AGENT_ONLY`, AI 키가 아닌 인증).
- 원문이 나가는 응답이라 `Cache-Control: no-store`(204 포함)다. 응답 본문·`payload` 는 로그에 남기지 않는다.

### 올리기 — `PUT /api/v1/agent-runtime/me/login`

```json
{ "version": 42, "payload": "{\"auth_mode\":\"chatgpt\", …}" }
```

Pod 의 codex 가 스스로 갱신해 서버 보관본보다 새로워진 `auth.json` 을 서버에 올린다. `version` 은 Pod 의 `GENIA_LOGIN_VERSION`, `payload` 는 원문(최대 200,000자).

- `204`: 저장했다. 로그인 내용만 바뀌므로 `secret_version`(= desired 의 `loginVersion`)은 그대로이고 Pod 는 갈리지 않으며 `revision` 만 오른다. 이관 직후(`NEEDS_CHECK`)·`RELOGIN_REQUIRED` 계정은 `ACTIVE` 로 돌아오고 서버가 그 계정의 갱신을 맡기 시작한다. 감사 기록에 계정·변경 번호만 남는다(원문 없음).
- `409` `AGENT_LOGIN_REJECTED`: 받지 않았다(저장본 불변). `errors.reason` 은 다음 중 하나다. 올린 값은 어떤 문구에도 싣지 않는다.
  - `VERSION_MISMATCH` — `version` 이 지금 login 버전과 다르다(선택이 바뀐 직후의 낡은 Pod), 또는 그 사이 사람이 원문을 교체했다.
  - `NOT_CHATGPT` — 묶인 계정이 ChatGPT 가 아니다(genia 는 올리기를 받지 않는다).
  - `ACCOUNT_MISMATCH` — `tokens.account_id` 가 저장본과 다르거나 어느 쪽에 없다(다른 계정으로 로그인한 경우).
  - `NOT_NEWER` — `last_refresh` 가 저장본보다 엄격히 새롭지 않다(1회용 갱신 토큰이라 옛 로그인으로 덮지 않는다).
  - `INVALID` — `payload` 가 올바른 ChatGPT 로그인 정보가 아니다.
- `404`: 묶인 계정이 없거나 템플릿과 맞지 않거나 저장본을 읽을 수 없다. `403`(`AGENT_ONLY`): AI 키가 아닌 인증.
- Pod 쪽 규칙(코드 `lib-codex.sh` 의 `sync_login`): 로컬 `last_refresh` 가 서버에서 받았거나 마지막으로 올린 값과 다르면 `revision` 없이 받아(`200`) 비교하고, 로컬이 엄격히 새로우면 올린다. `409` 를 받으면 같은 값을 다시 올리지 않고, 다음 회차에 서버 보관본(`version` 이 Pod 의 `GENIA_LOGIN_VERSION` 과 같을 때만)으로 `auth.json` 을 덮어 서버와 맞춘다.

## 맡는 프로젝트 — `GET /api/v1/agent-runtime/me/projects` (AI 가 부름)

AI 가 자기 키(`Authorization: Bearer ak_…`)로 부른다(WP-1275). Works 가 띄운 AI 만이 아니라 사람이 띄운 AI(start-agent)도 쓴다 — 플러그인 `gw-agent-projects --assigned` 가 이 호출을 하고 「키<탭>저장소 주소<탭>브랜치」 줄로 바꾼다. 작업 공간 엔트리포인트(부팅 때 칸 열기)·알림 감시(칸 없는 프로젝트 알림 — WP-1272)·work-loop 의 「새 프로젝트 확인」이 모두 이것을 부른다. 여러 워크스페이스에 속한 AI 는 `X-On-Behalf-Of-Tenant` 를 함께 보낸다.

```json
[{ "projectKey": "WP", "name": "Works", "repositoryUrl": "https://github.com/acme/works.git", "repositoryBranch": null, "repositoryHost": "github.com" }]
```

- 그 AI 가 **실제 멤버**(직접 멤버 또는 멤버로 둔 부서 — 관리자라 보이기만 하는 프로젝트·공개 열람은 치지 않는다)이고 **연결된 저장소**가 있으며 지워지지 않은 프로젝트만, 키 순으로. 키는 폴더·tmux 칸 이름이 되므로 `^[A-Za-z0-9_-]+$` 형식이 아니면 뺀다. 관리자 화면의 「맡는 프로젝트」와 같은 목록이다.
- `repositoryBranch` 가 null 이면 저장소의 기본 브랜치를 쓴다. `repositoryHost` 는 저장소 주소의 호스트(소문자)를 서버가 계산한 값이다(읽을 수 없으면 null) — 저장소 토큰을 맞출 때 호스트 기준이다. 맡는 프로젝트가 없으면 `[]`.
- 워크스페이스가 정해지지 않은 호출(여러 워크스페이스에 속한 AI 가 헤더 없이 부름)은 400(`AGENT_WORKSPACE_REQUIRED`) — `[]` 이면 「맡은 프로젝트 없음」과 구분되지 않는다. AI 키(`ak_`)가 아닌 인증으로 부르면 403(`AGENT_ONLY`).

## 오류

본문은 다른 API 와 같은 모양(`status`·`message`·`errors`)이다.

| 상태 | 언제 |
|---|---|
| 400 | 관찰 보고 형식이 틀림(`phase` 값, 200명 초과, `agents` 없음 등) |
| 401 | 토큰 없음·모르는 토큰·재발급으로 회수된 토큰·정지된 워크스페이스, 또는 runner 토큰으로 다른 API 호출 |
| 403 | runner 토큰이 아닌 인증으로 runner API 호출 |
| 404 | 토큰의 위치가 없음(`errors.code=AGENT_LOCATION_NOT_FOUND`), 비밀값을 받으려는 AI 가 이 위치에서 켜져 있지 않음(`RUNNER_AGENT_NOT_FOUND`), 모델 연결·로그인 정보가 없음(`RUNNER_SECRET_NOT_FOUND`) |
