package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.exception.ParentNotAllowedException;
import com.workplace.issue.exception.SubtaskParentCannotBeEpicException;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRepository;
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
  @Autowired IssueRepository issueRepository;

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

  @Test
  void task_with_epic_parent_to_epic_releases_parent() {
    Long owner = createUser("c");
    var p = newProject(owner, "STP3");
    Long epicId = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();
    var epic =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("e", null, null, null, null, epicId, null));
    var task =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("t", null, null, null, null, null, epic.number()));

    // task 를 EPIC 으로 전환 — 기존 부모(epic)는 해제되어야 함(EPIC 은 부모를 가질 수 없음).
    issueService.setType(owner, p.key(), task.number(), epicId);

    var detail = issueService.get(owner, p.key(), task.number());
    assertThat(detail.summary().parent()).isNull();
    var events = historyRepository.findByIssue(task.id());
    assertThat(events).anyMatch(h -> "PARENT_CHANGED".equals(h.eventType()));
  }

  /**
   * 최종 리뷰 발견사항 1 — Case A: SUBTASK 자식을 가진 일반 이슈를 EPIC 으로 전환하면 그 자식이 EPIC 바로 아래(2단계 초과)에 남는다. 자식 검증이
   * 없으면 통과해버리므로 거부되어야 한다.
   */
  @Test
  void general_issue_with_subtask_children_cannot_become_epic() {
    Long owner = createUser("d");
    var p = newProject(owner, "STP4");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    Long epicId = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();
    var story =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("s", null, null, null, null, null, null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("sub", null, null, null, null, subId, story.number()));

    assertThatThrownBy(() -> issueService.setType(owner, p.key(), story.number(), epicId))
        .isInstanceOf(SubtaskParentCannotBeEpicException.class);

    // 거부 후 원래 유형 그대로 유지되어야 한다(변경 없음).
    var unchanged = issueRepository.findById(story.id()).orElseThrow();
    Long taskId = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow().id();
    assertThat(unchanged.typeId()).isEqualTo(taskId);
  }

  /**
   * Case B: 부모가 EPIC 인 일반 이슈를 SUBTASK 로 전환하면 releasesParent 조건(oldType!=SUBTASK && newType!=EPIC)이
   * 발동하지 않아 EPIC 부모가 그대로 유지된 SUBTASK 가 만들어진다 — 거부되어야 한다.
   */
  @Test
  void general_issue_with_epic_parent_cannot_become_subtask() {
    Long owner = createUser("e");
    var p = newProject(owner, "STP5");
    Long epicId = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    var epic =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("e", null, null, null, null, epicId, null));
    var story =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, null, epic.number()));

    assertThatThrownBy(() -> issueService.setType(owner, p.key(), story.number(), subId))
        .isInstanceOf(SubtaskParentCannotBeEpicException.class);

    var unchanged = issueRepository.findById(story.id()).orElseThrow();
    Long taskId = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow().id();
    assertThat(unchanged.typeId()).isEqualTo(taskId);
    assertThat(unchanged.parentIssueId()).isEqualTo(epic.id());
  }

  /**
   * Case C(핵심 해피패스): 일반 이슈 자식(예: Story)을 가진 EPIC 을 일반 유형(TASK)으로 전환하면, EPIC 자신은 부모가 없어
   * releasesParent 가 발동하지 않고 그대로 TASK 가 되지만, 자식 Story 는 여전히 (이제는 TASK 인) 그 이슈를 부모로 가리켜 "일반 이슈의 부모가
   * 일반 이슈"인 불변식 위반이 발생한다 — 거부되어야 한다.
   */
  @Test
  void epic_with_general_children_cannot_become_general_type() {
    Long owner = createUser("f");
    var p = newProject(owner, "STP6");
    Long epicId = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();
    Long taskId = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow().id();
    var epic =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("e", null, null, null, null, epicId, null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("story", null, null, null, null, null, epic.number()));

    assertThatThrownBy(() -> issueService.setType(owner, p.key(), epic.number(), taskId))
        .isInstanceOf(ParentNotAllowedException.class);

    var unchanged = issueRepository.findById(epic.id()).orElseThrow();
    assertThat(unchanged.typeId()).isEqualTo(epicId);
  }
}
