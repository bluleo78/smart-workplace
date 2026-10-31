package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.MeIssuesTestFixtures;
import com.workplace.issue.MeIssuesTestFixtures.ProjectRef;
import com.workplace.issue.dto.IssueCursor;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.dto.IssueSortCursor;
import com.workplace.issue.exception.InvalidCursorException;
import com.workplace.issue.exception.InvalidIssueFilterException;
import com.workplace.issue.service.IssueSearchService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1238: 이슈 목록 사용자 지정 정렬(sort·direction)과 수정일·시작일 범위 필터. 키마다 정렬 순서(비어 있는 값은 방향과 무관하게 맨 뒤), 여러 키
 * 조합, 복합 커서({@link IssueSortCursor})로 끝까지 따라가도 중복·누락이 없는지, 잘못된 입력·다른 정렬 커서는 400 인지, sort 가 없으면 기존
 * (updated_at, id) 정렬·{@link IssueCursor} 그대로인지, /me/issues 에서도 같은지 본다. 시드는 테스트 트랜잭션 안에서 하고 롤백한다.
 */
@Transactional
class IssueSortTest extends IntegrationTestBase {

  @Autowired IssueSearchService issueSearchService;
  @Autowired MeIssuesTestFixtures fx;
  @Autowired DSLContext dsl;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;

  private static final Instant T0 = Instant.parse("2026-10-01T00:00:00Z");

  private long me;
  private ProjectRef p;

  /** 시드마다 1초씩 늘리는 수정 시각 — 동률 깨기(updatedAt DESC)가 시드 순서의 역순이 되게 한다. */
  private int tick;

  @BeforeEach
  void seedCaller() {
    me = fx.loginUser("c");
    // MockMvc 로 프로젝트 경로를 부를 때 역할 권한이 유효하려면 현재 테넌트의 ACTIVE 멤버여야 한다(WP-420).
    TestFixtures.activeMemberOfCurrentTenant(dsl, me);
    p = fx.project(me, "P");
    tick = 0;
  }

  @Test
  void dueDateNullsLastInBothDirections() {
    long noDue1 = seed(p, "nodue1", "MID", null, null);
    long late = seed(p, "late", "MID", date(10, 20), null);
    long early = seed(p, "early", "MID", date(10, 5), null);
    long noDue2 = seed(p, "nodue2", "MID", null, null);
    long mid = seed(p, "mid", "MID", date(10, 10), null);

    // 마감 없음끼리는 동률 깨기(수정 시각 DESC) — 나중에 시드한 noDue2 가 앞.
    assertThat(ids(page(sort("dueDate", "asc"), 100, null)))
        .containsExactly(early, mid, late, noDue2, noDue1);
    assertThat(ids(page(sort("dueDate", "desc"), 100, null)))
        .containsExactly(late, mid, early, noDue2, noDue1);
    // direction 을 빼면 desc.
    assertThat(ids(page(Map.of("sort", "dueDate"), 100, null)))
        .containsExactly(late, mid, early, noDue2, noDue1);
  }

  @Test
  void priorityAscIsHighestFirstAndDescIsReverse() {
    long low = seed(p, "low", "LOW", null, null);
    long highest = seed(p, "highest", "HIGHEST", null, null);
    long mid = seed(p, "mid", "MID", null, null);
    long lowest = seed(p, "lowest", "LOWEST", null, null);
    long high = seed(p, "high", "HIGH", null, null);

    assertThat(ids(page(sort("priority", "asc"), 100, null)))
        .containsExactly(highest, high, mid, low, lowest);
    assertThat(ids(page(sort("priority", "desc"), 100, null)))
        .containsExactly(lowest, low, mid, high, highest);
  }

  @Test
  void statusSortsByCategoryThenPosition() {
    long canceled = seed(p, "canceled", "MID", null, "CANCELED");
    long done = seed(p, "done", "MID", null, "DONE");
    long review = seed(p, "review", "MID", null, null);
    long progress = seed(p, "progress", "MID", null, "IN_PROGRESS");
    long todo = seed(p, "todo", "MID", null, null);
    // 사용자 정의 상태는 기존 상태들 뒤 position — 같은 범주(IN_PROGRESS) 안에서 기본 「진행 중」 뒤.
    fx.moveToCustomStatus(review, p, "검토 중", "IN_PROGRESS", "PURPLE");

    assertThat(ids(page(sort("status", "asc"), 100, null)))
        .containsExactly(todo, progress, review, done, canceled);
    assertThat(ids(page(sort("status", "desc"), 100, null)))
        .containsExactly(canceled, done, review, progress, todo);
  }

