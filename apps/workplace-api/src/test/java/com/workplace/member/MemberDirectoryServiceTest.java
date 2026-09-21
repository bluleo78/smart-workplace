package com.workplace.member;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.member.dto.MemberSummary;
import com.workplace.member.service.MemberDirectoryService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 구성원 디렉터리 서비스 통합 테스트 (#833).
 *
 * <p>user/membership 은 RLS 비대상 전역 테이블이라 테넌트 경계가 코드로만 지켜진다. 따라서 "우리 테넌트 사람이 보인다"(양성)뿐 아니라 "다른 테넌트
 * 사람은 안 보인다"(음성)를 반드시 함께 단언한다 — 양성 케이스만으로는 경계가 사라져도 테스트가 통과한다.
 */
@Transactional
class MemberDirectoryServiceTest extends IntegrationTestBase {

  @Autowired MemberDirectoryService service;
  @Autowired DSLContext dsl;

  private long insider;
  private long outsider;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    insider = seedUser("dir_insider", "HUMAN", true);
    linkMembership(insider, 1L, "ACTIVE");
    // 다른 테넌트(2) 소속 — 테넌트#1 디렉터리에 절대 나오면 안 된다.
    outsider = seedUser("dir_outsider", "HUMAN", true);
    linkMembership(outsider, seedTenant(), "ACTIVE");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  private long seedUser(String prefix, String kind, boolean active) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix)
        .set(USER.EMAIL, prefix + "_" + suffix + "@example.com")
        .set(USER.KIND, kind)
        .set(USER.IS_ACTIVE, active)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private void linkMembership(long userId, long tenantId, String status) {
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, status)
        .execute();
  }

  /** 테스트용 보조 테넌트. 이름 충돌을 피하려 UUID 슬러그를 쓴다. */
  private long seedTenant() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    return dsl.insertInto(com.workplace.jooq.Tables.TENANT)
        .set(com.workplace.jooq.Tables.TENANT.NAME, "dir_tenant_" + suffix)
        .set(com.workplace.jooq.Tables.TENANT.SLUG, "dir-tenant-" + suffix)
        .set(com.workplace.jooq.Tables.TENANT.STATUS, "ACTIVE")
        .returning(com.workplace.jooq.Tables.TENANT.ID)
        .fetchOne()
        .getId();
  }

  private List<Long> listedIds(String search) {
    return service.list(search, "ALL", false, 0, 200).content().stream()
        .map(MemberSummary::userId)
        .toList();
  }

  @Test
  void list_includesTenantMember_excludesOtherTenant() {
    List<Long> ids = listedIds(null);
    assertThat(ids).contains(insider);
    assertThat(ids).doesNotContain(outsider);
  }

  @Test
  void list_search_doesNotLeakOtherTenantMember() {
    // 검색어로도 타 테넌트 사용자를 열거할 수 없어야 한다.
    assertThat(listedIds("dir_outsider")).isEmpty();
  }

  @Test
  void list_excludesInactiveAccountByDefault_butIncludesOnRequest() {
    long retired = seedUser("dir_retired", "HUMAN", false);
    linkMembership(retired, 1L, "ACTIVE");

    assertThat(listedIds(null)).doesNotContain(retired);
    List<Long> withInactive =
        service.list(null, "ALL", true, 0, 200).content().stream()
            .map(MemberSummary::userId)
            .toList();
    assertThat(withInactive).contains(retired);
  }

  @Test
  void list_excludesSuspendedMembership() {
    long suspended = seedUser("dir_suspended", "HUMAN", true);
    linkMembership(suspended, 1L, "SUSPENDED");
    assertThat(listedIds(null)).doesNotContain(suspended);
  }

  @Test
  void list_kindFilter_separatesHumanAndAgent() {
    long agent = seedUser("dir_agent", "AGENT", true);
    linkMembership(agent, 1L, "ACTIVE");

    List<Long> humans =
        service.list(null, "HUMAN", false, 0, 200).content().stream()
            .map(MemberSummary::userId)
            .toList();
    assertThat(humans).contains(insider).doesNotContain(agent);

    List<Long> agents =
        service.list(null, "AGENT", false, 0, 200).content().stream()
            .map(MemberSummary::userId)
            .toList();
    assertThat(agents).contains(agent).doesNotContain(insider);
  }

  @Test
  void get_returnsMember_butHidesOtherTenantUser() {
    assertThat(service.get(insider)).isPresent();
    // 존재 자체를 숨긴다 — 빈 값이어야 하며 예외로 "있긴 있다"를 알려주면 안 된다.
    assertThat(service.get(outsider)).isEmpty();
  }
}
