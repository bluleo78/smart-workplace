package com.workplace.action;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.service.CalendarService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.jooq.Tables;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * ConfirmActionDispatcher — calendar.create_event 경로 집중 테스트.
 *
 * <p>AI 페이로드가 calendarId 를 생략했을 때 기본 캘린더로 resolve 되는 경로와, 팔레트 외 색을 지정했을 때 IllegalArgumentException
 * 이 발생하는 경로를 직접 검증한다.
 */
@Transactional
class ConfirmActionDispatcherCalendarTest extends IntegrationTestBase {

  @Autowired ConfirmActionDispatcher dispatcher;
  @Autowired ObjectMapper objectMapper;
  @Autowired CalendarService calendarService;
  @Autowired DSLContext dsl;

  private long caller;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    // USER 시스템 역할(calendar:write 포함)을 부여한 사람 사용자 시드.
    caller = seedHumanUser("cal_dispatch");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /**
   * HUMAN 유저 생성 + USER 역할 부여(기존 ConfirmActionDispatcherTest.seedHumanUser 와 동일 패턴). calendar:write
   * 권한은 USER 역할에 포함되어 있다.
   */
  private long seedHumanUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(Tables.USER)
            .set(Tables.USER.USERNAME, prefix + "_" + suffix)
            .set(Tables.USER.PASSWORD, "pw")
            .set(Tables.USER.NAME, prefix)
            .set(Tables.USER.EMAIL, prefix + "_" + suffix + "@example.com")
            .set(Tables.USER.KIND, "HUMAN")
            .returning(Tables.USER.ID)
            .fetchOne()
            .getId();
    Long roleId =
        dsl.select(Tables.ROLE.ID)
            .from(Tables.ROLE)
            .where(Tables.ROLE.NAME.eq("USER"))
            .fetchOne(Tables.ROLE.ID);
    dsl.insertInto(Tables.USER_ROLE)
        .set(Tables.USER_ROLE.USER_ID, id)
        .set(Tables.USER_ROLE.ROLE_ID, roleId)
        .execute();
    // WP-420: 역할 권한은 같은 테넌트의 ACTIVE 멤버일 때만 유효하다.
    TestFixtures.activeMemberOfCurrentTenant(dsl, id);
    return id;
  }

  /**
   * [케이스 1] AI 페이로드에 calendarId 없음 → 기본 캘린더로 자동 resolve.
   *
   * <p>JSON-without-calendarId → Jackson null 역직렬화 → resolveCalendarId null 경로 → ensureDefault 호출 →
   * 생성된 이벤트의 calendarId 가 기본 캘린더 id 와 일치해야 한다.
   */
  @Test
  void confirm_calendarCreateEvent_withoutCalendarId_resolvesToDefaultCalendar() {
    // params 에 calendarId 미포함 — AI 가 필드를 생략한 상황을 재현.
    ObjectNode params = objectMapper.createObjectNode();
    params.put("title", "기본캘린더 resolve 테스트");
    params.put("startsAt", "2026-08-01T10:00:00+09:00");
    params.put("endsAt", "2026-08-01T11:00:00+09:00");
    params.put("allDay", false);

    // 기본 캘린더 id 를 미리 ensureDefault 로 확정(없으면 생성, 있으면 반환).
    long defaultCalendarId = calendarService.ensureDefault(caller);

    Object result = dispatcher.confirm(caller, "calendar.create_event", params);

    assertThat(result).isInstanceOf(CalendarEventResponse.class);
    CalendarEventResponse event = (CalendarEventResponse) result;
    assertThat(event.id()).isPositive();
    // calendarId 가 기본 캘린더 id 와 일치 — null → ensureDefault 경로가 실제로 동작했음을 증명.
    assertThat(event.calendarId()).isEqualTo(defaultCalendarId);
  }

  /**
   * [케이스 2] 팔레트 외 색(hex 코드 등) 지정 → IllegalArgumentException.
   *
   * <p>허용 팔레트 = {blue, green, red, amber, violet, pink, teal, gray}. hex 형식 "#abcdef" 은 해당하지 않으므로
   * validateColorOverride 에서 예외가 발생해야 한다.
   */
  @Test
  void confirm_calendarCreateEvent_invalidColor_throwsIllegalArgumentException() {
    ObjectNode params = objectMapper.createObjectNode();
    params.put("title", "색 검증 테스트");
    params.put("startsAt", "2026-08-02T09:00:00+09:00");
    params.put("endsAt", "2026-08-02T10:00:00+09:00");
    params.put("allDay", false);
    // 팔레트에 없는 hex 색 → 거부되어야 함.
    params.put("color", "#abcdef");

    assertThatThrownBy(() -> dispatcher.confirm(caller, "calendar.create_event", params))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("허용되지 않은 색");
  }

  /** 이벤트 기본 params(제목·시간) — 케이스별로 필드를 덧붙인다. */
  private ObjectNode eventParams(String title) {
    ObjectNode params = objectMapper.createObjectNode();
    params.put("title", title);
    params.put("startsAt", "2026-08-03T09:00:00+09:00");
    params.put("endsAt", "2026-08-03T10:00:00+09:00");
    return params;
  }

  /**
   * [케이스 3] 모르는 필드는 조용히 버리지 않고 거절한다(#852). 이전에는 AI 가 보낸 attendees(이메일)가 무시돼 "승인했는데 참석자 없음"이 되었다.
   * 사전검증에서 필드 이름을 짚어 주므로 AI 가 스스로 고칠 수 있다.
   */
  @Test
  void validate_calendarCreateEvent_unknownField_rejectedWithFieldName() {
    ObjectNode params = eventParams("모르는 필드");
    params.putArray("attendees").add("kim@example.com");

    assertThatThrownBy(() -> dispatcher.validate(caller, "calendar.create_event", params))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("잘못된 params: 알 수 없는 필드 'attendees'");
  }

  /**
   * WP-727: 승인 카드에서 고친 값의 검증 실패는 사람이 읽는 문장으로 돌려준다 — 예전엔 「잘못된 params: validRange — …」 같은 내부 경로가 토스트에
   * 그대로 보였다.
   */
  @Test
  void confirm_calendarCreateEvent_invalidOverrides_returnReadableKoreanMessages() {
    ObjectNode reversed = eventParams("회의");
    reversed.put("startsAt", "2026-08-03T12:00:00+09:00");
    reversed.put("endsAt", "2026-08-03T09:00:00+09:00");
    assertThatThrownBy(() -> dispatcher.confirm(caller, "calendar.create_event", reversed))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("종료 시각은 시작 시각보다 뒤여야 합니다");

    ObjectNode longTitle = eventParams("가".repeat(600));
    assertThatThrownBy(() -> dispatcher.confirm(caller, "calendar.create_event", longTitle))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("제목: 최대 200까지 입력할 수 있습니다");

    ObjectNode longLocation = eventParams("회의");
    longLocation.put("location", "x".repeat(5000));
    assertThatThrownBy(() -> dispatcher.confirm(caller, "calendar.create_event", longLocation))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("장소: 최대 200까지 입력할 수 있습니다");
  }

  /** [케이스 4] conflicts 는 카드 표시용이라 엄격 매핑에서도 받아들인다(생성 입력에서 떼어냄). */
  @Test
  void confirm_calendarCreateEvent_withDisplayOnlyConflicts_creates() {
    ObjectNode params = eventParams("충돌 표시 포함");
    params.putArray("conflicts").addObject().put("id", 1).put("title", "기존 회의");

    Object result = dispatcher.confirm(caller, "calendar.create_event", params);

    assertThat(((CalendarEventResponse) result).title()).isEqualTo("충돌 표시 포함");
  }

  /** [케이스 5] 수정으로 참석자를 바꾸려 하면 조용히 무시하지 않고 거절한다(#852). */
  @Test
  void validate_calendarUpdateEvent_withAttendees_rejected() {
    long eventId =
        ((CalendarEventResponse)
                dispatcher.confirm(caller, "calendar.create_event", eventParams("수정 대상")))
            .id();
    ObjectNode params = eventParams("수정 대상");
    params.put("id", eventId);
    params.putArray("attendeeUserIds").add(caller);

    assertThatThrownBy(() -> dispatcher.validate(caller, "calendar.update_event", params))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("참석자를 바꿀 수 없습니다");
  }

  /** 기본 캘린더 설정 행(WP-2169)을 직접 시드한다 — 설정 API 와 무관하게 해석 경로만 본다. */
  private void setPreferred(long calendarId) {
    dsl.insertInto(Tables.CALENDAR_USER_SETTING)
        .set(Tables.CALENDAR_USER_SETTING.USER_ID, caller)
        .set(Tables.CALENDAR_USER_SETTING.PREFERRED_CALENDAR_ID, calendarId)
        .execute();
  }

  /** 캘린더 시드 — externalAccountId 가 있으면 외부(Outlook) 쓰기 가능 캘린더. */
  private long insertCalendar(Long externalAccountId) {
    return dsl.insertInto(Tables.CALENDAR)
        .set(Tables.CALENDAR.OWNER_ID, caller)
        .set(Tables.CALENDAR.NAME, externalAccountId == null ? "두 번째" : "Outlook")
        .set(Tables.CALENDAR.COLOR, "blue")
        .set(Tables.CALENDAR.IS_DEFAULT, false)
        .set(Tables.CALENDAR.POSITION, 1)
        .set(Tables.CALENDAR.EXTERNAL_ACCOUNT_ID, externalAccountId)
        .set(
            Tables.CALENDAR.EXTERNAL_ID,
            externalAccountId == null ? null : "ext-" + System.nanoTime())
        .set(Tables.CALENDAR.IS_READ_ONLY, false)
        .returning(Tables.CALENDAR.ID)
        .fetchOne()
        .getId();
  }

  /** 활성 M365 메일 계정. */
  private long insertM365Account() {
    return dsl.insertInto(Tables.EMAIL_ACCOUNT)
        .set(Tables.EMAIL_ACCOUNT.USER_ID, caller)
        .set(Tables.EMAIL_ACCOUNT.EMAIL_ADDRESS, "acc-" + System.nanoTime() + "@example.com")
        .set(Tables.EMAIL_ACCOUNT.DISPLAY_NAME, "acc")
        .set(Tables.EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .returning(Tables.EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * WP-2169: 기본 캘린더가 Outlook(외부) 이어도 확인 카드(호출자 트랜잭션 안)는 Works 캘린더로 정한다 — 사전검증이 통과하고 승인 결과도 Works 이며
   * Graph 쓰기 차단 예외(ExternalCalendarWriteInTransactionException)가 나지 않는다.
   */
  @Test
  void confirm_calendarCreateEvent_preferredExternal_landsInWorksCalendar() {
    long works = calendarService.ensureDefault(caller);
    setPreferred(insertCalendar(insertM365Account()));
    ObjectNode params = eventParams("Outlook 기본인데 카드 승인");

    dispatcher.validate(caller, "calendar.create_event", params);
    Object result = dispatcher.confirm(caller, "calendar.create_event", params);

    assertThat(((CalendarEventResponse) result).calendarId()).isEqualTo(works);
  }

  /** WP-2169: 기본 캘린더가 두 번째 로컬 캘린더면 캘린더를 생략한 카드 승인 결과가 그 캘린더다. */
  @Test
  void confirm_calendarCreateEvent_preferredLocal_landsInPreferredCalendar() {
    calendarService.ensureDefault(caller);
    long second = insertCalendar(null);
    setPreferred(second);
    ObjectNode params = eventParams("두 번째 캘린더 기본");

    dispatcher.validate(caller, "calendar.create_event", params);
    Object result = dispatcher.confirm(caller, "calendar.create_event", params);

    assertThat(((CalendarEventResponse) result).calendarId()).isEqualTo(second);
  }

  /** WP-2169: Works 캘린더가 아직 없는 사용자의 사전검증은 calendar 행을 만들지 않는다(쓰기 금지 dry-run). */
  @Test
  void validate_calendarCreateEvent_withoutWorksCalendar_insertsNothing() {
    dispatcher.validate(caller, "calendar.create_event", eventParams("사전검증만"));

    assertThat(dsl.fetchCount(Tables.CALENDAR, Tables.CALENDAR.OWNER_ID.eq(caller))).isZero();
  }
}
