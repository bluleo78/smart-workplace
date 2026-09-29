package com.workplace.action;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.exception.UserGroupForbiddenException;
import com.workplace.user.exception.UserGroupNotFoundException;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * #839 확인 카드 contacts.delete_user_group 통합 테스트.
 *
 * <p>그룹 삭제는 하위 그룹·멤버십까지 캐스케이드되고 복원 API 가 없어 AI 는 확인 카드로만 한다. (1) 사전검증이 승인 시점과 같은 권한
 * 경계(SHARED=manage, PERSONAL=소유자)로 거절하는지, (2) 승인이 실제로 삭제하는지, (3) 모르는 필드를 조용히 버리지 않는지를 고정한다.
 */
@Transactional
class ConfirmActionDispatcher839Test extends IntegrationTestBase {

  @Autowired ConfirmActionDispatcher dispatcher;
  @Autowired ObjectMapper objectMapper;
  @Autowired DSLContext dsl;

  private long owner;
  private long other;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    owner = seedHuman("USER");
    other = seedHuman("USER");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /** HUMAN 유저 + 지정 역할 + 테넌트#1 ACTIVE 멤버십. */
  private long seedHuman(String roleName) {
    long id = TestFixtures.createHuman(dsl);
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(roleName)).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private long seedGroup(String visibility, Long ownerId, Long parentId) {
    return dsl.insertInto(USER_GROUP)
        .set(USER_GROUP.NAME, "g-" + UUID.randomUUID().toString().substring(0, 8))
        .set(USER_GROUP.VISIBILITY, visibility)
        .set(USER_GROUP.OWNER_ID, ownerId)
        .set(USER_GROUP.PARENT_ID, parentId)
        .returning(USER_GROUP.ID)
        .fetchOne()
        .getId();
  }

  private JsonNode idParams(long id) {
    return objectMapper.createObjectNode().put("id", id);
  }

  private boolean exists(long id) {
    return dsl.fetchExists(USER_GROUP, USER_GROUP.ID.eq(id));
  }

  @Test
  void personal_ownerConfirms_deletesSubtree() {
    long root = seedGroup("PERSONAL", owner, null);
    long child = seedGroup("PERSONAL", owner, root);
    dispatcher.validate(owner, "contacts.delete_user_group", idParams(root));
    Object result = dispatcher.confirm(owner, "contacts.delete_user_group", idParams(root));
    assertThat(result).isEqualTo(java.util.Map.of("deleted", root));
    assertThat(exists(root)).isFalse();
    assertThat(exists(child)).isFalse(); // 캐스케이드
  }

  @Test
  void personal_nonOwner_rejectedAtValidate_asNotFound() {
    long g = seedGroup("PERSONAL", owner, null);
    assertThatThrownBy(() -> dispatcher.validate(other, "contacts.delete_user_group", idParams(g)))
        .isInstanceOf(UserGroupNotFoundException.class);
    assertThatThrownBy(() -> dispatcher.confirm(other, "contacts.delete_user_group", idParams(g)))
        .isInstanceOf(UserGroupNotFoundException.class);
    assertThat(exists(g)).isTrue();
  }

  @Test
  void shared_withoutManage_rejectedAtValidateAndConfirm() {
    long g = seedGroup("SHARED", null, null);
    assertThatThrownBy(() -> dispatcher.validate(owner, "contacts.delete_user_group", idParams(g)))
        .isInstanceOf(UserGroupForbiddenException.class);
    assertThatThrownBy(() -> dispatcher.confirm(owner, "contacts.delete_user_group", idParams(g)))
        .isInstanceOf(UserGroupForbiddenException.class);
    assertThat(exists(g)).isTrue();
  }

  @Test
  void shared_admin_confirms() {
    long admin = seedHuman("ADMIN");
    long g = seedGroup("SHARED", null, null);
    dispatcher.confirm(admin, "contacts.delete_user_group", idParams(g));
    assertThat(exists(g)).isFalse();
  }

  @Test
  void rejectsUnknownFields() {
    long g = seedGroup("PERSONAL", owner, null);
    JsonNode p = objectMapper.createObjectNode().put("id", g).put("cascade", false);
    assertThatThrownBy(() -> dispatcher.validate(owner, "contacts.delete_user_group", p))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(exists(g)).isTrue();
  }
}
