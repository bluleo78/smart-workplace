# M365 Calendar Attendees Bidirectional Sync (#547) Design

## 목표

M365 Graph에서 동기화된 일정의 참석자를 앱에서 볼 수 있고, 앱에서 생성·초대·삭제한 참석자가 M365에도 반영되는 완전 양방향 참석자 동기화.

## 전제 (#501, #502 선행)

- #501: Graph 읽기 동기화 (`GraphCalendarFetcher` — 이벤트 upsert, attendees 미포함)
- #502: Graph 쓰기 write-through (`CalendarEventService.create/update/delete` 비-@Transactional 오케스트레이터, `CalendarTransport`/`GraphCalendarTransport`)

---

## 스코프

| 방향 | 포함 |
|------|------|
| Graph → 로컬 | attendees 배열 읽기, 내부 user 매칭 + 외부 이메일 행, RSVP 상태 동기화 |
| 로컬 → Graph | create 시 attendees 전송, invite/remove 시 attendees-only PATCH |
| 외부 email 참석자 | 스키마 확장으로 표시 (로컬 invite 대상은 내부 user만) |
| RSVP | Graph response status → 로컬 rsvp_status 매핑 (읽기) |
| 반복 일정 참석자 | 제외 (#546) |
| AI/chat confirm 경로 M365 쓰기 | 제외 (#548) |

### ⭐ 핵심 스코프 결정: 쓰기는 주최자 일정만 (advisor 적발 데이터 손실 2건 회피)

attendees 컬렉션 변경은 **주최자(ORGANIZER) 액션**이다. 동기화로 받은(내가 ORGANIZER 가 아닌)
일정에 대해서는:

- **참석자 변경(invite/remove) 차단**: Graph 가 비주최자 attendee mutation 을 거부 → 502.
  `requireWritableEvent`(캘린더 canEdit)만으로는 불충분 — 추가로 **caller 가 해당 일정의
  ORGANIZER attendee 행인지** 확인. 아니면 외부 쓰기 거부(409, 로컬도 변경 안 함 — 다음 sync 가
  덮어쓰므로 무의미).
- **인앱 RSVP 차단**: `respondRsvp` 를 외부 일정(external_id 보유)에서 거부(409). Graph 로
  역전송하지 않으므로 인앱 RSVP 는 다음 read-sync 가 `notResponded`→`NEEDS_ACTION` 으로
  덮어써 사라진다. RSVP 는 read-sync 가 채운 **읽기 전용 표시**.

판정 기준은 caller 의 ORGANIZER 여부 하나로 통일된다:
- 로컬 일정: create 가 caller 를 ORGANIZER 로 넣음 → 항상 편집 가능
- 외부-내가 주최(Outlook 에서 내가 만든 일정 동기화): organizer == 나 → 편집 가능
- 외부-내가 초대받음: organizer == 타인 → 참석자/RSVP 읽기 전용

RSVP 역전송(Graph `/accept|/decline|/tentativelyAccept` 액션)은 후속 이슈.

---

## 스키마 (V110)

```sql
-- user_id nullable → 외부 참석자 지원
ALTER TABLE event_attendee ALTER COLUMN user_id DROP NOT NULL;

-- 외부 참석자 식별 정보
ALTER TABLE event_attendee ADD COLUMN external_email VARCHAR(320);
ALTER TABLE event_attendee ADD COLUMN external_name  VARCHAR(255);

-- 반드시 user_id 또는 external_email 중 하나 존재
ALTER TABLE event_attendee
  ADD CONSTRAINT event_attendee_identity_chk
  CHECK ((user_id IS NOT NULL) OR (external_email IS NOT NULL));

-- 외부 참석자 partial unique 만 추가. 기존 event_attendee_uq UNIQUE(event_id, user_id) 는 유지.
-- (user_id nullable + PG NULLS DISTINCT → 외부 행의 NULL user_id 는 서로 충돌 안 함.
--  기존 UNIQUE 를 partial index 로 바꾸면 insert() 의 ON CONFLICT(event_id, user_id) 가
--  "no unique constraint matching" 런타임 오류 → 절대 교체 금지.)
CREATE UNIQUE INDEX event_attendee_ext_uq
  ON event_attendee(event_id, external_email) WHERE external_email IS NOT NULL;
```

**RLS**: 기존 FORCE RLS 정책 유지 (tenant_id 컬럼 변경 없음).

---

## Graph Client 변경 (`GraphCalendarClient`)

### 읽기 레코드 추가

```java
public record GraphEventAttendee(
    GraphEmail emailAddress,
    GraphAttendeeStatus status,
    String type) {}   // "required" | "optional"

public record GraphAttendeeStatus(String response, String time) {}
// response: "none" | "accepted" | "declined" | "tentative" | "notResponded"
```

`GraphEvent`에 필드 추가:
```java
List<GraphEventAttendee> attendees
```

`$select` 확장: `...,organizer,attendees,isCancelled`

### 쓰기 레코드 추가

```java
public record GraphAttendeeWrite(
    GraphEmail emailAddress,
    String type) {}   // "required"
```

`GraphEventWrite`에 필드 추가:
```java
@JsonInclude(JsonInclude.Include.NON_NULL)
List<GraphAttendeeWrite> attendees   // null → 생략
```

### RSVP 매핑

| Graph response | 로컬 rsvp_status |
|---|---|
| `accepted` | `ACCEPTED` |
| `declined` | `DECLINED` |
| `tentative` | `TENTATIVE` |
| `none` / `notResponded` | `NEEDS_ACTION` |

---

## 읽기 동기화 (`GraphCalendarFetcher`)

`ExternalCalendarFetcher.syncEvents()` 내부 이벤트 upsert 직후, `external_id`가 있는 이벤트에 대해 참석자 diff-sync 실행.

### 참석자 매핑 전략

```
target = [organizer → role=ORGANIZER, rsvp=ACCEPTED]
       ∪ [attendees[] → role=ATTENDEE, rsvp=mapped]

매칭 키 = emailAddress.address (대소문자 무시)
```

1. `email` → `UserRepository.findByEmailIgnoreCase(email)` 조회  
   → 있으면 `user_id` 행  
   → 없으면 `external_email` + `external_name` 행

2. 기존 로컬 attendee 로드 (`EventAttendeeRepository.findByEvent(eventId)`)

3. Diff:
   - **추가**: target에 있고 로컬에 없는 → `insert` 또는 `insertExternal`
   - **삭제**: 로컬에 있고 target에 없는 → `delete` (단, ORGANIZER 행은 삭제 대상에서 제외)
   - **갱신**: 교집합 → `rsvp_status` 변경 시만 `updateRsvp`

4. **null guard**: Graph가 `attendees` 필드를 null로 반환하면 sync 건너뜀 (빈 배열과 미포함 구분).

5. **대상 범위**: `external_id IS NOT NULL`인 이벤트만. 순수 로컬 이벤트 건드리지 않음.

### UserRepository 추가 메서드

```java
Optional<UserRecord> findByEmailIgnoreCase(String email);
```

---

## 쓰기 경로 (`CalendarEventService`)

### `create()` 변경

`toGraphWrite()` 내부에서 attendees 추가:

```java
List<GraphAttendeeWrite> graphAttendees = req.attendeeUserIdsOrEmpty().stream()
    .filter(uid -> !uid.equals(callerId))          // 주최자 제외
    .map(uid -> userRepo.findById(uid))
    .filter(Optional::isPresent).map(Optional::get)
    .map(u -> new GraphAttendeeWrite(
        new GraphEmail(u.name(), u.email()), "required"))
    .toList();
// 빈 리스트 → null (생략)
```

### `inviteAttendees()` — 비-@Transactional 오케스트레이터로 전환

```
resolve tx  : findExternalRef(eventId) 조회, canEdit 확인, tx 가드
Graph HTTP  : 현재 attendees(로컬 전체) + 신규 userIds → 통합 리스트 PATCH
persist tx  : attendeeRepo.insert() 각 신규 user
return      : enriched event (get() inside persist tx)
```

PATCH 페이로드 = 기존 로컬 `event_attendee` 목록 + 신규 userIds.  
내부 user → `user.email`, 외부 참석자(`external_email` 행) → `externalEmail`.

### `removeAttendee()` — 비-@Transactional 오케스트레이터로 전환

```
resolve tx  : findExternalRef, canEdit
Graph HTTP  : 기존 attendees - 삭제 대상 → PATCH
persist tx  : attendeeRepo.deleteByEventAndUser()
```

### 공통 헬퍼

```java
// 현재 attendee 목록을 Graph 쓰기 형식으로 변환
List<GraphAttendeeWrite> buildAttendeeList(long eventId, long callerId);
```

`event_attendee` 행 순회:
- `user_id IS NOT NULL` → `userRepo.findById()` → email
- `external_email IS NOT NULL` → externalEmail + externalName 직접 사용

### `respondRsvp()` — 변경 없음

로컬 전용. M365 RSVP 응답은 Outlook에서 처리.

---

## Repository 변경

### `EventAttendeeRepository`

```java
// 기존 (내부 user용)
void insert(long eventId, long userId, Long invitedByUserId, String role, String rsvpStatus);

// 신규 (외부 email용)
void insertExternal(long eventId, String externalEmail, String externalName,
                    String role, String rsvpStatus);

// 기존 — user_id 기준 (내부 user RSVP 업데이트)
void updateRsvp(long eventId, long userId, String rsvpStatus);
// 신규 — external_email 기준 (외부 참석자 RSVP 업데이트)
void updateRsvpByExternalEmail(long eventId, String externalEmail, String rsvpStatus);
```

### `UserRepository`

```java
Optional<UserRecord> findByEmailIgnoreCase(String email);
```

---

## DTO 변경

### `AttendeeResponse`

```java
public record AttendeeResponse(
    Long userId,          // nullable (외부 참석자는 null)
    String username,      // nullable
    String name,          // external_name 폴백
    String kind,          // "HUMAN" | "AGENT" | "EXTERNAL"
    String role,          // "ORGANIZER" | "ATTENDEE"
    String rsvpStatus,
    Long invitedByUserId,
    String externalEmail) {}  // nullable, 외부 참석자만
```

---

## 프론트엔드 변경

### `Attendee` 타입 확장 (`types/calendar.ts`)

```typescript
export interface Attendee {
  userId: number | null      // 외부 참석자면 null
  username: string | null
  name: string
  kind: 'HUMAN' | 'AGENT' | 'EXTERNAL'
  role: 'ORGANIZER' | 'ATTENDEE'
  rsvpStatus: RsvpStatus
  invitedByUserId: number | null
  externalEmail: string | null
}
```

### `AttendeeSection` 렌더 확장

- `kind === 'EXTERNAL'` 행: 아바타 없음, `externalEmail` 표시 (이름 없으면 email만)
- RSVP 아이콘: 기존 동일 (ACCEPTED/DECLINED/TENTATIVE/NEEDS_ACTION)
- 레이아웃 변경 없음

---

## 테스트

### 백엔드 통합 테스트

1. **읽기 sync** — Graph attendees 포함 응답 → `event_attendee` diff-upsert 검증
   - 내부 user 이메일 매칭 → `user_id` 행
   - 외부 이메일 → `external_email` 행
   - RSVP 매핑 (`accepted` → `ACCEPTED` 등)
   - null attendees guard (sync 건너뜀)

2. **쓰기 create** — attendees 포함 GraphEventWrite 직렬화 검증

3. **inviteAttendees** — 외부 캘린더 이벤트: GraphApiClient.patch() 호출 + 페이로드 attendees 확인

4. **removeAttendee** — 동일, 삭제 후 attendees 목록 확인

5. **V110 마이그레이션** — null user_id 허용, CHECK 제약, partial unique 동작

### 직렬화 테스트 (`GraphCalendarClientWriteTest`)

- `attendees` 포함 `GraphEventWrite` → JSON `"attendees":[...]` 포함
- `attendees=null` → JSON에서 `"attendees"` 키 생략 (`@JsonInclude(NON_NULL)`)

### 프론트엔드 E2E

- 외부 calendar 이벤트 상세 → `EXTERNAL` kind 참석자 email 렌더 확인
- 참석자 초대 → API mock attendees PATCH 호출 확인

---

## 제외 범위

- 반복 일정 참석자 sync (#546)
- AI/chat confirm 경로 M365 쓰기 (#548)
- 외부 이메일 직접 invite UI (현재 userId picker 유지)
- RSVP를 Graph로 역전송 (Outlook에서 처리)
