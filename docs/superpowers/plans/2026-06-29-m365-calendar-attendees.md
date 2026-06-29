# M365 Calendar Attendees Bidirectional Sync (#547) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M365 Graph 일정의 참석자를 앱으로 읽어오고(내부 user 매칭 + 외부 이메일), 내가 주최한 외부 일정의 참석자 추가/삭제를 Graph로 write-through 한다.

**Architecture:** #501 읽기 동기화(`GraphCalendarFetcher`)에 참석자 diff-sync 를 추가하고, #502 쓰기 오케스트레이터(`CalendarEventService.create/invite/remove`)에 참석자 페이로드를 얹는다. 쓰기·RSVP 는 **caller 가 ORGANIZER 인 일정만** — 동기화로 받은(내가 주최 아님) 일정의 참석자·RSVP 는 읽기 전용 표시.

**Tech Stack:** Spring Boot, jOOQ, Microsoft Graph API, React 19 + TS, Flyway.

## Global Constraints

- **마이그레이션**: `V110__event_attendee_external.sql` (최신 V109 다음). 기존 `event_attendee_uq UNIQUE(event_id, user_id)` **절대 제거 금지** — `insert()` 의 `ON CONFLICT(event_id, user_id)` 가 partial index 로 바꾸면 런타임 오류남. partial unique `(event_id, external_email) WHERE external_email IS NOT NULL` 만 ADD.
- **한국어 주석 필수**: 클래스·메서드·주요 로직.
- **쓰기 스코프**: create/invite/remove 의 Graph write-through 와 인앱 RSVP 는 **caller 가 해당 일정의 ORGANIZER 인 경우만**. 외부 일정에서 비주최자의 invite/remove → 409, 외부 일정 RSVP → 409.
- **AGENT 참석자는 Graph 로 보내지 않는다** — AGENT(kind='AGENT')는 로컬 협업 전용. Graph attendees 목록에서 제외(invite/remove 모두 로컬만).
- **HTTP-outside-tx**: 모든 Graph HTTP 는 `txTemplate` 밖에서. 진입 시 `TransactionSynchronizationManager.isActualTransactionActive()` 면 `ExternalCalendarWriteInTransactionException`(409) — create/invite/remove 외부 경로 전부.
- **RLS 의존 읽기는 tx 안에서**: owner/외부참조/email 해석 모두 `txTemplate.execute(...)` 안 (tx 밖 bare read 는 RLS fail-closed, #492).
- **종일 일정 무변경**: `toGraphDateTime` 의 all-day +12h 복원 로직(#502)은 손대지 않는다.
- **테스트 필수**: 백엔드 JUnit 통합 테스트(`IntegrationTestBase` 상속), 프론트 vitest/Playwright.
- **커밋만**: push·머지는 사용자 승인 후. 각 태스크 끝에 커밋.
- Spotless(Google Java Format) — 커밋 전 `./gradlew spotlessApply`. config-cache stale 시 `rm -rf apps/workplace-api/.gradle/configuration-cache`.

## File Structure

| 파일 | 책임 | 태스크 |
|------|------|------|
| `db/migration/V110__event_attendee_external.sql` | 스키마: user_id nullable, external_email/name, CHECK, partial unique | 1 |
| `repository/EventAttendeeRepository.java` | AttendeeRow 확장, LEFT JOIN, insertExternal, updateRsvpByExternalEmail, deleteByEventAndExternalEmail, isOrganizer | 2 |
| `user/repository/UserRepository.java` | findByEmailIgnoreCase | 2 |
| `mail/outbound/GraphCalendarClient.java` | 읽기/쓰기 attendee 레코드, $select, patchAttendees, rsvpFromGraphResponse | 3 |
| `calendar/service/GraphCalendarFetcher.java` | 읽기 동기화 참석자 diff | 4 |
| `calendar/service/CalendarEventService.java` | create attendees, invite/remove 오케스트레이터, respondRsvp 가드, enrich | 5,6,7 |
| `calendar/service/CalendarTransport.java` + `GraphCalendarTransport.java` | updateAttendees seam | 6 |
| `calendar/exception/*` + `GlobalExceptionHandler.java` | 신규 예외 2종(409) | 6 |
| `calendar/dto/AttendeeResponse.java`, `CalendarEventResponse.java` | external/myRole 필드 | 7 |
| `workplace-web/src/types/calendar.ts`, `components/calendar/AttendeeSection.tsx`, `EventDialog.tsx` | 외부 참석자 렌더 + 게이팅 | 8 |
| `docs/M365_CALENDAR_ATTENDEES_LIVE_SMOKE.md` | 라이브 스모크 절차 | 9 |

---

### Task 1: V110 스키마 — 외부 참석자 지원

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V110__event_attendee_external.sql`
- Regenerate: `apps/workplace-api/src/main/generated/` (jOOQ)

**Interfaces:**
- Produces: `EVENT_ATTENDEE.USER_ID`(nullable), `EVENT_ATTENDEE.EXTERNAL_EMAIL`, `EVENT_ATTENDEE.EXTERNAL_NAME` jOOQ 컬럼.

- [ ] **Step 1: 마이그레이션 파일 작성**

`apps/workplace-api/src/main/resources/db/migration/V110__event_attendee_external.sql`:
```sql
-- #547 M365 참석자 양방향: 외부(우리 user 테이블에 없는) 이메일 참석자 지원.
-- user_id 를 nullable 로 풀고 external_email/name 을 추가한다.

-- 외부 참석자는 user_id 가 없다.
ALTER TABLE event_attendee ALTER COLUMN user_id DROP NOT NULL;

-- 외부 참석자 식별 정보(Graph attendees[].emailAddress).
ALTER TABLE event_attendee ADD COLUMN external_email VARCHAR(320);
ALTER TABLE event_attendee ADD COLUMN external_name  VARCHAR(255);

-- 행은 반드시 내부(user_id) 또는 외부(external_email) 중 하나로 식별돼야 한다.
ALTER TABLE event_attendee
  ADD CONSTRAINT event_attendee_identity_chk
  CHECK ((user_id IS NOT NULL) OR (external_email IS NOT NULL));

-- 외부 참석자 중복 방지. (event_id, external_email) partial unique.
-- 기존 event_attendee_uq UNIQUE(event_id, user_id) 는 유지한다 — insert() 의
-- ON CONFLICT(event_id, user_id) 가 이 제약을 추론하므로 절대 제거하지 않는다.
-- (user_id nullable + PG 기본 NULLS DISTINCT → 외부 행의 NULL user_id 는 서로 충돌하지 않는다.)
CREATE UNIQUE INDEX event_attendee_ext_uq
  ON event_attendee (event_id, external_email) WHERE external_email IS NOT NULL;
```

- [ ] **Step 2: dev DB 에 적용**

`pnpm db:up` 으로 DB 기동 확인 후, 백엔드를 한 번 띄워 Flyway 가 V110 을 적용하게 한다:
```bash
cd apps/workplace-api && ./gradlew bootRun --args='--spring.profiles.active=local'
```
로그에 `Migrating schema "public" to version "110 - event attendee external"` / `Successfully applied` 가 보이면 `Ctrl-C` 로 중지.

검증:
```bash
docker exec smart-workplace-db-1 psql -U app -d workplace -c '\d event_attendee'
```
Expected: `user_id` 가 `not null` 아님, `external_email`/`external_name` 컬럼 존재, `event_attendee_ext_uq` 인덱스 존재, `event_attendee_uq` 그대로 존재.

- [ ] **Step 3: jOOQ 코드 재생성**

Run:
```bash
cd apps/workplace-api && ./gradlew generateJooq
```
Expected: BUILD SUCCESSFUL. 확인:
```bash
grep -i "EXTERNAL_EMAIL\|EXTERNAL_NAME" apps/workplace-api/src/main/generated/com/workplace/jooq/tables/EventAttendee.java
```
Expected: 두 컬럼 필드가 출력됨.

- [ ] **Step 4: 컴파일 확인**

Run: `cd apps/workplace-api && ./gradlew compileJava`
Expected: BUILD SUCCESSFUL (기존 코드는 새 nullable 컬럼에 영향 없음).

- [ ] **Step 5: Commit**

```bash
git add apps/workplace-api/src/main/resources/db/migration/V110__event_attendee_external.sql apps/workplace-api/src/main/generated/
git commit -m "feat(calendar): event_attendee 외부 참석자 컬럼 V110 (#547)"
```

---

### Task 2: Repository — 외부 참석자 + 조직자 판정 + 이메일 조회

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/calendar/repository/EventAttendeeRepository.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/user/repository/UserRepository.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/calendar/repository/EventAttendeeRepositoryExternalTest.java` (create)

**Interfaces:**
- Consumes: `EVENT_ATTENDEE.EXTERNAL_EMAIL/EXTERNAL_NAME/USER_ID`(Task 1), `USER` 테이블.
- Produces:
  - `AttendeeRow(long eventId, Long userId, String username, String name, String kind, Long invitedByUserId, String role, String rsvpStatus, OffsetDateTime invitedAt, OffsetDateTime respondedAt, String externalEmail)` — `userId` 가 `long`→`Long`, `externalEmail` 추가. 외부 행은 `kind="EXTERNAL"`, `name=external_name`, `username=null`.
  - `EventAttendeeRepository.insertExternal(long eventId, String externalEmail, String externalName, String role, String rsvpStatus)`
  - `EventAttendeeRepository.updateRsvpByExternalEmail(long eventId, String externalEmail, String rsvpStatus)` → int
  - `EventAttendeeRepository.deleteByEventAndExternalEmail(long eventId, String externalEmail)` → int
  - `EventAttendeeRepository.isOrganizer(long eventId, long userId)` → boolean
  - `UserRepository.findByEmailIgnoreCase(String email)` → `Optional<UserResponse>`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/workplace-api/src/test/java/com/workplace/calendar/repository/EventAttendeeRepositoryExternalTest.java`:
```java
package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.repository.EventAttendeeRepository.AttendeeRow;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.tenant.TenantContext;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** event_attendee 외부 참석자(external_email) 행 + 조직자 판정 통합 테스트. */
class EventAttendeeRepositoryExternalTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;

  @Autowired EventAttendeeRepository repo;
  @Autowired DSLContext dsl;
  @Autowired PlatformTransactionManager txManager;

  private long ownerId;
  private long eventId;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    new TransactionTemplate(txManager)
        .execute(
            s -> {
              ownerId = TestFixtures.createHuman(dsl);
              long calId =
                  dsl.insertInto(CALENDAR)
                      .set(CALENDAR.OWNER_ID, ownerId)
                      .set(CALENDAR.NAME, "기본")
                      .set(CALENDAR.COLOR, "#3b82f6")
                      .set(CALENDAR.IS_DEFAULT, true)
                      .set(CALENDAR.IS_READ_ONLY, false)
                      .returning(CALENDAR.ID)
                      .fetchOne()
                      .getId();
              eventId =
                  dsl.insertInto(CALENDAR_EVENT)
                      .set(CALENDAR_EVENT.OWNER_ID, ownerId)
                      .set(CALENDAR_EVENT.CALENDAR_ID, calId)
                      .set(CALENDAR_EVENT.TITLE, "회의")
                      .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.now())
                      .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.now().plusHours(1))
                      .set(CALENDAR_EVENT.ALL_DAY, false)
                      .returning(CALENDAR_EVENT.ID)
                      .fetchOne()
                      .getId();
              return null;
            });
  }

  @AfterEach
  void tearDown() {
    final long uid = ownerId;
    cleanupInTenant(TENANT_ID, () -> dsl.execute("DELETE FROM \"user\" WHERE id = ?", uid));
    TenantContext.clear();
  }

  @Test
  void insertExternal_then_findByEvent_returns_external_row() {
    new TransactionTemplate(txManager)
        .execute(
            s -> {
              repo.insert(eventId, ownerId, null, "ORGANIZER", "ACCEPTED");
              repo.insertExternal(eventId, "client@partner.com", "Client Lee", "ATTENDEE", "ACCEPTED");
              return null;
            });

    List<AttendeeRow> rows =
        new TransactionTemplate(txManager).execute(s -> repo.findByEvent(eventId));

    assertThat(rows).hasSize(2);
    AttendeeRow ext =
        rows.stream().filter(r -> r.userId() == null).findFirst().orElseThrow();
    assertThat(ext.externalEmail()).isEqualTo("client@partner.com");
    assertThat(ext.name()).isEqualTo("Client Lee");
    assertThat(ext.kind()).isEqualTo("EXTERNAL");
    assertThat(ext.role()).isEqualTo("ATTENDEE");
    assertThat(ext.rsvpStatus()).isEqualTo("ACCEPTED");

    AttendeeRow org = rows.stream().filter(r -> r.userId() != null).findFirst().orElseThrow();
    assertThat(org.userId()).isEqualTo(ownerId);
    assertThat(org.externalEmail()).isNull();
  }

  @Test
  void updateRsvpByExternalEmail_and_delete_work() {
    new TransactionTemplate(txManager)
        .execute(
            s -> {
              repo.insertExternal(eventId, "a@x.com", "A", "ATTENDEE", "NEEDS_ACTION");
              int updated = repo.updateRsvpByExternalEmail(eventId, "a@x.com", "DECLINED");
              assertThat(updated).isEqualTo(1);
              int deleted = repo.deleteByEventAndExternalEmail(eventId, "a@x.com");
              assertThat(deleted).isEqualTo(1);
              return null;
            });
  }

  @Test
  void isOrganizer_true_only_for_organizer_row() {
    long otherId =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long o = TestFixtures.createHuman(dsl);
                  repo.insert(eventId, ownerId, null, "ORGANIZER", "ACCEPTED");
                  repo.insert(eventId, o, ownerId, "ATTENDEE", "NEEDS_ACTION");
                  return o;
                });

    Boolean ownerIsOrg =
        new TransactionTemplate(txManager).execute(s -> repo.isOrganizer(eventId, ownerId));
    Boolean otherIsOrg =
        new TransactionTemplate(txManager).execute(s -> repo.isOrganizer(eventId, otherId));

    assertThat(ownerIsOrg).isTrue();
    assertThat(otherIsOrg).isFalse();
    cleanupInTenant(TENANT_ID, () -> dsl.execute("DELETE FROM \"user\" WHERE id = ?", otherId));
  }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.calendar.repository.EventAttendeeRepositoryExternalTest"`
