# 여러 대(multi-instance)로 늘릴 때 고려할 점

지금 운영은 converter(2대)를 빼고 앱마다 파드 1대입니다. 이 문서는 앱을 여러 대로 늘릴 때 **프로세스 메모리에 든 상태** 때문에 깨지거나 달라지는 것을 앱별로 모읍니다. 늘리기 전에 이 문서를 확인하고, 새로 메모리 상태를 넣으면 여기에 한 줄 더합니다.

## 지금 구성(2026-10-27 기준)

| 앱 | 대수 | 비고 |
|---|---|---|
| api · ai-agent · web · admin · worker · mcp | 1 | `deploy/helm/values.yaml` 의 `appReplicas` **한 값**을 함께 씁니다 |
| collab | 최대 1(`min appReplicas 1`), `Recreate` | 늘릴 수 없게 막아 두었습니다 |
| converter | 2 | `converter.replicas` 로 따로 정합니다 |
| db | 1(StatefulSet) | |

- `appReplicas` 를 2로 올리면 위 6개 앱이 **한꺼번에** 2대가 됩니다. 앱별로 늘리려면 먼저 앱별 값(예: `api.replicas`)으로 나눠야 합니다.
- 1대라서 배포(롤링 업데이트) 때 잠깐 끊김이 생길 수 있습니다. 2대 이상이면 이 문제는 줄어듭니다.

## 앱별로 깨지는 것

심각도: **막힘**(늘리면 기능이 틀리게 동작) · **바꿔야 함**(동작은 하나 결과가 달라짐) · **괜찮음**(알고만 있으면 됨)

### api

| 상태 | 위치 | 늘리면 | 심각도 | 대응 |
|---|---|---|---|---|
| 실시간 이벤트(SSE) 연결 | `global/realtime/SseRegistry` | 파드 사이 중계를 거쳐 사용자가 붙은 파드가 아니어도 채팅·알림·메시지 이벤트를 받습니다. 한계는 아래 「SSE 중계 계약」 | 괜찮음 | PostgreSQL `LISTEN/NOTIFY` 중계 구현 — `global/realtime/relay/` |
| runner 변경 스트림(SSE) | `agentruntime/realtime/RunnerSseRegistry`(WP-1249) | 위 SSE 중계로 runner 가 붙은 파드가 아니어도 원하는 상태 변경을 바로 받습니다 | 괜찮음 | 중계로 함께 태웁니다 — 계약상 최선 노력이라 runner 는 5분마다 desired 를 다시 조회해 맞춥니다([agent-runner-api.md](../integrations/agent-runner-api.md)) |
| AI 작업 화면 중계(WebSocket) | `agentruntime/screen/AgentScreenRelay`·`AgentScreenTickets`(WP-1277) | 관리자 브라우저 소켓과 runner 소켓을 파드 메모리에서 세션 id 로 짝짓습니다. 두 소켓(과 접속 표를 받은 POST)이 다른 파드로 가면 붙지 못해 화면이 열리지 않습니다. AI 당 열린 화면 3개·「다른 관리자가 이미 입력 중」 판정도 파드마다 따로 셉니다. 새 파드가 뜨면 닫히지 않은 옛 세션 행을 닫으므로, 겹치는 동안 다른 파드의 열린 화면 기록이 먼저 닫힌 것으로 남을 수 있습니다 | 막힘 | 세션 id 로 같은 파드에 보내는(sticky) 라우팅을 두거나, 파드 사이 프레임 중계(Redis Pub/Sub 등)와 공유 표 저장소를 둡니다 |
| AI 답변 생성 중 취소(■) | `global/realtime/DefaultStreamingGenerationRegistry` | 취소 요청이 생성 중인 파드와 다른 파드로 가면 멈추지 않습니다. 사용자당 동시 생성 상한도 파드마다 따로 셉니다 | 막힘 | 취소를 위 중계로 전파하거나, 생성 요청을 같은 파드로 보내는(sticky) 라우팅이 필요합니다 |
| 메일 OAuth state | `mail/service/OAuthStateStore` | 시작과 콜백이 다른 파드로 가면 「state 없음」으로 메일 계정 연결이 실패합니다 | 막힘 | state 를 DB 표나 Redis 로 옮깁니다(TTL 10분, 한 번 쓰면 삭제) |
| 메일 수동 동기화 진행률·동시 실행 가드 | `mail/service/MailSyncProgress` | 진행률 조회가 다른 파드로 가면 「대기」로 보입니다. 같은 계정 동기화가 두 파드에서 겹칠 수 있습니다 | 바꿔야 함 | 진행 상태를 DB 로 옮기거나 DB 행 잠금으로 가드합니다 |
| 메일함별 동기화 가드 | `mail/service/folder/MailFolderSyncGuard` | 파드 사이 겹침은 막지 못하지만 넣기가 멱등이라 결과는 같습니다(주석에 명시) | 괜찮음 | — |
| 공개 경로 속도 제한 | `global/security/ratelimit/TokenBucketLimiter` | 같은 IP 의 실제 한도가 `대수 × 한도` 가 됩니다 | 바꿔야 함 | [rate-limit.md](rate-limit.md) 「여러 대로 늘릴 때 고려할 점」 |
| 테넌트 상태 캐시 | `global/tenant/TenantStatusChecker` | 다른 파드에서 정지한 테넌트를 이 파드가 최대 5초 더 ACTIVE 로 봅니다(비활성은 캐시하지 않음) | 괜찮음 | 이미 여러 대를 고려해 설계됨 |
| AI 요약 등 재생성 가능한 캐시 | `messaging/service/CatchupSummaryCache` 등 | 파드마다 따로 만들어 적중률이 떨어지고 AI 호출이 늘어납니다 | 괜찮음 | 비용이 문제 되면 공유 캐시로 |
| 예약 작업(`@Scheduled`) | `*Scheduler`, `*Job` | ShedLock(`V148__shedlock.sql`)으로 한 파드만 실행합니다. 새 예약 작업에도 `@SchedulerLock` 을 꼭 붙입니다 | 괜찮음 | 파드 안 주기 작업(SSE heartbeat 등)은 잠금 없이 파드마다 도는 게 맞습니다 |
| 업로드 파일 | `/data/storage-data`(PVC `storage-data`) | RWX(NFS)라 여러 파드가 함께 마운트할 수 있습니다 | 괜찮음 | — |
| DB 커넥션 | Hikari 풀(파드마다) | 커넥션 수가 `대수 × 풀 크기` 가 됩니다 | 바꿔야 함 | PostgreSQL `max_connections` 안에 드는지 확인합니다(WP-752 풀 고갈 참고) |

