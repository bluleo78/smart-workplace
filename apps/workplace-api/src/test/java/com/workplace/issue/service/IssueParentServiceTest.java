package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.exception.EpicCannotHaveParentException;
import com.workplace.issue.exception.InvalidParentException;
import com.workplace.issue.exception.ParentCannotBeSubtaskException;
import com.workplace.issue.exception.ParentNotAllowedException;
import com.workplace.issue.exception.SubtaskParentCannotBeEpicException;
import com.workplace.issue.exception.SubtaskParentRequiredException;
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

/** Phase 4a — IssueService.create 의 SUBTASK 부모 검증 + softDelete cascade 통합 테스트. */
@Transactional
class IssueParentServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired IssueRepository issueRepository;
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

  @Test
  void subtask_create_without_parent_throws_400() {
    Long owner = createUser("a");
    var p = newProject(owner, "PA1");
    Long subId = subtaskTypeId(p.id());

    assertThatThrownBy(
            () ->
                issueService.create(
                    owner,
                    p.key(),
                    new CreateIssueRequest("c", null, null, null, null, subId, null, null)))
        .isInstanceOf(SubtaskParentRequiredException.class);
  }

  @Test
  void non_subtask_create_with_parent_throws_400() {
    Long owner = createUser("b");
    var p = newProject(owner, "PA2");
    // 부모 후보 — TASK
    var parent =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("parent", null, null, null, null, null, null, null));

    assertThatThrownBy(
            () ->
                issueService.create(
                    owner,
                    p.key(),
                    new CreateIssueRequest(
                        "child", null, null, null, null, null, parent.number(), null)))
        .isInstanceOf(ParentNotAllowedException.class);
  }

  @Test
  void subtask_create_with_subtask_parent_throws_400() {
    Long owner = createUser("c");
    var p = newProject(owner, "PA3");
    Long subId = subtaskTypeId(p.id());
    // 부모 TASK 생성 후 그 자식으로 SUBTASK 1 생성 → SUBTASK 1 을 부모로 새 SUBTASK 시도
    var task =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null, null));
    var sub1 =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s1", null, null, null, null, subId, task.number(), null));

    assertThatThrownBy(
            () ->
                issueService.create(
                    owner,
                    p.key(),
                    new CreateIssueRequest(
                        "s2", null, null, null, null, subId, sub1.number(), null)))
        .isInstanceOf(ParentCannotBeSubtaskException.class);
  }

  @Test
  void subtask_create_with_foreign_project_parent_throws_400() {
    Long owner = createUser("d");
    var pa = newProject(owner, "PA4A");
    var pb = newProject(owner, "PA4B");
    // pa 의 TASK 이슈는 number=1 가능. pb 의 SUBTASK 가 pa.number=1 을 부모로 (다른 프로젝트) → 없음으로 InvalidParent
    issueService.create(
        owner, pa.key(), new CreateIssueRequest("t", null, null, null, null, null, null, null));
    Long subIdB = subtaskTypeId(pb.id());

    assertThatThrownBy(
            () ->
                issueService.create(
                    owner,
                    pb.key(),
                    new CreateIssueRequest("s", null, null, null, null, subIdB, 1, null)))
        .isInstanceOf(InvalidParentException.class);
  }

  private Long epicTypeId(Long projectId) {
    return typeRepository.findByProjectAndName(projectId, "EPIC").orElseThrow().id();
  }

  @Test
  void epic_create_with_parent_throws_400() {
    Long owner = createUser("g");
    var p = newProject(owner, "PA7");
    Long epicId = epicTypeId(p.id());
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null, null));

    assertThatThrownBy(
            () ->
                issueService.create(
                    owner,
                    p.key(),
                    new CreateIssueRequest(
                        "e", null, null, null, null, epicId, parent.number(), null)))
        .isInstanceOf(EpicCannotHaveParentException.class);
  }

  @Test
  void subtask_create_with_epic_parent_throws_400() {
    Long owner = createUser("h");
    var p = newProject(owner, "PA8");
    Long epicId = epicTypeId(p.id());
    Long subId = subtaskTypeId(p.id());
    var epic =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("e", null, null, null, null, epicId, null, null));

    assertThatThrownBy(
            () ->
                issueService.create(
                    owner,
                    p.key(),
                    new CreateIssueRequest(
                        "s", null, null, null, null, subId, epic.number(), null)))
        .isInstanceOf(SubtaskParentCannotBeEpicException.class);
  }

  @Test
  void non_subtask_create_with_epic_parent_ok() {
    Long owner = createUser("i");
    var p = newProject(owner, "PA9");
    Long epicId = epicTypeId(p.id());
    var epic =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("e", null, null, null, null, epicId, null, null));
    var story =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, null, epic.number(), null));

    var detail = issueService.get(owner, p.key(), story.number());
    assertThat(detail.summary().parent()).isNotNull();
    assertThat(detail.summary().parent().number()).isEqualTo(epic.number());
    assertThat(detail.summary().parent().type().name()).isEqualTo("EPIC");
  }

  @Test
  void subtask_create_ok_sets_parent_and_response() {
    Long owner = createUser("e");
    var p = newProject(owner, "PA5");
    Long subId = subtaskTypeId(p.id());
    var parent =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("parent", null, null, null, null, null, null, null));
    var child =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("c", null, null, null, null, subId, parent.number(), null));

    var detail = issueService.get(owner, p.key(), child.number());
    assertThat(detail.summary().parent()).isNotNull();
    assertThat(detail.summary().parent().number()).isEqualTo(parent.number());
    assertThat(detail.summary().parent().type().name()).isEqualTo("TASK");
  }

  @Test
  void soft_delete_cascades_to_active_children() {
    Long owner = createUser("f");
    var p = newProject(owner, "PA6");
    Long subId = subtaskTypeId(p.id());
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null, null));
    var c1 =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("c1", null, null, null, null, subId, parent.number(), null));
    var c2 =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("c2", null, null, null, null, subId, parent.number(), null));
    var c3 =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("c3", null, null, null, null, subId, parent.number(), null));
    // c3 만 미리 삭제
    issueService.softDelete(owner, p.key(), c3.number());

    issueService.softDelete(owner, p.key(), parent.number());

    // 활성 자식 2개도 deleted_at 채워짐
    int activeChildren =
        dsl.fetchCount(ISSUE, ISSUE.PARENT_ISSUE_ID.eq(parent.id()).and(ISSUE.DELETED_AT.isNull()));
    assertThat(activeChildren).isZero();
    // c3 의 deleted_at 은 변경되지 않음 (이전 값 유지) — c3.id 의 deleted_at 이 not null 인지만 확인
    assertThat(issueRepository.findById(c3.id())).isEmpty();
    assertThat(issueRepository.findById(c1.id())).isEmpty();
    assertThat(issueRepository.findById(c2.id())).isEmpty();
  }
}