Expected: 컴파일 실패 — `insertExternal`/`updateRsvpByExternalEmail`/`deleteByEventAndExternalEmail`/`isOrganizer`/`AttendeeRow.externalEmail()` 없음.

- [ ] **Step 3: `AttendeeRow` 확장 + `findByEvents` LEFT JOIN**

`EventAttendeeRepository.java` — `AttendeeRow` 레코드를 교체 (`userId` 를 `Long` 으로, `externalEmail` 추가):
```java
  /** 참석자 행 + user 메타(이름/kind) 조인 결과. 외부 참석자는 userId=null·kind="EXTERNAL". */
  public record AttendeeRow(
      long eventId,
      Long userId,
      String username,
      String name,
      String kind,
      Long invitedByUserId,
      String role,
      String rsvpStatus,
      OffsetDateTime invitedAt,
      OffsetDateTime respondedAt,
      String externalEmail) {}
```

`findByEvents` 를 교체 — INNER JOIN → LEFT JOIN, 외부 컬럼 추가, 외부 행 매핑:
```java
  /** 배치 조회(event_id IN ...). ORGANIZER 먼저, 이후 초대 순서. 외부 참석자(user_id NULL) 포함 위해 LEFT JOIN. */
  public List<AttendeeRow> findByEvents(Collection<Long> eventIds) {
    if (eventIds.isEmpty()) return List.of();
    return dsl.select(
            EVENT_ATTENDEE.EVENT_ID,
            EVENT_ATTENDEE.USER_ID,
            USER.USERNAME,
            USER.NAME,
            USER.KIND,
            EVENT_ATTENDEE.INVITED_BY_USER_ID,
            EVENT_ATTENDEE.ROLE,
            EVENT_ATTENDEE.RSVP_STATUS,
            EVENT_ATTENDEE.INVITED_AT,
            EVENT_ATTENDEE.RESPONDED_AT,
            EVENT_ATTENDEE.EXTERNAL_EMAIL,
            EVENT_ATTENDEE.EXTERNAL_NAME)
        .from(EVENT_ATTENDEE)
        .leftJoin(USER)
        .on(USER.ID.eq(EVENT_ATTENDEE.USER_ID))
        .where(EVENT_ATTENDEE.EVENT_ID.in(eventIds))
        .orderBy(EVENT_ATTENDEE.ROLE.desc(), EVENT_ATTENDEE.INVITED_AT.asc())
        .fetch(
            r -> {
              Long uid = r.get(EVENT_ATTENDEE.USER_ID);
              boolean external = uid == null;
              return new AttendeeRow(
                  r.get(EVENT_ATTENDEE.EVENT_ID),
                  uid,
                  external ? null : r.get(USER.USERNAME),
                  external ? r.get(EVENT_ATTENDEE.EXTERNAL_NAME) : r.get(USER.NAME),
                  external ? "EXTERNAL" : r.get(USER.KIND),
                  r.get(EVENT_ATTENDEE.INVITED_BY_USER_ID),
                  r.get(EVENT_ATTENDEE.ROLE),
                  r.get(EVENT_ATTENDEE.RSVP_STATUS),
                  r.get(EVENT_ATTENDEE.INVITED_AT),
                  r.get(EVENT_ATTENDEE.RESPONDED_AT),
                  r.get(EVENT_ATTENDEE.EXTERNAL_EMAIL));
            });
  }
```

- [ ] **Step 4: 신규 메서드 추가**

`EventAttendeeRepository.java` 에 메서드 추가 (클래스 내, `deleteByEventAndUser` 뒤):
```java
  /** 외부(우리 user 아님) 참석자 1명 삽입. 중복(event_id, external_email)은 무시. */
  public void insertExternal(
      long eventId, String externalEmail, String externalName, String role, String rsvpStatus) {
    dsl.insertInto(EVENT_ATTENDEE)
        .set(EVENT_ATTENDEE.EVENT_ID, eventId)
        .set(EVENT_ATTENDEE.EXTERNAL_EMAIL, externalEmail)
        .set(EVENT_ATTENDEE.EXTERNAL_NAME, externalName)
        .set(EVENT_ATTENDEE.ROLE, role)
        .set(EVENT_ATTENDEE.RSVP_STATUS, rsvpStatus)
        .onConflict(EVENT_ATTENDEE.EVENT_ID, EVENT_ATTENDEE.EXTERNAL_EMAIL)
        .doNothing()
        .execute();
  }

  /** 외부 참석자 RSVP 갱신. 반환값: 영향 행 수. */
  public int updateRsvpByExternalEmail(long eventId, String externalEmail, String rsvpStatus) {
    return dsl.update(EVENT_ATTENDEE)
        .set(EVENT_ATTENDEE.RSVP_STATUS, rsvpStatus)
        .set(EVENT_ATTENDEE.RESPONDED_AT, OffsetDateTime.now())
        .where(EVENT_ATTENDEE.EVENT_ID.eq(eventId))
        .and(EVENT_ATTENDEE.EXTERNAL_EMAIL.eq(externalEmail))
        .execute();
  }

  /** 외부 참석자 제거. 반환값: 삭제 행 수. */
  public int deleteByEventAndExternalEmail(long eventId, String externalEmail) {
    return dsl.deleteFrom(EVENT_ATTENDEE)
        .where(EVENT_ATTENDEE.EVENT_ID.eq(eventId))
        .and(EVENT_ATTENDEE.EXTERNAL_EMAIL.eq(externalEmail))
        .execute();
  }

  /** 해당 사용자가 이 일정의 ORGANIZER 행인지. 외부 쓰기(invite/remove) 게이팅에 사용. */
  public boolean isOrganizer(long eventId, long userId) {
    return dsl.fetchExists(
        dsl.selectFrom(EVENT_ATTENDEE)
            .where(EVENT_ATTENDEE.EVENT_ID.eq(eventId))
            .and(EVENT_ATTENDEE.USER_ID.eq(userId))
            .and(EVENT_ATTENDEE.ROLE.eq("ORGANIZER")));
  }
```

`onConflict(...).doNothing()` 의 partial index 추론을 위해 jOOQ 가 `EVENT_ATTENDEE.EXTERNAL_EMAIL` 단일 컬럼 충돌을 사용한다 — partial unique `event_attendee_ext_uq` 가 이를 충족(Postgres 는 `WHERE` 술어 없이도 단일 컬럼 partial unique 를 추론할 수 있으나, 추론 실패 시 `insertExternal` 을 `onConflictOnConstraint` 가 아닌 명시적 `.onConflict(EVENT_ATTENDEE.EVENT_ID, EVENT_ATTENDEE.EXTERNAL_EMAIL).where(EVENT_ATTENDEE.EXTERNAL_EMAIL.isNotNull())` 로 교체). **테스트(Step 6)에서 이 INSERT 가 실제로 동작하는지 검증한다.**

- [ ] **Step 5: `findByEmailIgnoreCase` 추가**

`UserRepository.java` — `findById` 뒤에 추가:
```java
  /** 이메일(대소문자 무시)로 사용자 1명 조회 — 외부 캘린더 참석자 매칭에 사용. */
  public Optional<UserResponse> findByEmailIgnoreCase(String email) {
    if (email == null || email.isBlank()) return Optional.empty();
    return dsl.select(
            USER.ID, USER.USERNAME, USER.EMAIL, USER.NAME, USER.IS_ACTIVE, USER.CREATED_AT, USER.KIND)
        .from(USER)
        .where(USER.EMAIL.equalIgnoreCase(email))
        .fetchOptional(this::mapToUserResponse);
  }
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.calendar.repository.EventAttendeeRepositoryExternalTest"`
Expected: PASS (3 tests). enrichForGet/enrichForList 의 `r.userId() == callerId` 비교는 Task 7 에서 null-safe 로 고친다 — **이 태스크에서는 컴파일이 깨질 수 있으므로** `CalendarEventService` 의 해당 두 곳(`enrichForGet`, `enrichForList`)을 `r.userId() != null && r.userId() == callerId` 로 즉시 수정한다(autoboxing NPE 회피). 아래 적용:

