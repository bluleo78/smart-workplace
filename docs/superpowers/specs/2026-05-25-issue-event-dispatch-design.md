# 이슈 도메인 이벤트 → ai-agent 발사 — 설계 (Phase 5b-1)

> issue: #29 (분할 — 5b-1 만 다룸)
> 작성일: 2026-05-25

## 배경

Phase 5a 에서 AGENT 유저·API key 가 완비됐고, ai-agent 스캐폴딩에서
`POST /events` 수신 골격이 마련됐다. 5b-1 은 그 사이를 잇는다 —
이슈 도메인이 변할 때 ai-agent 가 알아챌 수 있도록 도메인 이벤트를
발행하고, AGENT 가 assignee 인 이슈에 한해 ai-agent 로 HTTP POST 한다.

## 분할 — 5b-1 / 5b-2

#29 본문은 4개 이벤트 + `webhook_subscription` 테이블 + HMAC + 재시도 +
관리자 UI 까지 묶여있다. 그러나 현재 컨슈머는 ai-agent 1개고 인증은
Internal token 으로 결정됐다. 외부 3rd-party webhook 일반화는 사용 사례
없음 → YAGNI. 다음과 같이 분할한다.

- **5b-1 (본 spec):** 도메인 이벤트 발행 + ai-agent 로 직접 HTTP POST.
  환경변수로 ai-agent URL/토큰 관리. AGENT assignee 필터. 인메모리
  재시도. 테이블 추가 없음.
- **5b-2 (후속, 필요시):** `webhook_subscription` 테이블, HMAC 서명,
  관리자 UI, 발사 이력. 3rd-party 컨슈머가 진짜 등장할 때.

## 목표

- `IssueCreated` / `IssueAssigned` / `IssueCommented` / `IssueStatusChanged`
  4개 도메인 이벤트를 표준 Spring `ApplicationEventPublisher` 로 발행
- `@TransactionalEventListener(phase = AFTER_COMMIT)` 로 트랜잭션 커밋
  이후에만 발사
- 이슈 assignee 중 AGENT 1명 이상 + actor 가 AGENT 가 아닐 때만 발사
- ai-agent `POST /events` 로 envelope `{type, payload}` 전송
- 실패 시 인메모리 지수 백오프 3회 재시도, 끝나면 에러 로그
- 테이블 추가 0

## 비목표 (YAGNI)

- `webhook_subscription` 테이블 / HMAC 서명 / 관리자 UI / 발사 이력 → 5b-2
- DB outbox / 이벤트 재생 / 영속화 → 5b-2
- Spring Modulith 도입 → 별 epic
- Micrometer 메트릭 / Prometheus → 후속
- Circuit breaker (Resilience4j) → 후속
- 다중 컨슈머 / 컨슈머별 이벤트 필터 → 5b-2
- ai-agent 측 type 별 핸들러 구현 → 5c

## 아키텍처

```
[IssueService / IssueAssigneeService / IssueCommentService]
            │
            │  @Transactional 내부에서 applicationEventPublisher.publishEvent(...)
            ▼
[Spring ApplicationEventPublisher]
            │
            │  @TransactionalEventListener(phase = AFTER_COMMIT)
            ▼
[IssueEventDispatcher (신규)]
            │  1. enabled == false → return
            │  2. AGENT assignee 없음 → return
            │  3. actor.kind == AGENT → self-loop skip
            │  4. envelope 빌드 → AiAgentEventClient.publish(envelope)
            ▼
[AiAgentEventClient (신규, RestClient 래핑)]
            │  POST /events
            │  Authorization: Internal {token}
            │  timeout: connect 2s / read 5s
            │  재시도: 1+3 = 4회, 백오프 1s/2s/4s
            │  4xx (그 외) 즉시 포기, IOException·5xx·408·429 재시도
            ▼
[workplace-ai-agent  POST /events]
```

## 의사결정 요약