  @Test
  void assigneeSortsByMinNameAndUnassignedLast() {
    long alice = fx.loginUser("aa");
    long bob = fx.loginUser("bb");
    long none1 = seedAssigned("none1", (Long) null);
    long bobOnly = seedAssigned("bob", bob);
    long both = seedAssigned("both", bob, alice); // 이름 최솟값 = aa…
    long aliceOnly = seedAssigned("alice", alice);
    long none2 = seedAssigned("none2", (Long) null);

    // 같은 이름(aa) 동률은 수정 시각 DESC — aliceOnly 가 both 보다 나중 시드.
    assertThat(ids(page(sort("assignee", "asc"), 100, null)))
        .containsExactly(aliceOnly, both, bobOnly, none2, none1);
    assertThat(ids(page(sort("assignee", "desc"), 100, null)))
        .containsExactly(bobOnly, aliceOnly, both, none2, none1);
  }

  @Test
  void multiKeyPositionalDirections() {
    long aLow = seed(p, "a-low", "LOW", date(10, 1), null);
    long aHigh = seed(p, "a-high", "HIGH", date(10, 1), null);
    long bHigh = seed(p, "b-high", "HIGH", date(10, 2), null);
    long nLow = seed(p, "n-low", "LOW", null, null);
    long nHigh = seed(p, "n-high", "HIGH", null, null);

    // 마감 asc(없음 맨 뒤) → 같은 마감 안에서 우선순위 desc(낮은 것 먼저).
    assertThat(ids(page(sort("dueDate,priority", "asc,desc"), 100, null)))
        .containsExactly(aLow, aHigh, bHigh, nLow, nHigh);
    // direction 하나면 모든 키에 — 둘 다 asc.
    assertThat(ids(page(sort("dueDate,priority", "asc"), 100, null)))
        .containsExactly(aHigh, aLow, bHigh, nHigh, nLow);
  }

  @Test
  void pagingHasNoGapOrDuplicate() {
    long alice = fx.loginUser("aa");
    // 동률(같은 마감·우선순위·담당자·마감 없음 묶음)을 여럿 두어 페이지 경계에 걸리게 한다.
    seed(p, "o1", "HIGH", date(10, 1), null);
    seed(p, "o2", "HIGH", date(10, 1), null);
    seed(p, "o3", "MID", date(10, 1), "DONE");
    seed(p, "n1", "LOW", null, null);
    seed(p, "n2", "LOW", null, "IN_PROGRESS");
    seed(p, "n3", "LOW", null, null);
    long a1 = seed(p, "a1", "MID", date(10, 3), null);
    long a2 = seed(p, "a2", "MID", null, "CANCELED");
    assign(a1, alice);
    assign(a2, alice);

    List<Map<String, String>> sorts =
        List.of(
            sort("dueDate", "asc"),
            sort("dueDate", "desc"),
            sort("priority", "asc"),
            sort("priority,dueDate", "desc,asc"),
            sort("status,assignee", "asc"),
            sort("assignee", "desc"),
            sort("updatedAt", "asc"),
            sort("createdAt", "desc"));
    for (Map<String, String> base : sorts) {
      List<Long> all = ids(page(base, 100, null));
      assertThat(all).as(base.toString()).hasSize(8);
      for (int size : List.of(1, 2, 3)) {
        List<Long> paged = pageThrough(base, size);
        assertThat(paged).as(base + " size=" + size).containsExactlyElementsOf(all);
        assertThat(new HashSet<>(paged)).hasSize(paged.size());
      }
    }
  }

  @Test
  void updatedRangeUsesSeoulDayBoundsInclusive() {
    // 2026-10-10 KST 하루 = 2026-10-09T15:00Z ~ 2026-10-10T15:00Z(미포함).
    long before = seedAt("before", Instant.parse("2026-10-09T14:59:59Z"));
    long start = seedAt("start", Instant.parse("2026-10-09T15:00:00Z"));
    long end = seedAt("end", Instant.parse("2026-10-10T14:59:59Z"));
    long after = seedAt("after", Instant.parse("2026-10-10T15:00:00Z"));

    Map<String, String> oneDay = Map.of("updatedFrom", "2026-10-10", "updatedTo", "2026-10-10");
    assertThat(ids(page(oneDay, 100, null))).containsExactly(end, start);
    assertThat(ids(page(Map.of("updatedFrom", "2026-10-11"), 100, null))).containsExactly(after);
    assertThat(ids(page(Map.of("updatedTo", "2026-10-09"), 100, null))).containsExactly(before);
    // 같은 범위가 /me/issues 에도.
    Map<String, String> mine = new HashMap<>(oneDay);
    mine.put("size", "100");
    assertThat(ids(issueSearchService.searchMine(me, mine))).containsExactly(end, start);
  }

