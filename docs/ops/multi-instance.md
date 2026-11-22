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
| 실시간 이벤트(SSE) 연결 | `global/realtime/SseRegistry` | 사용자가 붙은 파드에서 난 이벤트만 받습니다. 다른 파드에서 생긴 채팅·알림·메시지 이벤트를 놓칩니다 | 막힘 | 파드 사이 중계(Redis Pub/Sub 또는 PostgreSQL `LISTEN/NOTIFY`)를 두고, 각 파드가 받은 이벤트를 자기 연결에 뿌리게 합니다 |
| runner 변경 스트림(SSE) | `agentruntime/realtime/RunnerSseRegistry`(WP-1249) | runner 가 붙은 파드에서 난 원하는 상태 변경만 바로 알립니다. 다른 파드에서 난 변경은 놓칩니다 | 괜찮음 | 계약상 최선 노력 — runner 가 5분마다 desired 를 다시 조회해 맞춥니다([agent-runner-api.md](../integrations/agent-runner-api.md)). 위 SSE 중계를 들이면 함께 태웁니다 |
| AI 작업 화면 중계(WebSocket) | `agentruntime/screen/AgentScreenRelay`·`AgentScreenTickets`(WP-1277) | 관리자 브라우저 소켓과 runner 소켓을 파드 메모리에서 세션 id 로 짝짓습니다. 두 소켓(과 접속 표를 받은 POST)이 다른 파드로 가면 붙지 못해 화면이 열리지 않습니다. AI 당 열린 화면 3개·「다른 관리자가 이미 입력 중」 판정도 파드마다 따로 셉니다. 새 파드가 뜨면 닫히지 않은 옛 세션 행을 닫으므로, 겹치는 동안 다른 파드의 열린 화면 기록이 먼저 닫힌 것으로 남을 수 있습니다 | 막힘 | 세션 id 로 같은 파드에 보내는(sticky) 라우팅을 두거나, 파드 사이 프레임 중계(Redis Pub/Sub 등)와 공유 표 저장소를 둡니다 |
| AI 답변 생성 중 취소(■) | `global/realtime/DefaultStreamingGenerationRegistry` | 취소 요청이 생성 중인 파드와 다른 파드로 가면 멈추지 않습니다. 사용자당 동시 생성 상한도 파드마다 따로 셉니다 | 막힘 | 취소를 위 중계로 전파하거나, 생성 요청을 같은 파드로 보내는(sticky) 라우팅이 필요합니다 |
| 메일 OAuth state | `mail/service/OAuthStateStore` | 시작과 콜백이 다른 파드로 가면 「state 없음」으로 메일 계정 연결이 실패합니다 | 막힘 | state 를 DB 표나 Redis 로 옮깁니다(TTL 10분, 한 번 쓰면 삭제) |
| 메일 수동 동기화 진행률·동시 실행 가드 | `mail/service/MailSyncProgress` | 진행률 조회가 다른 파드로 가면 「대기」로 보입니다. 같은 계정 동기화가 두 파드에서 겹칠 수 있습니다 | 바꿔야 함 | 진행 상태를 DB 로 옮기거나 DB 행 잠금으로 가드합니다 |
| 메일함별 동기화 가드 | `mail/service/folder/MailFolderSyncGuard` | 파드 사이 겹침은 막지 못하지만 넣기가 멱등이라 결과는 같습니다(주석에 명시) | 괜찮음 | — |
| 테넌트 상태 캐시 | `global/tenant/TenantStatusChecker` | 다른 파드에서 정지한 테넌트를 이 파드가 최대 5초 더 ACTIVE 로 봅니다(비활성은 캐시하지 않음) | 괜찮음 | 이미 여러 대를 고려해 설계됨 |
| AI 요약 등 재생성 가능한 캐시 | `messaging/service/CatchupSummaryCache` 등 | 파드마다 따로 만들어 적중률이 떨어지고 AI 호출이 늘어납니다 | 괜찮음 | 비용이 문제 되면 공유 캐시로 |
| 예약 작업(`@Scheduled`) | `*Scheduler`, `*Job` | 공유 DB의 ShedLock(`V148__shedlock.sql`)은 같은 작업의 동시 실행을 막습니다. 기본 최소 잠금 `PT10S`는 거의 동시에 깨어난 다른 파드가 곧바로 실행하지 못하게 하며, 작업 주기 전체를 파드 간에 보장하려면 주기에 맞는 최소 잠금이 필요합니다 | 괜찮음 | 새 예약 작업에도 `@SchedulerLock`을 붙입니다. 파드별 주기 작업(SSE heartbeat 등)은 각 파드에서 실행합니다 |
| 업로드 파일 | `/data/storage-data`(PVC `storage-data`) | RWX(NFS)라 여러 파드가 함께 마운트할 수 있습니다 | 괜찮음 | — |
| DB 커넥션 | Hikari 풀(파드마다) | 커넥션 수가 `대수 × 풀 크기` 가 됩니다 | 바꿔야 함 | PostgreSQL `max_connections` 안에 드는지 확인합니다(WP-752 풀 고갈 참고) |

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
- **web · admin**: 정적 파일을 서빙합니다. web 롤아웃 중에는 아래에 기록한 해시 에셋 404가 발생할 수 있습니다.

## 다중 인스턴스 운영 판정(WP-1980)

아래 일곱 항목은 현재 동작을 수용·문서화했으며, 도움말 재색인은 파드 간 실행 간격을 수정했습니다.

