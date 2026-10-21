package com.workplace.wiki;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
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
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 외부(비로그인) 공유 보기(WP-579 Task 7) — {@code GET /api/v1/public/wiki/shares/{token}} 와 공개 첨부. 인증 헤더
 * 없이 부르고, 범위(하위 포함)·내부 링크 401·없음/만료/정책 꺼짐 404·응답 헤더·첨부 바인딩·응답에 사람·범위 밖 정보가 없는지 본다.
 *
 * <p>@Transactional: 공개 요청도 같은 스레드의 테스트 트랜잭션에 합류해 시드를 보고, 끝나면 롤백된다. 공개 컨트롤러는 요청이 끝날 때 테넌트 컨텍스트를
 * 되돌리지만, 다음 시드가 흔들리지 않게 요청마다 테넌트 1 을 다시 심는다.
 */
@Transactional
class PublicWikiShareTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;

  /** PNG 매직바이트 + 채움 — 첨부 업로드의 이미지 판정용. */
  private static final byte[] PNG = {
    (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0
  };

  private long ownerId;
  private long adminId;
  private String spaceName;
  private long topId; // 공유 루트의 부모(범위 밖)
  private long rootId; // 공유하는 페이지
  private long childId; // 루트의 자식
  private long grandchildId; // 루트의 손자
  private long siblingId; // 루트의 형제(범위 밖)
  private long otherPageId; // 다른 스페이스의 페이지(범위 밖)

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = withMembership(TestFixtures.createHuman(dsl));
    adminId = withMembership(TestFixtures.createHuman(dsl));
    grantAdminRole(adminId);
    spaceName = "외부공유-" + UUID.randomUUID();
    long spaceId = spaceService.createTeamSpace(ownerId, spaceName).id();
    long otherSpaceId = spaceService.createTeamSpace(ownerId, "비밀스페이스-" + UUID.randomUUID()).id();
    topId = page(spaceId, null, "상위 문서");
    rootId = page(spaceId, topId, "제품 로드맵");
    childId = page(spaceId, rootId, "1분기");
    grandchildId = page(spaceId, childId, "1월");
    siblingId = page(spaceId, topId, "형제 문서");
    otherPageId = page(otherSpaceId, null, "비밀 인사 문서");
  }

  // ── 범위·응답 모양 ─────────────────────────────────────────────────────────

  /**
   * 하위 포함이면 공유 루트의 지금 서브트리만, 아니면 루트 하나만 보인다. 루트의 parentId 는 범위 밖이라 null. pageId 는 범위 안이어야 하고(밖이면
   * 404), 성공한 보기마다 조회 수가 오른다(실패는 세지 않는다). 응답 필드는 웹 계약({@code WikiPublicShare}) 그대로다.
   */
  @Test
  void public_returns_subtree_only_when_include_children() throws Exception {
    String token = saveShare(rootId, "PUBLIC", "VIEW", true, List.of());

    JsonNode res = json(anon(publicPath(token)).andExpect(status().isOk()));
    assertThat(fieldNames(res))
        .containsExactlyInAnyOrder("workspaceName", "rootPageId", "pages", "page");
    assertThat(res.get("workspaceName").asText()).isEqualTo(tenantName());
    assertThat(res.get("rootPageId").asLong()).isEqualTo(rootId);
    assertThat(ids(res.get("pages"))).containsExactlyInAnyOrder(rootId, childId, grandchildId);
    for (JsonNode p : res.get("pages")) {
      assertThat(fieldNames(p)).containsExactlyInAnyOrder("id", "parentId", "title", "position");
    }
    assertThat(byId(res.get("pages"), rootId).get("parentId").isNull()).isTrue();
    assertThat(byId(res.get("pages"), childId).get("parentId").asLong()).isEqualTo(rootId);
    JsonNode page = res.get("page");
    assertThat(fieldNames(page)).containsExactlyInAnyOrder("id", "title", "markdown", "updatedAt");
    assertThat(page.get("id").asLong()).isEqualTo(rootId);
    assertThat(page.get("title").asText()).isEqualTo("제품 로드맵");

    // 범위 안 하위 페이지로 이동.
    JsonNode child =
        json(anon(publicPath(token) + "?pageId=" + grandchildId).andExpect(status().isOk()));
    assertThat(child.get("page").get("id").asLong()).isEqualTo(grandchildId);
    assertThat(child.get("page").get("title").asText()).isEqualTo("1월");
    // 범위 밖(부모·형제·다른 스페이스·없는 페이지)은 404.
    for (long outside : List.of(topId, siblingId, otherPageId, Long.MAX_VALUE)) {
      anon(publicPath(token) + "?pageId=" + outside).andExpect(status().isNotFound());
    }
    // 성공 2회만 센다.
    assertThat(viewCount(token)).isEqualTo(2);

    // 하위 포함을 끄면 루트 하나만 — 자식은 바로 404.
    saveShare(rootId, "PUBLIC", "VIEW", false, List.of());
    JsonNode only = json(anon(publicPath(token)).andExpect(status().isOk()));
    assertThat(ids(only.get("pages"))).containsExactly(rootId);
    anon(publicPath(token) + "?pageId=" + childId).andExpect(status().isNotFound());
  }

  /**
   * 응답 어디에도 사람(이름·id)·스페이스 이름·범위 밖 페이지 제목이 없다 — 본문의 사람·이슈·범위 밖 페이지 멘션, 내부 링크는 가려지고 범위 안 페이지 멘션만
   * 제목으로 남는다(Review Focus 4 의 HTTP 경로).
   */
  @Test
  void public_response_leaks_no_people_or_outside_titles() throws Exception {
    String ownerName =
        dsl.select(USER.NAME).from(USER).where(USER.ID.eq(ownerId)).fetchOne(USER.NAME);
    setBody(
        rootId,
        "담당 <@"
            + ownerId
            + "> 참고 <#page:"
            + otherPageId
            + "> <#page:"
            + topId
            + "> 이슈 <#issue:1> 하위 <#page:"
            + childId
            + ">\n\n| 사람 | 문서 |\n| --- | --- |\n| <@"
            + adminId
            + "> | [비밀](/wiki/spaces/1/pages/"
            + otherPageId
            + ") |\n");
    String token = saveShare(rootId, "PUBLIC", "VIEW", true, List.of());

    String raw =
        anon(publicPath(token))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    assertThat(raw)
        .doesNotContain(ownerName)
        .doesNotContain(spaceName)
        .doesNotContain("비밀 인사 문서")
        .doesNotContain("상위 문서")
        .doesNotContain("형제 문서")
        .doesNotContain("<@")
        .doesNotContain("<#")
        .doesNotContain("/wiki/spaces/")
        .doesNotContain("updatedBy")
        .doesNotContain("createdBy")
        .doesNotContain("spaceId");
    String markdown = om.readTree(raw).get("page").get("markdown").asText();
    assertThat(markdown).contains("하위 1분기").contains("‹접근 권한 없음›").contains("| 비밀 |");
  }

  // ── 401·404 ─────────────────────────────────────────────────────────────

  /**
   * 내부(WORKSPACE·PEOPLE) 링크는 로그인하면 열리는 링크라 401 {loginRequired:true}. 없는 토큰·만료된 외부 링크는 404 — 404 본문은
   * 모두 같다.
   */
  @Test
  void public_internal_token_401_login_required() throws Exception {
    String workspace = saveShare(rootId, "WORKSPACE", "EDIT", false, List.of());
    String people = saveShare(otherPageId, "PEOPLE", "VIEW", false, List.of(adminId));

    for (String t : List.of(workspace, people)) {
      String raw =
          anon(publicPath(t))
              .andExpect(status().isUnauthorized())
              .andExpect(jsonPath("$.loginRequired").value(true))
              .andReturn()
              .getResponse()
              .getContentAsString(StandardCharsets.UTF_8);
      // 401 에는 페이지·사람·워크스페이스 정보가 없다.
      assertThat(raw).doesNotContain("제품 로드맵").doesNotContain("비밀").doesNotContain(tenantName());
    }
    // 내부 링크로 첨부를 부르면 401 이 아니라 404(이미지 요청은 로그인으로 이어지지 않는다).
    anon(publicPath(workspace) + "/pages/" + rootId + "/attachments/1")
        .andExpect(status().isNotFound());

    // 없는 토큰·만료된 외부 링크는 같은 404.
    String expired = saveShare(childId, "PUBLIC", "VIEW", false, List.of());
    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.EXPIRES_AT, dbNow().minusMinutes(1))
        .where(WIKI_PAGE_SHARE.TOKEN.eq(expired))
        .execute();
    String unknownBody = notFoundMessage(publicPath("wsh_" + "x".repeat(40)));
    String expiredBody = notFoundMessage(publicPath(expired));
    assertThat(expiredBody).isEqualTo(unknownBody);
    // 만료된 내부 링크도 404(열 수 없는 링크는 로그인으로 보내지 않는다).
    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.EXPIRES_AT, dbNow().minusMinutes(1))
        .where(WIKI_PAGE_SHARE.TOKEN.eq(workspace))
        .execute();
    assertThat(notFoundMessage(publicPath(workspace))).isEqualTo(unknownBody);
  }

  /** 관리자가 외부 공유를 끄면 이미 열린 외부 보기의 새로고침·이미지 요청 모두 404(Ruling 1). */
  @Test
  void policy_off_public_view_and_attachment_404() throws Exception {
    String token = saveShare(rootId, "PUBLIC", "VIEW", true, List.of());
    long fileId = uploadPng(childId);
    anon(publicPath(token)).andExpect(status().isOk());
    anon(attachmentPath(token, childId, fileId)).andExpect(status().isOk());

    call(
            put("/api/v1/admin/wiki/share-policy")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("externalShareEnabled", false))),
            adminId)
        .andExpect(status().isOk());

    // 404 본문은 없는 토큰과 같다 — 정책으로 꺼진 링크인지 드러내지 않는다.
    String unknown = notFoundMessage(publicPath("wsh_" + "x".repeat(40)));
    assertThat(notFoundMessage(publicPath(token))).isEqualTo(unknown);
    assertThat(notFoundMessage(publicPath(token) + "?pageId=" + childId)).isEqualTo(unknown);
    assertThat(notFoundMessage(attachmentPath(token, childId, fileId))).isEqualTo(unknown);
  }

  // ── 헤더 ────────────────────────────────────────────────────────────────

  /** 보기·첨부의 성공·401·404 응답 모두 검색 제외·캐시 금지 헤더를 단다. */
  @Test
  void public_headers_noindex_nostore() throws Exception {
    String token = saveShare(rootId, "PUBLIC", "VIEW", false, List.of());
    String internal = saveShare(childId, "WORKSPACE", "VIEW", false, List.of());
    long fileId = uploadPng(rootId);

    // 401(로그인 필요)도 같은 헤더.
    anon(publicPath(internal)).andExpect(status().isUnauthorized());
    for (String path :
        List.of(
            publicPath(token),
            publicPath(internal),
            publicPath("wsh_none"),
            publicPath(token) + "?pageId=" + otherPageId,
            attachmentPath(token, rootId, fileId),
            attachmentPath(token, rootId, fileId + 1_000_000))) {
      anon(path)
          .andExpect(header().string("X-Robots-Tag", "noindex, nofollow"))
          .andExpect(header().string("Cache-Control", "no-store"));
    }
  }

  // ── 첨부 ────────────────────────────────────────────────────────────────

  /**
   * 공개 첨부는 공유 범위 안 페이지에, 그 페이지에 붙은 파일만 — 다른 페이지 경로로 부르거나 범위 밖 페이지의 첨부는 404. 첨부 요청은 조회 수를 올리지 않는다.
   */
  @Test
  void public_attachment_only_bound_to_shared_page() throws Exception {
    String token = saveShare(rootId, "PUBLIC", "VIEW", true, List.of());
    long childFile = uploadPng(childId);
    long outsideFile = uploadPng(siblingId);

    byte[] body =
        anon(attachmentPath(token, childId, childFile))
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Type", "image/png"))
            .andReturn()
            .getResponse()
            .getContentAsByteArray();
    assertThat(body).isEqualTo(PNG);

    // 범위 안 다른 페이지 경로로 같은 파일 — 바인딩이 다르면 404.
    anon(attachmentPath(token, rootId, childFile)).andExpect(status().isNotFound());
    // 범위 밖 페이지의 첨부 — 제 페이지 경로로도, 범위 안 페이지 경로로도 404.
    anon(attachmentPath(token, siblingId, outsideFile)).andExpect(status().isNotFound());
    anon(attachmentPath(token, childId, outsideFile)).andExpect(status().isNotFound());
    // 없는 토큰.
    anon(attachmentPath("wsh_none", childId, childFile)).andExpect(status().isNotFound());

    assertThat(viewCount(token)).isZero();
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  private static String publicPath(String token) {
    return "/api/v1/public/wiki/shares/" + token;
  }

  private static String attachmentPath(String token, long pageId, long fileId) {
    return publicPath(token) + "/pages/" + pageId + "/attachments/" + fileId;
  }

  /** 인증 헤더 없이 요청한다. 요청 뒤 테넌트 1 을 다시 심는다. */
  private ResultActions anon(String path) throws Exception {
    ResultActions r = mvc.perform(get(path));
    TenantContext.set(1L);
    return r;
  }

  /** 사용자 JWT(테넌트 1)로 요청한다. */
  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  /** 404 를 확인하고 본문의 message 를 돌려준다 — 없음·만료·정책 꺼짐이 같은 문구인지 비교한다. */
  private String notFoundMessage(String path) throws Exception {
    return json(anon(path).andExpect(status().isNotFound())).get("message").asText();
  }

  /** 설정 API 로 공유를 만들거나 바꾸고 토큰을 돌려준다(공유한 사람 = OWNER). */
  private String saveShare(
      long pageId, String audience, String permission, boolean includeChildren, List<Long> userIds)
      throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", audience);
    body.put("permission", permission);
    body.put("includeChildren", includeChildren);
    body.put("userIds", userIds);
    body.put("expiresAt", null);
    body.put("notify", Map.of());
    JsonNode res =
        json(
            call(
                    put("/api/v1/wiki/pages/" + pageId + "/share")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(body)),
                    ownerId)
                .andExpect(status().isOk()));
    return res.get("token").asText();
  }

  /** 멤버(OWNER)로 PNG 를 올리고 file id 를 돌려준다. */
  private long uploadPng(long pageId) throws Exception {
    MockMultipartFile f = new MockMultipartFile("file", "a.png", "image/png", PNG);
    JsonNode res =
        json(
            call(multipart("/api/v1/wiki/pages/{id}/attachments", pageId).file(f), ownerId)
                .andExpect(status().isCreated()));
    return res.get("fileId").asLong();
  }

  private void setBody(long pageId, String markdown) {
    dsl.update(WIKI_PAGE).set(WIKI_PAGE.BODY, markdown).where(WIKI_PAGE.ID.eq(pageId)).execute();
  }

  private long page(long spaceId, Long parentId, String title) {
    TenantContext.set(1L);
    long id = pageService.create(ownerId, spaceId, new CreatePageRequest(parentId, title)).id();
    TenantContext.set(1L);
    return id;
  }

  /** 테넌트#1 시스템 ADMIN 역할(wiki_share:manage 포함)을 준다. */
  private void grantAdminRole(long userId) {
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
  }

  private String tenantName() {
    return dsl.select(TENANT.NAME).from(TENANT).where(TENANT.ID.eq(1L)).fetchOne(TENANT.NAME);
  }

  private long viewCount(String token) {
    return dsl.select(WIKI_PAGE_SHARE.VIEW_COUNT)
        .from(WIKI_PAGE_SHARE)
        .where(WIKI_PAGE_SHARE.TOKEN.eq(token))
        .fetchOne(WIKI_PAGE_SHARE.VIEW_COUNT);
  }

  private static List<String> fieldNames(JsonNode node) {
    List<String> out = new ArrayList<>();
    node.fieldNames().forEachRemaining(out::add);
    return out;
  }

  private static List<Long> ids(JsonNode items) {
    List<Long> out = new ArrayList<>();
    items.forEach(r -> out.add(r.get("id").asLong()));
    return out;
  }

  private static JsonNode byId(JsonNode items, long id) {
    for (JsonNode r : items) {
      if (r.get("id").asLong() == id) {
        return r;
      }
    }
    throw new AssertionError("목록에 페이지가 없다: " + id);
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }
}
