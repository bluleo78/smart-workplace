# Messaging Phase 3 — 1:1 DM + 그룹 DM 설계

> Phase 2(비공개 채널 + 채널 CRUD/탐색)의 후속. 로드맵상 Phase 3.
> 선행 설계: [2026-06-01-messaging-phase1-design.md](2026-06-01-messaging-phase1-design.md), [2026-06-02-messaging-phase2-design.md](2026-06-02-messaging-phase2-design.md)
> 출처: phase1 §단계 분할 — "3 | 1:1 DM + 그룹 DM | kind=DM, 멤버 기반 dedup"

## 배경 & 목표

Phase 1·2 는 채널(`kind='CHANNEL'`) — 공개/비공개, CRUD, 탐색, 멤버 역할 — 을 제공한다. Phase 3 은 **다이렉트 메시지**(`kind='DM'`)를 도입한다:

- **1:1 DM** — 두 사용자 간 대화. 정렬된 멤버 조합으로 dedup(같은 상대와의 대화는 항상 하나).
- **그룹 DM** — 본인 포함 최대 8인. **불변 멤버십**(생성 후 추가/제거 없음). 멤버셋으로 dedup.
- DM 목록/생성 + 메시지 송수신(기존 메시지 API·SSE 재사용), 사이드바에 DM 섹션 분리.

**설계 원칙**: DM 은 별도 도메인이 아니라 `kind='DM'` 채널이다. `channel`/`channel_member`/`message` 테이블, `SseRegistry`, 메시지 REST/SSE, 권한 헬퍼를 전면 재사용한다. 1:1 은 "타겟 1명인 그룹 DM" 의 특수 케이스로 통합 처리한다.

## 비목표 (Phase 3)

- **신규 DM 의 cross-user 실시간 사이드바 등장** — Phase 2 정책 계승. 첫 DM 은 수신자가 새로고침/재진입 시 노출(메시지 SSE 는 평면 per-user 스트림으로 도착하나, 그 시점에 DM 이 수신자 목록에 아직 없음).
- 읽음/안읽음(`last_read`)·멘션 (Phase 4)
- 그룹 DM **멤버 변경**(불변 — 멤버 추가 = 새 대화)
- DM **숨기기/닫기** (YAGNI — 한 번 생성된 DM 은 사이드바에 상주)
- DM 메시지 수정/삭제(Phase 4), 쓰레드·리액션(Phase 5), 파일(Phase 6), AI 멤버(Phase 7)
- DM 의 이름·아카이브·역할 관리(DM 엔 해당 개념 없음)

---

## 데이터 모델

### 스키마 변경 — `V22__messaging_dm.sql`

```sql
-- DM 정체성: 정렬된 참여자 ID 조합을 정규화 키로 저장 (DM 전용; 채널은 NULL)
ALTER TABLE channel ADD COLUMN member_key VARCHAR(255);

-- 멤버셋 dedup + 동시 생성 레이스 방지를 DB 가 보장 (kind='DM' 행만 유니크)
CREATE UNIQUE INDEX uq_channel_dm_member_key ON channel (member_key) WHERE kind = 'DM';
```

- `kind`, `visibility`, `name`(nullable), `created_by`, `archived_at` 컬럼은 **기존 스키마에 이미 존재** → 신규는 `member_key` 뿐.
- DM 행: `kind='DM'`, `visibility='PRIVATE'`, `name=NULL`, `member_key`=정렬된 참여자 ID 를 `,` 로 join(예: `"3,7,12"`). 채널 행: `member_key=NULL`.

### 불변식

- **DM 의 정체성 = `member_key`**. 불변 멤버십이 `member_key` 를 안정적으로 유지 → 단일 인덱스 equality 조회로 dedup, 유니크 인덱스로 동시 생성 레이스 차단.
- DM 멤버는 전원 `role='MEMBER'`. OWNER/관리 개념 없음(소유권·아카이브·이름변경 불가).
- DM 멤버는 변경 불가(추가/제거/나가기 없음). 멤버를 바꾸려면 새 DM 을 시작한다(다른 `member_key` → 다른 대화).

---

## 권한 모델

DM 은 참여자 한정. 채널의 역할/관리 권한 경로(OWNER/ADMIN, requireManage/requireOwner)는 DM 에 **적용하지 않는다**.

