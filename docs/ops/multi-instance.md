# 여러 대(multi-instance)로 늘릴 때 고려할 점

차트 기본값(`deploy/helm/values.yaml`) 기준으로 converter(2대)를 빼고 앱마다 파드 1대입니다. 이 문서는 앱을 여러 대로 늘릴 때 **프로세스 메모리에 든 상태** 때문에 깨지거나 달라지는 것을 앱별로 모으고, 서버별로 지금 늘릴 수 있는지 판정합니다. 늘리기 전에 이 문서를 확인하고, 새로 메모리 상태를 넣으면 여기에 한 줄 더합니다.

이 문서는 판정과 근거까지입니다. **운영 복제 수를 실제로 바꾸는 것(반영)은 사람이 정합니다.**

## 지금 구성(2026-11-23 기준)

| 앱 | 대수 | 복제 수 값 | 비고 |
|---|---|---|---|
| api · ai-agent · web · admin · worker · mcp | 1 | 앱별 `<앱>.replicas`(값 키 `api`·`aiAgent`·`web`·`admin`·`worker`·`mcp`), 없으면 `appReplicas`(1) | 앱별 값은 기본으로 두지 않았습니다(WP-1971). 2대 이상인 앱에만 PDB·분산 배치가 붙습니다 |
| collab | 최대 1(`min appReplicas 1`), `Recreate` | — | 늘릴 수 없게 막아 두었습니다 |
| converter | 2 | `converter.replicas` | `appReplicas` 가 0 이면 0 |
| db | 1(StatefulSet) | — | |

- **앱별 복제 수(WP-1971)**: `deploy/helm/values.yaml` 의 `api.replicas` 처럼 앱 값에 정수를 넣으면 그 앱만 그 대수가 됩니다. 값이 없으면 `appReplicas` 를 씁니다. 정수가 아니면 렌더가 실패합니다. `appReplicas: 0` 은 신규 클러스터 이관용 동결 값이라 앱별 값이 있어도 **모든 앱이 0** 이 됩니다.
- **PDB·분산 배치**: 위 여섯 앱(이미 2대인 converter 는 제외 — PDB·분산 배치 없음) 가운데 실제 복제 수가 2 이상인 앱에만 `PodDisruptionBudget`(`minAvailable: 1`)과 `topologySpreadConstraints`(`kubernetes.io/hostname`, `maxSkew: 1`, `whenUnsatisfiable: ScheduleAnyway`)를 렌더합니다. 노드 정비(drain) 때 한 대는 살아 있고, 노드가 한 대뿐이어도 스케줄을 거부하지 않습니다. 1대인 앱은 PDB 가 없어 drain 을 막지 않습니다.
- **롤링**: 여섯 앱 모두 `rollout.maxSurge: 1`·`maxUnavailable: 0`·preStop `rollout.preStopSleepSeconds: 10` 입니다. 종료 대기는 api 50초(preStop 10초 + Spring graceful 최대 30초 + 여유), ai-agent 350초(preStop 10초 + 진행 중 실행 대기 `SHUTDOWN_DRAIN_MS` 330초 + 여유), 나머지 30초입니다. 1대라서 지금도 새 파드가 Ready 가 된 뒤 옛 파드를 내리지만, 롤링 중 겹침은 아래 「롤링 배포 중 겹침」을 봅니다.

## 서버별 판정

WP-1970(여러 대 운영) 하위 이슈 WP-1971~1979 결과와 아래 「2대 검증 결과」를 합친 판정입니다. 「늘릴 수 있음」은 막힘이 없다는 뜻이고, 복제 수를 올리는 반영은 사람이 정합니다.

| 서버 | 판정 | 근거·남은 주의 |
|---|---|---|
| web · admin | 지금 늘릴 수 있음 | 정적 파일 서빙. 롤아웃 중 해시 에셋 404 는 아래 WP-1980 표 |
| mcp | 지금 늘릴 수 있음 | stateless. 토큰 검증 기억이 파드별이라 `/auth/me` 호출이 늡니다 |
| worker | 지금 늘릴 수 있음 | 작업 상태는 api DB. converter 동시 요청이 늘어 429·재시도가 늡니다 |
| converter | 이미 2대 | 파드당 동시 1건, 바쁘면 429 |
| api | 막힘 없음 — 2대 검증 통과 | 남은 「막힘」이 없습니다(메일 OAuth state·Gen:iA 로그인은 WP-1976 으로 DB). 늘릴 때 DB 커넥션 합계·공개 경로 속도 제한 총한도를 봅니다. preStop 10초를 줄이지 않습니다(「롤링 배포 중 겹침」) |
| ai-agent | 막힘 없음 — 2대 검증 통과 | 대화별 실행 잠금이 api DB 임대가 되었습니다(WP-1979). opencode 웜 풀 메모리가 파드마다 듭니다. 파드 재시작 중 진행 실행은 로컬에서 확인하지 못했습니다 |
| collab | 1대 고정 | 노트 문서 상태가 메모리에 있습니다(차트가 최대 1로 막음) |
| agent-runner | 1대 고정 | 이 helm 차트에는 agent-runner 배포가 없습니다. 1대 고정은 WP-1970(여러 대 운영 에픽) 설계의 판정입니다 |
| db | 1대 고정 | StatefulSet 1대 |

