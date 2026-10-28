package com.workplace.wiki;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_EVENT;
import static com.workplace.jooq.Tables.WIKI_SHARE_ACCESS_REQUEST;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
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
import com.workplace.wiki.outbound.WikiDomainEvents.WikiShareAccessChangedEvent;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiShareAccess;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 공유 목록·트리 표시·관리자 정책(WP-579 Task 5) — 스페이스·내 공유 목록, 트리 행의 공유 표시와 상세의 {@code shared}, 관리자 외부 공유
 * 스위치·전체 목록·일괄 해제.
 *
 * <p>공유는 설정 API(PUT)로 만들어 기록·감사·재검증 이벤트가 실제 경로로 남게 한다. @Transactional: MockMvc 요청이 같은 스레드의 테스트
 * 트랜잭션에 합류해 시드를 보고, 끝나면 롤백된다(관리자 스위치·역할 부여도 함께 되돌려진다).
 */
@Transactional
@RecordApplicationEvents
class WikiShareAdminTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired ApplicationEvents appEvents;

  /** PNG 매직바이트 + 채움 — 첨부 업로드의 이미지 판정용. */
  private static final byte[] PNG = {
    (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0
  };

  private long ownerId; // 두 스페이스의 OWNER
  private long editorId; // 스페이스1 EDITOR
  private long viewerId; // 스페이스1 VIEWER
  private long strangerId; // 같은 테넌트, 스페이스 비멤버
  private long adminId; // 시스템 ADMIN 역할(스페이스 멤버 아님)
  private long spaceId;
  private long otherSpaceId;
  private long rootId;
  private long childId;
  private long otherPageId; // 스페이스2 의 페이지

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human();
    editorId = human();
    viewerId = human();
    strangerId = human();
    adminId = human();
    grantAdminRole(adminId);
    spaceId = spaceService.createTeamSpace(ownerId, "공유목록-" + UUID.randomUUID()).id();
    otherSpaceId = spaceService.createTeamSpace(ownerId, "공유목록2-" + UUID.randomUUID()).id();
    spaceService.addMember(ownerId, spaceId, editorId, "EDITOR");
    spaceService.addMember(ownerId, spaceId, viewerId, "VIEWER");
    rootId = page(spaceId, null, "제품 로드맵");
    childId = page(spaceId, rootId, "1분기");
    otherPageId = page(otherSpaceId, null, "다른 스페이스 문서");
  }

  // ── 트리·상세 표시 ───────────────────────────────────────────────────────

  /** 트리 행에는 그 페이지 자신의 공유만 실린다 — 대상·하위 포함. 공유가 없는 페이지는 null. */
  @Test
  void tree_marks_own_share() throws Exception {
    JsonNode before = json(call(get(pagesPath(spaceId)), viewerId).andExpect(status().isOk()));
    assertThat(row(before, rootId).get("share").isNull()).isTrue();

    saveShare(ownerId, rootId, "WORKSPACE", "VIEW", true);

    JsonNode after = json(call(get(pagesPath(spaceId)), viewerId).andExpect(status().isOk()));
    JsonNode share = row(after, rootId).get("share");
    assertThat(share.get("audience").asText()).isEqualTo("WORKSPACE");
    assertThat(share.get("includeChildren").asBoolean()).isTrue();
    // 상위 공유에 포함돼 보이는 자식은 자기 자신의 공유가 아니므로 표시가 없다.
    assertThat(row(after, childId).get("share").isNull()).isTrue();
    // 공유 토큰은 트리에 실리지 않는다.
    assertThat(share.has("token")).isFalse();
  }

  /**
   * 트리 행의 shareExcluded 는 그 페이지 자신에 상위 공유 제외 표시(WP-987)가 있을 때만 true(WP-1031) — 이동 경고가 제외된 페이지를 「새
   * 위치의 공유 링크로 보이게 된다」고 말하지 않게 한다. 제외를 풀면 다시 false.
   */
  @Test
  void tree_marks_share_exclusion() throws Exception {
    saveShare(ownerId, rootId, "WORKSPACE", "VIEW", true);
    JsonNode before = json(call(get(pagesPath(spaceId)), viewerId).andExpect(status().isOk()));
    assertThat(row(before, childId).get("shareExcluded").asBoolean()).isFalse();

    call(put("/api/v1/wiki/pages/" + childId + "/share/exclusion"), ownerId)
        .andExpect(status().isNoContent());

    JsonNode after = json(call(get(pagesPath(spaceId)), viewerId).andExpect(status().isOk()));
    assertThat(row(after, childId).get("shareExcluded").asBoolean()).isTrue();
    // 제외 표시는 그 페이지에만 실린다 — 공유 루트는 false.
    assertThat(row(after, rootId).get("shareExcluded").asBoolean()).isFalse();

    call(delete("/api/v1/wiki/pages/" + childId + "/share/exclusion"), ownerId)
        .andExpect(status().isNoContent());
    JsonNode cleared = json(call(get(pagesPath(spaceId)), viewerId).andExpect(status().isOk()));
    assertThat(row(cleared, childId).get("shareExcluded").asBoolean()).isFalse();
  }

  /**
   * 트리 행 share.expired 는 자기 공유의 만료 시각이 지났을 때만 true(WP-1043) — 웹이 만료된 자기 공유를 상속을 멈추는 것으로 세지 않게 한다.
   * 판정은 DB 시계다.
   */
  @Test
  void tree_marks_expired_own_share() throws Exception {
    saveShare(ownerId, rootId, "WORKSPACE", "VIEW", true);
    JsonNode live = json(call(get(pagesPath(spaceId)), viewerId).andExpect(status().isOk()));
    assertThat(row(live, rootId).get("share").get("expired").asBoolean()).isFalse();

    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.EXPIRES_AT, OffsetDateTime.now().minusHours(1))
        .where(WIKI_PAGE_SHARE.PAGE_ID.eq(rootId))
        .execute();

    JsonNode expired = json(call(get(pagesPath(spaceId)), viewerId).andExpect(status().isOk()));
    assertThat(row(expired, rootId).get("share").get("expired").asBoolean()).isTrue();
  }

  /** 페이지 상세의 shared 는 이 페이지 자신이 공유 중일 때만 true, 해제하면 false. */
  @Test
  void detail_shared_flag() throws Exception {
    assertThat(detail(rootId).get("shared").asBoolean()).isFalse();

    saveShare(ownerId, rootId, "WORKSPACE", "VIEW", true);
    assertThat(detail(rootId).get("shared").asBoolean()).isTrue();
    assertThat(detail(childId).get("shared").asBoolean()).isFalse();

    call(delete("/api/v1/wiki/pages/{id}/share", rootId), ownerId)
        .andExpect(status().isNoContent());
    assertThat(detail(rootId).get("shared").asBoolean()).isFalse();
  }

  /**
   * 만료된 공유는 링크가 열리지 않으므로 상세의 shared 가 false 이고 shareExpired 가 true 다(WP-1086) — 헤더가 「공유 중」 대신 「공유
   * 만료」로 보인다. 만료를 다시 미루면 shared 로 돌아온다. 판정은 DB 시계다.
   */
  @Test
  void detail_shared_flag_excludes_expired_share() throws Exception {
    saveShare(ownerId, rootId, "WORKSPACE", "VIEW", false);
    JsonNode live = detail(rootId);
    assertThat(live.get("shared").asBoolean()).isTrue();
    assertThat(live.get("shareExpired").asBoolean()).isFalse();

    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.EXPIRES_AT, OffsetDateTime.now().minusHours(1))
        .where(WIKI_PAGE_SHARE.PAGE_ID.eq(rootId))
        .execute();
    JsonNode expired = detail(rootId);
    assertThat(expired.get("shared").asBoolean()).isFalse();
    assertThat(expired.get("shareExpired").asBoolean()).isTrue();

    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.EXPIRES_AT, OffsetDateTime.now().plusDays(1))
        .where(WIKI_PAGE_SHARE.PAGE_ID.eq(rootId))
        .execute();
    JsonNode renewed = detail(rootId);
    assertThat(renewed.get("shared").asBoolean()).isTrue();
    assertThat(renewed.get("shareExpired").asBoolean()).isFalse();
  }

  // ── 목록 ────────────────────────────────────────────────────────────────

  /** 내 공유는 스페이스를 가로질러 내가 만든 것만 — 남이 만든 공유는 같은 스페이스여도 빠진다. 토큰·스페이스 이름·사람 수가 실린다. */
  @Test
  void mine_lists_only_my_shares_across_spaces() throws Exception {
    String mineToken = saveShare(ownerId, rootId, "WORKSPACE", "VIEW", false);
    saveShare(ownerId, otherPageId, "PEOPLE", "EDIT", false, List.of(strangerId, viewerId));
    saveShare(editorId, childId, "WORKSPACE", "VIEW", false);

    JsonNode mine = json(call(get("/api/v1/wiki/shares/mine"), ownerId).andExpect(status().isOk()));
    assertThat(pageIds(mine)).containsExactlyInAnyOrder(rootId, otherPageId);
    JsonNode first = byPage(mine, rootId);
    assertThat(first.get("token").asText()).isEqualTo(mineToken);
    assertThat(first.get("spaceId").asLong()).isEqualTo(spaceId);
    assertThat(first.get("spaceName").asText()).startsWith("공유목록-");
    assertThat(first.get("title").asText()).isEqualTo("제품 로드맵");
    assertThat(first.get("createdBy").get("userId").asLong()).isEqualTo(ownerId);
    assertThat(first.get("peopleCount").asInt()).isZero();
    JsonNode second = byPage(mine, otherPageId);
    assertThat(second.get("spaceId").asLong()).isEqualTo(otherSpaceId);
    assertThat(second.get("audience").asText()).isEqualTo("PEOPLE");
    assertThat(second.get("permission").asText()).isEqualTo("EDIT");
    assertThat(second.get("peopleCount").asInt()).isEqualTo(2);

    // 편집자가 만든 공유는 편집자의 내 공유에만 보인다.
    JsonNode editors =
        json(call(get("/api/v1/wiki/shares/mine"), editorId).andExpect(status().isOk()));
    assertThat(pageIds(editors)).containsExactly(childId);
  }

  /**
   * 스페이스 공유 목록은 VIEWER 이상이 보지만 토큰은 EDITOR 이상에게만 간다 — VIEWER 가 편집 링크 토큰을 읽어 스스로 편집 권한을 얻지 못하게. 비멤버는
   * 404.
   */
  @Test
  void space_list_hides_token_below_editor() throws Exception {
    String token = saveShare(ownerId, rootId, "WORKSPACE", "EDIT", false);
    saveShare(ownerId, otherPageId, "WORKSPACE", "VIEW", false);

    JsonNode asViewer =
        json(call(get(spaceSharesPath(spaceId)), viewerId).andExpect(status().isOk()));
    assertThat(pageIds(asViewer)).containsExactly(rootId); // 다른 스페이스의 공유는 섞이지 않는다
    assertThat(asViewer.get(0).get("token").isNull()).isTrue();
    assertThat(asViewer.get(0).get("permission").asText()).isEqualTo("EDIT");
    assertThat(asViewer.get(0).get("spaceName").asText()).startsWith("공유목록-");

    JsonNode asEditor =
        json(call(get(spaceSharesPath(spaceId)), editorId).andExpect(status().isOk()));
    assertThat(asEditor.get(0).get("token").asText()).isEqualTo(token);

    call(get(spaceSharesPath(spaceId)), strangerId).andExpect(status().isNotFound());
  }

  // ── 관리자 ──────────────────────────────────────────────────────────────

  /** 관리자 기능은 wiki_share:manage 가 있어야 한다 — 일반 USER 는 모두 403, 관리자는 통과. */
  @Test
  void admin_requires_permission() throws Exception {
    call(get("/api/v1/admin/wiki/share-policy"), editorId).andExpect(status().isForbidden());
    call(
            putJson("/api/v1/admin/wiki/share-policy", Map.of("externalShareEnabled", false)),
            editorId)
        .andExpect(status().isForbidden());
    call(get("/api/v1/admin/wiki/shares"), editorId).andExpect(status().isForbidden());
    call(postJson("/api/v1/admin/wiki/shares/revoke", Map.of("pageIds", List.of(rootId))), editorId)
        .andExpect(status().isForbidden());

    call(get("/api/v1/admin/wiki/share-policy"), adminId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.externalShareEnabled").value(true));
    call(get("/api/v1/admin/wiki/shares"), adminId).andExpect(status().isOk());
  }

  /** 관리자 전체 목록 — 스페이스를 가로질러 모든 사람의 공유, 스페이스·토큰 포함. */
  @Test
  void admin_lists_all_shares() throws Exception {
    String t1 = saveShare(ownerId, rootId, "WORKSPACE", "VIEW", false);
    saveShare(editorId, childId, "WORKSPACE", "VIEW", false);
    saveShare(ownerId, otherPageId, "PEOPLE", "VIEW", false, List.of(strangerId));

    JsonNode all = json(call(get("/api/v1/admin/wiki/shares"), adminId).andExpect(status().isOk()));
    assertThat(pageIds(all)).contains(rootId, childId, otherPageId);
    assertThat(byPage(all, rootId).get("token").asText()).isEqualTo(t1);
    assertThat(byPage(all, otherPageId).get("spaceName").asText()).startsWith("공유목록2-");
    assertThat(byPage(all, otherPageId).get("peopleCount").asInt()).isEqualTo(1);
    assertThat(byPage(all, childId).get("createdBy").get("userId").asLong()).isEqualTo(editorId);
  }

  /**
   * 일괄 해제 — 공유가 지워지고 대기 중 접근 요청도 함께 지워지며, 공유 기록은 REVOKED_BY_ADMIN(행위자 = 관리자), 감사는
   * WIKI_SHARE_REVOKED(reason ADMIN, 행위자 = 같은 관리자). 공유가 없는 페이지 id 는 건너뛴다. 재검증 이벤트는 한 번(덮던 페이지의
   * 합집합).
   */
  @Test
  void admin_bulk_revoke_audits_admin_reason() throws Exception {
    String peopleToken = saveShare(ownerId, rootId, "PEOPLE", "VIEW", true, List.of(viewerId));
    saveShare(ownerId, otherPageId, "WORKSPACE", "EDIT", false);
    // 지정한 사람이 아닌 사용자의 대기 중 접근 요청 — 해제와 함께 지워져야 한다.
    call(post("/api/v1/wiki/shares/{t}/access-requests", peopleToken), strangerId)
        .andExpect(status().isOk());
    assertThat(pendingRequests(rootId)).isEqualTo(1);
    appEvents.clear();

    call(
            postJson(
                "/api/v1/admin/wiki/shares/revoke",
                Map.of("pageIds", List.of(rootId, otherPageId, childId))),
            adminId)
        .andExpect(status().isNoContent());

    assertThat(shareCount(rootId)).isZero();
    assertThat(shareCount(otherPageId)).isZero();
    assertThat(pendingRequests(rootId)).isZero();

    for (long pageId : List.of(rootId, otherPageId)) {
      List<Long> actors =
          dsl.select(WIKI_PAGE_SHARE_EVENT.ACTOR_ID)
              .from(WIKI_PAGE_SHARE_EVENT)
              .where(WIKI_PAGE_SHARE_EVENT.PAGE_ID.eq(pageId))
              .and(WIKI_PAGE_SHARE_EVENT.TYPE.eq("REVOKED_BY_ADMIN"))
              .fetch(WIKI_PAGE_SHARE_EVENT.ACTOR_ID);
      assertThat(actors).as("기록 REVOKED_BY_ADMIN — page %d", pageId).containsExactly(adminId);

      List<AuditLogRecord> audits = audits("wiki", String.valueOf(pageId), "WIKI_SHARE_REVOKED");
      assertThat(audits).hasSize(1);
      assertThat(audits.get(0).getUserId()).isEqualTo(adminId);
      JsonNode meta = metadata(audits.get(0));
      assertThat(meta.get("reason").asText()).isEqualTo("ADMIN");
      assertThat(meta.get("spaceId").asLong()).isEqualTo(pageId == rootId ? spaceId : otherSpaceId);
      assertThat(meta.has("audience")).isTrue();
      assertThat(meta.has("permission")).isTrue();
    }
    // 공유가 없던 페이지에는 아무것도 남지 않는다.
    assertThat(audits("wiki", String.valueOf(childId), "WIKI_SHARE_REVOKED")).isEmpty();

    // 재검증 이벤트: 한 번 — 스페이스를 가로질러 해제한 공유가 덮던 페이지(하위 포함 서브트리까지)의 합집합.
    List<WikiShareAccessChangedEvent> events =
        appEvents.stream(WikiShareAccessChangedEvent.class).toList();
    assertThat(events).hasSize(1);
    assertThat(events.get(0).pageIds()).containsExactlyInAnyOrder(rootId, childId, otherPageId);
  }

  /**
   * Review Focus 5 — 외부 공유를 끄면 같은 요청에서 PUBLIC 공유가 모두 지워진다. 이미 열린 외부 탭의 새로고침·이미지 요청은 404(공개 조회 함수가 빈
   * 결과, 로그인 경로도 404). 다른 대상의 공유는 그대로, 기록 REVOKED_BY_POLICY·감사(WIKI_SHARE_REVOKED reason POLICY,
   * WIKI_SHARE_POLICY_CHANGED) 는 관리자 행위로 남는다.
   *
   * <p>비로그인 공개 엔드포인트는 Task 7 에 생긴다 — 거기서 HTTP 로 같은 404 를 다시 본다.
   */
  @Test
  void policy_off_revokes_public_and_blocks_attachments() throws Exception {
    String publicRoot = saveShare(ownerId, rootId, "PUBLIC", "VIEW", true);
    String publicChild = saveShare(ownerId, childId, "PUBLIC", "VIEW", false);
    String workspaceToken = saveShare(ownerId, otherPageId, "WORKSPACE", "VIEW", false);
    long fileId = uploadPng(ownerId, childId);

    // 끄기 전에는 외부 토큰으로 페이지와 첨부가 열린다(대조). 1분기는 따로 켠 공유가 상위보다 우선이라(WP-987) 자기 토큰으로 연다.
    call(get("/api/v1/wiki/pages/{id}", childId), strangerId, publicChild)
        .andExpect(status().isOk());
    call(attachmentContent(childId, fileId), strangerId, publicChild).andExpect(status().isOk());
    assertThat(resolvePublic(publicRoot)).isEqualTo(1);
    appEvents.clear();

    call(putJson("/api/v1/admin/wiki/share-policy", Map.of("externalShareEnabled", false)), adminId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.externalShareEnabled").value(false));

    // PUBLIC 공유 행은 지워지고, 다른 대상의 공유는 남는다.
    assertThat(shareCount(rootId)).isZero();
    assertThat(shareCount(childId)).isZero();
    assertThat(shareCount(otherPageId)).isEqualTo(1);
    assertThat(resolvePublic(publicRoot)).isZero();
    assertThat(resolvePublic(publicChild)).isZero();

    // 열려 있던 외부 탭의 새로고침(페이지 GET)·이미지 요청(첨부) — 옛 토큰은 없는 공유다.
    call(get("/api/v1/wiki/pages/{id}", rootId), strangerId, publicRoot)
        .andExpect(status().isNotFound());
    call(get("/api/v1/wiki/pages/{id}", childId), strangerId, publicChild)
        .andExpect(status().isNotFound());
    call(attachmentContent(childId, fileId), strangerId, publicChild)
        .andExpect(status().isNotFound());
    // 대조: 꺼지지 않은 워크스페이스 링크는 그대로 열린다.
    call(get("/api/v1/wiki/pages/{id}", otherPageId), strangerId, workspaceToken)
        .andExpect(status().isOk());

    // 페이지마다 공유 기록 REVOKED_BY_POLICY(행위자 = 관리자)와 감사 reason POLICY(행위자 = 같은 관리자).
    for (long pageId : List.of(rootId, childId)) {
      List<Long> actors =
          dsl.select(WIKI_PAGE_SHARE_EVENT.ACTOR_ID)
              .from(WIKI_PAGE_SHARE_EVENT)
              .where(WIKI_PAGE_SHARE_EVENT.PAGE_ID.eq(pageId))
              .and(WIKI_PAGE_SHARE_EVENT.TYPE.eq("REVOKED_BY_POLICY"))
              .fetch(WIKI_PAGE_SHARE_EVENT.ACTOR_ID);
      assertThat(actors).as("기록 REVOKED_BY_POLICY — page %d", pageId).containsExactly(adminId);
      List<AuditLogRecord> audits = audits("wiki", String.valueOf(pageId), "WIKI_SHARE_REVOKED");
      assertThat(audits).hasSize(1);
      assertThat(audits.get(0).getUserId()).isEqualTo(adminId);
      JsonNode meta = metadata(audits.get(0));
      assertThat(meta.get("reason").asText()).isEqualTo("POLICY");
      assertThat(meta.get("audience").asText()).isEqualTo("PUBLIC");
    }
    assertThat(audits("wiki", String.valueOf(otherPageId), "WIKI_SHARE_REVOKED")).isEmpty();

    List<AuditLogRecord> changed = audits("tenant", "1", "WIKI_SHARE_POLICY_CHANGED");
    assertThat(changed).hasSize(1);
    assertThat(changed.get(0).getUserId()).isEqualTo(adminId);
    JsonNode meta = metadata(changed.get(0));
    assertThat(meta.get("externalShareEnabled").asBoolean()).isFalse();
    assertThat(meta.get("revokedCount").asInt()).isEqualTo(2);

    // 재검증 이벤트는 한 번 — 공유가 덮던 페이지(하위 포함 서브트리)를 담는다.
    List<WikiShareAccessChangedEvent> events =
        appEvents.stream(WikiShareAccessChangedEvent.class).toList();
    assertThat(events).hasSize(1);
    assertThat(events.get(0).pageIds()).containsExactlyInAnyOrder(rootId, childId);

    // 정책이 꺼진 동안 새 외부 공유는 409.
    call(
            putJson(
                "/api/v1/wiki/pages/" + rootId + "/share",
                shareBody("PUBLIC", "VIEW", false, List.of())),
            ownerId)
        .andExpect(status().isConflict());
  }

  /** 다시 켜도 지워진 외부 링크는 되살아나지 않는다 — 공유 행은 없고 옛 토큰은 계속 404. 값이 그대로인 저장은 감사를 더하지 않는다. */
  @Test
  void policy_on_again_does_not_restore() throws Exception {
    String oldToken = saveShare(ownerId, rootId, "PUBLIC", "VIEW", false);
    call(putJson("/api/v1/admin/wiki/share-policy", Map.of("externalShareEnabled", false)), adminId)
        .andExpect(status().isOk());
    assertThat(shareCount(rootId)).isZero();

    call(putJson("/api/v1/admin/wiki/share-policy", Map.of("externalShareEnabled", true)), adminId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.externalShareEnabled").value(true));
    call(get("/api/v1/admin/wiki/share-policy"), adminId)
        .andExpect(jsonPath("$.externalShareEnabled").value(true));

    assertThat(shareCount(rootId)).isZero();
    assertThat(resolvePublic(oldToken)).isZero();
    call(get("/api/v1/wiki/pages/{id}", rootId), strangerId, oldToken)
        .andExpect(status().isNotFound());

    // 켜기도 감사 한 건(revokedCount 0) — 같은 값을 다시 저장하면 더하지 않는다.
    List<AuditLogRecord> changed = audits("tenant", "1", "WIKI_SHARE_POLICY_CHANGED");
    assertThat(changed).hasSize(2);
    JsonNode latest = metadata(changed.get(0));
    assertThat(latest.get("externalShareEnabled").asBoolean()).isTrue();
    assertThat(latest.get("revokedCount").asInt()).isZero();
    call(putJson("/api/v1/admin/wiki/share-policy", Map.of("externalShareEnabled", true)), adminId)
        .andExpect(status().isOk());
    assertThat(audits("tenant", "1", "WIKI_SHARE_POLICY_CHANGED")).hasSize(2);

    // 켠 뒤에는 새 외부 공유를 다시 만들 수 있고 토큰은 옛 것과 다르다.
    String fresh = saveShare(ownerId, rootId, "PUBLIC", "VIEW", false);
    assertThat(fresh).isNotEqualTo(oldToken);
  }

  /** 정책 저장 본문에 값이 없거나 키 이름이 틀리면 400 — false 로 조용히 묶여 외부 링크를 지우지 않는다. 외부 공유는 그대로이고 기록·감사도 남지 않는다. */
  @Test
  void policy_put_without_value_is_400_and_keeps_public_shares() throws Exception {
    String token = saveShare(ownerId, rootId, "PUBLIC", "VIEW", false);
    for (Map<String, Object> body :
        List.of(Map.<String, Object>of(), Map.<String, Object>of("externalShareEnable", false))) {
      call(putJson("/api/v1/admin/wiki/share-policy", body), adminId)
          .andExpect(status().isBadRequest());
    }
    call(
            put("/api/v1/admin/wiki/share-policy")
                .contentType(MediaType.APPLICATION_JSON)
                .content("null"),
            adminId)
        .andExpect(status().isBadRequest());

    assertThat(shareCount(rootId)).isEqualTo(1);
    assertThat(resolvePublic(token)).isEqualTo(1);
    assertThat(audits("tenant", "1", "WIKI_SHARE_POLICY_CHANGED")).isEmpty();
    call(get("/api/v1/admin/wiki/share-policy"), adminId)
        .andExpect(jsonPath("$.externalShareEnabled").value(true));
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  /** 테넌트#1 ACTIVE 멤버인 사람 사용자. */
  private long human() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  /** 테넌트#1 시스템 ADMIN 역할(wiki_share:manage 포함)을 준다. */
  private void grantAdminRole(long userId) {
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
  }

  private long page(long inSpaceId, Long parentId, String title) {
    TenantContext.set(1L);
    long id = pageService.create(ownerId, inSpaceId, new CreatePageRequest(parentId, title)).id();
    TenantContext.set(1L);
    return id;
  }

  private static String pagesPath(long id) {
    return "/api/v1/wiki/spaces/" + id + "/pages";
  }

  private static String spaceSharesPath(long id) {
    return "/api/v1/wiki/spaces/" + id + "/shares";
  }

  private static Map<String, Object> shareBody(
      String audience, String permission, boolean includeChildren, List<Long> userIds) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", audience);
    body.put("permission", permission);
    body.put("includeChildren", includeChildren);
    body.put("userIds", userIds);
    body.put("expiresAt", null);
    body.put("notify", Map.of());
    return body;
  }

  /** 설정 API 로 공유를 만들고 토큰을 돌려준다. */
  private String saveShare(
      long userId, long pageId, String audience, String permission, boolean includeChildren)
      throws Exception {
    return saveShare(userId, pageId, audience, permission, includeChildren, List.of());
  }

  private String saveShare(
      long userId,
      long pageId,
      String audience,
      String permission,
      boolean includeChildren,
      List<Long> userIds)
      throws Exception {
    JsonNode res =
        json(
            call(
                    putJson(
                        "/api/v1/wiki/pages/" + pageId + "/share",
                        shareBody(audience, permission, includeChildren, userIds)),
                    userId)
                .andExpect(status().isOk()));
    return res.get("token").asText();
  }

  private MockHttpServletRequestBuilder putJson(String path, Object body) throws Exception {
    return put(path).contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body));
  }

  private MockHttpServletRequestBuilder postJson(String path, Object body) throws Exception {
    return post(path).contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body));
  }

  private MockHttpServletRequestBuilder attachmentContent(long pageId, long fileId) {
    return get("/api/v1/wiki/pages/{p}/attachments/{f}/content", pageId, fileId);
  }

  /** 멤버(헤더 없음)로 PNG 를 올리고 file id 를 돌려준다. */
  private long uploadPng(long userId, long pageId) throws Exception {
    MockMultipartFile f = new MockMultipartFile("file", "a.png", "image/png", PNG);
    JsonNode res =
        json(
            call(multipart("/api/v1/wiki/pages/{id}/attachments", pageId).file(f), userId)
                .andExpect(status().isCreated()));
    return res.get("fileId").asLong();
  }

  private JsonNode detail(long pageId) throws Exception {
    return json(call(get("/api/v1/wiki/pages/{id}", pageId), ownerId).andExpect(status().isOk()));
  }

  /** 사용자 JWT(테넌트 1)로 요청한다. */
  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    return call(req, userId, null);
  }

  /** 사용자 JWT(테넌트 1) + 공유 헤더(null 이면 생략)로 요청한다. */
  private ResultActions call(MockHttpServletRequestBuilder req, long userId, String shareToken)
      throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    if (shareToken != null) {
      req.header(WikiShareAccess.HEADER, shareToken);
    }
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  private static JsonNode row(JsonNode rows, long pageId) {
    for (JsonNode r : rows) {
      if (r.get("id").asLong() == pageId) {
        return r;
      }
    }
    throw new AssertionError("트리에 페이지가 없다: " + pageId);
  }

  private static JsonNode byPage(JsonNode items, long pageId) {
    for (JsonNode r : items) {
      if (r.get("pageId").asLong() == pageId) {
        return r;
      }
    }
    throw new AssertionError("목록에 페이지가 없다: " + pageId);
  }

  private static List<Long> pageIds(JsonNode items) {
    List<Long> out = new ArrayList<>();
    items.forEach(r -> out.add(r.get("pageId").asLong()));
    return out;
  }

  private int shareCount(long pageId) {
    return dsl.fetchCount(WIKI_PAGE_SHARE, WIKI_PAGE_SHARE.PAGE_ID.eq(pageId));
  }

  private int pendingRequests(long pageId) {
    return dsl.fetchCount(
        WIKI_SHARE_ACCESS_REQUEST,
        WIKI_SHARE_ACCESS_REQUEST
            .PAGE_ID
            .eq(pageId)
            .and(WIKI_SHARE_ACCESS_REQUEST.STATUS.eq("PENDING")));
  }

  /** 비로그인 공개 조회가 쓰는 DB 함수 — 토큰이 외부 열람 가능하면 1, 아니면 0. */
  private int resolvePublic(String token) {
    return dsl.fetch("SELECT * FROM wiki_page_share_resolve_public(?)", token).size();
  }

  /** 이 리소스의 감사 로그(최신순). */
  private List<AuditLogRecord> audits(String resource, String resourceId, String actionType) {
    return dsl.selectFrom(AUDIT_LOG)
        .where(AUDIT_LOG.ACTION_TYPE.eq(actionType))
        .and(AUDIT_LOG.RESOURCE.eq(resource))
        .and(AUDIT_LOG.RESOURCE_ID.eq(resourceId))
        .orderBy(AUDIT_LOG.ID.desc())
        .fetch();
  }

  private JsonNode metadata(AuditLogRecord r) throws Exception {
    assertThat(r.getMetadata()).as("감사 metadata 가 직렬화돼 남아야 한다").isNotNull();
    return om.readTree(r.getMetadata().data());
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }
}