`CalendarEventService.java` `enrichForGet` 와 `enrichForList` 의 두 람다:
```java
          .filter(r -> r.userId() != null && r.userId() == callerId)
```
(둘 다 동일하게 교체.)

- [ ] **Step 7: 전체 calendar 회귀 + 커밋**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.calendar.*"`
Expected: PASS.
```bash
cd apps/workplace-api && ./gradlew spotlessApply
git add apps/workplace-api/src/main/java/com/workplace/calendar/repository/EventAttendeeRepository.java apps/workplace-api/src/main/java/com/workplace/user/repository/UserRepository.java apps/workplace-api/src/main/java/com/workplace/calendar/service/CalendarEventService.java apps/workplace-api/src/test/java/com/workplace/calendar/repository/EventAttendeeRepositoryExternalTest.java
git commit -m "feat(calendar): 외부 참석자 repository + 조직자 판정 + 이메일 조회 (#547)"
```

---

### Task 3: GraphCalendarClient — attendee 읽기/쓰기 레코드 + patchAttendees

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/mail/outbound/GraphCalendarClient.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/mail/outbound/GraphCalendarClientWriteTest.java` (extend)

**Interfaces:**
- Produces:
  - `GraphEventAttendee(GraphEmail emailAddress, GraphAttendeeStatus status, String type)`
  - `GraphAttendeeStatus(String response, String time)`
  - `GraphEvent` 에 `List<GraphEventAttendee> attendees` 추가
  - `GraphAttendeeWrite(GraphEmail emailAddress, String type)`
  - `GraphEventWrite` 에 `List<GraphAttendeeWrite> attendees` 추가(NON_NULL 생략)
  - `GraphCalendarClient.patchAttendees(String accessToken, String externalEventId, List<GraphAttendeeWrite> attendees)`
  - `GraphCalendarClient.rsvpFromGraphResponse(String response)` → `"NEEDS_ACTION"|"ACCEPTED"|"DECLINED"|"TENTATIVE"` (static)

- [ ] **Step 1: 실패하는 테스트 작성**

`GraphCalendarClientWriteTest.java` 에 테스트 추가:
```java
  @Test
  void createEvent_with_attendees_serializes_attendees_array() {
    GraphEventWrite withAttendees =
        new GraphEventWrite(
            "회의",
            new GraphItemBody("text", "본문"),
            new GraphDateTime("2026-07-10T09:00:00", "UTC"),
            new GraphDateTime("2026-07-10T10:00:00", "UTC"),
            false,
            null,
            java.util.List.of(
                new GraphAttendeeWrite(new GraphEmail("이연희", "yh@iacloud.kr"), "required")));
    when(api.post(
            eq("tok"),
            eq("/me/calendars/gcal/events"),
            org.mockito.ArgumentMatchers.anyString(),
            eq(GraphEventCreated.class)))
        .thenReturn(new GraphEventCreated("NEW3"));
    client.createEvent("tok", "gcal", withAttendees);

    ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
    verify(api)
        .post(eq("tok"), eq("/me/calendars/gcal/events"), json.capture(), eq(GraphEventCreated.class));
    assertThat(json.getValue()).contains("\"attendees\"");
    assertThat(json.getValue()).contains("\"address\":\"yh@iacloud.kr\"");
    assertThat(json.getValue()).contains("\"type\":\"required\"");
  }

  @Test
  void createEvent_without_attendees_omits_attendees_key() {
    // timed() 는 attendees=null → @JsonInclude(NON_NULL) 로 키 생략돼야 함.
    when(api.post(
            eq("tok"),
            eq("/me/calendars/gcal/events"),
            org.mockito.ArgumentMatchers.anyString(),
            eq(GraphEventCreated.class)))
        .thenReturn(new GraphEventCreated("NEW4"));
    client.createEvent("tok", "gcal", timed());
    ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
    verify(api)
        .post(eq("tok"), eq("/me/calendars/gcal/events"), json.capture(), eq(GraphEventCreated.class));
    assertThat(json.getValue()).doesNotContain("\"attendees\"");
  }

  @Test
  void patchAttendees_patches_event_with_attendees_only() {
    client.patchAttendees(
        "tok",
        "EV9",
        java.util.List.of(new GraphAttendeeWrite(new GraphEmail("A", "a@x.com"), "required")));
    ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
    verify(api).patch(eq("tok"), eq("/me/events/EV9"), json.capture());
    assertThat(json.getValue()).contains("\"attendees\"");
    assertThat(json.getValue()).contains("\"a@x.com\"");
    // 본문·시각 필드는 보내지 않는다(attendees-only PATCH).
    assertThat(json.getValue()).doesNotContain("\"subject\"");
    assertThat(json.getValue()).doesNotContain("\"start\"");
  }

  @Test
  void rsvpFromGraphResponse_maps_all_states() {
    assertThat(GraphCalendarClient.rsvpFromGraphResponse("accepted")).isEqualTo("ACCEPTED");
    assertThat(GraphCalendarClient.rsvpFromGraphResponse("declined")).isEqualTo("DECLINED");
    assertThat(GraphCalendarClient.rsvpFromGraphResponse("tentativelyAccepted"))
        .isEqualTo("TENTATIVE");
    assertThat(GraphCalendarClient.rsvpFromGraphResponse("none")).isEqualTo("NEEDS_ACTION");
    assertThat(GraphCalendarClient.rsvpFromGraphResponse("notResponded")).isEqualTo("NEEDS_ACTION");
    assertThat(GraphCalendarClient.rsvpFromGraphResponse(null)).isEqualTo("NEEDS_ACTION");
  }
```

또한 기존 `timed()` 헬퍼와 다른 `new GraphEventWrite(...)` 생성자 호출들이 새 7번째 인자(attendees)로 깨진다 — 모든 기존 `GraphEventWrite(...)` 호출에 마지막 인자 `null` 추가:
- `timed()`, `noBodyNoLocation`, `allDay` 세 곳에 `, null` (location 다음).

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.mail.outbound.GraphCalendarClientWriteTest"`
Expected: 컴파일 실패 (새 레코드/메서드/생성자 인자 없음).

- [ ] **Step 3: 읽기 레코드 추가 + GraphEvent.attendees + $select**

`GraphCalendarClient.java`:

`GraphEvent` 레코드에 `attendees` 필드 추가:
```java
  public record GraphEvent(
      String id,
      String subject,
      String bodyPreview,
      GraphDateTime start,
      GraphDateTime end,
      boolean isAllDay,
      GraphLocation location,
      GraphRecipient organizer,
      List<GraphEventAttendee> attendees,
      boolean isCancelled) {}
```

`GraphRecipient` 레코드 근처에 추가:
```java
  /** Graph attendee 항목 — emailAddress + status(응답상태) + type(required|optional). */
  public record GraphEventAttendee(
      GraphEmail emailAddress, GraphAttendeeStatus status, String type) {}

  /** Graph attendee 응답상태 — response(none|accepted|declined|tentativelyAccepted|notResponded). */
  public record GraphAttendeeStatus(String response, String time) {}
```

`listCalendarView` 의 `$select` 에 `attendees` 추가 (기존 `...,organizer,isCancelled`):
```java
            + "&$select=id,subject,bodyPreview,start,end,isAllDay,location,organizer,attendees,isCancelled"
```

- [ ] **Step 4: 쓰기 레코드 추가 + GraphEventWrite.attendees + patchAttendees + rsvp 매핑**

`GraphEventWrite` 레코드에 `attendees` 추가 (NON_NULL 어노테이션 이미 있음):
```java
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record GraphEventWrite(
      String subject,
      GraphItemBody body,
      GraphDateTime start,
      GraphDateTime end,
      boolean isAllDay,
      GraphLocation location,
      List<GraphAttendeeWrite> attendees) {}
```

쓰기 attendee 레코드 + attendees-only PATCH 봉투 추가:
```java
  /** Graph 일정 쓰기 attendee — emailAddress + type("required"). */
  public record GraphAttendeeWrite(GraphEmail emailAddress, String type) {}

  /** attendees 만 갱신하는 부분 PATCH 봉투(제목·시각 등 다른 필드 미전송). */
  public record GraphAttendeesPatch(List<GraphAttendeeWrite> attendees) {}
```

`patchAttendees` 메서드 추가 (`updateEvent` 뒤):
```java
  /**
   * 외부 일정의 참석자 컬렉션만 교체한다(PATCH /me/events/{id}, body={"attendees":[...]}).
   *
   * <p>제목·시각 등은 보내지 않아 Graph 측 다른 필드를 덮어쓰지 않는다(부분 PATCH).
   */
  public void patchAttendees(
      String accessToken, String externalEventId, List<GraphAttendeeWrite> attendees) {
    String json = serializeAttendees(new GraphAttendeesPatch(attendees));
    api.patch(accessToken, "/me/events/" + externalEventId, json);
  }
```

`serialize` 옆에 직렬화 헬퍼 추가 (기존 `serialize(GraphEventWrite)` 와 동일 패턴):
```java
  private String serializeAttendees(GraphAttendeesPatch patch) {
    try {
      return mapper.writeValueAsString(patch);
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new com.workplace.mail.exception.MailSendException("Graph 참석자 직렬화 실패", e);
    }
  }
```

RSVP 매핑 static 메서드 추가 (클래스 내):
```java
  /** Graph attendee responseStatus.response → 로컬 rsvp_status. 미인식·null 은 NEEDS_ACTION. */
  public static String rsvpFromGraphResponse(String response) {
    if (response == null) return "NEEDS_ACTION";
    return switch (response) {
      case "accepted", "organizer" -> "ACCEPTED";
      case "declined" -> "DECLINED";
      case "tentativelyAccepted" -> "TENTATIVE";
      default -> "NEEDS_ACTION"; // none, notResponded, 기타
    };
  }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.mail.outbound.GraphCalendarClientWriteTest"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd apps/workplace-api && ./gradlew spotlessApply
git add apps/workplace-api/src/main/java/com/workplace/mail/outbound/GraphCalendarClient.java apps/workplace-api/src/test/java/com/workplace/mail/outbound/GraphCalendarClientWriteTest.java
git commit -m "feat(calendar): GraphCalendarClient attendee 읽기/쓰기 레코드 + patchAttendees (#547)"
```

---