| 결정 | 선택 | 이유 |
|---|---|---|
| 이벤트 메커니즘 | Spring `ApplicationEventPublisher` + `@TransactionalEventListener(AFTER_COMMIT)` | DB 커밋 후 발사 → 이중쓰기·롤백 손실 방지. Modulith 도입은 별 epic. |
| 이벤트 4종 | IssueCreated / IssueAssigned / IssueCommented / IssueStatusChanged | #29 본문 그대로 |
| 발사 필터 | 이슈 assignee 중 AGENT 1명 이상 + actor 가 AGENT 면 self-loop 스킵 | noise 차단 + 메아리 차단 |
| 재시도 | 인메모리 지수 백오프 3회 (1s/2s/4s), 끝나면 로그만 | 단순. 프로세스 죽으면 손실 인정 → 5b-2 가 outbox 로 해결 |
| 테이블 추가 | 없음 | YAGNI |
| HTTP 클라이언트 | Spring 6 `RestClient` | 표준, 동기 호출에 충분 |
| 인증 | `Authorization: Internal {token}` | ai-agent 스캐폴딩과 동일. HMAC 은 외부 webhook 시 도입 |

## 신규 컴포넌트

신규 패키지 `com.workplace.issue.outbound`.

| 파일 | 책임 |
|---|---|
| `IssueDomainEvents.java` | 4개 이벤트 record. 도메인 식별자만 담음 (DTO 변환은 dispatcher 가) |
| `IssueEventDispatcher.java` | `@TransactionalEventListener(AFTER_COMMIT)` 4개. 필터 → envelope 빌드 → `AiAgentEventClient` 호출 |
| `AiAgentEventClient.java` | `RestClient` 래핑. POST + Internal token + 재시도. 4xx/5xx 분기 |
| `AiAgentProperties.java` | `@ConfigurationProperties("workplace.ai-agent")` — baseUrl, internalToken, enabled |
| `EventEnvelope.java` | `{type, payload}` record. payload 는 `Map<String,Object>` 또는 도메인별 record |

## 도메인 이벤트 record (시그니처)

```java
public record IssueCreatedEvent(
    long issueId, String projectKey, String issueKey, String title,
    String status, String priority,
    UserSummary actor, List<UserSummary> assignees,
    Instant occurredAt
) {}

public record IssueAssignedEvent(
    long issueId, String projectKey, String issueKey, String title,
    UserSummary actor,
    List<UserSummary> assignees,         // 변경 후 현재
    List<UserSummary> added,
    List<UserSummary> removed,
    Instant occurredAt
) {}

public record IssueCommentedEvent(
    long issueId, String projectKey, String issueKey, String title,
    UserSummary actor, List<UserSummary> assignees,
    long commentId, String commentBody,
    Instant occurredAt
) {}

public record IssueStatusChangedEvent(
    long issueId, String projectKey, String issueKey, String title,
    UserSummary actor, List<UserSummary> assignees,
    String previousStatus, String newStatus,
    Instant occurredAt
) {}
```

`UserSummary` 는 기존 `com.workplace.user.dto.UserSummary` 재사용
(`id, username, name, kind`).

## 발행 지점

| 서비스 | 호출 시점 | 발행 이벤트 |
|---|---|---|
| `IssueService.create()` | 트랜잭션 끝 직전 publish. assignee 가 있으면 IssueAssigned 도 함께 (added=초기 assignee, removed=빈) | IssueCreated, IssueAssigned (조건부) |
| `IssueAssigneeService.replace()` | diff 계산 후 publish (변경 없으면 skip) | IssueAssigned |
| `IssueCommentService.create()` | INSERT 후 publish | IssueCommented |
| `IssueService.updateStatus()` | 상태 변경 후 publish (이전==이후면 skip) | IssueStatusChanged |

## ai-agent 송신 envelope

ai-agent 스캐폴딩이 정의한 envelope:
```json
{ "type": "<event.type>", "payload": { ... } }
```

### type 네이밍 (dotted lowercase)

- `issue.created`
- `issue.assigned`
- `issue.commented`
- `issue.status_changed`

### 공통 payload 필드

| 필드 | 타입 | 비고 |
|---|---|---|
| `projectKey` | string | "WP" |
| `issueKey` | string | "WP-42" |
| `issueId` | number | 내부 PK |
| `issueTitle` | string | 컨텍스트용 (body 는 제외) |
| `actor` | `{id, username, kind}` | 변경 행위자 |
| `assignees` | `[{id, username, kind}]` | 변경 후 현재 assignee |
| `occurredAt` | ISO-8601 string | 이벤트 발생 시각 |

