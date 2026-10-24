package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.MeIssuesTestFixtures;
import com.workplace.issue.MeIssuesTestFixtures.ProjectRef;
import com.workplace.issue.dto.ChecklistCursor;
import com.workplace.issue.dto.IssueCursor;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.exception.InvalidCursorException;
import com.workplace.issue.exception.InvalidIssueFilterException;
import com.workplace.issue.service.IssueSearchService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.LocalDate;
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
 * WP-918: 개인 작업 목록용 opt-in 정렬(order=checklist&mode=due|status|priority). 서버가 화면 섹션 순서(마감
 * 버킷·상태·우선순위) → 우선순위 → 마감 → id 로 내려 클라이언트가 페이지를 이어 붙여도 섹션이 섞이지 않는지, 복합 커서({@link ChecklistCursor})로
 * 끝까지 따라가도 중복·누락이 없는지, order 가 없으면 기존 (updated_at, id) 정렬·{@link IssueCursor} 그대로인지 본다. 시드는 테스트
 * 트랜잭션 안에서 하고 롤백한다.
 */
@Transactional
class IssueChecklistOrderTest extends IntegrationTestBase {

  @Autowired IssueSearchService issueSearchService;
  @Autowired MeIssuesTestFixtures fx;
  @Autowired DSLContext dsl;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;

  /** 클라이언트 로컬 기준 오늘·이번 주 끝 — 서버는 이 값으로만 버킷을 가른다. */
  private static final String TODAY = "2026-10-24";

  private static final String WEEK_END = "2026-10-25";

  private static final Instant T0 = Instant.parse("2026-10-01T00:00:00Z");

  private long me;
  private ProjectRef p;

  @BeforeEach
  void seedCaller() {
    me = fx.loginUser("c");
    // MockMvc 로 프로젝트 경로를 부를 때 역할 권한이 유효하려면 현재 테넌트의 ACTIVE 멤버여야 한다(WP-420).
    TestFixtures.activeMemberOfCurrentTenant(dsl, me);
    p = fx.project(me, "P");
  }

  @Test
  void dueModeOrdersBucketsThenPriorityThenDue() {
    // 시드 순서를 정렬 순서와 다르게 섞어 id 순으로 우연히 맞지 않게 한다.
    long done = seed("done", "HIGH", date(10, 1), "DONE");
    long noDue = seed("nodue", "HIGH", null, null);
    long later = seed("later", "LOW", date(11, 1), null);
    long week = seed("week", "MID", date(10, 25), null);
    long today = seed("today", "LOW", date(10, 24), null);
    long overLow = seed("over-low", "LOW", date(10, 1), null);
    long overHighLate = seed("over-high-late", "HIGH", date(10, 20), null);
    long overHighEarly = seed("over-high-early", "HIGH", date(10, 10), null);
    long canceled = seed("canceled", "LOW", null, "CANCELED");

    List<Long> ids = ids(page(due(), 100, null));
    // 버킷 0(지남: HIGH 마감 순 → LOW) → 1(오늘) → 2(이번 주) → 3(예정) → 4(마감 없음) → 5(닫힘: HIGH → LOW).
    assertThat(ids)
        .containsExactly(
            overHighEarly, overHighLate, overLow, today, week, later, noDue, done, canceled);
  }

  @Test
  void statusModeOrdersStatusThenPriority() {
    long canceled = seed("canceled", "HIGH", null, "CANCELED");
    long doneLow = seed("done-low", "LOW", null, "DONE");
    long progress = seed("progress", "LOW", null, "IN_PROGRESS");
    long todoLow = seed("todo-low", "LOW", date(10, 1), null);
    long todoHighDue = seed("todo-high-due", "HIGH", date(10, 2), null);
    // 마감 없음은 같은 우선순위 안에서 마감 있는 행보다 앞 — 클라이언트 sortByPriorityThenDue 와 같다.
    long todoHighNoDue = seed("todo-high-nodue", "HIGH", null, null);
    long doneHigh = seed("done-high", "HIGH", null, "DONE");

    assertThat(ids(page(mode("status"), 100, null)))
        .containsExactly(
            todoHighNoDue, todoHighDue, todoLow, progress, doneHigh, doneLow, canceled);
  }