| 항목 | 위치 | 여러 파드에서의 동작 | 판정 | 운영 대응 |
|---|---|---|---|---|
| 공개 경로 속도 제한 | api `global/security/ratelimit/TokenBucketLimiter` | 각 파드가 버킷을 따로 관리합니다. 같은 버킷 키의 요청이 고르게 분산되면 해당 키의 한도는 대략 `API 파드 수 × 파드당 설정 한도`가 됩니다. 기본 키는 정책·IP이며, `DRIVE_PLAYBACK`은 재생 토큰 해시를 키에 추가하므로 같은 IP에서도 토큰별로 한도를 따로 셉니다 | 수용·문서화 | API를 늘릴 때 기존 총한도를 유지하려면 파드당 한도를 줄이거나 버킷을 공유 저장소로 옮깁니다. [rate-limit.md](rate-limit.md#여러-대로-늘릴-때-고려할-점) |
| 아바타 처리 동시성 | api `user/service/AvatarImageProcessor` | 파드당 동시에 2건, 전체 최대 `2 × API 파드 수`를 처리합니다. 요청을 받은 파드에서 3초 동안 자리가 나지 않으면 429를 반환합니다 | 수용·문서화 | 파드별 상한을 유지하고, 429를 받은 업로드는 잠시 뒤 재시도합니다 |
| 메일 분석 차단기 | api `mail/service/MailAnalysisBreaker` | 백필에서 테넌트별 모델 실패가 5회 연속이면 10분 동안 차단하고, 실패한 메일은 30분 동안 건너뜁니다. 연속 실패·열림 상태와 메일별 재시도 대기 표가 파드별이어서 장애 중 다른 파드가 모델을 다시 호출할 수 있습니다 | 수용·문서화 | 백필에 파드별 차단을 적용합니다. 장애 중 모델 호출을 볼 때는 파드별 로그를 함께 확인합니다 |
| 도움말 재색인 | api `help/service/HelpIndexScheduler` | 1분마다 실행을 시도합니다. 마지막 성공 시각은 로컬에 기록하며 성공 뒤 10분 이내에는 재색인을 건너뜁니다 | 수정 | 공유 DB의 ShedLock 최소 유지 시간을 `PT10M`으로 설정해 파드 간 재색인 시작 간격을 최소 10분으로 맞췄습니다. 실패하면 마지막 성공 시각은 갱신되지 않으며 재시도는 실패한 실행이 잠금을 잡은 때부터 최소 10분 뒤에 가능합니다 |
| 첨부 원본 없음 표시 | api `mail/service/MailAttachmentPreviewService` | 원본 없음 표시를 사용자·첨부별로 해당 파드에 10분간 보관합니다. 같은 요청이 다른 파드로 가면 원본 확인을 반복할 수 있습니다 | 수용·문서화 | 파드별 10분 표시를 유지합니다 |
| Wiki·Home·Mail AI 요약 SingleFlight | api `WikiSummaryService`, `HomeContextSummaryService`, `MailAnalysisService`와 `mail/util/SingleFlight` | 중복 실행 방지는 파드별로 동작하므로 파드 간 LLM 호출과 비용이 중복될 수 있습니다. Wiki·Home 요약과 일반 메일 분석은 DB 조건부 저장으로 결과를 보호합니다. 메일의 공용 요약 강제 생성과 개인 요약만 생성하는 경로는 저장 시 이미 요약이 생겼는지 확인하지 않아, 여러 파드가 동시에 생성하면 나중에 저장한 결과가 앞선 결과를 덮어쓸 수 있습니다 | 수용·문서화 | 파드별 중복 방지와 메일 요약의 덮어쓰기 가능성을 수용하고, 확장 뒤 LLM 호출량과 비용을 확인합니다 |
| worker → converter 동시성 | `apps/workplace-worker/app/config.py`, `converter.py` | `WORKER_CONVERTER_CONCURRENCY`의 기본값은 worker 파드당 1건입니다. worker가 늘면 converter에 들어오는 동시 요청도 늘어 포화 시 converter의 429와 worker의 재시도가 증가할 수 있습니다 | 수용·문서화 | 파드별 상한을 유지하고, worker를 늘릴 때 converter의 429와 재시도 횟수를 확인합니다 |
| web 롤아웃 중 해시 에셋 404 | `apps/workplace-web/nginx.conf`, `PersonCardAssignHost.tsx` 등 | `index.html`은 재검증하고 해시가 붙은 에셋은 불변 장기 캐시합니다. 롤아웃 중 구·신 파드가 섞이면 새 index가 참조한 청크를 구 파드에 요청해 404가 날 수 있습니다 | 수용·문서화 | 일부 지연 로딩 창은 청크 로드 실패 시 새로고침을 안내합니다. 동적 import 실패를 전역에서 복구하는 처리는 찾지 못했으므로 사용자가 직접 새로고침해야 할 수 있습니다 |

## 늘리는 순서(권장)

1. `appReplicas` 를 앱별 값으로 나눕니다.
2. 상태가 없거나 「괜찮음」뿐인 앱부터 늘립니다: web · admin · mcp · worker · ai-agent.
3. api 는 「막힘」 세 가지(SSE 중계, 생성 취소, OAuth state)를 고친 뒤 늘립니다. 공유 저장소(Redis)를 들이면 속도 제한·MCP 토큰 캐시도 같은 저장소로 옮길 수 있습니다.
4. collab 은 별도 설계 전까지 1대로 둡니다.

## 바꿀 때 체크리스트

- [ ] 늘릴 앱의 「막힘」 항목을 모두 고쳤다
- [ ] DB 커넥션 합계(`대수 × 풀 크기`)가 `max_connections` 안이다
- [ ] 새 `@Scheduled` 작업에 `@SchedulerLock` 이 붙어 있다
- [ ] 2대로 띄운 격리 스택이나 스테이징에서 실시간 이벤트·AI 답변 취소·메일 계정 연결을 확인했다
- [ ] 이 문서의 표를 새 구성에 맞게 고쳤다
