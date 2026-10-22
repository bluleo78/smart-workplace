package com.workplace.issue.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.dto.IssueGroupCountsResponse.GroupCount;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.ProjectStatusResponse;
import com.workplace.issue.exception.InvalidIssueFilterException;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개별 상태 필터(WP-807) 통합 테스트 — statusId·statusName 필터, 범주(status) 필터와의 결합, 상태별 그룹 총계. 픽스처 프로젝트는 기본
 * 4상태에 「검토 중」(진행 중 범주)을 더해 둔다.
 */
@Transactional
class IssueStatusFilterTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueSearchService searchService;
  @Autowired ProjectService projectService;
  @Autowired ProjectStatusService statusService;

  private Long owner;
  private ProjectResponse project;
  private long todo;
  private long inProgress;
  private long review;

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
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private ProjectResponse newProject(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(
        owner, new CreateProjectRequest(prefix + suffix, "P-" + prefix, "x"));
  }

  private long statusId(ProjectResponse p, String name) {
    return statusService.list(owner, p.key()).stream()
        .filter(s -> s.name().equals(name))
        .findFirst()
        .map(ProjectStatusResponse::id)
        .orElseThrow();
  }

  private long addStatus(ProjectResponse p, String name, String category) {
    return statusService
        .create(owner, p.key(), new CreateProjectStatusRequest(name, category, null))
        .id();
  }

  /** 지정한 상태 id 로 이슈를 만든다. */
  private IssueResponse create(ProjectResponse p, String title, long statusId) {
    return issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest(
            title, null, null, null, List.of(), null, null, null, null, null, null, null, null,
            null, statusId));
  }

  /** 프로젝트 검색 결과의 제목 목록. */
  private List<String> titles(Map<String, String> params) {
    return searchService.search(owner, project.key(), params).items().stream()
        .map(IssueResponse::title)
        .toList();
  }

  @BeforeEach
  void seed() {
    owner = createUser("sf");
    project = newProject("SF");
    todo = statusId(project, "할 일");
    inProgress = statusId(project, "진행 중");
    review = addStatus(project, "검토 중", "IN_PROGRESS");
    create(project, "todo", todo);
    create(project, "doing", inProgress);
    create(project, "reviewing", review);
  }

  @Test
  void statusId_필터는_그_상태만() {
    assertThat(titles(Map.of("statusId", String.valueOf(review)))).containsExactly("reviewing");
  }

  @Test
  void statusId_여러개는_OR() {
    assertThat(titles(Map.of("statusId", todo + "," + review)))
        .containsExactlyInAnyOrder("todo", "reviewing");
  }

  @Test
  void status범주와_statusId는_AND() {
    assertThat(titles(Map.of("status", "DONE", "statusId", String.valueOf(review)))).isEmpty();
    assertThat(titles(Map.of("status", "IN_PROGRESS", "statusId", String.valueOf(review))))
        .containsExactly("reviewing");
  }

  @Test
  void status범주_필터는_사용자정의_상태도_포함한다() {
    assertThat(titles(Map.of("status", "IN_PROGRESS")))
        .containsExactlyInAnyOrder("doing", "reviewing");
  }

  @Test
  void statusName은_대소문자_공백을_무시한다() {
    long english = addStatus(project, "Review", "IN_PROGRESS");
    create(project, "english", english);

    assertThat(titles(Map.of("statusName", " review "))).containsExactly("english");
  }

  @Test
  void statusId와_statusName은_합집합() {
    assertThat(titles(Map.of("statusId", String.valueOf(todo), "statusName", "검토 중")))
        .containsExactlyInAnyOrder("todo", "reviewing");
  }

  @Test
  void me검색의_statusName은_여러프로젝트_같은이름을_모두_찾는다() {
    ProjectResponse other = newProject("SG");
    long otherReview = addStatus(other, "검토 중", "IN_PROGRESS");
    create(other, "other-reviewing", otherReview);

    var titles =
        searchService.searchMine(owner, Map.of("statusName", "검토 중")).items().stream()
            .map(IssueResponse::title)
            .toList();

    assertThat(titles).containsExactlyInAnyOrder("reviewing", "other-reviewing");
  }

  @Test
  void 모르는_statusName은_400과_사용가능목록() {
    assertThatThrownBy(() -> titles(Map.of("statusName", "검토 중,없는상태")))
        .isInstanceOf(InvalidIssueFilterException.class)
        .hasMessageContaining("상태 '없는상태' 을(를) 찾을 수 없습니다")
        .hasMessageContaining("사용 가능:")
        .hasMessageContaining("검토 중");
  }

  @Test
  void statusId가_숫자가_아니면_400() {
    assertThatThrownBy(() -> titles(Map.of("statusId", "abc")))
        .isInstanceOf(InvalidIssueFilterException.class);
  }

  @Test
  void groupCounts_statusId별로_센다() {
    create(project, "reviewing-2", review);

    var resp = searchService.groupCounts(owner, project.key(), Map.of("groupBy", "statusId"));

    assertThat(resp.groups())
        .containsExactlyInAnyOrder(
            new GroupCount(String.valueOf(todo), 1),
            new GroupCount(String.valueOf(inProgress), 1),
            new GroupCount(String.valueOf(review), 2));
  }
}
