# Phase 6b: chat 실시간 (in-API SSE) 설계 (#37)

작성일: 2026-05-30
대상 이슈: [#37](https://github.com/bluleo78/smart-workplace/issues/37) (epic: workplace-channel 실시간 서비스)
부모 epic: chat (#21)
선행: [Phase 6a chat 백엔드 (#36)](2026-05-29-phase6a-chat-backend-design.md)

## 목표

chat thread 의 메시지/타이핑/읽음 이벤트를 폴링 없이 즉시 전달한다. 현재 프론트는 chat 섹션이 보일 때 5초 간격으로 폴링하는데, 이를 서버 push 로 대체한다.

## 이슈 #37 원안과의 차이 — 별도 서비스 → in-API SSE

이슈 #37 은 **신규 서비스 `workplace-channel` + WebSocket** 을 전제로 작성됐다. 설계 과정에서 단일 노드 MVP 범위를 다시 따져 **workplace-api 내장 + SSE** 로 방향을 전환했다. 근거:

1. **이벤트가 이미 in-process** — chat 메시지 생성 이벤트(`ChatMessageCreatedEvent`)가 같은 JVM 안에서 `@TransactionalEventListener(AFTER_COMMIT)` 으로 발행된다. WebSocket 핸들러를 같은 앱에 두면 api→channel 전송 계층(HTTP/Redis pub-sub)이 통째로 사라진다.
2. **sibling 선례** — `smart-fire-hub` 는 별도 실시간 서비스 없이 **firehub-api 안에서 SSE** 로 처리한다 (`GET /api/v1/notifications/stream`, in-process `@EventListener` + in-memory `SseEmitterRegistry`, Redis·STOMP broker 없음). 검증된 패턴을 재사용한다. (참고: `firehub-channel` 은 이름과 달리 실시간이 아니라 외부 채널 연동(Slack/이메일/카카오)용.)
3. **chat 은 진짜 양방향이 불필요** — 보내기는 이미 REST POST 다. 서버→클라 push 만 있으면 되고, typing/read 의 클라→서버는 경량 REST POST 로 처리한다. WebSocket 의 양방향성은 잉여.
4. **별도 서비스의 비용은 정작 Out of Scope** — 커넥션 격리/scale-out 이 별도 서비스의 이점이지만 멀티노드는 이슈에서 명시적으로 Out of Scope.

별도 서비스 분리는 멀티노드가 실제 필요해질 때, 이 in-process 이벤트를 Redis pub/sub 로 바깥에 흘려 자연스럽게 떼어낸다(후속). 이 방향 전환은 이슈 코멘트에도 남긴다.

## 비목표 (Out of Scope)

- 멀티노드 scale-out / Redis pub/sub / sticky session
- 전체-thread catch-up, 메시지 ACK / 정확히-1회 전달 보장
- 브라우저 push notification (백그라운드 알림)
- presence(온라인 여부) — typing 외
- AI 응답 흐름 (#6c — 본 작업은 SSE fan-out 까지)
- WebSocket / Socket.IO / STOMP

## 구독 모델 — 유저 단위 글로벌 스트림

유저당 SSE 스트림 1개로 그 유저가 멤버인 **모든 thread** 이벤트를 수신한다 (firehub 정합 + 교차 unread 미래 대비). thread 단위 스트림 대신 유저 단위를 택한 trade-off: 교차-thread unread/알림 UI 로 확장하기 쉬운 대신, 재연결 catch-up 범위가 넓어진다(아래 Catch-up 절에서 MVP 범위를 좁힘).

## 아키텍처

별도 서비스 없음. workplace-api(9090) 의 `com.workplace.chat` 모듈에 추가한다.

```
클라(fetch+ReadableStream) ──GET /api/v1/chat/stream (Bearer JWT)──▶ workplace-api
                                                                      │ register(userId) → SseEmitter
chat write (REST POST) ─▶ service ─publishEvent─▶ @TxnListener(AFTER_COMMIT)
                                                   ChatSseDispatcher
                                                   └─ thread 멤버 조회 → 연결된 멤버 emitter 로 send
```

### 인증

- SSE 연결은 기존 JWT(`Authorization: Bearer {access}`, HS384) 를 그대로 재사용한다. 기존 `JwtAuthenticationFilter` 가 검증, `SecurityContext.principal = userId`.
- native `EventSource` 는 커스텀 헤더를 못 싣으므로 프론트는 firehub 처럼 `fetch + ReadableStream` 으로 연결한다.
- access token 은 메모리 보관·30분 만료. SSE 핸드셰이크 시점에만 인증하므로 장수명 스트림이 토큰 만료를 넘길 수 있는데, **emitter timeout(~1h, firehub 값)** 으로 연결을 주기적으로 재활용 → 재연결 시 fresh 토큰으로 재인증되는 구조로 경계를 둔다. 별도의 단명 WS 토큰 endpoint 는 도입하지 않는다.

## 백엔드 컴포넌트 (chat 모듈에 추가)

### `ChatStreamController`

```
GET /api/v1/chat/stream
Accept: text/event-stream
Authorization: Bearer {access}

Response: SseEmitter (text/event-stream)
```

- 인증된 유저의 SseEmitter 를 `ChatSseRegistry.register(userId)` 로 등록해 반환.
- 권한: 인증된 본인 스트림이면 허용(별도 permission 불필요).

### `ChatSseRegistry`

- 저장소: `ConcurrentHashMap<Long userId, CopyOnWriteArrayList<SseEmitter>>` (유저당 멀티 기기/탭 허용).
- `register(userId)`: timeout 지정한 `SseEmitter` 생성, `onCompletion`/`onTimeout`/`onError` 에서 자기 자신 제거.
- heartbeat: 30초 주기 SSE comment 핑(`: ping`)으로 죽은 연결 감지·정리.
- emitter timeout: ~1h.
- `fanOut(Collection<Long> userIds, String eventName, Object payload)`: 연결된 유저에게만 `SseEmitter.event().id(...).name(eventName).data(json)` 전송. send 실패한 emitter 는 complete 처리 후 제거(클라 재연결로 복구).

### `ChatSseDispatcher`

- **새** `@TransactionalEventListener(phase = AFTER_COMMIT)`. 기존 `ChatEventDispatcher`(AGENT 멘션 시에만 ai-agent 로 발사)와 **완전히 분리** — SSE fan-out 은 멘션 필터를 거치지 않고 **모든 메시지를 thread 전 멤버**에게 보낸다. 기존 dispatcher 코드는 건드리지 않는다.
- 각 이벤트 수신 시 thread 멤버를 조회(`SELECT user_id FROM chat_thread_member WHERE thread_id = ?`)해 `ChatSseRegistry.fanOut(...)` 호출.
- fan-out 은 best-effort: 실패해도 도메인 트랜잭션(이미 커밋됨)에 전파하지 않는다(기존 `AiAgentEventClient`·firehub 패턴).

## 이벤트 표면

기존 `ChatMessageCreatedEvent` 만 발행 중이다. 나머지는 신규 추가한다.

| SSE event name | 발행 지점 | 수신 대상 | 비고 |
|---|---|---|---|
| `chat.message.created` | 기존 `ChatMessageCreatedEvent` 재사용 | thread 전 멤버 (발신자 본인 포함) | 본인 포함 → 멀티기기 동기화, 프론트가 messageId 로 optimistic dedup |
| `chat.message.updated` | edit 서비스 메서드에 신규 이벤트 추가 | thread 전 멤버 | `edited_at` 포함 |
| `chat.message.deleted` | delete(soft) 서비스 메서드에 신규 이벤트 추가 | thread 전 멤버 | soft-delete 표식 |
| `chat.thread.read` | 기존 `POST /chat/threads/{id}/read` 에서 신규 이벤트 발행 | **타 멤버 + 본인 타기기** (self-echo 아님) | `userId`, `lastReadMessageId` |
| `chat.thread.typing` | **신규** `POST /chat/threads/{id}/typing` (DB 저장 X, transient) | 타 멤버 | 클라 debounce(~3s) + 클라측 TTL(~5s) |

신규 이벤트 record 들은 `ChatDomainEvents` 에 추가한다. 각 SSE 페이로드는 `threadId` 를 포함해 클라가 어느 thread 의 이벤트인지 라우팅할 수 있게 한다.

### `POST /chat/threads/{id}/typing` (신규)

```
POST /api/v1/chat/threads/{id}/typing
Authorization: Bearer {access}
Response: 204 No Content
```

- DB 변경 없음. transient `ChatThreadTypingEvent` 발행만. 권한: thread 멤버.

## 프론트엔드 (workplace-web)

### `useChatStream` (앱 레벨, 인증 후 1회 연결)

- `fetch('/api/v1/chat/stream', { headers: { Authorization: Bearer, Accept: text/event-stream }, signal })` + `response.body.getReader()` + `TextDecoder` 로 SSE 프레임(`id:`/`event:`/`data:`/`: ping`) 파싱.
- 이벤트 → react-query 캐시 갱신:
  - `chat.message.created` → 해당 `threadId` 의 `useChatMessages` 캐시에 append, optimistic 메시지를 messageId 로 dedup/치환.
  - `chat.message.updated` / `chat.message.deleted` → 캐시 패치.
  - `chat.thread.read` → 해당 멤버 `lastReadMessageId` 갱신(읽음 표시).
  - `chat.thread.typing` → transient UI 상태(`"X 입력 중…"`), 클라측 TTL 로 소멸.
- 재연결: 지수 백오프(max 60s), 성공 시 리셋. 401 → 기존 `client.ts` 인터셉터로 토큰 refresh 후 재연결.

### 폴링 제거

- `useChatMessages` 의 `refetchInterval: 5000` 삭제. SSE 주도로 전환.

### 타이핑 송신

- 입력 중 debounce(~3s 간격)로 `POST /chat/threads/{id}/typing`.

## Catch-up (누락 메시지)

글로벌 스트림이라 재연결 시 *임의의* thread 에서 누락이 발생할 수 있고, `fetch + ReadableStream` 은 `Last-Event-ID` 자동 replay 가 없다. MVP 범위를 명확히 좁힌다:

- **(재)연결 시: 현재 열린 thread 만** 마지막 message id 이후를 기존 cursor REST(`GET /chat/threads/{id}/messages`)로 refetch — 이슈의 "마지막 message_id 기반 REST 폴백" 기준을 사용자가 보는 화면에 대해 충족.
- 백그라운드 thread 는 **열 때** react-query refetch 로 자연 정합.
- 전체-thread catch-up 은 MVP 에서 만들지 않는다.

## 에러 처리 / 안정성

- emitter send 실패 → 해당 emitter complete·제거, 클라 재연결로 복구.
- heartbeat(30s)로 죽은 연결 감지·정리.
- fan-out best-effort, 도메인 트랜잭션에 전파 안 함.
- 전달 보장 모델: SSE 자체는 at-most-once. 유실 안전망 = 재연결 catch-up.

## 테스트

### 백엔드 (JUnit 통합)

- `chat/stream` 구독 → 메시지 POST → emitter 가 `chat.message.created` 수신.
- 비멤버는 해당 thread 이벤트를 받지 않음.
- `chat.thread.read` / `chat.thread.typing` fan-out 이 타 멤버에게 전달, read 는 본인 타기기에도 전달.
- AGENT 멘션 메시지: 기존 ai-agent 발사(`ChatEventDispatcher`)와 신규 SSE(`ChatSseDispatcher`)가 **둘 다** 동작(분리 검증).

### 프론트 (Playwright E2E)

- 두 브라우저 컨텍스트가 같은 이슈 chat → 한쪽 작성 → 다른 쪽이 폴링 없이 즉시 수신.
- 연결 끊김 후 자동 재연결 + 현재 thread catch-up.
- typing 표시 / 읽음 표시 갱신.

## 완료 기준 (이슈 #37 매핑)

- ✅ 두 클라이언트가 동일 thread → 한쪽 작성 → 다른 쪽 즉시 수신 (SSE).
- ✅ 연결 끊김 후 자동 재연결 + 누락 메시지 REST catch-up (현재 thread 범위).
- ✅ workplace-api 재시작 시 클라이언트 자동 재연결 (백오프).