### Task 4: 읽기 동기화 — 참석자 diff-sync

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/calendar/service/GraphCalendarFetcher.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/calendar/service/GraphCalendarSyncTest.java` (extend)

**Interfaces:**
- Consumes: `GraphEvent.attendees()`/`organizer()`(Task 3), `EventAttendeeRepository` 외부 메서드(Task 2), `UserRepository.findByEmailIgnoreCase`(Task 2), `upsertExternalEvent` 반환 `long`(기존), `rsvpFromGraphResponse`(Task 3).
- Produces: 읽기 동기화 시 writable 외부 일정의 `event_attendee` 행이 Graph organizer+attendees 와 일치하도록 diff-upsert.

**설계 노트:**
- writable 캘린더(`cal.canEdit()==true`)의 이벤트만 참석자 sync — 공휴일/생일(read-only)은 skip(노이즈 회피).
- 조직자/참석자 없으면(organizer null && attendees 비거나 null) skip.
- 이메일 매칭 우선순위: ① 동기화 계정 이메일(`account.emailAddress()`)과 같으면 → 동기화 user(`syncUserId`) (별칭/프록시로 user.email 과 달라도 자기 일정 보존), ② `findByEmailIgnoreCase`, ③ 외부 행.
- diff: target(organizer ORGANIZER/ACCEPTED + attendees ATTENDEE/매핑rsvp) vs 기존 행. 추가 insert, rsvp 변경 update, target 에 없는 기존 삭제. ORGANIZER 행은 organizer 가 항상 target 에 포함되므로 자연 보존.

- [ ] **Step 1: 실패하는 테스트 작성**

`GraphCalendarSyncTest.java` 에 추가 (기존 `@MockitoBean GraphCalendarClient graphCalendarClient` 사용). 헬퍼와 테스트:
```java
  /** Graph 이벤트 1건(조직자+참석자) 빌더. */
  private com.workplace.mail.outbound.GraphCalendarClient.GraphEvent graphEventWith(
      String id,
      String organizerEmail,
      java.util.List<com.workplace.mail.outbound.GraphCalendarClient.GraphEventAttendee> attendees) {
    var start = new com.workplace.mail.outbound.GraphCalendarClient.GraphDateTime("2026-07-10T09:00:00.0000000", "UTC");
    var end = new com.workplace.mail.outbound.GraphCalendarClient.GraphDateTime("2026-07-10T10:00:00.0000000", "UTC");
    var organizer =
        new com.workplace.mail.outbound.GraphCalendarClient.GraphRecipient(
            new com.workplace.mail.outbound.GraphCalendarClient.GraphEmail("주최", organizerEmail));
    return new com.workplace.mail.outbound.GraphCalendarClient.GraphEvent(
        id, "동기화 회의", "본문", start, end, false, null, organizer, attendees, false);
  }

  private com.workplace.mail.outbound.GraphCalendarClient.GraphEventAttendee attendee(
      String name, String email, String response) {
    return new com.workplace.mail.outbound.GraphCalendarClient.GraphEventAttendee(
        new com.workplace.mail.outbound.GraphCalendarClient.GraphEmail(name, email),
        new com.workplace.mail.outbound.GraphCalendarClient.GraphAttendeeStatus(response, null),
        "required");
  }

  @Test
  void sync_maps_internal_and_external_attendees_with_rsvp() {
    // writable 캘린더 1개 + 이벤트 1건(내부 user 1명 + 외부 1명).
    var cal =
        new com.workplace.mail.outbound.GraphCalendarClient.GraphCalendar(
            "gcal", "Calendar", "auto", "#0078d4", true, true);
    long internalAttendeeId =
        new TransactionTemplate(txManager)
            .execute(s -> TestFixtures.createHumanWithEmail(dsl, "member@iacloud.kr"));

    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok")).thenReturn(java.util.List.of(cal));
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcal"), any(), any()))
        .thenReturn(
            java.util.List.of(
                graphEventWith(
                    "EVT1",
                    "organizer@partner.com", // 외부 조직자
                    java.util.List.of(
                        attendee("멤버", "member@iacloud.kr", "accepted"), // 내부 매칭
                        attendee("Guest", "guest@other.com", "declined"))))); // 외부

    syncService.syncForUser(ownerId);

    var rows =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long evtId =
                      dsl.select(CALENDAR_EVENT.ID)
                          .from(CALENDAR_EVENT)
                          .where(CALENDAR_EVENT.EXTERNAL_ID.eq("EVT1"))
                          .fetchOne(CALENDAR_EVENT.ID);
                  return attendeeRepo.findByEvent(evtId);
                });

    // 조직자(외부) + 내부 멤버 + 외부 게스트 = 3행.
    assertThat(rows).hasSize(3);
    assertThat(rows)
        .anySatisfy(
            r -> {
              assertThat(r.role()).isEqualTo("ORGANIZER");
              assertThat(r.externalEmail()).isEqualTo("organizer@partner.com");
              assertThat(r.rsvpStatus()).isEqualTo("ACCEPTED");
            });
    assertThat(rows)
        .anySatisfy(
            r -> {
              assertThat(r.userId()).isEqualTo(internalAttendeeId);
              assertThat(r.rsvpStatus()).isEqualTo("ACCEPTED");
            });
    assertThat(rows)
        .anySatisfy(
            r -> {
              assertThat(r.externalEmail()).isEqualTo("guest@other.com");
              assertThat(r.rsvpStatus()).isEqualTo("DECLINED");
            });

    cleanupInTenant(
        TENANT_ID, () -> dsl.execute("DELETE FROM \"user\" WHERE id = ?", internalAttendeeId));
  }

  @Test
  void sync_removes_attendee_no_longer_in_graph() {
    var cal =
        new com.workplace.mail.outbound.GraphCalendarClient.GraphCalendar(
            "gcal", "Calendar", "auto", "#0078d4", true, true);
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok")).thenReturn(java.util.List.of(cal));

    // 1차 sync: 외부 게스트 2명.
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcal"), any(), any()))
        .thenReturn(
            java.util.List.of(
                graphEventWith(
                    "EVT2",
                    "org@partner.com",
                    java.util.List.of(
                        attendee("A", "a@x.com", "none"), attendee("B", "b@x.com", "none")))));
    syncService.syncForUser(ownerId);

    // 2차 sync: A 만 남음.
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcal"), any(), any()))
        .thenReturn(
            java.util.List.of(
                graphEventWith(
                    "EVT2", "org@partner.com", java.util.List.of(attendee("A", "a@x.com", "none")))));
    syncService.syncForUser(ownerId);

    var rows =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long evtId =
                      dsl.select(CALENDAR_EVENT.ID)
                          .from(CALENDAR_EVENT)
                          .where(CALENDAR_EVENT.EXTERNAL_ID.eq("EVT2"))
                          .fetchOne(CALENDAR_EVENT.ID);
                  return attendeeRepo.findByEvent(evtId);
                });
    // 조직자 + A = 2행 (B 삭제됨).
    assertThat(rows).extracting(r -> r.externalEmail()).doesNotContain("b@x.com");
    assertThat(rows).extracting(r -> r.externalEmail()).contains("a@x.com");
  }
```

테스트 의존: `attendeeRepo` 가 테스트 클래스에 autowired 돼야 함 — 없으면 `@Autowired EventAttendeeRepository attendeeRepo;` 추가. `TestFixtures.createHumanWithEmail(dsl, email)` 헬퍼가 없으면 추가(아래 Step 1b).

- [ ] **Step 1b: TestFixtures 헬퍼(필요 시)**

`apps/workplace-api/src/test/java/com/workplace/support/TestFixtures.java` 에 `createHumanWithEmail` 이 없으면 추가:
```java
  /** 지정 이메일로 HUMAN 사용자 생성 — 외부 캘린더 참석자 매칭 테스트용. */
  public static long createHumanWithEmail(DSLContext dsl, String email) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, email)
        .set(USER.EMAIL, email)
        .set(USER.NAME, "Member " + email)
        .set(USER.PASSWORD_HASH, "x")
        .set(USER.IS_ACTIVE, true)
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }
```
(기존 `createHuman` 의 컬럼 set 패턴을 그대로 따른다 — 실제 `createHuman` 본문을 확인해 누락 컬럼이 있으면 맞춘다.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.calendar.service.GraphCalendarSyncTest"`
Expected: 컴파일 또는 단언 실패 (참석자 행이 만들어지지 않음).

- [ ] **Step 3: GraphCalendarFetcher 의존성 추가**

`GraphCalendarFetcher.java` — 생성자에 `EventAttendeeRepository`, `UserRepository` 추가:
```java
  private final EventAttendeeRepository attendeeRepo;
  private final UserRepository userRepo;

  public GraphCalendarFetcher(
      GraphTokenService tokenService,
      GraphCalendarClient graphClient,
      ExternalCalendarRepository extRepo,
      EventAttendeeRepository attendeeRepo,
      UserRepository userRepo,
      PlatformTransactionManager txManager) {
    this.tokenService = tokenService;
    this.graphClient = graphClient;
    this.extRepo = extRepo;
    this.attendeeRepo = attendeeRepo;
    this.userRepo = userRepo;
    this.txTemplate = new TransactionTemplate(txManager);
  }
```
import 추가: `com.workplace.calendar.repository.EventAttendeeRepository`, `com.workplace.user.repository.UserRepository`, `com.workplace.mail.outbound.GraphCalendarClient.GraphEvent`, `GraphEventAttendee`.

- [ ] **Step 4: sync 루프에서 eventId 캡처 + 참석자 sync 호출**

`sync()` 의 이벤트 upsert 루프를 수정 — `upsertExternalEvent` 반환값(local eventId) 캡처 후 writable 일 때 참석자 sync:
```java
          for (GraphEvent evt : events) {
            if (evt.isCancelled()) {
              continue;
            }
            ExternalEventRow row = mapEvent(evt);
            long localEventId = extRepo.upsertExternalEvent(userId, calId, evt.id(), row);
            // writable 캘린더의 일정만 참석자 동기화(공휴일·생일 등 read-only 는 skip).
            if (cal.canEdit()) {
              syncAttendees(localEventId, evt, userId, account.emailAddress());
            }
            keep.add(evt.id());
            count[0]++;
          }
```

- [ ] **Step 5: syncAttendees 메서드 구현**

