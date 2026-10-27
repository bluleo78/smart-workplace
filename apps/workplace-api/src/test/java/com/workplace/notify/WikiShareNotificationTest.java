package com.workplace.notify;

import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.outbound.NotificationDispatcher;
import com.workplace.notify.push.InboxPushRequestedEvent;
import com.workplace.notify.push.PushCategory;
import com.workplace.notify.push.PushContentService;
import com.workplace.notify.push.PushMessage;
import com.workplace.notify.service.NotificationService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.outbound.WikiShareNotifyEvents.WikiShareAccessApprovedEvent;
import com.workplace.wiki.outbound.WikiShareNotifyEvents.WikiShareAccessRequestedEvent;
import com.workplace.wiki.outbound.WikiShareNotifyEvents.WikiSharedWithPeopleEvent;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 공유 알림(WP-579 Task 8) — 「공유받음」·「접근 요청」·「접근 승인」 알림 생성(받는 사람·본인 제외), 목록의 페이지 제목·메시지, 푸시 문구·경로,
 * 알림을 누른 사람이 어디로 갈지 알려 주는 {@code GET /wiki/pages/{id}/entry}.
 *
 * <p>@Transactional: 커밋 뒤(AFTER_COMMIT) 리스너는 테스트 트랜잭션 안에서 발화하지 않으므로, 리스너의 본문(dispatcher 메서드)을 직접
 * 호출해 알림 생성을 검증한다. 이벤트 발행 자체는 Task 4 테스트(WikiShareLinkTest)가 본다.
 */
