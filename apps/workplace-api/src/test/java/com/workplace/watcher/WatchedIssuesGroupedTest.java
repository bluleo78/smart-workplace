package com.workplace.watcher;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.MeIssuesTestFixtures;
import com.workplace.issue.MeIssuesTestFixtures.ProjectRef;
import com.workplace.issue.dto.IssueCursor;
import com.workplace.issue.dto.MeGroupedCursor;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.watcher.repository.IssueWatcherRepository;
import com.workplace.watcher.service.WatcherService;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-915: /me/watched-issues — 목록 조립을 IssueSearchService 공용 조립(assembleItems)에 맡겨 담당자·유형이 실리고 행마다
 * 프로젝트를 다시 조회하지 않는지(N+1), opt-in 묶음 정렬(group=recent)의 묶음 순서·건수·커서 순회, 그리고 가시성 규칙(OPEN 비멤버 노출
 * WP-631, 멤버에서 빠진 TEAM 숨김)이 group 유무와 관계없이 같은지 검증한다. 시드는 테스트 트랜잭션 안에서 하고 롤백한다.
 *
 * <p>ProjectRepository 를 스파이로 감싸 행마다 findById 를 부르지 않는 것을 호출 횟수로 증명한다.
 */
@Transactional
class WatchedIssuesGroupedTest extends IntegrationTestBase {

  private static final String URL = "/api/v1/me/watched-issues";
  private static final Instant T0 = Instant.parse("2026-10-01T00:00:00Z");

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired MeIssuesTestFixtures fx;
  @Autowired IssueWatcherRepository watcherRepository;
  @Autowired WatcherService watcherService;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository memberRepository;
  @MockitoSpyBean ProjectRepository projectRepository;

  /** 호출자 — 테스트마다 새로 만들어 다른 테스트의 시드가 섞이지 않게 한다. */
  private long me;

  @BeforeEach
  void seedCaller() {
    me = fx.loginUser("w");
  }

  @Test
  void watchedDefaultReturnsAssigneesAndType() throws Exception {
    ProjectRef p = fx.project(me, "P");
    long id = watched(p, "a", me, t(1));

    JsonNode item = getJson(URL + "?size=30").at("/items/0");
    assertThat(item.get("id").asLong()).isEqualTo(id);
    assertThat(item.at("/assignees/0/id").asLong()).isEqualTo(me);
    assertThat(item.at("/type/name").asText()).isNotBlank();
    // 기본 경로는 묶음 정보를 싣지 않는다.
    assertThat(item.at("/projectGroup").isMissingNode()).isTrue();
  }

  @Test
  void watchedDoesNotQueryProjectPerRow() {
    List<ProjectRef> ps = List.of(fx.project(me, "A"), fx.project(me, "B"), fx.project(me, "C"));
    for (int i = 0; i < 10; i++) watched(ps.get(i % 3), "i" + i, null, t(i));
    clearInvocations(projectRepository);

    var page = watcherService.watchedIssues(me, null, 30, null);

    assertThat(page.items()).hasSize(10);
    assertThat(page.items()).allSatisfy(i -> assertThat(i.projectKey()).isNotBlank());
    verify(projectRepository, never()).findById(any());
    // 키는 한 번에 해석한다.
    verify(projectRepository, times(1)).keysByIds(anyList());

    clearInvocations(projectRepository);
    var grouped = watcherService.watchedIssues(me, null, 30, "recent");
    assertThat(grouped.items()).hasSize(10);
    verify(projectRepository, never()).findById(any());
    verify(projectRepository, times(1)).keysByIds(anyList());
  }

  @Test
  void watchedRecentGroupingOrdersByProjectLatestUpdate() throws Exception {
    ProjectRef x = fx.project(me, "X");
    ProjectRef y = fx.project(me, "Y");
    ProjectRef z = fx.project(me, "Z");
    long x1 = watched(x, "x1", null, t(1));
    long x5 = watched(x, "x5", null, t(5));
    long y3 = watched(y, "y3", null, t(3));
    long z4 = watched(z, "z4", null, t(4));
    long z2 = watched(z, "z2", null, t(2));
    // 구독하지 않은 이슈는 묶음 건수에도 들어가지 않는다.
    fx.issue(y, "y-unwatched", me, null, null, null, t(9));

    JsonNode body = getJson(URL + "?group=recent&size=100");
    assertThat(groupKeys(body)).containsExactly(x.key(), z.key(), y.key());
    assertThat(ids(body)).containsExactly(x5, x1, z4, z2, y3);
    assertThat(sizes(body)).containsExactly(2, 2, 2, 2, 1);
    assertThat(body.at("/items/0/projectGroup/name").asText()).isEqualTo("X");
  }

  @Test
  void watchedKeepsOpenProjectNonMemberVisibility() throws Exception {
    // WP-631 — 공개 접수함(OPEN)의 비멤버도 구독한 이슈를 group 유무 모두에서 본다.
    long owner = fx.loginUser("o");
    var open =
        projectService.create(
            owner,
            new CreateProjectRequest(
                "O" + UUID.randomUUID().toString().replace("-", "").substring(0, 5).toUpperCase(),
                "공개",
                "x",
                "OPEN"));
    ProjectRef p = new ProjectRef(open.id(), open.key());
    long id = fx.issue(p, "제보", me, null, null, null, t(1));
    watcherRepository.add(id, me);

    assertThat(ids(getJson(URL + "?size=30"))).containsExactly(id);
    assertThat(ids(getJson(URL + "?group=recent&size=30"))).containsExactly(id);
  }