`GraphCalendarFetcher.java` 에 추가 (private):
```java
  /**
   * 한 외부 일정의 참석자를 Graph organizer+attendees 와 일치하도록 diff-upsert 한다.
   *
   * <p>이메일 매칭: ① 동기화 계정 이메일이면 동기화 user, ② findByEmailIgnoreCase, ③ 외부 행. organizer 는 ORGANIZER/ACCEPTED,
   * attendees 는 ATTENDEE + responseStatus 매핑. target 에 없는 기존 행은 삭제(organizer 는 target 에 항상 포함돼 보존).
   */
  private void syncAttendees(long eventId, GraphEvent evt, long syncUserId, String syncAccountEmail) {
    boolean hasAttendees = evt.attendees() != null && !evt.attendees().isEmpty();
    boolean hasOrganizer = evt.organizer() != null && evt.organizer().emailAddress() != null;
    if (!hasAttendees && !hasOrganizer) return; // 참석자 정보 없음 — 건드리지 않음

    // 1) target 구성: identity(키) → 행 스펙.
    record Spec(Long userId, String externalEmail, String externalName, String role, String rsvp) {}
    java.util.Map<String, Spec> target = new java.util.LinkedHashMap<>();

    if (hasOrganizer) {
      var em = evt.organizer().emailAddress();
      Spec s = resolveSpec(em.name(), em.address(), "ORGANIZER", "ACCEPTED", syncUserId, syncAccountEmail);
      target.put(identity(s.userId(), s.externalEmail()), s);
    }
    if (hasAttendees) {
      for (var a : evt.attendees()) {
        if (a.emailAddress() == null || a.emailAddress().address() == null) continue;
        String rsvp =
            GraphCalendarClient.rsvpFromGraphResponse(a.status() == null ? null : a.status().response());
        Spec s =
            resolveSpec(
                a.emailAddress().name(), a.emailAddress().address(), "ATTENDEE", rsvp, syncUserId,
                syncAccountEmail);
        // 조직자가 attendees 에도 들어오면(드묾) ORGANIZER 우선 — 이미 있으면 덮어쓰지 않음.
        target.putIfAbsent(identity(s.userId(), s.externalEmail()), s);
      }
    }

    // 2) 기존 행 로드 + identity 집합.
    var existing = attendeeRepo.findByEvent(eventId);
    java.util.Set<String> existingIds = new java.util.HashSet<>();
    for (var r : existing) existingIds.add(identity(r.userId(), r.externalEmail()));

    // 3) 삭제: 기존에 있지만 target 에 없는 행.
    for (var r : existing) {
      String id = identity(r.userId(), r.externalEmail());
      if (!target.containsKey(id)) {
        if (r.userId() != null) attendeeRepo.deleteByEventAndUser(eventId, r.userId());
        else attendeeRepo.deleteByEventAndExternalEmail(eventId, r.externalEmail());
      }
    }

    // 4) 추가/갱신.
    for (var e : target.entrySet()) {
      Spec s = e.getValue();
      if (!existingIds.contains(e.getKey())) {
        if (s.userId() != null)
          attendeeRepo.insert(eventId, s.userId(), null, s.role(), s.rsvp());
        else attendeeRepo.insertExternal(eventId, s.externalEmail(), s.externalName(), s.role(), s.rsvp());
      } else if (!"ORGANIZER".equals(s.role())) {
        // RSVP 변경 반영(조직자는 항상 ACCEPTED 고정 — 갱신 안 함).
        if (s.userId() != null) attendeeRepo.updateRsvp(eventId, s.userId(), s.rsvp());
        else attendeeRepo.updateRsvpByExternalEmail(eventId, s.externalEmail(), s.rsvp());
      }
    }
  }

  /** 이메일 → 내부 user(매칭) 또는 외부 스펙 결정. */
  private Spec resolveSpec(
      String name, String email, String role, String rsvp, long syncUserId, String syncAccountEmail) {
    if (syncAccountEmail != null && syncAccountEmail.equalsIgnoreCase(email)) {
      return new Spec(syncUserId, null, null, role, rsvp);
    }
    var matched = userRepo.findByEmailIgnoreCase(email).map(u -> u.id()).orElse(null);
    if (matched != null) return new Spec(matched, null, null, role, rsvp);
    return new Spec(null, email, name, role, rsvp);
  }

  /** 내부/외부 참석자 동일성 키. */
  private static String identity(Long userId, String externalEmail) {
    return userId != null ? "U:" + userId : "E:" + externalEmail.toLowerCase();
  }
```
**주의:** `Spec` 레코드를 `syncAttendees` 안의 로컬 record 로 두면 `resolveSpec` 에서 못 쓴다 → `Spec` 을 **클래스 레벨 private static record** 로 올린다:
```java
  /** 참석자 diff 행 스펙(내부 userId 또는 외부 email). */
  private record Spec(
      Long userId, String externalEmail, String externalName, String role, String rsvp) {}
```
그리고 `syncAttendees` 안의 로컬 `record Spec` 선언은 제거.

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.calendar.service.GraphCalendarSyncTest"`
Expected: PASS (기존 + 신규 2 테스트).

- [ ] **Step 7: 전체 calendar 회귀 + 커밋**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.calendar.*"`
Expected: PASS.
```bash
cd apps/workplace-api && ./gradlew spotlessApply
git add apps/workplace-api/src/main/java/com/workplace/calendar/service/GraphCalendarFetcher.java apps/workplace-api/src/test/java/com/workplace/calendar/service/GraphCalendarSyncTest.java apps/workplace-api/src/test/java/com/workplace/support/TestFixtures.java
git commit -m "feat(calendar): 읽기 동기화 참석자 diff-sync (#547)"
```

---

### Task 5: 쓰기 — create 시 참석자 Graph 전송

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/calendar/service/CalendarEventService.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/calendar/service/CalendarEventExternalWriteTest.java` (extend; 없으면 create)

**Interfaces:**
- Consumes: `GraphAttendeeWrite`(Task 3), `WriteTarget`(기존), `userRepo.findByIds`(기존).
- Produces: `WriteTarget` 에 `List<GraphAttendeeWrite> attendees` 필드, `toGraphWrite(CalendarEventRequest req, List<GraphAttendeeWrite> attendees)` 시그니처.

- [ ] **Step 1: 실패하는 테스트 작성**

기존 외부 쓰기 테스트 클래스(예: `CalendarEventExternalWriteTest`)를 찾아 패턴을 따른다(`@MockitoBean CalendarTransport` 또는 `GraphCalendarClient`/`GraphTokenService` 목). 없으면 `GraphCalendarSyncTest` 패턴으로 신규. 핵심 테스트:
```java
  @Test
  void create_on_external_calendar_sends_attendees_to_graph() {
    // writable 외부 캘린더 + 내부 멤버 1명 초대.
    long memberId =
        new TransactionTemplate(txManager)
            .execute(s -> TestFixtures.createHumanWithEmail(dsl, "invitee@iacloud.kr"));
    long externalCalId = seedWritableExternalCalendar(); // 헬퍼: external_account_id+external_id, is_read_only=false

    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn("tok");
    when(graphCalendarClient.createEvent(eq("tok"), anyString(), any())).thenReturn("EXT-NEW");

    var req =
        new CalendarEventRequest(
            "외부 회의", null,
            OffsetDateTime.now(), OffsetDateTime.now().plusHours(1),
            false, null, null, null, null,
            java.util.List.of(memberId), externalCalId);
    eventService.create(ownerId, req);

    ArgumentCaptor<GraphEventWrite> body = ArgumentCaptor.forClass(GraphEventWrite.class);
    verify(graphCalendarClient).createEvent(eq("tok"), anyString(), body.capture());
    assertThat(body.getValue().attendees()).isNotNull();
    assertThat(body.getValue().attendees())
        .anySatisfy(a -> assertThat(a.emailAddress().address()).isEqualTo("invitee@iacloud.kr"));

    cleanupInTenant(TENANT_ID, () -> dsl.execute("DELETE FROM \"user\" WHERE id = ?", memberId));
  }

  @Test
  void create_on_local_calendar_does_not_call_graph() {
    var req =
        new CalendarEventRequest(
            "로컬 회의", null,
            OffsetDateTime.now(), OffsetDateTime.now().plusHours(1),
            false, null, null, null, null, null, null);
    eventService.create(ownerId, req);
    verify(graphCalendarClient, never()).createEvent(any(), any(), any());
  }
```
`seedWritableExternalCalendar()` 헬퍼: `email_account`(M365_GRAPH) + `calendar`(external_account_id, external_id="ext-cal", is_read_only=false) 행을 tx 안에서 생성하고 calendar id 반환. `GraphCalendarSyncTest.seedGraphAccount` 패턴 재사용.

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "*CalendarEventExternalWriteTest"`
Expected: `attendees()` 가 null (아직 미전송) → 단언 실패.

- [ ] **Step 3: WriteTarget + resolveWriteTarget 에 attendees 추가**

`CalendarEventService.java`:

`WriteTarget` 레코드에 attendees 추가:
```java
  private record WriteTarget(
      long calendarId,
      boolean externalWritable,
      EmailAccountResponse account,
      String externalCalendarId,
      List<GraphAttendeeWrite> attendees) {}
```

`resolveWriteTarget` 의 세 return 을 수정 — 비외부는 attendees=null, 외부는 해석:
```java
  private WriteTarget resolveWriteTarget(long callerId, CalendarEventRequest req) {
    long calendarId = resolveCalendarId(callerId, req.calendarId());
    var ext = calendarRepo.findExternalRef(calendarId).orElse(null);
    if (ext == null || ext.externalAccountId() == null) {
      return new WriteTarget(calendarId, false, null, null, null);
    }
    EmailAccountResponse account =
        emailAccountRepo.findByIdAndUser(callerId, ext.externalAccountId()).orElse(null);
    if (account == null) {
      return new WriteTarget(calendarId, false, null, null, null);
    }
    // 외부 쓰기 — 초대 대상(내부 user)을 Graph attendee(이메일)로 해석. AGENT·주최자 본인 제외.
    List<GraphAttendeeWrite> attendees = resolveGraphAttendees(callerId, req.attendeeUserIdsOrEmpty());
    return new WriteTarget(calendarId, true, account, ext.externalId(), attendees);
  }

  /** 내부 user id 목록 → Graph attendee(이메일). AGENT·주최자 제외. 비면 null(페이로드 생략). */
  private List<GraphAttendeeWrite> resolveGraphAttendees(long callerId, List<Long> userIds) {
    List<GraphAttendeeWrite> list =
        userRepo.findByIds(userIds).stream()
            .filter(u -> u.id() != callerId)
            .filter(u -> !"AGENT".equals(u.kind()))
            .map(u -> new GraphAttendeeWrite(new GraphEmail(u.name(), u.email()), "required"))
            .toList();
    return list.isEmpty() ? null : list;
  }
```
import 추가: `com.workplace.mail.outbound.GraphCalendarClient.GraphAttendeeWrite`, `GraphEmail`.

- [ ] **Step 4: toGraphWrite 시그니처 변경 + 호출부 갱신**

`toGraphWrite` 에 attendees 파라미터 추가:
```java
  private GraphEventWrite toGraphWrite(CalendarEventRequest req, List<GraphAttendeeWrite> attendees) {
    GraphItemBody body =
        (req.description() == null || req.description().isBlank())
            ? null
            : new GraphItemBody("text", req.description());
    GraphLocation location =
        (req.location() == null || req.location().isBlank())
            ? null
            : new GraphLocation(req.location());
    return new GraphEventWrite(
        req.title(),
        body,
        toGraphDateTime(req.startsAt(), req.allDay()),
        toGraphDateTime(req.endsAt(), req.allDay()),
        req.allDay(),
        location,
        attendees);
  }
```

`create()` 의 HTTP 호출을 갱신:
```java
      externalId =
          transportFor(target.account().provider())
              .createEvent(
                  callerId, target.account(), target.externalCalendarId(),
                  toGraphWrite(req, target.attendees()));
```