#### SSE 중계 계약

파드 사이 SSE 중계(`global/realtime/relay/`, WP-1973)가 지키는 것과 지키지 않는 것 — 늘리기 전에 알고 있어야 할 계약입니다.

- **순서**: **한 파드 안**에서는 발행 순서대로 도착합니다(발행 커넥션 하나 + 단일 채널의 LISTEN 큐). **파드 사이는 보장하지 않습니다** — 다른 파드의 동시 발행은 커밋 순서가 엇갈릴 수 있습니다. 클라는 이벤트마다 최신 상태를 다시 그립니다.
- **누락**: 재연결 중·클라이언트 끊김 동안의 이벤트는 **재생하지 않습니다**(재생 버퍼 없음 — best-effort). 클라는 재연결 직후 화면을 재조회해 상태를 맞춥니다. 발행 커넥션 단절 시 `warn` 로그가 남습니다.
- **실측 지연**: 발행 → emitter 도착은 평균 **2ms**, 최대 **6ms** — `SseEventRelayTransportTest`·`SsePodRelayIntegrationTest` 기반 로컬 Testcontainers 실측(워밍업 10회)입니다. 다만 **파드 사이 순서는 보장하지 않으므로**(위 「순서」) 이 수치는 어디까지나 도착 시간 참고입니다. 리스너는 `getNotifications(50)` 주기로 소켓을 기다려(50ms 이하 계약) 도착 즉시 깨어납니다. 파드 간 도착을 재는 통합 테스트 소요는 케이스당 0.17~0.25s, 리스너 재연결 재등록은 지수 백오프(1s→30s 상한) 탓에 실측 약 1.8s가 걸렸습니다.
- **켜기/끄기**: `app.realtime.relay.enabled` — 기본 `true`(local·운영), 테스트 프로파일은 `false`(로컬 직행).
- **큰 이벤트**: 인코딩 결과가 **7000 바이트**를 넘으면 `sse_relay_event` 표에 행을 남기고 통지에는 `#id` 만 갑니다 — PostgreSQL NOTIFY 8000 바이트 상한 회피. 발행·수신은 단일 채널 `wp_sse_relay` 를 쓰고(채널을 나누면 순서가 깨짐), 남은 행은 `RelayOutboxCleaner` 가 **10분** 지난 것을 정리합니다(`@SchedulerLock`).
- **남는 한계**: 사용자 **연결 끊김 시각**(`SseRegistry.lastSeen`, WP-1201 「연결 끊김 · n분째」)은 여전히 파드마다 다릅니다 — 중계가 바꾸지 않는 한계, 후속 이슈 후보입니다.