  @Test
  void startRangeIsInclusiveDateCompare() {
    long s1 = seedStart("s1", date(10, 1));
    long s5 = seedStart("s5", date(10, 5));
    long s9 = seedStart("s9", date(10, 9));
    seedStart("none", null);

    assertThat(ids(page(Map.of("startFrom", "2026-10-05", "startTo", "2026-10-09"), 100, null)))
        .containsExactly(s9, s5);
    assertThat(ids(page(Map.of("startTo", "2026-10-01"), 100, null))).containsExactly(s1);
    // 범위와 정렬을 함께.
    Map<String, String> sorted = new HashMap<>(sort("dueDate", "asc"));
    sorted.put("startFrom", "2026-10-01");
    assertThat(ids(page(sorted, 100, null))).containsExactlyInAnyOrder(s1, s5, s9);
  }

  @Test
  void invalidSortInputIs400() throws Exception {
    String base = "/api/v1/projects/" + p.key() + "/issues?";
    assertThat(status(base + "sort=nope")).isEqualTo(400);
    assertThat(status(base + "sort=dueDate,dueDate")).isEqualTo(400);
    assertThat(status(base + "sort=dueDate&direction=up")).isEqualTo(400);
    assertThat(status(base + "sort=dueDate,priority,status&direction=asc,desc")).isEqualTo(400);
    assertThat(status(base + "direction=asc")).isEqualTo(400);
    assertThat(status(base + "sort=dueDate&order=checklist&mode=status")).isEqualTo(400);
    assertThat(status(base + "updatedFrom=2026-13-01")).isEqualTo(400);
    assertThat(status(base + "startTo=x")).isEqualTo(400);
    assertThat(status("/api/v1/me/issues?sort=dueDate&group=due")).isEqualTo(400);
    // projectKey 로 단일 프로젝트 검색에 위임돼도 같은 규칙 — group 을 조용히 버리고 200 이 되면 안 된다.
    assertThat(status("/api/v1/me/issues?projectKey=" + p.key() + "&sort=dueDate&group=due"))
        .isEqualTo(400);
    assertThat(status("/api/v1/me/issues?projectKey=" + p.key() + "&sort=dueDate")).isEqualTo(200);
    // 정상 입력은 200 — 대소문자 무시.
    assertThat(status(base + "sort=DueDate,PRIORITY&direction=ASC,desc")).isEqualTo(200);
    assertThat(status("/api/v1/me/issues?sort=status&direction=asc")).isEqualTo(200);
    assertThatThrownBy(() -> issueSearchService.search(me, p.key(), Map.of("sort", "title")))
        .isInstanceOf(InvalidIssueFilterException.class);
  }

  @Test
  void cursorFromOtherSortOrLegacyIs400() {
    seed(p, "a", "MID", null, null);
    seed(p, "b", "MID", null, null);
    String dueCursor = page(sort("dueDate", "asc"), 1, null).nextCursor();
    assertThat(IssueSortCursor.decode(dueCursor).signature()).isEqualTo("dueDate:asc");

    // 같은 키라도 방향이 다르면 다른 정렬.
    assertThatThrownBy(() -> page(sort("dueDate", "desc"), 1, dueCursor))
        .isInstanceOf(InvalidCursorException.class);
    assertThatThrownBy(() -> page(sort("priority", "asc"), 1, dueCursor))
        .isInstanceOf(InvalidCursorException.class);
    // 기존 커서를 사용자 지정 정렬에, 사용자 지정 커서를 기본 정렬에 보내도 400.
    assertThatThrownBy(() -> page(sort("dueDate", "asc"), 1, IssueCursor.encode(T0, 1L)))
        .isInstanceOf(InvalidCursorException.class);
    assertThatThrownBy(() -> page(Map.of(), 1, dueCursor))
        .isInstanceOf(InvalidCursorException.class);
  }

  @Test
  void defaultOrderUnchangedWithoutSort() {
    long a = seed(p, "a", "HIGH", date(10, 1), null);
    long b = seed(p, "b", "LOW", null, null);
    long c = seed(p, "c", "MID", null, null);

    assertThat(ids(page(Map.of(), 100, null))).containsExactly(c, b, a);
    IssueSearchResponse first = page(Map.of(), 2, null);
    assertThat(IssueCursor.decode(first.nextCursor()).id()).isEqualTo(b);
    assertThat(ids(page(Map.of(), 2, first.nextCursor()))).containsExactly(a);
  }

