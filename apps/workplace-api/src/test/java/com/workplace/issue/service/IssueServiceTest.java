package com.workplace.issue.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.exception.EpicHasIncompleteChildrenException;
import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueService 통합 테스트. 실제 DB + @Transactional 롤백 패턴. */
@Transactional
class IssueServiceTest extends IntegrationTestBase {

  @Autowired private IssueService issueService;
  @Autowired private ProjectService projectService;
  @Autowired private com.workplace.issue.repository.IssueTypeRepository typeRepository;
  @Autowired private DSLContext dsl;

  private Long ownerId;
  private Long otherUserId;
  private String projectKey;
  private Long projectId;

  @BeforeEach
  void setUp() {
    ownerId = createUser("owner");
    otherUserId = createUser("other");
    grantRole(ownerId, "USER");
    grantRole(otherUserId, "USER");

    projectKey = uniqueKey("IT");
    ProjectResponse p =
        projectService.create(ownerId, new CreateProjectRequest(projectKey, "IssueTest", "x"));
    projectId = p.id();
  }

  /** 유니크 username 으로 사용자 시드. */
  private Long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "-" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix)
        .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** role_name 의 역할을 user 에게 부여. */
  private void grantRole(Long userId, String roleName) {
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(roleName)).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
  }

  /** 유니크 key 생성 (대문자/숫자 2~10자). */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return (prefix + suffix).substring(0, Math.min(10, (prefix + suffix).length()));
  }

  @Test
  void create_allocatesNumberFromSequence() {
    IssueResponse first =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("first", "b1", null, null, null, null, null, null));
    IssueResponse second =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("second", "b2", null, null, null, null, null, null));

    assertThat(first.number()).isEqualTo(1);
    assertThat(second.number()).isEqualTo(2);
  }

  /** 개인 프로젝트: AGENT 가 멤버가 아니면 담당자로 지정 불가. 멤버 등록 후에는 담당 가능 (#418 정책 통일). */
  @Test
  void create_personalRequiresAgentMembership() {
    Long owner = createUser("owner6");
    Long agent = createAgentUser("bot6");
    ProjectResponse personal =
        projectService.create(owner, new CreateProjectRequest(null, "p6", null, "PERSONAL"));
    // 멤버 아닌 AGENT → 담당 불가
    assertThatThrownBy(
            () ->
                issueService.create(
                    owner,
                    personal.key(),
                    new CreateIssueRequest(
                        "T", null, "MID", null, List.of(agent), null, null, null)))
        .isInstanceOf(InvalidAssigneeForProjectException.class);
    // AGENT 를 멤버로 추가하면 담당 가능
    projectService.addMember(owner, personal.key(), new AddMemberRequest(agent, "MEMBER"));
    IssueResponse resp =
        issueService.create(
            owner,
            personal.key(),
            new CreateIssueRequest("T2", null, "MID", null, List.of(agent), null, null, null));
    IssueDetailResponse detail = issueService.get(owner, personal.key(), resp.number());
    assertThat(detail.summary().assignees()).anyMatch(a -> a.id().equals(agent));
  }

  /** AGENT 가 멤버로 등록된 개인 프로젝트 이슈 조회 — 멤버이므로 프로젝트 접근 가능 (#418 후속 검증). */
  @Test
  void get_byMemberAgent_allowed() {
    Long owner = createUser("owner368");
    Long agent = createAgentUser("bot368");
    Long stranger = createUser("stranger368");
    ProjectResponse personal =
        projectService.create(owner, new CreateProjectRequest(null, "p368", null, "PERSONAL"));
    // AGENT 를 멤버로 추가해 담당자 지정 가능하게 함
    projectService.addMember(owner, personal.key(), new AddMemberRequest(agent, "MEMBER"));
    IssueResponse resp =
        issueService.create(
            owner,
            personal.key(),
            new CreateIssueRequest("이슈제목", "이슈본문", null, null, List.of(agent), null, null, null));
    // owner(멤버)는 정상 조회
    assertThat(issueService.get(owner, personal.key(), resp.number())).isNotNull();
    // agent(멤버 + 담당자) 조회 가능
    IssueDetailResponse agentView = issueService.get(agent, personal.key(), resp.number());
    assertThat(agentView.body()).isEqualTo("이슈본문");
    assertThat(agentView.summary().title()).isEqualTo("이슈제목");
    // 보안 경계: 멤버도 담당자도 아닌 비멤버는 여전히 거부
    assertThatThrownBy(() -> issueService.get(stranger, personal.key(), resp.number()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /** 개인 프로젝트: 일반 HUMAN 은 담당자로 지정 불가 (멤버 추가 자체가 차단). */
  @Test
  void create_personalRejectsNonOwnerHuman() {
    Long owner = createUser("owner6b");
    Long stranger = createUser("stranger6b");
    ProjectResponse personal =
        projectService.create(owner, new CreateProjectRequest(null, "p6b", null, "PERSONAL"));
    assertThatThrownBy(
            () ->
                issueService.create(
                    owner,
                    personal.key(),
                    new CreateIssueRequest(
                        "t", null, null, null, List.of(stranger), null, null, null)))
        .isInstanceOf(InvalidAssigneeForProjectException.class);
  }

  /** 개인 프로젝트: 비TASK typeId 를 넘겨도 TASK 로 강제된다 (#226 — 개인은 TASK 단일 유형). */
  @Test
  void create_personalForcesTaskTypeEvenWithNonTaskTypeId() {
    Long owner = createUser("owner226");
    ProjectResponse personal =
        projectService.create(owner, new CreateProjectRequest(null, "p226", null, "PERSONAL"));
    // 개인 프로젝트에도 시드되는 BUG 유형 id 를 의도적으로 넘긴다 — 무시되고 TASK 로 귀결되어야 한다.
    var bug = typeRepository.findByProjectAndName(personal.id(), "BUG").orElseThrow();
    IssueResponse resp =
        issueService.create(
            owner,
            personal.key(),
            new CreateIssueRequest("t", null, null, null, null, bug.id(), null, null));
    IssueDetailResponse detail = issueService.get(owner, personal.key(), resp.number());
    assertThat(detail.summary().type().name()).isEqualTo("TASK");
  }

  @Test
  void create_priorityDefaultsToMid() {
    IssueResponse resp =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("t", "b", null, null, null, null, null, null));

    String stored =
        dsl.select(ISSUE.PRIORITY)
            .from(ISSUE)
            .where(ISSUE.ID.eq(resp.id()))
            .fetchOne(ISSUE.PRIORITY);
    assertThat(stored).isEqualTo("MID");
  }

  @Test
  void update_statusToDone_setsClosedAt() {
    IssueResponse created =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("t", "b", null, null, null, null, null, null));
    // TODO → IN_PROGRESS
    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        new UpdateIssueRequest(
            null, null, "IN_PROGRESS", null, null, null, null, false, null, false));
    // IN_PROGRESS → DONE
    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        new UpdateIssueRequest(null, null, "DONE", null, null, null, null, false, null, false));

    var closedAt =
        dsl.select(ISSUE.CLOSED_AT)
            .from(ISSUE)
            .where(ISSUE.ID.eq(created.id()))
            .fetchOne(ISSUE.CLOSED_AT);
    assertThat(closedAt).isNotNull();
  }

  @Test
  void update_statusFromDoneToTodo_clearsClosedAt() {
    IssueResponse created =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("t", "b", null, null, null, null, null, null));
    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        new UpdateIssueRequest(null, null, "DONE", null, null, null, null, false, null, false));
    // DONE → TODO 재오픈
    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        new UpdateIssueRequest(null, null, "TODO", null, null, null, null, false, null, false));

    var closedAt =
        dsl.select(ISSUE.CLOSED_AT)
            .from(ISSUE)
            .where(ISSUE.ID.eq(created.id()))
            .fetchOne(ISSUE.CLOSED_AT);
    assertThat(closedAt).isNull();
  }

  @Test
  void update_titleChange_createsHistoryRow() {
    IssueResponse created =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("orig", "b", null, null, null, null, null, null));

    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        new UpdateIssueRequest("renamed", null, null, null, null, null, null, false, null, false));

    int historyCount =
        dsl.fetchCount(
            ISSUE_HISTORY,
            ISSUE_HISTORY
                .ISSUE_ID
                .eq(created.id())
                .and(ISSUE_HISTORY.EVENT_TYPE.eq("TITLE_CHANGED")));
    assertThat(historyCount).isEqualTo(1);
  }

  @Test
  void softDelete_byReporter_marksDeleted() {
    IssueResponse created =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("t", "b", null, null, null, null, null, null));

    issueService.softDelete(ownerId, projectKey, created.number());

    assertThatThrownBy(() -> issueService.get(ownerId, projectKey, created.number()))
        .isInstanceOf(IssueNotFoundException.class);
  }

  @Test
  void softDelete_byNonReporterNonOwner_throwsAccessDenied() {
    // owner 가 이슈 생성, other 를 MEMBER 로 추가 → other 는 reporter 도 OWNER 도 아님
    IssueResponse created =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("t", "b", null, null, null, null, null, null));
    projectService.addMember(ownerId, projectKey, new AddMemberRequest(otherUserId, "MEMBER"));

    assertThatThrownBy(() -> issueService.softDelete(otherUserId, projectKey, created.number()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void get_unknownNumber_throwsNotFound() {
    assertThatThrownBy(() -> issueService.get(ownerId, projectKey, 9999))
        .isInstanceOf(IssueNotFoundException.class);
  }

  @Test
  void get_returnsCommentsAndHistory() {
    IssueResponse created =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("t", "b", null, null, null, null, null, null));
    // 히스토리 row 1개 추가될 변경 (title)
    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        new UpdateIssueRequest("renamed", null, null, null, null, null, null, false, null, false));
    // 코멘트 1개 추가
    dsl.insertInto(ISSUE_COMMENT)
        .set(ISSUE_COMMENT.ISSUE_ID, created.id())
        .set(ISSUE_COMMENT.AUTHOR_ID, ownerId)
        .set(ISSUE_COMMENT.BODY, "first")
        .execute();

    IssueDetailResponse detail = issueService.get(ownerId, projectKey, created.number());

    assertThat(detail.comments()).hasSize(1);
    assertThat(detail.history()).hasSize(1);
    assertThat(detail.summary().title()).isEqualTo("renamed");
  }

  /**
   * EPIC 을 완료로 바꾸는데 미완료 자식(TASK 유형)이 남아있으면 400 상당 예외로 하드 차단(#710). 보드 카드는 SUBTASK 만 집계하지만 검증은 자식 유형
   * 전체(TASK 포함) 기준이어야 한다.
   */
  @Test
  void updateStatus_epicToDoneWithIncompleteTaskChild_throws() {
    var epicType = typeRepository.findByProjectAndName(projectId, "EPIC").orElseThrow();
    IssueResponse epic =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("epic", "b", null, null, null, epicType.id(), null, null));
    // 비-SUBTASK(TASK) 유형 자식 — parentNumber 로 EPIC 을 부모 지정 가능.
    issueService.create(
        ownerId,
        projectKey,
        new CreateIssueRequest("child task", "b", null, null, null, null, epic.number(), null));

    assertThatThrownBy(() -> issueService.updateStatus(ownerId, projectKey, epic.number(), "DONE"))
        .isInstanceOf(EpicHasIncompleteChildrenException.class)
        .hasMessageContaining(projectKey + "-" + (epic.number() + 1));

    String statusAfter =
        dsl.select(ISSUE.STATUS).from(ISSUE).where(ISSUE.ID.eq(epic.id())).fetchOne(ISSUE.STATUS);
    assertThat(statusAfter).isNotEqualTo("DONE");
  }

  /** 모든 자식 이슈가 완료되면 EPIC 완료 전이가 정상적으로 허용된다 (#710). */
  @Test
  void updateStatus_epicToDoneWithAllChildrenDone_succeeds() {
    var epicType = typeRepository.findByProjectAndName(projectId, "EPIC").orElseThrow();
    IssueResponse epic =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("epic", "b", null, null, null, epicType.id(), null, null));
    IssueResponse child =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("child task", "b", null, null, null, null, epic.number(), null));
    issueService.updateStatus(ownerId, projectKey, child.number(), "DONE");

    issueService.updateStatus(ownerId, projectKey, epic.number(), "DONE");

    String statusAfter =
        dsl.select(ISSUE.STATUS).from(ISSUE).where(ISSUE.ID.eq(epic.id())).fetchOne(ISSUE.STATUS);
    assertThat(statusAfter).isEqualTo("DONE");
  }
}