## 앱별로 깨지는 것

심각도: **막힘**(늘리면 기능이 틀리게 동작) · **바꿔야 함**(동작은 하나 결과가 달라짐) · **괜찮음**(알고만 있으면 됨)

### api

| 상태 | 위치 | 늘리면 | 심각도 | 대응 |
|---|---|---|---|---|
| 실시간 이벤트(SSE) 연결 | `global/realtime/SseRegistry` | 파드 사이 중계를 거쳐 사용자가 붙은 파드가 아니어도 채팅·알림·메시지 이벤트를 받습니다. 한계는 아래 「SSE 중계 계약」 | 괜찮음 | PostgreSQL `LISTEN/NOTIFY` 중계 구현 — `global/realtime/relay/` |
| runner 변경 스트림(SSE) | `agentruntime/realtime/RunnerSseRegistry`(WP-1249) | 위 SSE 중계로 runner 가 붙은 파드가 아니어도 원하는 상태 변경을 바로 받습니다 | 괜찮음 | 중계로 함께 태웁니다 — 계약상 최선 노력이라 runner 는 5분마다 desired 를 다시 조회해 맞춥니다([agent-runner-api.md](../integrations/agent-runner-api.md)) |
| AI 작업 화면 중계(WebSocket) | `agentruntime/screen/AgentScreenRelay`·`AgentScreenForwarder`, DB `agent_screen_route`(WP-1277·WP-1978) | 화면의 짝(브라우저·runner 소켓)은 화면을 연 POST 를 받은 「주인 파드」 메모리에 둡니다. 브라우저·runner 소켓이 다른 파드로 가면 그 파드가 주인 파드의 내부 경로(`/api/v1/internal/agent-screen/{id}/{browser\|runner}`, 내부 서비스 토큰으로 인증)로 WebSocket 을 열어 프레임을 그대로 넘깁니다. 접속 표·AI 당 열린 화면 3개·「다른 관리자가 이미 입력 중」 판정은 공유 표 `agent_screen_route` 로 모든 파드를 합쳐 봅니다. 한계: 주인 파드가 죽으면 그 화면은 닫히고(다시 열면 됩니다) 남은 행은 90초(임대) 안에 상한에서 빠집니다. 롤링 전환 중 겹침은 「롤링 배포 중 겹침」. 파드끼리 파드 IP:9090 으로 직접 닿아야 합니다 — helm 이 `AGENT_SCREEN_POD_ADDRESS` 에 파드 IP 를 넣고, api 에 NetworkPolicy 를 두게 되면 api↔api 9090 을 열어야 합니다. 내부 경로는 밖에서 닿지 않게 web·admin nginx 가 `location ^~ /api/v1/internal/agent-screen/` 를 404 로 막습니다(파드 사이 연결은 nginx 를 거치지 않습니다). 파드 사이 다리는 25초마다 양쪽에서 핑하고 60초 동안 퐁이 없으면 닫습니다 — 넘기던 파드가 멈추며 닫으면 화면 기록에 「서버가 멈춰 닫았어요」가 남습니다. 화면을 여는 동안(POST 안의 REQUIRES_NEW 기록) 요청 하나가 DB 커넥션을 잠깐 두 개 씁니다. 임대 갱신은 중계 타이머 스레드에서 돌므로 DB 가 느리면 그만큼 핑·만료 확인·입력 기록 꺼내기가 늦어집니다 | 괜찮음 | — |
| AI 답변 생성 중 취소(■)·동시 생성 상한·진행 목록 | `global/realtime/DefaultStreamingGenerationRegistry`, DB `streaming_generation`(WP-1974) | 진행 중인 생성의 슬롯을 DB 표에 두어, 어느 파드가 받아도 같은 동시 생성 상한·「대화 사용 중」 판정·진행 목록을 봅니다. 생성 자체는 시작한 파드에서만 돌고, 취소가 다른 파드로 가면 위 중계(`generation.cancel`)로 생성 중인 파드에 넘겨 멈춥니다. 파드가 죽어 남은 슬롯은 임대 만료(시작 전 5분, 실행 중 타임아웃 + 30초 + 1분)로 무시되고 같은 사용자의 다음 시작 때 지워집니다. 롤링 전환 중 겹침은 「롤링 배포 중 겹침」. 다른 파드로 간 취소는 WP-1973 중계에 기대므로 중계가 메시지를 놓치면 생성은 타임아웃까지 돕니다 | 괜찮음 | — |
| 메일 OAuth state | `mail/service/OAuthStateStore`, DB `mail_oauth_state`(WP-1976) | state 를 SHA-256 해시로만 DB 에 두어 시작과 콜백이 다른 파드로 가도 이어집니다. 한 번 쓰면 지우고(어느 파드에서든 재사용 거부), 10분 지나면 만료입니다 | 괜찮음 | — |
| Gen:iA 로그인 진행 | `agentaccount/genialogin/GeniaLoginSessionRepository`, DB `genia_login_session`(WP-1976) | 진행 상태를 DB 에 두어 시작·조회·취소가 다른 파드로 가도 이어집니다. 여러 파드가 동시에 조회해도 폴링 임대로 한 곳만 Gen:iA 서버를 폴링하고, 계정은 한 번만 저장합니다 | 괜찮음 | — |
| 정지한 구성원의 스트림 닫기 | `global/realtime/SseRegistry.closeAll` | 닫힘 신호가 중계를 타서 다른 파드에 붙은 그 구성원의 스트림도 바로 닫힙니다 | 괜찮음 | — |
| AI 키 폐기 때 그 키로 연 스트림 닫기 | `SseRegistry.closeByKey`(WP-2008), `auth/service/AgentKeyStreamCloser` | 폐기를 받은 파드는 바로 닫습니다. 중계를 타지 않아 다른 파드의 스트림은 30초 주기 재확인(`revalidate`)이 닫습니다 — 최대 약 30초, 2대 검증 실측 3~20초 | 괜찮음 | 즉시 닫아야 하면 닫힘 신호를 중계에 태웁니다 |
| 메일 수동 동기화·휴지통 비우기 진행률·동시 실행 가드 | DB `mail_account_job`(`mail/service/MailSyncProgress`·`MailTrashEmptyProgress`, WP-1977) | 어느 파드가 받아도 같은 진행률과 가드를 봅니다. 살아 있는 작업은 30초마다 하트비트로 갱신하고, 파드가 죽으면 2분(TTL) 뒤 다른 파드가 다시 시작할 수 있습니다. 롤링 전환 중 겹침은 「롤링 배포 중 겹침」 | 괜찮음 | 전환 중 겹침은 한 번뿐이라 수용합니다 |
| 메일함별 동기화 가드 | `mail/service/folder/MailFolderSyncGuard` | 파드 사이 겹침은 막지 못하지만 넣기가 멱등이라 결과는 같습니다(주석에 명시) | 괜찮음 | — |
| 테넌트 상태 캐시 | `global/tenant/TenantStatusChecker` | 다른 파드에서 정지한 테넌트를 이 파드가 최대 5초 더 ACTIVE 로 봅니다(비활성은 캐시하지 않음) | 괜찮음 | 이미 여러 대를 고려해 설계됨 |
| AI 요약 등 재생성 가능한 캐시 | `messaging/service/CatchupSummaryCache` 등 | 파드마다 따로 만들어 적중률이 떨어지고 AI 호출이 늘어납니다 | 괜찮음 | 비용이 문제 되면 공유 캐시로 |
| AI 연결 상태(외부 AI 「연결됨」) | DB `agent_connection`(WP-1975) | 파드마다 자기에게 붙은 AI 를 1분마다 적고, 읽는 쪽은 이 표 하나만 봅니다. 어느 파드가 받아도 같은 답입니다 | 괜찮음 | — |
| 예약 작업(`@Scheduled`) | `*Scheduler`, `*Job` | 공유 DB의 ShedLock(`V148__shedlock.sql`)은 같은 작업의 동시 실행을 막습니다. 기본 최소 잠금 `PT10S`는 거의 동시에 깨어난 다른 파드가 곧바로 실행하지 못하게 하며, 작업 주기 전체를 파드 간에 보장하려면 주기에 맞는 최소 잠금이 필요합니다 | 괜찮음 | 새 예약 작업에도 `@SchedulerLock`을 붙입니다. 파드별 주기 작업(SSE heartbeat 등)은 각 파드에서 실행합니다 |
| 업로드 파일 | `/data/storage-data`(PVC `storage-data`) | RWX(NFS)라 여러 파드가 함께 마운트할 수 있습니다 | 괜찮음 | — |
| DB 커넥션 | Hikari 풀(파드마다) | 커넥션 수가 `대수 × 풀 크기` 가 됩니다 | 바꿔야 함 | 합계가 `db.maxConnections` 안인지 helm 렌더 가드가 막아 줍니다. 식과 고칠 값은 아래 「DB 커넥션 합계」(WP-752 풀 고갈 참고) |