  @Test
  void priorityModePutsCanceledLast() {
    long canceledHigh = seed("canceled-high", "HIGH", null, "CANCELED");
    long low = seed("low", "LOW", null, null);
    long doneMid = seed("done-mid", "MID", null, "DONE");
    long high = seed("high", "HIGH", date(10, 1), null);
    long canceledLow = seed("canceled-low", "LOW", null, "CANCELED");

    // 취소가 아닌 행(완료 포함)은 우선순위 순, 취소는 맨 뒤에서 다시 우선순위 순.
    assertThat(ids(page(mode("priority"), 100, null)))
        .containsExactly(high, doneMid, low, canceledHigh, canceledLow);
  }

  @Test
  void checklistPagesWithoutGapOrDuplicate() {
    // 같은 버킷·우선순위·마감 동률 행을 여럿 두어 id 동률 깨기와 센티널(마감 없음)이 페이지 경계에 걸리게 한다.
    seed("o1", "HIGH", date(10, 1), null);
    seed("o2", "HIGH", date(10, 1), null);
    seed("o3", "HIGH", date(10, 1), null);
    seed("t1", "MID", date(10, 24), null);
    seed("t2", "MID", date(10, 24), null);
    seed("n1", "LOW", null, null);
    seed("n2", "LOW", null, null);
    seed("n3", "HIGH", null, null);
    seed("d1", "LOW", null, "DONE");
    seed("d2", "LOW", null, "DONE");
    seed("c1", "MID", date(9, 1), "CANCELED");

    for (Map<String, String> base : List.of(due(), mode("status"), mode("priority"))) {
      List<Long> all = ids(page(base, 100, null));
      assertThat(all).hasSize(11);
      List<Long> paged = pageThrough(base, 2);
      assertThat(paged).as(base.toString()).containsExactlyElementsOf(all);
      assertThat(new HashSet<>(paged)).hasSize(paged.size());
    }
  }

  @Test
  void checklistOrderMatchesClientBucketOrder() {
    seed("later", "HIGH", date(11, 1), null);
    seed("over", "LOW", date(10, 1), null);
    seed("nodue", "HIGH", null, null);
    seed("today", "HIGH", date(10, 24), null);
    seed("week", "LOW", date(10, 25), null);
    seed("done", "HIGH", null, "DONE");

    IssueSearchResponse first = page(due(), 3, null);
    assertThat(first.items()).hasSize(3);
    int lastK1 = ChecklistCursor.decode(first.nextCursor()).k1();
    IssueSearchResponse second = page(due(), 100, first.nextCursor());
    assertThat(second.items()).isNotEmpty();
    // 둘째 페이지 모든 행의 버킷은 첫 페이지 마지막 행 버킷 이상 — 클라이언트가 이어 붙여도 섹션이 되돌아가지 않는다.
    for (IssueResponse it : second.items()) {
      assertThat(bucket(it)).isGreaterThanOrEqualTo(lastK1);
    }
  }

  @Test
  void dueModeRequiresTodayAndWeekEnd() throws Exception {
    Map<String, String> noToday = new HashMap<>(Map.of("order", "checklist", "mode", "due"));
    noToday.put("weekEnd", WEEK_END);
    assertThatThrownBy(() -> issueSearchService.search(me, p.key(), noToday))
        .isInstanceOf(InvalidIssueFilterException.class);
    // HTTP 로는 400.
    String url =
        "/api/v1/projects/" + p.key() + "/issues?order=checklist&mode=due&weekEnd=" + WEEK_END;
    assertThat(status(url)).isEqualTo(400);
    assertThat(status(url + "&today=2026-13-01")).isEqualTo(400);
    assertThat(status("/api/v1/projects/" + p.key() + "/issues?order=checklist&mode=nope"))
        .isEqualTo(400);
    assertThat(status("/api/v1/projects/" + p.key() + "/issues?order=nope")).isEqualTo(400);
    // 이번 주 끝이 오늘보다 앞서면 거꾸로 된 경계라 400.
    assertThat(status(url + "&today=2026-10-26")).isEqualTo(400);
  }

