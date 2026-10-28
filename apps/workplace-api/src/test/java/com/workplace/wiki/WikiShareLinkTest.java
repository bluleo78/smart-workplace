package com.workplace.wiki;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static com.workplace.jooq.Tables.WIKI_SHARE_ACCESS_REQUEST;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doReturn;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.jooq.tables.records.AuditLogRecord;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.outbound.WikiShareNotifyEvents.WikiShareAccessApprovedEvent;
import com.workplace.wiki.outbound.WikiShareNotifyEvents.WikiShareAccessRequestedEvent;
import com.workplace.wiki.outbound.WikiShareNotifyEvents.WikiSharedWithPeopleEvent;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiShareAccess;
import com.workplace.wiki.service.WikiShareClock;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
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
 * 노트 공유 링크 열기·접근 요청(WP-579 Task 4) — {@code GET /wiki/shares/{token}} 의 범위·조회 수·member 플래그·다른
 * 워크스페이스 링크, 지정한 사람이 아닌 사람의 접근 요청·승인·거절과 알림 이벤트.
 *
 * <p>@Transactional: 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다. 이 안에서는 RLS GUC 가 JWT 의 테넌트와 무관하게 1 에 머무르므로,
 * 다른 워크스페이스 링크는 「JWT 테넌트 ≠ 토큰의 테넌트」 판정(RLS 와 무관하게 {@code wiki_page_share_tenant} 로 한다)만 본다.
 */
