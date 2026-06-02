# 인박스 / 알림(notify) 설계

> 상태: 승인 대기 (브레인스토밍 산출물)
> 작성일: 2026-06-02
> 범위: 이슈 트래커(작업 관리) 코어의 인앱 알림 인박스. Phase 1(코어+인박스) + Phase 2(@멘션) 단일 스펙, 구현 플랜은 Phase별 분리.

## 1. 목표

로그인 사용자가 "나에게 온 일"을 한곳에서 즉시 보는 **인앱 알림 인박스**. AppRail 상단 종 아이콘 + 안읽음 배지 + 드롭다운 패널. AI 담당자(AGENT)의 활동을 사람의 활동과 동일 피드에 싣되 액터로 구분 표시 — "AI 동료가 일을 진행했다"는 AI Native 차별점을 알림 차원에서 구현한다.

## 2. 트리거 (사용자 선택: 4종)

| 트리거 | 이벤트 소스 | 비고 |
|---|---|---|
| 나에게 배정 | `IssueAssignedEvent` | 새로 추가된 담당자에게 |
| 내 이슈에 활동(코멘트) | `IssueCommentedEvent` | 담당자∪워처에게 |
| 내 이슈에 활동(상태변경) | `IssueStatusChangedEvent` | 담당자∪워처에게 |
| AI 담당자 활동 | (별도 이벤트 아님) | 위 활동 이벤트의 **actor.kind == "AGENT"** 인 경우. 데이터상 별도 트리거가 아니라 액터 facet — UI가 AI 배지로 구분 |
| (Phase 2) 코멘트 멘션 | `MENTIONED` | @멘션 인프라 구축 후 |

핵심: 선택된 4개 트리거를 **3개 기존 이벤트**가 커버한다. "AI 활동"은 알림에 실린 액터 정보로 표현하며 새 이벤트/새 행 종류를 만들지 않는다.

## 3. 아키텍처

**접근법 A — 기존 이슈 도메인 이벤트 재사용** (대안 B: 이슈 서비스에서 직접 호출 → 침습적·이벤트 중복으로 기각. C: 범용 activity 테이블 → YAGNI로 기각).

이미 발행 중인 이슈 도메인 이벤트(`com.workplace.issue.outbound.IssueDomainEvents`)를 새 `notify` 슬라이스가 `@TransactionalEventListener(phase = AFTER_COMMIT)`로 구독한다. chat/messaging의 SSE 디스패처(`ChatSseDispatcher`·`MessageSseDispatcher`)와 동일 패턴.

흐름:
```
이슈 변경 (트랜잭션 커밋)
  → ApplicationEventPublisher 가 IssueAssigned/Commented/StatusChanged 발행
    → NotificationDispatcher (@TransactionalEventListener AFTER_COMMIT, @Async)
      → 수신자 해석 (담당자/워처 조회, actor 제외)
        → NotificationService.createAndFanOut
          → NotificationRepository.insertBatch  (notification 행)
          → SseRegistry.fanOut(recipientIds, "notify.created", payload)
```

기존 재사용 컴포넌트:
- `com.workplace.global.realtime.SseRegistry` — 사용자별 `SseEmitter` 레지스트리. `register(userId)`, `fanOut(userIds, eventName, payload)`, 30s 하트비트 + 1h 타임아웃. **그대로 재사용**, 수정 없음.
- `com.workplace.issue.outbound.IssueDomainEvents` — 이벤트 소스. **읽기만**, 수정 없음.
- `com.workplace.issue.repository.IssueAssigneeRepository.findUserIdsByIssue(issueId)` — 담당자 user_id 목록. 재사용.

도메인 격리 원칙(`apps/workplace-api/CLAUDE.md`): notify는 issue 도메인을 직접 import 하지 않는다 — issue가 발행한 이벤트(이미 `global` 또는 issue.outbound의 공개 record)를 구독한다. 단 수신자 해석에 필요한 경량 조회는 issue 리포 메서드 호출로 한정(이벤트 페이로드가 워처를 싣지 않으므로). 이 의존은 "이벤트 구독 + 읽기 전용 조회"로 제한하고, notify가 issue를 변경하지 않는다.

## 4. 데이터 모델 — `V22__notifications.sql`

