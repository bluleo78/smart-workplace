package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.exception.InvalidDmRequestException;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** DM find-or-create·검증 통합 테스트(실제 DB). */
@Transactional
class DmServiceTest extends IntegrationTestBase {

  @Autowired DmService dmService;
  @Autowired DSLContext dsl;

  /** 각 테스트 전 TenantContext 를 tenant#1 로 설정 — 멤버십 검증 통과를 위한 전제 조건. */
  @BeforeEach
  void setTenantContext() {
    TenantContext.set(1L);
  }

  /** 각 테스트 후 TenantContext 정리 — ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenantContext() {
    TenantContext.clear();
  }

  /**
   * 고유 username/email 로 user 1행 insert 후 id 반환 — 공유 test DB(롤백 없음) 충돌 회피. tenant#1 ACTIVE 멤버십도 함께
   * 삽입하여 DM 생성 시 테넌트 경계 검증을 통과시킨다.
   */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "ds_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Ds" + s)
            .set(USER.EMAIL, "ds_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // tenant#1 ACTIVE 멤버십 부여 — DM 생성 테넌트 경계 검증 통과용.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  @Test
  void createOrGet_oneToOne_isDeduped() {
    long a = seedUser();
    long b = seedUser();

    var first = dmService.createOrGet(a, List.of(b));
    var again = dmService.createOrGet(a, List.of(b));
    var reversed = dmService.createOrGet(b, List.of(a)); // 순서 무관

    assertThat(first.created()).isTrue();
    assertThat(again.created()).isFalse();
    assertThat(again.dm().id()).isEqualTo(first.dm().id());
    assertThat(reversed.dm().id()).isEqualTo(first.dm().id());
  }

  @Test
  void createOrGet_group_dedupBySet() {
    long a = seedUser();
    long b = seedUser();
    long c = seedUser();

    var g1 = dmService.createOrGet(a, List.of(b, c));
    var g1again = dmService.createOrGet(a, List.of(c, b)); // 같은 셋
    var g2 = dmService.createOrGet(a, List.of(b)); // 다른 셋

    assertThat(g1again.dm().id()).isEqualTo(g1.dm().id());
    assertThat(g2.dm().id()).isNotEqualTo(g1.dm().id());
  }

  @Test
  void createOrGet_rejectsInvalid() {
    long a = seedUser();
    assertThatThrownBy(() -> dmService.createOrGet(a, List.of()))
        .isInstanceOf(InvalidDmRequestException.class);
    assertThatThrownBy(() -> dmService.createOrGet(a, List.of(999_999_999L))) // 미존재
        .isInstanceOf(InvalidDmRequestException.class);
  }

  /** self-DM(본인만) 은 생성·dedup 되어야 한다(개인 메모 공간). */
  @Test
  void createOrGet_selfDm_createsAndDedups() {
    long a = seedUser();

    var first = dmService.createOrGet(a, List.of(a)); // 본인 id 를 타겟으로
    var again = dmService.createOrGet(a, List.of(a));

    assertThat(first.created()).isTrue();
    assertThat(again.created()).isFalse();
    assertThat(again.dm().id()).isEqualTo(first.dm().id());
    assertThat(first.dm().participants()).hasSize(1);
    assertThat(first.dm().participants().get(0).userId()).isEqualTo(a);
  }

  @Test
  void createOrGet_rejectsOverEight() {
    long a = seedUser();
    List<Long> targets =
        java.util.stream.IntStream.range(0, 8) // 본인+8 = 9 > 8
            .mapToObj(i -> seedUser())
            .toList();
    assertThatThrownBy(() -> dmService.createOrGet(a, targets))
        .isInstanceOf(InvalidDmRequestException.class);
  }

  @Test
  void listMyDms_returnsOnlyMine() {
    long a = seedUser();
    long b = seedUser();
    long c = seedUser();
    dmService.createOrGet(a, List.of(b));
    dmService.createOrGet(b, List.of(c)); // a 무관 DM

    assertThat(dmService.listMyDms(a)).hasSize(1);
  }

  /** 타 테넌트(tenant#2) 전용 멤버를 DM 대상으로 지정하면 거부되어야 한다. 테넌트 경계를 넘는 DM 생성을 서비스 계층에서 차단함을 검증한다(설계 §4). */
  @Test
  void createOrGet_rejectsCrossTenantTarget() {
    long callerInTenant1 = seedUser(); // tenant#1 멤버

    // tenant#2 생성 + userB 는 tenant#2 에만 소속
    String slug = "test-dm-t2-" + UUID.randomUUID().toString().substring(0, 8);
    long tenant2Id =
        dsl.insertInto(TENANT)
            .set(TENANT.NAME, "DM Cross Tenant Test")
            .set(TENANT.SLUG, slug)
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();

    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long userBInTenant2Only =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "dm_t2_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "DmT2" + s)
            .set(USER.EMAIL, "dm_t2_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // tenant#2 에만 ACTIVE 멤버십 부여(tenant#1 멤버십 없음).
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userBInTenant2Only)
        .set(MEMBERSHIP.TENANT_ID, tenant2Id)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();

    // TenantContext = tenant#1 인 상태에서 tenant#2 전용 사용자를 DM 대상으로 → 거부.
    assertThatThrownBy(() -> dmService.createOrGet(callerInTenant1, List.of(userBInTenant2Only)))
        .isInstanceOf(InvalidDmRequestException.class)
        .hasMessageContaining("멤버가 아닌 사용자");
  }
}