#### SSE 중계 계약

파드 사이 SSE 중계(`global/realtime/relay/`, WP-1973)가 지키는 것과 지키지 않는 것 — 늘리기 전에 알고 있어야 할 계약입니다.

- **순서**: **한 파드 안**에서는 발행 순서대로 도착합니다(발행 커넥션 하나 + 단일 채널의 LISTEN 큐). **파드 사이는 보장하지 않습니다** — 다른 파드의 동시 발행은 커밋 순서가 엇갈릴 수 있습니다. 클라는 이벤트마다 최신 상태를 다시 그립니다.
- **닫힘 신호와 이벤트가 겹치는 순간**: 중계는 발행 파드가 되돌아온 **자기 닫힘 신호를 건너뜁니다**(그 파드는 발행 직전에 로컬을 이미 닫았습니다). 그래서 발행 파드에서는 **닫기 직전에 그 사람에게 보낸 이벤트가 NOTIFY 왕복 동안 그 사이 재연결한 스트림에 닿을 수 있습니다** — 영향은 발행 파드 한 곳에 그치고(다른 파드는 유선 닫힘을 그대로 받습니다), 정지 토큰은 401 이라 재연결 자체가 막힙니다.
- **누락**: 재연결 중·클라이언트 끊김 동안의 이벤트는 **재생하지 않습니다**(재생 버퍼 없음 — best-effort). 클라는 재연결 직후 화면을 재조회해 상태를 맞춥니다. 발행 커넥션 단절 시 `warn` 로그가 남습니다.
- **실측 지연**: 발행 → emitter 도착은 평균 **2ms**, 최대 **6ms** — `SseEventRelayTransportTest`·`SsePodRelayIntegrationTest` 기반 로컬 Testcontainers 실측(워밍업 10회)입니다. 다만 **파드 사이 순서는 보장하지 않으므로**(위 「순서」) 이 수치는 어디까지나 도착 시간 참고입니다. 리스너는 `getNotifications(50)` 주기로 소켓을 기다려(50ms 이하 계약) 도착 즉시 깨어납니다. 파드 간 도착을 재는 통합 테스트 소요는 케이스당 0.17~0.25s, 리스너 재연결 재등록은 지수 백오프(1s→30s 상한) 탓에 실측 약 1.8s가 걸렸습니다.
- **켜기/끄기**: `app.realtime.relay.enabled` — 기본 `true`(local·운영), 테스트 프로파일은 `false`(로컬 직행).
- **큰 이벤트**: 인코딩 결과가 **7000 바이트**를 넘으면 `sse_relay_event` 표에 행을 남기고 통지에는 `#id` 만 갑니다 — PostgreSQL NOTIFY 8000 바이트 상한 회피. 발행·수신은 단일 채널 `wp_sse_relay` 를 쓰고(채널을 나누면 순서가 깨짐), 남은 행은 `RelayOutboxCleaner` 가 **10분** 지난 것을 정리합니다(`@SchedulerLock`).
- **남는 한계**: 사용자 연결 끊김 시각(WP-1201)은 WP-1975 뒤 DB(`agent_connection`)로 판정해 파드와 무관합니다. AI 키 폐기 때 그 키로 연 스트림 닫기(`SseRegistry.closeByKey`, WP-2008)는 중계를 타지 않아 폐기 요청을 받은 파드에서만 바로 닫히고, 다른 파드는 각 파드의 주기 안전망(`AgentKeyStreamCloser` 의 비활성 키 정리)이 닫습니다.

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
| 채널·DM 대화별 실행 잠금 | `src/agent/shared-run-coalescer.ts`, api DB `messaging_agent_run`(WP-1979) | api 가 보낸 이벤트가 서로 다른 ai-agent 로 가도 (채널, 스레드, AI) 대화 하나에 실행은 하나만 돕니다. 임대를 쥔 파드가 도는 동안 온 메시지는 서버 대기 한 칸(최신 하나)에 오르고, 반납 때 넘겨받아 이어 돕니다. 이미 처리 중인 메시지가 다시 오면 `DUPLICATE` 로 건너뜁니다. 임대는 실행 상한(15분) + 1분이라 파드가 죽으면 그 뒤 다른 쪽이 넘겨받습니다. 롤링 전환 중 겹침은 「롤링 배포 중 겹침」 | 괜찮음 | 서버 대기(`QUEUED`)는 ai-agent 로그에 줄을 남기지 않습니다(`DUPLICATE`·실행 기록만). 어느 파드가 대기시켰는지는 `messaging_agent_run` 표나 앞단 로그로 봅니다 |
| ai-agent → api 내부 호출 | `WORKPLACE_API_BASE_URL`(api Service) | 호출마다 api 파드 하나로 갑니다. 답변 중에 부르는 호출(비서 자격증명 조회 등)은 재시도가 없어, 끝점에서 빠지기 전에 포트를 닫은 api 파드로 가면 그 답변을 실패로 끝냅니다(다시 보내면 됩니다). 반복 AI 작업의 결과 보고는 일시 오류를 재시도합니다(WP-1118) | 괜찮음 | preStop(10초)이 끝점 전파 지연보다 길어야 합니다 — 「롤링 배포 중 겹침」 |
| opencode 서버 기동 | `@opencode-ai/sdk` 기본 5초 | 파드 부하가 높으면 opencode 서버 기동이 5초를 넘겨 그 생성이 오류로 끝날 수 있습니다(2대 검증 중 관찰, 대수와 직접 관계는 없음) | 괜찮음 | 자주 보이면 파드 CPU·웜 풀 크기를 봅니다 |

