package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 4a — setType 의 SUBTASK ↔ 비SUBTASK 전환에서 parent 자동 해제 검증. */
@Transactional
class IssueSetTypeWithParentTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired IssueHistoryRepository historyRepository;
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

  private ProjectResponse newProject(Long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  @Test
  void subtask_to_task_releases_parent_and_records_two_histories() {
    Long owner = createUser("a");
    var p = newProject(owner, "STP1");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    Long taskId = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow().id();
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null));
    var sub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, subId, parent.number()));

    issueService.setType(owner, p.key(), sub.number(), taskId);

    var detail = issueService.get(owner, p.key(), sub.number());
    assertThat(detail.summary().parent()).isNull();
    var events = historyRepository.findByIssue(sub.id());
    assertThat(events).anyMatch(h -> "PARENT_CHANGED".equals(h.eventType()));
    assertThat(events).anyMatch(h -> "TYPE_CHANGED".equals(h.eventType()));
  }

  @Test
  void task_to_subtask_keeps_parent_null() {
    Long owner = createUser("b");
    var p = newProject(owner, "STP2");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    var task =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null));

    issueService.setType(owner, p.key(), task.number(), subId);

    var events = historyRepository.findByIssue(task.id());
    assertThat(events).anyMatch(h -> "TYPE_CHANGED".equals(h.eventType()));
    assertThat(events).noneMatch(h -> "PARENT_CHANGED".equals(h.eventType()));
  }
}