  @Test
  void watchedHidesRemovedTeamMembership() throws Exception {
    long owner = fx.loginUser("o");
    ProjectRef team = fx.project(owner, "T");
    memberRepository.insert(team.id(), me, "MEMBER");
    long id = fx.issue(team, "t", owner, null, null, null, t(1));
    watcherRepository.add(id, me);
    ProjectRef mine = fx.project(me, "M");
    long kept = watched(mine, "m", null, t(2));

    assertThat(ids(getJson(URL + "?size=30"))).containsExactly(kept, id);

    memberRepository.delete(team.id(), me);
    assertThat(ids(getJson(URL + "?size=30"))).containsExactly(kept);
    assertThat(ids(getJson(URL + "?group=recent&size=30"))).containsExactly(kept);
  }

  @Test
  void watchedGroupedPagesWithoutGapOrDuplicate() throws Exception {
    ProjectRef a = fx.project(me, "A");
    ProjectRef b = fx.project(me, "B");
    ProjectRef c = fx.project(me, "C");
    // 같은 수정 시각을 섞어 id 동률 깨기가 페이지 경계에 걸리게 한다.
    watched(a, "a1", null, t(1));
    watched(a, "a2", null, t(3));
    watched(a, "a3", null, t(3));
    watched(b, "b1", null, t(2));
    watched(b, "b2", null, t(2));
    watched(c, "c1", null, t(4));
    watched(c, "c2", null, t(1));

    String grouped = URL + "?group=recent";
    List<Long> all = ids(getJson(grouped + "&size=100"));
    assertThat(all).hasSize(7);
    List<Long> paged = pageThrough(grouped, 2, true);
    assertThat(paged).containsExactlyElementsOf(all);
    assertThat(new HashSet<>(paged)).hasSize(paged.size());

    // 서비스 경유도 같은 순서로 이어진다.
    List<Long> viaService = new ArrayList<>();
    String cursor = null;
    for (int guard = 0; guard < 20; guard++) {
      var page = watcherService.watchedIssues(me, cursor, 3, "recent");
      page.items().forEach(i -> viaService.add(i.id()));
      if (!page.hasMore()) break;
      cursor = page.nextCursor();
    }
    assertThat(viaService).containsExactlyElementsOf(all);

    // 기본 경로는 예전 (updated_at, id) 커서 그대로.
    assertThat(pageThrough(URL, 2, false))
        .containsExactlyElementsOf(ids(getJson(URL + "?size=100")));
  }

  @Test
  void watchedRejectsUnsupportedGroupAndMismatchedCursor() throws Exception {
    ProjectRef p = fx.project(me, "P");
    watched(p, "p1", null, t(1));
    watched(p, "p2", null, t(2));
    // 구독 탭은 recent 만 — due 와 모르는 값은 400.
    assertThat(status(URL + "?group=due")).isEqualTo(400);
    assertThat(status(URL + "?group=nope")).isEqualTo(400);
    // 기본 커서를 묶음 경로에, 묶음 커서를 기본 경로에 보내면 400.
    String legacy = getJson(URL + "?size=1").get("nextCursor").asText();
    assertThat(status(URL + "?group=recent&cursor=" + legacy)).isEqualTo(400);
    String groupedCursor = getJson(URL + "?group=recent&size=1").get("nextCursor").asText();
    assertThat(status(URL + "?cursor=" + groupedCursor)).isEqualTo(400);
  }

  @Test
  void watchedEmptyReturnsNoItems() throws Exception {
    JsonNode body = getJson(URL + "?group=recent");
    assertThat(body.get("items")).isEmpty();
    assertThat(body.get("hasMore").asBoolean()).isFalse();
  }

  // ---------------------------------------------------------------- 헬퍼

  private static Instant t(int minutes) {
    return T0.plusSeconds(60L * minutes);
  }

  /** 호출자가 구독한 이슈 한 건(보고자=호출자). assignee 가 null 이면 담당자 없음. */
  private long watched(ProjectRef p, String title, Long assignee, Instant updatedAt) {
    long id = fx.issue(p, title, me, assignee, null, null, updatedAt);
    watcherRepository.add(id, me);
    return id;
  }

  /** size 단위로 nextCursor 를 끝까지 따라가 모은 id. 커서 형식(묶음/기본)도 함께 확인한다. */
  private List<Long> pageThrough(String base, int size, boolean grouped) throws Exception {
    List<Long> out = new ArrayList<>();
    String cursor = null;
    for (int guard = 0; guard < 50; guard++) {
      // base 에 쿼리가 이미 있으면 & 로, 없으면 ? 로 잇는다.
      String sep = base.contains("?") ? "&" : "?";
      JsonNode page =
          getJson(base + sep + "size=" + size + (cursor == null ? "" : "&cursor=" + cursor));
      out.addAll(ids(page));
      JsonNode next = page.get("nextCursor");
      if (next == null || next.isNull()) return out;
      cursor = next.asText();
      if (grouped) MeGroupedCursor.decode(cursor);
      else IssueCursor.decode(cursor);
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

  private static List<Integer> sizes(JsonNode page) {
    List<Integer> out = new ArrayList<>();
    page.get("items").forEach(it -> out.add(it.at("/projectGroup/size").asInt()));
    return out;
  }

  /** 행 순서대로 프로젝트 키가 바뀌는 자리만 모은 묶음 순서. */
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