### 그 밖

- **collab**: 노트 문서 상태를 메모리에 들고 있어 **늘릴 수 없습니다**. 늘리려면 Yjs 상태 공유(Redis 등)가 먼저입니다. [collab-k8s-handoff.md](collab-k8s-handoff.md)
- **worker**: api 가 HTTP 로 작업을 보내고 콜백으로 결과를 받습니다. 작업 상태는 api DB(`file_extraction`)에 있어 여러 대여도 됩니다. 파일은 RWX 볼륨에서 읽습니다.
- **converter**: 이미 2대입니다. 파드당 동시 1건이라 바쁘면 429 를 돌려주고 호출자가 재시도합니다.
- **web · admin**: 정적 파일을 서빙합니다. web 롤아웃 중에는 아래에 기록한 해시 에셋 404가 발생할 수 있습니다.

## `/api/` 경로에서 ingress sticky 가 소용없는 이유

브라우저의 `/api/` 요청은 **ingress → web(또는 admin) 파드의 nginx → api Service → api 파드** 로 갑니다. ingress 의 `/` 규칙 뒤는 web Service 이고, api 로 넘기는 것은 web·admin nginx 의 `proxy_pass`(`api:9090`)입니다.

- ingress-nginx 의 쿠키 sticky(`affinity: cookie`)는 **ingress 가 고르는 파드**, 곧 web 파드를 고정할 뿐입니다. web nginx 가 api Service 로 여는 연결은 kube-proxy 가 연결마다 api 파드를 고르므로 api 파드는 고정되지 않습니다.
- 같은 사용자의 SSE 스트림·일반 요청, 브라우저·runner 소켓도 서로 다른 연결이라 같은 파드에 모인다는 보장이 없습니다. ai-agent·mcp·worker 는 쿠키 없이 api Service 로, runner 는 공개 주소(ingress → web nginx)로 부르며 sticky 쿠키를 싣지 않습니다.
- 그래서 api 는 sticky 에 기대지 않고, 파드 사이에 상태를 나눕니다(SSE 중계, DB 표·임대, 작업 화면의 주인 파드 이어 붙이기).

