package com.workplace.wiki;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_EVENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageMovedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageSpaceChangedEvent;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 페이지를 다른 스페이스로 옮기기(WP-988) — 서브트리 동반 이동·권한·부모 검증·공유 승계/해제·미리보기·이벤트.
 *
 * <p>실제 API(MockMvc)로 옮겨 행위자가 요청 사용자로 잡히게 한다. {@code @Transactional}: 끝나면 롤백된다.
 */
@Transactional
@RecordApplicationEvents
class WikiPageMoveSpaceTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired ApplicationEvents appEvents;

  private long ownerId; // 두 스페이스의 OWNER — 옮기는 사람
  private long sourceOnlyId; // 원본 스페이스에만 EDITOR — 공유를 만든 사람 / 옮겨지면 접근을 잃는 사람
  private long targetViewerId; // 원본 EDITOR, 대상 VIEWER
  private long strangerId; // 대상 스페이스 비멤버
  private long sourceId;
  private long targetId;
  private long rootId;
  private long childId;
  private long targetParentId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = withMembership(TestFixtures.createHuman(dsl));
    sourceOnlyId = withMembership(TestFixtures.createHuman(dsl));
    targetViewerId = withMembership(TestFixtures.createHuman(dsl));
    strangerId = withMembership(TestFixtures.createHuman(dsl));
    sourceId = spaceService.createTeamSpace(ownerId, "이동원본-" + UUID.randomUUID()).id();
    targetId = spaceService.createTeamSpace(ownerId, "이동대상-" + UUID.randomUUID()).id();
    spaceService.addMember(ownerId, sourceId, sourceOnlyId, "EDITOR");
    spaceService.addMember(ownerId, sourceId, targetViewerId, "EDITOR");
    spaceService.addMember(ownerId, targetId, targetViewerId, "VIEWER");
    rootId = page(sourceId, null, "옮길 문서");
    childId = page(sourceId, rootId, "옮길 하위");
    targetParentId = page(targetId, null, "대상 부모");
    appEvents.clear();
  }

  private long page(long inSpaceId, Long parentId, String title) {
    TenantContext.set(1L);
    long id = pageService.create(ownerId, inSpaceId, new CreatePageRequest(parentId, title)).id();
    TenantContext.set(1L);
    return id;
  }

  private ResultActions move(long userId, long pageId, Long parentId, Long targetSpaceId)
      throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("parentId", parentId);
    body.put("position", 0);
    body.put("targetSpaceId", targetSpaceId);
    return call(
        patch("/api/v1/wiki/pages/" + pageId + "/move")
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(body)),
        userId);
  }

  private ResultActions preview(long userId, long pageId, long targetSpaceId) throws Exception {
    return call(
        get("/api/v1/wiki/pages/" + pageId + "/move-preview")
            .param("targetSpaceId", String.valueOf(targetSpaceId)),
        userId);
  }

  private void share(long userId, long pageId) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", "WORKSPACE");
    body.put("permission", "VIEW");
    body.put("includeChildren", true);
    body.put("userIds", List.of());
    body.put("expiresAt", null);
    body.put("notify", Map.of());
    call(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(
                    "/api/v1/wiki/pages/" + pageId + "/share")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body)),
            userId)
        .andExpect(status().isOk());
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    TenantContext.set(1L);
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  private long spaceOf(long pageId) {
    return dsl.select(WIKI_PAGE.SPACE_ID)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.ID.eq(pageId))
        .fetchOne(WIKI_PAGE.SPACE_ID);
  }

  /** 공유를 만료시킨다 — 만료 시각을 DB 시계로 1시간 전에 둔다(만료 판정이 DB now() 다). 공유 저장 API 는 지난 시각을 받지 않아 행을 직접 고친다. */
  private void expireShare(long pageId) {
    dsl.update(WIKI_PAGE_SHARE)
        .set(
            WIKI_PAGE_SHARE.EXPIRES_AT,
            DSL.field("now() - interval '1 hour'", OffsetDateTime.class))
        .where(WIKI_PAGE_SHARE.PAGE_ID.eq(pageId))
        .execute();
  }

  private int eventCount(long pageId, String type) {
    return dsl.fetchCount(
        WIKI_PAGE_SHARE_EVENT,
        WIKI_PAGE_SHARE_EVENT.PAGE_ID.eq(pageId).and(WIKI_PAGE_SHARE_EVENT.TYPE.eq(type)));
  }

  /** 서브트리가 함께 대상 스페이스로 옮겨지고 id 는 그대로, 부모는 대상 스페이스의 페이지가 된다. */
  @Test
  void moves_subtree_keeping_ids() throws Exception {
    move(ownerId, rootId, targetParentId, targetId).andExpect(status().isNoContent());

    assertThat(spaceOf(rootId)).isEqualTo(targetId);
    assertThat(spaceOf(childId)).isEqualTo(targetId);
    long parent =
        dsl.select(WIKI_PAGE.PARENT_ID)
            .from(WIKI_PAGE)
            .where(WIKI_PAGE.ID.eq(rootId))
            .fetchOne(WIKI_PAGE.PARENT_ID);
    assertThat(parent).isEqualTo(targetParentId);
    // 하위의 부모는 그대로 옮긴 루트다.
    assertThat(
            dsl.select(WIKI_PAGE.PARENT_ID)
                .from(WIKI_PAGE)
                .where(WIKI_PAGE.ID.eq(childId))
                .fetchOne(WIKI_PAGE.PARENT_ID))
        .isEqualTo(rootId);
  }

  /** 대상 스페이스 편집 권한이 없으면 VIEWER 는 403, 비멤버는 404 — 원본 VIEWER 도 403. */
  @Test
  void requires_editor_in_both_spaces() throws Exception {
    move(targetViewerId, rootId, null, targetId).andExpect(status().isForbidden());
    move(strangerId, rootId, null, targetId).andExpect(status().isNotFound());
    assertThat(spaceOf(rootId)).isEqualTo(sourceId);

    // 원본 VIEWER: 원본에서 읽기만 가능한 사람
    long srcViewer = withMembership(TestFixtures.createHuman(dsl));
    spaceService.addMember(ownerId, sourceId, srcViewer, "VIEWER");
    spaceService.addMember(ownerId, targetId, srcViewer, "EDITOR");
    move(srcViewer, rootId, null, targetId).andExpect(status().isForbidden());
  }

  /** 대상 스페이스의 페이지가 아닌 부모는 400. */
  @Test
  void rejects_parent_outside_target_space() throws Exception {
    long sourcePage = page(sourceId, null, "원본의 다른 문서");
    move(ownerId, rootId, sourcePage, targetId).andExpect(status().isBadRequest());
    assertThat(spaceOf(rootId)).isEqualTo(sourceId);
  }

  /** 공유는 같은 토큰으로 따라가 space_id 가 바뀌고, 만든 사람이 대상 편집자가 아니면 해제된다. */
  @Test
  void shares_follow_or_are_revoked() throws Exception {
    share(ownerId, rootId);
    share(sourceOnlyId, childId);

    move(ownerId, rootId, targetParentId, targetId).andExpect(status().isNoContent());

    assertThat(dsl.fetchCount(WIKI_PAGE_SHARE, WIKI_PAGE_SHARE.PAGE_ID.eq(rootId))).isEqualTo(1);
    assertThat(
            dsl.select(WIKI_PAGE_SHARE.SPACE_ID)
                .from(WIKI_PAGE_SHARE)
                .where(WIKI_PAGE_SHARE.PAGE_ID.eq(rootId))
                .fetchOne(WIKI_PAGE_SHARE.SPACE_ID))
        .isEqualTo(targetId);
    assertThat(dsl.fetchCount(WIKI_PAGE_SHARE, WIKI_PAGE_SHARE.PAGE_ID.eq(childId))).isZero();
    assertThat(eventCount(childId, "REVOKED_BY_MEMBERSHIP")).isEqualTo(1);
  }

  /**
   * 상위 공유에서 제외된 페이지(WP-987)를 다른 스페이스의 하위 포함 공유 아래로 옮겨도 그 공유에 「들어옴」이, 옛 상위 공유에 「나감」이 남지 않는다(WP-1031)
   * — 제외 표시는 페이지를 따라 옮겨 가 새 공유로도 열리지 않고, 옛 공유도 원래 덮지 않았다. 제외 표시가 없는 페이지는 그대로 양쪽에 남는다.
   */
  @Test
  void excluded_page_moved_across_spaces_records_nothing() throws Exception {
    share(ownerId, rootId);
    share(ownerId, targetParentId);
    call(put("/api/v1/wiki/pages/" + childId + "/share/exclusion"), ownerId)
        .andExpect(status().isNoContent());

    move(ownerId, childId, targetParentId, targetId).andExpect(status().isNoContent());

    assertThat(spaceOf(childId)).isEqualTo(targetId);
    assertThat(eventCount(targetParentId, "PAGE_MOVED_IN")).isZero();
    assertThat(eventCount(rootId, "PAGE_MOVED_OUT")).isZero();

    // 대조군 — 제외 표시가 없는 하위는 옛 공유에서 빠지고 새 공유에 들어온다.
    long plainId = page(sourceId, rootId, "제외 안 한 하위");
    move(ownerId, plainId, targetParentId, targetId).andExpect(status().isNoContent());

    assertThat(eventCount(targetParentId, "PAGE_MOVED_IN")).isEqualTo(1);
    assertThat(eventCount(rootId, "PAGE_MOVED_OUT")).isEqualTo(1);
  }

  /**
   * 자기 공유가 살아 있는 페이지를 다른 스페이스의 하위 포함 공유 아래로 옮길 때(WP-1043) — 상속을 멈추는지는 옮기기 전과 뒤를 나눠 본다. 공유가 따라가면(만든
   * 사람이 대상 편집자) 전후 모두 멈추므로 어느 쪽에도 기록이 없다. 만든 사람이 대상 편집자가 아니라 해제되면 옮기기 전에는 멈췄고(옛 공유는 원래 덮지 않았다 —
   * 「나감」 없음) 옮긴 뒤에는 멈추지 않는다(새 공유가 덮는다 — 「들어옴」).
   */
  @Test
  void own_share_page_moved_across_spaces_judges_before_and_after() throws Exception {
    share(ownerId, rootId);
    share(ownerId, targetParentId);
    // 공유가 따라가는 경우 — 만든 사람(owner)이 대상 편집자 이상이다.
    long keptId = page(sourceId, rootId, "공유 유지 하위");
    share(ownerId, keptId);

    move(ownerId, keptId, targetParentId, targetId).andExpect(status().isNoContent());

    assertThat(dsl.fetchCount(WIKI_PAGE_SHARE, WIKI_PAGE_SHARE.PAGE_ID.eq(keptId))).isEqualTo(1);
    assertThat(eventCount(rootId, "PAGE_MOVED_OUT")).isZero();
    assertThat(eventCount(targetParentId, "PAGE_MOVED_IN")).isZero();

    // 해제되는 경우 — 만든 사람(sourceOnly)이 대상 스페이스 멤버가 아니다.
    long revokedId = page(sourceId, rootId, "공유 해제 하위");
    share(sourceOnlyId, revokedId);

    move(ownerId, revokedId, targetParentId, targetId).andExpect(status().isNoContent());

    assertThat(dsl.fetchCount(WIKI_PAGE_SHARE, WIKI_PAGE_SHARE.PAGE_ID.eq(revokedId))).isZero();
    assertThat(eventCount(rootId, "PAGE_MOVED_OUT")).isZero();
    assertThat(eventCount(targetParentId, "PAGE_MOVED_IN")).isEqualTo(1);
  }

  /**
   * 만료된 하위 포함 공유는 아무것도 덮지 않는다(WP-1044) — 만료된 옛 공유 아래에서 만료된 새 공유 아래로 다른 스페이스로 옮겨도 「나감」·「들어옴」이 없다.
   * 대조군: 살아 있는 공유끼리는 그대로 양쪽에 남는다.
   */
  @Test
  void expired_including_shares_record_nothing_across_spaces() throws Exception {
    share(ownerId, rootId);
    share(ownerId, targetParentId);
    expireShare(rootId);
    expireShare(targetParentId);

    move(ownerId, childId, targetParentId, targetId).andExpect(status().isNoContent());

    assertThat(spaceOf(childId)).isEqualTo(targetId);
    assertThat(eventCount(rootId, "PAGE_MOVED_OUT")).isZero();
    assertThat(eventCount(targetParentId, "PAGE_MOVED_IN")).isZero();

    // 대조군 — 살아 있는 하위 포함 공유끼리 옮기면 양쪽에 남는다.
    long liveRootId = page(sourceId, null, "살아 있는 원본 공유");
    long liveChildId = page(sourceId, liveRootId, "살아 있는 공유 하위");
    long liveTargetId = page(targetId, null, "살아 있는 대상 공유");
    share(ownerId, liveRootId);
    share(ownerId, liveTargetId);

    move(ownerId, liveChildId, liveTargetId, targetId).andExpect(status().isNoContent());

    assertThat(eventCount(liveRootId, "PAGE_MOVED_OUT")).isEqualTo(1);
    assertThat(eventCount(liveTargetId, "PAGE_MOVED_IN")).isEqualTo(1);
  }

  /** 미리보기: 쪽수·접근을 잃는 멤버 수·유지/해제 공유 목록. 대상 편집 권한이 없으면 거절. */
  @Test
  void preview_reports_effects() throws Exception {
    share(ownerId, rootId);
    share(sourceOnlyId, childId);

    preview(ownerId, rootId, targetId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pageCount").value(2))
        // sourceOnly 만 대상 멤버가 아니다(targetViewer 는 대상 VIEWER 로 남는다).
        .andExpect(jsonPath("$.lostMemberCount").value(1))
        // 대상 스페이스 멤버 중 원본 멤버가 아닌 사람은 없다(owner·targetViewer 는 둘 다 멤버).
        .andExpect(jsonPath("$.gainedMemberCount").value(0))
        .andExpect(jsonPath("$.keptShares", hasSize(1)))
        .andExpect(jsonPath("$.revokedShares", hasSize(1)))
        .andExpect(jsonPath("$.revokedShares[0].pageId").value(childId));

    preview(targetViewerId, rootId, targetId).andExpect(status().isForbidden());
  }

  /** 같은 스페이스로 미리보기하면 영향 없음 — 같은 스페이스 안 이동은 공유를 해제하지 않으므로 해제 목록도 비어야 한다. */
  @Test
  void preview_same_space_reports_no_effects() throws Exception {
    share(sourceOnlyId, childId);
    // 공유를 만든 사람을 보기로 강등 — 다른 스페이스로 옮긴다면 해제 대상이지만 같은 스페이스 안 이동에는 상관없다.
    spaceService.addMember(ownerId, sourceId, sourceOnlyId, "VIEWER");

    preview(ownerId, rootId, sourceId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pageCount").value(2))
        .andExpect(jsonPath("$.lostMemberCount").value(0))
        .andExpect(jsonPath("$.keptShares", hasSize(0)))
        .andExpect(jsonPath("$.revokedShares", hasSize(0)));
  }

  /** 이동 이벤트는 두 스페이스 모두에, 동기화 재검증 이벤트는 서브트리 id 로 나간다. */
  @Test
  void publishes_events() throws Exception {
    move(ownerId, rootId, null, targetId).andExpect(status().isNoContent());

    List<Long> movedSpaces =
        appEvents.stream(WikiPageMovedEvent.class).map(WikiPageMovedEvent::spaceId).toList();
    assertThat(movedSpaces).contains(sourceId, targetId);
    List<WikiPageSpaceChangedEvent> changed =
        appEvents.stream(WikiPageSpaceChangedEvent.class).toList();
    assertThat(changed).hasSize(1);
    assertThat(changed.get(0).pageIds()).containsExactlyInAnyOrder(rootId, childId);
  }
}
