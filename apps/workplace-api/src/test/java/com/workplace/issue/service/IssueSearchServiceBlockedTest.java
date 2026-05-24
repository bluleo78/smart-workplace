package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 4b — IssueSearchService 의 blocked 필터/플래그/링크 결과 검증. */
@Transactional
class IssueSearchServiceBlockedTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueSearchService searchService;
  @Autowired IssueDependencyService depService;
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

  private IssueRow newTask(Long projectId, int number, String title, Long reporterId) {
    return issueRepository.insert(projectId, number, title, "b", "MID", null, reporterId);
  }

  @Test
  void blocked_by_active_blocker_sets_flag_true() {
    Long owner = createUser("sb1");
    var p = newProject(owner, "SB1");
    newTask(p.id(), 1, "x", owner); // 차단자 X, status TODO
    newTask(p.id(), 2, "y", owner); // 피차단자 Y
    depService.add(owner, p.key(), 1, 2, "blocks"); // X→Y

    var res = searchService.search(owner, p.key(), Map.of());
    var y = res.items().stream().filter(i -> i.number() == 2).findFirst().orElseThrow();
    assertThat(y.blocked()).isTrue();
    var x = res.items().stream().filter(i -> i.number() == 1).findFirst().orElseThrow();
    assertThat(x.blocked()).isFalse();
  }

  @Test
  void blocked_flag_false_when_blocker_done() {
    Long owner = createUser("sb2");
    var p = newProject(owner, "SB2");
    var x = newTask(p.id(), 1, "x", owner);
    newTask(p.id(), 2, "y", owner);
    depService.add(owner, p.key(), 1, 2, "blocks");
    // X status -> DONE 로 변경 → 차단 해소
    issueRepository.updateAll(x.id(), x.title(), x.body(), "DONE", x.priority(), x.dueDate(), null);

    var res = searchService.search(owner, p.key(), Map.of());
    var y = res.items().stream().filter(i -> i.number() == 2).findFirst().orElseThrow();
    assertThat(y.blocked()).isFalse();
  }

  @Test
  void blocked_filter_returns_only_blocked() {
    Long owner = createUser("sb3");
    var p = newProject(owner, "SB3");
    newTask(p.id(), 1, "blocker", owner);
    newTask(p.id(), 2, "blockee", owner);
    newTask(p.id(), 3, "free", owner);
    depService.add(owner, p.key(), 1, 2, "blocks");

    var res = searchService.search(owner, p.key(), Map.of("blocked", "true"));
    assertThat(res.items()).extracting(i -> i.number()).containsExactly(2);
  }

  @Test
  void blockedBy_blocks_populated_in_search() {
    Long owner = createUser("sb4");
    var p = newProject(owner, "SB4");
    newTask(p.id(), 1, "x", owner);
    newTask(p.id(), 2, "y", owner);
    depService.add(owner, p.key(), 1, 2, "blocks"); // X→Y

    var res = searchService.search(owner, p.key(), Map.of());
    var x = res.items().stream().filter(i -> i.number() == 1).findFirst().orElseThrow();
    var y = res.items().stream().filter(i -> i.number() == 2).findFirst().orElseThrow();
    assertThat(x.blocks()).extracting(s -> s.number()).containsExactly(2);
    assertThat(x.blockedBy()).isEmpty();
    assertThat(y.blockedBy()).extracting(s -> s.number()).containsExactly(1);
    assertThat(y.blocks()).isEmpty();
  }
}
