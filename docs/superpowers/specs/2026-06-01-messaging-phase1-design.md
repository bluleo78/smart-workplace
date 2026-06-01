# Messaging (팀/DM 채팅) — Phase 1 설계

- 작성일: 2026-06-01
- 상태: 설계 승인 완료 → 구현 플랜 작성 대기
- 도메인: `com.workplace.messaging` (신설)

## 배경 / 목적

Smart Workplace는 "AI Native 워크플레이스"이며, 현재는 AI를 Assignee로 둘 수 있는 이슈 트래커가 v1이다.
앱 레일의 **Chat 모듈은 `SOON`(비활성)** 상태로, 사람-사람/팀 채팅(Slack류)이 아직 없다.

> 비활성 위치: `apps/workplace-web/src/components/layout/AppRail.tsx` 의 `SOON` 배열.

본 작업은 **팀/DM 채팅(Slack류)** 을 단계적으로 추가한다. 최종 목표 범위는 사용자가 확정했다:

- 공개 + 비공개 채널 + 1:1 / 그룹 DM
- 멘션(@user), 쓰레드 답글, 이모지 리액션, 파일 첨부
- 실시간 전송, 메시지 수정/삭제
- **AI 에이전트도 채널 멤버**로 참여

범위가 넓어 단일 구현 플랜으로는 부적합하다. 따라서 sub-project로 분할하고, **본 문서는 Phase 1(수직 슬라이스)만 상세 설계**한다.

## 기존 자산과의 관계 (중요)

코드베이스에는 이미 `com.workplace.chat` 모듈이 있으나, 이는 **이슈에 종속된 토론 스레드**다 (`chat_thread.issue_id NOT NULL UNIQUE ON DELETE CASCADE`, 스키마 `V16__chat.sql`). 일반 채널/DM이 아니다.

선택한 접근은 **B: 새 도메인 + 인프라 공유**다.

- 이슈 채팅(`chat`)은 **그대로 둔다** — 마이그레이션 리스크 0.
- 새 `messaging` 도메인에 `channel` / `message` 테이블을 신설한다.
- 진짜 재사용 가능한 인프라(SSE 레지스트리·디스패처)는 **공용으로 추출**해 양쪽이 공유한다.
- 멘션 파서(`ChatMentionParser`)·유저 하이드레이터(`ChatUserHydrator`)는 Phase 4(멘션)에서 추출/공유.

검토했으나 채택하지 않은 대안:
- **A. 기존 `chat_thread` 일반화** — 재사용 최대지만 운영 중인 이슈 채팅을 건드리는 마이그레이션 리스크. 기각.
- **C. 코어 `thread` 모듈 추출** — 장기적으로 가장 깔끔하나, 두 모델이 실제로 같은지 미증명 상태에서 추출하면 틀린 추상에 갇힐 위험. v1엔 과투자. 기각(단, 아래 "Future" 절 참조).

### 네이밍

기존 `com.workplace.chat`은 사실상 "이슈 토론"이다. 새 기능도 "chat"이라 모호하다.
→ 신규 도메인은 **`messaging`** (channel / message)으로 명명해 충돌을 피한다. 프론트 라우트는 사용자 대면 용어로 `/chat`을 사용한다.

## Future: thread 모듈로의 수렴 경로 (설계 의도 기록)

B는 통합 가능성을 닫는 선택이 아니라, 통합으로 가는 안전한 경로다. 두 레벨로 수렴한다.

1. **인프라 레벨 (Phase 1에서 시작)** — SSE 레지스트리·디스패처를 공용 추출하는 순간, 이슈 채팅과 messaging은 같은 실시간 인프라를 공유한다. 멘션 파서·유저 하이드레이터는 Phase 4에서 합류.
2. **도메인 모델 레벨 (선택적, 후속)** — `channel`과 `chat_thread`가 "메시지가 흐르는 컨테이너"로 같은 모양임이 messaging의 채널/DM/AI멤버 구현을 통해 증명되면, 코어 `thread` 모듈로 흡수하는 리팩터링이 가능하다 (이슈 채팅 = `kind=ISSUE` 채널의 특수 케이스).

**지금 C를 하지 않는 이유**: 공통 추상이 아직 증명되지 않았다. 증거가 쌓인 뒤 통합한다. "공통 인프라는 즉시 공유, 도메인 통합은 후속" 입장.

## 단계 분할 (전체 로드맵)

