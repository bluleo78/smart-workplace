package com.workplace.wiki;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.exception.WikiPageKindMismatchException;
import com.workplace.wiki.service.WikiCollabDocService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「HTML 문서」 페이지(WP-1307) — 만들기·원본 저장·판 기록과 되돌리기·검색·공유·종류 경계(노트 저장 경로·동기화 서버가 HTML 문서를 건드리지 않음)·크기
 * 상한.
 *
 * <p>@Transactional: 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다.
 */
@Transactional
class WikiHtmlPageTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiCollabDocService collabService;

  private static final String HTML_V1 =
      "<!doctype html><html><head><title>3분기 회고</title>"
          + "<style>.card{color:red}</style><script>window.chart='막대그래프스크립트'</script></head>"
          + "<body><h1>출시·운영 요약</h1><div class=\"card\"><p>출시 <b>4건</b></p>"
          + "<p>만족도 4.7</p></div></body></html>";
  private static final String HTML_V2 =
      "<html><body><h1>출시·운영 요약 (최종)</h1><p>장애 1건</p></body></html>";

  private long ownerId;
  private long editorId;
  private long viewerId;
  private long spaceId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human();
    editorId = human();
    viewerId = human();
    spaceId = spaceService.createTeamSpace(ownerId, "HTML문서-" + UUID.randomUUID()).id();
    spaceService.addMember(ownerId, spaceId, editorId, "EDITOR");
    spaceService.addMember(ownerId, spaceId, viewerId, "VIEWER");
  }

  /** 만들면 종류 HTML·원본 그대로·body 는 뽑은 글자(스크립트·스타일 글자 없음). 트리에도 종류가 실린다. */
  @Test
  void create_keeps_source_and_extracts_text() throws Exception {
    JsonNode page = json(create(editorId, null, "회고", HTML_V1).andExpect(status().isCreated()));
    assertThat(page.get("kind").asText()).isEqualTo("HTML");
    assertThat(page.get("html").asText()).isEqualTo(HTML_V1);
    String body = page.get("body").asText();
    assertThat(body).contains("3분기 회고", "출시·운영 요약", "출시 4건", "만족도 4.7");
    assertThat(body).doesNotContain("<", "막대그래프스크립트", "color:red");

    JsonNode read = read(page.get("id").asLong(), viewerId);
    assertThat(read.get("html").asText()).isEqualTo(HTML_V1);

    JsonNode tree =
        json(
            call(get("/api/v1/wiki/spaces/{id}/pages", spaceId), viewerId)
                .andExpect(status().isOk()));
    assertThat(tree.get(0).get("kind").asText()).isEqualTo("HTML");
  }

  /** 일반 노트는 종류 NOTE·html null — 기존 응답 모양은 그대로다. */
  @Test
  void note_reports_note_kind() throws Exception {
    long noteId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "노트")).id();
    JsonNode note = read(noteId, ownerId);
    assertThat(note.get("kind").asText()).isEqualTo("NOTE");
    assertThat(note.get("html").isNull()).isTrue();
  }

  /** VIEWER 는 만들 수도 저장할 수도 없다(403). */
  @Test
  void viewer_cannot_create_or_save() throws Exception {
    create(viewerId, null, "x", HTML_V1).andExpect(status().isForbidden());
    JsonNode page = json(create(editorId, null, "회고", HTML_V1));
    saveHtml(page.get("id").asLong(), viewerId, HTML_V2, page.get("version").asInt())
        .andExpect(status().isForbidden());
  }

  /**
   * 저장할 때마다 직전 판이 버전 기록에 남고(원본 HTML 포함), 되돌리기는 그 원본으로 돌아간다. 낡은 version 은 409, 같은 원본은 판·version 을
   * 늘리지 않는다.
   */
  @Test
  void save_records_revision_and_restore_returns_source() throws Exception {
    JsonNode page = json(create(editorId, null, "회고", HTML_V1));
    long id = page.get("id").asLong();
    int v1 = page.get("version").asInt();

    JsonNode saved = json(saveHtml(id, editorId, HTML_V2, v1).andExpect(status().isOk()));
    assertThat(saved.get("html").asText()).isEqualTo(HTML_V2);
    assertThat(saved.get("body").asText()).contains("장애 1건").doesNotContain("만족도");
    int v2 = saved.get("version").asInt();
    assertThat(v2).isEqualTo(v1 + 1);

    // 낡은 version → 409(그 사이 다른 저장).
    saveHtml(id, editorId, "<p>다른 저장</p>", v1).andExpect(status().isConflict());
    // 같은 원본 재저장은 아무것도 바꾸지 않는다.
    JsonNode same = json(saveHtml(id, editorId, HTML_V2, v2).andExpect(status().isOk()));
    assertThat(same.get("version").asInt()).isEqualTo(v2);

    JsonNode revisions =
        json(
            call(get("/api/v1/wiki/pages/{id}/revisions", id), viewerId)
                .andExpect(status().isOk()));
    JsonNode items = revisions.get("items") != null ? revisions.get("items") : revisions;
    assertThat(items.toString()).contains("\"version\":" + v1);
    JsonNode rev =
        json(
            call(get("/api/v1/wiki/pages/{id}/revisions/{v}", id, v1), viewerId)
                .andExpect(status().isOk()));
    assertThat(rev.get("html").asText()).isEqualTo(HTML_V1);

    JsonNode restored =
        json(
            call(post("/api/v1/wiki/pages/{id}/revisions/{v}/restore", id, v1), editorId)
                .andExpect(status().isOk()));
    assertThat(restored.get("html").asText()).isEqualTo(HTML_V1);
    assertThat(restored.get("body").asText()).contains("만족도 4.7");
    // 되돌리기 직전 판(v2)도 남는다.
    JsonNode rev2 =
        json(
            call(get("/api/v1/wiki/pages/{id}/revisions/{v}", id, v2), viewerId)
                .andExpect(status().isOk()));
    assertThat(rev2.get("html").asText()).isEqualTo(HTML_V2);
    assertThat(rev2.get("reason").asText()).isEqualTo("RESTORE");
  }

  /** 노트 검색이 HTML 문서 본문 글자로 찾는다 — 스크립트 안 글자로는 찾지 않는다. */
  @Test
  void search_finds_body_text() throws Exception {
    JsonNode page = json(create(editorId, null, "회고", HTML_V1));
    long id = page.get("id").asLong();
    JsonNode hits =
        json(
            call(
                    get("/api/v1/wiki/search").param("q", "만족도 4.7").param("spaceId", "" + spaceId),
                    viewerId)
                .andExpect(status().isOk()));
    assertThat(hits.toString()).contains("\"id\":" + id);
    JsonNode none =
        json(
            call(
                    get("/api/v1/wiki/search")
                        .param("q", "막대그래프스크립트")
                        .param("spaceId", "" + spaceId),
                    viewerId)
                .andExpect(status().isOk()));
    assertThat(none.toString()).doesNotContain("\"id\":" + id);
  }

  /** 종류 경계 — HTML 문서에 마크다운 본문 저장은 409(제목만은 된다), 노트에 원본 저장도 409. 동기화 서버 연결·문서 로드도 거절한다. */
  @Test
  void kind_boundaries_are_enforced() throws Exception {
    JsonNode page = json(create(editorId, null, "회고", HTML_V1));
    long id = page.get("id").asLong();
    int version = page.get("version").asInt();

    Map<String, Object> md = new HashMap<>();
    md.put("body", "# 덮어쓰기");
    md.put("version", version);
    call(putJson("/api/v1/wiki/pages/" + id, md), editorId).andExpect(status().isConflict());
    assertThat(read(id, ownerId).get("html").asText()).isEqualTo(HTML_V1);

    Map<String, Object> titleOnly = new HashMap<>();
    titleOnly.put("title", "새 제목");
    JsonNode renamed =
        json(
            call(putJson("/api/v1/wiki/pages/" + id, titleOnly), editorId)
                .andExpect(status().isOk()));
    assertThat(renamed.get("title").asText()).isEqualTo("새 제목");
    assertThat(renamed.get("html").asText()).isEqualTo(HTML_V1);

    long noteId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "노트")).id();
    saveHtml(noteId, ownerId, HTML_V2, 1).andExpect(status().isConflict());

    call(get("/api/v1/wiki/pages/{id}/collab-access", id), editorId)
        .andExpect(status().isConflict());
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> collabService.load(id))
        .isInstanceOf(WikiPageKindMismatchException.class);
  }

  /** 원본 크기 상한 5MB(UTF-8 바이트) — 넘으면 413, 만들기·저장 모두. */
  @Test
  void rejects_source_over_5mb() throws Exception {
    // 한글 한 글자 = 3바이트 → 글자 수로는 상한 아래여도 바이트로 넘는다.
    String big = "<p>" + "가".repeat(5 * 1024 * 1024 / 3 + 10) + "</p>";
    create(editorId, null, "큰 문서", big).andExpect(status().isPayloadTooLarge());
    JsonNode page = json(create(editorId, null, "회고", HTML_V1));
    saveHtml(page.get("id").asLong(), editorId, big, page.get("version").asInt())
        .andExpect(status().isPayloadTooLarge());
  }

  /** 빈 문서로 만들 수 있고, 첫 원본 저장은 판을 남기지 않는다(직전 원본이 비어 있다). */
  @Test
  void empty_document_then_first_save() throws Exception {
    JsonNode page = json(create(editorId, null, "빈 문서", ""));
    long id = page.get("id").asLong();
    assertThat(page.get("html").asText()).isEmpty();
    saveHtml(id, editorId, HTML_V2, page.get("version").asInt()).andExpect(status().isOk());
    JsonNode revisions =
        json(
            call(get("/api/v1/wiki/pages/{id}/revisions", id), viewerId)
                .andExpect(status().isOk()));
    assertThat(revisions.toString()).doesNotContain("\"reason\":\"SESSION\"");
  }

  /** 공개 공유 화면은 원본 HTML 과 종류를 싣는다(트리 줄에도 종류). */
  @Test
  void public_share_carries_source() throws Exception {
    JsonNode page = json(create(editorId, null, "회고", HTML_V1));
    long id = page.get("id").asLong();
    Map<String, Object> share = new LinkedHashMap<>();
    share.put("audience", "PUBLIC");
    share.put("permission", "VIEW");
    share.put("includeChildren", false);
    share.put("userIds", List.of());
    share.put("expiresAt", null);
    share.put("notify", Map.of());
    String token =
        json(call(putJson("/api/v1/wiki/pages/" + id + "/share", share), ownerId)
                .andExpect(status().isOk()))
            .get("token")
            .asText();
    ResultActions r = mvc.perform(get("/api/v1/public/wiki/shares/" + token));
    TenantContext.set(1L);
    JsonNode res = json(r.andExpect(status().isOk()));
    assertThat(res.get("page").get("kind").asText()).isEqualTo("HTML");
    assertThat(res.get("page").get("html").asText()).isEqualTo(HTML_V1);
    assertThat(res.get("pages").get(0).get("kind").asText()).isEqualTo("HTML");
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  private long human() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  private ResultActions create(long userId, Long parentId, String title, String html)
      throws Exception {
    Map<String, Object> body = new HashMap<>();
    body.put("parentId", parentId);
    body.put("title", title);
    body.put("html", html);
    return call(
        post("/api/v1/wiki/spaces/{id}/html-pages", spaceId)
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(body)),
        userId);
  }

  private ResultActions saveHtml(long id, long userId, String html, int version) throws Exception {
    Map<String, Object> body = new HashMap<>();
    body.put("html", html);
    body.put("version", version);
    return call(putJson("/api/v1/wiki/pages/" + id + "/html", body), userId);
  }

  private MockHttpServletRequestBuilder putJson(String path, Map<String, Object> body)
      throws Exception {
    return put(path).contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body));
  }

  private JsonNode read(long id, long userId) throws Exception {
    return json(call(get("/api/v1/wiki/pages/{id}", id), userId).andExpect(status().isOk()));
  }

  /** 브라우저 세션처럼 JWT 로 부른다(사람 경로 — ai=false). 요청이 테넌트 컨텍스트를 지우므로 다시 심는다. */
  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }
}
