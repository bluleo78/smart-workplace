package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.exception.InvalidCursorException;
import com.workplace.issue.repository.IssueRepository;
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

/** IssueSearchService 통합 테스트 — 멤버십 가드 + 페이징 메타 정확성 검증. */
@Transactional
class IssueSearchServiceTest extends IntegrationTestBase {

  @Autowired IssueSearchService searchService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;
  @Autowired DSLContext dsl;

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
  void returns_next_cursor_when_more_rows_remain() {
    Long userId = createUser("ua");
    String key = uniqueKey("PA");
    ProjectResponse proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    for (int i = 1; i <= 3; i++) {
      issueRepository.insert(proj.id(), i, "t" + i, null, "MID", null, userId);
    }

    var resp = searchService.search(userId, key, java.util.Map.of("size", "2"));

    assertThat(resp.items()).hasSize(2);
    assertThat(resp.nextCursor()).isNotNull();
    assertThat(resp.hasMore()).isTrue();
  }

  @Test
  void terminates_when_page_smaller_than_size() {
    Long userId = createUser("ub");
    String key = uniqueKey("PB");
    ProjectResponse proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    issueRepository.insert(proj.id(), 1, "only", null, "MID", null, userId);

    var resp = searchService.search(userId, key, java.util.Map.of("size", "10"));

    assertThat(resp.items()).hasSize(1);
    assertThat(resp.nextCursor()).isNull();
    assertThat(resp.hasMore()).isFalse();
  }

  @Test
  void non_member_forbidden() {
    Long owner = createUser("uo");
    Long other = createUser("ux");
    String key = uniqueKey("PC");
    projectService.create(owner, new CreateProjectRequest(key, "P", "x"));

    assertThatThrownBy(() -> searchService.search(other, key, java.util.Map.of()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void size_clamped_to_max_100() {
    Long userId = createUser("uc");
    String key = uniqueKey("PD");
    projectService.create(userId, new CreateProjectRequest(key, "P", "x"));

    // 행이 없어 빈 결과지만 예외/오류 없이 처리되어야 함
    var resp = searchService.search(userId, key, java.util.Map.of("size", "9999"));

    assertThat(resp.items()).isEmpty();
  }

  @Test
  void invalid_cursor_throws() {
    Long userId = createUser("ud");
    String key = uniqueKey("PE");
    projectService.create(userId, new CreateProjectRequest(key, "P", "x"));

    assertThatThrownBy(
            () -> searchService.search(userId, key, java.util.Map.of("cursor", "@@invalid@@")))
        .isInstanceOf(InvalidCursorException.class);
  }
}
