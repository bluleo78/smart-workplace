package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueRow;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 4b — issue_dependency 리포지토리 통합 테스트. */
@Transactional
class IssueDependencyRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueDependencyRepository depRepo;
  @Autowired IssueRepository issueRepo;
  @Autowired IssueTypeRepository typeRepo;
  @Autowired ProjectService projectService;

  /** USER + USER 역할 매핑 1건 시드. */
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

  /** 같은 프로젝트에 TASK 이슈 한 건 생성 (parent 없음). */
  private IssueRow newTask(Long projectId, int number, String title, Long reporterId) {
    return issueRepo.insert(projectId, number, title, "b", "MID", null, reporterId);
  }

  @Test
  void add_and_find_blocks_of() {
    Long owner = createUser("ra1");
    var p = newProject(owner, "RA1");
    var a = newTask(p.id(), 1, "a", owner);
    var b = newTask(p.id(), 2, "b", owner);
    var c = newTask(p.id(), 3, "c", owner);

    depRepo.add(a.id(), b.id(), owner);
    depRepo.add(a.id(), c.id(), owner);

    assertThat(depRepo.findBlocksOf(a.id())).containsExactlyInAnyOrder(b.id(), c.id());
    assertThat(depRepo.exists(a.id(), b.id())).isTrue();
    assertThat(depRepo.exists(a.id(), c.id())).isTrue();
    assertThat(depRepo.exists(b.id(), a.id())).isFalse();
  }

  @Test
  void find_blocked_by_for_issues_batch() {
    Long owner = createUser("ra2");
    var p = newProject(owner, "RA2");
    var a = newTask(p.id(), 1, "a", owner);
    var b = newTask(p.id(), 2, "b", owner);
    var c = newTask(p.id(), 3, "c", owner);
    // a→b, c→b
    depRepo.add(a.id(), b.id(), owner);
    depRepo.add(c.id(), b.id(), owner);

    var map = depRepo.findBlockedByForIssues(List.of(b.id(), a.id()));
    assertThat(map.get(b.id())).hasSize(2);
    assertThat(map.get(a.id())).isEmpty();
    assertThat(map.get(b.id()))
        .extracting(s -> s.number())
        .containsExactlyInAnyOrder(a.number(), c.number());
    assertThat(map.get(b.id()).get(0).type()).isNotNull();
  }

  @Test
  void find_blocks_for_issues_batch() {
    Long owner = createUser("ra3");
    var p = newProject(owner, "RA3");
    var a = newTask(p.id(), 1, "a", owner);
    var b = newTask(p.id(), 2, "b", owner);
    var c = newTask(p.id(), 3, "c", owner);
    // a→b, a→c
    depRepo.add(a.id(), b.id(), owner);
    depRepo.add(a.id(), c.id(), owner);

    var map = depRepo.findBlocksForIssues(List.of(a.id(), b.id()));
    assertThat(map.get(a.id()))
        .extracting(s -> s.number())
        .containsExactlyInAnyOrder(b.number(), c.number());
    assertThat(map.get(b.id())).isEmpty();
  }

  @Test
  void find_blocked_flags_returns_true_when_active_blocker_exists() {
    Long owner = createUser("ra4");
    var p = newProject(owner, "RA4");
    var a = newTask(p.id(), 1, "a", owner); // 차단자
    var b = newTask(p.id(), 2, "b", owner); // 피차단자
    depRepo.add(a.id(), b.id(), owner);

    // a status=TODO 기본 → b 는 blocked
    var flags = depRepo.findBlockedFlags(List.of(b.id(), a.id()));
    assertThat(flags.get(b.id())).isTrue();
    assertThat(flags.get(a.id())).isFalse();

    // a status=DONE 으로 갱신 → b 는 unblocked
    issueRepo.updateAll(a.id(), a.title(), a.body(), "DONE", a.priority(), a.dueDate(), null);
    var flags2 = depRepo.findBlockedFlags(List.of(b.id()));
    assertThat(flags2.get(b.id())).isFalse();
  }

  @Test
  void remove_drops_one_row() {
    Long owner = createUser("ra5");
    var p = newProject(owner, "RA5");
    var a = newTask(p.id(), 1, "a", owner);
    var b = newTask(p.id(), 2, "b", owner);
    depRepo.add(a.id(), b.id(), owner);

    int removed = depRepo.remove(a.id(), b.id());
    assertThat(removed).isEqualTo(1);
    assertThat(depRepo.findBlocksOf(a.id())).isEmpty();
    // 멱등 — 두번째 remove 는 0
    assertThat(depRepo.remove(a.id(), b.id())).isZero();
  }

  @Test
  void on_conflict_do_nothing_is_idempotent() {
    Long owner = createUser("ra6");
    var p = newProject(owner, "RA6");
    var a = newTask(p.id(), 1, "a", owner);
    var b = newTask(p.id(), 2, "b", owner);
    depRepo.add(a.id(), b.id(), owner);
    depRepo.add(a.id(), b.id(), owner); // 중복

    assertThat(depRepo.findBlocksOf(a.id())).hasSize(1);
  }
}
