package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.workplace.calendar.repository.CalendarRepository;
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
import org.jooq.DSLContext;
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
        .thenReturn(List.of(new GraphCalendar("gcal", "업무", "lightBlue", "", true, true)));

    // 종일 1일 일정: Graph end 는 배타적(다음날 자정) 2026-07-11T00:00:00Z — 그대로 저장
    GraphEvent allDay =
        new GraphEvent(
            "evt-allday",
            "워크숍",
            null,
            gdt("2026-07-10T00:00:00.0000000", "UTC"),
            gdt("2026-07-11T00:00:00.0000000", "UTC"),
            true,
            null,
            null,
            null,
            false);
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
        .thenReturn(List.of(new GraphCalendar("gcal2", "개인", "auto", "", false, true)));

    // subject = "" (빈 문자열)
    GraphEvent blankSubject =
        new GraphEvent(
            "evt-blank",
            "",
            null,
            gdt("2026-07-15T10:00:00.0000000", "UTC"),
            gdt("2026-07-15T11:00:00.0000000", "UTC"),
            false,
            null,
            null,
            null,
            false);
    // subject = null
    GraphEvent nullSubject =
        new GraphEvent(
            "evt-null",
            null,
            null,
            gdt("2026-07-16T10:00:00.0000000", "UTC"),
            gdt("2026-07-16T11:00:00.0000000", "UTC"),
            false,
            null,
            null,
            null,
            false);
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
        .thenReturn(List.of(new GraphCalendar("gcalP", "업무", "lightBlue", "", true, true)));
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

  /**
   * canEdit=true 캘린더는 쓰기 가능(isReadOnly=false)으로, canEdit=false 캘린더는 읽기전용으로 동기화된다. 재동기화 시 canEdit
   * 변화가 is_read_only 에 반영된다(doUpdate 갱신).
   */
  @Test
  void sync_sets_isReadOnly_from_canEdit_and_reflects_on_resync() {
    when(graphTokenService.getAccessToken(ownerId, accountId)).thenReturn("tok");

    // 1차: 편집 가능 달력으로 동기화 → isReadOnly=false
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(new GraphCalendar("gcalW", "업무", "lightBlue", "", true, true)));
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("gcalW"), any(), any()))
        .thenReturn(List.of());
    syncService.sync(ownerId, accountId);

    long calId = extRepo.listExternalCalendarIds(accountId).get(0);
    assertThat(calendarRepo.isReadOnly(calId)).isFalse();

    // 2차: 같은 달력이 canEdit=false 로 바뀌면 isReadOnly=true 로 플립(doUpdate)
    when(graphCalendarClient.listCalendars("tok"))
        .thenReturn(List.of(new GraphCalendar("gcalW", "업무", "lightBlue", "", true, false)));
    syncService.sync(ownerId, accountId);
    assertThat(calendarRepo.isReadOnly(calId)).isTrue();
  }
}
