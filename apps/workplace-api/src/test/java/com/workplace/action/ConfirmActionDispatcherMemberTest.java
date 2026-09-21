package com.workplace.action;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.annotation.Transactional;

/**
 * 구성원 쓰기 확인 액션(user.set_roles / user.set_active) 통합 테스트 (#833).
 *
 * <p>AI 가 확인 카드로 제안한 구성원 역할 변경·활성 토글이, 승인한 사람(callerId)의 권한과 테넌트 경계 안에서만 실행되는지 검증한다. 에이전트는 roleId 를
 * 모르므로 역할'명'을 넘기고 실행기가 서버에서 해석하는 계약도 함께 고정한다.
 */
@Transactional
class ConfirmActionDispatcherMemberTest extends IntegrationTestBase {

  @Autowired ConfirmActionDispatcher dispatcher;
  @Autowired ObjectMapper objectMapper;
  @Autowired DSLContext dsl;

  private long admin;
  private long target;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    admin = seedHuman("member_admin", "ADMIN");
    target = seedHuman("member_target", "USER");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /** HUMAN 유저 + 지정 역할 + 테넌트#1 ACTIVE 멤버십. requireMember 가 멤버십을 요구하므로 함께 넣는다. */
  private long seedHuman(String prefix, String roleName) {
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
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(roleName)).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private ObjectNode params() {
    return objectMapper.createObjectNode();
  }

  @Test
  void confirm_setRoles_byName_appliesRole() {
    ObjectNode p = params();
    p.put("userId", target);
    p.putArray("roles").add("ADMIN");

    dispatcher.confirm(admin, "user.set_roles", p);

    // 역할명 → roleId 해석은 서버가 수행한다(에이전트는 role:read 권한이 없다).
    Integer count =
        dsl.selectCount()
            .from(USER_ROLE)
            .join(ROLE)
            .on(ROLE.ID.eq(USER_ROLE.ROLE_ID))
            .where(USER_ROLE.USER_ID.eq(target).and(ROLE.NAME.eq("ADMIN")))
            .fetchOne(0, Integer.class);
    assertThat(count).isEqualTo(1);
  }

  @Test
  void confirm_setActive_deactivatesUser() {
    ObjectNode p = params();
    p.put("userId", target);
    p.put("active", false);

    dispatcher.confirm(admin, "user.set_active", p);

    Boolean active =
        dsl.select(USER.IS_ACTIVE).from(USER).where(USER.ID.eq(target)).fetchOne(0, Boolean.class);
    assertThat(active).isFalse();
  }

  @Test
  void confirm_setRoles_withoutPermission_denied() {
    // 일반 USER 역할 사용자는 role:assign 이 없다 — 실행 전 권한 게이트에서 막혀야 한다.
    ObjectNode p = params();
    p.put("userId", admin);
    p.putArray("roles").add("USER");

    assertThatThrownBy(() -> dispatcher.confirm(target, "user.set_roles", p))
        .isInstanceOf(AccessDeniedException.class);
  }

  @Test
  void confirm_setActive_nonMemberTarget_rejected() {
    // 멤버십 없는 사용자 = 이 테넌트 밖 사용자. 존재 자체를 노출하지 않고 거부해야 한다.
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long outsider =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "outsider_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "outsider")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();

    ObjectNode p = params();
    p.put("userId", outsider);
    p.put("active", false);

    assertThatThrownBy(() -> dispatcher.confirm(admin, "user.set_active", p))
        .isInstanceOf(RuntimeException.class);
    Boolean active =
        dsl.select(USER.IS_ACTIVE)
            .from(USER)
            .where(USER.ID.eq(outsider))
            .fetchOne(0, Boolean.class);
    assertThat(active).isTrue();
  }

  @Test
  void confirm_setRoles_missingRoles_rejected() {
    ObjectNode p = params();
    p.put("userId", target);

    assertThatThrownBy(() -> dispatcher.confirm(admin, "user.set_roles", p))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
