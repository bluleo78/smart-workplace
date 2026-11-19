package com.workplace.wiki;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE_STAR;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.repository.WikiPageStarRepository;
import com.workplace.wiki.service.WikiPageReadAccess;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import com.workplace.wiki.service.WikiStarService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 노트 페이지 즐겨찾기 API(WP-1765) 통합 테스트 — PUT/DELETE /pages/{id}/star 의 멱등·권한, GET /wiki/starred 의
 * 정렬·거르기·쪽 나누기와 GET /wiki/starred/ids. 즐겨찾기 행은 요청마다 커밋되므로 {@code @Transactional} 없이 {@link
 * #cleanup} 에서 지운다.
 */
class WikiStarIntegrationTest extends IntegrationTestBase {
  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ObjectMapper objectMapper;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiStarService starService;

  private final List<Long> userIds = new ArrayList<>();
  private long u1;
  private long spaceA;

  @BeforeEach
  void seed() {
    u1 = newUser();
    spaceA = newSpace(u1, "에이");
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.OWNER_ID.in(userIds)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
        });
    userIds.clear();
  }

  private long newUser() {
    return callInTenant(
        1L,
        () -> {
          long id = withMembership(TestFixtures.createHuman(dsl));
          userIds.add(id);
          return id;
        });
  }

  private long newSpace(long owner, String name) {
    return callInTenant(
        1L,
        () ->
            spaceService
                .createTeamSpace(owner, name + UUID.randomUUID().toString().substring(0, 6))
                .id());
  }

  private long newPage(long owner, long space, Long parentId, String title) {
    return callInTenant(
        1L, () -> pageService.create(owner, space, new CreatePageRequest(parentId, title)).id());
  }

  private void addMember(long space, long user) {
    callInTenant(
        1L,
        () -> {
          spaceService.addMember(u1, space, user, "EDITOR");
          return null;
        });
  }

  private void removeMember(long space, long user) {
    callInTenant(
        1L,
        () -> {
          spaceService.removeMember(u1, space, user);
          return null;
        });
  }

  private String bearer(long userId) {
    return "Bearer " + jwt.generateAccessToken(userId, "user-" + userId, 1L);
  }

  private void star(long userId, long pageId) throws Exception {
    mvc.perform(
            put("/api/v1/wiki/pages/" + pageId + "/star").header("Authorization", bearer(userId)))
        .andExpect(status().isNoContent());
  }

  private void unstar(long userId, long pageId) throws Exception {
    mvc.perform(
            delete("/api/v1/wiki/pages/" + pageId + "/star")
                .header("Authorization", bearer(userId)))
        .andExpect(status().isNoContent());
  }

  private JsonNode starred(long userId, String query) throws Exception {
    String json =
        mvc.perform(get("/api/v1/wiki/starred" + query).header("Authorization", bearer(userId)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return objectMapper.readTree(json);
  }

  private JsonNode ids(long userId) throws Exception {
    String json =
        mvc.perform(get("/api/v1/wiki/starred/ids").header("Authorization", bearer(userId)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return objectMapper.readTree(json).get("pageIds");
  }

  private long countRows() {
    return callInTenant(1L, () -> (long) dsl.fetchCount(WIKI_PAGE_STAR));
  }

  @Test
  void starThenListShowsPageNewestFirst() throws Exception {
    long parent = newPage(u1, spaceA, null, "부모");
    long p1 = newPage(u1, spaceA, null, "첫째");
    long p2 = newPage(u1, spaceA, parent, "둘째");
    star(u1, p1);
    star(u1, p2);

    JsonNode items = starred(u1, "").get("items");
    assertThat(items).hasSize(2);
    assertThat(items.get(0).get("pageId").asLong()).isEqualTo(p2);
    assertThat(items.get(1).get("pageId").asLong()).isEqualTo(p1);
    assertThat(items.get(0).get("title").asString()).isEqualTo("둘째");
    assertThat(items.get(0).get("spaceName").asString()).startsWith("에이");
    assertThat(items.get(0).get("ancestorTitles")).hasSize(1);
    assertThat(items.get(0).get("ancestorTitles").get(0).asString()).isEqualTo("부모");
    assertThat(items.get(0).get("starredAt").asString()).isNotBlank();
    assertThat(items.get(0).get("url").asString())
        .endsWith("/wiki/spaces/" + spaceA + "/pages/" + p2);
    assertThat(items.get(1).get("ancestorTitles")).isEmpty();
  }

  @Test
  void starTwiceIsIdempotent() throws Exception {
    long p1 = newPage(u1, spaceA, null, "하나");
    star(u1, p1);
    star(u1, p1);
    assertThat(starred(u1, "").get("items")).hasSize(1);
    assertThat(countRows()).isEqualTo(1);
  }

  @Test
  void unstarRemovesAndMissingIs204() throws Exception {
    long p1 = newPage(u1, spaceA, null, "하나");
    star(u1, p1);
    unstar(u1, p1);
    assertThat(starred(u1, "").get("items")).isEmpty();
    unstar(u1, p1);
  }

  @Test
  void otherUserSeesNothing() throws Exception {
    long u2 = newUser();
    addMember(spaceA, u2);
    long p1 = newPage(u1, spaceA, null, "내것");
    star(u1, p1);
    assertThat(starred(u2, "").get("items")).isEmpty();
    assertThat(ids(u2)).isEmpty();
    // u2 의 빼기는 u1 의 행을 건드리지 않는다.
    unstar(u2, p1);
    assertThat(starred(u1, "").get("items")).hasSize(1);
  }

  @Test
  void starUnreadablePageIs404LikeMissing() throws Exception {
    long u3 = newUser();
    long p1 = newPage(u1, spaceA, null, "비공개");
    mvc.perform(put("/api/v1/wiki/pages/" + p1 + "/star").header("Authorization", bearer(u3)))
        .andExpect(status().isNotFound());
    mvc.perform(
            put("/api/v1/wiki/pages/" + Long.MAX_VALUE + "/star")
                .header("Authorization", bearer(u1)))
        .andExpect(status().isNotFound());
    assertThat(countRows()).isZero();
  }

  @Test
  void leftSpaceHidesThenReturns() throws Exception {
    long u2 = newUser();
    addMember(spaceA, u2);
    long p1 = newPage(u1, spaceA, null, "공유");
    star(u2, p1);
    assertThat(starred(u2, "").get("items")).hasSize(1);

    removeMember(spaceA, u2);
    assertThat(starred(u2, "").get("items")).isEmpty();
    assertThat(ids(u2)).hasSize(1);

    addMember(spaceA, u2);
    assertThat(starred(u2, "").get("items")).hasSize(1);
  }

  @Test
  void deletedPageCascades() throws Exception {
    long p1 = newPage(u1, spaceA, null, "지울것");
    star(u1, p1);
    mvc.perform(delete("/api/v1/wiki/pages/" + p1).header("Authorization", bearer(u1)))
        .andExpect(status().isNoContent());
    assertThat(starred(u1, "").get("items")).isEmpty();
    assertThat(countRows()).isZero();
  }

  @Test
  void listFillsPageAfterFiltering() throws Exception {
    long u2 = newUser();
    long spaceB = newSpace(u1, "비");
    addMember(spaceA, u2);
    addMember(spaceB, u2);
    long a1 = newPage(u1, spaceA, null, "a1");
    long b1 = newPage(u1, spaceB, null, "b1");
    long b2 = newPage(u1, spaceB, null, "b2");
    long a2 = newPage(u1, spaceA, null, "a2");
    long a3 = newPage(u1, spaceA, null, "a3");
    // 최신순: a3, a2, b2, b1, a1 — B 공간 페이지(b2, b1)는 나중에 거른다.
    star(u2, a1);
    star(u2, b1);
    star(u2, b2);
    star(u2, a2);
    star(u2, a3);
    removeMember(spaceB, u2);

    JsonNode first = starred(u2, "?limit=2");
    assertThat(first.get("items")).hasSize(2);
    assertThat(first.get("items").get(0).get("pageId").asLong()).isEqualTo(a3);
    assertThat(first.get("items").get(1).get("pageId").asLong()).isEqualTo(a2);
    assertThat(first.get("nextCursor").isNull()).isFalse();

    JsonNode second = starred(u2, "?limit=2&cursor=" + first.get("nextCursor").asString());
    assertThat(second.get("items")).hasSize(1);
    assertThat(second.get("items").get(0).get("pageId").asLong()).isEqualTo(a1);
    assertThat(second.get("nextCursor").isNull()).isTrue();
  }

  @Test
  void brokenCursorIs400() throws Exception {
    mvc.perform(get("/api/v1/wiki/starred?cursor=%%%").header("Authorization", bearer(u1)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void boundedScanReturnsCursorAndContinuationReachesReadableStar() throws Exception {
    long u2 = newUser();
    long spaceB = newSpace(u1, "비");
    addMember(spaceA, u2);
    addMember(spaceB, u2);
    long readable = newPage(u1, spaceA, null, "읽힘");
    star(u2, readable); // 가장 오래된 즐겨찾기
    for (int i = 0; i < 5; i++) {
      star(u2, newPage(u1, spaceB, null, "b" + i));
    }
    removeMember(spaceB, u2); // 최신 5줄은 읽을 수 없다.

    // 묶음 2줄·상한 2묶음 — 읽을 수 없는 4줄만 훑고 멈춰야 한다.
    var first = callInTenant(1L, () -> starService.list(u2, null, null, 2, 2));
    assertThat(first.items()).isEmpty();
    assertThat(first.nextCursor()).isNotNull();

    // 커서로 이어 가면 남은 1줄을 훑고 읽을 수 있는 줄에 닿는다.
    var second = callInTenant(1L, () -> starService.list(u2, first.nextCursor(), null, 2, 2));
    assertThat(second.items()).hasSize(1);
    assertThat(second.items().get(0).pageId()).isEqualTo(readable);
    assertThat(second.nextCursor()).isNull();
  }

  @Test
  void starMapsForeignKeyViolationToNotFound() {
    // 읽기 확인 뒤 노트가 지워진 경합을 흉내 낸다 — 넣기가 FK 위반이면 404 예외여야 한다.
    WikiPageStarRepository failing = Mockito.mock(WikiPageStarRepository.class);
    Mockito.doThrow(new DataIntegrityViolationException("fk"))
        .when(failing)
        .star(anyLong(), anyLong());
    WikiStarService service =
        new WikiStarService(failing, Mockito.mock(WikiPageReadAccess.class), null, null);
    assertThatThrownBy(() -> service.star(1L, 2L)).isInstanceOf(WikiPageNotFoundException.class);
  }
}
