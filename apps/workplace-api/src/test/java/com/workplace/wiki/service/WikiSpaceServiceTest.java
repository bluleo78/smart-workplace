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
import com.workplace.wiki.exception.WikiSpaceNameDuplicatedException;
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

  /** #696 — 동일 테넌트 내 동일 이름(대소문자 무시) TEAM 공간 생성은 하드 차단된다(컨테이너류 이름은 식별자 — #688/#803 과 동일 정책). */
  @Test
  void createTeamSpace_duplicateName_throws() {
    long u = seedUser();
    spaceService.createTeamSpace(u, "중복스페이스");

    assertThatThrownBy(() -> spaceService.createTeamSpace(u, "중복스페이스"))
        .isInstanceOf(WikiSpaceNameDuplicatedException.class);
    // 대소문자만 다른 이름도 동일 취급.
    assertThatThrownBy(() -> spaceService.createTeamSpace(u, "중복스페이스".toUpperCase()))
        .isInstanceOf(WikiSpaceNameDuplicatedException.class);
  }

  // 테넌트 간 이름 비간섭은 RLS 격리(GUC 스코프)로 구조적으로 보장되며 TenantContextGucTest 등에서 별도
  // 검증한다 — @Transactional 단일 트랜잭션 테스트에서는 GUC 가 트랜잭션 시작 시 1회만 주입되므로(TenantContext
  // 를 테스트 본문 중간에 바꿔도 세션 GUC 는 갱신되지 않음, TenantAwareTransactionManager) 이 테스트 클래스
  // 안에서 테넌트를 전환하는 케이스는 만들지 않는다.
}