### 이벤트별 추가 필드

`issue.created`:
```json
{ "...common": true, "priority": "NORMAL", "status": "TODO" }
```

`issue.assigned`:
```json
{ "...common": true, "added": [...], "removed": [...] }
```

`issue.commented`:
```json
{ "...common": true, "commentId": 123, "commentBody": "@ai 확인 부탁" }
```

`issue.status_changed`:
```json
{ "...common": true, "previousStatus": "TODO", "newStatus": "IN_PROGRESS" }
```

### 예시

사용자가 "WP-42" 에 AI 를 할당:
```json
{
  "type": "issue.assigned",
  "payload": {
    "projectKey": "WP",
    "issueKey": "WP-42",
    "issueId": 42,
    "issueTitle": "분석 보고서 초안 작성",
    "actor":     {"id": 7,   "username": "bluleo78", "kind": "HUMAN"},
    "assignees": [{"id": 201, "username": "ai-bot",  "kind": "AGENT"}],
    "added":     [{"id": 201, "username": "ai-bot",  "kind": "AGENT"}],
    "removed":   [],
    "occurredAt": "2026-05-25T12:34:56Z"
  }
}
```

## 페이로드 깊이 정책

- 식별자 + 변경 표면 + 최소 컨텍스트만
- body, 첨부, history 같은 큰 필드는 제외 — 5c 에서 ai-agent 가
  workplace-api 를 GET 으로 확장 조회
- `commentBody` 만 예외 — agent 응답 트리거의 핵심 컨텍스트라 포함

## Dispatcher 필터 흐름 (4 핸들러 공통)

```
1. props.enabled == false → return (테스트·로컬 글로벌 off)
2. event.assignees 중 kind == AGENT 가 0명 → return
3. event.actor.kind == AGENT → return (self-loop 차단)
4. envelope 빌드 → aiAgentEventClient.publish(envelope)
```

## HTTP 발사 정책 (`AiAgentEventClient`)

- `RestClient.create(baseUrl).post().uri("/events")`
- 헤더: `Authorization: Internal {token}`, `Content-Type: application/json`
- timeout: connect 2s, read 5s
- 재시도: 시도 1 + 재시도 3회 = 최대 4회 시도, 백오프 1s / 2s / 4s
- 재시도 대상: IOException, 5xx, 408, 429. 4xx (그 외) 는 즉시 포기
- 모두 실패 시: `log.error("ai-agent dispatch failed after retries", { type, issueKey, lastError })`
- 예외는 dispatcher 까지 propagate 하지 않음 (도메인 처리에 영향 0)

재시도 백오프 검증은 단위 테스트에서 1ms 로 override (production 1s/2s/4s).

## Self-loop 차단의 실제 의미

AGENT 가 workplace-api 의 코멘트 추가 API 를 호출하면
`IssueCommentedEvent` 가 발행되지만, actor.kind == AGENT 라 dispatcher 가
스킵 → 자기가 단 코멘트로 자기가 또 깨어나는 무한루프 방지.
5c 에서 ai-agent → workplace-api 호출이 본격화될 때 필수.

## 인증 / 설정

`apps/workplace-api/src/main/resources/application.yml`:
```yaml
workplace:
  ai-agent:
    base-url: ${WORKPLACE_AI_AGENT_URL:http://localhost:7070}
    internal-token: ${WORKPLACE_AI_AGENT_TOKEN:changeme-local}
    enabled: ${WORKPLACE_AI_AGENT_ENABLED:true}
```

`application-test.yml`:
```yaml
workplace:
  ai-agent:
    enabled: false   # 테스트는 dispatcher 단위로 별도 검증, 전역 발사는 off
```

## 관찰성 (최소)

- 성공/실패/스킵 카운트는 `log.info/warn/error`
- 발사 페이로드 전체는 DEBUG 레벨
- Micrometer 메트릭은 후속

## 테스트 — 3 계층

### 1. Dispatcher 단위 (`IssueEventDispatcherTest`)

