package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.workplace.calendar.CalendarPalette;
import com.workplace.calendar.dto.CalendarTagRef;
import com.workplace.calendar.dto.CalendarTagRequest;
import com.workplace.calendar.dto.CalendarTagResponse;
import com.workplace.calendar.dto.OutlookTagScope;
import com.workplace.calendar.repository.CalendarRepository;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.calendar.repository.ExternalCalendarRepository;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.outbound.GraphCalendarClient;
import com.workplace.mail.outbound.GraphCalendarClient.GraphCalendar;
import com.workplace.mail.outbound.GraphCalendarClient.GraphDateTime;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEvent;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * GraphCalendarFetcher + CalendarSyncService 통합 테스트.
 *
 * <p>실제 Graph API 호출 없이 {@link GraphCalendarClient}·{@link GraphTokenService}를 @MockitoBean 으로
 * 스텁한다. TDD: 종일 이벤트 end-exclusive 보정, UTC 매핑, 빈 제목 폴백 시나리오를 검증한다.
 */
class GraphCalendarSyncTest extends IntegrationTestBase {

  @MockitoBean GraphCalendarClient graphCalendarClient;
  @MockitoBean GraphTokenService graphTokenService;

  @Autowired CalendarSyncService syncService;
  @Autowired ExternalCalendarRepository extRepo;
  @Autowired CalendarRepository calendarRepo;
  @Autowired CalendarEventService eventService;
  @Autowired CalendarTagService tagService;
  @Autowired EventAttendeeRepository attendeeRepo;
  @Autowired DSLContext dsl;
  @Autowired EncryptionService encryption;

  /** 테스트에서 사용할 테넌트 id (시드 데이터 tenant#1). */
  private static final long TENANT_ID = 1L;

