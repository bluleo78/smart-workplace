package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.PROJECT_STATUS;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 테스트 시드의 범주 기본 상태({@link TestFixtures#defaultStatusId})와 운영의 {@link
 * ProjectStatusRepository#findDefault} 가 같은 행을 고르는지 고정한다(WP-937).
 *
 * <p>시드 SQL 식은 운영 규칙(position 순, 동률이면 id 순)을 따로 옮겨 적은 것이라, 한쪽만 바뀌면 시드 이슈가 운영과 다른 기본 상태로 들어가도 아무
 * 테스트도 알아채지 못한다. 한 범주에 상태가 둘 이상일 때 — position 동률과 position 이 다를 때 — 두 쪽 결과를 맞대 본다.
 */
@Transactional
class ProjectStatusDefaultChoiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired ProjectStatusRepository statusRepository;

  private ProjectResponse project;

  /** 시드된 「진행 중」(IN_PROGRESS, position 1) id. */
  private long seeded;

  @BeforeEach
  void seed() {
    long owner = TestFixtures.createHuman(dsl);
    TestFixtures.grantRole(dsl, owner, "USER");
    TestFixtures.addMember(dsl, owner, 1L);
    String key =
        "PSD" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    project = projectService.create(owner, new CreateProjectRequest(key, "P", "x", "TEAM"));
    seeded = fixtureDefault("IN_PROGRESS");
  }

  @Test
  void position이_같으면_둘_다_id가_앞선_상태를_고른다() {
    long later = insertStatus("검토 A", 1);

    assertThat(later).isGreaterThan(seeded);
    assertThat(fixtureDefault("IN_PROGRESS")).isEqualTo(seeded);
    assertThat(repositoryDefault("IN_PROGRESS")).isEqualTo(seeded);
  }

  @Test
  void position이_다르면_둘_다_id와_무관하게_position이_앞선_상태를_고른다() {
    long first = insertStatus("검토 B", 0);

    assertThat(first).isGreaterThan(seeded);
    assertThat(fixtureDefault("IN_PROGRESS")).isEqualTo(first);
    assertThat(repositoryDefault("IN_PROGRESS")).isEqualTo(first);
  }

  private long insertStatus(String name, int position) {
    return dsl.insertInto(PROJECT_STATUS)
        .set(PROJECT_STATUS.PROJECT_ID, project.id())
        .set(PROJECT_STATUS.NAME, name)
        .set(PROJECT_STATUS.CATEGORY, "IN_PROGRESS")
        .set(PROJECT_STATUS.POSITION, position)
        .returning(PROJECT_STATUS.ID)
        .fetchOne()
        .getId();
  }

  private long fixtureDefault(String category) {
    return dsl.fetchValue(TestFixtures.defaultStatusId(project.id(), category));
  }

  private long repositoryDefault(String category) {
    return statusRepository.findDefault(project.id(), category).orElseThrow().id();
  }
}
