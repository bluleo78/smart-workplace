package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.exception.EpicCannotHaveParentException;
import com.workplace.issue.exception.InvalidParentException;
import com.workplace.issue.exception.ParentNotAllowedException;
import com.workplace.issue.exception.SubtaskParentCannotBeEpicException;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 4a — IssueService.setParent 통합 테스트. */
@Transactional
class IssueSetParentTest extends IntegrationTestBase {

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

  private Long subtaskTypeId(Long projectId) {
    return typeRepository.findByProjectAndName(projectId, "SUBTASK").orElseThrow().id();
  }

  private Long epicTypeId(Long projectId) {
    return typeRepository.findByProjectAndName(projectId, "EPIC").orElseThrow().id();
  }

  @Test
  void subtask_set_parent_ok_records_history() {
    Long owner = createUser("a");
    var p = newProject(owner, "SP1");
    Long subId = subtaskTypeId(p.id());
    var p1 =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p1", null, null, null, null, null, null));
    var p2 =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p2", null, null, null, null, null, null));
    var sub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, subId, p1.number()));

    issueService.setParent(owner, p.key(), sub.number(), p2.number());

    assertThat(historyRepository.findByIssue(sub.id()))
        .anyMatch(h -> "PARENT_CHANGED".equals(h.eventType()));
  }

  @Test
  void epic_set_parent_throws_400() {
    Long owner = createUser("b");
    var p = newProject(owner, "SP2");
    Long epicId = epicTypeId(p.id());
    var epic =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("e", null, null, null, null, epicId, null));
    var other =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("o", null, null, null, null, null, null));

    assertThatThrownBy(() -> issueService.setParent(owner, p.key(), epic.number(), other.number()))
        .isInstanceOf(EpicCannotHaveParentException.class);
  }

  @Test
  void general_issue_set_parent_to_epic_ok() {
    Long owner = createUser("b2");
    var p = newProject(owner, "SP2B");
    Long epicId = epicTypeId(p.id());
    var epic =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("e", null, null, null, null, epicId, null));
    var task =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null));

    issueService.setParent(owner, p.key(), task.number(), epic.number());

    var detail = issueService.get(owner, p.key(), task.number());
    assertThat(detail.summary().parent()).isNotNull();
    assertThat(detail.summary().parent().number()).isEqualTo(epic.number());
  }

  @Test
  void general_issue_set_parent_to_non_epic_throws_400() {
    Long owner = createUser("b3");
    var p = newProject(owner, "SP2C");
    var task1 =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t1", null, null, null, null, null, null));
    var task2 =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t2", null, null, null, null, null, null));

    assertThatThrownBy(() -> issueService.setParent(owner, p.key(), task1.number(), task2.number()))
        .isInstanceOf(ParentNotAllowedException.class);
  }

  @Test
  void subtask_set_parent_to_epic_throws_400() {
    Long owner = createUser("b4");
    var p = newProject(owner, "SP2D");
    Long epicId = epicTypeId(p.id());
    Long subId = subtaskTypeId(p.id());
    var task =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null));
    var epic =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("e", null, null, null, null, epicId, null));
    var sub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, subId, task.number()));

    assertThatThrownBy(() -> issueService.setParent(owner, p.key(), sub.number(), epic.number()))
        .isInstanceOf(SubtaskParentCannotBeEpicException.class);
  }

  @Test
  void set_parent_null_releases_parent_with_history() {
    Long owner = createUser("c");
    var p = newProject(owner, "SP3");
    Long subId = subtaskTypeId(p.id());
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null));
    var sub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, subId, parent.number()));

    issueService.setParent(owner, p.key(), sub.number(), null);

    var detail = issueService.get(owner, p.key(), sub.number());
    assertThat(detail.summary().parent()).isNull();
    assertThat(historyRepository.findByIssue(sub.id()))
        .anyMatch(h -> "PARENT_CHANGED".equals(h.eventType()));
  }

  @Test
  void same_parent_no_history() {
    Long owner = createUser("d");
    var p = newProject(owner, "SP4");
    Long subId = subtaskTypeId(p.id());
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null));
    var sub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, subId, parent.number()));

    long before =
        historyRepository.findByIssue(sub.id()).stream()
            .filter(h -> "PARENT_CHANGED".equals(h.eventType()))
            .count();
    issueService.setParent(owner, p.key(), sub.number(), parent.number());

    long after =
        historyRepository.findByIssue(sub.id()).stream()
            .filter(h -> "PARENT_CHANGED".equals(h.eventType()))
            .count();
    assertThat(after).isEqualTo(before);
  }

  @Test
  void non_member_forbidden() {
    Long owner = createUser("e");
    Long stranger = createUser("e-x");
    var p = newProject(owner, "SP5");
    Long subId = subtaskTypeId(p.id());
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null));
    var sub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, subId, parent.number()));

    assertThatThrownBy(() -> issueService.setParent(stranger, p.key(), sub.number(), null))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void self_parent_throws_400() {
    Long owner = createUser("f");
    var p = newProject(owner, "SP6");
    Long subId = subtaskTypeId(p.id());
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null));
    var sub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, subId, parent.number()));

    assertThatThrownBy(() -> issueService.setParent(owner, p.key(), sub.number(), sub.number()))
        .isInstanceOf(InvalidParentException.class);
  }
}
