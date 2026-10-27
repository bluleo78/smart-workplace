package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_TAG;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.CalendarTagRef;
import com.workplace.calendar.dto.CalendarTagRequest;
import com.workplace.calendar.dto.OutlookTagScope;
import com.workplace.calendar.exception.ExternalCalendarWriteException;
import com.workplace.calendar.exception.ExternalCalendarWriteInTransactionException;
import com.workplace.calendar.exception.ExternalEventTagNotSupportedException;
import com.workplace.calendar.repository.CalendarTagRepository;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.outbound.GraphCalendarClient;
import com.workplace.mail.outbound.GraphCalendarClient.GraphCalendar;
import com.workplace.mail.outbound.GraphCalendarClient.GraphDateTime;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEmail;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEvent;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEventCategoryState;
import com.workplace.mail.outbound.GraphCalendarClient.GraphRecipient;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 앱 태그 → Outlook 범주 써 넣기(WP-716) 통합 테스트. 일정은 실제 동기화(GraphCalendarFetcher)로 만들고 Graph 클라이언트·토큰만
 * 모킹한다. 써 넣기는 Graph HTTP 를 트랜잭션 밖에서 하므로 테스트도 @Transactional 이 아니다(그러면 가드가 막는다) — 정리는
 * cleanupInTenant.
 */
class CalendarTagOutlookWriteTest extends ExternalClientMockedTestBase {

  @Autowired GraphCalendarClient graphCalendarClient;
  @Autowired GraphTokenService graphTokenService;

  @Autowired CalendarSyncService syncService;
  @Autowired CalendarTagService tagService;
  @Autowired CalendarEventService eventService;
  @Autowired EventAttendeeRepository attendeeRepo;
  @Autowired DSLContext dsl;
  @Autowired EncryptionService encryption;

