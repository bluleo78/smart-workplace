package com.workplace.action;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** ConfirmActionDispatcher 통합 테스트 — HomeActionService에서 추출된 디스패치가 일정을 생성하는지. */
@Transactional
class ConfirmActionDispatcherTest extends IntegrationTestBase {

  @Autowired ConfirmActionDispatcher dispatcher;
  @Autowired ObjectMapper objectMapper;
  @Autowired DSLContext dsl;

  private long caller;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    // USER 시스템 역할(calendar:write 포함)을 부여한 사람 사용자를 시드.
    caller = seedHumanUser("dispatch_caller");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /**
   * HUMAN 유저를 생성하고 시스템 USER 역할(calendar:write 포함 기본 권한 세트)을 부여한다.
   * IntegrationTestBase.createAgentUser 의 HUMAN 버전.
   */
  private long seedHumanUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "_" + suffix + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  @Test
  void confirm_calendarCreateEvent_createsEvent() {
    ObjectNode params = objectMapper.createObjectNode();
    params.put("title", "디스패처 테스트 회의");
    params.put("startsAt", "2026-07-01T14:00:00+09:00");
    params.put("endsAt", "2026-07-01T15:00:00+09:00");
    params.put("allDay", false);

    Object result = dispatcher.confirm(caller, "calendar.create_event", params);

    assertThat(result).isInstanceOf(CalendarEventResponse.class);
    CalendarEventResponse event = (CalendarEventResponse) result;
    assertThat(event.id()).isPositive();
    assertThat(event.title()).isEqualTo("디스패처 테스트 회의");
  }
}