## 롤링 배포 중 겹침

`maxSurge: 1`·`maxUnavailable: 0` 이라 새 파드가 Ready 가 된 뒤 옛 파드가 preStop(10초) → SIGTERM → graceful 종료를 거칩니다. 그동안 두 종류의 겹침이 있습니다.

**같은 버전 파드가 바뀌는 동안**(2대 검증에서 api 한 대를 내렸다 올려 확인)

- 내려가는 api 는 포트를 닫아 새 연결을 받지 않지만, **이미 열린 SSE 는 graceful 종료 대기(약 30초) 동안 유지**하다가 끊습니다. 그동안에도 중계된 이벤트가 옛 스트림에 닿은 것을 앞선 실행에서 한 번 보았지만, 최종 실행에서는 그동안 받은 이벤트가 없어 늘 그렇다고 확인하지는 못했습니다. 끊긴 틈의 이벤트 처리는 「SSE 중계 계약」의 누락을 봅니다.
- 살아 있는 파드에서 시작한 AI 답변 생성은 끝까지 돌고, 진행 목록·취소는 다시 올라온 파드에서도 이어졌습니다. **내려가는 파드에서 돌던 생성**이 graceful 종료 대기(약 30초) 동안 끝나는지, 넘으면 어떻게 끝나는지는 확인하지 않았습니다(「반영 뒤 지켜볼 것」).
- **preStop 을 줄이거나 없애지 않습니다.** preStop 없이 바로 SIGTERM 하면 포트가 닫힌 직후 끝점에서 빠지기 전에 시작한 생성이 실패했습니다 — ai-agent 가 api 로 비서 자격증명을 읽다 닫힌 파드로 가 연결 거부 → 502 → 답변 오류(답변 중의 ai-agent → api 호출은 재시도 없음). preStop(10초)이 kube-proxy·ingress 의 **끝점 전파 지연보다 길어야** 이 틈이 없습니다. 운영의 실제 전파 지연은 확인하지 못했습니다(「반영 뒤 지켜볼 것」).

**옛 버전과 새 버전이 겹치는 동안**(메모리 상태를 DB 로 옮긴 버전을 처음 반영할 때 한 번)

- 생성 상한·진행 목록(WP-1974): 옛 파드는 메모리만 보므로 판정이 느슨할 수 있습니다.
- 메일 동기화·휴지통 가드(WP-1977): 옛 파드(메모리 가드)와 새 파드(DB 가드)가 서로의 선점을 보지 못해 같은 계정 작업이 한 번 겹칠 수 있습니다(한 번뿐이라 수용).
- AI 작업 화면(WP-1978): 다른 쪽에서 연 화면이 붙지 못할 수 있습니다(다시 열면 됩니다).
- ai-agent 대화별 잠금(WP-1979): api 가 옛 버전이면 임대 호출이 실패해 ai-agent 는 파드 메모리 합치기로 답합니다(답은 끊기지 않지만 파드 사이 겹침은 막지 못합니다).
- 옛 파드가 모두 내려가면 사라집니다. 이 겹침은 로컬에서 재현하지 못했습니다(「반영 뒤 지켜볼 것」).

**ai-agent 파드가 바뀌는 동안**: 내려가는 ai-agent 는 진행 중인 실행을 최대 330초(`SHUTDOWN_DRAIN_MS`) 기다린 뒤 끝납니다(종료 대기 350초). 이 경로는 2대 검증에서 확인하지 못했습니다(「반영 뒤 지켜볼 것」).

## 다중 인스턴스 운영 판정(WP-1980)

아래 일곱 항목은 현재 동작을 수용·문서화했으며, 도움말 재색인은 파드 간 실행 간격을 수정했습니다.