@Transactional
@RecordApplicationEvents
class WikiShareNotificationTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  // @Async 프록시를 거치면 리스너가 다른 스레드에서 돌아 테스트 트랜잭션의 시드(미커밋)를 못 본다 — 대상 객체를 직접 불러 같은 스레드·트랜잭션에서 검증한다.
  @Autowired NotificationDispatcher dispatcherProxy;
  @Autowired NotificationService notifications;
  @Autowired PushContentService pushContent;
  @Autowired ApplicationEvents appEvents;

  private long ownerId; // 스페이스 OWNER, 공유한 사람
  private long listedId; // 같은 워크스페이스, 스페이스 비멤버, PEOPLE 지정 대상
  private long otherListedId; // 같은 워크스페이스, 스페이스 비멤버, PEOPLE 지정 대상
  private long strangerId; // 같은 워크스페이스, 스페이스 비멤버, 지정 아님
  private long spaceId;
  private long rootId;
  private long childId;

  private NotificationDispatcher dispatcher;

  @BeforeEach
  void seed() {
    dispatcher = AopTestUtils.getUltimateTargetObject(dispatcherProxy);
    TenantContext.set(1L);
    ownerId = human();
    listedId = human();
    otherListedId = human();
    strangerId = human();
    spaceId = spaceService.createTeamSpace(ownerId, "공유알림-" + UUID.randomUUID()).id();
    rootId = page(null, "제품 로드맵");
    childId = page(rootId, "1분기");
  }

  /** 새로 추가된 사람에게만, 보낸 사람 본인이 목록에 섞여 있어도 본인은 빼고 만든다 — 메시지·페이지·행위자가 행에 실린다. */
  @Test
  void shared_with_people_notifies_added_only_and_not_self() {
    dispatcher.onWikiSharedWithPeople(
        new WikiSharedWithPeopleEvent(
            1L, rootId, ownerId, List.of(listedId, ownerId, listedId, otherListedId), "확인 부탁해요"));

    assertThat(recipients(NotificationType.WIKI_SHARED))
        .containsExactlyInAnyOrder(listedId, otherListedId);
    var row =
        dsl.selectFrom(NOTIFICATION)
            .where(NOTIFICATION.RECIPIENT_ID.eq(listedId))
            .and(NOTIFICATION.TYPE.eq("WIKI_SHARED"))
            .fetchOne();
    assertThat(row.getWikiPageId()).isEqualTo(rootId);
    assertThat(row.getActorId()).isEqualTo(ownerId);
    assertThat(row.getMessage()).isEqualTo("확인 부탁해요");
    assertThat(row.getIssueId()).isNull();
    assertThat(row.getReadAt()).isNull();
  }

  /** 접근 요청은 공유를 만든 사람 한 명에게, 행위자는 요청자 — 스스로 요청한 경우(공유한 사람 = 요청자)는 만들지 않는다. */
  @Test
  void access_request_notifies_sharer() {
    dispatcher.onWikiShareAccessRequested(
        new WikiShareAccessRequestedEvent(1L, rootId, strangerId, ownerId));
    dispatcher.onWikiShareAccessRequested(
        new WikiShareAccessRequestedEvent(1L, rootId, ownerId, ownerId));

    assertThat(recipients(NotificationType.WIKI_SHARE_ACCESS_REQUESTED)).containsExactly(ownerId);
    var row =
        dsl.selectFrom(NOTIFICATION)
            .where(NOTIFICATION.TYPE.eq("WIKI_SHARE_ACCESS_REQUESTED"))
            .fetchOne();
    assertThat(row.getActorId()).isEqualTo(strangerId);
    assertThat(row.getWikiPageId()).isEqualTo(rootId);
    assertThat(row.getMessage()).isNull();
  }

  /** 승인은 요청자 한 명에게, 행위자는 승인한 사람. */
  @Test
  void approved_notifies_requester() {
    dispatcher.onWikiShareAccessApproved(
        new WikiShareAccessApprovedEvent(1L, rootId, ownerId, strangerId));

    assertThat(recipients(NotificationType.WIKI_SHARE_ACCESS_APPROVED)).containsExactly(strangerId);
    var row =
        dsl.selectFrom(NOTIFICATION)
            .where(NOTIFICATION.TYPE.eq("WIKI_SHARE_ACCESS_APPROVED"))
            .fetchOne();
    assertThat(row.getActorId()).isEqualTo(ownerId);
    assertThat(row.getWikiPageId()).isEqualTo(rootId);
  }

  /** 목록 응답에 페이지 제목·메시지·행위자가 실리고, 안읽음 수에도 센다. 페이지를 지우면 알림도 함께 사라진다(FK CASCADE). */
  @Test
  void listing_includes_page_title_and_message() throws Exception {
    savePeople(rootId, true, List.of(listedId)); // 하위 포함 공유로 받는 사람이 두 노트를 모두 열 수 있다
    dispatcher.onWikiSharedWithPeople(
        new WikiSharedWithPeopleEvent(1L, rootId, ownerId, List.of(listedId), "확인 부탁해요"));
    dispatcher.onWikiSharedWithPeople(
        new WikiSharedWithPeopleEvent(1L, childId, ownerId, List.of(listedId), null));

    List<NotificationResponse> list = notifications.listRecent(listedId, 20, 0);
    assertThat(list).hasSize(2);
    NotificationResponse root =
        list.stream().filter(n -> n.wikiPageId() == rootId).findFirst().orElseThrow();
    assertThat(root.type()).isEqualTo("WIKI_SHARED");
    assertThat(root.wikiPageTitle()).isEqualTo("제품 로드맵");
    assertThat(root.message()).isEqualTo("확인 부탁해요");
    assertThat(root.actorId()).isEqualTo(ownerId);
    assertThat(root.actorName()).isNotBlank();
    assertThat(root.issueId()).isNull();
    NotificationResponse child =
        list.stream().filter(n -> n.wikiPageId() == childId).findFirst().orElseThrow();
    assertThat(child.wikiPageTitle()).isEqualTo("1분기");
    assertThat(child.message()).isNull();
    assertThat(notifications.countUnread(listedId)).isEqualTo(2);

    pageService.delete(ownerId, childId);
    assertThat(notifications.listRecent(listedId, 20, 0)).hasSize(1);
  }

  /**
   * 열 수 없게 된 노트의 예전 알림은 목록·안읽음 수에서 빠진다(WP-491·517 과 같은 규칙) — 지정에서 빠짐·공유 해제는 숨기고, 다시 지정되면 돌아온다. 스페이스
   * 멤버는 공유와 무관하게 보이고, 워크스페이스 전체 공유는 알림 입구가 열어 주지 않으므로 숨는다.
   */
  @Test
  void listing_hides_wiki_notification_after_access_is_lost() throws Exception {
    savePeople(rootId, false, List.of(listedId));
    dispatcher.onWikiSharedWithPeople(
        new WikiSharedWithPeopleEvent(1L, rootId, ownerId, List.of(listedId), "봐 주세요"));
    assertThat(notifications.listRecent(listedId, 20, 0)).hasSize(1);
    assertThat(notifications.countUnread(listedId)).isEqualTo(1);

    // 지정에서 빠지면 숨는다.
    savePeople(rootId, false, List.of(otherListedId));
    assertThat(notifications.listRecent(listedId, 20, 0)).isEmpty();
    assertThat(notifications.countUnread(listedId)).isZero();

    // 다시 지정되면 돌아온다.
    savePeople(rootId, false, List.of(listedId));
    assertThat(notifications.listRecent(listedId, 20, 0)).hasSize(1);

    // 하위 포함이 아닌 공유가 하위 페이지를 덮지 않는다 — 하위 페이지 알림은 숨는다.
    dispatcher.onWikiSharedWithPeople(
        new WikiSharedWithPeopleEvent(1L, childId, ownerId, List.of(listedId), null));
    assertThat(notifications.listRecent(listedId, 20, 0)).hasSize(1);
    savePeople(rootId, true, List.of(listedId));
    assertThat(notifications.listRecent(listedId, 20, 0)).hasSize(2);

    // 공유 해제 — 숨는다.
    call(delete("/api/v1/wiki/pages/" + rootId + "/share"), ownerId)
        .andExpect(status().isNoContent());
    assertThat(notifications.listRecent(listedId, 20, 0)).isEmpty();
    assertThat(notifications.countUnread(listedId)).isZero();

    // 워크스페이스 전체 공유여도 알림으로는 들어갈 수 없다(입구 /entry 는 지정한 사람에게만 토큰을 준다) — 숨는다.
    saveAudience(rootId, "WORKSPACE");
    assertThat(notifications.listRecent(listedId, 20, 0)).isEmpty();

    // 스페이스 멤버(공유한 사람)는 공유와 무관하게 접근 요청 알림이 보인다.
    dispatcher.onWikiShareAccessRequested(
        new WikiShareAccessRequestedEvent(1L, rootId, strangerId, ownerId));
    assertThat(notifications.listRecent(ownerId, 20, 0)).hasSize(1);
  }

  /**
   * 알림이 보이는가 ⇔ 알림을 누르면 열리는가(입구 {@code /entry} 가 멤버 또는 토큰을 돌려줌) — 같은 시나리오마다 둘이 같아야 한다. 보이는데 누르면 「열 수
   * 없음」이거나, 열리는데 숨는 알림이 없게. 지정한 사람 → 워크스페이스 전체로 넓힘 → 다시 지정 → 지정에서 빠짐 → 만료 → 해제, 그리고 스페이스 멤버.
   */
  @Test
  void notification_visibility_matches_entry() throws Exception {
    dispatcher.onWikiSharedWithPeople(
        new WikiSharedWithPeopleEvent(1L, rootId, ownerId, List.of(listedId), null));
    dispatcher.onWikiShareAccessRequested(
        new WikiShareAccessRequestedEvent(1L, rootId, strangerId, ownerId));

    savePeople(rootId, false, List.of(listedId));
    assertVisibleIffEntryOpens(listedId, true);

    saveAudience(rootId, "WORKSPACE"); // 넓힘 — 지정 목록이 비워져 입구가 토큰을 주지 않는다
    assertVisibleIffEntryOpens(listedId, false);

    savePeople(rootId, false, List.of(listedId));
    assertVisibleIffEntryOpens(listedId, true);

    savePeople(rootId, false, List.of(otherListedId));
    assertVisibleIffEntryOpens(listedId, false);

    savePeople(rootId, false, List.of(listedId));
    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.EXPIRES_AT, OffsetDateTime.now().minusMinutes(1))
        .where(WIKI_PAGE_SHARE.PAGE_ID.eq(rootId))
        .execute();
    assertVisibleIffEntryOpens(listedId, false);

    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.EXPIRES_AT, (OffsetDateTime) null)
        .where(WIKI_PAGE_SHARE.PAGE_ID.eq(rootId))
        .execute();
    assertVisibleIffEntryOpens(listedId, true);

    call(delete("/api/v1/wiki/pages/" + rootId + "/share"), ownerId)
        .andExpect(status().isNoContent());
    assertVisibleIffEntryOpens(listedId, false);

    // 스페이스 멤버 — 공유가 없어도 보이고 노트로 들어간다.
    assertVisibleIffEntryOpens(ownerId, true);
  }

  /**
   * 하위 페이지 알림도 같은 규칙(WP-987) — 상위 공유(지정한 사람, 하위 포함)로 보이던 하위 노트 알림은, 그 하위가 「상위 공유에서 제외」되거나 따로 공유를 켜면
   * 숨고 입구도 열지 않는다. 제외를 풀거나 따로 켠 공유를 해제하면 다시 보인다.
   */
  @Test
  void child_notification_follows_exclusion_and_own_share() throws Exception {
    dispatcher.onWikiSharedWithPeople(
        new WikiSharedWithPeopleEvent(1L, childId, ownerId, List.of(listedId), null));
    savePeople(rootId, true, List.of(listedId));
    assertVisibleIffEntryOpens(listedId, childId, true);

    call(put("/api/v1/wiki/pages/" + childId + "/share/exclusion"), ownerId)
        .andExpect(status().isNoContent());
    assertVisibleIffEntryOpens(listedId, childId, false);

    call(delete("/api/v1/wiki/pages/" + childId + "/share/exclusion"), ownerId)
        .andExpect(status().isNoContent());
    assertVisibleIffEntryOpens(listedId, childId, true);

    // 하위가 따로 켠 공유가 우선 — 그 공유에 지정되지 않았으면 상위 공유로는 열리지 않는다.
    savePeople(childId, false, List.of(otherListedId));
    assertVisibleIffEntryOpens(listedId, childId, false);
    call(delete("/api/v1/wiki/pages/" + childId + "/share"), ownerId)
        .andExpect(status().isNoContent());
    assertVisibleIffEntryOpens(listedId, childId, true);
  }

  /** 받는 사람의 rootId 알림이 목록에 보이는지와 입구가 열어 주는지가 같고, 그 값이 expected 인지. */
  private void assertVisibleIffEntryOpens(long userId, boolean expected) throws Exception {
    assertVisibleIffEntryOpens(userId, rootId, expected);
  }

  /** 받는 사람의 pageId 알림이 목록에 보이는지와 입구가 열어 주는지가 같고, 그 값이 expected 인지. */
  private void assertVisibleIffEntryOpens(long userId, long pageId, boolean expected)
      throws Exception {
    boolean visible =
        notifications.listRecent(userId, 20, 0).stream()
            .anyMatch(n -> Long.valueOf(pageId).equals(n.wikiPageId()));
    int entryStatus = call(get(entry(pageId)), userId).andReturn().getResponse().getStatus();
    assertThat(entryStatus == 200).as("entry 가 열어 주는가").isEqualTo(visible);
    assertThat(visible).as("알림이 보이는가").isEqualTo(expected);
  }

  /** 푸시 — 제목은 페이지 제목, 경로는 알림 열기 경로(요청은 공유 창을 연 채로), 카테고리는 「나를 향한」 MENTION. 페이지가 없으면 푸시하지 않는다. */
  @Test
  void push_content_for_wiki_share_types() {
    PushMessage shared =
        pushContent.forInbox(wikiPush(NotificationType.WIKI_SHARED, rootId, ownerId));
    assertThat(shared.title()).isEqualTo("제품 로드맵");
    assertThat(shared.body()).contains("님이 노트를 공유했습니다");
    assertThat(shared.url()).isEqualTo("/wiki/open/" + rootId);
    assertThat(shared.category()).isEqualTo(PushCategory.MENTION);
    assertThat(shared.tag()).isEqualTo("wiki-" + rootId);

    PushMessage requested =
        pushContent.forInbox(
            wikiPush(NotificationType.WIKI_SHARE_ACCESS_REQUESTED, rootId, strangerId));
    assertThat(requested.body()).contains("님이 접근을 요청했습니다");
    assertThat(requested.url()).isEqualTo("/wiki/open/" + rootId + "?share=1");

    PushMessage approved =
        pushContent.forInbox(
            wikiPush(NotificationType.WIKI_SHARE_ACCESS_APPROVED, rootId, ownerId));
    assertThat(approved.body()).isEqualTo("접근이 승인됐습니다");
    assertThat(approved.url()).isEqualTo("/wiki/open/" + rootId);

    assertThat(pushContent.forInbox(wikiPush(NotificationType.WIKI_SHARED, -1L, ownerId))).isNull();
  }

  /** 멤버는 노트 주소로, 공유 대상은 지금 토큰의 공유 주소로, 둘 다 아니면 404. 재발급 뒤에는 새 토큰을 준다. */
  @Test
  void entry_routes_member_vs_share_recipient() throws Exception {
    String token = savePeople(rootId, false, List.of(listedId));

    JsonNode member = json(call(get(entry(rootId)), ownerId).andExpect(status().isOk()));
    assertThat(member.get("spaceId").asLong()).isEqualTo(spaceId);
    assertThat(member.get("member").asBoolean()).isTrue();
    assertThat(member.get("shareToken").isNull()).isTrue();

    JsonNode recipient = json(call(get(entry(rootId)), listedId).andExpect(status().isOk()));
    assertThat(recipient.get("spaceId").asLong()).isEqualTo(spaceId);
    assertThat(recipient.get("member").asBoolean()).isFalse();
    assertThat(recipient.get("shareToken").asText()).isEqualTo(token);

    // 지정한 사람이 아니면 페이지가 있는지도 알려 주지 않는다.
    call(get(entry(rootId)), strangerId).andExpect(status().isNotFound());
    // 하위 포함이 아니면 하위 페이지는 공유 범위 밖 — 404.
    call(get(entry(childId)), listedId).andExpect(status().isNotFound());
    call(get(entry(999_999_999L)), listedId).andExpect(status().isNotFound());

    // 하위 포함으로 넓히면 하위 페이지도 같은 토큰으로 간다.
    String widened = savePeople(rootId, true, List.of(listedId));
    assertThat(widened).isEqualTo(token);
    JsonNode viaRoot = json(call(get(entry(childId)), listedId).andExpect(status().isOk()));
    assertThat(viaRoot.get("member").asBoolean()).isFalse();
    assertThat(viaRoot.get("shareToken").asText()).isEqualTo(token);

    // 지정에서 빠지면 다시 404.
    savePeople(rootId, true, List.of(otherListedId));
    call(get(entry(rootId)), listedId).andExpect(status().isNotFound());
  }

  // ── 헬퍼 ────────────────────────────────────────────────────────────────

  /** 이 유형으로 만들어진 알림의 수신자들(테스트 트랜잭션 안의 행). */
  private List<Long> recipients(NotificationType type) {
    return dsl.select(NOTIFICATION.RECIPIENT_ID)
        .from(NOTIFICATION)
        .where(NOTIFICATION.TYPE.eq(type.name()))
        .and(NOTIFICATION.WIKI_PAGE_ID.eq(rootId))
        .fetch(NOTIFICATION.RECIPIENT_ID);
  }

  private InboxPushRequestedEvent wikiPush(NotificationType type, long pageId, long actorId) {
    return new InboxPushRequestedEvent(
        1L, type, PushCategory.MENTION, List.of(listedId), actorId, null, null, pageId, null);
  }

  private long human() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  private long page(Long parentId, String title) {
    TenantContext.set(1L);
    return pageService.create(ownerId, spaceId, new CreatePageRequest(parentId, title)).id();
  }

  private static String entry(long pageId) {
    return "/api/v1/wiki/pages/" + pageId + "/entry";
  }

  /** 소유자가 PEOPLE 공유를 저장하고 토큰을 돌려준다. 알림 보내기 없음. */
  private String savePeople(long pageId, boolean children, List<Long> userIds) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", "PEOPLE");
    body.put("permission", "VIEW");
    body.put("includeChildren", children);
    body.put("userIds", userIds);
    body.put("expiresAt", null);
    body.put("notify", null);
    JsonNode saved =
        json(
            call(
                    put("/api/v1/wiki/pages/" + pageId + "/share")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(body)),
                    ownerId)
                .andExpect(status().isOk()));
    return saved.get("token").asText();
  }

  /** 소유자가 대상을 바꿔 공유를 저장한다(지정한 사람 없음). */
  private void saveAudience(long pageId, String audience) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", audience);
    body.put("permission", "VIEW");
    body.put("includeChildren", true);
    body.put("userIds", List.of());
    body.put("expiresAt", null);
    body.put("notify", null);
    call(
            put("/api/v1/wiki/pages/" + pageId + "/share")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body)),
            ownerId)
        .andExpect(status().isOk());
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }
}
