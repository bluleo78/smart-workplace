package com.workplace.wiki;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE_ACTIVITY;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.repository.WikiPageActivityRepository;
import com.workplace.wiki.service.WikiPageAction;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiShareAccess;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 노트 「최근」 API(WP-1764) 통합 테스트 — POST /pages/{id}/open · PUT 저장 · 동기화 서버 저장이 남기는 기록과 GET
 * /wiki/recent 의 정렬·거르기·쪽 나누기. 기록은 REQUIRES_NEW 로 따로 커밋되므로 {@code @Transactional} 을 달지 않고 {@link
 * #cleanup} 에서 지운다. 노트에는 휴지통이 없다(삭제는 CASCADE) — 「휴지통 빠짐·복원」 대신 삭제하면 목록에서 사라지는지 본다.
 */
class WikiRecentIntegrationTest extends IntegrationTestBase {
  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ObjectMapper objectMapper;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiPageActivityRepository activityRepository;

  private final List<Long> userIds = new ArrayList<>();
  private long u1;
  private long spaceA;
  private long spaceB;

  @BeforeEach
  void seed() {
    u1 = newUser();
    spaceA = newSpace(u1, "에이");
    spaceB = newSpace(u1, "비");
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

  private String bearer(long userId) {
    return "Bearer " + jwt.generateAccessToken(userId, "user-" + userId, 1L);
  }

  private void open(long userId, long pageId) throws Exception {
    mvc.perform(
            post("/api/v1/wiki/pages/" + pageId + "/open").header("Authorization", bearer(userId)))
        .andExpect(status().isNoContent());
  }

  private JsonNode recent(long userId, String query) throws Exception {
    String json =
        mvc.perform(get("/api/v1/wiki/recent" + query).header("Authorization", bearer(userId)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return objectMapper.readTree(json);
  }

  private void record(long userId, long pageId, WikiPageAction action) {
    callInTenant(
        1L,
        () -> {
          activityRepository.upsert(userId, pageId, action);
          return null;
        });
  }

  private void storeInternal(long pageId, String json) throws Exception {
    mvc.perform(
            put("/internal/wiki/pages/{id}/doc", pageId)
                .header("Authorization", "Internal test-token")
                .header("X-Tenant-Id", "1")
                .contentType(APPLICATION_JSON)
                .content(json))
        .andExpect(status().isOk());
  }

  private long countRows() {
    return callInTenant(1L, () -> (long) dsl.fetchCount(WIKI_PAGE_ACTIVITY));
  }

  @Test
  void openThenEditAppearNewestFirst() throws Exception {
    long p1 = newPage(u1, spaceA, null, "열었다");
    long parent = newPage(u1, spaceB, null, "부모");
    long p2 = newPage(u1, spaceB, parent, "고칠 것");
    open(u1, p1);
    mvc.perform(
            put("/api/v1/wiki/pages/" + p2)
                .header("Authorization", bearer(u1))
                .contentType(APPLICATION_JSON)
                .content("{\"title\":\"고쳤다\"}"))
        .andExpect(status().isOk());

    JsonNode items = recent(u1, "").get("items");
    assertThat(items).hasSize(2);
    assertThat(items.get(0).get("pageId").asLong()).isEqualTo(p2);
    assertThat(items.get(0).get("title").asString()).isEqualTo("고쳤다");
    assertThat(items.get(0).get("lastAction").asString()).isEqualTo("EDIT");
    assertThat(items.get(0).get("spaceName").asString()).startsWith("비");
    assertThat(items.get(0).get("ancestorTitles")).hasSize(1);
    assertThat(items.get(0).get("ancestorTitles").get(0).asString()).isEqualTo("부모");
    assertThat(items.get(0).get("url").asString())
        .endsWith("/wiki/spaces/" + spaceB + "/pages/" + p2);
    assertThat(items.get(1).get("pageId").asLong()).isEqualTo(p1);
    assertThat(items.get(1).get("lastAction").asString()).isEqualTo("OPEN");
    assertThat(items.get(1).get("spaceName").asString()).startsWith("에이");
    assertThat(items.get(1).get("ancestorTitles")).isEmpty();
  }

  @Test
  void reopenWithin60sKeepsOneRow() throws Exception {
    long p1 = newPage(u1, spaceA, null, "하나");
    open(u1, p1);
    JsonNode first = recent(u1, "").get("items");
    open(u1, p1);
    JsonNode second = recent(u1, "").get("items");
    assertThat(second).hasSize(1);
    assertThat(second.get(0).get("lastAt").asString())
        .isEqualTo(first.get(0).get("lastAt").asString());

    // EDIT 는 60초 안이라도 행동을 EDIT 로 바꾼다.
    mvc.perform(
            put("/api/v1/wiki/pages/" + p1)
                .header("Authorization", bearer(u1))
                .contentType(APPLICATION_JSON)
                .content("{\"title\":\"둘\"}"))
        .andExpect(status().isOk());
    JsonNode third = recent(u1, "").get("items");
    assertThat(third).hasSize(1);
    assertThat(third.get(0).get("lastAction").asString()).isEqualTo("EDIT");
  }

  @Test
  void otherUserSeesOnlyOwn() throws Exception {
    long p1 = newPage(u1, spaceA, null, "내것");
    open(u1, p1);
    long u2 = newUser();
    assertThat(recent(u2, "").get("items")).isEmpty();
    assertThat(recent(u1, "").get("items")).hasSize(1);
  }

  @Test
  void removedFromSpaceHidden() throws Exception {
    long u2 = newUser();
    callInTenant(
        1L,
        () -> {
          spaceService.addMember(u1, spaceA, u2, "EDITOR");
          return null;
        });
    long p1 = newPage(u1, spaceA, null, "공유");
    open(u2, p1);
    assertThat(recent(u2, "").get("items")).hasSize(1);

    callInTenant(
        1L,
        () -> {
          spaceService.removeMember(u1, spaceA, u2);
          return null;
        });
    assertThat(recent(u2, "").get("items")).isEmpty();

    callInTenant(
        1L,
        () -> {
          spaceService.addMember(u1, spaceA, u2, "EDITOR");
          return null;
        });
    assertThat(recent(u2, "").get("items")).hasSize(1);
  }

  /** 노트에는 휴지통이 없어 삭제가 곧 영구 삭제(CASCADE)다 — 삭제하면 기록도 목록에서 사라진다. */
  @Test
  void deletedPageDisappears() throws Exception {
    long p1 = newPage(u1, spaceA, null, "지울것");
    open(u1, p1);
    assertThat(recent(u1, "").get("items")).hasSize(1);
    mvc.perform(delete("/api/v1/wiki/pages/" + p1).header("Authorization", bearer(u1)))
        .andExpect(status().isNoContent());
    assertThat(recent(u1, "").get("items")).isEmpty();
  }

  @Test
  void openOfUnreadablePageIs404() throws Exception {
    long u2 = newUser();
    long p1 = newPage(u1, spaceA, null, "비공개");
    mvc.perform(post("/api/v1/wiki/pages/" + p1 + "/open").header("Authorization", bearer(u2)))
        .andExpect(status().isNotFound());
    assertThat(countRows()).isZero();
  }

  @Test
  void shareTokenOpenNotRecorded() throws Exception {
    long p1 = newPage(u1, spaceA, null, "공유창");
    mvc.perform(
            post("/api/v1/wiki/pages/" + p1 + "/open")
                .header("Authorization", bearer(u1))
                .header(WikiShareAccess.HEADER, "sometoken"))
        .andExpect(status().isNoContent());
    assertThat(recent(u1, "").get("items")).isEmpty();
  }

  /** 공유 토큰으로 고친 비멤버의 기록은 남기지 않는다 — 나중에 공간에 들어와도 그 기록이 드러나지 않아야 한다. */
  @Test
  void shareTokenEditNotRecorded() throws Exception {
    long p1 = newPage(u1, spaceA, null, "공유편집");
    long stranger = newUser();
    String token = "wsh_test" + UUID.randomUUID().toString().replace("-", "");
    callInTenant(
        1L,
        () ->
            dsl.insertInto(WIKI_PAGE_SHARE)
                .set(WIKI_PAGE_SHARE.PAGE_ID, p1)
                .set(WIKI_PAGE_SHARE.SPACE_ID, spaceA)
                .set(WIKI_PAGE_SHARE.TOKEN, token)
                .set(WIKI_PAGE_SHARE.AUDIENCE, "WORKSPACE")
                .set(WIKI_PAGE_SHARE.PERMISSION, "EDIT")
                .set(WIKI_PAGE_SHARE.INCLUDE_CHILDREN, false)
                .set(WIKI_PAGE_SHARE.CREATED_BY, u1)
                .execute());
    mvc.perform(
            put("/api/v1/wiki/pages/" + p1)
                .header("Authorization", bearer(stranger))
                .header(WikiShareAccess.HEADER, token)
                .contentType(APPLICATION_JSON)
                .content("{\"title\":\"토큰으로 고침\"}"))
        .andExpect(status().isOk());
    assertThat(countRows()).isZero();

    callInTenant(
        1L,
        () -> {
          spaceService.addMember(u1, spaceA, stranger, "EDITOR");
          return null;
        });
    assertThat(recent(stranger, "").get("items")).isEmpty();
  }

  /** 공유 토큰 헤더가 있어도 멤버가 고치면 기록한다 — 기록 여부는 헤더가 아니라 멤버 읽기 권한으로 정한다. */
  @Test
  void memberEditWithShareHeaderIsRecorded() throws Exception {
    long p1 = newPage(u1, spaceA, null, "멤버공유헤더");
    mvc.perform(
            put("/api/v1/wiki/pages/" + p1)
                .header("Authorization", bearer(u1))
                .header(WikiShareAccess.HEADER, "sometoken")
                .contentType(APPLICATION_JSON)
                .content("{\"title\":\"멤버가 고침\"}"))
        .andExpect(status().isOk());
    JsonNode items = recent(u1, "").get("items");
    assertThat(items).hasSize(1);
    assertThat(items.get(0).get("lastAction").asString()).isEqualTo("EDIT");
  }

  private String lastActionOf(long userId, long pageId) {
    return callInTenant(
        1L,
        () ->
            dsl.select(WIKI_PAGE_ACTIVITY.LAST_ACTION)
                .from(WIKI_PAGE_ACTIVITY)
                .where(WIKI_PAGE_ACTIVITY.USER_ID.eq(userId))
                .and(WIKI_PAGE_ACTIVITY.WIKI_PAGE_ID.eq(pageId))
                .fetchOne(WIKI_PAGE_ACTIVITY.LAST_ACTION));
  }

  private java.time.OffsetDateTime lastAtOf(long userId, long pageId) {
    return callInTenant(
        1L,
        () ->
            dsl.select(WIKI_PAGE_ACTIVITY.LAST_AT)
                .from(WIKI_PAGE_ACTIVITY)
                .where(WIKI_PAGE_ACTIVITY.USER_ID.eq(userId))
                .and(WIKI_PAGE_ACTIVITY.WIKI_PAGE_ID.eq(pageId))
                .fetchOne(WIKI_PAGE_ACTIVITY.LAST_AT));
  }

  /** 60초 안의 EDIT→EDIT 는 last_at 을 다시 쓰지 않는다. */
  @Test
  void editWithin60sOfEditKeepsLastAt() {
    long p1 = newPage(u1, spaceA, null, "연속편집");
    record(u1, p1, WikiPageAction.EDIT);
    var first = lastAtOf(u1, p1);
    record(u1, p1, WikiPageAction.EDIT);
    assertThat(lastAtOf(u1, p1)).isEqualTo(first);
  }

  /** 60초 안의 OPEN 은 직전 EDIT 를 OPEN 으로 내리지 않는다. */
  @Test
  void openWithin60sOfEditKeepsEdit() {
    long p1 = newPage(u1, spaceA, null, "편집뒤열기");
    record(u1, p1, WikiPageAction.EDIT);
    var first = lastAtOf(u1, p1);
    record(u1, p1, WikiPageAction.OPEN);
    assertThat(lastActionOf(u1, p1)).isEqualTo("EDIT");
    assertThat(lastAtOf(u1, p1)).isEqualTo(first);
  }

  /** OPEN 뒤의 EDIT 는 60초 안이라도 EDIT 로 갱신한다. */
  @Test
  void editAfterOpenAlwaysUpdates() {
    long p1 = newPage(u1, spaceA, null, "열고편집");
    record(u1, p1, WikiPageAction.OPEN);
    var first = lastAtOf(u1, p1);
    record(u1, p1, WikiPageAction.EDIT);
    assertThat(lastActionOf(u1, p1)).isEqualTo("EDIT");
    assertThat(lastAtOf(u1, p1)).isAfter(first);
  }

  @Test
  void getPageDoesNotRecord() throws Exception {
    long p1 = newPage(u1, spaceA, null, "조회만");
    mvc.perform(get("/api/v1/wiki/pages/" + p1).header("Authorization", bearer(u1)))
        .andExpect(status().isOk());
    assertThat(recent(u1, "").get("items")).isEmpty();
  }

  @Test
  void collabStoreRecordsDistinctEditors() throws Exception {
    long u2 = newUser();
    callInTenant(
        1L,
        () -> {
          spaceService.addMember(u1, spaceA, u2, "EDITOR");
          return null;
        });
    long p1 = newPage(u1, spaceA, null, "함께");
    // 상태만 저장 / 편집자 없음 → 기록 없음.
    storeInternal(p1, "{\"state\":\"AQ==\",\"bodyVersion\":1}");
    storeInternal(p1, "{\"state\":\"AQ==\",\"body\":\"가\",\"editorIds\":[]}");
    assertThat(countRows()).isZero();

    storeInternal(
        p1, "{\"state\":\"AQ==\",\"body\":\"나\",\"editorIds\":[" + u1 + "," + u1 + "," + u2 + "]}");
    assertThat(countRows()).isEqualTo(2);
    for (long u : new long[] {u1, u2}) {
      JsonNode items = recent(u, "").get("items");
      assertThat(items).hasSize(1);
      assertThat(items.get(0).get("lastAction").asString()).isEqualTo("EDIT");
    }
  }

  /** 공유 링크로 동기화 서버에 접속한 비멤버 편집자는 기록하지 않고, 멤버 편집자만 남긴다. */
  @Test
  void collabStoreSkipsShareLinkEditor() throws Exception {
    long p1 = newPage(u1, spaceA, null, "공유협업");
    long stranger = newUser();
    storeInternal(
        p1, "{\"state\":\"AQ==\",\"body\":\"다\",\"editorIds\":[" + stranger + "," + u1 + "]}");
    assertThat(countRows()).isEqualTo(1);
    assertThat(recent(u1, "").get("items")).hasSize(1);
    callInTenant(
        1L,
        () -> {
          spaceService.addMember(u1, spaceA, stranger, "EDITOR");
          return null;
        });
    assertThat(recent(stranger, "").get("items")).isEmpty();
  }

  @Test
  void capKeeps500() throws Exception {
    List<Long> ids = new ArrayList<>();
    for (int i = 0; i < WikiPageActivityRepository.PER_USER_CAP + 1; i++) {
      ids.add(newPage(u1, spaceA, null, "p" + i));
    }
    for (long id : ids) {
      record(u1, id, WikiPageAction.OPEN);
    }
    assertThat(countRows()).isEqualTo(WikiPageActivityRepository.PER_USER_CAP);
    boolean oldestKept =
        callInTenant(
            1L,
            () ->
                dsl.fetchExists(
                    WIKI_PAGE_ACTIVITY, WIKI_PAGE_ACTIVITY.WIKI_PAGE_ID.eq(ids.get(0))));
    assertThat(oldestKept).isFalse();
  }

  @Test
  void pageFillsAfterFiltering() throws Exception {
    long u2 = newUser();
    callInTenant(
        1L,
        () -> {
          spaceService.addMember(u1, spaceA, u2, "EDITOR");
          return null;
        });
    long a1 = newPage(u1, spaceA, null, "a1");
    long b2 = newPage(u1, spaceB, null, "b2"); // u2 는 B 의 멤버가 아니다.
    long a3 = newPage(u1, spaceA, null, "a3");
    record(u2, a1, WikiPageAction.OPEN);
    record(u2, b2, WikiPageAction.OPEN);
    record(u2, a3, WikiPageAction.OPEN);

    List<Long> seen = new ArrayList<>();
    String cursor = null;
    for (int guard = 0; guard < 5; guard++) {
      JsonNode page = recent(u2, "?limit=2" + (cursor == null ? "" : "&cursor=" + cursor));
      for (JsonNode it : page.get("items")) {
        seen.add(it.get("pageId").asLong());
      }
      if (page.get("nextCursor").isNull()) {
        break;
      }
      cursor = page.get("nextCursor").asString();
    }
    assertThat(seen).containsExactly(a3, a1);
    // 첫 쪽은 거른 뒤에도 limit 만큼 채워진다.
    assertThat(recent(u2, "?limit=2").get("items")).hasSize(2);
  }

  @Test
  void badCursorIs400() throws Exception {
    mvc.perform(get("/api/v1/wiki/recent?cursor=!!!").header("Authorization", bearer(u1)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void emptyAndRequiresLogin() throws Exception {
    mvc.perform(get("/api/v1/wiki/recent").header("Authorization", bearer(u1)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(0)))
        .andExpect(jsonPath("$.nextCursor", nullValue()));
    mvc.perform(get("/api/v1/wiki/recent")).andExpect(status().isUnauthorized());
  }
}