| 항목 | 위치 | 여러 파드에서의 동작 | 판정 | 운영 대응 |
|---|---|---|---|---|
| 공개 경로 속도 제한 | api `global/security/ratelimit/TokenBucketLimiter` | 각 파드가 버킷을 따로 관리합니다. 같은 버킷 키의 요청이 고르게 분산되면 해당 키의 한도는 대략 `API 파드 수 × 파드당 설정 한도`가 됩니다. 기본 키는 정책·IP이며, `DRIVE_PLAYBACK`은 재생 토큰 해시를 키에 추가하므로 같은 IP에서도 토큰별로 한도를 따로 셉니다 | 수용·문서화 | API를 늘릴 때 기존 총한도를 유지하려면 파드당 한도를 줄이거나 버킷을 공유 저장소로 옮깁니다. [rate-limit.md](rate-limit.md#여러-대로-늘릴-때-고려할-점) |
| 아바타 처리 동시성 | api `user/service/AvatarImageProcessor` | 파드당 동시에 2건, 전체 최대 `2 × API 파드 수`를 처리합니다. 요청을 받은 파드에서 3초 동안 자리가 나지 않으면 429를 반환합니다 | 수용·문서화 | 파드별 상한을 유지하고, 429를 받은 업로드는 잠시 뒤 재시도합니다 |
| 메일 분석 차단기 | api `mail/service/MailAnalysisBreaker` | 백필에서 테넌트별 모델 실패가 5회 연속이면 10분 동안 차단하고, 실패한 메일은 30분 동안 건너뜁니다. 연속 실패·열림 상태와 메일별 재시도 대기 표가 파드별이어서 장애 중 다른 파드가 모델을 다시 호출할 수 있습니다 | 수용·문서화 | 백필에 파드별 차단을 적용합니다. 장애 중 모델 호출을 볼 때는 파드별 로그를 함께 확인합니다 |
| 도움말 재색인 | api `help/service/HelpIndexScheduler` | 1분마다 실행을 시도합니다. 마지막 성공 시각은 로컬에 기록하며 성공 뒤 10분 이내에는 재색인을 건너뜁니다 | 수정 | 공유 DB의 ShedLock은 실행 중 중복을 막습니다. 실행 실패 뒤 최소 잠금은 10초라 다음 분 tick에서 재시도할 수 있고, 성공한 경우에만 실행 시작 시각부터 10분이 될 때까지 잠금을 연장합니다 |
| 첨부 원본 없음 표시 | api `mail/service/MailAttachmentPreviewService` | 원본 없음 표시를 사용자·첨부별로 해당 파드에 10분간 보관합니다. 같은 요청이 다른 파드로 가면 원본 확인을 반복할 수 있습니다 | 수용·문서화 | 파드별 10분 표시를 유지합니다 |
| Wiki·Home·Mail AI 요약 SingleFlight | api `WikiSummaryService`, `HomeContextSummaryService`, `MailAnalysisService`와 `mail/util/SingleFlight` | 중복 실행 방지는 파드별로 동작하므로 파드 간 LLM 호출과 비용이 중복될 수 있습니다. Wiki·Home 요약과 일반 메일 분석은 DB 조건부 저장으로 결과를 보호합니다. 메일의 공용 요약 강제 생성과 개인 요약만 생성하는 경로는 저장 시 이미 요약이 생겼는지 확인하지 않아, 여러 파드가 동시에 생성하면 나중에 저장한 결과가 앞선 결과를 덮어쓸 수 있습니다 | 수용·문서화 | 파드별 중복 방지와 메일 요약의 덮어쓰기 가능성을 수용하고, 확장 뒤 LLM 호출량과 비용을 확인합니다 |
| worker → converter 동시성 | `apps/workplace-worker/app/config.py`, `converter.py` | `WORKER_CONVERTER_CONCURRENCY`의 기본값은 worker 파드당 1건입니다. worker가 늘면 converter에 들어오는 동시 요청도 늘어 포화 시 converter의 429와 worker의 재시도가 증가할 수 있습니다 | 수용·문서화 | 파드별 상한을 유지하고, worker를 늘릴 때 converter의 429와 재시도 횟수를 확인합니다 |
| web 롤아웃 중 해시 에셋 404 | `apps/workplace-web/nginx.conf`, `PersonCardAssignHost.tsx` 등 | `index.html`은 재검증하고 해시가 붙은 에셋은 불변 장기 캐시합니다. 롤아웃 중 구·신 파드가 섞이면 새 index가 참조한 청크를 구 파드에 요청해 404가 날 수 있습니다 | 수용·문서화 | 일부 지연 로딩 창은 청크 로드 실패 시 새로고침을 안내합니다. 동적 import 실패를 전역에서 복구하는 처리는 찾지 못했으므로 사용자가 직접 새로고침해야 할 수 있습니다 |

## 2대 검증 결과(2026-11-23, WP-1982)

**방법**: 로컬에 DB 1개, api 2대(같은 DB, 중계 켬), ai-agent 2대를 띄우고, api 앞과 ai-agent 앞에 **요청마다 번갈아 보내는(sticky 없는) 프록시**를 두었습니다(SSE·WebSocket 통과). 항목마다 한 파드로 보내고 다른 파드에서 받았는지를 파드 직접 포트·프록시 기록으로 확인했습니다. 외부 의존은 스텁으로 대신했습니다 — LLM 은 OpenAI 호환 스트림 스텁(고정 문구, opencode 연결), IMAP 은 greenmail, Gen:iA 로그인은 로컬 스텁. 재시작은 앞단 프록시에서 먼저 뺀 뒤 2초 기다려 SIGTERM 하고 다시 띄우는 것으로 흉내 냈습니다. 검증 도구는 저장소에 넣지 않았습니다. 결과(스트림 이벤트·조회 응답·DB 표)는 다른 파드의 직접 포트에서 보며, 프록시를 거치면 어느 파드가 받았는지 섞이므로 판정은 프록시가 아니라 파드 직접 포트로 합니다.

| 항목 | 확인한 것 | 결과 | 로컬에서 확인 못 함 |
|---|---|---|---|
| SSE 중계·알림·외부 AI 깨우기 | 한 파드에서 보낸 DM·이슈 배정이 다른 파드 스트림에 `messaging.message.created`·`notify.created` 로 도착. 외부 AI 키 스트림에 깨우기 이벤트 도착. 정지한 구성원 스트림은 바로, 폐기한 키 스트림은 30초 주기 안에 닫힘 | 통과 | — |
| 홈 채팅 답변 | 한 파드로 보낸 질문의 답(delta·done)이 다른 파드 스트림에 도착, 답 저장 | 통과 | 실제 LLM(Anthropic 연결은 주소 칸이 없어 스텁 불가)의 스트림 모양·지연·오류 |
| 홈 채팅 취소·상한 | 진행 목록·같은 대화 409·동시 상한(3) 429 가 두 파드에서 같음. 다른 파드로 간 ■ 취소가 생성을 0.2초 안에 멈춤(양방향) | 통과 | — |
| 메일 계정 연결(OAuth state) | 한 파드에서 발급한 state 를 다른 파드 콜백이 알아봄, 한 번 쓰면 어느 파드에서도 거부 | 통과 | 실제 Microsoft 토큰 교환·계정 저장 |
| Gen:iA 로그인 진행 | 시작·조회·완료·취소가 파드를 바꿔도 이어짐, 동시 조회에도 폴링 1회, 계정 1개 | 통과 | 실제 Gen:iA 서버 연동 |
| 메일 동기화·휴지통 비우기 | 다른 파드가 같은 진행률을 봄. 동기화 중 다른 파드의 두 번째 동기화 시작은 가드로 빈 결과를 바로 돌려주고 첫 동기화는 중복 없이 적재. 휴지통 비우기 중 다른 파드의 두 번째 시작은 새 작업 없이 같은 작업 상태를 돌려줌 | 통과 | — |
| AI 작업 화면 | 브라우저·runner 소켓이 주인 파드와 다른 파드에 붙는 세 경우 모두 프레임·입력·닫힘이 오감 | 통과 | 실제 runner·Pod |
| 채널 AI 답변 1회 | 같은 대화 메시지 2개가 서로 다른 ai-agent 로 가도 실행이 겹치지 않고 차례로 2번. 같은 메시지 3번 전달 → 실행 1번 | 통과 | 실제 모델의 도구 답장 경로(스텁은 텍스트만 내 「대신 답하기」로 올라감) |
| api 한 대 재시작 | 재시작 중 생성 시작·SSE 재연결·진행 목록·취소가 이어짐. 옛 SSE 는 약 30초 뒤 끊김 | 통과 | 내려가는 api 파드에서 돌던 생성의 끝(검증의 생성은 모두 살아 있는 파드에서 시작), 실제 쿠버네티스 롤링(끝점 전파 지연, 옛·새 버전 겹침), ai-agent 파드 재시작 |

검증에서 제품 결함은 나오지 않았습니다. 위 「로컬에서 확인 못 함」은 운영(또는 스테이징) 반영 때 지켜볼 항목이며, 아래에 모았습니다.

**반영 뒤 지켜볼 것**

- 실제 LLM(Anthropic 연결)의 스트림 모양·지연·오류, 실제 모델의 도구 답장 경로
- 실제 Microsoft 토큰 교환·계정 저장, 실제 Gen:iA 서버 연동, 실제 runner·Pod(AI 작업 화면)
- 내려가는 api 파드에서 돌던 생성이 graceful 종료 대기(약 30초) 안에 끝나는지, 넘으면 어떻게 끝나는지
- 실제 쿠버네티스 롤링: 끝점 전파 지연(preStop 10초가 충분한지), 옛·새 버전 겹침(「롤링 배포 중 겹침」)
- ai-agent 파드 재시작(진행 실행 최대 330초 대기)
- 내려가는 api 의 옛 SSE 에 중계 이벤트가 늘 닿는지(최종 실행에서는 받은 이벤트가 없어 확인하지 못함)

## 늘리는 순서(권장)

1. 늘릴 앱의 `<앱>.replicas` 만 넣습니다(WP-1971). `appReplicas` 를 올리면 값을 두지 않은 여섯 앱이 함께 늘어납니다.
2. 「지금 늘릴 수 있음」인 앱부터 늘립니다: web · admin · mcp · worker.
3. api · ai-agent 의 판정은 「서버별 판정」 표를 따르며, 늘릴지는 사람이 정합니다. 늘릴 때 api 는 DB 커넥션 합계(「DB 커넥션 합계」)와 공개 경로 속도 제한 총한도(WP-1980 표)를, ai-agent 는 웜 풀 메모리를 봅니다. 첫 롤링의 겹침은 「롤링 배포 중 겹침」, 반영 뒤 볼 것은 「반영 뒤 지켜볼 것」입니다. 공유 저장소(Redis)를 들이면 속도 제한·MCP 토큰 캐시도 같은 저장소로 옮길 수 있습니다.
4. collab · agent-runner · db 는 1대로 둡니다(collab 은 별도 설계 전까지).

## DB 커넥션 합계

파드마다 Hikari 풀이 따로라, DB 접속 수는 파드 수에 비례합니다. 롤링 배포 중에는 `rollout.maxSurge` 만큼 새 파드가 더 뜨고, 옛 파드는 종료 중(preStop 10초 + graceful 최대 30초)에도 풀을 쥐고 있습니다. 종료 중 파드는 maxSurge 에 세지 않으므로 다음 새 파드가 함께 뜹니다. 그래서 maxSurge 를 두 번 셉니다.

```
(api 복제 수 + rollout.maxSurge × 2) × api.dbPoolMaxSize + rollout.maxSurge × 2 + db.reservedConnections ≤ db.maxConnections
```

- api 복제 수는 `api.replicas`, 없으면 `appReplicas` 입니다(WP-1971 — 가드도 이 값을 셉니다).
- 지금 값: (1+2)×10+2+13 = 45 ≤ 100. api 2대면 (2+2)×10+2+13 = 55 입니다. 이 값(풀 10, Flyway 2, 예비 13, 상한 100)으로 api 는 최대 6대까지 갑니다((6+2)×10+2+13 = 95).
- 예비(`db.reservedConnections` 13)는 superuser 예약 3 + 사람·운영 접속 10 입니다. Flyway 접속은 기동 중인 새 파드(maxSurge 대)마다 2 개(Flyway 는 기동 때만 붙습니다)라 식의 `rollout.maxSurge × 2` 항으로 따로 세므로 maxSurge 를 올리면 같이 늘어납니다.
- 입력 검사: `appReplicas`·`<앱>.replicas`·`rollout.maxSurge`·`api.dbPoolMaxSize` 등은 정수여야 하고, `api.dbPoolMaxSize` 는 1 이상이어야 합니다(Hikari 는 1 미만이면 기본 10 을 씁니다).
- 대수를 늘릴 때 고칠 값: `db.maxConnections`(PostgreSQL 메모리도 함께 봅니다), 또는 `api.dbPoolMaxSize` 를 줄입니다. 값은 `deploy/helm/values.yaml` 에 있습니다.
- helm 이 이 식을 렌더 때 검사해, 넘으면 계산식과 값을 보여 주며 실패합니다(`swp.dbConnectionBudget`).
- db StatefulSet 의 args(`max_connections`)를 바꾸면 파드 템플릿이 바뀌어 반영 때 db 파드가 한 번 다시 뜹니다(잠깐 DB 끊김, api 재접속). 반영 전에 알립니다. 같은 반영에서 ConfigMap 키가 바뀌면 checksum/config 로 앱 파드도 함께 다시 뜨고, 새 api 파드는 db 가 Ready 될 때까지 Flyway 접속에 실패해 몇 번 재시작할 수 있습니다 — 반영 시간이 그만큼 길어집니다.
- DB 에 붙는 앱은 api 뿐입니다(WP-1972 확인). 다른 앱이 DB 에 붙게 되면 식에 더합니다.
- 배경: 풀 고갈 사례는 WP-752.

## 바꿀 때 체크리스트

- [ ] 늘릴 앱의 「막힘」 항목을 모두 고쳤다(지금 api·ai-agent·mcp 표에 「막힘」 없음. collab 은 여전히 늘릴 수 없고 차트가 1대로 막는다 — 앱별 판정은 「서버별 판정」)
- [ ] 복제 수는 `<앱>.replicas` 로 그 앱만 바꿨다(`appReplicas` 를 올리면 여섯 앱이 함께 바뀐다)
- [ ] 2대 이상인 앱에 PDB·분산 배치가 렌더되는지 `helm template` 으로 봤다
- [ ] DB 커넥션 합계가 `max_connections` 안이다(helm 가드가 넘으면 렌더를 막는다 — 「DB 커넥션 합계」)
- [ ] preStop(`rollout.preStopSleepSeconds` 10초)을 줄이지 않았다(「롤링 배포 중 겹침」)
- [ ] 새 `@Scheduled` 작업에 `@SchedulerLock` 이 붙어 있다
- [ ] 2대 구성(격리 스택이나 스테이징)에서 실시간 이벤트(SSE 중계)·AI 답변·취소·메일 계정 연결·Gen:iA 로그인·메일 진행·AI 작업 화면·채널 AI 답변 1회를 확인했다(2026-11-23 로컬 2대 확인 — 「2대 검증 결과」)
- [ ] 반영 뒤 「반영 뒤 지켜볼 것」 목록을 지켜봤다
- [ ] 이 문서의 표를 새 구성에 맞게 고쳤다
