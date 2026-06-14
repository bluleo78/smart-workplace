package com.workplace.tenant;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * membership.role (V69) 검증 — 운영자 콘솔의 초기 OWNER 지정과 기본값 백필. role 컬럼은 baseline jOOQ 코드젠에 없으므로
 * name-based field 로 읽고 쓴다. @Transactional 롤백으로 시드 데이터는 남지 않는다(공유 test DB 드리프트 방지).
 */
@Transactional
class MembershipRoleTest extends IntegrationTestBase {

  @Autowired private MembershipRepository membershipRepository;
  @Autowired private DSLContext dsl;

  private Long userId;
  private Long tenantId;

  @BeforeEach
  void setUp() {
    userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "role-test@example.com")
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "RoleTest")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // 케이스마다 별도 (user, tenant) 쌍을 보장하기 위해 테넌트는 슬러그에 userId 를 섞어 유니크하게 시드.
    tenantId =
        dsl.insertInto(TENANT)
            .set(TENANT.NAME, "RoleCo")
            .set(TENANT.SLUG, "roleco-" + userId)
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();
  }

  /** name-based field 로 (user, tenant) 멤버십의 role 을 읽는다. */
  private String fetchRole(Long uid, Long tid) {
    return dsl.select(DSL.field(DSL.name("role"), String.class))
        .from(MEMBERSHIP)
        .where(MEMBERSHIP.USER_ID.eq(uid))
        .and(MEMBERSHIP.TENANT_ID.eq(tid))
        .fetchOne()
        .value1();
  }

  @Test
  void createWithRole_persistsOwner() {
    membershipRepository.createWithRole(userId, tenantId, "ACTIVE", "OWNER");
    assertThat(fetchRole(userId, tenantId)).isEqualTo("OWNER");
  }

  @Test
  void create_defaultsToMember() {
    // role 미지정 create — DB DEFAULT 'MEMBER' 가 적용돼야 한다.
    membershipRepository.create(userId, tenantId, "ACTIVE");
    assertThat(fetchRole(userId, tenantId)).isEqualTo("MEMBER");
  }
}