| 동작 | 참여자 | 비참여자 |
|---|:---:|:---:|
| DM 생성(find-or-create) | — | 인증된 누구나(본인이 참여자가 됨) |
| DM 목록 조회 | 본인 DM 만 | — |
| DM 상세·메시지 조회/전송 | ✓ | **404**(존재 은닉, `ChannelNotFoundException` 재사용) |

- DM 상세/메시지는 기존 `requireMember(channelId, callerId)` 만 사용. 비멤버는 비공개 채널과 동일하게 404.
- DM 채널은 `discover` 결과·채널 사이드바에 **절대 미포함**(아래 §백엔드 변경 참조).

---

## 백엔드 설계

### find-or-create 알고리즘 — `DmService.createOrGet`

`createOrGet(callerId, List<Long> targetUserIds)`:

1. **검증**:
   - `targetUserIds` 비어있지 않음 → 비면 `400`(`InvalidDmRequestException`).
   - caller 와 중복 제거: `members = distinct({callerId} ∪ targetUserIds)`.
   - self-only 거부: `members.size() < 2` → `400`(자기 자신과의 DM 불가).
   - 본인 포함 **≤ 8**: `members.size() > 8` → `400`.
   - 전원 실재 유저: 존재하지 않는 userId 포함 시 `400`.
2. `memberKey = members.sorted().map(String::valueOf).join(",")`.
3. `channelRepo.findDmIdByMemberKey(memberKey)` → 존재하면 `findDmDetail` 로 `DmResponse` 반환(idempotent, HTTP 200).
4. 없으면 한 `@Transactional` 안에서:
   - `channelRepo.insertDm(memberKey, callerId)` (kind='DM', visibility='PRIVATE', name=null).
   - 각 member 를 `memberRepo.add(channelId, userId, "MEMBER")`.
   - `findDmDetail` 로 신규 `DmResponse` 반환(HTTP 201).
5. 유니크 인덱스 위반(`DuplicateKeyException` — 동시 생성 레이스) → catch 후 `findDmIdByMemberKey` 재조회하여 기존 DM 반환(200).

### 기존 코드 변경 (회귀 방지)

- **`ChannelRepository.findMyChannels` 에 `kind = 'CHANNEL'` 필터 추가**. 현재는 `kind` 필터가 없어, caller 가 멤버인 DM 행이 Phase 2 채널 사이드바에 이름 없는 항목으로 새어 들어간다. 채널 목록은 채널만 반환하도록 명시 제한.
- `searchDiscoverable` 는 이미 `visibility='PUBLIC'` 필터로 DM(PRIVATE)을 배제하므로 변경 불필요(확인용 테스트만 추가).

### 신규 서비스 — `DmService`

- `DmResponse createOrGet(long callerId, List<Long> targetUserIds)` — 위 알고리즘.
- `List<DmResponse> listMyDms(long callerId)` — caller 가 멤버인 `kind='DM'` 채널, 각 DM 의 **참여자 동봉**, 최근 메시지 시각 내림차순 정렬.

`MessageService`(전송/조회)·SSE 디스패처는 **무변경** 재사용. DM 채널 id 로 기존 `/channels/{id}/messages` 호출.

### 리포지토리 추가 메서드 — `ChannelRepository`

- `Optional<Long> findDmIdByMemberKey(String memberKey)` — `kind='DM' AND member_key=?` 단일 조회.
- `long insertDm(String memberKey, long createdBy)` — `kind='DM', visibility='PRIVATE', name=NULL, member_key=?`.
- `Optional<DmResponse> findDmDetail(long channelId, long callerId)` — caller 가 멤버인 DM 1건(참여자 동봉, 비멤버는 empty).
- `List<DmResponse> findMyDms(long callerId)` — caller 가 멤버인 DM 목록. 참여자(`channel_member` JOIN `"user"`: userId,name,kind)와 `lastMessageAt`(message MAX(created_at)) 동봉. **N+1 회피**: DM 목록 + 참여자를 단일 쿼리(또는 2-쿼리 IN-fetch)로 적재.

### DTO

```
DmResponse(Long id,
           List<DmParticipant> participants,   // 본인 포함 전원
           Instant lastMessageAt,               // null 가능(메시지 0건)
           Instant createdAt)

DmParticipant(Long userId, String name, String kind)   // kind: HUMAN|AGENT

CreateDmRequest(@NotEmpty List<Long> userIds)           // 본인 제외 타겟; 서비스에서 caller 합집합·검증
```

