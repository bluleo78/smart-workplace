package com.workplace.home.service;

import static com.workplace.jooq.Tables.CONTACT_ENTRY;
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
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.support.IntegrationTestBase;
import java.util.Map;
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
    assertThatThrownBy(() -> service.confirm(caller, "unknown.action", params("{}")))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void mail_send_는_RBAC권한_없이도_지원된다_미지원아님() throws Exception {
    // mail.send 는 빈-sentinel 권한(소유권 경계) — calendar 권한만 가진 유저도 actionType 자체는 지원됨.
    // 계정-소유권 위반(존재하지 않는 accountId 999999)은 EmailAccountNotFoundException으로 전파됨(미지원 IllegalArgument
    // 아님).
    long caller = userWith("calendar:read"); // mail 관련 RBAC 권한 없음
    assertThatThrownBy(
            () ->
                service.confirm(
                    caller,
                    "mail.send",
                    params(
                        "{\"accountId\":999999,\"to\":[\"a@x.com\"],\"subject\":\"s\",\"bodyText\":\"b\"}")))
        .isInstanceOf(EmailAccountNotFoundException.class) // 소유권 위반 — 도메인 예외 전파
        .isNotInstanceOf(IllegalArgumentException.class) // 미지원 400 아님(분기 진입)
        .isNotInstanceOf(AccessDeniedException.class); // RBAC 게이트 없음(sentinel 권한)
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

  /** 호출자 소유 외부 연락처를 contact_entry 에 직접 시드하고 id 반환. */
  private long seedExternalContactOwnedBy(long ownerId) {
    return dsl.insertInto(CONTACT_ENTRY)
        .set(CONTACT_ENTRY.NAME, "테스트 연락처 " + UUID.randomUUID().toString().substring(0, 6))
        .set(CONTACT_ENTRY.OWNER_ID, ownerId)
        .set(CONTACT_ENTRY.VISIBILITY, "PERSONAL")
        .returning(CONTACT_ENTRY.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void contacts_delete_contact_확인_시_삭제() throws Exception {
    long caller = userWith("contact:read", "contact:write");
    long contactId = seedExternalContactOwnedBy(caller);
    // 삭제 전 존재 확인
    assertThat(
            dsl.fetchCount(
                CONTACT_ENTRY,
                CONTACT_ENTRY.ID.eq(contactId).and(CONTACT_ENTRY.OWNER_ID.eq(caller))))
        .isEqualTo(1);

    Object result =
        service.confirm(caller, "contacts.delete_contact", params("{\"id\":" + contactId + "}"));

    // 반환값은 { "deleted": id } 형태(Map)
    assertThat(result).isInstanceOf(Map.class);
    @SuppressWarnings("unchecked")
    Map<String, Object> res = (Map<String, Object>) result;
    assertThat(res.get("deleted")).isEqualTo(contactId);

    // DB 에서 실제로 삭제됐는지 확인
    assertThat(dsl.fetchCount(CONTACT_ENTRY, CONTACT_ENTRY.ID.eq(contactId))).isZero();
  }

  @Test
  void contacts_delete_contact_write권한_없으면_AccessDenied() throws Exception {
    // contact:write 없으면 RBAC 게이트에서 먼저 403 — contactId 가 실존하지 않아도 권한 검사 선행.
    long caller = userWith("contact:read"); // write 없음
    assertThatThrownBy(
            () -> service.confirm(caller, "contacts.delete_contact", params("{\"id\":1}")))
        .isInstanceOf(AccessDeniedException.class);
  }

  /** key 충돌 방지용 유니크 suffix. 규칙 ^[A-Z][A-Z0-9]{1,9}$ 준수: 최대 9자 이내로 자름. */
  private String uniqueSuffix() {
    return UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 7);
  }

  @Test
  void project_create_project_확인_시_생성() throws Exception {
    // project:write 권한으로 프로젝트 생성 — 호출자가 OWNER 로 자동 등록됨.
    long caller = userWith("project:read", "project:write");
    Object result =
        service.confirm(
            caller,
            "project.create_project",
            params("{\"key\":\"N" + uniqueSuffix() + "\",\"name\":\"새 프로젝트\"}"));
    assertThat(result).isNotNull();
    assertThat(result).isInstanceOf(ProjectResponse.class);
  }

  @Test
  void project_create_project_write권한_없으면_AccessDenied() throws Exception {
    // project:write 없으면 RBAC 게이트에서 먼저 403.
    long caller = userWith("project:read"); // write 없음
    assertThatThrownBy(
            () ->
                service.confirm(
                    caller, "project.create_project", params("{\"key\":\"AAA\",\"name\":\"n\"}")))
        .isInstanceOf(AccessDeniedException.class);
  }

  @Test
  void project_delete_project_는_manage권한_요구() throws Exception {
    // project:manage 없으면 RBAC 게이트에서 먼저 403.
    long caller = userWith("project:read", "project:write"); // manage 없음
    assertThatThrownBy(
            () -> service.confirm(caller, "project.delete_project", params("{\"key\":\"AAA\"}")))
        .isInstanceOf(AccessDeniedException.class);
  }

  @Test
  void project_delete_project_확인_시_삭제() throws Exception {
    // project:write + project:manage 로 생성 후 소프트삭제.
    long caller = userWith("project:read", "project:write", "project:manage");
    String key = "D" + uniqueSuffix();
    // 프로젝트 먼저 생성(호출자가 OWNER 로 자동 등록됨)
    service.confirm(
        caller, "project.create_project", params("{\"key\":\"" + key + "\",\"name\":\"삭제 대상\"}"));
    // 소프트삭제 실행
    Object result =
        service.confirm(caller, "project.delete_project", params("{\"key\":\"" + key + "\"}"));
    assertThat(result).isInstanceOf(Map.class);
    @SuppressWarnings("unchecked")
    Map<String, Object> res = (Map<String, Object>) result;
    assertThat(res.get("deleted")).isEqualTo(key);
  }

  @Test
  void project_add_member_는_manage권한_요구() throws Exception {
    // project:manage 없으면 RBAC 게이트에서 먼저 403.
    long caller = userWith("project:read", "project:write"); // manage 없음
    assertThatThrownBy(
            () ->
                service.confirm(
                    caller,
                    "project.add_member",
                    params("{\"key\":\"AAA\",\"userId\":1,\"role\":\"MEMBER\"}")))
        .isInstanceOf(AccessDeniedException.class);
  }

  @Test
  void project_add_member_확인_시_멤버추가() throws Exception {
    // project:write + project:manage 로 프로젝트 생성 후 다른 사용자 멤버 추가.
    long caller = userWith("project:read", "project:write", "project:manage");
    long newMember = userWith("project:read");
    String key = "M" + uniqueSuffix();
    // TEAM 프로젝트 생성(호출자 OWNER 자동 등록)
    service.confirm(
        caller,
        "project.create_project",
        params("{\"key\":\"" + key + "\",\"name\":\"팀 프로젝트\",\"type\":\"TEAM\"}"));
    // 멤버 추가 실행
    Object result =
        service.confirm(
            caller,
            "project.add_member",
            params("{\"key\":\"" + key + "\",\"userId\":" + newMember + ",\"role\":\"MEMBER\"}"));
    assertThat(result).isNotNull();
  }
}