`update()` 의 `toGraphWrite(req)` 호출(라인 366)을 갱신 — **update 는 참석자를 건드리지 않으므로 null**:
```java
      transportFor(ctx.account().provider())
          .updateEvent(callerId, ctx.account(), ctx.externalId(), toGraphWrite(req, null));
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "*CalendarEventExternalWriteTest"`
Expected: PASS.

- [ ] **Step 6: 전체 calendar 회귀 + 커밋**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.calendar.*"`
Expected: PASS.
```bash
cd apps/workplace-api && ./gradlew spotlessApply
git add apps/workplace-api/src/main/java/com/workplace/calendar/service/CalendarEventService.java apps/workplace-api/src/test/java/com/workplace/calendar/service/
git commit -m "feat(calendar): create 시 참석자 Graph 전송 (#547)"
```

---

### Task 6: invite/remove 오케스트레이터(주최자 게이트) + RSVP 가드

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/calendar/service/CalendarEventService.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/calendar/service/CalendarTransport.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/calendar/service/GraphCalendarTransport.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/calendar/exception/ExternalEventAttendeeNotOrganizerException.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/calendar/exception/ExternalEventRsvpNotSupportedException.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/calendar/service/CalendarEventExternalWriteTest.java` (extend)

**Interfaces:**
- Consumes: `attendeeRepo.isOrganizer`(Task 2), `patchAttendees`/`GraphAttendeeWrite`(Task 3), `attendeeRepo.findByEvent`(Task 2), `repo.findExternalRef`(기존).
- Produces: `CalendarTransport.updateAttendees(long userId, EmailAccountResponse account, String externalEventId, List<GraphAttendeeWrite> attendees)`. 신규 예외 2종(409).

- [ ] **Step 1: 실패하는 테스트 작성**

`CalendarEventExternalWriteTest.java` 에 추가:
```java
  @Test
  void invite_on_external_organizer_event_patches_graph_with_full_list() {
    // 내가 주최한 외부 일정 + 기존 외부 참석자 1명, 새 내부 멤버 초대.
    long memberId =
        new TransactionTemplate(txManager)
            .execute(s -> TestFixtures.createHumanWithEmail(dsl, "newinvitee@iacloud.kr"));
    long eventId =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long e = seedExternalEventOwnedBy(ownerId); // external_id="EXT-EVT", organizer=ownerId
                  attendeeRepo.insert(e, ownerId, null, "ORGANIZER", "ACCEPTED");
                  attendeeRepo.insertExternal(e, "old@guest.com", "Old", "ATTENDEE", "ACCEPTED");
                  return e;
                });
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn("tok");

    eventService.inviteAttendees(ownerId, eventId, java.util.List.of(memberId));

    @SuppressWarnings("unchecked")
    ArgumentCaptor<java.util.List<GraphAttendeeWrite>> cap =
        ArgumentCaptor.forClass(java.util.List.class);
    verify(graphCalendarClient).patchAttendees(eq("tok"), eq("EXT-EVT"), cap.capture());
    var emails = cap.getValue().stream().map(a -> a.emailAddress().address()).toList();
    assertThat(emails).contains("old@guest.com", "newinvitee@iacloud.kr"); // 전체 목록
    cleanupInTenant(TENANT_ID, () -> dsl.execute("DELETE FROM \"user\" WHERE id = ?", memberId));
  }

  @Test
  void invite_on_external_event_when_not_organizer_is_rejected() {
    long eventId =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long e = seedExternalEventOwnedBy(ownerId);
                  // 외부 조직자 — owner 는 ATTENDEE 일 뿐.
                  attendeeRepo.insertExternal(e, "boss@partner.com", "Boss", "ORGANIZER", "ACCEPTED");
                  attendeeRepo.insert(e, ownerId, null, "ATTENDEE", "NEEDS_ACTION");
                  return e;
                });
    assertThatThrownBy(() -> eventService.inviteAttendees(ownerId, eventId, java.util.List.of(ownerId)))
        .isInstanceOf(
            com.workplace.calendar.exception.ExternalEventAttendeeNotOrganizerException.class);
    verify(graphCalendarClient, never()).patchAttendees(any(), any(), any());
  }

  @Test
  void invite_on_local_event_does_not_call_graph() {
    long eventId =
        new TransactionTemplate(txManager).execute(s -> seedLocalEventOwnedBy(ownerId));
    long memberId =
        new TransactionTemplate(txManager).execute(s -> TestFixtures.createHuman(dsl));
    eventService.inviteAttendees(ownerId, eventId, java.util.List.of(memberId));
    verify(graphCalendarClient, never()).patchAttendees(any(), any(), any());
    cleanupInTenant(TENANT_ID, () -> dsl.execute("DELETE FROM \"user\" WHERE id = ?", memberId));
  }

  @Test
  void rsvp_on_external_event_is_rejected() {
    long eventId =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long e = seedExternalEventOwnedBy(ownerId);
                  attendeeRepo.insert(e, ownerId, null, "ATTENDEE", "NEEDS_ACTION");
                  return e;
                });
    assertThatThrownBy(() -> eventService.respondRsvp(ownerId, eventId, "ACCEPTED"))
        .isInstanceOf(
            com.workplace.calendar.exception.ExternalEventRsvpNotSupportedException.class);
  }
```
헬퍼 `seedExternalEventOwnedBy(ownerId)`(external_id="EXT-EVT", external 캘린더), `seedLocalEventOwnedBy(ownerId)`(로컬 캘린더) 를 테스트에 추가.

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "*CalendarEventExternalWriteTest"`
Expected: 컴파일 실패(예외/메서드 없음).

- [ ] **Step 3: 신규 예외 2종**

`apps/workplace-api/src/main/java/com/workplace/calendar/exception/ExternalEventAttendeeNotOrganizerException.java`:
```java
package com.workplace.calendar.exception;

/** 동기화로 받은(내가 주최자 아님) 외부 일정의 참석자 변경 시도 — 409. */
public class ExternalEventAttendeeNotOrganizerException extends RuntimeException {
  public ExternalEventAttendeeNotOrganizerException() {
    super("동기화로 받은 일정의 참석자는 변경할 수 없습니다(주최자가 아님).");
  }
}
```

`apps/workplace-api/src/main/java/com/workplace/calendar/exception/ExternalEventRsvpNotSupportedException.java`:
```java
package com.workplace.calendar.exception;

/** 외부 동기화 일정의 인앱 RSVP 시도 — 409(역전송 미지원, 다음 sync 가 덮어씀). */
public class ExternalEventRsvpNotSupportedException extends RuntimeException {
  public ExternalEventRsvpNotSupportedException() {
    super("외부 캘린더 일정의 참석 여부는 원본(예: Outlook)에서 응답해야 합니다.");
  }
}
```

- [ ] **Step 4: GlobalExceptionHandler 매핑(409)**

`GlobalExceptionHandler.java` — 기존 `ReadOnlyCalendarException` 핸들러 패턴 미러로 추가:
```java
  @ExceptionHandler(
      com.workplace.calendar.exception.ExternalEventAttendeeNotOrganizerException.class)
  public ResponseEntity<ErrorResponse> handleExternalEventAttendeeNotOrganizer(
      com.workplace.calendar.exception.ExternalEventAttendeeNotOrganizerException ex,
      HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.CONFLICT).body(response);
  }

  @ExceptionHandler(com.workplace.calendar.exception.ExternalEventRsvpNotSupportedException.class)
  public ResponseEntity<ErrorResponse> handleExternalEventRsvpNotSupported(
      com.workplace.calendar.exception.ExternalEventRsvpNotSupportedException ex,
      HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.CONFLICT).body(response);
  }
```

- [ ] **Step 5: CalendarTransport.updateAttendees seam**

`CalendarTransport.java` 인터페이스에 추가:
```java
  /** 외부 일정의 참석자 컬렉션만 교체(attendees-only PATCH). */
  void updateAttendees(
      long userId,
      EmailAccountResponse account,
      String externalEventId,
      java.util.List<com.workplace.mail.outbound.GraphCalendarClient.GraphAttendeeWrite> attendees);
```

`GraphCalendarTransport.java` 구현 추가:
```java
  @Override
  public void updateAttendees(
      long userId,
      EmailAccountResponse account,
      String externalEventId,
      java.util.List<com.workplace.mail.outbound.GraphCalendarClient.GraphAttendeeWrite> attendees) {
    try {
      String token = tokenService.getAccessToken(userId, account.id());
      graphClient.patchAttendees(token, externalEventId, attendees);
    } catch (RuntimeException e) {
      throw new ExternalCalendarWriteException("Graph 참석자 갱신 실패", e);
    }
  }
```

- [ ] **Step 6: inviteAttendees / removeAttendee 오케스트레이터 전환**

