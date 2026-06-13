package com.workplace.tenant;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.tenant.repository.TenantRepository;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 멤버십/테넌트 상태 필터(보안) 검증. @Transactional 롤백으로 시드 데이터는 남지 않는다. */
@Transactional
class MembershipRepositoryTest extends IntegrationTestBase {

  @Autowired private MembershipRepository membershipRepository;
  @Autowired private TenantRepository tenantRepository;
  @Autowired private DSLContext dsl;

  private Long userId;
  private Long tenantId;

  @BeforeEach
  void setUp() {
    userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "mem@example.com")
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "Mem")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    tenantId =
        dsl.insertInto(TENANT)
            .set(TENANT.NAME, "Acme")
            .set(TENANT.SLUG, "acme-" + userId)
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
  }

  @Test
  void findActiveByUser_returnsActiveTenant() {
    assertThat(membershipRepository.findActiveByUser(userId))
        .anySatisfy(
            m -> {
              assertThat(m.tenantId()).isEqualTo(tenantId);
              assertThat(m.tenantName()).isEqualTo("Acme");
            });
  }

  @Test
  void findActiveByUser_excludesSuspendedMembership() {
    dsl.update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(userId).and(MEMBERSHIP.TENANT_ID.eq(tenantId)))
        .execute();
    assertThat(membershipRepository.findActiveByUser(userId))
        .noneSatisfy(m -> assertThat(m.tenantId()).isEqualTo(tenantId));
  }

  @Test
  void findActiveByUser_excludesSuspendedTenant() {
    dsl.update(TENANT).set(TENANT.STATUS, "SUSPENDED").where(TENANT.ID.eq(tenantId)).execute();
    assertThat(membershipRepository.findActiveByUser(userId))
        .noneSatisfy(m -> assertThat(m.tenantId()).isEqualTo(tenantId));
  }

  @Test
  void hasActiveMembership_trueForActive() {
    assertThat(membershipRepository.hasActiveMembership(userId, tenantId)).isTrue();
  }

  @Test
  void hasActiveMembership_falseWhenSuspended() {
    dsl.update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(userId).and(MEMBERSHIP.TENANT_ID.eq(tenantId)))
        .execute();
    assertThat(membershipRepository.hasActiveMembership(userId, tenantId)).isFalse();
  }

  @Test
  void isActive_falseWhenTenantSuspended() {
    dsl.update(TENANT).set(TENANT.STATUS, "SUSPENDED").where(TENANT.ID.eq(tenantId)).execute();
    assertThat(tenantRepository.isActive(tenantId)).isFalse();
  }
}
