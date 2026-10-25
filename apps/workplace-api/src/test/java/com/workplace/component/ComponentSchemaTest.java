package com.workplace.component;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-933 V218 — 구성요소 스키마(이름 유일성·길이 제약·이슈 삭제 연쇄·테넌트 격리) 검증.
 *
 * <p>jOOQ 코드젠 없이도 컴파일되도록 표·컬럼을 SQL 문자열로 다룬다(코드젠 전 RED 확인용).
 */
@Transactional
class ComponentSchemaTest extends IntegrationTestBase {

  @Autowired private ProjectService projectService;
  @Autowired private IssueRepository issueRepository;

  /** 같은 프로젝트 안에서 이름은 대소문자만 달라도 중복이다(DB 유일 인덱스 lower(name)). */
  @Test
  void nameUniqueIgnoringCaseAtDb() {
    long projectId = seedProject();
    insertComponent(projectId, "Compute");

    assertThatThrownBy(() -> insertComponent(projectId, "compute"))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  /** 다른 프로젝트에는 같은 이름을 쓸 수 있다 — 유일 범위는 프로젝트다. */
  @Test
  void sameNameAllowedInOtherProject() {
    insertComponent(seedProject(), "Compute");
    insertComponent(seedProject(), "Compute");
  }

  /**
   * 이름은 1~40자만 — 빈 문자열은 CHECK 로 거부된다. (@Transactional 이라 제약 위반 뒤 같은 트랜잭션을 이어 쓸 수 없어 경계마다 테스트를 나눈다.)
   */
  @Test
  void emptyNameRejected() {
    long projectId = seedProject();

    assertThatThrownBy(() -> insertComponent(projectId, ""))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  /** 41자는 거부된다. */
  @Test
  void tooLongNameRejected() {
    long projectId = seedProject();

    assertThatThrownBy(() -> insertComponent(projectId, "x".repeat(41)))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  /** 40자는 허용된다(경계). */
  @Test
  void maxLengthNameAccepted() {
    long projectId = seedProject();

    assertThat(insertComponent(projectId, "x".repeat(40))).isPositive();
  }

  /** 이슈 행을 지우면 issue_component 행이 함께 사라지고, 구성요소 자체는 남는다. */
  @Test
  void issueDeleteCascades() {
    long projectId = seedProject();
    long issueId = seedIssue(projectId);
    long componentId = insertComponent(projectId, "Compute");
    baseDsl.execute(
        "INSERT INTO issue_component (issue_id, component_id) VALUES (?, ?)", issueId, componentId);
    assertThat(countIssueComponents(componentId)).isEqualTo(1);

    baseDsl.execute("DELETE FROM issue WHERE id = ?", issueId);

    assertThat(countIssueComponents(componentId)).isZero();
    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("project_component"))).isPositive();
  }

  /** 구성요소를 지우면 이슈에 붙은 연결도 사라진다. */
  @Test
  void componentDeleteCascades() {
    long projectId = seedProject();
    long issueId = seedIssue(projectId);
    long componentId = insertComponent(projectId, "Compute");
    baseDsl.execute(
        "INSERT INTO issue_component (issue_id, component_id) VALUES (?, ?)", issueId, componentId);

    baseDsl.execute("DELETE FROM project_component WHERE id = ?", componentId);

    assertThat(countIssueComponents(componentId)).isZero();
  }

  /** 다른 테넌트 GUC 에서는 tenant#1 의 구성요소·연결이 0행으로 보인다(RLS). */
  @Test
  void rlsIsolatesTenants() {
    long projectId = seedProject();
    long issueId = seedIssue(projectId);
    long componentId = insertComponent(projectId, "Compute");
    // 비어 있는 표의 0행은 격리를 증명하지 못하므로 tenant#1 에 연결까지 만들어 둔다.
    baseDsl.execute(
        "INSERT INTO issue_component (issue_id, component_id) VALUES (?, ?)", issueId, componentId);
    long tid2 =
        baseDsl
            .fetchOne(
                "INSERT INTO tenant (slug, name, status) VALUES (?, 'RLS-COMP', 'ACTIVE') RETURNING id",
                "rls-comp-" + System.nanoTime())
            .get("id", Long.class);
    useTenant(tid2);

    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("project_component"))).isZero();
    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("issue_component"))).isZero();

    useTenant(1L);
    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("project_component"))).isPositive();
    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("issue_component"))).isPositive();
  }

  private int countIssueComponents(long componentId) {
    return baseDsl.fetchCount(
        baseDsl.selectOne().from("issue_component").where("component_id = ?", componentId));
  }

  private long insertComponent(long projectId, String name) {
    return baseDsl
        .fetchOne(
            "INSERT INTO project_component (project_id, name) VALUES (?, ?) RETURNING id",
            projectId,
            name)
        .get("id", Long.class);
  }

  private long userId;

  /** tenant#1 에 사용자·프로젝트를 새로 만든다. */
  private long seedProject() {
    TenantContext.set(1L);
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 4).toUpperCase();
    userId =
        baseDsl
            .fetchOne(
                "INSERT INTO \"user\" (username, password, name, email) VALUES (?, 'pw', 'cmp', ?)"
                    + " RETURNING id",
                "cmp-" + suffix,
                "cmp-" + suffix + "@example.com")
            .get("id", Long.class);
    return projectService.create(userId, new CreateProjectRequest("CP" + suffix, "Cmp", "x")).id();
  }

  private long seedIssue(long projectId) {
    return IssueSeeds.insert(
            issueRepository, baseDsl, projectId, 1, "구성요소", null, "MID", null, userId)
        .id();
  }
}