`CalendarEventService.java` — `@Transactional inviteAttendees` 와 `removeAttendee` 를 비-@Transactional 오케스트레이터로 교체:
```java
  /**
   * 참석자 추가. 외부(내가 주최한) 일정이면 Graph 참석자 컬렉션을 갱신 후 로컬 반영. 비주최자의 외부 일정 변경은 거부(409).
   *
   * <p>비-@Transactional: Graph HTTP 는 txTemplate 밖에서 실행(#232/#492 회피).
   */
  public void inviteAttendees(long callerId, long eventId, List<Long> userIds) {
    // ① resolve(tx): owner·RO 검증 + 외부참조 + (외부면) 조직자 판정 + Graph 전송 목록 사전 계산.
    InviteCtx ctx =
        txTemplate.execute(
            s -> {
              requireOwner(callerId, eventId);
              requireWritableEvent(eventId);
              var ref = repo.findExternalRef(eventId).orElse(null);
              boolean external =
                  ref != null && ref.externalAccountId() != null && ref.eventExternalId() != null;
              if (!external) {
                return new InviteCtx(false, null, null, null);
              }
              if (!attendeeRepo.isOrganizer(eventId, callerId)) {
                throw new ExternalEventAttendeeNotOrganizerException();
              }
              EmailAccountResponse acc =
                  emailAccountRepo.findByIdAndUser(callerId, ref.externalAccountId()).orElse(null);
              if (acc == null) return new InviteCtx(false, null, null, null);
              // 초대 후 전체 Graph attendee 목록(기존 HUMAN/외부 + 신규 HUMAN) 계산.
              List<GraphAttendeeWrite> full = buildGraphAttendees(eventId, userIds, null);
              return new InviteCtx(true, acc, ref.eventExternalId(), full);
            });

    // ② 외부면 Graph HTTP(tx 밖) — 가드 후 전송.
    if (ctx.external()) {
      if (TransactionSynchronizationManager.isActualTransactionActive()) {
        throw new ExternalCalendarWriteInTransactionException();
      }
      transportFor(ctx.account().provider())
          .updateAttendees(callerId, ctx.account(), ctx.externalId(), ctx.attendees());
    }

    // ③ 로컬 반영(tx) — 기존 동작 보존(AGENT 포함 로컬 행 + 알림).
    txTemplate.execute(
        s -> {
          for (Long uid : userIds) {
            if (uid == null || uid == callerId) continue;
            String status = isAgent(uid) ? "ACCEPTED" : "NEEDS_ACTION";
            attendeeRepo.insert(eventId, uid, callerId, "ATTENDEE", status);
            if (!isAgent(uid)) {
              eventPublisher.publishEvent(new CalendarAttendeeInvitedEvent(eventId, uid, callerId));
            }
          }
          return null;
        });
  }

  /**
   * 참석자 제거. 외부(내가 주최한) 일정이면 Graph 참석자 컬렉션 갱신 후 로컬 삭제. 비주최자 외부 변경 거부(409). AGENT 제거는 로컬 전용.
   */
  public void removeAttendee(long callerId, long eventId, long userId) {
    RemoveCtx ctx =
        txTemplate.execute(
            s -> {
              requireOwner(callerId, eventId);
              requireWritableEvent(eventId);
              if (userId == callerId) {
                return new RemoveCtx(false, false, null, null, null); // 주최자 본인 보호 — 아무것도 안 함
              }
              var ref = repo.findExternalRef(eventId).orElse(null);
              boolean external =
                  ref != null && ref.externalAccountId() != null && ref.eventExternalId() != null;
              if (!external) {
                return new RemoveCtx(true, false, null, null, null);
              }
              if (!attendeeRepo.isOrganizer(eventId, callerId)) {
                throw new ExternalEventAttendeeNotOrganizerException();
              }
              // AGENT 는 Graph 에 없음 → HTTP 불필요(로컬만 삭제).
              boolean agent = isAgent(userId);
              EmailAccountResponse acc =
                  emailAccountRepo.findByIdAndUser(callerId, ref.externalAccountId()).orElse(null);
              if (acc == null || agent) {
                return new RemoveCtx(true, false, null, null, null);
              }
              List<GraphAttendeeWrite> remaining = buildGraphAttendees(eventId, List.of(), userId);
              return new RemoveCtx(true, true, acc, ref.eventExternalId(), remaining);
            });

    if (!ctx.proceed()) return;

    if (ctx.external()) {
      if (TransactionSynchronizationManager.isActualTransactionActive()) {
        throw new ExternalCalendarWriteInTransactionException();
      }
      transportFor(ctx.account().provider())
          .updateAttendees(callerId, ctx.account(), ctx.externalId(), ctx.attendees());
    }

    txTemplate.execute(
        s -> {
          attendeeRepo.deleteByEventAndUser(eventId, userId);
          return null;
        });
  }
```

보조 record + 헬퍼 추가 (`CalendarEventService` 내):
```java
  private record InviteCtx(
      boolean external, EmailAccountResponse account, String externalId, List<GraphAttendeeWrite> attendees) {}

  private record RemoveCtx(
      boolean proceed,
      boolean external,
      EmailAccountResponse account,
      String externalId,
      List<GraphAttendeeWrite> attendees) {}

  /**
   * 일정의 Graph attendee 목록 계산 — 기존 ATTENDEE 행(HUMAN→user.email, 외부→external_email) + 신규 HUMAN userId
   * - 제외 userId. ORGANIZER·AGENT 는 제외(Graph attendees 는 조직자 미포함, AGENT 는 로컬 전용).
   */
  private List<GraphAttendeeWrite> buildGraphAttendees(
      long eventId, List<Long> addUserIds, Long excludeUserId) {
    List<GraphAttendeeWrite> out = new java.util.ArrayList<>();
    for (var r : attendeeRepo.findByEvent(eventId)) {
      if ("ORGANIZER".equals(r.role())) continue;
      if (excludeUserId != null && excludeUserId.equals(r.userId())) continue;
      if (r.userId() != null) {
        if ("AGENT".equals(r.kind())) continue; // AGENT 는 Graph 미전송
        userRepo
            .findById(r.userId())
            .ifPresent(u -> out.add(new GraphAttendeeWrite(new GraphEmail(u.name(), u.email()), "required")));
      } else {
        out.add(new GraphAttendeeWrite(new GraphEmail(r.name(), r.externalEmail()), "required"));
      }
    }
    for (Long uid : addUserIds) {
      if (uid == null) continue;
      userRepo
          .findById(uid)
          .filter(u -> !"AGENT".equals(u.kind()))
          .ifPresent(u -> out.add(new GraphAttendeeWrite(new GraphEmail(u.name(), u.email()), "required")));
    }
    return out;
  }
```

`respondRsvp` 에 외부 일정 가드 추가 (메서드 시작부, 기존 @Transactional 유지):
```java
  @Transactional
  public void respondRsvp(long callerId, long eventId, String status) {
    // 외부 동기화 일정은 인앱 RSVP 불가 — Graph 로 역전송 안 하므로 다음 sync 가 덮어쓴다.
    repo.findExternalRef(eventId)
        .filter(ref -> ref.eventExternalId() != null)
        .ifPresent(
            ref -> {
              throw new ExternalEventRsvpNotSupportedException();
            });
    int updated = attendeeRepo.updateRsvp(eventId, callerId, status);
    if (updated == 0) throw new CalendarEventNotFoundException(eventId);
    requireWritableEvent(eventId);
    repo.findOwnerId(eventId)
        .ifPresent(
            ownerId ->
                eventPublisher.publishEvent(
                    new CalendarRsvpChangedEvent(eventId, ownerId, callerId)));
  }
```
import 추가: 두 신규 예외, `java.util.ArrayList`(또는 fully-qualified). `inviteAttendees`/`removeAttendee` 의 `@Transactional` 제거(이제 오케스트레이터).

- [ ] **Step 7: 테스트 통과 + 전체 회귀 + 커밋**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.calendar.*"`
Expected: PASS.
```bash
cd apps/workplace-api && ./gradlew spotlessApply
git add apps/workplace-api/src/main/java/com/workplace/calendar/ apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java apps/workplace-api/src/test/java/com/workplace/calendar/
git commit -m "feat(calendar): invite/remove 주최자 게이트 오케스트레이터 + RSVP 외부 가드 (#547)"
```

---

### Task 7: 응답 DTO — 외부 참석자 + myRole/external 플래그

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/calendar/dto/AttendeeResponse.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/calendar/dto/CalendarEventResponse.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/calendar/service/CalendarEventService.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/calendar/service/CalendarEventAttendeeGetTest.java` (create 또는 기존 get 테스트 확장)

**Interfaces:**
- Produces:
  - `AttendeeResponse(Long userId, String username, String name, String kind, String role, String rsvpStatus, Long invitedByUserId, String externalEmail)`
  - `CalendarEventResponse` 에 `boolean external`, `String myRole` 추가(get 에서만 채움)

- [ ] **Step 1: 실패하는 테스트 작성**

```java
  @Test
  void get_external_event_returns_external_attendee_and_myRole_organizer() {
    long eventId =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long e = seedExternalEventOwnedBy(ownerId);
                  attendeeRepo.insert(e, ownerId, null, "ORGANIZER", "ACCEPTED");
                  attendeeRepo.insertExternal(e, "ext@guest.com", "Guest", "ATTENDEE", "DECLINED");
                  return e;
                });
    CalendarEventResponse resp =
        new TransactionTemplate(txManager).execute(s -> eventService.get(ownerId, eventId));

    assertThat(resp.external()).isTrue();
    assertThat(resp.myRole()).isEqualTo("ORGANIZER");
    assertThat(resp.attendees())
        .anySatisfy(
            a -> {
              assertThat(a.kind()).isEqualTo("EXTERNAL");
              assertThat(a.externalEmail()).isEqualTo("ext@guest.com");
              assertThat(a.userId()).isNull();
            });
  }
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "*CalendarEventAttendeeGetTest"`
Expected: 컴파일 실패(`external()`/`myRole()`/`externalEmail()` 없음).

- [ ] **Step 3: AttendeeResponse 확장**

`AttendeeResponse.java`:
```java
package com.workplace.calendar.dto;

/** 일정 참석자 응답. 외부(우리 user 아님) 참석자는 userId=null·kind="EXTERNAL"·externalEmail 채움. */
public record AttendeeResponse(
    Long userId,
    String username,
    String name,
    String kind,
    String role,
    String rsvpStatus,
    Long invitedByUserId,
    String externalEmail) {}
```

- [ ] **Step 4: CalendarEventResponse 에 external/myRole 추가**

`CalendarEventResponse.java` 레코드 컴포넌트 끝에 `boolean external`, `String myRole` 추가. **모든 생성 지점이 깨진다** — `repo` 의 매핑과 `withAttendeeInfo` 헬퍼를 확인해 기본값(external=false, myRole=null) 으로 채운다. `withAttendeeInfo` 가 새 인스턴스를 만들면 그 시그니처에 두 필드를 추가하거나, 별도 with 메서드를 둔다.

구현 가이드(실제 `withAttendeeInfo`/`repo.findById` 매핑 구조에 맞춰 적용):
- `repo` 의 row→`CalendarEventResponse` 매핑: `external=false, myRole=null` 로 생성.
- `enrichForGet` 가 외부 여부/내 역할을 채운다(아래 Step 5).
- `enrichForList` 는 `external=false, myRole=null` 유지(목록에선 불필요).

- [ ] **Step 5: enrichForGet 에서 external/myRole 채우기 + 외부 행 매핑**

`enrichForGet` 를 수정:
```java
  private CalendarEventResponse enrichForGet(long callerId, CalendarEventResponse e) {
    long key = e.masterEventId() != null ? e.masterEventId() : e.id();
    var rows = attendeeRepo.findByEvent(key);
    String mine =
        rows.stream()
            .filter(r -> r.userId() != null && r.userId() == callerId)
            .map(AttendeeRow::rsvpStatus)
            .findFirst()
            .orElse(null);
    String myRole =
        rows.stream()
            .filter(r -> r.userId() != null && r.userId() == callerId)
            .map(AttendeeRow::role)
            .findFirst()
            .orElse(null);
    var dtos =
        rows.stream()
            .map(
                r ->
                    new AttendeeResponse(
                        r.userId(),
                        r.username(),
                        r.name(),
                        r.kind(),
                        r.role(),
                        r.rsvpStatus(),
                        r.invitedByUserId(),
                        r.externalEmail()))
            .toList();
    boolean external =
        repo.findExternalRef(key).map(ref -> ref.eventExternalId() != null).orElse(false);
    return withAttendeeInfo(e, rows.size(), mine, dtos, external, myRole);
  }
```
`withAttendeeInfo` 시그니처를 `(CalendarEventResponse e, int count, String mine, List<AttendeeResponse> dtos, boolean external, String myRole)` 로 확장하고, 반환 인스턴스에 `external`/`myRole` 반영. `enrichForList` 의 `withAttendeeInfo(e, count, mine, null)` 호출은 `withAttendeeInfo(e, count, mine, null, false, null)` 로 갱신.

- [ ] **Step 6: 테스트 통과 + 회귀 + 커밋**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.calendar.*"`
Expected: PASS.
```bash
cd apps/workplace-api && ./gradlew spotlessApply
git add apps/workplace-api/src/main/java/com/workplace/calendar/
git commit -m "feat(calendar): 응답 DTO 외부 참석자 + external/myRole 플래그 (#547)"
```