| Phase | 범위 | 핵심 산출물 |
|---|---|---|
| **1 (본 문서)** | 수직 슬라이스: 공개 채널 + 메시지 전송/수신 + SSE 실시간 + 멤버십 | `messaging` 도메인 골격 + 공용 SSE 인프라 추출 검증 |
| 2 | 비공개 채널(초대제) + 채널 CRUD/탐색 | visibility, 채널 관리 UI |
| 3 | 1:1 DM + 그룹 DM | `kind=DM`, 멤버 기반 dedup |
| 4 | 멘션(@user) + 메시지 수정/삭제 + 읽음/안읽음 | 멘션 파서 공용화, `last_read` |
| 5 | 쓰레드 답글 + 이모지 리액션 | `parent_message_id`, reaction 테이블 |
| 6 | 파일 첨부 | core file 모듈 연계 |
| 7 | **AI 채널 멤버** | `actor=AI` 실제 참여, ai-agent 연동 |

`actor = USER | AI`는 **Phase 1 스키마에 미리 반영**한다(구현은 Phase 7). 사용자의 "AI도 채널 멤버" 선택을 비전으로 유지하되 통합은 후순위로 둔다.

---

# Phase 1 상세 설계

## 범위

**포함**: 공개 채널(`kind=CHANNEL`, `visibility=PUBLIC`) / 메시지 전송·조회(히스토리 페이지네이션) / SSE 실시간 수신 / 멤버십(참여) / 공용 SSE 인프라 추출.

**제외 (후속 페이즈)**: 비공개·DM / 멘션 / 수정·삭제 / 쓰레드 / 리액션 / 첨부 / AI 실제 참여 / presence·타이핑 인디케이터(SSE 단방향 한계).

## 아키텍처

### 백엔드 — `com.workplace.messaging`
```
messaging/
  controller/   ChannelController, MessageController, MessageStreamController
  service/      ChannelService, MessageService, ChannelMembershipService
  repository/   ChannelRepository, MessageRepository, ChannelMemberRepository
  dto/          ChannelResponse, MessageResponse, MessagePage,
                CreateMessageRequest, CreateChannelRequest(최소)
  exception/    ChannelNotFoundException, ChannelNotMemberException
```

### 공용 SSE 인프라 추출
기존 `chat/outbound`의 `ChatSseRegistry` / `ChatSseDispatcher`를 도메인 비종속 형태로 추출(예: `com.workplace.core.realtime` 또는 공용 패키지). 키를 "thread/channel 식별자 + 멤버 식별자"로 일반화. 이슈 채팅과 messaging이 동일 컴포넌트를 사용.
- 추출은 **리팩터링이며 기존 이슈 채팅 동작을 변경하지 않는다** (기존 SSE 통합 테스트가 회귀 가드).

### 스키마 — `V18__messaging.sql` (신설, 기존 테이블 무손상)
```sql
CREATE TABLE channel (
  id          BIGSERIAL PRIMARY KEY,
  kind        VARCHAR(16) NOT NULL,          -- Phase 1: 'CHANNEL'
  name        VARCHAR(80),                   -- 채널명 (DM은 후속에서 NULL 허용)
  visibility  VARCHAR(16) NOT NULL,          -- Phase 1: 'PUBLIC'
  created_by  BIGINT NOT NULL REFERENCES "user"(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE channel_member (
  channel_id            BIGINT NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  actor_type            VARCHAR(8) NOT NULL,  -- 'USER' | 'AI' (Phase 1: 'USER'만)
  actor_id              BIGINT NOT NULL,
  last_read_message_id  BIGINT,
  joined_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, actor_type, actor_id)
);
CREATE INDEX idx_channel_member_actor ON channel_member(actor_type, actor_id);

CREATE TABLE message (
  id          BIGSERIAL PRIMARY KEY,
  channel_id  BIGINT NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  author_type VARCHAR(8) NOT NULL,           -- 'USER' | 'AI' (Phase 1: 'USER'만)
  author_id   BIGINT NOT NULL,
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at   TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX idx_message_channel_created ON message(channel_id, created_at DESC, id DESC);
```
Phase 1은 `kind=CHANNEL` / `visibility=PUBLIC` / `actor_type=USER`만 사용한다. 나머지 값은 후속 페이즈 대비 자리.

### 프론트엔드 — `/chat` 라우트 + 모듈 레이아웃
```
pages/chat/        ChannelListPage(빈 상태/안내), ChannelPage(메시지 뷰)
components/chat/    ChatModuleLayout(2차 사이드바=채널 목록),
                    ChannelSidebar, MessageList, MessageComposer
hooks/             useMessageStream (기존 useChatStream 패턴 차용)
api/               messaging.ts
types/             messaging.ts (백엔드 DTO와 1:1)
```
- `App.tsx`에 `ChatModuleLayout`으로 감싼 `/chat`, `/chat/channels/:id` 라우트 추가 (React.lazy).
- `AppRail.tsx`에서 `Chat`을 `SOON` → `MODULES`로 승격.
- 기존 패턴 준수: TanStack Query(읽기/쓰기), Axios `/api/v1`, `handleApiError()`+Sonner, 한국어 주석.

