package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.service.CycleService;
import com.workplace.issue.exception.InvalidIssueFilterException;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.milestone.dto.CreateMilestoneRequest;
import com.workplace.milestone.service.MilestoneService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-735: 이슈 검색의 milestone·cycle 필터가 숫자가 아닌 값을 조용히 버려 전체 이슈를 돌려주던 문제. 라벨·유형(#841)처럼 이름을 해석하고, 못 찾는
 * 값은 400(InvalidIssueFilterException)으로 거부한다. 숫자 id 와 사이클의 약속된 토큰(null·none)은 그대로다.
 */
@Transactional
class IssueSearchMilestoneCycleFilterTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueSearchService searchService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;
  @Autowired MilestoneService milestoneService;
  @Autowired CycleService cycleService;

  private Long ownerId;
  private ProjectResponse project;
  private long milestoneId;
  private long cycleId;

  /** 이슈 3개 — 1번은 마일스톤 「1.0 출시」, 2번은 사이클 「스프린트 1」, 3번은 둘 다 없음. */
  @BeforeEach
  void seed() {
    String s = UUID.randomUUID().toString().substring(0, 8);
    ownerId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "mc-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "mc")
            .set(USER.EMAIL, "mc-" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, ownerId)
        .set(MEMBERSHIP.TENANT_ID, defaultTenantId())
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    String key = "MC" + s.replaceAll("[^a-zA-Z]", "").toUpperCase().concat("QQQQ").substring(0, 4);
    project = projectService.create(ownerId, new CreateProjectRequest(key, "마일스톤·사이클", "x"));
    milestoneId =
        milestoneService
            .create(
                ownerId,
                project.key(),
                new CreateMilestoneRequest("1.0 출시", LocalDate.of(2026, 12, 31), null))
            .id();
    cycleId =
        cycleService
            .create(
                ownerId,
                project.key(),
                new CreateCycleRequest(
                    "스프린트 1", null, LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 14), null))
            .id();
    var i1 = issueRepository.insert(project.id(), 1, "마일스톤", null, "MID", null, ownerId);
    var i2 = issueRepository.insert(project.id(), 2, "사이클", null, "MID", null, ownerId);
    issueRepository.insert(project.id(), 3, "없음", null, "MID", null, ownerId);
    dsl.update(ISSUE).set(ISSUE.MILESTONE_ID, milestoneId).where(ISSUE.ID.eq(i1.id())).execute();
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, i2.id())
        .set(ISSUE_CYCLE.CYCLE_ID, cycleId)
        .execute();
  }

  private java.util.List<Integer> numbers(Map<String, String> params) {
    return searchService.search(ownerId, project.key(), params).items().stream()
        .map(i -> i.number())
        .toList();
  }

  @Test
  void 마일스톤_이름은_대소문자_무시로_해석하고_숫자_id_도_그대로_된다() {
    assertThat(numbers(Map.of("milestone", "1.0 출시"))).containsExactly(1);
    assertThat(numbers(Map.of("milestone", String.valueOf(milestoneId)))).containsExactly(1);
  }

  @Test
  void 없는_마일스톤_이름은_전체_목록이_아니라_400() {
    assertThatThrownBy(() -> numbers(Map.of("milestone", "abc")))
        .isInstanceOf(InvalidIssueFilterException.class)
        .hasMessageContaining("abc")
        .hasMessageContaining("1.0 출시")
        .satisfies(
            e -> assertThat(((InvalidIssueFilterException) e).getField()).isEqualTo("milestone"));
  }

  @Test
  void 사이클_이름과_약속된_토큰을_해석하고_없는_이름은_400() {
    assertThat(numbers(Map.of("cycle", "스프린트 1"))).containsExactly(2);
    assertThat(numbers(Map.of("cycle", String.valueOf(cycleId)))).containsExactly(2);
    // none = 사이클 연결이 하나도 없는 이슈(WP-176) — 이름 해석 대상이 아니다.
    assertThat(numbers(Map.of("cycle", "none"))).containsExactlyInAnyOrder(1, 3);
    assertThatThrownBy(() -> numbers(Map.of("cycle", "abc")))
        .isInstanceOf(InvalidIssueFilterException.class)
        .hasMessageContaining("스프린트 1")
        .satisfies(
            e -> assertThat(((InvalidIssueFilterException) e).getField()).isEqualTo("cycle"));
  }

  @Test
  void 그룹_카운트도_같은_필터_해석으로_없는_마일스톤은_400() {
    assertThatThrownBy(
            () ->
                searchService.groupCounts(
                    ownerId, project.key(), Map.of("groupBy", "status", "milestone", "abc")))
        .isInstanceOf(InvalidIssueFilterException.class);
  }
}