---

### Task 8: 프론트엔드 — 외부 참석자 렌더 + 주최자 게이팅

**Files:**
- Modify: `apps/workplace-web/src/types/calendar.ts`
- Modify: `apps/workplace-web/src/components/calendar/AttendeeSection.tsx`
- Modify: `apps/workplace-web/src/components/calendar/EventDialog.tsx`
- Test: `apps/workplace-web/src/components/calendar/AttendeeSection.test.tsx` (create 또는 확장) + 기존 calendar E2E 회귀

**Interfaces:**
- Consumes: 백엔드 `AttendeeResponse.externalEmail`, `CalendarEvent.external/myRole`(Task 7).

- [ ] **Step 1: 타입 확장**

`types/calendar.ts` — `Attendee` 와 `CalendarEvent`:
```typescript
export interface Attendee {
  userId: number | null // 외부 참석자는 null
  username: string | null
  name: string
  kind: 'HUMAN' | 'AGENT' | 'EXTERNAL'
  role: AttendeeRole
  rsvpStatus: RsvpStatus
  invitedByUserId: number | null
  externalEmail: string | null
}
```
`CalendarEvent` 인터페이스에 추가:
```typescript
  // 외부 동기화 일정 여부(GET 에서만). true 면 참석자/RSVP 읽기 전용. (#547)
  external?: boolean
  // 현재 사용자의 참석자 역할(GET 에서만). 'ORGANIZER' 면 참석자 편집 가능. (#547)
  myRole?: string | null
```

- [ ] **Step 2: vitest — 외부 참석자 렌더**

`AttendeeSection.test.tsx` (없으면 생성, 기존 테스트 패턴 따름):
```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { AttendeeSection } from './AttendeeSection'
import type { Attendee } from '@/types/calendar'

const external: Attendee = {
  userId: null,
  username: null,
  name: 'Client Lee',
  kind: 'EXTERNAL',
  role: 'ATTENDEE',
  rsvpStatus: 'ACCEPTED',
  invitedByUserId: null,
  externalEmail: 'client@partner.com',
}

describe('AttendeeSection 외부 참석자', () => {
  it('외부 참석자의 이메일을 렌더한다', () => {
    render(<AttendeeSection selectedMembers={[]} onChange={() => {}} attendees={[external]} />)
    expect(screen.getByText('client@partner.com')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd apps/workplace-web && pnpm test -- AttendeeSection`
Expected: FAIL (이메일 미렌더 / key 타입 오류).

- [ ] **Step 4: AttendeeSection 외부 참석자 렌더**

`AttendeeSection.tsx` — 칩 렌더를 외부 참석자 대응으로 수정. `key={a.userId}` 는 외부 null 충돌 → 안정 키로 변경. 칩 본문에 외부면 이메일 표시:
```tsx
    {sortedAttendees.map((a) => {
      const chipKey = a.userId != null ? `u-${a.userId}` : `e-${a.externalEmail}`
      const removeId = a.userId // 외부 참석자는 제거 대상 아님(null)
      return (
        <span
          key={chipKey}
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
          data-testid={`attendee-chip-${chipKey}`}
        >
          <span>{a.kind === 'EXTERNAL' ? (a.externalEmail ?? a.name) : a.name}</span>
          {a.kind === 'AGENT' && <AgentBadge size="xs" />}
          <RsvpIcon status={a.rsvpStatus} />
          {a.role !== 'ORGANIZER' && a.kind !== 'EXTERNAL' && onRemove && removeId != null && (
            <button
              type="button"
              className="ml-0.5 rounded-full hover:text-destructive"
              onClick={() => onRemove(removeId)}
              aria-label={`${a.name} 제거`}
              data-testid={`attendee-remove-${removeId}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      )
    })}
```
(외부 참석자는 제거 버튼 없음 — invite/remove 는 내부 user 대상만.)

- [ ] **Step 5: EventDialog — 주최자/외부 게이팅**

`EventDialog.tsx`:
- 참석자 편집(invite/remove)은 **내가 ORGANIZER 일 때만** 노출. `eventWithDetail.myRole === 'ORGANIZER'` 조건 추가:
```tsx
<AttendeeSection
  selectedMembers={selectedAttendees}
  onChange={setSelectedAttendees}
  attendees={eventWithDetail?.attendees}
  onInvite={
    isEdit && eventWithDetail?.myRole === 'ORGANIZER'
      ? (userId) => inviteAttendees.mutate([userId])
      : undefined
  }
  onRemove={
    isEdit && eventWithDetail?.myRole === 'ORGANIZER'
      ? (userId) => removeAttendee.mutate(userId)
      : undefined
  }
/>
```
- RSVP 컨트롤은 **외부 일정이 아닐 때만** 노출. `showRsvp` 계산에 `&& !eventWithDetail?.external` 추가:
```tsx
{showRsvp && !eventWithDetail?.external && eventWithDetail && (
  <RsvpControls eventId={eventWithDetail.id} current={eventWithDetail.myRsvpStatus!} />
)}
```
(`showRsvp` 의 기존 정의가 무엇이든 `!external` 조건을 AND 로 추가.)

- [ ] **Step 6: vitest 통과 + typecheck + E2E 회귀**

Run:
```bash
cd apps/workplace-web && pnpm test -- AttendeeSection && pnpm typecheck
```
Expected: PASS, 타입 0 오류.

Run (기존 캘린더 E2E 회귀):
```bash
cd apps/workplace-web && pnpm exec playwright test calendar
```
Expected: PASS (참석자/외부 쓰기 관련 기존 스펙 회귀 없음).

- [ ] **Step 7: Commit**

```bash
git add apps/workplace-web/src/types/calendar.ts apps/workplace-web/src/components/calendar/AttendeeSection.tsx apps/workplace-web/src/components/calendar/AttendeeSection.test.tsx apps/workplace-web/src/components/calendar/EventDialog.tsx
git commit -m "feat(calendar): 외부 참석자 렌더 + 주최자/RSVP 게이팅 (#547)"
```

---

### Task 9: 라이브 스모크 문서

**Files:**
- Create: `docs/M365_CALENDAR_ATTENDEES_LIVE_SMOKE.md`

**Interfaces:** 없음 (문서).

- [ ] **Step 1: 라이브 스모크 절차 작성**

`docs/M365_CALENDAR_ATTENDEES_LIVE_SMOKE.md` — 모킹 테스트가 못 잡는 실제 Graph 계약을 검증하는 절차. 반드시 포함:

1. **사전조건**: dh.yang@iacloud.kr M365 계정 재연결(Calendars.ReadWrite), API :9090 재시작(머지 후), writable Calendar 존재.
2. **읽기 — 외부 참석자**: Outlook 에서 외부 이메일(예: gmail) 참석자를 포함한 회의를 만들고 sync(또는 10분 대기) → 앱 일정 상세에 외부 참석자가 이메일로 표시되는지, RSVP 아이콘이 Graph 응답과 일치하는지.
3. **읽기 — RSVP 갱신**: 참석자가 Outlook 에서 수락 → 다음 sync 후 앱에 ACCEPTED(초록) 반영.
4. **읽기 — 내가 초대받은 일정**: 타인이 주최한 회의 동기화 → 앱에서 참석자/RSVP **읽기 전용**(invite/remove/RSVP 버튼 없음, `myRole !== ORGANIZER`, `external=true`).
5. **쓰기 — create 참석자**: 앱에서 외부 캘린더에 내부 멤버를 초대해 일정 생성 → Graph(Outlook)에 참석자로 추가됐는지, 그 멤버에게 초대 메일이 갔는지.
6. **쓰기 — invite/remove**: 내가 주최한 외부 일정에서 참석자 추가/삭제 → Graph 반영 확인. (PATCH 가 전체 목록 교체이므로 기존 참석자 유지되는지.)
7. **⭐ 라운드트립 보존**(advisor #4): create 로 초대한 내부 멤버가 다음 read-sync 후에도 **내부 참석자(EXTERNAL 아님)로 유지**되는지 — Graph 가 반환하는 주소가 user.email 과 다르면 external 로 뒤집힐 수 있음. 뒤집히면 매칭 로직(account email/별칭) 보강 필요.
8. **⭐ 비주최자 차단**(advisor #3): 내가 초대받은 동기화 일정에서 API 로 직접 invite 호출 → 409.
9. **진단법**(토큰 없이): local dev 키로 `oauth_access_token` AES-GCM 복호화(dev DB 5434) → Graph 직접 호출로 페이로드 비교 (#502 절차 재사용).

- [ ] **Step 2: Commit**

```bash
git add -f docs/M365_CALENDAR_ATTENDEES_LIVE_SMOKE.md
git commit -m "docs(calendar): M365 참석자 양방향 라이브 스모크 절차 (#547)"
```

---

## Self-Review

**Spec coverage:**
- 스키마 V110 → Task 1 ✅
- Graph attendee 읽기/쓰기 레코드 + RSVP 매핑 → Task 3 ✅
- 읽기 diff-sync(내부/외부 매칭, RSVP, 삭제, organizer) → Task 4 ✅
- create 참석자 전송 → Task 5 ✅
- invite/remove 주최자 게이트 오케스트레이터 + RSVP 외부 가드 → Task 6 ✅
- 외부 참석자 partial unique 만 추가(기존 UNIQUE 유지, advisor #1) → Task 1 ✅
- DTO external/myRole/externalEmail → Task 7 ✅
- 프론트 외부 렌더 + 게이팅 → Task 8 ✅
- 라이브 스모크(라운드트립·비주최자 차단, advisor #3/#4) → Task 9 ✅

**Type consistency:**
- `AttendeeRow.userId`: `Long`(Task 2) — enrich/sync 모두 null-safe. ✅
- `AttendeeResponse.userId`: `Long`, `externalEmail` 추가(Task 7) — 프론트 `Attendee.userId: number|null`(Task 8) 일치. ✅
- `GraphEventWrite` 7-arg(attendees) — Task 3 에서 모든 호출부(test+service) 갱신. ✅
- `toGraphWrite(req, attendees)` — create/update 두 호출부 Task 5 에서 갱신. ✅
- `CalendarTransport.updateAttendees` — Graph 구현 Task 6. ✅
- `rsvpFromGraphResponse` static (Task 3) — Task 4 에서 호출. ✅

**Placeholder scan:** 없음. 모든 코드 블록은 실제 시그니처 기반.

**알려진 실행 시점 주의:**
- Task 2 의 `insertExternal` onConflict 가 partial index 추론 실패하면 명시적 `.where(...)` 추가(Step 4 노트). 테스트가 검증.
- Task 7 의 `withAttendeeInfo`/`CalendarEventResponse` 생성 지점은 실제 구조 확인 후 두 필드 전파 — 구현자가 컴파일 따라가며 모든 생성자 호출 갱신.
- 공유 DB(5435 test) flyway drift 가능 — 머지된 마이그 수정 금지, 환경 조율로 해결.
