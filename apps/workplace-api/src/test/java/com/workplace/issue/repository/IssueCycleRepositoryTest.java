package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.service.CycleService;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.service.IssueCycleService;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 진행 집계 — 이슈가 2개 사이클에 걸치면 둘 다 카운트, 빈 사이클은 0. */
@Transactional
class IssueCycleRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueCycleRepository issueCycleRepository;
  @Autowired IssueCycleService issueCycleService;
  @Autowired CycleService cycleService;
  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;

  private Long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  private void setStatus(String projectKey, int number, String status, Long projectId) {
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, status)
        .where(ISSUE.PROJECT_ID.eq(projectId).and(ISSUE.NUMBER.eq(number)))
        .execute();
  }

  @Test
  void issue_in_two_cycles_counts_in_both_and_empty_cycle_is_zero() {
    Long owner = createUser("o");
    ProjectResponse p =
        projectService.create(owner, new CreateProjectRequest(uniqueKey("PR"), "P", "x"));
    var c1 =
        cycleService.create(owner, p.key(), new CreateCycleRequest("S1", null, null, null, null));
    var c2 =
        cycleService.create(owner, p.key(), new CreateCycleRequest("S2", null, null, null, null));
    var c3 =
        cycleService.create(
            owner, p.key(), new CreateCycleRequest("S3-empty", null, null, null, null));

    // CreateIssueRequest 시그니처: (title, body, priority, dueDate, assigneeIds, typeId, parentNumber)
    var i1 =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("T1", null, null, null, null, null, null, null));
    setStatus(p.key(), i1.number(), "DONE", p.id());
    // i1 을 c1, c2 양쪽에 연결 → 더블카운트
    issueCycleService.replace(owner, p.key(), i1.number(), List.of(c1.id(), c2.id()));

    var progress = issueCycleRepository.progressByProject(p.id());

    var byId =
        progress.stream().collect(java.util.stream.Collectors.toMap(x -> x.cycleId(), x -> x));
    assertThat(byId.get(c1.id()).total()).isEqualTo(1);
    assertThat(byId.get(c1.id()).done()).isEqualTo(1);
    assertThat(byId.get(c2.id()).total()).isEqualTo(1);
    assertThat(byId.get(c2.id()).done()).isEqualTo(1);
    assertThat(byId.get(c3.id()).total()).isZero();
    assertThat(byId.get(c3.id()).byStatus()).isEmpty();
  }
}
