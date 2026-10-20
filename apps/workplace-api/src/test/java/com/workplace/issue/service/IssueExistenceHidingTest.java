package com.workplace.issue.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-588 — 비멤버에게 「볼 수 없는」 프로젝트·이슈와 「없는」 프로젝트·이슈가 같은 404·같은 문구로 보여야 한다(존재 오라클 차단). 이슈 id 는 테넌트 전역
 * 일련번호라 403/404 차이로 볼 수 없는 프로젝트의 이슈 수·증가 시점이, 프로젝트 키는 비공개 TEAM 프로젝트의 존재가 드러났다.
 */
@Transactional
class IssueExistenceHidingTest extends IntegrationTestBase {

  @Autowired private IssueService issueService;
  @Autowired private IssueCommentService commentService;
  @Autowired private ProjectService projectService;
  @Autowired private DSLContext dsl;

  private Long ownerId;
  private Long strangerId;
  private String teamKey;
  private IssueResponse teamIssue;

  @BeforeEach
  void setUp() {
    ownerId = createUser("owner");
    strangerId = createUser("stranger");
    teamKey = uniqueKey("HD");
    projectService.create(ownerId, new CreateProjectRequest(teamKey, "숨김", "x", "TEAM"));
    teamIssue =
        issueService.create(
            ownerId,
            teamKey,
            new CreateIssueRequest("비공개 이슈", "b", null, null, null, null, null, null));
  }

  @Test
  void projectKeyPath_hiddenAndMissing_lookTheSame() {
    Throwable hidden = thrown(() -> issueService.get(strangerId, teamKey, teamIssue.number()));
    Throwable missing = thrown(() -> issueService.get(strangerId, uniqueKey("NO"), 1));

    assertThat(hidden).isInstanceOf(ProjectNotFoundException.class);
    assertThat(missing).isInstanceOf(ProjectNotFoundException.class);
    assertThat(hidden.getMessage())
        .isEqualTo(missing.getMessage())
        .isEqualTo("프로젝트를 찾을 수 없거나 볼 수 없습니다");
  }

  @Test
  void commentList_hiddenAndMissing_lookTheSame() {
    Throwable hidden = thrown(() -> commentService.list(strangerId, teamIssue.id()));
    Throwable missing = thrown(() -> commentService.list(strangerId, 999_999_999L));

    assertThat(hidden).isInstanceOf(IssueNotFoundException.class);
    assertThat(missing).isInstanceOf(IssueNotFoundException.class);
    assertThat(hidden.getMessage()).isEqualTo(missing.getMessage()).isEqualTo("이슈를 찾을 수 없습니다");
  }

  @Test
  void commentCreate_hiddenAndMissing_lookTheSame() {
    var req = new CreateCommentRequest("안녕하세요");
    Throwable hidden = thrown(() -> commentService.create(strangerId, teamIssue.id(), req));
    Throwable missing = thrown(() -> commentService.create(strangerId, 999_999_999L, req));

    assertThat(hidden).isInstanceOf(IssueNotFoundException.class);
    assertThat(missing).isInstanceOf(IssueNotFoundException.class);
    assertThat(hidden.getMessage()).isEqualTo(missing.getMessage()).isEqualTo("이슈를 찾을 수 없습니다");
  }

  /** 볼 수 있는 OPEN 프로젝트에서 작성 자격만 없는 경우는 그대로 403 — 존재가 이미 보이는 곳이라 숨길 것이 없다. */
  @Test
  void openProjectStranger_comment_staysForbidden() {
    String openKey = uniqueKey("OP");
    projectService.create(ownerId, new CreateProjectRequest(openKey, "접수", "x", "OPEN"));
    IssueResponse openIssue =
        issueService.create(
            ownerId,
            openKey,
            new CreateIssueRequest("공개 이슈", "b", null, null, null, null, null, null));

    assertThatThrownBy(
            () -> commentService.create(strangerId, openIssue.id(), new CreateCommentRequest("x")))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  private static Throwable thrown(Executable call) {
    try {
      call.execute();
    } catch (Throwable t) {
      return t;
    }
    throw new AssertionError("예외가 나야 합니다");
  }

  /** 유니크 username 사용자 + 테넌트#1 ACTIVE 멤버십 + USER 역할. */
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
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  /** 유니크 key (대문자/숫자 2~10자). */
  private static String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
    return (prefix + suffix).substring(0, Math.min(10, (prefix + suffix).length()));
  }
}
