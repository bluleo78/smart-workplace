package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.WikiSpaceResponse;
import com.workplace.wiki.exception.WikiForbiddenException;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class WikiSpaceServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "wk_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Wk" + s)
            .set(USER.EMAIL, "wk_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // 테넌트#1 ACTIVE 멤버십 — MembershipGuard(#713) 가 addMember 대상의 테넌트 소속을 검증하므로 필요.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  /** 격리된 테스트용 테넌트 시드. */
  private long seedTenant() {
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, "t713-wiki-" + System.nanoTime())
        .set(TENANT.NAME, "Other Tenant")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** tenant#1 이 아닌 다른 테넌트에만 소속된 사용자 시드 — 테넌트 경계 검증용. */
  private long seedUserInTenant(long tenantId) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "wk_ot_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "WkOt" + s)
            .set(USER.EMAIL, "wk_ot_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  @Test
  void ensurePersonalSpace_isIdempotent() {
    long u = seedUser();
    WikiSpaceResponse a = spaceService.ensurePersonalSpace(u);
    WikiSpaceResponse b = spaceService.ensurePersonalSpace(u);
    assertThat(a.id()).isEqualTo(b.id());
    assertThat(a.type()).isEqualTo("PERSONAL");
    assertThat(a.role()).isEqualTo("OWNER");
  }

  @Test
  void listMySpaces_personalFirst() {
    long u = seedUser();
    spaceService.createTeamSpace(u, "팀 위키");
    List<WikiSpaceResponse> spaces = spaceService.listMySpaces(u);
    assertThat(spaces).hasSize(2);
    assertThat(spaces.get(0).type()).isEqualTo("PERSONAL");
  }

  @Test
  void getSpace_nonMember_throwsNotFound() {
    long owner = seedUser();
    long stranger = seedUser();
    WikiSpaceResponse team = spaceService.createTeamSpace(owner, "팀");
    assertThatThrownBy(() -> spaceService.getSpace(stranger, team.id()))
        .isInstanceOf(WikiSpaceNotFoundException.class);
  }

  @Test
  void addMember_tenantMember_succeeds() {
    long owner = seedUser();
    long member = seedUser();
    WikiSpaceResponse team = spaceService.createTeamSpace(owner, "팀");

    spaceService.addMember(owner, team.id(), member, "VIEWER");

    assertThat(spaceService.listMembers(owner, team.id())).anyMatch(m -> m.userId() == member);
  }

  /** #713 — OWNER 가 현재 테넌트에 소속되지 않은(다른 테넌트) 사용자를 위키 공간 멤버로 등록할 수 없어야 한다. */
  @Test
  void addMember_otherTenantUser_throwsForbidden() {
    long owner = seedUser();
    long otherTenantId = seedTenant();
    long otherTenantUser = seedUserInTenant(otherTenantId);
    WikiSpaceResponse team = spaceService.createTeamSpace(owner, "팀");

    assertThatThrownBy(() -> spaceService.addMember(owner, team.id(), otherTenantUser, "VIEWER"))
        .isInstanceOf(WikiForbiddenException.class);
  }
}
