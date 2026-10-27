package com.workplace.wiki;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_EVENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiShareAccess;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 하위 페이지의 공유 상속(WP-987) — 상위 「하위 포함」 공유를 하위가 받는 규칙과 그 조정.
 *
 * <ul>
 *   <li>「이 페이지와 하위는 상위 공유에서 제외」 표시가 있으면 그 서브트리는 상위 링크로 열리지 않고, 공유 화면 목록에서도 빠진다(풀면 다시 열린다).
 *   <li>하위가 따로 켠 공유가 상위보다 우선 — 상위 링크로는 그 서브트리가 열리지 않는다(하위 공유가 하위 포함이 아니면 그 아래도).
 *   <li>공유 창 상태 — 상속받는 공유의 범위·권한·토큰(「이 페이지 링크 복사」), 제외 표시, 상위 공유에서 제외된 하위 목록.
 *   <li>노트 주소로 연 비멤버(입구 {@code link=true}) — 그 페이지를 덮는 워크스페이스 전체·지정한 사람 공유의 토큰을 받는다(외부 공개는 아님).
 * </ul>
 *
 * <p>@Transactional: MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다({@link WikiShareAccessTest} 와 같은
 * 방식).
 */
@Transactional
class WikiShareInheritanceTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;

  private long ownerId;
  private long viewerId; // 스페이스 VIEWER
  private long strangerId; // 같은 테넌트, 스페이스 비멤버
  private long spaceId;
  private long rootId; // 프로젝트 문서 — 상위 공유
  private long childId; // 회의록 — 제외·따로 공유 대상
  private long grandchildId; // 회의록 3
  private long siblingId; // 기획서 — 루트의 다른 자식(늘 상속)

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human();
    viewerId = human();
    strangerId = human();
    spaceId = spaceService.createTeamSpace(ownerId, "공유상속-" + UUID.randomUUID()).id();
    spaceService.addMember(ownerId, spaceId, viewerId, "VIEWER");
    rootId = page(null, "프로젝트 문서");
    childId = page(rootId, "회의록");
    grandchildId = page(childId, "회의록 3");
    siblingId = page(rootId, "기획서");
  }

  /** 제외 표시가 있는 하위와 그 아래는 상위 링크로 열리지 않고 공유 화면 목록에서도 빠진다 — 풀면 다시 열린다. 다른 하위는 그대로. */
  @Test
  void exclusion_hides_subtree_from_parent_link_until_lifted() throws Exception {
    String token = share(rootId, "WORKSPACE", "VIEW", true);
    openAs(strangerId, grandchildId, token).andExpect(status().isOk());

    call(put(exclusionPath(childId)), ownerId).andExpect(status().isNoContent());
    // 멱등 — 다시 켜도 204.
    call(put(exclusionPath(childId)), ownerId).andExpect(status().isNoContent());

    openAs(strangerId, childId, token).andExpect(status().isNotFound());
    openAs(strangerId, grandchildId, token).andExpect(status().isNotFound());
    openAs(strangerId, siblingId, token).andExpect(status().isOk());
    openAs(strangerId, rootId, token).andExpect(status().isOk());
    assertThat(sharedPageIds(token)).containsExactlyInAnyOrder(rootId, siblingId);
    // 멤버는 공유와 상관없이 자기 역할로 연다.
    call(get("/api/v1/wiki/pages/{id}", grandchildId), viewerId).andExpect(status().isOk());

    call(delete(exclusionPath(childId)), ownerId).andExpect(status().isNoContent());
    openAs(strangerId, grandchildId, token).andExpect(status().isOk());
    assertThat(sharedPageIds(token))
        .containsExactlyInAnyOrder(rootId, childId, grandchildId, siblingId);

    // 상위 공유의 기록에 누가 빼고 풀었는지 남는다.
    assertThat(eventTypes(rootId)).contains("CHILD_EXCLUDED", "CHILD_INCLUDED");
  }

  /** 하위가 따로 켠 공유가 상위보다 우선 — 상위 링크로는 그 하위(하위 미포함이면 그 아래도)가 열리지 않고, 하위 링크가 연다. 해제하면 다시 상속. */
  @Test
  void child_own_share_takes_precedence_over_parent() throws Exception {
    String parent = share(rootId, "WORKSPACE", "EDIT", true);
    String own = share(childId, "WORKSPACE", "VIEW", false);

    openAs(strangerId, childId, parent).andExpect(status().isNotFound());
    openAs(strangerId, grandchildId, parent).andExpect(status().isNotFound());
    openAs(strangerId, childId, own).andExpect(status().isOk());
    // 하위 공유는 하위 미포함이라 회의록 3 은 어느 링크로도 열리지 않는다.
    openAs(strangerId, grandchildId, own).andExpect(status().isNotFound());
    assertThat(sharedPageIds(parent)).containsExactlyInAnyOrder(rootId, siblingId);

    // 하위 공유가 하위 포함이면 그 아래는 하위 공유의 권한(보기)으로 열린다.
    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.INCLUDE_CHILDREN, true)
        .where(WIKI_PAGE_SHARE.PAGE_ID.eq(childId))
        .execute();
    openAs(strangerId, grandchildId, own).andExpect(status().isOk());
    call(get("/api/v1/wiki/pages/{id}/collab-access", grandchildId), strangerId, own)
        .andExpect(jsonPath("$.role").value("VIEWER"));

    call(delete("/api/v1/wiki/pages/{id}/share", childId), ownerId)
        .andExpect(status().isNoContent());
    openAs(strangerId, grandchildId, parent).andExpect(status().isOk());
    call(get("/api/v1/wiki/pages/{id}/collab-access", grandchildId), strangerId, parent)
        .andExpect(jsonPath("$.role").value("EDITOR"));
  }

  /**
   * 하위의 공유 창 상태 — 상속받는 공유의 범위·권한·지금 토큰과 제외 표시. 제외해도 상자는 보인다(제외 체크를 풀 수 있게). 상위의 공유 창은 제외된 하위를 목록으로
   * 보인다.
   */
  @Test
  void share_state_reports_inheritance_and_exclusions() throws Exception {
    String token = share(rootId, "WORKSPACE", "VIEW", true);

    call(get(sharePath(grandchildId)), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.inheritedFrom.pageId").value(rootId))
        .andExpect(jsonPath("$.inheritedFrom.title").value("프로젝트 문서"))
        .andExpect(jsonPath("$.inheritedFrom.audience").value("WORKSPACE"))
        .andExpect(jsonPath("$.inheritedFrom.permission").value("VIEW"))
        .andExpect(jsonPath("$.inheritedFrom.token").value(token))
        .andExpect(jsonPath("$.excludedFromParent").value(false));
    call(get(sharePath(rootId)), ownerId).andExpect(jsonPath("$.excludedPages").isEmpty());

    call(put(exclusionPath(childId)), ownerId).andExpect(status().isNoContent());
    call(get(sharePath(childId)), ownerId)
        .andExpect(jsonPath("$.inheritedFrom.pageId").value(rootId))
        .andExpect(jsonPath("$.excludedFromParent").value(true));
    // 제외된 회의록 아래의 회의록 3 은 상속받지 않는다(그 위에서 멈춤).
    call(get(sharePath(grandchildId)), ownerId).andExpect(jsonPath("$.inheritedFrom").isEmpty());
    call(get(sharePath(rootId)), ownerId)
        .andExpect(jsonPath("$.excludedPages.length()").value(1))
        .andExpect(jsonPath("$.excludedPages[0].pageId").value(childId))
        .andExpect(jsonPath("$.excludedPages[0].title").value("회의록"));
  }

  /** 제외 표시는 그 스페이스의 EDITOR 이상만 바꾼다 — VIEWER 는 403, 비멤버는 404(없는 페이지와 같다). */
  @Test
  void exclusion_requires_editor() throws Exception {
    call(put(exclusionPath(childId)), viewerId).andExpect(status().isForbidden());
    call(put(exclusionPath(childId)), strangerId).andExpect(status().isNotFound());
    call(delete(exclusionPath(childId)), viewerId).andExpect(status().isForbidden());
  }

  /**
   * 노트 주소로 연 비멤버(입구 link=true) — 그 페이지를 덮는 워크스페이스 전체 공유의 토큰으로 보낸다. 알림 입구(link 없음)는 지금처럼 지정한 사람 공유만.
   * 상속이 멈춘 하위·외부 공개 공유는 토큰을 주지 않는다.
   */
  @Test
  void entry_with_link_redirects_non_member_to_covering_share() throws Exception {
    String token = share(rootId, "WORKSPACE", "VIEW", true);

    call(get(entryPath(grandchildId, true)), strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.member").value(false))
        .andExpect(jsonPath("$.shareToken").value(token));
    call(get(entryPath(grandchildId, false)), strangerId).andExpect(status().isNotFound());
    // 멤버는 노트로.
    call(get(entryPath(grandchildId, true)), viewerId)
        .andExpect(jsonPath("$.member").value(true))
        .andExpect(jsonPath("$.shareToken").isEmpty());

    call(put(exclusionPath(childId)), ownerId).andExpect(status().isNoContent());
    call(get(entryPath(grandchildId, true)), strangerId).andExpect(status().isNotFound());

    // 외부 공개 공유의 토큰은 페이지 id 로 캐낼 수 없다.
    String outside = share(siblingId, "PUBLIC", "VIEW", false);
    assertThat(outside).isNotBlank();
    call(get(entryPath(siblingId, true)), strangerId).andExpect(status().isNotFound());
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  private long human() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  private long page(Long parentId, String title) {
    TenantContext.set(1L);
    return pageService.create(ownerId, spaceId, new CreatePageRequest(parentId, title)).id();
  }

  /** 공유 행을 직접 만든다 — 토큰을 돌려준다. */
  private String share(long pageId, String audience, String permission, boolean children) {
    String token = "wsh_test" + UUID.randomUUID().toString().replace("-", "");
    long pageSpace =
        dsl.select(WIKI_PAGE.SPACE_ID)
            .from(WIKI_PAGE)
            .where(WIKI_PAGE.ID.eq(pageId))
            .fetchOne(0, Long.class);
    dsl.insertInto(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.PAGE_ID, pageId)
        .set(WIKI_PAGE_SHARE.SPACE_ID, pageSpace)
        .set(WIKI_PAGE_SHARE.TOKEN, token)
        .set(WIKI_PAGE_SHARE.AUDIENCE, audience)
        .set(WIKI_PAGE_SHARE.PERMISSION, permission)
        .set(WIKI_PAGE_SHARE.INCLUDE_CHILDREN, children)
        .set(WIKI_PAGE_SHARE.CREATED_BY, ownerId)
        .execute();
    return token;
  }

  private ResultActions openAs(long userId, long pageId, String token) throws Exception {
    return call(get("/api/v1/wiki/pages/{id}", pageId), userId, token);
  }

  /** 링크 열기(GET /wiki/shares/{token})가 보이는 페이지 목록. */
  private List<Long> sharedPageIds(String token) throws Exception {
    JsonNode body =
        om.readTree(
            call(get("/api/v1/wiki/shares/{token}", token), strangerId)
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    List<Long> ids = new ArrayList<>();
    body.get("pages").forEach(p -> ids.add(p.get("id").asLong()));
    return ids;
  }

  private List<String> eventTypes(long pageId) {
    return dsl.select(WIKI_PAGE_SHARE_EVENT.TYPE)
        .from(WIKI_PAGE_SHARE_EVENT)
        .where(WIKI_PAGE_SHARE_EVENT.PAGE_ID.eq(pageId))
        .fetch(WIKI_PAGE_SHARE_EVENT.TYPE);
  }

  private static String sharePath(long pageId) {
    return "/api/v1/wiki/pages/" + pageId + "/share";
  }

  private static String exclusionPath(long pageId) {
    return "/api/v1/wiki/pages/" + pageId + "/share/exclusion";
  }

  private static String entryPath(long pageId, boolean link) {
    return "/api/v1/wiki/pages/" + pageId + "/entry" + (link ? "?link=true" : "");
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    return call(req, userId, null);
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId, String shareToken)
      throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    if (shareToken != null) {
      req.header(WikiShareAccess.HEADER, shareToken);
    }
    return mvc.perform(req);
  }
}
