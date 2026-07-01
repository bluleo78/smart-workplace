package com.workplace.project.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.project.service.OpenFixtures;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * OPEN 프로젝트 목록 노출 통합 테스트.
 *
 * <p>비멤버도 OPEN 프로젝트가 {@link ProjectRepository#findAllForUser} / {@link
 * ProjectRepository#countForUser} 에 포함되는지, TEAM 프로젝트는 비멤버에게 노출되지 않는지를 검증한다.
 */
@Transactional
class OpenProjectListingTest extends IntegrationTestBase {

  @Autowired ProjectRepository repo;
  @Autowired DSLContext dsl;

  @BeforeEach
  void setTenant() {
    // 기본 테넌트(1) GUC — RLS 가 올바른 테넌트 행만 접근하도록 고정
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 비멤버도 OPEN 프로젝트를 목록에서 조회할 수 있어야 한다. */
  @Test
  void non_member_sees_open_project_in_listing() {
    // 비멤버 stranger 생성 + OPEN 프로젝트 시드
    long ownerId = OpenFixtures.member(dsl, 1L);
    long strangerId = OpenFixtures.member(dsl, 1L);
    var fixture = OpenFixtures.openProject(dsl, 1L, ownerId);
    String projectKey = fixture.key();

    // 비멤버(strangerId)가 OPEN 프로젝트를 목록에서 볼 수 있는지 확인
    var rows = repo.findAllForUser(strangerId, false, 0, 50);
    assertThat(rows)
        .as("비멤버도 OPEN 프로젝트를 목록에서 볼 수 있어야 한다")
        .anyMatch(r -> r.type().equals("OPEN") && r.key().equals(projectKey));

    // countForUser 도 동일하게 ≥ 1 이어야 한다
    assertThat(repo.countForUser(strangerId, false))
        .as("비멤버 기준 OPEN 프로젝트 count 는 1 이상이어야 한다")
        .isGreaterThanOrEqualTo(1);
  }

  /** 비멤버에게 TEAM 프로젝트는 노출되지 않아야 한다(과노출 회귀 방지). */
  @Test
  void non_member_does_not_see_team_project() {
    // 비멤버 stranger 생성 + TEAM 프로젝트 시드(멤버 없이 직접 삽입)
    long ownerId = OpenFixtures.member(dsl, 1L);
    long strangerId = OpenFixtures.member(dsl, 1L);

    // TEAM 프로젝트를 OPEN 픽스처 헬퍼와 유사한 방식으로 직접 삽입
    String teamKey = insertTeamProject(ownerId);

    // 비멤버(strangerId) 목록에 TEAM 프로젝트가 포함되지 않아야 한다
    var rows = repo.findAllForUser(strangerId, false, 0, 50);
    assertThat(rows).as("비멤버에게 TEAM 프로젝트는 노출되면 안 된다").noneMatch(r -> r.key().equals(teamKey));
  }

  /** TEAM 프로젝트를 DB 에 직접 삽입하고 key 를 반환한다. */
  private String insertTeamProject(long ownerId) {
    String key =
        ("TM"
                + java.util
                    .UUID
                    .randomUUID()
                    .toString()
                    .replaceAll("-", "")
                    .toUpperCase()
                    .substring(0, 6))
            .substring(0, 8);
    dsl.insertInto(com.workplace.jooq.Tables.PROJECT)
        .set(com.workplace.jooq.Tables.PROJECT.KEY, key)
        .set(com.workplace.jooq.Tables.PROJECT.NAME, "팀프로젝트-" + key)
        .set(com.workplace.jooq.Tables.PROJECT.OWNER_ID, ownerId)
        .set(com.workplace.jooq.Tables.PROJECT.TYPE, "TEAM")
        .set(com.workplace.jooq.Tables.PROJECT.IS_DEFAULT, false)
        .execute();
    return key;
  }
}
