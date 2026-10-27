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
3. api 는 「막힘」 세 가지(SSE 중계, 생성 취소, OAuth state)를 고친 뒤 늘립니다. 공유 저장소(Redis)를 들이면 속도 제한·MCP 토큰 캐시도 같은 저장소로 옮길 수 있습니다.
4. collab 은 별도 설계 전까지 1대로 둡니다.

## 바꿀 때 체크리스트

- [ ] 늘릴 앱의 「막힘」 항목을 모두 고쳤다
- [ ] DB 커넥션 합계(`대수 × 풀 크기`)가 `max_connections` 안이다
- [ ] 새 `@Scheduled` 작업에 `@SchedulerLock` 이 붙어 있다
- [ ] 2대로 띄운 격리 스택이나 스테이징에서 실시간 이벤트·AI 답변 취소·메일 계정 연결을 확인했다
- [ ] 이 문서의 표를 새 구성에 맞게 고쳤다