  @Test
  void meIssuesSortsAcrossProjects() {
    ProjectRef q = fx.project(me, "Q");
    long pLow = seed(p, "p-low", "LOW", null, null);
    long qHigh = seed(q, "q-high", "HIGH", null, null);
    long pHighest = seed(p, "p-highest", "HIGHEST", null, null);
    long qMid = seed(q, "q-mid", "MID", null, null);

    Map<String, String> params = new HashMap<>(sort("priority", "asc"));
    params.put("size", "100");
    IssueSearchResponse all = issueSearchService.searchMine(me, params);
    assertThat(ids(all)).containsExactly(pHighest, qHigh, qMid, pLow);
    // 행마다 자기 프로젝트 키.
    assertThat(all.items().get(1).projectKey()).isEqualTo(q.key());

    List<Long> paged = new ArrayList<>();
    String cursor = null;
    for (int guard = 0; guard < 10; guard++) {
      Map<String, String> pp = new HashMap<>(sort("priority", "asc"));
      pp.put("size", "1");
      if (cursor != null) pp.put("cursor", cursor);
      IssueSearchResponse pg = issueSearchService.searchMine(me, pp);
      paged.addAll(ids(pg));
      cursor = pg.nextCursor();
      if (cursor == null) break;
    }
    assertThat(paged).containsExactly(pHighest, qHigh, qMid, pLow);
  }

  @Test
  void groupCountsIgnoresSortParams() {
    seed(p, "a", "HIGH", null, null);
    seed(p, "b", "LOW", null, null);
    var counts =
        issueSearchService.groupCounts(
            me, p.key(), Map.of("groupBy", "priority", "sort", "dueDate", "direction", "asc"));
    assertThat(counts.groups()).hasSize(2);
  }

  // ---------------------------------------------------------------- 헬퍼

  private static LocalDate date(int month, int day) {
    return LocalDate.of(2026, month, day);
  }

  private static Map<String, String> sort(String keys, String direction) {
    return Map.of("sort", keys, "direction", direction);
  }

  /** 우선순위·마감·상태를 정한 이슈 — 수정 시각은 시드 순서대로 1초씩 늘려 동률 깨기 순서를 정해 둔다(마지막에 쓴다). */
  private long seed(ProjectRef proj, String title, String priority, LocalDate due, String status) {
    Instant at = T0.plusSeconds(++tick);
    long id = fx.issue(proj, title, me, me, due, status, at);
    dsl.update(ISSUE)
        .set(ISSUE.PRIORITY, priority)
        .set(ISSUE.UPDATED_AT, at.atOffset(ZoneOffset.UTC))
        .where(ISSUE.ID.eq(id))
        .execute();
    return id;
  }

  /** 담당자를 정한 이슈(없으면 담당자 없음) — fx.issue 는 담당자 하나만 받아 나머지는 직접 넣는다. */
  private long seedAssigned(String title, Long... assignees) {
    Instant at = T0.plusSeconds(++tick);
    Long first = assignees.length == 0 ? null : assignees[0];
    long id = fx.issue(p, title, me, first, null, null, at);
    for (int i = 1; i < assignees.length; i++) assign(id, assignees[i]);
    return id;
  }

  private void assign(long issueId, long userId) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, me)
        .execute();
  }

  private long seedAt(String title, Instant updatedAt) {
    return fx.issue(p, title, me, me, null, null, updatedAt);
  }

  private long seedStart(String title, LocalDate start) {
    long id = seed(p, title, "MID", null, null);
    dsl.update(ISSUE).set(ISSUE.START_DATE, start).where(ISSUE.ID.eq(id)).execute();
    return id;
  }

  private IssueSearchResponse page(Map<String, String> base, int size, String cursor) {
    Map<String, String> params = new HashMap<>(base);
    params.put("size", String.valueOf(size));
    if (cursor != null) params.put("cursor", cursor);
    return issueSearchService.search(me, p.key(), params);
  }

  /** size 단위로 nextCursor 를 끝까지 따라가 모은 id — 끝나지 않으면 실패. */
  private List<Long> pageThrough(Map<String, String> base, int size) {
    List<Long> out = new ArrayList<>();
    String cursor = null;
    for (int guard = 0; guard < 50; guard++) {
      IssueSearchResponse page = page(base, size, cursor);
      out.addAll(ids(page));
      if (page.nextCursor() == null) return out;
      cursor = page.nextCursor();
    }
    throw new AssertionError("커서 순회가 끝나지 않았다");
  }

  private static List<Long> ids(IssueSearchResponse page) {
    return page.items().stream().map(IssueResponse::id).toList();
  }

  private int status(String url) throws Exception {
    return mvc.perform(
            get(url)
                .header(
                    "Authorization",
                    "Bearer " + jwtTokenProvider.generateAccessToken(me, "user-" + me)))
        .andReturn()
        .getResponse()
        .getStatus();
  }
}
