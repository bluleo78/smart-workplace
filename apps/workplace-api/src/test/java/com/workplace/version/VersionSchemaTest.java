package com.workplace.version;

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
 * WP-888 V219 — 버전 스키마(이름 유일성·날짜 순서·수정/영향 종류·연쇄 삭제·테넌트 격리) 검증.
 *
 * <p>표·컬럼을 SQL 문자열로 다뤄 코드젠 전에도 컴파일된다(RED 확인용).
 */
@Transactional
class VersionSchemaTest extends IntegrationTestBase {

  @Autowired private ProjectService projectService;
  @Autowired private IssueRepository issueRepository;
  @Autowired private com.workplace.version.repository.VersionRepository versionRepository;

  private long userId;

  /** 같은 프로젝트 안에서 이름은 대소문자만 달라도 중복이다(유일 인덱스 lower(name)). */
  @Test
  void nameUniqueIgnoringCaseAtDb() {
    long projectId = seedProject();
    insertVersion(projectId, "v1.0");

    assertThatThrownBy(() -> insertVersion(projectId, "V1.0"))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  /** 시작일이 출시일보다 늦으면 CHECK 로 거부된다. */
  @Test
  void datesOrderChecked() {
    long projectId = seedProject();

    assertThatThrownBy(
            () ->
                baseDsl.execute(
                    "INSERT INTO project_version (project_id, name, start_date, release_date)"
                        + " VALUES (?, 'v2', DATE '2026-11-05', DATE '2026-11-01')",
                    projectId))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  /** 저장소 insert — 이름 중복은 DuplicateKeyException 으로 옮긴다. */
  @Test
  void repositoryTranslatesNameUniqueViolation() {
    long projectId = seedProject();
    insertVersion(projectId, "v1.0");

    assertThatThrownBy(() -> versionRepository.insert(projectId, "V1.0", null, null, null, userId))
        .isInstanceOf(org.springframework.dao.DuplicateKeyException.class);
  }

  /** 저장소 insert — CHECK 위반은 이름 중복으로 둔갑하지 않고 그대로 던진다(실패가 트랜잭션을 중단시켜 위 테스트와 분리). */
  @Test
  void repositoryDoesNotMislabelCheckViolationAsNameTaken() {
    long projectId = seedProject();

    assertThatThrownBy(
            () ->
                versionRepository.insert(
                    projectId,
                    "v2",
                    null,
                    java.time.LocalDate.of(2026, 11, 5),
                    java.time.LocalDate.of(2026, 11, 1),
                    userId))
        .isNotInstanceOf(org.springframework.dao.DuplicateKeyException.class)
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  /** 같은 이슈·버전에 수정(FIX)과 영향(AFFECTS)을 함께 둘 수 있다. */
  @Test
  void sameVersionBothKindsAllowed() {
    long projectId = seedProject();
    long issueId = seedIssue(projectId);
    long versionId = insertVersion(projectId, "v1.0");

    link(issueId, versionId, "FIX");
    link(issueId, versionId, "AFFECTS");

    assertThat(
            baseDsl.fetchCount(
                baseDsl.selectOne().from("issue_version").where("issue_id = ?", issueId)))
        .isEqualTo(2);
  }

  /** 같은 종류를 두 번 붙이면 PK 위반이다. */
  @Test
  void sameKindTwiceRejected() {
    long projectId = seedProject();
    long issueId = seedIssue(projectId);
    long versionId = insertVersion(projectId, "v1.0");
    link(issueId, versionId, "FIX");

    assertThatThrownBy(() -> link(issueId, versionId, "FIX"))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  /** 허용되지 않은 종류는 CHECK 로 거부된다. */
  @Test
  void unknownKindRejected() {
    long projectId = seedProject();
    long issueId = seedIssue(projectId);
    long versionId = insertVersion(projectId, "v1.0");

    assertThatThrownBy(() -> link(issueId, versionId, "OTHER"))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  /** 이슈를 지우면 연결이 사라지고 버전은 남는다. */
  @Test
  void issueDeleteCascades() {
    long projectId = seedProject();
    long issueId = seedIssue(projectId);
    long versionId = insertVersion(projectId, "v1.0");
    link(issueId, versionId, "FIX");

    baseDsl.execute("DELETE FROM issue WHERE id = ?", issueId);

    assertThat(countLinks(versionId)).isZero();
    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("project_version"))).isPositive();
  }

  /** 버전을 지우면 이슈에 붙은 연결도 사라진다. */
  @Test
  void versionDeleteCascades() {
    long projectId = seedProject();
    long issueId = seedIssue(projectId);
    long versionId = insertVersion(projectId, "v1.0");
    link(issueId, versionId, "AFFECTS");

    baseDsl.execute("DELETE FROM project_version WHERE id = ?", versionId);

    assertThat(countLinks(versionId)).isZero();
  }

  /** 다른 테넌트 GUC 에서는 tenant#1 의 버전·연결이 0행으로 보인다(RLS). */
  @Test
  void rlsIsolatesTenants() {
    long projectId = seedProject();
    long issueId = seedIssue(projectId);
    long versionId = insertVersion(projectId, "v1.0");
    // 비어 있는 표의 0행은 격리를 증명하지 못하므로 tenant#1 에 연결까지 만들어 둔다.
    link(issueId, versionId, "FIX");
    long tid2 =
        baseDsl
            .fetchOne(
                "INSERT INTO tenant (slug, name, status) VALUES (?, 'RLS-VER', 'ACTIVE') RETURNING id",
                "rls-ver-" + System.nanoTime())
            .get("id", Long.class);
    useTenant(tid2);

    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("project_version"))).isZero();
    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("issue_version"))).isZero();

    useTenant(1L);
    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("project_version"))).isPositive();
    assertThat(baseDsl.fetchCount(baseDsl.selectOne().from("issue_version"))).isPositive();
  }

  private int countLinks(long versionId) {
    return baseDsl.fetchCount(
        baseDsl.selectOne().from("issue_version").where("version_id = ?", versionId));
  }

  private void link(long issueId, long versionId, String kind) {
    baseDsl.execute(
        "INSERT INTO issue_version (issue_id, version_id, kind) VALUES (?, ?, ?)",
        issueId,
        versionId,
        kind);
  }

  private long insertVersion(long projectId, String name) {
    return baseDsl
        .fetchOne(
            "INSERT INTO project_version (project_id, name) VALUES (?, ?) RETURNING id",
            projectId,
            name)
        .get("id", Long.class);
  }

  /** tenant#1 에 사용자·프로젝트를 새로 만든다. */
  private long seedProject() {
    TenantContext.set(1L);
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 4).toUpperCase();
    userId =
        baseDsl
            .fetchOne(
                "INSERT INTO \"user\" (username, password, name, email) VALUES (?, 'pw', 'ver', ?)"
                    + " RETURNING id",
                "ver-" + suffix,
                "ver-" + suffix + "@example.com")
            .get("id", Long.class);
    return projectService.create(userId, new CreateProjectRequest("VR" + suffix, "Ver", "x")).id();
  }

  private long seedIssue(long projectId) {
    return IssueSeeds.insert(
            issueRepository, baseDsl, projectId, 1, "버전", null, "MID", null, userId)
        .id();
  }
}
