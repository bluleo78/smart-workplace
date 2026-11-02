package com.workplace.wiki;

import static com.workplace.jooq.Tables.WIKI_HTML_SCRIPTS_CHECK;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.fileai.outbound.AiAgentDriveClient;
import com.workplace.fileai.outbound.AiAgentDriveClient.Evidence;
import com.workplace.fileai.outbound.AiAgentDriveClient.SecurityCheckReq;
import com.workplace.fileai.outbound.AiAgentDriveClient.SecurityCheckRes;
import com.workplace.fileai.security.FileSecurityCheckPipeline.Outcome;
import com.workplace.fileai.security.FileSecurityCheckRepository;
import com.workplace.fileai.security.ScriptDigest;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.jooq.tables.records.WikiHtmlScriptsCheckRecord;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.service.WikiHtmlScriptSources;
import com.workplace.wiki.service.WikiHtmlScriptsCheckPipeline;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiShareAccess;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 HTML 블록 보안 점검 API(WP-1290) — 앱 조회(읽기만)·요청(행 생성·되돌림)·권한(멤버·공유 토큰·비멤버)·공개 보기(지연 생성·기존 행 그대로·범위 밖
 * 404)·HTML 문서·페이지 삭제 CASCADE, 그리고 파이프라인(요지째 AI 호출 → DONE).
 *
 * <p>@Transactional: 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다. 커밋 뒤 점검은 돌지 않으므로 파이프라인은 직접 부른다(커밋 경로는
 * {@link WikiHtmlScriptsCheckCommitTest}).
 */
@Transactional
class WikiHtmlScriptsCheckTest extends ExternalClientMockedTestBase {

  private static final AssistantSpec SPEC =
      new AssistantSpec(1L, "claude-sonnet-4-6", "NORMAL", 1, 60_000);

  /** 스크립트가 든 HTML 블록 소스 하나. */
  static final String SCRIPT_SOURCE = "<script>fetch('https://evil.example/c')</script>";

  /** 위 소스를 담은 노트 본문 — 스크립트 없는 블록 하나를 함께 둔다(지문에 들지 않는다). */
  static final String BODY =
      "# 보고\n\n```html-embed\n" + SCRIPT_SOURCE + "\n```\n\n```html-embed\n<p>그냥 글</p>\n```\n";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiHtmlScriptsCheckPipeline pipeline;
  @Autowired AiAgentDriveClient driveClient;
  @Autowired AssistantResolver assistantResolver;