## API (Phase 1)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/v1/channels` | 내가 멤버인 채널 + (Phase 1) 공개 채널 목록 |
| POST | `/api/v1/channels` | 공개 채널 생성(최소) |
| POST | `/api/v1/channels/{id}/join` | 공개 채널 참여(멱등) |
| GET | `/api/v1/channels/{id}/messages?cursor=&limit=50` | 히스토리(최신순, 커서 페이지네이션) |
| POST | `/api/v1/channels/{id}/messages` | 메시지 전송 `{ body, clientId }` |
| GET(SSE) | `/api/v1/channels/{id}/stream` | 실시간 구독 |

**SSE 이벤트 envelope** (확장 가능 구조):
```json
{ "type": "message.created", "channelId": 1, "message": { /* MessageResponse */ } }
```
`type`을 두어 후속(`message.updated`, `message.deleted`, `reaction.added` …)을 같은 스트림으로 확장.

## 데이터 흐름

**1) 메시지 전송 — 낙관적 업데이트 + SSE 정합**
- 클라가 임시 `clientId`로 낙관적 렌더 → `POST .../messages { body, clientId }`.
- 서버: 멤버십 검증 → `message` INSERT → `@TransactionalEventListener(AFTER_COMMIT)`로 `MessageCreatedEvent` 발행 → 공용 `SseDispatcher`가 채널 멤버 전원에 fan-out.
- 발신자: 응답/SSE의 실제 `id`가 도착하면 `clientId` 매칭으로 dedup 교체. 수신자: SSE `message.created` → MessageList append.
- AFTER_COMMIT 발행이라 롤백 시 유령 이벤트 없음.

**2) 채널 진입 — 히스토리 + 스트림**
- ChannelPage 마운트 → **구독을 먼저 열고**(SSE) 히스토리 GET → id 기준 병합으로 갭/중복 해소 → 상단 스크롤 시 cursor로 이전 페이지 무한 로드.

**3) 채널 목록 (사이드바)**
- ChatModuleLayout 마운트 → `GET /api/v1/channels`. Phase 1은 공개 채널 전부 노출 + "참여" 액션으로 멤버십 생성.

## 에러 처리

**백엔드** (`ErrorResponse` + `@RestControllerAdvice`, 기존 패턴):
| 상황 | 응답 |
|---|---|
| 비멤버가 전송/조회 | 403 `ChannelNotMemberException` |
| 없는 채널 | 404 `ChannelNotFoundException` |
| body 길이 위반(1~4000) | 400 (Bean Validation) |

`messaging/exception`은 기존 `chat`의 예외 계층과 동형으로 신설.

**SSE 연결 관리**:
- 클라: 끊김 → 자동 재연결(기존 `useChatStream` 재시도 차용). 재연결 시 마지막 수신 id 이후를 히스토리 API로 백필 → 다운타임 갭 복구.
- 서버: emitter `onCompletion`/`onTimeout`/`onError` 시 레지스트리 정리(공용 인프라 처리).

**프론트**:
- mutation 실패 → 낙관적 메시지 롤백 + `handleApiError()` → Sonner 토스트.
- 히스토리 로드 실패 → 재시도 버튼 있는 에러 상태.

## 테스트

**백엔드 — JUnit 통합 테스트** (test DB:5435):
- 메시지 전송 → DB 저장 + 응답 검증
- 비멤버 전송/조회 → 403
- 채널 참여 → 멤버십 생성 + 멱등성(중복 참여)
- 히스토리 커서 페이지네이션 정렬/경계
- SSE: 멤버 구독 중 전송 시 이벤트 수신 (기존 `chat` SSE 통합 테스트 패턴 차용)
- 멤버십 검증과 AFTER_COMMIT 이벤트 순서 정합
- **회귀 가드**: SSE 인프라 추출 후 기존 이슈 채팅 SSE 테스트 그린 유지

**프론트 — Playwright E2E** (API/SSE 모킹, `page.route()`):
- 채널 진입 → 히스토리 렌더(셀 단위 검증)
- 메시지 입력 → POST payload 검증 → 낙관적 표시 → SSE 도착 시 dedup 교체
- 수신: SSE `message.created` 주입 → MessageList append
- 비멤버/에러 응답 → 토스트
- AppRail에서 Chat 진입 → `/chat` 라우팅
- `@smoke`: 채널 진입 + 메시지 1건 전송

## 비목표 (Phase 1)
- presence / 타이핑 인디케이터 (SSE 단방향 한계 — 약속하지 않음)
- 비공개·DM, 멘션, 수정·삭제, 쓰레드, 리액션, 첨부, AI 실제 참여 (각 후속 페이즈)