```sql
CREATE TABLE notification (
  id            BIGSERIAL PRIMARY KEY,
  recipient_id  BIGINT NOT NULL REFERENCES "user"(id),
  actor_id      BIGINT     REFERENCES "user"(id),   -- 사람/AI 행위자. 시스템이면 null
  type          VARCHAR(32) NOT NULL,               -- ASSIGNED | COMMENTED | STATUS_CHANGED | (P2) MENTIONED
  issue_id      BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  comment_id    BIGINT,                             -- COMMENTED/MENTIONED 시
  read_at       TIMESTAMPTZ,                        -- null = 안읽음
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notification_recipient_created ON notification(recipient_id, created_at DESC);
CREATE INDEX idx_notification_unread ON notification(recipient_id) WHERE read_at IS NULL;
```

- 표시용 이름/제목(액터명·이슈키·이슈제목)은 **읽을 때 issue·user 조인**(jOOQ). 스냅샷 비정규화 안 함 — 변경 추종 + 단순.
- `issue` 삭제 시 알림 CASCADE 삭제.
- 보존 정책: v1 미구현(YAGNI). 향후 created_at 기준 일괄 정리 잡 추가 가능.

### 수신자 해석 규칙

| type | 수신자 | 제외 |
|---|---|---|
| `ASSIGNED` | `IssueAssignedEvent.added` 의 user id | actor 본인(셀프배정) |
| `COMMENTED` | 담당자 ∪ 워처 | actor 본인 |
| `STATUS_CHANGED` | 담당자 ∪ 워처 | actor 본인 |

- 담당자 = `IssueAssigneeRepository.findUserIdsByIssue(issueId)` (또는 이벤트의 `assignees`).
- 워처 = **신규** `IssueWatcherRepository.findUserIdsByIssue(issueId)` — `issue_watcher` 테이블 경량 조회(`IssueAssigneeRepository.findUserIdsByIssue` 패턴 미러). issue 리포지토리 패키지에 추가.
- 중복 억제: 같은 (recipient, issue, type, comment_id)의 짧은 시간 중복 폴딩은 v1 미고려(YAGNI).

## 5. 백엔드 컴포넌트 — `com.workplace.notify` 슬라이스

`messaging` 슬라이스 구조 미러(`controller/service/repository/dto/exception/outbound`).

- **`outbound/NotificationDispatcher.java`** — `@TransactionalEventListener(phase = AFTER_COMMIT)` + `@Async`로 `IssueAssignedEvent`·`IssueCommentedEvent`·`IssueStatusChangedEvent` 수신. 각 이벤트 → 수신자 해석 → `NotificationService.createAndFanOut(type, recipientIds, actorId, issueId, commentId)`.
- **`service/NotificationService.java`** — 수신자 목록 확정(actor 제외, 중복 제거), `NotificationRepository.insertBatch`, `SseRegistry.fanOut(recipientIds, "notify.created", {type, issueId})`. 조회: `listRecent`, `countUnread`, `markRead`, `markAllRead`. 모든 조회/변경은 `recipientId` 스코프.
- **`repository/NotificationRepository.java`** — jOOQ DSLContext:
  - `insertBatch(List<NotificationRow>)`
  - `listRecent(recipientId, limit)` — issue·user(actor) 조인 DTO, created_at DESC
  - `countUnread(recipientId)` — `read_at IS NULL`
  - `markRead(recipientId, id)` — recipient 스코프(타인 알림 변경 차단)
  - `markAllRead(recipientId)`
- **`controller/NotificationController.java`** (`@AuthenticationPrincipal Long callerId`):
  - `GET  /api/v1/notifications?limit=20` → `List<NotificationResponse>`
  - `GET  /api/v1/notifications/unread-count` → `{ "count": n }`
  - `POST /api/v1/notifications/{id}/read` → 단건 읽음(타인 id면 0행 — 204)
  - `POST /api/v1/notifications/read-all` → 모두 읽음
  - `GET  /api/v1/notifications/stream` → `SseRegistry.register(callerId)` (produces `text/event-stream`)
- **`dto/NotificationResponse.java`** — `id, type, actorId, actorName, actorKind, issueId, issueKey, issueTitle, commentId, read(boolean), createdAt`.

