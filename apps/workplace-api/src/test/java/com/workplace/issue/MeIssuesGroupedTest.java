package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.MeIssuesTestFixtures.ProjectRef;
import com.workplace.issue.dto.IssueCursor;
import com.workplace.support.IntegrationTestBase;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-915: /me/issues 프로젝트 묶음 정렬(opt-in, group=due|recent). 한 프로젝트의 행이 페이지를 넘어서도 이어지고, 묶음 순서·묶음 안
 * 순서·hideClosed·묶음 건수(projectGroup.size)·복합 커서 순회를 실 JWT + MockMvc 로 검증한다. group 이 없으면 기존
 * (updated_at, id) 정렬과 IssueCursor 형식이 그대로인지도 함께 본다. 시드는 테스트 트랜잭션 안에서 하고 롤백한다.
 */
@Transactional
class MeIssuesGroupedTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired MeIssuesTestFixtures fx;

  /** 호출자 — 테스트마다 새로 만들어 다른 테스트의 시드가 섞이지 않게 한다. */
  private long me;

  /** 수정 시각 기준점 — 정렬 검증용 시각은 여기서 분 단위로 더한다. */
  private static final Instant T0 = Instant.parse("2026-10-01T00:00:00Z");

  private static final String DUE = "/api/v1/me/issues?assignee=me&group=due";

  @BeforeEach
  void seedCaller() {
    me = fx.loginUser("g");
  }

  // ---------------------------------------------------------------- DUE

  @Test
  void dueGroupingOrdersProjectsByEarliestOpenDue() throws Exception {
    ProjectRef a = fx.project(me, "A");
    ProjectRef b = fx.project(me, "B");
    ProjectRef c = fx.project(me, "C");
    open(a, "a-open", date(10, 20), t(1));
    // 닫힌 이슈의 마감은 묶음 자리에 쓰지 않는다 — A 가 B 보다 앞서면 안 된다.
    fx.issue(a, "a-done", me, me, date(9, 1), "DONE", t(2));
    open(b, "b-open", date(10, 5), t(3));
    open(c, "c-open", null, t(4));

    JsonNode body = getJson(DUE + "&size=100");
    assertThat(groupKeys(body)).containsExactly(b.key(), a.key(), c.key());
  }

  @Test
  void dueGroupingOrdersRowsOpenFirstThenDueThenUpdated() throws Exception {
    ProjectRef p = fx.project(me, "P");
    long due3 = open(p, "due-10-03", date(10, 3), t(1));
    long due1 = open(p, "due-10-01", date(10, 1), t(2));
    long noDueNew = open(p, "nodue-new", null, t(5));
    long noDueOld = open(p, "nodue-old", null, t(3));
    long done = fx.issue(p, "done", me, me, date(9, 1), "DONE", t(9));

    JsonNode body = getJson(DUE + "&hideClosed=false&size=100");
    assertThat(ids(body)).containsExactly(due1, due3, noDueNew, noDueOld, done);
  }

  @Test
  void dueGroupingHidesClosedWhenRequested() throws Exception {
    ProjectRef p = fx.project(me, "P");
    long o1 = open(p, "o1", date(10, 1), t(1));
    long o2 = open(p, "o2", null, t(2));
    fx.issue(p, "done", me, me, date(10, 2), "DONE", t(3));
    fx.issue(p, "canceled", me, me, null, "CANCELED", t(4));

    JsonNode hidden = getJson(DUE + "&hideClosed=true&size=100");
    assertThat(ids(hidden)).containsExactly(o1, o2);
    hidden.get("items").forEach(it -> assertThat(it.at("/projectGroup/size").asInt()).isEqualTo(2));

    JsonNode shown = getJson(DUE + "&size=100");
    assertThat(ids(shown)).hasSize(4);
    shown.get("items").forEach(it -> assertThat(it.at("/projectGroup/size").asInt()).isEqualTo(4));
    assertThat(shown.at("/items/0/projectGroup/name").asText()).isEqualTo("P");
  }

  @Test
  void projectWithOnlyClosedGoesLast() throws Exception {
    // D 를 먼저 만들어 project_id 가 더 작다 — id 동률 깨기만으로는 D 가 마지막이 될 수 없게.
    ProjectRef d = fx.project(me, "D");
    fx.issue(d, "d-done", me, me, date(9, 1), "DONE", t(9));
    ProjectRef a = fx.project(me, "A");
    open(a, "a-open", date(10, 10), t(1));
    // C 는 열린 이슈가 있으나 모두 마감 없음 — D(완료만)보다 id 가 크지만 D 보다 앞서야 한다.
    ProjectRef c = fx.project(me, "C");
    open(c, "c-open", null, t(2));

    JsonNode body = getJson(DUE + "&hideClosed=false&size=100");
    assertThat(groupKeys(body)).containsExactly(a.key(), c.key(), d.key());
    // 페이지 경계가 C→D 사이에 걸려도(묶음 마감 9999-12-30 이 커서로 왕복) 누락·중복이 없다.
    assertThat(pageThrough(DUE + "&hideClosed=false", 1)).containsExactlyElementsOf(ids(body));
  }

  // ---------------------------------------------------------------- RECENT

  @Test
  void recentGroupingOrdersProjectsByLatestUpdate() throws Exception {
    ProjectRef x = fx.project(me, "X");
    ProjectRef y = fx.project(me, "Y");
    ProjectRef z = fx.project(me, "Z");
    long x1 = fx.issue(x, "x1", me, null, null, null, t(1));
    long x5 = fx.issue(x, "x5", me, null, null, null, t(5));
    // RECENT 는 hideClosed 를 무시한다 — 닫힌 이슈도 그대로 나온다.
    long y3 = fx.issue(y, "y3", me, null, date(10, 1), "DONE", t(3));
    long z4 = fx.issue(z, "z4", me, null, null, null, t(4));
    long z2 = fx.issue(z, "z2", me, null, null, null, t(2));

    JsonNode body = getJson("/api/v1/me/issues?reporter=me&group=recent&hideClosed=true&size=100");
    assertThat(groupKeys(body)).containsExactly(x.key(), z.key(), y.key());
    assertThat(ids(body)).containsExactly(x5, x1, z4, z2, y3);
  }

  // ---------------------------------------------------------------- 커서

  @Test
  void dueGroupingPagesAcrossNullDueWithoutGapOrDuplicate() throws Exception {
    ProjectRef a = fx.project(me, "A");
    ProjectRef b = fx.project(me, "B");
    ProjectRef c = fx.project(me, "C");
    // 마감 없음·같은 수정 시각 행을 섞어 센티널·id 동률 깨기가 페이지 경계에 걸리게 한다.
    open(a, "a1", date(10, 2), t(1));
    open(a, "a2", null, t(3));
    open(a, "a3", null, t(3));
    fx.issue(a, "a-done", me, me, null, "DONE", t(3));
    open(b, "b1", date(10, 1), t(2));
    open(b, "b2", date(10, 1), t(2));
    open(b, "b3", null, t(2));
    open(c, "c1", null, t(4));
    open(c, "c2", null, t(4));
    fx.issue(c, "c-cancel", me, me, date(9, 1), "CANCELED", t(1));

    List<Long> all = ids(getJson(DUE + "&size=100"));
    assertThat(all).hasSize(10);
    List<Long> paged = pageThrough(DUE, 2);
    assertThat(paged).containsExactlyElementsOf(all);
    assertThat(new HashSet<>(paged)).hasSize(paged.size());

    // RECENT 도 같은 순회 성질을 가진다.
    String recent = "/api/v1/me/issues?assignee=me&group=recent";
    assertThat(pageThrough(recent, 3))
        .containsExactlyElementsOf(ids(getJson(recent + "&size=100")));
  }

  @Test
  void projectGroupSizeIsSameOnEveryPage() throws Exception {
    ProjectRef p = fx.project(me, "P");
    open(p, "p1", date(10, 1), t(1));
    open(p, "p2", date(10, 2), t(2));
    open(p, "p3", date(10, 3), t(3));
    ProjectRef q = fx.project(me, "Q");
    open(q, "q1", date(11, 1), t(4));

    JsonNode first = getJson(DUE + "&size=2");
    assertThat(first.get("items")).hasSize(2);
    assertThat(first.at("/items/1/projectKey").asText()).isEqualTo(p.key());
    assertThat(first.at("/items/1/projectGroup/size").asInt()).isEqualTo(3);
    JsonNode second = getJson(DUE + "&size=2&cursor=" + first.get("nextCursor").asText());
    assertThat(second.at("/items/0/projectKey").asText()).isEqualTo(p.key());
    assertThat(second.at("/items/0/projectGroup/size").asInt()).isEqualTo(3);
    assertThat(second.at("/items/1/projectGroup/size").asInt()).isEqualTo(1);
  }

  // ---------------------------------------------------------------- 기본 경로·오류

  @Test
  void defaultOrderUnchangedWithoutGroupParam() throws Exception {
    ProjectRef a = fx.project(me, "A");
    ProjectRef b = fx.project(me, "B");
    long a1 = open(a, "a1", date(10, 1), t(1));
    long b1 = open(b, "b1", null, t(3));
    long a2 = open(a, "a2", null, t(2));

    JsonNode all = getJson("/api/v1/me/issues?assignee=me&size=100");
    assertThat(ids(all)).containsExactly(b1, a2, a1);
    assertThat(all.at("/items/0/projectGroup").isMissingNode()).isTrue();

    JsonNode first = getJson("/api/v1/me/issues?assignee=me&size=2");
    String next = first.get("nextCursor").asText();
    assertThat(IssueCursor.decode(next).id()).isEqualTo(a2);
  }

  @Test
  void groupedCursorRejectsLegacyCursor() throws Exception {
    ProjectRef p = fx.project(me, "P");
    open(p, "p1", null, t(1));
    String legacy = IssueCursor.encode(t(1), 1L);
    assertThat(status(DUE + "&cursor=" + legacy)).isEqualTo(400);
    // 다른 묶음 기준의 커서도 400 — RECENT 커서를 DUE 에 보내면 묶음 키가 비어 있다.
    open(p, "p2", null, t(2));
    JsonNode recent = getJson("/api/v1/me/issues?assignee=me&group=recent&size=1");
    assertThat(status(DUE + "&cursor=" + recent.get("nextCursor").asText())).isEqualTo(400);
  }

  @Test
  void unknownGroupIsBadRequest() throws Exception {
    assertThat(status("/api/v1/me/issues?assignee=me&group=nope")).isEqualTo(400);
  }

  // ---------------------------------------------------------------- 헬퍼

  private static Instant t(int minutes) {
    return T0.plusSeconds(60L * minutes);
  }

  private static LocalDate date(int month, int day) {
    return LocalDate.of(2026, month, day);
  }

  /** 호출자가 담당·보고자인 열린 이슈. */
  private long open(ProjectRef p, String title, LocalDate due, Instant updatedAt) {
    return fx.issue(p, title, me, me, due, null, updatedAt);
  }

  /** size 단위로 nextCursor 를 끝까지 따라가 모은 id — 끝나지 않으면 실패, 마지막 페이지는 커서가 없어야 한다. */
  private List<Long> pageThrough(String base, int size) throws Exception {
    List<Long> out = new ArrayList<>();
    String cursor = null;
    for (int guard = 0; guard < 50; guard++) {
      JsonNode page = getJson(base + "&size=" + size + (cursor == null ? "" : "&cursor=" + cursor));
      out.addAll(ids(page));
      JsonNode next = page.get("nextCursor");
      if (next == null || next.isNull()) return out;
      cursor = next.asText();
    }
    throw new AssertionError("커서 순회가 끝나지 않았다");
  }

  private MockHttpServletResponse perform(String url) throws Exception {
    return mvc.perform(
            get(url)
                .header(
                    "Authorization",
                    "Bearer " + jwtTokenProvider.generateAccessToken(me, "user-" + me)))
        .andReturn()
        .getResponse();
  }

  private int status(String url) throws Exception {
    return perform(url).getStatus();
  }

  private JsonNode getJson(String url) throws Exception {
    var res = perform(url);
    String body = res.getContentAsString(StandardCharsets.UTF_8);
    assertThat(res.getStatus()).as(body).isEqualTo(200);
    return om.readTree(body);
  }

  private static List<Long> ids(JsonNode page) {
    List<Long> out = new ArrayList<>();
    page.get("items").forEach(it -> out.add(it.get("id").asLong()));
    return out;
  }

  /** 행 순서대로 프로젝트 키가 바뀌는 자리만 모은 묶음 순서 — 같은 키가 다시 나오면(묶음이 끊김) 그대로 드러난다. */
  private static List<String> groupKeys(JsonNode page) {
    List<String> out = new ArrayList<>();
    page.get("items")
        .forEach(
            it -> {
              String k = it.get("projectKey").asText();
              if (out.isEmpty() || !out.get(out.size() - 1).equals(k)) out.add(k);
            });
    return out;
  }
}