> `DmResponse` 는 `name` 이 null 인 DM 의 표시를 위해 **참여자를 동봉**한다(프론트가 표시명 파생, 별도 멤버 조회 N+1 방지). 표시명 로직은 프론트 §참조.

### REST API (`/api/v1/messaging`)

| Method | Path | 설명 | 권한 | 응답 |
|---|---|---|---|---|
| GET | `/dms` | 내 DM 목록(참여자·최근시각 포함, 최근순) | 인증 | `List<DmResponse>` |
| POST | `/dms` | find-or-create `{userIds:[...]}` | 인증 | `DmResponse` (기존 200 / 신규 201) |

메시지 송수신·실시간은 기존 엔드포인트 그대로:
- `GET /channels/{id}/messages`, `POST /channels/{id}/messages`, `GET /stream` (SSE) — DM 채널 id 사용. `requireMember` 가 비참여자를 404 로 차단.

### 예외 → HTTP 매핑 (`GlobalExceptionHandler`)

- `InvalidDmRequestException` → **400** (빈 타겟 / self-only / >8명 / 미존재 유저).
- `ChannelNotFoundException` → **404** (기존; DM 비참여자 은닉에도 사용).

---

## 프론트엔드 설계

### 타입 (`types/messaging.ts`)

```ts
export interface DmParticipant {
  userId: number
  name: string
  kind: UserKind          // 'HUMAN' | 'AGENT'
}

export interface DmResponse {
  id: number
  participants: DmParticipant[]   // 본인 포함
  lastMessageAt: string | null
  createdAt: string
}

export interface CreateDmRequest {
  userIds: number[]               // 본인 제외 타겟
}
```

### API (`api/messaging.ts`)

추가: `listDms(): Promise<DmResponse[]>` (GET `/messaging/dms`), `createDm(userIds: number[]): Promise<DmResponse>` (POST `/messaging/dms`).

### 훅 (`hooks/queries/`)

- `messagingKeys.dms()` = `['messaging', 'dms']` 추가.
- `useMyDms()` — `listDms`, 10s staleTime(채널 사이드바와 동일 정책).
- `useCreateDm()` — `createDm`, 성공 시 `messagingKeys.dms()` 무효화 → 생성된 DM 으로 라우팅.

### 표시명 파생 유틸 (`lib/dm.ts` 또는 컴포넌트 내)

`dmDisplayName(dm: DmResponse, currentUserId: number): string`:
- 본인 제외 참여자 목록 = `others`.
- `others.length === 1` → `others[0].name` (1:1).
- `others.length > 1` → 이름 `,` 결합(예: `"Alice, Bob, Carol"`). 길면 `"Alice, Bob 외 2명"` 형태로 축약(참여자 수 기준).

### 컴포넌트 / 페이지

- **`ChannelSidebar`** — 기존 채널 섹션 아래 **DM 섹션** 추가. `useMyDms()` 로 목록 렌더(표시명·HUMAN/AGENT 아이콘). 섹션 헤더에 `+ 새 메시지` 버튼.
- **`NewDmModal`** (신규) — `MemberSearchPopover` 의 **다중 선택** 흐름으로 참여자 1~7명 선택(본인 제외; 8명 상한은 선택 7명에서 막음) → "시작" → `createDm` → 응답 DM 으로 라우팅. 이미 존재하는 멤버셋이면 서버가 기존 DM 반환 → 기존 대화로 이동.
- **DM 페이지** — 기존 `ChannelPage` + 메시지 컴포넌트(`MessageList`/`MessageComposer`) 재사용. 헤더는 **참여자 기반 표시명·참여자 수**만(이름변경/멤버관리/아카이브/설정 드롭다운 없음). composer 는 항상 활성(DM 은 아카이브 없음).
- **라우팅** — `/chat/dms/:id`. DM 페이지는 `useMyDms` 결과에서 해당 id 의 참여자로 헤더 구성(별도 상세 호출 불필요; 직접 진입 대비 `GET /dms` 캐시 미스 시 목록 재조회).

### MemberSearchPopover 다중 선택

