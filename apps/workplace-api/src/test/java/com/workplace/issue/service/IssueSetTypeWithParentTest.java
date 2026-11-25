package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE_RELATION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.domain.IssueRelationBuiltIns;
import com.workplace.issue.dto.AddIssueRelationRequest;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.exception.InvalidParentException;
import com.workplace.issue.exception.IssueRelationException;
import com.workplace.issue.exception.ParentCannotBeSubtaskException;
import com.workplace.issue.exception.ParentNotAllowedException;
import com.workplace.issue.exception.SubtaskParentCannotBeEpicException;
import com.workplace.issue.exception.SubtaskParentRequiredException;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRelationTypeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.repository.ProjectMemberRepository;
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
  @Autowired IssueRelationService relationService;
  @Autowired IssueRelationTypeRepository relationTypeRepository;
  @Autowired ProjectMemberRepository memberRepository;

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

  /** RELATES 관계 유형 id — 옛 상위 관련 관계 검증이 쓴다(WP-2097). */
  private long relatesTypeId() {
    return relationTypeRepository.findByCode(IssueRelationBuiltIns.RELATES).orElseThrow().id();
  }

  /** 두 이슈 사이 RELATES 관계 행 수 — 방향 없는 유형이라 (작은 id, 큰 id) 로 정규화돼 저장된다(WP-2097). */
  private int relatesBetween(Long a, Long b) {
    long lo = Math.min(a, b);
    long hi = Math.max(a, b);
    return dsl.selectCount()
        .from(ISSUE_RELATION)
        .where(ISSUE_RELATION.TYPE_ID.eq(relatesTypeId()))
        .and(ISSUE_RELATION.SOURCE_ISSUE_ID.eq(lo))
        .and(ISSUE_RELATION.TARGET_ISSUE_ID.eq(hi))
        .fetchOne(0, Integer.class);
  }

  @Test
  void subtask_to_task_releases_parent_and_records_two_histories() {
    Long owner = createUser("a");
    var p = newProject(owner, "STP1");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    Long taskId = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow().id();
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null, null));
    var sub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, subId, parent.number(), null));

    issueService.setType(owner, p.key(), sub.number(), taskId);

    var detail = issueService.get(owner, p.key(), sub.number());
    assertThat(detail.summary().parent()).isNull();
    var events = historyRepository.findByIssue(sub.id());
    assertThat(events).anyMatch(h -> "PARENT_CHANGED".equals(h.eventType()));
    assertThat(events).anyMatch(h -> "TYPE_CHANGED".equals(h.eventType()));
  }

  /** WP-745: 부모 없는 이슈를 부모 없이 SUBTASK 로 바꾸면 거절한다 — 부모 없는 하위 태스크가 생겼다(생성은 이미 막혔다). */
  @Test
  void task_to_subtask_without_parent_is_rejected() {
    Long owner = createUser("b");
    var p = newProject(owner, "STP2");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    Long taskId = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow().id();
    var task =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null, null));

    assertThatThrownBy(() -> issueService.setType(owner, p.key(), task.number(), subId))
        .isInstanceOf(SubtaskParentRequiredException.class);
    assertThat(issueRepository.findById(task.id()).orElseThrow().typeId()).isEqualTo(taskId);
  }

  /** WP-745: 부모를 함께 주면 유형과 부모를 한 번에 바꾼다 — 이력도 둘 다 남는다. */
  @Test
  void task_to_subtask_with_parent_sets_type_and_parent_together() {
    Long owner = createUser("b2");
    var p = newProject(owner, "STP7");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null, null));
    var task =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null, null));

    issueService.setType(owner, p.key(), task.number(), subId, parent.number());

    var detail = issueService.get(owner, p.key(), task.number());
    assertThat(detail.summary().type().name()).isEqualTo("SUBTASK");
    assertThat(detail.summary().parent().number()).isEqualTo(parent.number());
    var events = historyRepository.findByIssue(task.id());
    assertThat(events).anyMatch(h -> "PARENT_CHANGED".equals(h.eventType()));
    assertThat(events).anyMatch(h -> "TYPE_CHANGED".equals(h.eventType()));
  }

  /** WP-745: 에픽 아래 일반 이슈도 새 부모(일반 이슈)를 함께 주면 SUBTASK 로 바꿀 수 있다 — 에픽 부모는 새 부모로 바뀐다. */
  @Test
  void task_under_epic_to_subtask_with_new_parent() {
    Long owner = createUser("b3");
    var p = newProject(owner, "STP8");
    Long epicId = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    var epic =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("e", null, null, null, null, epicId, null, null));
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null, null));
    var task =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("t", null, null, null, null, null, epic.number(), null));

    issueService.setType(owner, p.key(), task.number(), subId, parent.number());

    var row = issueRepository.findById(task.id()).orElseThrow();
    assertThat(row.typeId()).isEqualTo(subId);
    assertThat(row.parentIssueId()).isEqualTo(parent.id());
  }

  /** WP-745: 함께 준 부모가 하위 태스크 규칙에 맞지 않으면(다른 하위 태스크·에픽·자기 자신) 아무것도 바꾸지 않고 거절한다. */
  @Test
  void subtask_conversion_with_invalid_parent_is_rejected() {
    Long owner = createUser("b4");
    var p = newProject(owner, "STP9");
    Long epicId = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    Long taskId = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow().id();
    var epic =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("e", null, null, null, null, epicId, null, null));
    var host =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("h", null, null, null, null, null, null, null));
    var otherSub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("os", null, null, null, null, subId, host.number(), null));
    var task =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null, null));

    assertThatThrownBy(
            () -> issueService.setType(owner, p.key(), task.number(), subId, otherSub.number()))
        .isInstanceOf(ParentCannotBeSubtaskException.class);
    assertThatThrownBy(
            () -> issueService.setType(owner, p.key(), task.number(), subId, epic.number()))
        .isInstanceOf(SubtaskParentCannotBeEpicException.class);
    assertThatThrownBy(
            () -> issueService.setType(owner, p.key(), task.number(), subId, task.number()))
        .isInstanceOf(InvalidParentException.class);
    var unchanged = issueRepository.findById(task.id()).orElseThrow();
    assertThat(unchanged.typeId()).isEqualTo(taskId);
    assertThat(unchanged.parentIssueId()).isNull();
  }

  /** WP-745: 하위 태스크의 부모를 떼면(부모 없음) 거절한다 — 다른 부모로 바꾸는 것은 된다. */
  @Test
  void subtask_parent_cannot_be_removed() {
    Long owner = createUser("b5");
    var p = newProject(owner, "STPA");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null, null));
    var parent2 =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p2", null, null, null, null, null, null, null));
    var sub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, subId, parent.number(), null));

    assertThatThrownBy(() -> issueService.setParent(owner, p.key(), sub.number(), null))
        .isInstanceOf(SubtaskParentRequiredException.class);
    issueService.setParent(owner, p.key(), sub.number(), parent2.number());
    assertThat(issueRepository.findById(sub.id()).orElseThrow().parentIssueId())
        .isEqualTo(parent2.id());
  }

  @Test
  void task_with_epic_parent_to_epic_releases_parent() {
    Long owner = createUser("c");
    var p = newProject(owner, "STP3");
    Long epicId = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();
    var epic =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("e", null, null, null, null, epicId, null, null));
    var task =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("t", null, null, null, null, null, epic.number(), null));

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
            owner, p.key(), new CreateIssueRequest("s", null, null, null, null, null, null, null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("sub", null, null, null, null, subId, story.number(), null));

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
            owner,
            p.key(),
            new CreateIssueRequest("e", null, null, null, null, epicId, null, null));
    var story =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, null, epic.number(), null));

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
            owner,
            p.key(),
            new CreateIssueRequest("e", null, null, null, null, epicId, null, null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest("story", null, null, null, null, null, epic.number(), null));

    assertThatThrownBy(() -> issueService.setType(owner, p.key(), epic.number(), taskId))
        .isInstanceOf(ParentNotAllowedException.class);

    var unchanged = issueRepository.findById(epic.id()).orElseThrow();
    assertThat(unchanged.typeId()).isEqualTo(epicId);
  }

  /**
   * WP-2097 — 옛 상위와 이미 RELATES 가 있는 하위 태스크를 relateToReleasedParent=true 로 바꾼다: 예외 없이 끝나고 관계는 1건만(중복
   * 없음), 유형은 TASK, 부모는 풀린다.
   */
  @Test
  void relate_when_relation_already_exists_is_success_without_duplicate() {
    Long owner = createUser("g");
    var p = newProject(owner, "STPB");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    Long taskId = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow().id();
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null, null));
    var sub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, subId, parent.number(), null));
    // A 와 이미 RELATES 관계가 있는 상태에서 시작한다(완료 기준 5 — 이미 있으면 그대로).
    relationService.add(
        owner,
        p.key(),
        sub.number(),
        new AddIssueRelationRequest(
            relatesTypeId(), null, new AddIssueRelationRequest.Target(null, parent.number())));

    issueService.setType(owner, p.key(), sub.number(), taskId, null, null, true);

    assertThat(relatesBetween(sub.id(), parent.id())).isEqualTo(1);
    var detail = issueService.get(owner, p.key(), sub.number());
    assertThat(detail.summary().type().name()).isEqualTo("TASK");
    assertThat(detail.summary().parent()).isNull();
  }

  /**
   * WP-2097 — 관계 만들기가 실패하면(RELATES 유형 조회 불가로 유도) 유형·부모·이력까지 하나도 바뀌지 않는다 — 관계 유지와 유형 변경은 한 트랜잭션이다(완료
   * 기준 5).
   */
  @Test
  void relation_failure_rolls_back_type_change() {
    Long owner = createUser("h");
    var p = newProject(owner, "STPD");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    Long taskId = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow().id();
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null, null));
    var sub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, subId, parent.number(), null));
    // 실패 유도 확정(계획의 두 갈래 중 채택): RELATES 코드를 바꿔 관계 단계의 유형 조회가 빈 값이 되게 한다 —
    // 모킹은 이 통합 컨텍스트의 다른 테스트(실제 insertIfAbsent 필요)와 충돌한다.
    dsl.execute("UPDATE issue_relation_type SET code = 'RELATES_OFF' WHERE code = 'RELATES'");

    assertThatThrownBy(
            () -> issueService.setType(owner, p.key(), sub.number(), taskId, null, null, true))
        .isInstanceOf(IssueRelationException.class);

    // 관계 예외 이후에는 유형·부모·부모 변경 이력이 하나도 남지 않는다.
    var unchanged = issueRepository.findById(sub.id()).orElseThrow();
    assertThat(unchanged.typeId()).isEqualTo(subId);
    assertThat(unchanged.parentIssueId()).isEqualTo(parent.id());
    var events = historyRepository.findByIssue(sub.id());
    assertThat(events).noneMatch(h -> "PARENT_CHANGED".equals(h.eventType()));
  }

  /**
   * WP-2097 — 지금 상위(태스크 A)의 에픽 아래로 옮기며 relateToReleasedParent=true: 응답에 옛 상위(A) 키가 실리고, 새 부모는 에픽 E
   * 이며, A 와 RELATES 1건이 남는다.
   */
  @Test
  void move_under_epic_keeps_relation_with_released_parent() {
    Long owner = createUser("i");
    var p = newProject(owner, "STPE");
    Long epicId = typeRepository.findByProjectAndName(p.id(), "EPIC").orElseThrow().id();
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    Long bugId = typeRepository.findByProjectAndName(p.id(), "BUG").orElseThrow().id();
    var epic =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("e", null, null, null, null, epicId, null, null));
    var taskA =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("a", null, null, null, null, null, epic.number(), null));
    var sub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, subId, taskA.number(), null));

    var response =
        issueService.setType(
            owner, p.key(), sub.number(), bugId, null, p.key() + "-" + epic.number(), true);

    assertThat(response.releasedParentKey()).isEqualTo(p.key() + "-" + taskA.number());
    var detail = issueService.get(owner, p.key(), sub.number());
    assertThat(detail.summary().parent().number()).isEqualTo(epic.number());
    assertThat(relatesBetween(sub.id(), taskA.id())).isEqualTo(1);
  }

  /**
   * WP-2097 — relateToReleasedParent=false 면 RELATES 0건(변경 없음)이지만 releasedParentKey 는 옵션과 무관하게 옛 상위
   * 키가 나온다 — 키가 없으면 상위가 안 바뀐 것이다. 해제(parent=null)와 유형·부모 변경 이력은 그대로 일어난다.
   */
  @Test
  void relate_false_leaves_no_relation_but_still_reports_released_key() {
    Long owner = createUser("j");
    var p = newProject(owner, "STPF");
    Long subId = typeRepository.findByProjectAndName(p.id(), "SUBTASK").orElseThrow().id();
    Long taskId = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow().id();
    var parent =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("p", null, null, null, null, null, null, null));
    var sub =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest("s", null, null, null, null, subId, parent.number(), null));

    var response = issueService.setType(owner, p.key(), sub.number(), taskId, null, null, false);

    assertThat(relatesBetween(sub.id(), parent.id())).isZero();
    assertThat(response.releasedParentKey()).isEqualTo(p.key() + "-" + parent.number());
    var detail = issueService.get(owner, p.key(), sub.number());
    assertThat(detail.summary().parent()).isNull();
    var events = historyRepository.findByIssue(sub.id());
    assertThat(events).anyMatch(h -> "PARENT_CHANGED".equals(h.eventType()));
    assertThat(events).anyMatch(h -> "TYPE_CHANGED".equals(h.eventType()));
  }

  /**
   * WP-2097 코드 검증 — 호출자가 옛 상위의 프로젝트를 읽을 수 없으면(교차 프로젝트 부모, 접근 미회여) 관계를 하나도 만들지 않는다: RELATES 행 0건, 양쪽
   * 이슈 모두 RELATION_ADDED 이력 없음 — resolveTarget 이 지키는 읽기 검사와 같은 규칙이라, 유형·부모 변경은 그대로 성공하고(관계만 건너뛴다)
   * 읽을 수 없는 옛 상위의 키는 응답에 실리지 않는다(반려 요청).
   */
  @Test
  void relate_is_skipped_when_caller_cannot_read_old_parent_project() {
    Long owner = createUser("k");
    Long caller = createUser("k2");
    // 옛 상위는 B 프로젝트의 에픽 — 호출자는 B 멤버가 아니라 팀 프로젝트를 못 읽는다.
    var pB = newProject(owner, "PX1");
    var pA = newProject(caller, "PX2");
    // B 소유자가 A 에 멤버로 들어와 교차 프로젝트 부모 지정을 대신 해 준다 — 호출자는 그대로 B 비멤버로 남는다.
    memberRepository.insert(pA.id(), owner, "MEMBER");
    Long parentTypeId = typeRepository.findByProjectAndName(pB.id(), "EPIC").orElseThrow().id();
    Long epicTypeId = typeRepository.findByProjectAndName(pA.id(), "EPIC").orElseThrow().id();
    var epic =
        issueService.create(
            owner,
            pB.key(),
            new CreateIssueRequest("e", null, null, null, null, parentTypeId, null, null));
    var child =
        issueService.create(
            caller,
            pA.key(),
            new CreateIssueRequest("c", null, null, null, null, null, null, null));
    issueService.setParent(owner, pA.key(), child.number(), null, pB.key() + "-" + epic.number());

    // 읽을 수 없는 부모를 풀며 relateToReleasedParent 를 켠 유형·부모 변경.
    var response =
        issueService.setType(caller, pA.key(), child.number(), epicTypeId, null, null, true);

    // 관계 행은 하나도 생기지 않는다 — 호출자는 그 관계를 결국 볼 수 없고, RELATION_ADDED 이력도 양쪽에 없다.
    assertThat(relatesBetween(child.id(), epic.id())).isZero();
    assertThat(historyRepository.findByIssue(child.id()))
        .noneMatch(h -> "RELATION_ADDED".equals(h.eventType()));
    assertThat(historyRepository.findByIssue(epic.id()))
        .noneMatch(h -> "RELATION_ADDED".equals(h.eventType()));
    // 유형·부모 변경은 그대로 성공한다 — 읽을 수 없는 옛 상위의 키는 응답·MCP 결과로 드러내지 않는다(null).
    assertThat(response.releasedParentKey()).isNull();
    var detail = issueService.get(caller, pA.key(), child.number());
    assertThat(detail.summary().type().name()).isEqualTo("EPIC");
    assertThat(detail.summary().parent()).isNull();
    var events = historyRepository.findByIssue(child.id());
    assertThat(events).anyMatch(h -> "PARENT_CHANGED".equals(h.eventType()));
    assertThat(events).anyMatch(h -> "TYPE_CHANGED".equals(h.eventType()));
  }

  /**
   * 가려진 상위 계약 고정(WP-2131) — 웹은 상세 응답의 {@code summary.parent.hidden} 에 기대어 가린 모드 확인 창을 띄우고, 확인하면
   * relate 옵션 없는 {@code { typeId }} 만 보낸다(= 6인자 setType). 그때 상세는 가린 상위의 키·제목·프로젝트를 드러내지 않고, 유형 변경은
   * 관계 행 없이 상위만 푼다.
   */
  @Test
  void hidden_parent_is_flagged_in_detail_and_released_without_relation_on_plain_type_change() {
    Long owner = createUser("h1");
    Long caller = createUser("h2");
    // 상위는 B 프로젝트의 에픽 — 호출자는 B 멤버가 아니라 읽을 수 없다.
    var pB = newProject(owner, "PH1");
    var pA = newProject(caller, "PH2");
    memberRepository.insert(pA.id(), owner, "MEMBER");
    Long parentTypeId = typeRepository.findByProjectAndName(pB.id(), "EPIC").orElseThrow().id();
    Long epicTypeId = typeRepository.findByProjectAndName(pA.id(), "EPIC").orElseThrow().id();
    var epic =
        issueService.create(
            owner,
            pB.key(),
            new CreateIssueRequest("e", null, null, null, null, parentTypeId, null, null));
    var child =
        issueService.create(
            caller,
            pA.key(),
            new CreateIssueRequest("c", null, null, null, null, null, null, null));
    issueService.setParent(owner, pA.key(), child.number(), null, pB.key() + "-" + epic.number());

    // 변경 전 상세 — 상위는 있되 가려져 있다: hidden 표시만 있고 키·제목·프로젝트는 비어 있다.
    var before = issueService.get(caller, pA.key(), child.number()).summary().parent();
    assertThat(before).isNotNull();
    assertThat(before.hidden()).isTrue();
    assertThat(before.number()).isZero();
    assertThat(before.title()).isNull();
    assertThat(before.projectKey()).isNull();

    // 웹 가린 모드 확인 — relate 옵션 없는 6인자 호출.
    var response = issueService.setType(caller, pA.key(), child.number(), epicTypeId, null, null);

    // 가린 상위의 키는 응답으로 드러나지 않고, 관계 행도 만들어지지 않는다.
    assertThat(response.releasedParentKey()).isNull();
    var detail = issueService.get(caller, pA.key(), child.number());
    assertThat(detail.summary().type().name()).isEqualTo("EPIC");
    assertThat(detail.summary().parent()).isNull();
    assertThat(relatesBetween(child.id(), epic.id())).isZero();
  }

  /**
   * WP-2097 반려 수정 — 교차 프로젝트인데 개인 프로젝트가 끼면 {@code add} 가 거는 개인 프로젝트 교차 금지와 같은 규칙으로 보고 관계를 만들지 않는다(예외
   * 대신 false — 유형·부모 변경은 그대로 진행된다). 호출자는 개인 프로젝트 소유자라 읽을 수 있어, 읽기 검사가 아니라 이 규칙이 건너뛰게 함을 가린다.
   *
   * <p>방어 코드라 {@code setType} 경로로는 도달하지 않는다 — 부모 지정 자체가 {@code ParentViolation.PERSONAL} 로 먼저 막히기
   * 때문이다(그래서 직접 호출로 판정만 본다). 부모 규칙이 달라져 이 경로가 열려도 관계가 생기지 않음을 지키는 테스트다.
   */
  @Test
  void relate_to_released_parent_is_skipped_for_cross_project_personal() {
    Long caller = createUser("pp");
    var personal =
        projectService.create(caller, new CreateProjectRequest(null, "개인-반려검사", null, "PERSONAL"));
    var team = newProject(caller, "PRT1");
    var parent =
        issueService.create(
            caller,
            personal.key(),
            new CreateIssueRequest("p", null, null, null, null, null, null, null));
    var child =
        issueService.create(
            caller,
            team.key(),
            new CreateIssueRequest("c", null, null, null, null, null, null, null));
    var parentRow = issueRepository.findById(parent.id()).orElseThrow();
    var childRow = issueRepository.findById(child.id()).orElseThrow();

    // 읽기는 되지만 교차 프로젝트에 개인 프로젝트가 있다 — 관계를 만들지 않고 false.
    assertThat(relationService.relateToReleasedParent(caller, childRow, parentRow)).isFalse();
    assertThat(relatesBetween(child.id(), parent.id())).isZero();
    assertThat(historyRepository.findByIssue(child.id()))
        .noneMatch(h -> "RELATION_ADDED".equals(h.eventType()));
    assertThat(historyRepository.findByIssue(parent.id()))
        .noneMatch(h -> "RELATION_ADDED".equals(h.eventType()));
  }
}
