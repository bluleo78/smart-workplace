package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueCursor;
import com.workplace.issue.dto.IssueSearchQuery;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueRepository.search 통합 테스트 — 동적 조건/cursor 페이징 검증. */
@Transactional
class IssueRepositorySearchTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;

  /** 시드 컨텍스트: 사용자 1명 + 활성 프로젝트 1개. */
  private record Seed(Long userId, Long projectId, String projectKey) {}

  private Seed seed(String label) {
    Long userId = createUser(label);
    String key = uniqueKey("P" + label.toUpperCase());
    ProjectResponse p =
        projectService.create(userId, new CreateProjectRequest(key, "P-" + label, "x"));
    return new Seed(userId, p.id(), key);
  }

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

  @Test
  void empty_filters_returns_all_active_by_updated_desc() {
    var s = seed("a");
    issueRepository.insert(s.projectId, 1, "first", null, "MID", null, s.userId, null);
    issueRepository.insert(s.projectId, 2, "second", null, "MID", null, s.userId, null);

    var result =
        issueRepository.search(
            s.projectId,
            new IssueSearchQuery(
                null, List.of(), List.of(), false, List.of(), null, null, null, 30, List.of()));

    assertThat(result).hasSize(2);
    assertThat(result.get(0).number()).isEqualTo(2); // 가장 최근
  }

  @Test
  void q_matches_title_or_body_ilike() {
    var s = seed("b");
    issueRepository.insert(s.projectId, 1, "Login bug", "auth", "MID", null, s.userId, null);
    issueRepository.insert(
        s.projectId, 2, "Other", "needs LOGIN flow", "MID", null, s.userId, null);
    issueRepository.insert(s.projectId, 3, "Unrelated", "nothing", "MID", null, s.userId, null);

    var result =
        issueRepository.search(
            s.projectId,
            new IssueSearchQuery(
                "login", List.of(), List.of(), false, List.of(), null, null, null, 30, List.of()));

    assertThat(result).hasSize(2);
    assertThat(result).extracting("title").contains("Login bug", "Other");
  }

  @Test
  void status_csv_or_matching() {
    var s = seed("c");
    issueRepository.insert(s.projectId, 1, "todo", null, "MID", null, s.userId, null);
    var inProgRow =
        issueRepository.insert(s.projectId, 2, "inprog", null, "MID", null, s.userId, null);
    issueRepository.updateAll(
        inProgRow.id(), "inprog", null, "IN_PROGRESS", "MID", null, null, null);
    issueRepository.insert(s.projectId, 3, "todo2", null, "MID", null, s.userId, null);

    var result =
        issueRepository.search(
            s.projectId,
            new IssueSearchQuery(
                null,
                List.of("IN_PROGRESS"),
                List.of(),
                false,
                List.of(),
                null,
                null,
                null,
                30,
                List.of()));

    assertThat(result).hasSize(1);
    assertThat(result.get(0).id()).isEqualTo(inProgRow.id());
  }

  @Test
  void include_unassigned_matches_null_assignee() {
    var s = seed("d");
    issueRepository.insert(s.projectId, 1, "unassigned", null, "MID", null, s.userId, null);
    issueRepository.insert(s.projectId, 2, "assigned", null, "MID", null, s.userId, s.userId);

    var result =
        issueRepository.search(
            s.projectId,
            new IssueSearchQuery(
                null, List.of(), List.of(), true, List.of(), null, null, null, 30, List.of()));

    assertThat(result).hasSize(1);
    assertThat(result.get(0).title()).isEqualTo("unassigned");
  }

  @Test
  void assignee_ids_or_includes_unassigned() {
    var s = seed("e");
    Long other = createUser("other-e");
    issueRepository.insert(s.projectId, 1, "byme", null, "MID", null, s.userId, s.userId);
    issueRepository.insert(s.projectId, 2, "byother", null, "MID", null, s.userId, other);
    issueRepository.insert(s.projectId, 3, "unassigned", null, "MID", null, s.userId, null);

    var result =
        issueRepository.search(
            s.projectId,
            new IssueSearchQuery(
                null,
                List.of(),
                List.of(s.userId),
                true,
                List.of(),
                null,
                null,
                null,
                30,
                List.of()));

    assertThat(result).hasSize(2);
    assertThat(result).extracting("title").contains("byme", "unassigned");
  }

  @Test
  void due_range_inclusive() {
    var s = seed("f");
    issueRepository.insert(
        s.projectId, 1, "before", null, "MID", LocalDate.parse("2026-05-01"), s.userId, null);
    issueRepository.insert(
        s.projectId, 2, "in", null, "MID", LocalDate.parse("2026-05-15"), s.userId, null);
    issueRepository.insert(
        s.projectId, 3, "after", null, "MID", LocalDate.parse("2026-06-01"), s.userId, null);

    var result =
        issueRepository.search(
            s.projectId,
            new IssueSearchQuery(
                null,
                List.of(),
                List.of(),
                false,
                List.of(),
                LocalDate.parse("2026-05-10"),
                LocalDate.parse("2026-05-31"),
                null,
                30,
                List.of()));

    assertThat(result).hasSize(1);
    assertThat(result.get(0).title()).isEqualTo("in");
  }

  @Test
  void cursor_paging_continues_after_first_page() {
    var s = seed("g");
    for (int i = 1; i <= 5; i++) {
      issueRepository.insert(s.projectId, i, "n" + i, null, "MID", null, s.userId, null);
    }

    var page1 =
        issueRepository.search(
            s.projectId,
            new IssueSearchQuery(
                null, List.of(), List.of(), false, List.of(), null, null, null, 2, List.of()));
    assertThat(page1).hasSize(2);

    var lastRow = page1.get(page1.size() - 1);
    var cursor = new IssueCursor(lastRow.updatedAt(), lastRow.id());
    var page2 =
        issueRepository.search(
            s.projectId,
            new IssueSearchQuery(
                null, List.of(), List.of(), false, List.of(), null, null, cursor, 2, List.of()));

    assertThat(page2).hasSize(2);
    assertThat(page2).extracting("id").doesNotContain(lastRow.id());
  }
}