기존 `MemberSearchPopover`(단일 `onSelect`)는 단일 선택 전제. **다중 선택 래퍼**를 `NewDmModal` 안에 둔다: 선택된 사용자를 칩(chip) 목록으로 누적, 팝오버는 `existingMemberIds` 에 이미 선택된 id 를 넘겨 중복 방지. 7명 선택 시 추가 비활성. (기존 컴포넌트 시그니처 변경 없이 모달이 상태를 관리.)

---

## 데이터 흐름

**새 DM 시작**: 사이드바 DM 섹션 `+ 새 메시지` → `NewDmModal` 에서 참여자 선택 → `POST /dms {userIds}` → (기존이면 200 같은 DM / 신규면 201) → `dms` 무효화 → 응답 `id` 의 `/chat/dms/:id` 로 이동.

**기존 1:1 재시작**: 같은 상대 선택 → 서버가 `member_key` 로 기존 DM 조회 → 동일 id 반환 → 기존 대화로 이동(새 대화 생성 안 함).

**메시지 송수신**: DM 페이지에서 기존 `POST /channels/{id}/messages` + `/stream` SSE 그대로. 참여자에게 fan-out.

**첫 DM 수신(한계)**: B 가 A 에게 첫 DM 을 보내면 A 의 SSE 로 메시지 이벤트는 도착하나, A 의 DM 목록에 그 DM 이 아직 없음 → A 가 새로고침/재진입 시 사이드바에 등장(cross-user 메타 푸시는 비목표).

---

## 에러 처리

- 빈 타겟 / self-only / >8명 / 미존재 유저(400) → 토스트 "DM 을 만들 수 없습니다"(구체 메시지는 `ErrorResponse.message`). UI 1차 방어: 모달에서 0명/8명 초과 시 "시작" 비활성.
- DM 비참여자 직접 진입(404) → 채널 없음 페이지(기존 `channel-not-found` 재사용, 존재 은닉 유지).

---

## 테스트

### 백엔드 (JUnit 통합)
- **1:1 dedup**: A→B 생성 후 A→B 재요청 시 동일 id(200). B→A(순서 반대)도 동일 id.
- **그룹 dedup**: 동일 멤버셋 재요청 → 재사용. 멤버 한 명 다른 셋 → 신규 id.
- **검증**: 빈 `userIds` → 400. self-only(본인만) → 400. 본인 포함 9명 → 400. 미존재 유저 포함 → 400.
- **은닉**: 비참여자가 DM 의 `GET /channels/{id}`·메시지 조회/전송 → 404.
- **채널 사이드바 회귀**: caller 가 참여한 DM 이 `GET /channels`(findMyChannels) 결과에 **미포함**. `discover` 결과에도 DM 미포함.
- **레이스**: 동일 `member_key` 동시 insert 시 유니크 인덱스로 1건만 생성, 두 요청 모두 같은 DM 반환.
- **메시지 재사용**: DM 채널에 메시지 전송→조회(기존 MessageService 경로) 정상.

### 프론트 (Playwright E2E, 전면 모킹)
- 새 DM 생성(1:1) → DM 섹션에 상대 이름으로 등장 → DM 페이지 진입.
- 기존 상대 재선택 → 기존 대화로 이동(`POST /dms` 가 같은 id 반환, 중복 항목 없음).
- 그룹 DM 생성(3인) → 표시명 결합("Alice, Bob") 확인.
- DM 페이지에서 메시지 입력 → `POST .../messages` payload 검증 → UI 반영.
- 8명 상한: 모달에서 7명 선택 후 추가 비활성, "시작" 동작.
- 400 에러(예: self-only) → 토스트 표시.

---

## 영향 범위 / 호환성

- **회귀**: `findMyChannels` 에 `kind='CHANNEL'` 필터 추가 — 기존 채널 사이드바 동작 동일(채널만 반환), DM 누수 차단. 기존 채널 E2E 영향 없음(채널만 모킹).
- **`ChannelResponse`**: 무변경(DM 은 별도 `DmResponse` 사용).
- **이슈 채팅 도메인(`chat`)**: 무관·무변경.
- **DB**: 단일 `ADD COLUMN` + 부분 유니크 인덱스. 기존 데이터 손실 없음(`member_key` 는 채널 행에서 NULL).
- **SSE/메시지**: 무변경 재사용 — 신규 인프라 없음.