  private long ownerId;
  private long outsiderId;
  private long spaceId;
  private long rootId;
  private long siblingId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
    ownerId = withMembership(TestFixtures.createHuman(dsl));
    outsiderId = withMembership(TestFixtures.createHuman(dsl));
    spaceId = spaceService.createTeamSpace(ownerId, "점검-" + UUID.randomUUID()).id();
    rootId = page(null, "차트 노트");
    siblingId = page(null, "형제");
    setBody(rootId, BODY);
    setBody(siblingId, BODY);
  }

  // ── 앱 조회·요청 ─────────────────────────────────────────────────────────

  /** 조회는 저장된 내용의 지문·블록 수를 주고 행을 만들지 않는다(status null). */
  @Test
  void get_returns_hash_and_creates_no_row() throws Exception {
    JsonNode res = json(call(get(path(rootId)), ownerId).andExpect(status().isOk()));

    assertThat(res.get("hash").asText())
        .isEqualTo(WikiHtmlScriptSources.hash(List.of(SCRIPT_SOURCE)));
    assertThat(res.get("blockCount").asInt()).isEqualTo(1);
    assertThat(res.get("view").get("status").isNull()).isTrue();
    assertThat(res.get("view").get("reason").isNull()).isTrue();
    assertThat(rowCount(rootId)).isZero();
  }

  /** 스크립트 든 블록이 없으면 hash null·blockCount 0·view null. */
  @Test
  void get_without_scripts_returns_empty() throws Exception {
    setBody(rootId, "그냥 글\n\n```html-embed\n<p>x</p>\n```\n");
    JsonNode res = json(call(get(path(rootId)), ownerId).andExpect(status().isOk()));
    assertThat(res.get("hash").isNull()).isTrue();
    assertThat(res.get("blockCount").asInt()).isZero();
    assertThat(res.get("view").isNull()).isTrue();
    // 요청해도 행을 만들지 않는다.
    call(post(path(rootId)), ownerId).andExpect(status().isOk());
    assertThat(rowCount(rootId)).isZero();
  }

  /**
   * 요청은 PENDING 행을 (요지째) 만들고, 파이프라인은 그 요지로 AI 를 불러 DONE 으로 저장한다 — 보낸 요지는 이은 소스의 ScriptDigest, 파일명
   * 자리는 페이지 제목. 지금 기준의 DONE 은 다시 요청해도 그대로, FAILED 는 PENDING 으로 되돌린다.
   */
  @Test
  void post_creates_pending_then_pipeline_stores_done() throws Exception {
    stubHigh();
    JsonNode res = json(call(post(path(rootId)), ownerId).andExpect(status().isOk()));
    String hash = res.get("hash").asText();
    assertThat(res.get("view").get("status").asText()).isEqualTo("PENDING");

    String joined = WikiHtmlScriptSources.joined(List.of(SCRIPT_SOURCE));
    ScriptDigest.Result expected = ScriptDigest.build(joined);
    WikiHtmlScriptsCheckRecord row = row(rootId, hash);
    assertThat(row.getDigest()).isEqualTo(expected.text());
    assertThat(row.getBlockCount()).isEqualTo(1);

    assertThat(pipeline.check(rootId, hash)).isEqualTo(Outcome.DONE);

    ArgumentCaptor<SecurityCheckReq> req = ArgumentCaptor.forClass(SecurityCheckReq.class);
    verify(driveClient).securityCheck(req.capture());
    assertThat(req.getValue().digest()).isEqualTo(expected.text());
    assertThat(req.getValue().truncated()).isEqualTo(expected.truncated());
    assertThat(req.getValue().fileName()).isEqualTo("차트 노트");

    row = row(rootId, hash);
    assertThat(row.getStatus()).isEqualTo("DONE");
    assertThat(row.getCriteriaVersion()).isEqualTo(FileSecurityCheckRepository.CRITERIA_VERSION);
    JsonNode view = json(call(get(path(rootId)), ownerId)).get("view");
    assertThat(view.get("status").asText()).isEqualTo("DONE");
    assertThat(view.get("risk").asText()).isEqualTo("HIGH");
    assertThat(view.get("evidence").get(0).get("kind").asText()).isEqualTo("EXTERNAL_REQUEST");
    assertThat(view.get("outdated").asBoolean()).isFalse();

    // 지금 기준의 DONE 은 다시 요청해도 그대로.
    call(post(path(rootId)), ownerId).andExpect(status().isOk());
    assertThat(row(rootId, hash).getStatus()).isEqualTo("DONE");

    // FAILED 는 되돌린다.
    setStatus(rootId, hash, "FAILED", "boom");
    JsonNode again = json(call(post(path(rootId)), ownerId).andExpect(status().isOk()));
    assertThat(again.get("view").get("status").asText()).isEqualTo("PENDING");
    assertThat(row(rootId, hash).getAttempts()).isZero();
  }

  /** 크기 초과로 만든 FAILED(too-large)는 다시 요청해도 되돌리지 않는다 — reason TOO_LARGE. */
  @Test
  void too_large_row_is_not_reset() throws Exception {
    String hash = WikiHtmlScriptSources.hash(List.of(SCRIPT_SOURCE));
    dsl.insertInto(WIKI_HTML_SCRIPTS_CHECK)
        .set(WIKI_HTML_SCRIPTS_CHECK.PAGE_ID, rootId)
        .set(WIKI_HTML_SCRIPTS_CHECK.SOURCE_HASH, hash)
        .set(WIKI_HTML_SCRIPTS_CHECK.BLOCK_COUNT, 1)
        .set(WIKI_HTML_SCRIPTS_CHECK.DIGEST, "")
        .set(WIKI_HTML_SCRIPTS_CHECK.TRUNCATED, false)
        .set(WIKI_HTML_SCRIPTS_CHECK.STATUS, "FAILED")
        .set(WIKI_HTML_SCRIPTS_CHECK.ERROR, "too-large")
        .execute();
    JsonNode res = json(call(post(path(rootId)), ownerId).andExpect(status().isOk()));
    assertThat(res.get("view").get("status").asText()).isEqualTo("FAILED");
    assertThat(res.get("view").get("reason").asText()).isEqualTo("TOO_LARGE");
  }

  /** AI 가 없으면 행을 만들지 않고 reason NO_AI. */
  @Test
  void no_ai_creates_no_row() throws Exception {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    JsonNode res = json(call(post(path(rootId)), ownerId).andExpect(status().isOk()));
    assertThat(res.get("hash").isNull()).isFalse();
    assertThat(res.get("view").get("status").isNull()).isTrue();
    assertThat(res.get("view").get("reason").asText()).isEqualTo("NO_AI");
    assertThat(rowCount(rootId)).isZero();
    verify(driveClient, never()).securityCheck(any());
  }

  /** 스페이스 멤버가 아니면 조회·요청 모두 404(없는 페이지와 같다) — 행도 생기지 않는다. */
  @Test
  void non_member_gets_404() throws Exception {
    call(get(path(rootId)), outsiderId).andExpect(status().isNotFound());
    call(post(path(rootId)), outsiderId).andExpect(status().isNotFound());
    assertThat(rowCount(rootId)).isZero();
  }

  /** 공유 링크 헤더를 단 비멤버는 볼 수 있다(조회·요청). */
  @Test
  void share_token_viewer_allowed() throws Exception {
    String token = share(rootId, "WORKSPACE");
    MockHttpServletRequestBuilder getReq = get(path(rootId)).header(WikiShareAccess.HEADER, token);
    JsonNode res = json(call(getReq, outsiderId).andExpect(status().isOk()));
    assertThat(res.get("blockCount").asInt()).isEqualTo(1);
    MockHttpServletRequestBuilder postReq =
        post(path(rootId)).header(WikiShareAccess.HEADER, token);
    call(postReq, outsiderId).andExpect(status().isOk());
    assertThat(rowCount(rootId)).isEqualTo(1);
  }

  /** HTML 문서는 원본 HTML 전체가 소스 하나다. */
  @Test
  void html_document_counts_as_one_source() throws Exception {
    String html = "<html><body><div onclick=\"a()\">x</div><script>b()</script></body></html>";
    Map<String, Object> body = new HashMap<>();
    body.put("parentId", null);
    body.put("title", "문서");
    body.put("html", html);
    long id =
        json(call(
                    post("/api/v1/wiki/spaces/{id}/html-pages", spaceId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(body)),
                    ownerId)
                .andExpect(status().is2xxSuccessful()))
            .get("id")
            .asLong();

    JsonNode res = json(call(get(path(id)), ownerId).andExpect(status().isOk()));
    assertThat(res.get("blockCount").asInt()).isEqualTo(1);
    assertThat(res.get("hash").asText()).isEqualTo(WikiHtmlScriptSources.hash(List.of(html)));
  }

  /** 페이지가 지워지면 점검 행도 함께 지워진다(ON DELETE CASCADE). */
  @Test
  void page_delete_cascades() throws Exception {
    call(post(path(siblingId)), ownerId).andExpect(status().isOk());
    assertThat(rowCount(siblingId)).isEqualTo(1);
    dsl.deleteFrom(WIKI_PAGE).where(WIKI_PAGE.ID.eq(siblingId)).execute();
    assertThat(rowCount(siblingId)).isZero();
  }

  // ── 공개 보기 ───────────────────────────────────────────────────────────

  /**
   * 공개 조회는 보기가 내려보내는 내용의 지문과 상태를 주고, 행이 없을 때만 PENDING 행을 한 번 만든다. 기존 FAILED 행은 되돌리지 않는다(익명 호출이 다시
   * 점검을 강제하지 못한다).
   */
  @Test
  void public_lazily_creates_row_once_and_never_resets() throws Exception {
    String token = share(rootId, "PUBLIC");

    JsonNode res = json(anon(publicPath(token, rootId)).andExpect(status().isOk()));
    String hash = res.get("hash").asText();
    // 멘션·앱 주소가 없는 소스라 공개 본문과 저장 본문의 지문이 같다.
    assertThat(hash).isEqualTo(WikiHtmlScriptSources.hash(List.of(SCRIPT_SOURCE)));
    assertThat(res.get("blockCount").asInt()).isEqualTo(1);
    assertThat(res.get("view").get("status").asText()).isEqualTo("PENDING");
    assertThat(rowCount(rootId)).isEqualTo(1);

    anon(publicPath(token, rootId)).andExpect(status().isOk());
    assertThat(rowCount(rootId)).isEqualTo(1);

    setStatus(rootId, hash, "FAILED", "boom");
    JsonNode again = json(anon(publicPath(token, rootId)).andExpect(status().isOk()));
    assertThat(again.get("view").get("status").asText()).isEqualTo("FAILED");
    assertThat(row(rootId, hash).getStatus()).isEqualTo("FAILED");
  }

  /** 공유 범위 밖 페이지·없는 토큰은 404, 내부 링크는 401 — 보기와 같다. 행은 생기지 않는다. */
  @Test
  void public_outside_scope_404_internal_401() throws Exception {
    String token = share(rootId, "PUBLIC");
    anon(publicPath(token, siblingId)).andExpect(status().isNotFound());
    anon(publicPath("wsh_nope" + UUID.randomUUID(), rootId)).andExpect(status().isNotFound());
    String internal = share(siblingId, "WORKSPACE");
    anon(publicPath(internal, siblingId)).andExpect(status().isUnauthorized());
    assertThat(rowCount(siblingId)).isZero();
  }

  /** 공개 본문은 HTML 블록의 앱 주소를 가린다 — 지문은 가린 내용(보기가 내려보내는 것)으로 계산한다. */
  @Test
  void public_hash_uses_masked_markdown() throws Exception {
    String source = "<script>fetch(\"/api/v1/secret\")</script>";
    setBody(rootId, "```html-embed\n" + source + "\n```\n");
    String token = share(rootId, "PUBLIC");

    JsonNode pub = json(anon(publicPath(token, rootId)).andExpect(status().isOk()));
    JsonNode app = json(call(get(path(rootId)), ownerId).andExpect(status().isOk()));
    assertThat(app.get("hash").asText()).isEqualTo(WikiHtmlScriptSources.hash(List.of(source)));
    assertThat(pub.get("hash").asText())
        .isEqualTo(WikiHtmlScriptSources.hash(List.of("<script>fetch(\"\")</script>")))
        .isNotEqualTo(app.get("hash").asText());
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  private static String path(long pageId) {
    return "/api/v1/wiki/pages/" + pageId + "/html-scripts/security-check";
  }

  private static String publicPath(String token, long pageId) {
    return "/api/v1/public/wiki/shares/"
        + token
        + "/pages/"
        + pageId
        + "/html-scripts/security-check";
  }

  /** AI 가 HIGH·근거 1건을 돌려주게 한다. */
  private void stubHigh() {
    when(driveClient.securityCheck(any()))
        .thenReturn(
            new SecurityCheckRes(
                "HIGH",
                "외부로 요청해요",
                List.of(new Evidence("EXTERNAL_REQUEST", "evil.example 로 요청"))));
  }

  private long page(Long parentId, String title) {
    long id = pageService.create(ownerId, spaceId, new CreatePageRequest(parentId, title)).id();
    TenantContext.set(1L);
    return id;
  }

  private void setBody(long pageId, String markdown) {
    dsl.update(WIKI_PAGE).set(WIKI_PAGE.BODY, markdown).where(WIKI_PAGE.ID.eq(pageId)).execute();
  }

  /** 공유 행을 바로 넣고 토큰을 돌려준다(하위 미포함·보기 권한·무기한). */
  private String share(long pageId, String audience) {
    String token = "wsh_test" + UUID.randomUUID().toString().replace("-", "");
    dsl.insertInto(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.PAGE_ID, pageId)
        .set(WIKI_PAGE_SHARE.SPACE_ID, spaceId)
        .set(WIKI_PAGE_SHARE.TOKEN, token)
        .set(WIKI_PAGE_SHARE.AUDIENCE, audience)
        .set(WIKI_PAGE_SHARE.PERMISSION, "VIEW")
        .set(WIKI_PAGE_SHARE.INCLUDE_CHILDREN, false)
        .set(WIKI_PAGE_SHARE.CREATED_BY, ownerId)
        .execute();
    return token;
  }

  private void setStatus(long pageId, String hash, String status, String error) {
    dsl.update(WIKI_HTML_SCRIPTS_CHECK)
        .set(WIKI_HTML_SCRIPTS_CHECK.STATUS, status)
        .set(WIKI_HTML_SCRIPTS_CHECK.ERROR, error)
        .set(WIKI_HTML_SCRIPTS_CHECK.ATTEMPTS, 3)
        .where(WIKI_HTML_SCRIPTS_CHECK.PAGE_ID.eq(pageId))
        .and(WIKI_HTML_SCRIPTS_CHECK.SOURCE_HASH.eq(hash))
        .execute();
  }

  private int rowCount(long pageId) {
    return dsl.fetchCount(WIKI_HTML_SCRIPTS_CHECK, WIKI_HTML_SCRIPTS_CHECK.PAGE_ID.eq(pageId));
  }

  private WikiHtmlScriptsCheckRecord row(long pageId, String hash) {
    return dsl.selectFrom(WIKI_HTML_SCRIPTS_CHECK)
        .where(WIKI_HTML_SCRIPTS_CHECK.PAGE_ID.eq(pageId))
        .and(WIKI_HTML_SCRIPTS_CHECK.SOURCE_HASH.eq(hash))
        .fetchOne();
  }

  /** 인증 헤더 없이 요청한다. 요청 뒤 테넌트 1 을 다시 심는다. */
  private ResultActions anon(String p) throws Exception {
    ResultActions r = mvc.perform(get(p));
    TenantContext.set(1L);
    return r;
  }

  /** 사용자 JWT(테넌트 1)로 요청한다. 요청이 테넌트 컨텍스트를 지우므로 다시 심는다. */
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
