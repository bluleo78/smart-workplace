package com.workplace.home.service;

import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.ROLE_PERMISSION;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.annotation.Transactional;

/** confirm 실행기 — 권한 검사·params 검증·도메인 실행을 service 레이어에서 검증. 메서드 롤백 격리. */
@Transactional
class HomeActionServiceTest extends IntegrationTestBase {
  @Autowired HomeActionService service;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;

  /** 유저 1명 + 전용 ROLE 에 주어진 권한코드를 부여해 시드. hasPermission 이 읽는 그 테이블. */
  private long userWith(String... permissionCodes) {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long uid =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "ha_" + t)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "U " + t)
            .set(USER.EMAIL, t + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    long rid =
        dsl.insertInto(ROLE).set(ROLE.NAME, "ha_role_" + t).returning(ROLE.ID).fetchOne().getId();
    for (String code : permissionCodes) {
      Long permId =
          dsl.select(PERMISSION.ID)
              .from(PERMISSION)
              .where(PERMISSION.CODE.eq(code))
              .fetchOne(PERMISSION.ID);
      dsl.insertInto(ROLE_PERMISSION)
          .set(ROLE_PERMISSION.ROLE_ID, rid)
          .set(ROLE_PERMISSION.PERMISSION_ID, permId)
          .execute();
    }
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, uid).set(USER_ROLE.ROLE_ID, rid).execute();
    return uid;
  }

  private JsonNode params(String json) throws Exception {
    return om.readTree(json);
  }

  @Test
  void calendar_create_event_확인_시_일정_생성하고_결과_반환() throws Exception {
    long caller = userWith("calendar:read", "calendar:write");
    Object result =
        service.confirm(
            caller,
            "calendar.create_event",
            params(
                "{\"title\":\"팀 미팅\",\"startsAt\":\"2026-06-26T01:00:00Z\",\"endsAt\":\"2026-06-26T02:00:00Z\",\"allDay\":false}"));
    assertThat(result).isInstanceOf(CalendarEventResponse.class);
    assertThat(((CalendarEventResponse) result).title()).isEqualTo("팀 미팅");
    assertThat(((CalendarEventResponse) result).id()).isPositive();
  }

  @Test
  void calendar_write_권한이_없으면_AccessDenied() throws Exception {
    long caller = userWith("calendar:read"); // write 없음
    assertThatThrownBy(
            () ->
                service.confirm(
                    caller,
                    "calendar.create_event",
                    params(
                        "{\"title\":\"x\",\"startsAt\":\"2026-06-26T01:00:00Z\",\"endsAt\":\"2026-06-26T02:00:00Z\",\"allDay\":false}")))
        .isInstanceOf(AccessDeniedException.class);
  }

  @Test
  void 미지원_actionType_은_IllegalArgument() throws Exception {
    long caller = userWith("calendar:read", "calendar:write");
    assertThatThrownBy(() -> service.confirm(caller, "mail.send", params("{}")))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void 잘못된_params_endsAt이_startsAt보다_앞이면_IllegalArgument() throws Exception {
    long caller = userWith("calendar:read", "calendar:write");
    assertThatThrownBy(
            () ->
                service.confirm(
                    caller,
                    "calendar.create_event",
                    params(
                        "{\"title\":\"x\",\"startsAt\":\"2026-06-26T02:00:00Z\",\"endsAt\":\"2026-06-26T01:00:00Z\",\"allDay\":false}")))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
