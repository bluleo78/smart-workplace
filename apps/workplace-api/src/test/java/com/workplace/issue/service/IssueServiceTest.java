package com.workplace.issue.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.UpdateIssueRequest;
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
            new CreateIssueRequest("first", "b1", null, null, null, null, null));
    IssueResponse second =
        issueService.create(
            ownerId,
            projectKey,
            new CreateIssueRequest("second", "b2", null, null, null, null, null));

    assertThat(first.number()).isEqualTo(1);
    assertThat(second.number()).isEqualTo(2);
  }

  /** 개인 프로젝트: 멤버 아닌 AGENT 도 담당자로 지정 가능 (Unit 4 검증 완화). */
  @Test
  void create_personalAllowsAgentAssignee() {
    Long owner = createUser("owner6");
    Long agent = createAgentUser("bot6");
    ProjectResponse personal =
        projectService.create(owner, new CreateProjectRequest(null, "p6", null, "PERSONAL"));
    IssueResponse resp =
        issueService.create(
            owner,
            personal.key(),
            new CreateIssueRequest("t", null, null, null, List.of(agent), null, null));
    // create() 응답 DTO 는 assignees 를 채우지 않으므로(IssueResponse.from), 읽기 경로(get)로 실제 배정 확인
    IssueDetailResponse detail = issueService.get(owner, personal.key(), resp.number());
    assertThat(detail.summary().assignees()).anyMatch(a -> a.id().equals(agent));
  }

  /**
   * #368 근본원인 실증: AGENT 가 자기 담당 이슈를 직접 읽으려 하면(get_issue_detail 경로) 프로젝트 멤버가 아니므로 거부된다. 개인 프로젝트는
   * AGENT 를 담당자로 둘 수 있지만(create_personalAllowsAgentAssignee), 담당자라고 project_member 가 되는 것은 아니다.
   * 채팅 @멘션으로 트리거된 AGENT 도 동일하게 비멤버 → 이슈 본문·제목 컨텍스트를 읽지 못해 "이슈를 모른다"고 답하는 것이 #368 의 핵심. owner(멤버)는
   * 읽히고 agent(비멤버)는 거부됨을 한 테스트에서 대비시켜 비대칭을 고정한다.
   *
   * <p>#368 의 fix(채팅 이벤트 payload 에 이슈 컨텍스트 enrich)는 권한 자체를 바꾸지 않으므로 이 테스트는 fix 후에도 그대로 통과한다 — 즉 "왜
   * payload 로 미리 주입해야 하는가"를 고정하는 근본원인 회귀 테스트다. (에이전트의 이슈 직접 조회 권한 갭은 #368 범위 밖, 별도 후속 이슈로 추적.)
   */
  @Test
  void get_byAssignedNonMemberAgent_throwsAccessDenied() {
    Long owner = createUser("owner368");
    Long agent = createAgentUser("bot368");
    ProjectResponse personal =
        projectService.create(owner, new CreateProjectRequest(null, "p368", null, "PERSONAL"));
    IssueResponse resp =
        issueService.create(
            owner,
            personal.key(),
            new CreateIssueRequest("이슈제목", "이슈본문", null, null, List.of(agent), null, null));
    // owner(멤버)는 정상 조회
    assertThat(issueService.get(owner, personal.key(), resp.number())).isNotNull();
    // agent(담당자지만 비멤버)는 멤버십 가드에서 거부 — 이슈 컨텍스트를 읽지 못한다.
    assertThatThrownBy(() -> issueService.get(agent, personal.key(), resp.number()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /** 개인 프로젝트: 소유자/AGENT 가 아닌 일반 HUMAN 은 담당자로 지정 불가 (Unit 4 검증 완화의 경계). */
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
                    new CreateIssueRequest("t", null, null, null, List.of(stranger), null, null)))
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
            new CreateIssueRequest("t", null, null, null, null, bug.id(), null));
    IssueDetailResponse detail = issueService.get(owner, personal.key(), resp.number());
    assertThat(detail.summary().type().name()).isEqualTo("TASK");
  }

  @Test
  void create_priorityDefaultsToMid() {
    IssueResponse resp =
        issueService.create(
            ownerId, projectKey, new CreateIssueRequest("t", "b", null, null, null, null, null));

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
            ownerId, projectKey, new CreateIssueRequest("t", "b", null, null, null, null, null));
    // TODO → IN_PROGRESS
    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        new UpdateIssueRequest(null, null, "IN_PROGRESS", null, null, null));
    // IN_PROGRESS → DONE
    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        new UpdateIssueRequest(null, null, "DONE", null, null, null));

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
            ownerId, projectKey, new CreateIssueRequest("t", "b", null, null, null, null, null));
    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        new UpdateIssueRequest(null, null, "DONE", null, null, null));
    // DONE → TODO 재오픈
    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        new UpdateIssueRequest(null, null, "TODO", null, null, null));

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
            ownerId, projectKey, new CreateIssueRequest("orig", "b", null, null, null, null, null));

    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        new UpdateIssueRequest("renamed", null, null, null, null, null));

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
            ownerId, projectKey, new CreateIssueRequest("t", "b", null, null, null, null, null));

    issueService.softDelete(ownerId, projectKey, created.number());

    assertThatThrownBy(() -> issueService.get(ownerId, projectKey, created.number()))
        .isInstanceOf(IssueNotFoundException.class);
  }

  @Test
  void softDelete_byNonReporterNonOwner_throwsAccessDenied() {
    // owner 가 이슈 생성, other 를 MEMBER 로 추가 → other 는 reporter 도 OWNER 도 아님
    IssueResponse created =
        issueService.create(
            ownerId, projectKey, new CreateIssueRequest("t", "b", null, null, null, null, null));
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
            ownerId, projectKey, new CreateIssueRequest("t", "b", null, null, null, null, null));
    // 히스토리 row 1개 추가될 변경 (title)
    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        new UpdateIssueRequest("renamed", null, null, null, null, null));
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
}