`AiAgentEventClient` mock. Spring 컨텍스트 없이 순수 JUnit.

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | AGENT assignee 없음 → skip | `client.publish` 미호출 |
| 2 | AGENT assignee 있음, actor=HUMAN → 발사 | 정확한 envelope 으로 1회 호출 |
| 3 | AGENT assignee 있음, actor=AGENT → self-loop skip | 미호출 |
| 4 | enabled=false → skip | 미호출 |
| 5 | 4종 이벤트 모두 type 문자열 정확 | `issue.created` / `issue.assigned` / `issue.commented` / `issue.status_changed` |

### 2. HTTP 클라이언트 단위 (`AiAgentEventClientTest`)

`MockRestServiceServer` (Spring 6 의 `RestClient` 와 호환).

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | 200 응답 → 정상 종료 | 1회 호출, retry 없음 |
| 2 | 첫 500 → 재시도 후 200 | 총 2회 호출 |
| 3 | 4xx (400) → 즉시 포기 | 1회 호출, throw 없음, 에러 로그 |
| 4 | 4번 모두 5xx → 포기 | 4회 호출, throw 없음, 에러 로그 |
| 5 | `Authorization: Internal {token}` 헤더 정확 | 캡처 검증 |
| 6 | body 가 envelope JSON 형태 | 캡처 검증 |

### 3. 통합 (`IssueEventDispatchIntegrationTest`)

`@SpringBootTest` + `MockRestServiceServer` 로 ai-agent 모킹 + 실제 DB
(test profile, port 5435).

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | AGENT 를 assignee 로 한 이슈 생성 → POST 2회 (created + assigned) | 두 envelope 모두 받음, type 정확 |
| 2 | 사람만 assignee 인 이슈 생성 → 0회 | MockServer 호출 없음 |
| 3 | 기존 이슈에 AGENT 추가 → issue.assigned 1회, added 에 AGENT 포함 | payload 정확 |
| 4 | AGENT 담당 이슈에 사람이 코멘트 → issue.commented 1회, commentBody 포함 | payload 정확 |
| 5 | AGENT 담당 이슈에 AGENT 가 코멘트 (5c 흉내) → 0회 (self-loop 차단) | MockServer 호출 없음 |
| 6 | AGENT 담당 이슈 상태 변경 → issue.status_changed 1회, previous/new 정확 | payload 정확 |

> 통합 테스트에서 `workplace.ai-agent.enabled` 는 임시로 true 로 override (test profile 기본은 false).

## 완료 기준 (DoD)

- 4개 도메인 이벤트 record + dispatcher + RestClient + properties 구현
- 4개 서비스가 정확한 시점에 이벤트 발행
- `application.yml` 에 `workplace.ai-agent.*` 3개 속성
- `application-test.yml` 에 `enabled: false`
- 3 계층 테스트 (단위 5 + 클라이언트 6 + 통합 6 = 17개) 모두 통과
- 기존 테스트 회귀 0
- 루트 `pnpm test` (turbo) 통과
- 수동 검증: ai-agent 를 7070 에 띄운 상태에서 workplace-api 로 AGENT
  assignee 이슈 생성 → ai-agent 로그에
  `[events] received { type: issue.assigned ... }` 확인

## 영향 범위

- 추가: `com.workplace.issue.outbound.*` 신규 패키지
- 수정: `IssueService.create`, `IssueService.updateStatus`,
  `IssueAssigneeService.replace`, `IssueCommentService.create`
- 수정: `application.yml`, `application-test.yml`
- DB 마이그레이션: **없음**
- 프론트엔드 (workplace-web): 변경 없음
- ai-agent: 변경 없음 (수신 핸들러는 5c)

## 의존성

- Phase 5a (AGENT 유저 + kind 필드 + API key) — 완료
- workplace-ai-agent 스캐폴딩 (POST /events 수신 골격) — 완료

## 후속

- **Phase 5b-2** (필요 시): webhook_subscription 테이블, HMAC 서명, 관리자 UI, DB outbox
- **Phase 5c**: ai-agent 측 type 별 핸들러 + workplace-api client 메서드 본문 채움

## 커밋

단일 commit, 한국어 메시지:
```
feat(api): 이슈 도메인 이벤트 → ai-agent 발사 — #29 (5b-1)
```
