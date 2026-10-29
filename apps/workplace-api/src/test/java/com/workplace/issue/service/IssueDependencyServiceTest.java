package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.groups.Tuple.tuple;

import com.workplace.issue.dto.IssueHistoryEntryResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.exception.InvalidDependencyException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueDependencyRepository;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 4b — IssueDependencyService 가드 + 멱등 + history 통합 테스트. */
@Transactional
class IssueDependencyServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueDependencyService service;
  @Autowired IssueDependencyRepository depRepository;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueHistoryRepository historyRepository;
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
    return IssueSeeds.insert(
        issueRepository, baseDsl, projectId, number, title, "b", "MID", null, reporterId);
  }

  @Test
  void member_add_blocks_creates_row_and_records_history() {
    Long owner = createUser("sa1");
    var p = newProject(owner, "SA1");
    var i1 = newTask(p.id(), 1, "i1", owner);
    var i2 = newTask(p.id(), 2, "i2", owner);

    service.add(owner, p.key(), 1, 2, "blocks");

    assertThat(depRepository.findBlocksOf(i1.id())).containsExactly(i2.id());
    var history = historyRepository.findByIssue(i1.id());
    assertThat(history).anyMatch(h -> "DEPENDENCY_ADDED".equals(h.eventType()));
  }

  /** WP-1125: 상대 이슈 이력에도 반대 방향으로 남는다 — 막힌 쪽에서 언제·누가 막았는지 보인다. 풀 때도 같다. */
  @Test
  void add_and_remove_record_history_on_both_issues_with_opposite_direction() {
    Long owner = createUser("sa13");
    var p = newProject(owner, "SA13");
    var i1 = newTask(p.id(), 1, "막는 이슈", owner);
    var i2 = newTask(p.id(), 2, "막히는 이슈", owner);

    service.add(owner, p.key(), 1, 2, "blocks");
    service.remove(owner, p.key(), 1, 2, "blocks");

    var other = historyRepository.findByIssue(i2.id());
    assertThat(other)
        .filteredOn(h -> h.eventType().startsWith("DEPENDENCY_"))
        .extracting(h -> h.eventType(), h -> h.actorId())
        .containsExactlyInAnyOrder(
            tuple("DEPENDENCY_ADDED", owner), tuple("DEPENDENCY_REMOVED", owner));
    assertThat(other)
        .filteredOn(h -> h.eventType().startsWith("DEPENDENCY_"))
        .allSatisfy(
            h ->
                assertThat(h.toValue())
                    .contains("\"direction\":\"blockedBy\"")
                    .contains("\"number\":1")
                    .contains("막는 이슈"));
    // 작업한 쪽은 그대로 blocks 로 한 줄씩.
    assertThat(historyRepository.findByIssue(i1.id()))
        .filteredOn(h -> h.eventType().startsWith("DEPENDENCY_"))
        .allSatisfy(
            h ->
                assertThat(h.toValue())
                    .contains("\"direction\":\"blocks\"")
                    .contains("\"number\":2"))
        .hasSize(2);
  }

  @Test
  void member_add_blocked_by_creates_reverse_row() {
    Long owner = createUser("sa2");
    var p = newProject(owner, "SA2");
    var i1 = newTask(p.id(), 1, "i1", owner);
    var i2 = newTask(p.id(), 2, "i2", owner);

    // direction=blockedBy → (other=i2, this=i1) row 생성: i2 가 i1 을 차단.
    service.add(owner, p.key(), 1, 2, "blockedBy");

    assertThat(depRepository.findBlocksOf(i2.id())).containsExactly(i1.id());
    assertThat(depRepository.findBlocksOf(i1.id())).isEmpty();
    // WP-1125: 이력도 방향을 따른다 — 호출 이슈(i1)는 blockedBy, 상대(i2)는 blocks.
    assertThat(dependencyHistory(i1.id()))
        .singleElement()
        .satisfies(h -> assertThat(h.toValue()).contains("\"direction\":\"blockedBy\""));
    assertThat(dependencyHistory(i2.id()))
        .singleElement()
        .satisfies(
            h ->
                assertThat(h.toValue())
                    .contains("\"direction\":\"blocks\"")
                    .contains("\"number\":1"));
  }

  @Test
  void self_dependency_throws_400() {
    Long owner = createUser("sa3");
    var p = newProject(owner, "SA3");
    newTask(p.id(), 1, "i1", owner);

    assertThatThrownBy(() -> service.add(owner, p.key(), 1, 1, "blocks"))
        .isInstanceOf(InvalidDependencyException.class);
  }

  @Test
  void foreign_project_throws_400() {
    Long owner = createUser("sa4");
    var pa = newProject(owner, "SA4A");
    var pb = newProject(owner, "SA4B");
    newTask(pa.id(), 1, "ia", owner);
    newTask(pb.id(), 1, "ib", owner);
    // pa.1 에서 다른 프로젝트의 이슈를 가리키려 해도 같은 프로젝트에서 not found 로 변환됨 → InvalidDependency
    // pa 안에는 number=2 가 없음 → other 없음.
    assertThatThrownBy(() -> service.add(owner, pa.key(), 1, 2, "blocks"))
        .isInstanceOf(InvalidDependencyException.class);
  }

  @Test
  void missing_this_issue_throws_404() {
    Long owner = createUser("sa5");
    var p = newProject(owner, "SA5");

    assertThatThrownBy(() -> service.add(owner, p.key(), 999, 1, "blocks"))
        .isInstanceOf(IssueNotFoundException.class);
  }

  @Test
  void missing_other_throws_400() {
    Long owner = createUser("sa6");
    var p = newProject(owner, "SA6");
    newTask(p.id(), 1, "i1", owner);

    assertThatThrownBy(() -> service.add(owner, p.key(), 1, 999, "blocks"))
        .isInstanceOf(InvalidDependencyException.class);
  }

  @Test
  void non_member_forbidden() {
    Long owner = createUser("sa7a");
    Long stranger = createUser("sa7b");
    var p = newProject(owner, "SA7");
    newTask(p.id(), 1, "i1", owner);
    newTask(p.id(), 2, "i2", owner);

    assertThatThrownBy(() -> service.add(stranger, p.key(), 1, 2, "blocks"))
        .isInstanceOf(ProjectNotFoundException.class);
  }

  @Test
  void duplicate_add_is_idempotent_no_history() {
    Long owner = createUser("sa8");
    var p = newProject(owner, "SA8");
    var i1 = newTask(p.id(), 1, "i1", owner);
    var i2 = newTask(p.id(), 2, "i2", owner);

    service.add(owner, p.key(), 1, 2, "blocks");
    service.add(owner, p.key(), 1, 2, "blocks"); // 중복

    assertThat(depRepository.findBlocksOf(i1.id())).hasSize(1);
    long added =
        historyRepository.findByIssue(i1.id()).stream()
            .filter(h -> "DEPENDENCY_ADDED".equals(h.eventType()))
            .count();
    assertThat(added).isEqualTo(1L);
    // 상대 이슈에도 첫 추가의 한 줄만 남는다(WP-1125).
    assertThat(dependencyHistory(i2.id())).hasSize(1);
  }

  @Test
  void remove_drops_row_and_records_history() {
    Long owner = createUser("sa9");
    var p = newProject(owner, "SA9");
    var i1 = newTask(p.id(), 1, "i1", owner);
    newTask(p.id(), 2, "i2", owner);

    service.add(owner, p.key(), 1, 2, "blocks");
    service.remove(owner, p.key(), 1, 2, "blocks");

    assertThat(depRepository.findBlocksOf(i1.id())).isEmpty();
    long events =
        historyRepository.findByIssue(i1.id()).stream()
            .filter(h -> h.eventType().startsWith("DEPENDENCY_"))
            .count();
    assertThat(events).isEqualTo(2L);
  }

  @Test
  void remove_nonexistent_is_idempotent_no_history() {
    Long owner = createUser("sa10");
    var p = newProject(owner, "SA10");
    var i1 = newTask(p.id(), 1, "i1", owner);
    var i2 = newTask(p.id(), 2, "i2", owner);

    service.remove(owner, p.key(), 1, 2, "blocks");

    long events =
        historyRepository.findByIssue(i1.id()).stream()
            .filter(h -> h.eventType().startsWith("DEPENDENCY_"))
            .count();
    assertThat(events).isZero();
    assertThat(dependencyHistory(i2.id())).isEmpty();
  }

  /** WP-586: direction 은 blocks·blockedBy 만 받는다 — 오타가 반대 방향 관계로 저장·삭제되지 않게 400. */
  @Test
  void unknown_direction_rejected_on_add_and_remove() {
    Long owner = createUser("sa11");
    var p = newProject(owner, "SA11");
    var i1 = newTask(p.id(), 1, "i1", owner);
    newTask(p.id(), 2, "i2", owner);

    for (String bad : new String[] {"blockedby", "zzz", ""}) {
      assertThatThrownBy(() -> service.add(owner, p.key(), 1, 2, bad))
          .isInstanceOf(InvalidDependencyException.class)
          .hasMessage("의존성 방향은 blocks 또는 blockedBy 만 쓸 수 있습니다");
    }
    assertThat(depRepository.findBlocksOf(i1.id())).isEmpty();

    service.add(owner, p.key(), 1, 2, "blocks");
    assertThatThrownBy(() -> service.remove(owner, p.key(), 1, 2, "zzz"))
        .isInstanceOf(InvalidDependencyException.class)
        .hasMessage("의존성 방향은 blocks 또는 blockedBy 만 쓸 수 있습니다");
    // 거절된 제거는 기존 관계를 지우지 않는다.
    assertThat(depRepository.findBlocksOf(i1.id())).hasSize(1);
  }

  /** addMember 헬퍼 — 컴파일러 hint 용 (사용 안 함 경고 방지). */
  @SuppressWarnings("unused")
  private void addMember(Long owner, String key, Long user) {
    projectService.addMember(owner, key, new AddMemberRequest(user, "MEMBER"));
  }

  /** 이슈의 의존성 이력(DEPENDENCY_*)만. */
  private List<IssueHistoryEntryResponse> dependencyHistory(Long issueId) {
    return historyRepository.findByIssue(issueId).stream()
        .filter(h -> h.eventType().startsWith("DEPENDENCY_"))
        .toList();
  }
}
