package com.workplace.issue.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
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
            ownerId, projectKey, new CreateIssueRequest("first", "b1", null, null, null, null));
    IssueResponse second =
        issueService.create(
            ownerId, projectKey, new CreateIssueRequest("second", "b2", null, null, null, null));

    assertThat(first.number()).isEqualTo(1);
    assertThat(second.number()).isEqualTo(2);
  }

  @Test
  void create_priorityDefaultsToMid() {
    IssueResponse resp =
        issueService.create(
            ownerId, projectKey, new CreateIssueRequest("t", "b", null, null, null, null));

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
            ownerId, projectKey, new CreateIssueRequest("t", "b", null, null, null, null));
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
            ownerId, projectKey, new CreateIssueRequest("t", "b", null, null, null, null));
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
            ownerId, projectKey, new CreateIssueRequest("orig", "b", null, null, null, null));

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
            ownerId, projectKey, new CreateIssueRequest("t", "b", null, null, null, null));

    issueService.softDelete(ownerId, projectKey, created.number());

    assertThatThrownBy(() -> issueService.get(ownerId, projectKey, created.number()))
        .isInstanceOf(IssueNotFoundException.class);
  }

  @Test
  void softDelete_byNonReporterNonOwner_throwsAccessDenied() {
    // owner 가 이슈 생성, other 를 MEMBER 로 추가 → other 는 reporter 도 OWNER 도 아님
    IssueResponse created =
        issueService.create(
            ownerId, projectKey, new CreateIssueRequest("t", "b", null, null, null, null));
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
            ownerId, projectKey, new CreateIssueRequest("t", "b", null, null, null, null));
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