  private static final long TENANT_ID = 1L;
  private long ownerId;
  private long accountId;
  private Long otherUserId;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    new TransactionTemplate(txManager)
        .execute(
            s -> {
              ownerId = withMembership(TestFixtures.createHuman(dsl));
              accountId =
                  dsl.insertInto(EMAIL_ACCOUNT)
                      .set(EMAIL_ACCOUNT.USER_ID, ownerId)
                      .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "tag-write-" + ownerId + "@test.local")
                      .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
                      .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
                      .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("AT"))
                      .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
                      .set(EMAIL_ACCOUNT.AI_ENABLED, false)
                      .set(EMAIL_ACCOUNT.TENANT_ID, TENANT_ID)
                      .returning(EMAIL_ACCOUNT.ID)
                      .fetchOne()
                      .getId();
              return null;
            });
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn("tok");
  }

  @AfterEach
  void tearDown() {
    final long uid = ownerId, aid = accountId;
    final Long other = otherUserId;
    cleanupInTenant(
        TENANT_ID,
        () -> {
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.eq(uid)).execute();
          dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(aid)).execute();
          // 태그(calendar_tag)는 user 삭제 CASCADE 로 함께 지워진다.
          dsl.execute("DELETE FROM \"user\" WHERE id = ?", uid);
          if (other != null) dsl.execute("DELETE FROM \"user\" WHERE id = ?", other);
        });
    TenantContext.clear();
  }

  /** 이 계정 사서함 주인 주소(기본 달력의 owner). */
  private String me() {
    return "tag-write-" + ownerId + "@test.local";
  }

  /**
   * 동기화용 Graph 일정 — 7월 day 일 09~10시, 주최자는 바깥 사람(내 사본은 참석자 사본), 범주·시리즈 마스터 id·종류 지정.
   *
   * @param type Graph 일정 종류(singleInstance | occurrence | exception)
   */
  private static GraphEvent graphEvent(
      String id,
      String subject,
      int day,
      List<String> categories,
      String seriesMasterId,
      String type) {
    String d = String.format("2026-07-%02dT09:00:00.0000000", day);
    String e = String.format("2026-07-%02dT10:00:00.0000000", day);
    return new GraphEvent(
        id,
        subject,
        null,
        null,
        new GraphDateTime(d, "UTC"),
        new GraphDateTime(e, "UTC"),
        false,
        null,
        new GraphRecipient(new GraphEmail("Boss", "boss@partner.com")),
        null,
        false,
        null,
        null,
        categories,
        seriesMasterId,
        type);
  }

  /** 단일 일정. */
  private static GraphEvent single(String id, String subject, int day, List<String> categories) {
    return graphEvent(id, subject, day, categories, null, "singleInstance");
  }

  /** 내 사서함 기본 달력(owner = 나). */
  private GraphCalendar ownCalendar(String calId, boolean canEdit) {
    return new GraphCalendar(
        calId, "업무", "lightBlue", "", true, canEdit, new GraphEmail("나", me()));
  }

  /**
   * 달력들을 한 번에 동기화한다 — 달력마다 일정 목록을 준다. 일정마다 써 넣기 직전 GET 이 동기화와 같은 상태(종류·시리즈·범주)를 돌려주도록 기본값을 걸어 두고,
   * 테스트가 Outlook 에서 바뀐 상태를 흉내 낼 때만 다시 건다.
   */
  private void syncCalendars(Map<GraphCalendar, List<GraphEvent>> byCalendar) {
    when(graphCalendarClient.listCalendars("tok")).thenReturn(List.copyOf(byCalendar.keySet()));
    byCalendar.forEach(
        (cal, events) -> {
          when(graphCalendarClient.listCalendarView(eq("tok"), eq(cal.id()), any(), any()))
              .thenReturn(events);
          for (GraphEvent ev : events) {
            live(ev.id(), ev.type(), ev.seriesMasterId(), ev.categories());
          }
        });
    syncService.sync(ownerId, accountId);
  }

  /** 내 기본 달력 하나(canEdit 지정)에 일정들을 동기화한다. */
  private void sync(String calId, boolean canEdit, GraphEvent... events) {
    syncCalendars(Map.of(ownCalendar(calId, canEdit), List.of(events)));
  }

  /** 써 넣기 직전 GET 이 돌려줄 Graph 일정의 지금 상태. */
  private void live(String id, String type, String seriesMasterId, List<String> categories) {
    when(graphCalendarClient.getEventCategoryState("tok", id))
        .thenReturn(new GraphEventCategoryState(id, type, seriesMasterId, categories));
  }

  /** Graph id 로 로컬 일정 id. */
  private long localId(String externalId) {
    return new TransactionTemplate(txManager)
        .execute(
            s ->
                dsl.select(CALENDAR_EVENT.ID)
                    .from(CALENDAR_EVENT)
                    .where(CALENDAR_EVENT.OWNER_ID.eq(ownerId))
                    .and(CALENDAR_EVENT.EXTERNAL_ID.eq(externalId))
                    .fetchOne(CALENDAR_EVENT.ID));
  }

  private CalendarEventResponse event(long viewer, long eventId) {
    return eventService.get(viewer, eventId);
  }

  private List<String> tagNames(long eventId) {
    return event(ownerId, eventId).tags().stream().map(CalendarTagRef::name).toList();
  }

  /** 이 일정의 연결 출처 목록(모두 OUTLOOK 이어야 한다). */
  private List<String> linkSources(long eventId) {
    return new TransactionTemplate(txManager)
        .execute(
            s ->
                dsl.select(CALENDAR_EVENT_TAG.SOURCE)
                    .from(CALENDAR_EVENT_TAG)
                    .where(CALENDAR_EVENT_TAG.EVENT_ID.eq(eventId))
                    .fetch(CALENDAR_EVENT_TAG.SOURCE));
  }

  private long tag(String name) {
    return tagService.create(ownerId, new CalendarTagRequest(name, null)).id();
  }

  private long tagIdNamed(String name) {
    return tagService.list(ownerId).stream()
        .filter(t -> t.name().equals(name))
        .findFirst()
        .orElseThrow()
        .id();
  }

  /** 로컬 행의 저장된 시리즈 마스터 id·종류. */
  private List<String> seriesOf(long eventId) {
    return new TransactionTemplate(txManager)
        .execute(
            s -> {
              var r =
                  dsl.select(CALENDAR_EVENT.SERIES_MASTER_ID, CALENDAR_EVENT.EXTERNAL_TYPE)
                      .from(CALENDAR_EVENT)
                      .where(CALENDAR_EVENT.ID.eq(eventId))
                      .fetchOne();
              return java.util.Arrays.asList(r.value1(), r.value2());
            });
  }

  /** 아무 Graph 써 넣기·읽기도 없었다. */
  private void verifyNoGraphWrite() {
    verify(graphCalendarClient, never()).getEventCategoryState(anyString(), anyString());
    verify(graphCalendarClient, never()).patchCategories(anyString(), anyString(), anyList());
  }

  /**
   * 리뷰 반영 — 앱이 아는 연결과 요청의 차이만 Outlook 의 지금 범주에 반영한다. 마지막 동기화 뒤 Outlook 에서 붙인 범주(「Outlook만」)는 남고,
   * 손대지 않은 범주는 Outlook 표기 그대로(앞뒤 공백 포함 「 Project X 」) 가며, 빼는 범주는 대소문자를 무시하고 지운다(앱 「ops」 ↔ Outlook
   * 「OPS」). 성공하면 로컬 연결은 요청한 태그(OUTLOOK 출처)가 된다.
   */
  @Test
  void patchesOnlyTheDelta_preservingLiveCategoriesAndSpelling() {
    sync("gown", true, single("o1", "고객 미팅", 10, List.of("ops", "Project X")));
    long eventId = localId("o1");
    CalendarEventResponse before = event(ownerId, eventId);
    assertThat(before.tagsEditable()).isTrue();
    assertThat(before.outlookTagScope()).isEqualTo(OutlookTagScope.EVENT);
    assertThat(tagNames(eventId)).containsExactly("ops", "Project X");

    // 동기화 뒤 Outlook 에서: 「Outlook만」을 붙이고, 표기가 「 Project X 」·「OPS」로 바뀌었다.
    live("o1", "singleInstance", null, List.of(" Project X ", "OPS", "Outlook만"));
    long projectX = tagIdNamed("Project X");
    long customer = tag("고객사");
    tagService.setEventTags(ownerId, eventId, List.of(projectX, customer));

    verify(graphCalendarClient)
        .patchCategories("tok", "o1", List.of(" Project X ", "Outlook만", "고객사"));
    assertThat(tagNames(eventId)).containsExactly("Project X", "고객사");
    assertThat(linkSources(eventId)).containsOnly(CalendarTagRepository.SOURCE_OUTLOOK);
    assertThat(seriesOf(eventId)).containsExactly(null, "singleInstance");
  }

  /**
   * 더하려는 이름이 Outlook 에 이미 대소문자만 다르게 있으면 Outlook 표기를 그대로 두고 PATCH 하지 않는다(바뀐 것이 없음). 연결만 생긴다. 요청이 지금
   * 연결과 같으면 Graph 를 아예 부르지 않는다.
   */
  @Test
  void addingExistingCategoryWithOtherCase_keepsOutlookSpelling_andSkipsPatch() {
    sync("gcase", true, single("c1", "회의", 11, List.of()));
    long eventId = localId("c1");
    live("c1", "singleInstance", null, List.of("ops"));
    long ops = tag("OPS");

    tagService.setEventTags(ownerId, eventId, List.of(ops));
    verify(graphCalendarClient).getEventCategoryState("tok", "c1");
    verify(graphCalendarClient, never()).patchCategories(anyString(), anyString(), anyList());
    assertThat(tagNames(eventId)).containsExactly("OPS");

    // 같은 집합을 다시 보내면 Graph 를 읽지도 않는다.
    org.mockito.Mockito.clearInvocations(graphCalendarClient);
    tagService.setEventTags(ownerId, eventId, List.of(ops));
    verifyNoGraphWrite();
  }

  /**
   * 반복 회의 보통 회차 — 써 넣을 대상은 저장값이 아니라 써 넣기 직전에 읽은 종류로 정한다. 저장된 시리즈 마스터 id 가 비어 있는(이 컬럼 전에 동기화된) 회차도
   * 시리즈 마스터에 써 넣고, 마스터의 지금 범주에 차이를 더한다. 로컬은 누른 행과 같은 시리즈의 보통 회차만 바뀌고 따로 고친 회차·다른 시리즈·단일 일정은 그대로다.
   * 누른 행에는 읽은 시리즈 정보가 채워진다.
   */
  @Test
  void occurrence_patchesSeriesMaster_fromLiveType_evenWhenStoredSeriesIsNull() {
    sync(
        "gseries",
        true,
        graphEvent("r1", "주간 회의", 6, List.of(), "SM-1", "occurrence"),
        graphEvent("r2", "주간 회의", 13, List.of(), "SM-1", "occurrence"),
        graphEvent("x1", "주간 회의(고침)", 20, List.of(), "SM-1", "exception"),
        graphEvent("y1", "다른 시리즈", 7, List.of(), "SM-2", "occurrence"),
        single("s1", "단일 일정", 8, List.of()));
    long r1 = localId("r1");
    long r2 = localId("r2");
    assertThat(seriesOf(r1)).containsExactly("SM-1", "occurrence");
    assertThat(event(ownerId, r1).outlookTagScope()).isEqualTo(OutlookTagScope.SERIES);
    // r2 는 컬럼이 생기기 전에 동기화된 행처럼 비운다.
    new TransactionTemplate(txManager)
        .execute(
            s ->
                dsl.update(CALENDAR_EVENT)
                    .setNull(CALENDAR_EVENT.SERIES_MASTER_ID)
                    .setNull(CALENDAR_EVENT.EXTERNAL_TYPE)
                    .where(CALENDAR_EVENT.ID.eq(r2))
                    .execute());
    // 보통 회차의 범주는 시리즈 마스터의 것이다 — 누른 회차를 읽은 값으로 마스터 범주를 쓰므로 마스터를 다시 읽지 않는다.
    live("r2", "occurrence", "SM-1", List.of("마스터 범주"));
    live("SM-1", "seriesMaster", null, List.of("마스터 범주"));

    long weekly = tag("주간");
    tagService.setEventTags(ownerId, r2, List.of(weekly));
    verify(graphCalendarClient, never()).getEventCategoryState("tok", "SM-1");

    verify(graphCalendarClient).patchCategories("tok", "SM-1", List.of("마스터 범주", "주간"));
    verify(graphCalendarClient, never()).patchCategories(any(), eq("r2"), anyList());
    verify(graphCalendarClient, never()).patchCategories(any(), eq("x1"), anyList());
    assertThat(tagNames(r1)).containsExactly("주간");
    assertThat(tagNames(r2)).containsExactly("주간");
    assertThat(tagNames(localId("x1"))).isEmpty();
    assertThat(tagNames(localId("y1"))).isEmpty();
    assertThat(tagNames(localId("s1"))).isEmpty();
    assertThat(seriesOf(r2)).containsExactly("SM-1", "occurrence");
  }

  /**
   * 따로 고친 회차(exception) — 그 회차 자신과 시리즈 마스터 둘 다에, 각자의 지금 범주에 같은 차이를 반영해 써 넣는다. 로컬은 누른 회차와 같은 시리즈의 보통
   * 회차가 각자 연결에 같은 차이를 받고, 다른 고친 회차는 그대로다.
   */
  @Test
  void exception_patchesItselfAndSeriesMaster_withTheirOwnLiveCategories() {
    sync(
        "gexc",
        true,
        graphEvent("r1", "주간 회의", 6, List.of("마스터 범주"), "SM-9", "occurrence"),
        graphEvent("x1", "주간 회의(고침)", 13, List.of("예외 범주"), "SM-9", "exception"),
        graphEvent("x2", "주간 회의(또 고침)", 20, List.of("다른 예외"), "SM-9", "exception"));
    live("SM-9", "seriesMaster", null, List.of("마스터 범주"));
    long x1 = localId("x1");
    long weekly = tag("주간");

    tagService.setEventTags(ownerId, x1, List.of(tagIdNamed("예외 범주"), weekly));

    verify(graphCalendarClient).patchCategories("tok", "x1", List.of("예외 범주", "주간"));
    verify(graphCalendarClient).patchCategories("tok", "SM-9", List.of("마스터 범주", "주간"));
    assertThat(tagNames(x1)).containsExactly("예외 범주", "주간");
    assertThat(tagNames(localId("r1"))).containsExactly("마스터 범주", "주간");
    assertThat(tagNames(localId("x2"))).containsExactly("다른 예외");
  }

  /**
   * 리뷰 반영 — 편집 권한으로 공유받은 동료 달력(canEdit=true 지만 owner 가 다른 사서함)은 일정이 남의 사서함에 있어 {@code /me/events} 로
   * 쓸 수 없다: tagsEditable=false, PUT 은 409 이고 Graph 를 부르지 않는다. 그 달력의 범주는 내 태그로 만들지도 않는다. 기본 달력이 아니어도
   * 내 사서함 달력(owner 가 같은 주소 — 대소문자 무시)은 바꿀 수 있다.
   */
  @Test
  void calendarSharedWithEditRights_isNotEditable_butOwnSecondaryCalendarIs() {
    GraphCalendar coworker =
        new GraphCalendar(
            "gcoworker",
            "동료 달력",
            "lightGreen",
            "",
            false,
            true,
            new GraphEmail("동료", "coworker@test.local"));
    GraphCalendar secondary =
        new GraphCalendar(
            "gsecond",
            "개인",
            "lightPink",
            "",
            false,
            true,
            new GraphEmail("나", me().toUpperCase(java.util.Locale.ROOT)));
    Map<GraphCalendar, List<GraphEvent>> cals = new LinkedHashMap<>();
    cals.put(ownCalendar("gdefault", true), List.of());
    cals.put(coworker, List.of(single("cw1", "동료 회의", 9, List.of("동료 범주"))));
    cals.put(secondary, List.of(single("p1", "개인 일정", 10, List.of())));
    syncCalendars(cals);

    long shared = localId("cw1");
    long mine = tag("내 태그");
    assertThat(event(ownerId, shared).tagsEditable()).isFalse();
    assertThat(tagNames(shared)).isEmpty();
    assertThatThrownBy(() -> tagService.setEventTags(ownerId, shared, List.of(mine)))
        .isInstanceOf(ExternalEventTagNotSupportedException.class);
    verifyNoGraphWrite();

    long own = localId("p1");
    assertThat(event(ownerId, own).tagsEditable()).isTrue();
    tagService.setEventTags(ownerId, own, List.of(mine));
    verify(graphCalendarClient).patchCategories("tok", "p1", List.of("내 태그"));
  }

  /**
   * 공유받은 읽기 전용 달력(canEdit=false)의 일정은 써 넣을 수 없다 — tagsEditable=false, PUT 은 409 이고 Graph 를 부르지 않는다.
   * 초대받아 남의 사본을 보는 사람(참석자로 보이지만 그 사서함 주인이 아님)도 같다.
   */
  @Test
  void sharedReadOnlyCalendar_andOthersCopy_areNotEditable() {
    sync("gshared", false, single("sh1", "동료 회의", 9, List.of("동료 범주")));
    long eventId = localId("sh1");
    long mine = tag("내 태그");
    assertThat(event(ownerId, eventId).tagsEditable()).isFalse();
    assertThatThrownBy(() -> tagService.setEventTags(ownerId, eventId, List.of(mine)))
        .isInstanceOf(ExternalEventTagNotSupportedException.class);

    // 쓸 수 있는 달력이어도 남(참석자)에게는 아니다 — 그 사람의 /me 토큰으로는 주인 사서함에 쓸 수 없다.
    sync("gown2", true, single("o2", "내 회의", 11, List.of()));
    long own = localId("o2");
    otherUserId =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long other = withMembership(TestFixtures.createHuman(dsl));
                  attendeeRepo.insert(own, other, null, "ATTENDEE", "NEEDS_ACTION");
                  return other;
                });
    long othersTag = tagService.create(otherUserId, new CalendarTagRequest("남의 태그", null)).id();
    assertThat(event(otherUserId, own).tagsEditable()).isFalse();
    assertThatThrownBy(() -> tagService.setEventTags(otherUserId, own, List.of(othersTag)))
        .isInstanceOf(ExternalEventTagNotSupportedException.class);

    verifyNoGraphWrite();
  }

  /**
   * 리뷰 반영 — 메일 계정이 끊기면(disabled_at) 응답 tagsEditable 도 false 이고 PUT 도 409 다(같은 조건식). Graph 를 부르지
   * 않는다.
   */
  @Test
  void disabledAccount_isNotEditable_consistentlyInResponseAndWrite() {
    sync("gdis", true, single("d1", "회의", 15, List.of()));
    long eventId = localId("d1");
    long mine = tag("내 태그");
    assertThat(event(ownerId, eventId).tagsEditable()).isTrue();
    new TransactionTemplate(txManager)
        .execute(
            s ->
                dsl.update(EMAIL_ACCOUNT)
                    .set(EMAIL_ACCOUNT.DISABLED_AT, OffsetDateTime.now())
                    .where(EMAIL_ACCOUNT.ID.eq(accountId))
                    .execute());

    assertThat(event(ownerId, eventId).tagsEditable()).isFalse();
    assertThatThrownBy(() -> tagService.setEventTags(ownerId, eventId, List.of(mine)))
        .isInstanceOf(ExternalEventTagNotSupportedException.class);
    verifyNoGraphWrite();
  }

  /** Graph 쓰기(또는 읽기)가 실패하면 502(ExternalCalendarWriteException)이고 로컬 연결은 그대로다. */
  @Test
  void graphFailure_leavesLocalLinksUnchanged() {
    sync("gfail", true, single("f1", "실패 회의", 12, List.of("유지")));
    long eventId = localId("f1");
    long other = tag("새 태그");
    doThrow(new MailSendException("Graph patch 실패: 503"))
        .when(graphCalendarClient)
        .patchCategories(anyString(), anyString(), anyList());

    assertThatThrownBy(() -> tagService.setEventTags(ownerId, eventId, List.of(other)))
        .isInstanceOf(ExternalCalendarWriteException.class);
    assertThat(tagNames(eventId)).containsExactly("유지");

    when(graphCalendarClient.getEventCategoryState("tok", "f1"))
        .thenThrow(new MailSyncException("Graph API 호출 실패: 404"));
    assertThatThrownBy(() -> tagService.setEventTags(ownerId, eventId, List.of(other)))
        .isInstanceOf(ExternalCalendarWriteException.class);
    assertThat(tagNames(eventId)).containsExactly("유지");
  }

  /**
   * 호출자 트랜잭션 안에서 부르면 Graph 를 읽기도 전에 다른 외부 쓰기와 같은 예외로 막는다(커넥션 점유 방지 가드) — 태그 주인 확인 등 다른 판정보다 먼저다(남의
   * 태그를 보내도 같은 예외).
   */
  @Test
  void insideTransaction_isRejectedBeforeAnyGraphCall() {
    sync("gtx", true, single("t1", "tx 회의", 14, List.of()));
    long eventId = localId("t1");
    long t = tag("태그");
    assertThatThrownBy(
            () ->
                new TransactionTemplate(txManager)
                    .execute(
                        s -> {
                          tagService.setEventTags(ownerId, eventId, List.of(t, Long.MAX_VALUE));
                          return null;
                        }))
        .isInstanceOf(ExternalCalendarWriteInTransactionException.class);
    verifyNoGraphWrite();
  }

  /**
   * 리뷰 반영 — 동기화가 Graph 를 읽은 뒤 앱이 범주를 써 넣고, 그 다음에 동기화가 저장하면: 동기화가 가진 범주는 써 넣기 전 값이라 그 일정의 범주 연결은
   * 건너뛰어 새 연결이 남는다. 다음 동기화(써 넣기 뒤에 읽음)는 평소처럼 Outlook 값으로 맞춘다.
   */
  @Test
  void syncThatReadBeforeTheWrite_doesNotRevertNewLinks() {
    sync("grace", true, single("g1", "경합 회의", 16, List.of("옛 범주")));
    long eventId = localId("g1");
    long fresh = tag("새 범주");
    long old = tagIdNamed("옛 범주");

    // 다음 동기화: Graph 를 읽는 도중(수집 시작 뒤) 앱이 태그를 바꾸고, 동기화는 읽어 둔 옛 범주로 저장하려 한다.
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("grace"), any(), any()))
        .thenAnswer(
            inv -> {
              tagService.setEventTags(ownerId, eventId, List.of(fresh));
              return List.of(single("g1", "경합 회의", 16, List.of("옛 범주")));
            });
    syncService.sync(ownerId, accountId);

    verify(graphCalendarClient).patchCategories("tok", "g1", List.of("새 범주"));
    assertThat(tagNames(eventId)).containsExactly("새 범주");

    // 그 다음 동기화는 써 넣기 뒤에 읽었으므로 그대로 반영한다(Outlook 에서 옛 범주를 다시 붙였다고 치자).
    when(graphCalendarClient.listCalendarView(eq("tok"), eq("grace"), any(), any()))
        .thenReturn(List.of(single("g1", "경합 회의", 16, List.of("새 범주", "옛 범주"))));
    syncService.sync(ownerId, accountId);
    assertThat(tagNames(eventId)).containsExactly("새 범주", "옛 범주");
    assertThat(old).isEqualTo(tagIdNamed("옛 범주"));
  }

  /**
   * 리뷰 반영 — Graph 에 써 넣는 사이 더할 태그가 지워져도 500 이 아니다: 남은 태그만 연결하고, 지워진 태그는 다음 동기화가 Outlook 범주로 다시 맞춘다.
   */
  @Test
  void tagDeletedWhileWriting_doesNotFail() {
    sync("gdel", true, single("e1", "회의", 17, List.of()));
    long eventId = localId("e1");
    long keep = tag("남는 태그");
    long gone = tag("지울 태그");
    doAnswer(
            inv -> {
              tagService.delete(ownerId, gone);
              return null;
            })
        .when(graphCalendarClient)
        .patchCategories(anyString(), anyString(), anyList());

    tagService.setEventTags(ownerId, eventId, List.of(keep, gone));

    verify(graphCalendarClient).patchCategories("tok", "e1", List.of("남는 태그", "지울 태그"));
    assertThat(tagNames(eventId)).containsExactly("남는 태그");
  }
}