@Transactional
@RecordApplicationEvents
class WikiShareLinkTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired ApplicationEvents appEvents;
  // 거절 뒤 재요청 대기(24시간)를 실제 대기 없이 넘기려고 시각만 바꾼다 — 그 밖엔 실제 시계 그대로.
  @Autowired WikiShareClock shareClock;

  private long ownerId; // 스페이스 OWNER, 공유한 사람
  private long editorId; // 스페이스 EDITOR
  private long viewerId; // 스페이스 VIEWER
  private long strangerId; // 같은 워크스페이스, 스페이스 비멤버
  private long listedId; // 같은 워크스페이스, 스페이스 비멤버(PEOPLE 지정 대상)
  private long spaceId;
  private long rootId;
  private long childId;
  private long grandchildId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human();
    editorId = human();
    viewerId = human();
    strangerId = human();
    listedId = human();
    spaceId = spaceService.createTeamSpace(ownerId, "링크열기-" + UUID.randomUUID()).id();
    spaceService.addMember(ownerId, spaceId, editorId, "EDITOR");
    spaceService.addMember(ownerId, spaceId, viewerId, "VIEWER");
    rootId = page(null, "제품 로드맵");
    childId = page(rootId, "1분기");
    grandchildId = page(childId, "1월");
  }

  // ── 링크 열기 ───────────────────────────────────────────────────────────

  /** 하위 포함이면 공유 루트와 그 하위 전체를 트리로, 아니면 루트 하나만. 루트의 parentId 는 가린다(범위 밖 id). */
  @Test
  void resolve_returns_subtree_for_include_children() throws Exception {
    String whole = savePeople(rootId, "WORKSPACE", "VIEW", true, List.of());
    JsonNode r = json(call(get(link(whole)), strangerId).andExpect(status().isOk()));
    assertThat(r.get("rootPageId").asLong()).isEqualTo(rootId);
    assertThat(r.get("spaceId").asLong()).isEqualTo(spaceId);
    assertThat(r.get("permission").asText()).isEqualTo("VIEW");
    assertThat(r.get("includeChildren").asBoolean()).isTrue();
    assertThat(r.get("sharedBy").get("userId").asLong()).isEqualTo(ownerId);
    assertThat(r.get("sharedBy").get("name").asText()).isNotBlank();
    assertThat(r.get("member").asBoolean()).isFalse();
    assertThat(pageIds(r)).containsExactlyInAnyOrder(rootId, childId, grandchildId);
    JsonNode root = pageNode(r, rootId);
    assertThat(root.get("parentId").isNull()).isTrue();
    assertThat(root.get("title").asText()).isEqualTo("제품 로드맵");
    assertThat(pageNode(r, childId).get("parentId").asLong()).isEqualTo(rootId);

    // 하위 포함을 끄면 루트 하나.
    savePeople(rootId, "WORKSPACE", "VIEW", false, List.of());
    JsonNode only = json(call(get(link(whole)), strangerId).andExpect(status().isOk()));
    assertThat(pageIds(only)).containsExactly(rootId);
    assertThat(only.get("includeChildren").asBoolean()).isFalse();
  }

  /** 열 때마다 조회 수 +1 과 마지막 열람 시각 — 같은 사람이 다시 열어도, 멤버가 열어도 센다. 감사 로그에는 남기지 않는다. */
  @Test
  void resolve_counts_views() throws Exception {
    String token = savePeople(rootId, "WORKSPACE", "VIEW", false, List.of());
    assertThat(viewCount(rootId)).isZero();
    assertThat(lastAccessed(rootId)).isNull();

    call(get(link(token)), strangerId).andExpect(status().isOk());
    call(get(link(token)), strangerId).andExpect(status().isOk());
    call(get(link(token)), viewerId).andExpect(status().isOk());

    assertThat(viewCount(rootId)).isEqualTo(3);
    assertThat(lastAccessed(rootId)).isNotNull();
    // 열람은 감사 로그에 한 건씩 남기지 않는다 — 공유 생성 감사만.
    assertThat(
            dsl.fetchCount(
                AUDIT_LOG,
                AUDIT_LOG
                    .RESOURCE
                    .eq("wiki")
                    .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(rootId)))
                    .and(AUDIT_LOG.ACTION_TYPE.like("WIKI_SHARE_%"))))
        .isEqualTo(1);

    // 열 수 없는 요청(없는 링크)은 세지 않는다.
    call(get(link("wsh_nope")), strangerId).andExpect(status().isNotFound());
    assertThat(viewCount(rootId)).isEqualTo(3);
  }

  /** member 는 스페이스 멤버 역할이 공유 역할 이상일 때만 true — 보기 멤버가 편집 링크를 열면 false(공유 화면에서 편집한다). */
  @Test
  void resolve_member_flag_only_when_member_role_covers() throws Exception {
    String viewLink = savePeople(rootId, "WORKSPACE", "VIEW", false, List.of());
    assertThat(member(viewLink, ownerId)).isTrue();
    assertThat(member(viewLink, editorId)).isTrue();
    assertThat(member(viewLink, viewerId)).isTrue();
    assertThat(member(viewLink, strangerId)).isFalse();

    String editLink = savePeople(rootId, "WORKSPACE", "EDIT", false, List.of());
    assertThat(editLink).isEqualTo(viewLink); // 같은 페이지 공유 — 토큰 유지
    assertThat(member(editLink, ownerId)).isTrue();
    assertThat(member(editLink, editorId)).isTrue();
    assertThat(member(editLink, viewerId)).isFalse();
    assertThat(member(editLink, strangerId)).isFalse();

    // 지정한 사람 링크 — 비멤버는 지정돼야 열리지만, 역할이 공유 역할을 채우는 멤버는 지정되지 않아도 열린다(member=true).
    String people = savePeople(rootId, "PEOPLE", "VIEW", false, List.of(listedId));
    assertThat(member(people, viewerId)).isTrue();
    assertThat(member(people, listedId)).isFalse();
    call(get(link(people)), strangerId).andExpect(status().isForbidden());
    // 멤버의 역할이 공유 역할에 못 미치고(편집 링크의 VIEWER) 지정되지도 않았으면 접근 요청(403)이 아니라 자기 스페이스 역할로 연다 —
    // 「스페이스 역할과 공유 역할 중 높은 쪽」이므로 최소한 보기다. 멤버 화면(member=true)으로 가서 보기로 연다.
    savePeople(rootId, "PEOPLE", "EDIT", false, List.of(listedId));
    assertThat(member(people, viewerId)).isTrue();
    callWithShare(get("/api/v1/wiki/pages/{id}", rootId), viewerId, people)
        .andExpect(status().isOk());
    // 멤버는 요청할 필요가 없다 — 접근 요청을 보내도 아무것도 만들지 않는다.
    call(post(link(people) + "/access-requests"), viewerId).andExpect(status().isOk());
    assertThat(pendingRows(rootId, viewerId)).isZero();
    assertThat(member(people, editorId)).isTrue();
    call(get(link(people)), strangerId).andExpect(status().isForbidden());
  }

  /** 다른 워크스페이스의 링크 — 토큰의 워크스페이스 멤버이면 409 + 그 워크스페이스 id(자동 전환용). */
  @Test
  void resolve_other_tenant_member_gets_409_with_tenant() throws Exception {
    String token = savePeople(rootId, "WORKSPACE", "VIEW", false, List.of());
    long otherTenant = ensureFixtureTenant("wsh-link-other");
    long both = human(); // 테넌트 1 과 다른 워크스페이스 양쪽 멤버
    TestFixtures.addMember(dsl, both, otherTenant);

    JsonNode body =
        json(
            callAs(get(link(token)), both, otherTenant)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("WIKI_SHARE_OTHER_TENANT"))
                .andExpect(jsonPath("$.tenantId").value(1)));
    assertThat(body.get("status").asInt()).isEqualTo(409);
    // 다른 워크스페이스 링크는 열람으로 세지 않는다.
    assertThat(viewCount(rootId)).isZero();
  }

  /** 다른 워크스페이스의 링크를 그 워크스페이스 멤버가 아닌 사람이 열면 404 — 링크가 어느 워크스페이스 것인지 알려 주지 않는다. */
  @Test
  void resolve_other_tenant_nonmember_404() throws Exception {
    String token = savePeople(rootId, "WORKSPACE", "VIEW", false, List.of());
    long otherTenant = ensureFixtureTenant("wsh-link-other");
    long outsider = TestFixtures.createHuman(dsl);
    TestFixtures.addMember(dsl, outsider, otherTenant);

    JsonNode body =
        json(callAs(get(link(token)), outsider, otherTenant).andExpect(status().isNotFound()));
    assertThat(body.has("tenantId")).isFalse();
    assertThat(body.has("code")).isFalse();
  }

  /**
   * 다른 워크스페이스에 로그인한 사람이 그 워크스페이스 멤버가 아닌데 외부(PUBLIC) 링크를 열면 409 {code:WIKI_SHARE_PUBLIC} — 웹은 비로그인과
   * 같은 외부 보기를 그린다. 전환할 워크스페이스(tenantId)는 싣지 않는다. 외부 공유가 꺼졌으면 외부 링크도 없는 링크라 404.
   */
  @Test
  void resolve_other_tenant_nonmember_public_link_points_to_public_view() throws Exception {
    String token = savePeople(rootId, "PUBLIC", "VIEW", false, List.of());
    long otherTenant = ensureFixtureTenant("wsh-link-other");
    long outsider = TestFixtures.createHuman(dsl);
    TestFixtures.addMember(dsl, outsider, otherTenant);

    JsonNode body =
        json(callAs(get(link(token)), outsider, otherTenant).andExpect(status().isConflict()));
    assertThat(body.get("code").asText()).isEqualTo("WIKI_SHARE_PUBLIC");
    assertThat(body.has("tenantId")).isFalse();
    assertThat(viewCount(rootId)).isZero(); // 외부 보기가 다시 열며 센다 — 여기서 세지 않는다

    dsl.update(TENANT)
        .set(TENANT.WIKI_EXTERNAL_SHARE_ENABLED, false)
        .where(TENANT.ID.eq(1L))
        .execute();
    try {
      json(callAs(get(link(token)), outsider, otherTenant).andExpect(status().isNotFound()));
    } finally {
      dsl.update(TENANT)
          .set(TENANT.WIKI_EXTERNAL_SHARE_ENABLED, true)
          .where(TENANT.ID.eq(1L))
          .execute();
    }
  }

  /** 없는 토큰·해제된 링크·만료는 모두 404. */
  @Test
  void resolve_unknown_or_revoked_is_404() throws Exception {
    call(get(link("wsh_unknown")), strangerId).andExpect(status().isNotFound());
    String token = savePeople(rootId, "WORKSPACE", "VIEW", false, List.of());
    call(get(link(token)), strangerId).andExpect(status().isOk());
    call(delete(sharePath(rootId)), ownerId).andExpect(status().isNoContent());
    call(get(link(token)), strangerId).andExpect(status().isNotFound());
  }

  // ── 접근 요청 ───────────────────────────────────────────────────────────

  /**
   * 지정한 사람이 아니면 403 {requested:false} → 접근 요청(200 PENDING) → 같은 링크 403 {requested:true}. 두 번째 요청도
   * 200 PENDING 이고 요청·기록·이벤트는 하나뿐. 요청은 공유 루트 페이지 id 로 저장되어, 하위 페이지를 열 때의 403 도 requested=true 를
   * 돌려준다.
   */
  @Test
  void people_unlisted_403_requestable_then_request_then_requested_true() throws Exception {
    String token = savePeople(rootId, "PEOPLE", "VIEW", true, List.of(listedId));
    call(get(link(token)), listedId).andExpect(status().isOk());

    call(get(link(token)), strangerId)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.requested").value(false));
    assertThat(viewCount(rootId)).isEqualTo(1); // 거절된 열기는 세지 않는다

    call(post(link(token) + "/access-requests"), strangerId).andExpect(status().isOk());
    call(get(link(token)), strangerId)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.requested").value(true));
    // 하위 페이지를 공유 헤더로 열 때도 같은 요청을 본다(요청은 공유 루트 page_id).
    callWithShare(get("/api/v1/wiki/pages/{id}", grandchildId), strangerId, token)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.requested").value(true));

    // 이미 대기 중이면 PENDING 그대로, 새 요청·기록·이벤트 없음.
    call(post(link(token) + "/access-requests"), strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"));
    List<WikiShareAccessRequestedEvent> events =
        appEvents.stream(WikiShareAccessRequestedEvent.class).toList();
    assertThat(events).hasSize(1);
    assertThat(events.get(0).tenantId()).isEqualTo(1L);
    assertThat(events.get(0).pageId()).isEqualTo(rootId);
    assertThat(events.get(0).requesterId()).isEqualTo(strangerId);
    assertThat(events.get(0).sharerId()).isEqualTo(ownerId);
    assertThat(pendingRows(rootId, strangerId)).isEqualTo(1);
    assertThat(historyTypes(rootId)).containsOnlyOnce("ACCESS_REQUESTED");

    // 공유 창 상태에 대기 요청이 보인다.
    JsonNode state = json(call(get(sharePath(rootId)), ownerId).andExpect(status().isOk()));
    assertThat(state.get("accessRequests")).hasSize(1);
    assertThat(state.get("accessRequests").get(0).get("requester").get("userId").asLong())
        .isEqualTo(strangerId);
  }

  /** 요청할 필요가 없는 경우는 NOT_NEEDED 로 아무 일도 하지 않는다 — 이미 지정됨, 멤버, 지정한 사람 링크가 아님. 없는 링크는 404. */
  @Test
  void request_is_noop_when_not_needed() throws Exception {
    String people = savePeople(rootId, "PEOPLE", "VIEW", false, List.of(listedId));
    call(post(link(people) + "/access-requests"), listedId).andExpect(status().isOk());
    call(post(link(people) + "/access-requests"), viewerId).andExpect(status().isOk());
    String workspace = savePeople(childId, "WORKSPACE", "VIEW", false, List.of());
    call(post(link(workspace) + "/access-requests"), strangerId).andExpect(status().isOk());
    assertThat(dsl.fetchCount(WIKI_SHARE_ACCESS_REQUEST)).isZero();
    assertThat(appEvents.stream(WikiShareAccessRequestedEvent.class)).isEmpty();

    call(post(link("wsh_nope") + "/access-requests"), strangerId).andExpect(status().isNotFound());
  }

  /**
   * 승인 — 요청자가 지정한 사람에 더해지고(기록 PEOPLE_ADDED·ACCESS_APPROVED, 감사 WIKI_SHARE_PEOPLE_CHANGED
   * viaRequest=true), 요청은 APPROVED, 요청자 알림 이벤트. 그 뒤 요청자는 링크를 열 수 있다. 승인은 알림 보내기
   * 이벤트(SharedWithPeople)를 따로 내지 않는다.
   */
  @Test
  void approve_adds_person_and_publishes_events() throws Exception {
    String token = savePeople(rootId, "PEOPLE", "VIEW", false, List.of(listedId));
    call(post(link(token) + "/access-requests"), strangerId).andExpect(status().isOk());
    long reqId = pendingRequestId(rootId, strangerId);
    appEvents.clear();

    // 편집자 미만은 결정하지 못한다.
    call(post(decide(rootId, reqId, "approve")), viewerId).andExpect(status().isForbidden());
    call(post(decide(rootId, reqId, "approve")), editorId).andExpect(status().isNoContent());

    call(get(link(token)), strangerId).andExpect(status().isOk());
    JsonNode state = json(call(get(sharePath(rootId)), ownerId).andExpect(status().isOk()));
    assertThat(state.get("accessRequests")).isEmpty();
    List<Long> people = new ArrayList<>();
    state.get("share").get("people").forEach(p -> people.add(p.get("userId").asLong()));
    assertThat(people).containsExactlyInAnyOrder(listedId, strangerId);

    assertThat(requestStatus(reqId)).isEqualTo("APPROVED");
    assertThat(
            dsl.select(WIKI_SHARE_ACCESS_REQUEST.DECIDED_BY)
                .from(WIKI_SHARE_ACCESS_REQUEST)
                .where(WIKI_SHARE_ACCESS_REQUEST.ID.eq(reqId))
                .fetchOne(0, Long.class))
        .isEqualTo(editorId);
    assertThat(historyTypes(rootId)).contains("PEOPLE_ADDED", "ACCESS_APPROVED");

    List<AuditLogRecord> audits = audits(rootId, "WIKI_SHARE_PEOPLE_CHANGED");
    AuditLogRecord viaRequest = audits.get(0); // 최신순 — 승인으로 남은 것
    JsonNode meta = om.readTree(viaRequest.getMetadata().data());
    assertThat(viaRequest.getUserId()).isEqualTo(editorId);
    assertThat(meta.get("viaRequest").asBoolean()).isTrue();
    assertThat(meta.get("added")).hasSize(1);
    assertThat(meta.get("added").get(0).asLong()).isEqualTo(strangerId);
    assertThat(meta.get("removed")).isEmpty();

    List<WikiShareAccessApprovedEvent> approved =
        appEvents.stream(WikiShareAccessApprovedEvent.class).toList();
    assertThat(approved).hasSize(1);
    assertThat(approved.get(0).tenantId()).isEqualTo(1L);
    assertThat(approved.get(0).pageId()).isEqualTo(rootId);
    assertThat(approved.get(0).approverId()).isEqualTo(editorId);
    assertThat(approved.get(0).requesterId()).isEqualTo(strangerId);
    assertThat(appEvents.stream(WikiSharedWithPeopleEvent.class)).isEmpty();

    // 이미 결정된 요청·다른 페이지의 요청은 다시 결정할 수 없다(404).
    call(post(decide(rootId, reqId, "approve")), ownerId).andExpect(status().isNotFound());
    call(post(decide(rootId, reqId, "deny")), ownerId).andExpect(status().isNotFound());
    call(post(decide(childId, reqId, "approve")), ownerId).andExpect(status().isNotFound());
  }

  /**
   * 거절 — 요청은 DENIED, 감사 WIKI_SHARE_ACCESS_DENIED(requesterId), 기록 ACCESS_DENIED. 사람은 더해지지 않고 알림
   * 이벤트도 없다. 다시 요청할 수 있다.
   */
  @Test
  void deny_audits_access_denied() throws Exception {
    String token = savePeople(rootId, "PEOPLE", "VIEW", false, List.of(listedId));
    call(post(link(token) + "/access-requests"), strangerId).andExpect(status().isOk());
    long reqId = pendingRequestId(rootId, strangerId);
    appEvents.clear();

    call(post(decide(rootId, reqId, "deny")), viewerId).andExpect(status().isForbidden());
    call(post(decide(rootId, reqId, "deny")), ownerId).andExpect(status().isNoContent());

    assertThat(requestStatus(reqId)).isEqualTo("DENIED");
    call(get(link(token)), strangerId)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.requested").value(false));
    assertThat(historyTypes(rootId)).contains("ACCESS_DENIED");
    // 지정한 사람은 그대로(만들 때의 listedId 뿐) — 거절은 사람을 더하지 않는다.
    JsonNode state = json(call(get(sharePath(rootId)), ownerId).andExpect(status().isOk()));
    assertThat(state.get("share").get("people")).hasSize(1);
    assertThat(state.get("share").get("people").get(0).get("userId").asLong()).isEqualTo(listedId);

    List<AuditLogRecord> audits = audits(rootId, "WIKI_SHARE_ACCESS_DENIED");
    assertThat(audits).hasSize(1);
    assertThat(audits.get(0).getUserId()).isEqualTo(ownerId);
    assertThat(audits.get(0).getDescription()).isEqualTo("노트 공유 요청 거절");
    JsonNode meta = om.readTree(audits.get(0).getMetadata().data());
    assertThat(meta.get("requesterId").asLong()).isEqualTo(strangerId);
    assertThat(meta.get("spaceId").asLong()).isEqualTo(spaceId);
    assertThat(meta.get("audience").asText()).isEqualTo("PEOPLE");
    assertThat(meta.get("permission").asText()).isEqualTo("VIEW");
    assertThat(appEvents.stream(WikiShareAccessApprovedEvent.class)).isEmpty();

    // 거절 직후(24시간 안) 다시 요청하면 새 요청 없이 거절 상태를 돌려준다 — 같은 사람에게 알림이 되풀이되지 않게.
    call(post(link(token) + "/access-requests"), strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("DENIED"));
    assertThat(pendingRows(rootId, strangerId)).isZero();
  }

  /** 공유를 해제하면 대기 중 요청도 지운다 — 다시 공유해도 옛 요청이 되살아나지 않는다. 이미 결정된 요청은 기록으로 남는다. */
  @Test
  void revoke_deletes_pending_requests() throws Exception {
    String token = savePeople(rootId, "PEOPLE", "VIEW", false, List.of(listedId));
    call(post(link(token) + "/access-requests"), strangerId).andExpect(status().isOk());
    call(post(link(token) + "/access-requests"), viewerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("NOT_NEEDED")); // 멤버 — 요청 없음
    long decided = pendingRequestId(rootId, strangerId);
    call(post(decide(rootId, decided, "deny")), ownerId).andExpect(status().isNoContent());
    // 거절 뒤 24시간이 지나 다시 요청했다 — 대기 요청 하나.
    doReturn(Instant.now().plus(Duration.ofHours(25))).when(shareClock).now();
    call(post(link(token) + "/access-requests"), strangerId).andExpect(status().isOk());
    assertThat(pendingRows(rootId, strangerId)).isEqualTo(1);

    call(delete(sharePath(rootId)), ownerId).andExpect(status().isNoContent());
    assertThat(pendingRows(rootId, strangerId)).isZero();
    assertThat(requestStatus(decided)).isEqualTo("DENIED");

    // 다시 공유하면 대기 요청이 비어 있다.
    String again = savePeople(rootId, "PEOPLE", "VIEW", false, List.of(listedId));
    JsonNode state = json(call(get(sharePath(rootId)), ownerId).andExpect(status().isOk()));
    assertThat(state.get("accessRequests")).isEmpty();
    call(get(link(again)), strangerId)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.requested").value(false));
  }

  /**
   * 지정한 사람 공유를 다른 대상(워크스페이스 전체)으로 바꾸면 대기 중 요청을 지운다 — 요청이 뜻을 잃었고, 다시 지정한 사람으로 돌려도 옛 요청이 공유 창에 되살아나지
   * 않는다. 결정된 요청은 기록으로 남는다.
   */
  @Test
  void leaving_people_audience_deletes_pending_requests() throws Exception {
    String token = savePeople(rootId, "PEOPLE", "VIEW", false, List.of(listedId));
    call(post(link(token) + "/access-requests"), strangerId).andExpect(status().isOk());
    assertThat(pendingRows(rootId, strangerId)).isEqualTo(1);

    savePeople(rootId, "WORKSPACE", "VIEW", false, List.of());
    assertThat(pendingRows(rootId, strangerId)).isZero();

    savePeople(rootId, "PEOPLE", "VIEW", false, List.of(listedId));
    JsonNode state = json(call(get(sharePath(rootId)), ownerId).andExpect(status().isOk()));
    assertThat(state.get("accessRequests")).isEmpty();
  }

  /**
   * 승인은 지정한 사람 공유에서만 — 대상이 바뀐 뒤 남은 요청(경합)을 승인하면 409 이고, 요청은 대기 그대로·승인 기록·알림 이벤트가 없다(지정 목록이 없는 공유에
   * 「승인했습니다」만 남지 않게).
   */
  @Test
  void approve_rejected_when_share_is_not_people() throws Exception {
    savePeople(rootId, "WORKSPACE", "VIEW", false, List.of());
    // 대상 변경과 요청이 엇갈려 남은 대기 요청 — API 로는 만들 수 없어 직접 넣는다.
    long reqId =
        dsl.insertInto(WIKI_SHARE_ACCESS_REQUEST)
            .set(WIKI_SHARE_ACCESS_REQUEST.PAGE_ID, rootId)
            .set(WIKI_SHARE_ACCESS_REQUEST.REQUESTER_ID, strangerId)
            .returning(WIKI_SHARE_ACCESS_REQUEST.ID)
            .fetchOne()
            .getId();
    appEvents.clear();

    call(post(decide(rootId, reqId, "approve")), ownerId).andExpect(status().isConflict());

    assertThat(requestStatus(reqId)).isEqualTo("PENDING");
    assertThat(historyTypes(rootId)).doesNotContain("ACCESS_APPROVED", "PEOPLE_ADDED");
    assertThat(appEvents.stream(WikiShareAccessApprovedEvent.class)).isEmpty();
  }

  /**
   * 거절된 사람이 같은 공유에 24시간 안에 다시 요청하면 새 요청·알림을 만들지 않고 거절 상태(DENIED)를 돌려준다 — 거절할 때마다 공유한 사람에게 알림이 다시 가는
   * 재요청 폭주를 막는다. 403 응답에도 denied 가 실려 받는 화면이 처음부터 「거절됨」을 보인다. 24시간이 지나면 다시 대기 요청을 만든다(시계 주입으로 실제 대기
   * 없이). 거절 뒤 공유를 새로 만들었으면(다른 공유) 그 거절은 세지 않는다.
   */
  @Test
  void re_request_within_24h_of_denial_returns_denied_without_new_request() throws Exception {
    String token = savePeople(rootId, "PEOPLE", "VIEW", false, List.of(listedId));
    call(post(link(token) + "/access-requests"), strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"));
    long reqId = pendingRequestId(rootId, strangerId);
    call(post(decide(rootId, reqId, "deny")), ownerId).andExpect(status().isNoContent());
    appEvents.clear();

    call(get(link(token)), strangerId)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.requested").value(false))
        .andExpect(jsonPath("$.denied").value(true));
    call(post(link(token) + "/access-requests"), strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("DENIED"));
    assertThat(pendingRows(rootId, strangerId)).isZero();
    assertThat(appEvents.stream(WikiShareAccessRequestedEvent.class)).isEmpty();

    // 24시간 뒤 — 새 대기 요청과 알림 이벤트 하나.
    doReturn(Instant.now().plus(Duration.ofHours(24)).plusSeconds(60)).when(shareClock).now();
    call(get(link(token)), strangerId)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.denied").value(false));
    call(post(link(token) + "/access-requests"), strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"));
    assertThat(pendingRows(rootId, strangerId)).isEqualTo(1);
    assertThat(appEvents.stream(WikiShareAccessRequestedEvent.class)).hasSize(1);
  }

  /**
   * 앱 시계가 DB 시계보다 늦어도(API 서버와 DB 서버의 시계 차이) 방금 한 거절이 「지금 공유」의 거절로 잡힌다. 거절 시각은 앱 시계, 공유를 만든 시각은 DB
   * now() 라 둘을 직접 비교하면 시계 차이만큼 거절이 빠졌다 — 「같은 공유」 판정은 같은 DB 시계로 찍힌 요청 시각과 공유 시각으로 한다.
   */
  @Test
  void denial_counts_even_when_app_clock_lags_db_clock() throws Exception {
    String token = savePeople(rootId, "PEOPLE", "VIEW", false, List.of(listedId));
    call(post(link(token) + "/access-requests"), strangerId).andExpect(status().isOk());
    long reqId = pendingRequestId(rootId, strangerId);
    // 앱 시계를 DB 시계(공유·요청을 만든 시각)보다 5초 늦게 둔다.
    doReturn(Instant.now().minusSeconds(5)).when(shareClock).now();
    call(post(decide(rootId, reqId, "deny")), ownerId).andExpect(status().isNoContent());

    call(get(link(token)), strangerId)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.denied").value(true));
    call(post(link(token) + "/access-requests"), strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("DENIED"));
    assertThat(pendingRows(rootId, strangerId)).isZero();
  }

  /**
   * 요청 트랜잭션이 공유 생성 커밋보다 먼저 시작했어도(요청 행의 created_at 이 트랜잭션 시작 시각 now() 라면 공유 생성 시각보다 앞선다) 그 새 공유에 만든
   * 요청의 거절은 「지금 공유」의 거절로 잡힌다 — 요청 시각은 실제 DB 시각(clock_timestamp)으로 찍는다. 테스트 트랜잭션은 now() 가 시작 시각에
   * 고정되므로, 공유 생성 시각을 시작 시각 뒤(실제 DB 시각)로 옮겨 「트랜잭션을 먼저 연 뒤 공유가 생긴」 상황을 만든다.
   */
  @Test
  void denial_counts_when_request_tx_started_before_share_was_created() throws Exception {
    String token = savePeople(rootId, "PEOPLE", "VIEW", false, List.of(listedId));
    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.CREATED_AT, DSL.field("clock_timestamp()", OffsetDateTime.class))
        .where(WIKI_PAGE_SHARE.PAGE_ID.eq(rootId))
        .execute();
    call(post(link(token) + "/access-requests"), strangerId).andExpect(status().isOk());
    call(post(decide(rootId, pendingRequestId(rootId, strangerId), "deny")), ownerId)
        .andExpect(status().isNoContent());

    call(get(link(token)), strangerId)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.denied").value(true));
    call(post(link(token) + "/access-requests"), strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("DENIED"));
  }

  /** 거절 뒤 공유가 새로 만들어졌으면(해제 후 다시 공유) 옛 공유의 거절은 재요청을 막지 않는다 — 「같은 공유」에만 대기 시간이 걸린다. */
  @Test
  void denial_of_previous_share_does_not_block_new_share() throws Exception {
    String token = savePeople(rootId, "PEOPLE", "VIEW", false, List.of(listedId));
    call(post(link(token) + "/access-requests"), strangerId).andExpect(status().isOk());
    call(post(decide(rootId, pendingRequestId(rootId, strangerId), "deny")), ownerId)
        .andExpect(status().isNoContent());
    call(delete(sharePath(rootId)), ownerId).andExpect(status().isNoContent());
    String again = savePeople(rootId, "PEOPLE", "VIEW", false, List.of(listedId));
    // 한 테스트 트랜잭션 안이라 DB now()(만든 시각)가 고정된다 — 거절보다 뒤에 만든 공유로 시각을 옮겨 「새 공유」를 만든다.
    // 거절·요청 시각과 같은 DB 시계(clock_timestamp)로 옮긴다 — 앱 시계면 시계 차이만큼 순서가 뒤집힐 수 있다.
    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.CREATED_AT, DSL.field("clock_timestamp()", OffsetDateTime.class))
        .where(WIKI_PAGE_SHARE.PAGE_ID.eq(rootId))
        .execute();

    call(get(link(again)), strangerId)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.denied").value(false));
    call(post(link(again) + "/access-requests"), strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"));
    assertThat(pendingRows(rootId, strangerId)).isEqualTo(1);
  }

  // ── 알림 이벤트 ─────────────────────────────────────────────────────────

  /** 알림 보내기를 켜고 저장하면 새로 추가한 사람에게만 SharedWithPeople 이벤트 — 이미 있던 사람·알림 보내기를 끈 저장은 내지 않는다. */
  @Test
  void save_with_notify_publishes_shared_with_people_only_for_added() throws Exception {
    long second = human();
    long third = human();
    saveWithNotify(rootId, List.of(listedId), Map.of("message", "확인 부탁드려요"));
    List<WikiSharedWithPeopleEvent> first =
        appEvents.stream(WikiSharedWithPeopleEvent.class).toList();
    assertThat(first).hasSize(1);
    assertThat(first.get(0).tenantId()).isEqualTo(1L);
    assertThat(first.get(0).pageId()).isEqualTo(rootId);
    assertThat(first.get(0).actorId()).isEqualTo(ownerId);
    assertThat(first.get(0).recipientIds()).containsExactly(listedId);
    assertThat(first.get(0).message()).isEqualTo("확인 부탁드려요");
    appEvents.clear();

    // 이미 있던 사람은 빼고 새로 더한 사람만. 메시지가 없으면 null.
    saveWithNotify(rootId, List.of(listedId, second), Map.of());
    List<WikiSharedWithPeopleEvent> next =
        appEvents.stream(WikiSharedWithPeopleEvent.class).toList();
    assertThat(next).hasSize(1);
    assertThat(next.get(0).recipientIds()).containsExactly(second);
    assertThat(next.get(0).message()).isNull();
    appEvents.clear();

    // 알림 보내기를 끄면(notify 없음) 사람이 더해져도 이벤트가 없다.
    saveWithNotify(rootId, List.of(listedId, second, third), null);
    assertThat(appEvents.stream(WikiSharedWithPeopleEvent.class)).isEmpty();
    // 더한 사람이 없으면 알림 보내기를 켜도 이벤트가 없다.
    saveWithNotify(rootId, List.of(listedId, second, third), Map.of("message", "다시"));
    assertThat(appEvents.stream(WikiSharedWithPeopleEvent.class)).isEmpty();
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  private long human() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  private long page(Long parentId, String title) {
    TenantContext.set(1L);
    return pageService.create(ownerId, spaceId, new CreatePageRequest(parentId, title)).id();
  }

  private static String link(String token) {
    return "/api/v1/wiki/shares/" + token;
  }

  private static String sharePath(long pageId) {
    return "/api/v1/wiki/pages/" + pageId + "/share";
  }

  private static String decide(long pageId, long reqId, String verb) {
    return sharePath(pageId) + "/access-requests/" + reqId + "/" + verb;
  }

  /** 소유자가 공유를 저장(만들기·바꾸기)하고 토큰을 돌려준다. 알림 보내기 없음. */
  private String savePeople(
      long pageId, String audience, String permission, boolean children, List<Long> userIds)
      throws Exception {
    return saveWith(pageId, audience, permission, children, userIds, null);
  }

  private void saveWithNotify(long pageId, List<Long> userIds, Map<String, Object> notify)
      throws Exception {
    saveWith(pageId, "PEOPLE", "VIEW", false, userIds, notify);
  }

  private String saveWith(
      long pageId,
      String audience,
      String permission,
      boolean children,
      List<Long> userIds,
      Map<String, Object> notify)
      throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", audience);
    body.put("permission", permission);
    body.put("includeChildren", children);
    body.put("userIds", userIds);
    body.put("expiresAt", null);
    body.put("notify", notify);
    JsonNode saved =
        json(
            call(
                    put(sharePath(pageId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(body)),
                    ownerId)
                .andExpect(status().isOk()));
    return saved.get("token").asText();
  }

  private boolean member(String token, long userId) throws Exception {
    return json(call(get(link(token)), userId).andExpect(status().isOk()))
        .get("member")
        .asBoolean();
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    return callAs(req, userId, 1L);
  }

  /** 지정한 워크스페이스(JWT 테넌트)로 요청한다 — 끝나면 테스트 스레드의 TenantContext 를 1 로 되돌린다. */
  private ResultActions callAs(MockHttpServletRequestBuilder req, long userId, long tenantId)
      throws Exception {
    req.header(
        "Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, tenantId));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  private ResultActions callWithShare(MockHttpServletRequestBuilder req, long userId, String token)
      throws Exception {
    req.header(WikiShareAccess.HEADER, token);
    return call(req, userId);
  }

  private long viewCount(long pageId) {
    return dsl.select(WIKI_PAGE_SHARE.VIEW_COUNT)
        .from(WIKI_PAGE_SHARE)
        .where(WIKI_PAGE_SHARE.PAGE_ID.eq(pageId))
        .fetchOne(0, Long.class);
  }

  /** now() 는 트랜잭션 시작 시각으로 고정되므로 시각 비교 대신 값이 채워졌는지만 본다. */
  private Object lastAccessed(long pageId) {
    return dsl.select(WIKI_PAGE_SHARE.LAST_ACCESSED_AT)
        .from(WIKI_PAGE_SHARE)
        .where(WIKI_PAGE_SHARE.PAGE_ID.eq(pageId))
        .fetchOne(0);
  }

  private int pendingRows(long pageId, long requesterId) {
    return dsl.fetchCount(
        WIKI_SHARE_ACCESS_REQUEST,
        WIKI_SHARE_ACCESS_REQUEST
            .PAGE_ID
            .eq(pageId)
            .and(WIKI_SHARE_ACCESS_REQUEST.REQUESTER_ID.eq(requesterId))
            .and(WIKI_SHARE_ACCESS_REQUEST.STATUS.eq("PENDING")));
  }

  private long pendingRequestId(long pageId, long requesterId) {
    return dsl.select(WIKI_SHARE_ACCESS_REQUEST.ID)
        .from(WIKI_SHARE_ACCESS_REQUEST)
        .where(WIKI_SHARE_ACCESS_REQUEST.PAGE_ID.eq(pageId))
        .and(WIKI_SHARE_ACCESS_REQUEST.REQUESTER_ID.eq(requesterId))
        .and(WIKI_SHARE_ACCESS_REQUEST.STATUS.eq("PENDING"))
        .fetchOne(0, Long.class);
  }

  private String requestStatus(long reqId) {
    return dsl.select(WIKI_SHARE_ACCESS_REQUEST.STATUS)
        .from(WIKI_SHARE_ACCESS_REQUEST)
        .where(WIKI_SHARE_ACCESS_REQUEST.ID.eq(reqId))
        .fetchOne(0, String.class);
  }

  /** 공유 기록(최신순)의 type 목록. */
  private List<String> historyTypes(long pageId) throws Exception {
    JsonNode events =
        json(call(get(sharePath(pageId) + "/events"), ownerId).andExpect(status().isOk()));
    List<String> out = new ArrayList<>();
    events.forEach(e -> out.add(e.get("type").asText()));
    return out;
  }

  private List<AuditLogRecord> audits(long pageId, String actionType) {
    return dsl.selectFrom(AUDIT_LOG)
        .where(AUDIT_LOG.ACTION_TYPE.eq(actionType))
        .and(AUDIT_LOG.RESOURCE.eq("wiki"))
        .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(pageId)))
        .orderBy(AUDIT_LOG.ID.desc())
        .fetch();
  }

  private static List<Long> pageIds(JsonNode resolved) {
    List<Long> out = new ArrayList<>();
    resolved.get("pages").forEach(p -> out.add(p.get("id").asLong()));
    return out;
  }

  private static JsonNode pageNode(JsonNode resolved, long id) {
    for (JsonNode p : resolved.get("pages")) {
      if (p.get("id").asLong() == id) {
        return p;
      }
    }
    throw new AssertionError("pages 에 " + id + " 가 없다");
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }
}