### mcp

| 상태 | 위치 | 늘리면 | 심각도 | 대응 |
|---|---|---|---|---|
| 토큰 검증 성공 기억(60초) | `apps/workplace-mcp/src/mcp/auth-cache.ts`(WP-1013) | 파드마다 따로 기억합니다. 같은 토큰을 파드 수만큼 한 번씩 더 검증해 workplace-api `/auth/me` 호출이 늘어납니다. 폐기된 토큰이 통하는 최대 시간(60초)은 늘지 않습니다 | 괜찮음 | 호출량이 문제 되면 Redis 같은 공유 캐시로 옮깁니다. 공유 캐시를 쓸 때도 토큰 원문이 아닌 해시만 저장하고, 실패는 기억하지 않습니다 |
| 세션 | 없음(stateless, 요청마다 서버 구성) | 어느 파드로 가도 같습니다 | 괜찮음 | — |
| keep-alive | `src/index.ts` `listen`(65초) | 파드 수와 무관합니다. ingress-nginx `upstream-keepalive-timeout`(60초)보다 길게 유지합니다 | 괜찮음 | — |

### ai-agent

| 상태 | 위치 | 늘리면 | 심각도 | 대응 |
|---|---|---|---|---|
| opencode 콜백 브리지 | `src/agent/bridge-registry.ts` | 콜백 주소가 `localhost` 라 같은 파드 안에서만 오갑니다 | 괜찮음 | 콜백 주소를 서비스 주소로 바꾸면 깨지니 `localhost` 를 유지합니다 |
| opencode 웜 서버 풀 | `src/agent/opencode-server-pool.ts` | 파드마다 따로 데워 첫 요청이 느린 경우가 늘고, 메모리(서버당 약 380MB)가 파드마다 듭니다 | 괜찮음 | 파드 메모리 한도를 풀 크기에 맞춥니다 |
| 모델 메타 캐시 | `src/agent/opencode-vision.ts` | 파드마다 따로 조회합니다 | 괜찮음 | — |

### 그 밖

- **collab**: 노트 문서 상태를 메모리에 들고 있어 **늘릴 수 없습니다**. 늘리려면 Yjs 상태 공유(Redis 등)가 먼저입니다. [collab-k8s-handoff.md](collab-k8s-handoff.md)
- **worker**: api 가 HTTP 로 작업을 보내고 콜백으로 결과를 받습니다. 작업 상태는 api DB(`file_extraction`)에 있어 여러 대여도 됩니다. 파일은 RWX 볼륨에서 읽습니다.
- **converter**: 이미 2대입니다. 파드당 동시 1건이라 바쁘면 429 를 돌려주고 호출자가 재시도합니다.
- **web · admin**: 정적 파일만 내보내 상태가 없습니다.

## 늘리는 순서(권장)

1. `appReplicas` 를 앱별 값으로 나눕니다.
2. 상태가 없거나 「괜찮음」뿐인 앱부터 늘립니다: web · admin · mcp · worker · ai-agent.
3. api 는 「막힘」 세 가지(AI 화면 중계, 생성 취소, OAuth state)를 고친 뒤 늘립니다. 실시간 이벤트(SSE)는 중계 구현으로 「괜찮음」이 되었습니다. 공유 저장소(Redis)를 들이면 속도 제한·MCP 토큰 캐시도 같은 저장소로 옮길 수 있습니다.
4. collab 은 별도 설계 전까지 1대로 둡니다.

## 바꿀 때 체크리스트

- [ ] 늘릴 앱의 「막힘」 항목을 모두 고쳤다(api 실시간 이벤트는 중계 구현으로 「괜찮음」 — 아래 「SSE 중계 계약」)
- [ ] DB 커넥션 합계(`대수 × 풀 크기`)가 `max_connections` 안이다
- [ ] 새 `@Scheduled` 작업에 `@SchedulerLock` 이 붙어 있다
- [ ] 2대로 띄운 격리 스택이나 스테이징에서 실시간 이벤트(SSE 중계)·AI 답변 취소·메일 계정 연결을 확인했다
- [ ] 이 문서의 표를 새 구성에 맞게 고쳤다
