package com.workplace.action;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.exception.UserNotFoundException;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 확인카드 파라미터·대상 오류의 상태코드/문구 매핑 회귀 테스트(#843).
 *
 * <p>무엇을·왜: 실패 사유는 카드 인라인·대화 이력·AI 자가교정에 그대로 쓰인다. 예전엔 (1) 없는 사용자 add_member 가 403 "테넌트 멤버가 아닙니다"로
 * 권한 문제처럼 보였고, (2) 날짜 파싱 실패가 캐치올 500 이 됐으며, (3) Enum·Jackson·Validator 의 영문 원문이 그대로 노출됐다. 모두
 * 사전검증(validate)과 승인(confirm)이 공유하는 prepare 단계라 validate 로 고정한다. 400 은 GlobalExceptionHandler 가
 * IllegalArgumentException 을 매핑한 결과다.
 */
@Transactional
class ConfirmActionErrorMappingTest extends IntegrationTestBase {

  @Autowired ConfirmActionDispatcher dispatcher;
  @Autowired ObjectMapper objectMapper;
  @Autowired ProjectService projectService;
  @Autowired DSLContext dsl;

  private long owner;
  private String projectKey;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    owner = TestFixtures.createHuman(dsl);
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, owner)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, owner)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    projectKey = "EM" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    projectService.create(owner, new CreateProjectRequest(projectKey, "에러 매핑", null));
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  private ObjectNode eventBody() {
    ObjectNode p = objectMapper.createObjectNode();
    p.put("title", "매핑 테스트");
    p.put("startsAt", "2026-06-26T01:00:00Z");
    p.put("endsAt", "2026-06-26T02:00:00Z");
    p.put("allDay", false);
    return p;
  }

  @Test
  @DisplayName("add_member — 존재하지 않는 사용자는 403 이 아니라 404(UserNotFound)")
  void addMember_missingUser_isNotFound() {
    ObjectNode p = objectMapper.createObjectNode();
    p.put("key", projectKey);
    p.put("userId", 987_654_321L);
    p.put("role", "MEMBER");

    assertThatThrownBy(() -> dispatcher.validate(owner, "project.add_member", p))
        .isInstanceOf(UserNotFoundException.class)
        .hasMessageContaining("현재 테넌트에 해당 사용자가 없습니다");
  }

  @Test
  @DisplayName("add_member — 타 테넌트 사용자도 같은 404 (존재를 403/404 차이로 드러내지 않음)")
  void addMember_foreignUser_isSameNotFound() {
    long foreigner = TestFixtures.createHuman(dsl); // 멤버십 없음
    ObjectNode p = objectMapper.createObjectNode();
    p.put("key", projectKey);
    p.put("userId", foreigner);
    p.put("role", "MEMBER");

    assertThatThrownBy(() -> dispatcher.validate(owner, "project.add_member", p))
        .isInstanceOf(UserNotFoundException.class)
        .hasMessageContaining("현재 테넌트에 해당 사용자가 없습니다");
  }

  @Test
  @DisplayName("occurrenceDate 형식 오류 — 500 이 아니라 400 + 형식 예시")
  void occurrenceDate_malformed_isBadRequest() {
    ObjectNode p = objectMapper.createObjectNode();
    p.put("id", 1);
    p.put("occurrenceDate", "내일 10시");

    assertThatThrownBy(() -> dispatcher.validate(owner, "calendar.delete_event", p))
        .isExactlyInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("occurrenceDate")
        .hasMessageContaining("ISO-8601");
  }

  @Test
  @DisplayName("scope 오타 — Enum 영문 원문 대신 허용값 목록")
  void scope_unknown_listsAllowedValues() {
    ObjectNode p = objectMapper.createObjectNode();
    p.put("id", 1);
    p.put("scope", "EVERYTHING");

    assertThatThrownBy(() -> dispatcher.validate(owner, "calendar.delete_event", p))
        .isExactlyInstanceOf(IllegalArgumentException.class)
        .hasMessageStartingWith("scope 는 [")
        .hasMessageNotContaining("No enum constant");
  }

  @Test
  @DisplayName("숫자 아닌 id — 조용히 0 으로 바뀌어 엉뚱한 404 가 되지 않고 400")
  void id_nonNumeric_isBadRequest() {
    ObjectNode p = objectMapper.createObjectNode();
    p.put("id", "abc");

    assertThatThrownBy(() -> dispatcher.validate(owner, "drive.delete_file", p))
        .isExactlyInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("id 는 정수여야 합니다");
  }

  @Test
  @DisplayName("boolean 아닌 active — 조용히 false(비활성화)가 되지 않고 400")
  void active_nonBoolean_isBadRequest() {
    // user.set_active 는 user:write 게이트가 파라미터 해석보다 먼저라 ADMIN 호출자가 필요하다.
    long admin = TestFixtures.createHuman(dsl);
    Long adminRole = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, admin)
        .set(USER_ROLE.ROLE_ID, adminRole)
        .execute();
    ObjectNode p = objectMapper.createObjectNode();
    p.put("userId", owner);
    p.put("active", "yes");

    assertThatThrownBy(() -> dispatcher.validate(admin, "user.set_active", p))
        .isExactlyInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("active 는 true 또는 false");
  }

  @Test
  @DisplayName("DTO 필드 타입 불일치 — Jackson 원문 대신 필드명 포함 한국어 사유")
  void mapping_typeMismatch_namesField() {
    ObjectNode p = eventBody();
    p.put("allDay", "maybe");

    assertThatThrownBy(() -> dispatcher.validate(owner, "calendar.create_event", p))
        .isExactlyInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("'allDay'")
        .hasMessageNotContaining("Cannot deserialize");
  }

  @Test
  @DisplayName("params 누락 — Validator 영문(HV000116) 대신 한국어")
  void mapping_nullParams_isKorean() {
    assertThatThrownBy(() -> dispatcher.validate(owner, "calendar.create_event", null))
        .isExactlyInstanceOf(IllegalArgumentException.class)
        .hasMessage("params 는 JSON 객체여야 합니다");
  }
}
