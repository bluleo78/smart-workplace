package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.IssueRow;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이슈 행 조회가 상태 이름·색을 project_status LEFT JOIN 으로 읽게 된 뒤(WP-870)에도 잠그는 조회가 issue 행만 잠그는지 본다.
 *
 * <p>잠금이 project_status 행까지 번지면 상태 삭제(project_status 잠금 → issue UPDATE)와 반대 순서가 되어 교착될 수 있다. 다른
 * 커넥션에서 실제로 잠금을 시도해야 확인되므로, 시드를 커밋하는 비-@Transactional 테스트로 두고 자기 행만 지운다.
 */
class IssueRowLockScopeTest extends IntegrationTestBase {

  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;

  private final List<Long> users = new ArrayList<>();
  private ProjectResponse project;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    long owner = user();
    String key =
        "LKS" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    project = projectService.create(owner, new CreateProjectRequest(key, "P", "x", "TEAM"));
    issueRepository.insert(project.id(), 1, "t1", null, "MID", null, owner);
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(project.id())).execute();
          baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(project.id())).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
        });
    TenantContext.clear();
  }

  private long user() {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "lk-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "lk")
            .set(USER.EMAIL, "lk-" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = baseDsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    baseDsl
        .insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, id)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    TestFixtures.addMember(baseDsl, id, 1L);
    users.add(id);
    return id;
  }

  /** 지금 트랜잭션과 다른 커넥션(새 트랜잭션)에서 sql 을 NOWAIT 잠금으로 실행해 잡은 행 수를 돌려준다 — 잠겨 있으면 예외. */
  private int lockElsewhere(String sql, Object... binds) {
    var other = new TransactionTemplate(txManager);
    other.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    return other.execute(s -> baseDsl.fetch(sql, binds).size());
  }

  @Test
  void 잠그는_조회도_statusName을_싣고_issue행만_잠근다() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            tx -> {
              IssueRow row =
                  issueRepository.findByProjectAndNumberForUpdate(project.id(), 1).orElseThrow();
              assertThat(row.statusName()).isEqualTo("할 일");
              assertThat(row.statusColor()).isEqualTo("GRAY");

              // 이슈의 상태 행은 잠기지 않았다 — 다른 커넥션이 기다리지 않고 잠근다(4개 기본 상태 모두)
              assertThat(
                      lockElsewhere(
                          "SELECT id FROM project_status WHERE project_id = ? FOR UPDATE NOWAIT",
                          project.id()))
                  .isEqualTo(4);
              // 대조 — issue 행은 잠겨 있다(위 단언이 「안 보여서 통과」가 아님을 보인다)
              assertThatThrownBy(
                      () ->
                          lockElsewhere(
                              "SELECT id FROM issue WHERE id = ? FOR UPDATE NOWAIT", row.id()))
                  .isInstanceOf(DataAccessException.class);
            });
  }
}