  private long ownerId;
  private long accountId;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              ownerId = TestFixtures.createHuman(dsl);
              accountId = seedGraphAccount(ownerId);
              return null;
            });
  }

  @AfterEach
  void tearDown() {
    // 테스트 데이터 정리 — cleanupInTenant 은 GUC 주입된 tx 안에서 삭제 수행
    final long uid = ownerId;
    final long aid = accountId;
    cleanupInTenant(
        TENANT_ID,
        () -> {
          // calendar_event → calendar → email_account 순으로 삭제(FK 순서)
          // calendar_event 에 ON DELETE CASCADE 없으므로 owner 기준으로 선삭제
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.eq(uid)).execute();
          dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(aid)).execute();
          // user 는 FK cascade 로 연관 데이터 함께 삭제
          dsl.execute("DELETE FROM \"user\" WHERE id = ?", uid);
        });
    TenantContext.clear();
  }

  /**
   * email_account 픽스처 생성 — M365_GRAPH provider.
   *
   * <p>calendar.external_account_id FK 충족을 위해 실제 행을 삽입한다. OAuth 계정이므로 IMAP 컬럼은 null.
   */
  private long seedGraphAccount(long userId) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "graph-sync-test-" + userId + "@test.local")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "Graph 캘린더 테스트 계정")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("FAKE_TOKEN"))
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .set(EMAIL_ACCOUNT.TENANT_ID, TENANT_ID)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * GraphDateTime 생성 헬퍼 — 오프셋 없는 Graph calendarView 형식(UTC 가정).
   *
   * @param dateTime 날짜시간 문자열 (예: "2026-07-10T00:00:00.0000000")
   * @param timeZone 타임존 (예: "UTC")
   */
  private static GraphDateTime gdt(String dateTime, String timeZone) {
    return new GraphDateTime(dateTime, timeZone);
  }

  /**
   * 종일 이벤트 매핑 검증.
   *
   * <p>Graph end 는 배타적(다음날 자정). DB 는 half-open [start, end) 규약을 사용하므로 변환 없이 그대로 저장한다. 또한
   * start.dateTime 이 오프셋 없는 문자열이어도 UTC OffsetDateTime 으로 올바르게 매핑됨을 확인한다.
   */
  @Test
  void sync_maps_allDay_endExclusive_minusOneDay_and_utc() {
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(new GraphCalendar("gcal", "업무", "lightBlue", "", true, true, null)));

    // 종일 1일 일정: Graph end 는 배타적(다음날 자정) 2026-07-11T00:00:00Z — 그대로 저장
    GraphEvent allDay =
        new GraphEvent(
            "evt-allday",
            "워크숍",
            null,
            null,
            gdt("2026-07-10T00:00:00.0000000", "UTC"),
            gdt("2026-07-11T00:00:00.0000000", "UTC"),
            true,
            null,
            null,
            null,
            false,
            null,
            null,
            null,
            null,
            null);
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcal"), any(), any()))
        .thenReturn(List.of(allDay));

    syncService.sync(ownerId, accountId);

    // 조회: 7월 범위
    List<com.workplace.calendar.dto.CalendarEventResponse> events =
        eventService.list(
            ownerId,
            OffsetDateTime.parse("2026-07-01T00:00:00Z"),
            OffsetDateTime.parse("2026-08-01T00:00:00Z"));

    var e =
        events.stream()
            .filter(x -> "워크숍".equals(x.title()))
            .findFirst()
            .orElseThrow(() -> new AssertionError("워크숍 이벤트를 찾을 수 없음"));

    // 종일 플래그
    assertThat(e.allDay()).isTrue();
    // 시작: 2026-07-10T00:00:00Z
    assertThat(e.startsAt()).isEqualTo(OffsetDateTime.parse("2026-07-10T00:00:00Z"));
    // 종료: Graph 배타적 end 2026-07-11T00:00:00Z 그대로 저장(half-open 규약)
    // minusDays(1) 적용 시 start == end → calendar_event_time_check(ends_at > starts_at) 위반
    assertThat(e.endsAt()).isEqualTo(OffsetDateTime.parse("2026-07-11T00:00:00Z"));
  }

  /**
   * 빈/null 제목 폴백 검증.
   *
   * <p>subject="" 또는 null 인 이벤트의 title 은 "(제목 없음)" 이어야 한다.
   */
  @Test
  void sync_blankSubject_fallsBackToPlaceholder() {
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(new GraphCalendar("gcal2", "개인", "auto", "", false, true, null)));

    // subject = "" (빈 문자열)
    GraphEvent blankSubject =
        new GraphEvent(
            "evt-blank",
            "",
            null,
            null,
            gdt("2026-07-15T10:00:00.0000000", "UTC"),
            gdt("2026-07-15T11:00:00.0000000", "UTC"),
            false,
            null,
            null,
            null,
            false,
            null,
            null,
            null,
            null,
            null);
    // subject = null
    GraphEvent nullSubject =
        new GraphEvent(
            "evt-null",
            null,
            null,
            null,
            gdt("2026-07-16T10:00:00.0000000", "UTC"),
            gdt("2026-07-16T11:00:00.0000000", "UTC"),
            false,
            null,
            null,
            null,
            false,
            null,
            null,
            null,
            null,
            null);
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcal2"), any(), any()))
        .thenReturn(List.of(blankSubject, nullSubject));

    syncService.sync(ownerId, accountId);

    List<com.workplace.calendar.dto.CalendarEventResponse> events =
        eventService.list(
            ownerId,
            OffsetDateTime.parse("2026-07-01T00:00:00Z"),
            OffsetDateTime.parse("2026-08-01T00:00:00Z"));

    long placeholderCount = events.stream().filter(x -> "(제목 없음)".equals(x.title())).count();
    assertThat(placeholderCount).isEqualTo(2);
  }

  /**
   * write-through 로 동기화 윈도우(−1mo/+3mo) 밖에 생성된 외부 일정은 prune 으로 삭제되지 않는다. (#501 stranded 버그의 거울상 차단)
   */
  @Test
  void sync_prune_does_not_delete_out_of_window_events() {
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(new GraphCalendar("gcalP", "업무", "lightBlue", "", true, true, null)));
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcalP"), any(), any()))
        .thenReturn(List.of()); // 서버는 윈도우 내 일정 0건

    // 1차 동기화로 컨테이너 생성
    syncService.sync(ownerId, accountId);
    long calId = extRepo.listExternalCalendarIds(accountId).get(0);

    // 윈도우 밖(+4개월) external_id 보유 일정을 직접 삽입(write-through 결과 시뮬레이션)
    OffsetDateTime farStart = OffsetDateTime.now(java.time.ZoneOffset.UTC).plusMonths(4);
    new TransactionTemplate(txManager)
        .execute(
            s ->
                dsl.insertInto(CALENDAR_EVENT)
                    .set(CALENDAR_EVENT.OWNER_ID, ownerId)
                    .set(CALENDAR_EVENT.CALENDAR_ID, calId)
                    .set(CALENDAR_EVENT.EXTERNAL_ID, "ext-far")
                    .set(CALENDAR_EVENT.TITLE, "먼미래")
                    .set(CALENDAR_EVENT.STARTS_AT, farStart)
                    .set(CALENDAR_EVENT.ENDS_AT, farStart.plusHours(1))
                    .set(CALENDAR_EVENT.ALL_DAY, false)
                    .execute());

    // 2차 동기화: 서버는 여전히 윈도우 내 0건. prune 이 윈도우 한정이면 먼미래 일정 생존.
    syncService.sync(ownerId, accountId);

    int remaining =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.fetchCount(
                        dsl.selectFrom(CALENDAR_EVENT)
                            .where(CALENDAR_EVENT.EXTERNAL_ID.eq("ext-far"))));
    assertThat(remaining).isEqualTo(1);
  }

  /** 본문(body)·미리보기를 지정한 Graph 이벤트 1건 — 7월 15일 10~11시(UTC). */
  private static GraphEvent eventWithBody(
      String id, String preview, GraphCalendarClient.GraphItemBody body) {
    return new GraphEvent(
        id,
        "본문 회의",
        preview,
        body,
        gdt("2026-07-15T10:00:00.0000000", "UTC"),
        gdt("2026-07-15T11:00:00.0000000", "UTC"),
        false,
        null,
        null,
        null,
        false,
        null,
        null,
        null,
        null,
        null);
  }

  /** 7월 범위에서 제목이 "본문 회의" 인 일정의 설명을 읽는다. */
  private String syncedDescription() {
    return eventService
        .list(
            ownerId,
            OffsetDateTime.parse("2026-07-01T00:00:00Z"),
            OffsetDateTime.parse("2026-08-01T00:00:00Z"))
        .stream()
        .filter(x -> "본문 회의".equals(x.title()))
        .findFirst()
        .orElseThrow(() -> new AssertionError("본문 회의 일정을 찾을 수 없음"))
        .description();
  }

  /**
   * WP-709: 설명은 255자 미리보기가 아니라 본문 전체로 저장된다. 줄바꿈은 CRLF 가 LF 로 맞춰지고 앞뒤 공백은 잘린다. 이미 동기화된 일정은 다음 동기화에서
   * 전문으로 갱신된다(upsert 갱신 경로가 description 을 덮어쓴다).
   */
  @Test
  void sync_stores_full_body_and_resync_overwrites_old_preview() {
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(new GraphCalendar("gcalB", "업무", "lightBlue", "", true, true, null)));

    // 1차: 예전 동작처럼 미리보기만 있는 일정(본문 없음) → 미리보기가 설명이 된다(폴백)
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcalB"), any(), any()))
        .thenReturn(List.of(eventWithBody("evt-body", "미리보기만", null)));
    syncService.sync(ownerId, accountId);
    assertThat(syncedDescription()).isEqualTo("미리보기만");

    // 2차: 같은 일정이 본문 전체와 함께 온다 — 255자를 넘는 긴 본문
    String longText = "가나다라마바사 ".repeat(100).trim(); // 약 700자
    String crlfBody = "\r\n" + longText + "\r\n둘째 줄\r\n";
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcalB"), any(), any()))
        .thenReturn(
            List.of(
                eventWithBody(
                    "evt-body", "미리보기만", new GraphCalendarClient.GraphItemBody("text", crlfBody))));
    syncService.sync(ownerId, accountId);

    assertThat(syncedDescription()).isEqualTo(longText + "\n둘째 줄");
    assertThat(syncedDescription().length()).isGreaterThan(255);
  }

  /** WP-709: 본문이 10,000자를 넘으면 앞 9,999자 + 「…」(= 10,000자)로 줄여 저장한다 — CalendarEventRequest 한도와 같다. */
  @Test
  void sync_caps_body_at_10000_chars_with_ellipsis() {
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(new GraphCalendar("gcalC", "업무", "lightBlue", "", true, true, null)));
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcalC"), any(), any()))
        .thenReturn(
            List.of(
                eventWithBody(
                    "evt-huge",
                    "p",
                    new GraphCalendarClient.GraphItemBody("text", "x".repeat(25_000)))));

    syncService.sync(ownerId, accountId);

    String description = syncedDescription();
    assertThat(description).hasSize(10_000);
    assertThat(description).isEqualTo("x".repeat(9_999) + "…");
  }

  /**
   * WP-710: 동기화가 Graph onlineMeeting.joinUrl 을 저장하고 상세 응답이 onlineMeeting 으로 돌려준다(목록은 null). joinUrl
   * 이 없는 일정은 설명의 회의 링크로 판정하고, 회의가 아니면 null. 다음 동기화에서 회의가 해제(joinUrl 사라짐)되면 저장 주소도 지워진다.
   */
  @Test
  void sync_stores_join_url_and_response_resolves_online_meeting() {
    String join = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0";
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(new GraphCalendar("gcalM", "업무", "lightBlue", "", true, true, null)));
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcalM"), any(), any()))
        .thenReturn(
            List.of(
                meetingEvent(
                    "m-stored", "저장 주소", null, new GraphCalendarClient.GraphOnlineMeeting(join)),
                meetingEvent("m-desc", "설명 링크", "참가 <https://us02web.zoom.us/j/123456789>", null),
                meetingEvent("m-none", "회의 아님", "그냥 설명 https://example.com/x", null)));

    syncService.sync(ownerId, accountId);

    var byTitle = listedByTitle();
    // 목록은 회의를 판정하지 않는다(행마다 최대 1만 자 설명을 훑는 비용) — 상세(get)에서만 판정
    assertThat(byTitle.values()).allSatisfy(e -> assertThat(e.onlineMeeting()).isNull());
    // 저장된 주소 → 그대로, 공급자는 주소에서 추론
    long storedId = byTitle.get("저장 주소").id();
    assertThat(eventService.get(ownerId, storedId).onlineMeeting())
        .isEqualTo(new com.workplace.calendar.dto.OnlineMeeting("TEAMS", join));
    // joinUrl 없음 → 설명의 첫 회의 링크
    assertThat(eventService.get(ownerId, byTitle.get("설명 링크").id()).onlineMeeting())
        .isEqualTo(
            new com.workplace.calendar.dto.OnlineMeeting(
                "ZOOM", "https://us02web.zoom.us/j/123456789"));
    assertThat(eventService.get(ownerId, byTitle.get("회의 아님").id()).onlineMeeting()).isNull();
    // 컬럼에 실제 저장됨
    assertThat(
            dsl.select(CALENDAR_EVENT.ONLINE_MEETING_URL)
                .from(CALENDAR_EVENT)
                .where(CALENDAR_EVENT.EXTERNAL_ID.eq("m-stored"))
                .fetchOne(CALENDAR_EVENT.ONLINE_MEETING_URL))
        .isEqualTo(join);

    // 2차 동기화: 회의 해제(onlineMeeting 사라짐) → 저장 주소가 지워지고 응답도 null
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcalM"), any(), any()))
        .thenReturn(List.of(meetingEvent("m-stored", "저장 주소", null, null)));
    syncService.sync(ownerId, accountId);
    assertThat(eventService.get(ownerId, storedId).onlineMeeting()).isNull();
  }

  private java.util.Map<String, com.workplace.calendar.dto.CalendarEventResponse> listedByTitle() {
    var map = new java.util.HashMap<String, com.workplace.calendar.dto.CalendarEventResponse>();
    eventService
        .list(
            ownerId,
            OffsetDateTime.parse("2026-07-01T00:00:00Z"),
            OffsetDateTime.parse("2026-08-01T00:00:00Z"))
        .forEach(e -> map.put(e.title(), e));
    return map;
  }

  /** 온라인 회의 정보·설명을 지정한 Graph 이벤트 — 7월 20일 10~11시(UTC). */
  private static GraphEvent meetingEvent(
      String id, String title, String body, GraphCalendarClient.GraphOnlineMeeting meeting) {
    return new GraphEvent(
        id,
        title,
        null,
        body == null ? null : new GraphCalendarClient.GraphItemBody("text", body),
        gdt("2026-07-20T10:00:00.0000000", "UTC"),
        gdt("2026-07-20T11:00:00.0000000", "UTC"),
        false,
        null,
        null,
        null,
        false,
        null,
        meeting,
        null,
        null,
        null);
  }

  /** Graph 이벤트 1건(조직자+참석자) 빌더. */
  private com.workplace.mail.outbound.GraphCalendarClient.GraphEvent graphEventWith(
      String id,
      String organizerEmail,
      java.util.List<com.workplace.mail.outbound.GraphCalendarClient.GraphEventAttendee>
          attendees) {
    var start =
        new com.workplace.mail.outbound.GraphCalendarClient.GraphDateTime(
            "2026-07-10T09:00:00.0000000", "UTC");
    var end =
        new com.workplace.mail.outbound.GraphCalendarClient.GraphDateTime(
            "2026-07-10T10:00:00.0000000", "UTC");
    var organizer =
        new com.workplace.mail.outbound.GraphCalendarClient.GraphRecipient(
            new com.workplace.mail.outbound.GraphCalendarClient.GraphEmail("주최", organizerEmail));
    return new com.workplace.mail.outbound.GraphCalendarClient.GraphEvent(
        id, "동기화 회의", "본문", null, start, end, false, null, organizer, attendees, false, null, null,
        null, null, null);
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
            "gcal", "Calendar", "auto", "#0078d4", true, true, null);
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

    syncService.sync(ownerId, accountId);

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
            "gcal", "Calendar", "auto", "#0078d4", true, true, null);
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
    syncService.sync(ownerId, accountId);

    // 2차 sync: A 만 남음.
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcal"), any(), any()))
        .thenReturn(
            java.util.List.of(
                graphEventWith(
                    "EVT2",
                    "org@partner.com",
                    java.util.List.of(attendee("A", "a@x.com", "none")))));
    syncService.sync(ownerId, accountId);

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
    assertThat(rows).hasSize(2); // 조직자 + A = 2행 (B 삭제됨)
    assertThat(rows).extracting(r -> r.externalEmail()).doesNotContain("b@x.com");
    assertThat(rows).extracting(r -> r.externalEmail()).contains("a@x.com");
  }

  /**
   * AGENT 참석자는 Graph 에 전송하지 않는 로컬 전용 구성이므로, read-sync 가 AGENT 행을 삭제해서는 안 된다.
   *
   * <p>C1 회귀 검증: 재동기화 후 AGENT 행이 그대로 남아 있어야 한다.
   */
  @Test
  void sync_does_not_delete_agent_attendee_on_resync() {
    var cal =
        new com.workplace.mail.outbound.GraphCalendarClient.GraphCalendar(
            "gcalA", "Calendar", "auto", "#0078d4", true, true, null);
    long agentId =
        new TransactionTemplate(txManager).execute(s -> TestFixtures.createAgentNoToken(dsl));

    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok")).thenReturn(java.util.List.of(cal));

    // 1차 sync: 외부 조직자만 포함.
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcalA"), any(), any()))
        .thenReturn(
            java.util.List.of(graphEventWith("EVT_AGENT", "org@partner.com", java.util.List.of())));
    syncService.sync(ownerId, accountId);

    // AGENT 참석자를 로컬에서 직접 삽입(초대 시뮬레이션 — Graph 미전송).
    new TransactionTemplate(txManager)
        .execute(
            s -> {
              long evtId =
                  dsl.select(CALENDAR_EVENT.ID)
                      .from(CALENDAR_EVENT)
                      .where(CALENDAR_EVENT.EXTERNAL_ID.eq("EVT_AGENT"))
                      .fetchOne(CALENDAR_EVENT.ID);
              attendeeRepo.insert(evtId, agentId, null, "ATTENDEE", "ACCEPTED");
              return null;
            });

    // 2차 sync: Graph 응답은 동일(AGENT 없음) — AGENT 행이 삭제되면 안 됨.
    syncService.sync(ownerId, accountId);

    var rows =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long evtId =
                      dsl.select(CALENDAR_EVENT.ID)
                          .from(CALENDAR_EVENT)
                          .where(CALENDAR_EVENT.EXTERNAL_ID.eq("EVT_AGENT"))
                          .fetchOne(CALENDAR_EVENT.ID);
                  return attendeeRepo.findByEvent(evtId);
                });

    // 조직자(외부) + AGENT = 2행.
    assertThat(rows).hasSize(2);
    assertThat(rows).anySatisfy(r -> assertThat(r.kind()).isEqualTo("AGENT"));

    cleanupInTenant(TENANT_ID, () -> dsl.execute("DELETE FROM \"user\" WHERE id = ?", agentId));
  }

  /**
   * canEdit=true 캘린더는 쓰기 가능(isReadOnly=false)으로, canEdit=false 캘린더는 읽기전용으로 동기화된다. 재동기화 시 canEdit
   * 변화가 is_read_only 에 반영된다(doUpdate 갱신).
   */
  @Test
  void sync_sets_isReadOnly_from_canEdit_and_reflects_on_resync() {
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");

    // 1차: 편집 가능 달력으로 동기화 → isReadOnly=false
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(new GraphCalendar("gcalW", "업무", "lightBlue", "", true, true, null)));
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcalW"), any(), any()))
        .thenReturn(List.of());
    syncService.sync(ownerId, accountId);

    long calId = extRepo.listExternalCalendarIds(accountId).get(0);
    assertThat(calendarRepo.isReadOnly(calId)).isFalse();

    // 2차: 같은 달력이 canEdit=false 로 바뀌면 isReadOnly=true 로 플립(doUpdate)
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(new GraphCalendar("gcalW", "업무", "lightBlue", "", true, false, null)));
    syncService.sync(ownerId, accountId);
    assertThat(calendarRepo.isReadOnly(calId)).isTrue();
  }

  /**
   * #825 — Graph 의 lightOrange/lightBrown/lightYellow 는 팔레트에 없거나(dead key) 서로 겹쳐(둘 다 amber) 예전
   * 구현에서는 셋 다 blue 로 수렴했다. 같은 계정 안의 캘린더는 서로 다른 색을 배정받아야 한다.
   */
  @Test
  void sync_assignsDistinctColors_forCalendarsWithCollidingGraphColors() {
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(
            List.of(
                new GraphCalendar("gcalOrange", "기본", "lightOrange", "", true, true, null),
                new GraphCalendar("gcalBrown", "생일", "lightBrown", "", false, true, null),
                new GraphCalendar("gcalYellow", "한국의 공휴일", "lightYellow", "", false, true, null)));
    when(graphCalendarClient.listCalendarView(any(), any(), any(), any())).thenReturn(List.of());

    syncService.sync(ownerId, accountId);

    List<Long> calIds = extRepo.listExternalCalendarIds(accountId);
    assertThat(calIds).hasSize(3);
    List<String> colors =
        calIds.stream()
            .map(id -> calendarRepo.findByIdForOwner(ownerId, id).orElseThrow().color())
            .toList();
    // 세 캘린더가 전부 다른 색을 배정받아야 한다(전부 blue 로 수렴하던 #825 재현 방지).
    assertThat(colors).doesNotHaveDuplicates();
  }

  /** Outlook 범주 → 태그 테스트용 Graph 일정(시각 고정, 범주만 바꾼다). */
  private static GraphEvent categorized(
      String id, String subject, int day, List<String> categories) {
    String d = String.format("2026-07-%02dT09:00:00.0000000", day);
    String e = String.format("2026-07-%02dT10:00:00.0000000", day);
    return new GraphEvent(
        id,
        subject,
        null,
        null,
        gdt(d, "UTC"),
        gdt(e, "UTC"),
        false,
        null,
        null,
        null,
        false,
        null,
        null,
        categories,
        null,
        null);
  }

  /**
   * WP-714 — Outlook 범주가 캘린더 주인의 태그가 된다: 없는 이름은 만들고(이름 해시 색), 있는 이름은 대소문자 무시로 재사용한다. 다음 동기화에서 범주가
   * 바뀌면 그 일정의 OUTLOOK 연결이 범주와 똑같이 바뀌고(태그 자체는 남음), categories 가 응답에 없으면(null) 연결을 건드리지 않는다. 내 사서함의 쓸
   * 수 있는 달력 일정이라 앱에서 태그를 바꿀 수 있다(tagsEditable=true — 바꾸면 Outlook 범주에 써 넣는다, WP-716).
   */
  @Test
  void sync_mapsOutlookCategoriesToOwnerTags() {
    // 사용자가 앱에서 먼저 만든 태그 — 범주 「ops」와 대소문자만 달라 재사용돼야 한다.
    long opsTag = tagService.create(ownerId, new CalendarTagRequest("OPS", "teal")).id();
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(new GraphCalendar("gcatT", "업무", "lightBlue", "", true, true, null)));
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcatT"), any(), any()))
        .thenReturn(
            List.of(
                categorized("c1", "공유 회의", 10, List.of("사내 공유", "ops")),
                categorized("c2", "범주 없음", 11, List.of()),
                categorized("c3", "보존", 12, List.of("보존 태그"))));
    syncService.sync(ownerId, accountId);

    Map<String, CalendarTagResponse> byName =
        tagService.list(ownerId).stream()
            .collect(Collectors.toMap(CalendarTagResponse::name, t -> t));
    assertThat(byName).containsOnlyKeys("OPS", "사내 공유", "보존 태그");
    assertThat(byName.get("사내 공유").color()).isEqualTo(CalendarPalette.forName("사내 공유"));
    assertThat(byName.get("OPS").id()).isEqualTo(opsTag);
    assertThat(tagNamesOf("공유 회의")).containsExactly("OPS", "사내 공유");
    assertThat(tagNamesOf("범주 없음")).isEmpty();
    assertThat(eventTitled("공유 회의").tagsEditable()).isTrue();
    assertThat(eventTitled("공유 회의").outlookTagScope()).isEqualTo(OutlookTagScope.EVENT);

    // 다음 동기화: c1 은 「사내 공유」가 빠지고, c3 는 categories 가 응답에 없다(null → 그대로).
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcatT"), any(), any()))
        .thenReturn(
            List.of(
                categorized("c1", "공유 회의", 10, List.of("Ops")),
                categorized("c2", "범주 없음", 11, List.of()),
                categorized("c3", "보존", 12, null)));
    syncService.sync(ownerId, accountId);

    assertThat(tagNamesOf("공유 회의")).containsExactly("OPS");
    assertThat(tagNamesOf("보존")).containsExactly("보존 태그");
    // 태그는 남고 붙은 일정 수만 줄어든다
    assertThat(tagService.list(ownerId))
        .filteredOn(t -> t.name().equals("사내 공유"))
        .singleElement()
        .extracting(CalendarTagResponse::eventCount)
        .isEqualTo(0);
  }

  /**
   * WP-714 리뷰 — 대소문자 접기는 DB lower() 한 곳에서만 한다. 그리스어 끝 시그마(「ΟΔΟΣ」 — Java 는 ς, PG 는 σ)·터키어 「İ」처럼 Java
   * toLowerCase 와 PG lower() 가 어긋나는 이름도 일정에 연결되고, 다음 동기화가 태그를 다시 만들지 않는다.
   */
  @Test
  void sync_linksCategoriesWhoseLowercaseDiffersBetweenJavaAndPostgres() {
    // 이 DB 에서 실제로 Java 와 PG 의 소문자가 어긋나는지 먼저 확인한다 — 같다면 이 테스트는 아무것도 증명하지 못한다.
    List<String> names = List.of("ΟΔΟΣ", "İstanbul");
    assertThat(names.stream().map(n -> dsl.select(DSL.lower(DSL.val(n))).fetchOne(0, String.class)))
        .isNotEqualTo(names.stream().map(n -> n.toLowerCase(Locale.ROOT)).toList());
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(new GraphCalendar("gcatU", "업무", "lightBlue", "", true, true, null)));
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcatU"), any(), any()))
        .thenReturn(List.of(categorized("u1", "해외 회의", 14, List.of("ΟΔΟΣ", "İstanbul"))));

    syncService.sync(ownerId, accountId);
    assertThat(tagNamesOf("해외 회의")).containsExactlyInAnyOrder("ΟΔΟΣ", "İstanbul");
    Map<String, Long> firstIds =
        tagService.list(ownerId).stream()
            .collect(Collectors.toMap(CalendarTagResponse::name, CalendarTagResponse::id));

    syncService.sync(ownerId, accountId);
    assertThat(tagNamesOf("해외 회의")).containsExactlyInAnyOrder("ΟΔΟΣ", "İstanbul");
    assertThat(
            tagService.list(ownerId).stream()
                .collect(Collectors.toMap(CalendarTagResponse::name, CalendarTagResponse::id)))
        .isEqualTo(firstIds)
        .hasSize(2);
  }

  /**
   * WP-714 리뷰 — 읽기 전용 달력(동료가 공유한 달력·공휴일 등, canEdit=false)의 범주는 태그로 만들지 않는다. 남의 사서함 범주라 내 태그 목록에 지울
   * 수 없는 태그만 쌓이기 때문이다. 일정 자체는 그대로 동기화된다.
   */
  @Test
  void sync_skipsCategoriesOfReadOnlyCalendars() {
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(
            List.of(new GraphCalendar("gshared", "동료 일정", "lightBlue", "", false, false, null)));
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gshared"), any(), any()))
        .thenReturn(List.of(categorized("s1", "동료 회의", 15, List.of("동료 범주"))));

    syncService.sync(ownerId, accountId);

    assertThat(tagNamesOf("동료 회의")).isEmpty();
    assertThat(tagService.list(ownerId)).isEmpty();
    // 남의 사서함 달력이라 앱에서 태그를 써 넣을 수도 없다(WP-716)
    assertThat(eventTitled("동료 회의").tagsEditable()).isFalse();
  }

  private com.workplace.calendar.dto.CalendarEventResponse eventTitled(String title) {
    return eventService
        .list(
            ownerId,
            OffsetDateTime.parse("2026-07-01T00:00:00Z"),
            OffsetDateTime.parse("2026-08-01T00:00:00Z"))
        .stream()
        .filter(x -> title.equals(x.title()))
        .findFirst()
        .orElseThrow();
  }

  private List<String> tagNamesOf(String title) {
    return eventTitled(title).tags().stream().map(CalendarTagRef::name).toList();
  }
}