엔드포인트는 공개 목록(`/api/v1/auth/**`, health) 외 인증 필요. 알림은 본인 스코프이므로 `@RequirePermission` 대신 `recipientId = callerId` 스코프로 격리(타 사용자 알림 접근 불가).

## 6. 프론트엔드 — `apps/workplace-web`

- **AppRail 상단 종 아이콘 + 안읽음 배지** — `AppRailUserMenu` 인근. `useUnreadCount` 훅(`GET /unread-count`, TanStack Query, 쿼리키 `['notifications','unread-count']`).
- **`InboxPanel`** — shadcn `Popover`(또는 기존 `DropdownMenu` 패턴). 열면 `GET /notifications?limit=20` 평면 목록(쿼리키 `['notifications']`). 각 행: 액터 아바타(`actorKind==='AGENT'`면 AI 배지)·"〈액터〉가 〈동작〉 — 〈issueKey 제목〉"·상대시각·안읽음 점. 헤더 "모두 읽음" 버튼.
- **행 클릭** → 이슈 상세로 `navigate` + `POST /{id}/read`(낙관적 업데이트로 배지/점 즉시 갱신). "모두 읽음" → `POST /read-all` → 두 쿼리 invalidate.
- **`useNotificationStream`** — 앱 셸 마운트 시 `EventSource('/api/v1/notifications/stream')` 연결, `notify.created` 수신 → `['notifications']`·`['notifications','unread-count']` invalidate. 기존 messaging/chat 웹 스트림 클라이언트 패턴 있으면 재사용.
- 빈 목록 → "새 알림이 없습니다". SSE 끊김 → EventSource 자동 재연결 + 재연결 시 invalidate. 401 → 조용히 중단.
- 전용 `/inbox` 페이지는 v1 범위 외. 패널/쿼리 훅은 향후 페이지가 재사용하도록 분리.

## 7. 테스트

**백엔드 JUnit 통합**(`IntegrationTestBase`):
- `NotificationDispatcherTest` — 배정/코멘트/상태변경 이벤트 발행 시 올바른 수신자에게 행 생성, 셀프배정·본인행동 제외, 담당자∪워처 합집합, AGENT 액터 시 actorKind 보존.
- `NotificationServiceTest` — listRecent/countUnread/markRead/markAllRead, recipient 스코프 격리(타인 알림 접근/변경 차단).
- `NotificationControllerTest` — 엔드포인트 인증·페이로드·타인 id 읽음 무영향.
- ⚠️ 공유 test DB 오염 주의: 전역 상태(USER/ROLE) 건드리는 시드는 메서드 `@Transactional` 격리, 검색/매칭은 고유 토큰. (메모: messaging 테스트 비-트랜잭션 사고 참조)

**프론트 Playwright E2E**:
- 배지 카운트 렌더, 패널 목록·빈상태.
- 행 클릭 → 이슈 이동 + 읽음 POST 페이로드 검증(`postDataJSON`/요청 가로채기).
- "모두 읽음".
- SSE `notify.created` 수신 시 배지 증가(EventSource 모킹).

## 8. 단계 분할

- **Phase 1 — notify 코어 + 인박스** (§3–§7 전부): V22 마이그레이션, notify 슬라이스, `IssueWatcherRepository.findUserIdsByIssue` 추가, SseRegistry 재사용, AppRail 종+패널, 3개 트리거(배정·코멘트·상태변경; AI는 액터 facet). **단독 동작·출시 가능.** → 별도 구현 플랜.
- **Phase 2 — @멘션 인프라 + 멘션 트리거**: 코멘트 작성기 `@사용자` 자동완성, 멘션 파싱·저장, 멘션 발생 → `MENTIONED` 알림(Phase 1 파이프라인에 트리거 1종 + 수신자=피멘션자 추가). → 별도 스펙 보강 또는 별도 플랜.

## 9. 범위 외 / 비목표 (v1)

- 전용 `/inbox` 페이지, 이슈별 묶음(aggregation), 알림 중복 폴딩.
- 이메일/푸시 등 인앱 외 채널.
- 알림 환경설정(트리거 on/off), 보존/정리 잡.
- 멀티노드 SSE(현재 `SseRegistry`는 인메모리 단일노드 — 기존 messaging/chat과 동일 한계 승계).