  @Test
  void sundayTodayEqualsWeekEndLeavesThisWeekEmpty() {
    // 일요일 — 오늘이 곧 이번 주 마지막 날. 내일 마감은 「이번 주」가 아니라 「예정」으로, 오늘 마감은 「오늘」로 간다.
    long tomorrow = seed("tomorrow", "HIGH", date(10, 26), null);
    long noDue = seed("nodue", "HIGH", null, null);
    long today = seed("today", "LOW", date(10, 25), null);
    long over = seed("over", "LOW", date(10, 24), null);
    Map<String, String> sunday =
        Map.of("order", "checklist", "mode", "due", "today", "2026-10-25", "weekEnd", "2026-10-25");

    assertThat(ids(page(sunday, 100, null))).containsExactly(over, today, tomorrow, noDue);
    // 페이지 경계마다 끊어 받아도 같은 순서 — 빈 「이번 주」 버킷을 건너뛰어도 커서가 이어진다.
    assertThat(pageThrough(sunday, 1)).containsExactly(over, today, tomorrow, noDue);
  }

  @Test
  void defaultOrderUnchangedWithoutOrderParam() {
    long a = fx.issue(p, "a", me, me, date(10, 1), null, T0.plusSeconds(60));
    long b = fx.issue(p, "b", me, me, null, null, T0.plusSeconds(180));
    long c = fx.issue(p, "c", me, me, null, null, T0.plusSeconds(120));

    IssueSearchResponse all = issueSearchService.search(me, p.key(), Map.of("size", "100"));
    assertThat(ids(all)).containsExactly(b, c, a);

    IssueSearchResponse first = issueSearchService.search(me, p.key(), Map.of("size", "2"));
    assertThat(IssueCursor.decode(first.nextCursor()).id()).isEqualTo(c);
    IssueSearchResponse second =
        issueSearchService.search(me, p.key(), Map.of("size", "2", "cursor", first.nextCursor()));
    assertThat(ids(second)).containsExactly(a);
  }

  @Test
  void checklistCursorRoundTripsAndRejectsOtherFormats() {
    ChecklistCursor c = new ChecklistCursor(2, 1, LocalDate.of(1, 1, 1), 42L);
    assertThat(ChecklistCursor.decode(c.encode())).isEqualTo(c);
    assertThatThrownBy(() -> ChecklistCursor.decode(IssueCursor.encode(T0, 1L)))
        .isInstanceOf(InvalidCursorException.class);
    // 기존 커서를 체크리스트 정렬에 보내면 400.
    seed("x", "LOW", null, null);
    assertThatThrownBy(() -> page(due(), 1, IssueCursor.encode(T0, 1L)))
        .isInstanceOf(InvalidCursorException.class);
  }

  // ---------------------------------------------------------------- 헬퍼

  private static LocalDate date(int month, int day) {
    return LocalDate.of(2026, month, day);
  }

  /** 우선순위·마감·상태를 정한 이슈 — 수정 시각은 모두 같게 두어 정렬이 updated_at 에 기대지 않음을 보인다. */
  private long seed(String title, String priority, LocalDate due, String status) {
    long id = fx.issue(p, title, me, me, due, status, T0);
    dsl.update(ISSUE).set(ISSUE.PRIORITY, priority).where(ISSUE.ID.eq(id)).execute();
    return id;
  }

  private static Map<String, String> mode(String mode) {
    return Map.of("order", "checklist", "mode", mode);
  }

  private static Map<String, String> due() {
    return Map.of("order", "checklist", "mode", "due", "today", TODAY, "weekEnd", WEEK_END);
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

  /** 응답 항목의 마감 버킷 — 서버 k1 과 같은 규칙(테스트 기준 today·weekEnd). */
  private static int bucket(IssueResponse it) {
    if ("DONE".equals(it.status()) || "CANCELED".equals(it.status())) return 5;
    LocalDate d = it.dueDate();
    if (d == null) return 4;
    LocalDate today = LocalDate.parse(TODAY);
    if (d.isBefore(today)) return 0;
    if (d.equals(today)) return 1;
    if (!d.isAfter(LocalDate.parse(WEEK_END))) return 2;
    return 3;
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
