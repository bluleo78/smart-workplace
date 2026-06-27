package com.workplace.action;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.service.CalendarService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.jooq.Tables;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

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
}
