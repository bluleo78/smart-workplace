package com.workplace.wiki;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doReturn;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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
import com.workplace.wiki.dto.SaveHtmlPageRequest;
import com.workplace.wiki.exception.WikiHtmlLockedException;
import com.workplace.wiki.service.WikiHtmlLockClock;
import com.workplace.wiki.service.WikiHtmlPageService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
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
 * 「HTML 문서」 편집 잠금(WP-1308) — 편집 시작·막힘(편집·저장·다시 올리기·되돌리기·MCP/AI)·저장/취소로 풀림·10분 무입력 만료와 임시 저장본·이어 고치기
 * 정보·강제 풀기 권한·편집 세션 표지(token: 늦은·다른 창 신호 거절, 같은 사람 다른 창의 넘겨받기, 편집하는 사람 이름의 AI 저장 거절).
 *
 * <p>@Transactional: 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다. 시간은 {@link WikiHtmlLockClock} 스파이로 옮긴다(실제로
 * 기다리지 않는다). 동시에 얻기는 커밋이 필요해 {@link WikiHtmlLockConcurrencyTest} 가 따로 본다.
 */
@Transactional
class WikiHtmlLockTest extends IntegrationTestBase {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiHtmlPageService htmlPageService;
  @Autowired WikiHtmlLockClock lockClock;

  private static final String HTML_V1 = "<html><body><h1>회고</h1><p>처음</p></body></html>";
  private static final String HTML_A = "<html><body><h1>회고</h1><p>A 가 고침</p></body></html>";
  private static final String HTML_B = "<html><body><h1>회고</h1><p>B 가 고침</p></body></html>";

  private long ownerId;
  private long aId;
  private long bId;
  private long viewerId;
  private long spaceId;
  private long pageId;

  @BeforeEach
  void seed() throws Exception {
    TenantContext.set(1L);
    ownerId = human();
    aId = human();
    bId = human();
    viewerId = human();
    spaceId = spaceService.createTeamSpace(ownerId, "HTML잠금-" + UUID.randomUUID()).id();
    spaceService.addMember(ownerId, spaceId, aId, "EDITOR");
    spaceService.addMember(ownerId, spaceId, bId, "EDITOR");
    spaceService.addMember(ownerId, spaceId, viewerId, "VIEWER");
    Map<String, Object> body = new HashMap<>();
    body.put("parentId", null);
    body.put("title", "회고");
    body.put("html", HTML_V1);
    pageId =
        json(call(postJson("/api/v1/wiki/spaces/" + spaceId + "/html-pages", body), aId))
            .get("id")
            .asLong();
  }

  /** A 가 편집하면 B 는 편집 시작·저장·다시 올리기(같은 저장 경로)·되돌리기가 모두 409 이고, 이유에 A 이름이 실린다. 보는 사람도 상태를 본다. */
  @Test
  void others_are_blocked_while_locked() throws Exception {
    // 되돌릴 판을 하나 만들어 둔다(잠금 없이 저장 — 판 v1 이 남는다).
    int v1 = version();
    saveHtml(aId, HTML_A, v1).andExpect(status().isOk());

    JsonNode acquired = json(acquire(aId).andExpect(status().isOk()));
    assertThat(acquired.get("lock").get("mine").asBoolean()).isTrue();
    assertThat(acquired.get("token").asText()).isNotBlank();
    assertThat(acquired.get("draft").isNull()).isTrue();

    JsonNode refused = json(acquire(bId).andExpect(status().isConflict()));
    assertThat(refused.get("errors").get("code").asText()).isEqualTo("HTML_LOCKED");
    assertThat(refused.get("errors").get("holderName").asText()).isEqualTo(nameOf(aId));
    assertThat(refused.get("message").asText()).contains(nameOf(aId), "편집 중");

    int v = version();
    // 소스 저장·다시 올리기 모두 PUT /html 이다.
    JsonNode saveRefused = json(saveHtml(bId, HTML_B, v).andExpect(status().isConflict()));
    assertThat(saveRefused.get("errors").get("code").asText()).isEqualTo("HTML_LOCKED");
    // version 이 낡았어도 「편집 중」을 먼저 알린다(무엇을 기다려야 하는지가 더 쓸모 있다).
    JsonNode staleRefused = json(saveHtml(bId, HTML_B, v - 1).andExpect(status().isConflict()));
    assertThat(staleRefused.get("errors").get("code").asText()).isEqualTo("HTML_LOCKED");
    // 되돌리기도 원본을 바꾸므로 막는다.
    JsonNode restoreRefused = json(restore(bId, v1).andExpect(status().isConflict()));
    assertThat(restoreRefused.get("errors").get("code").asText()).isEqualTo("HTML_LOCKED");

    JsonNode seenByB = lockOf(bId);
    assertThat(seenByB.get("locked").asBoolean()).isTrue();
    assertThat(seenByB.get("mine").asBoolean()).isFalse();
    assertThat(seenByB.get("holderName").asText()).isEqualTo(nameOf(aId));
    assertThat(seenByB.get("canForceRelease").asBoolean()).isFalse();
    assertThat(lockOf(viewerId).get("locked").asBoolean()).isTrue();
    assertThat(lockOf(ownerId).get("canForceRelease").asBoolean()).isTrue();
    // 상태 조회의 mine 은 사람으로 가른다.
    assertThat(lockOf(aId).get("mine").asBoolean()).isTrue();
    // 잠금 상태 응답에 편집 세션 표지는 없다.
    assertThat(seenByB.has("token")).isFalse();

    // 원본은 그대로다.
    assertThat(read().get("html").asText()).isEqualTo(HTML_A);
  }

  /** 편집 「저장」(token)은 잠금을 풀고 임시 저장본을 지운다 — 그다음 B 가 편집을 시작할 수 있다. */
  @Test
  void save_releases_lock() throws Exception {
    String a = acquireToken(aId);
    heartbeat(aId, a, HTML_A, version()).andExpect(status().isOk());
    saveHtml(aId, a, HTML_A, version()).andExpect(status().isOk());

    assertThat(lockOf(bId).get("locked").asBoolean()).isFalse();
    String b = acquireToken(bId);
    // A 의 임시 저장본은 저장과 함께 지워졌다 — A 가 다시 편집을 시작하면(B 가 풀고 나서) 이어 고칠 것이 없다.
    release(bId, b).andExpect(status().isNoContent());
    assertThat(json(acquire(aId)).get("draft").isNull()).isTrue();
  }

  /** 저장·취소 뒤에 도착한 늦은 편집 중 신호는 mine=false 로 거절되고, 잠금을 다시 쥐지 않고 지운 임시 저장본도 되살리지 않는다. */
  @Test
  void late_heartbeat_after_save_or_cancel_does_not_relock() throws Exception {
    String a = acquireToken(aId);
    int base = version();
    saveHtml(aId, a, HTML_A, base).andExpect(status().isOk());
    JsonNode late = json(heartbeat(aId, a, HTML_A + "<!-- 늦은 신호 -->", base));
    assertThat(late.get("locked").asBoolean()).isFalse();
    assertThat(late.get("mine").asBoolean()).isFalse();
    assertThat(lockOf(bId).get("locked").asBoolean()).isFalse();

    String a2 = acquireToken(aId);
    release(aId, a2).andExpect(status().isNoContent());
    heartbeat(aId, a2, HTML_B, version()).andExpect(status().isOk());
    assertThat(lockOf(bId).get("locked").asBoolean()).isFalse();
    assertThat(json(acquire(aId)).get("draft").isNull()).isTrue();
  }

  /** 강제로 풀린 뒤의 늦은 신호는 잠금을 다시 쥐지 않고 임시 저장본도 건드리지 않는다(풀릴 때까지 남긴 내용이 남는다). */
  @Test
  void late_heartbeat_after_force_release_is_rejected() throws Exception {
    String a = acquireToken(aId);
    heartbeat(aId, a, HTML_A, version()).andExpect(status().isOk());
    forceRelease(ownerId).andExpect(status().isNoContent());
    JsonNode late = json(heartbeat(aId, a, HTML_B, version()).andExpect(status().isOk()));
    assertThat(late.get("mine").asBoolean()).isFalse();
    assertThat(lockOf(bId).get("locked").asBoolean()).isFalse();
    assertThat(json(acquire(aId)).get("draft").get("html").asText()).isEqualTo(HTML_A);
  }

  /** 다른 세션 표지의 신호(남·다른 창)는 mine=false 로 거절되고 그 잠금을 빼앗지도, 마지막 입력 시각을 미루지도 않는다. */
  @Test
  void heartbeat_with_other_token_is_rejected_without_retake() throws Exception {
    String a = acquireToken(aId);
    JsonNode wrong =
        json(
            heartbeat(bId, UUID.randomUUID().toString(), HTML_B, version())
                .andExpect(status().isOk()));
    assertThat(wrong.get("locked").asBoolean()).isTrue();
    assertThat(wrong.get("mine").asBoolean()).isFalse();
    assertThat(wrong.get("holderName").asText()).isEqualTo(nameOf(aId));
    // 표지 없는 신호도 같다.
    assertThat(json(heartbeat(aId, null, HTML_B, version())).get("mine").asBoolean()).isFalse();
    // B 의 신호가 B 의 임시 저장본을 남기지 않았다.
    release(aId, a).andExpect(status().isNoContent());
    assertThat(json(acquire(bId)).get("draft").isNull()).isTrue();
  }

  /**
   * 같은 사람이 다른 창에서 「편집」하면 새 세션이 넘겨받는다 — 먼저 연 창의 신호는 mine=false 를 받고, 그 창의 취소·저장은 새 창의 잠금·임시 저장본을
   * 건드리지 못한다(저장은 409).
   */
  @Test
  void same_user_second_window_takes_over() throws Exception {
    String first = acquireToken(aId);
    heartbeat(aId, first, HTML_A, version()).andExpect(status().isOk());
    String second = acquireToken(aId);
    assertThat(second).isNotEqualTo(first);
    heartbeat(aId, second, HTML_B, version()).andExpect(status().isOk());

    JsonNode stale = json(heartbeat(aId, first, HTML_A + "<!-- 옛 창 -->", version()));
    assertThat(stale.get("locked").asBoolean()).isTrue();
    assertThat(stale.get("mine").asBoolean()).isFalse();
    // 옛 창의 취소는 아무것도 바꾸지 않고, 옛 창의 저장은 막힌다.
    release(aId, first).andExpect(status().isNoContent());
    assertThat(lockOf(bId).get("locked").asBoolean()).isTrue();
    JsonNode refused =
        json(saveHtml(aId, first, HTML_A, version()).andExpect(status().isConflict()));
    assertThat(refused.get("errors").get("code").asText()).isEqualTo("HTML_LOCKED");

    // 새 창이 쥔 채 그 창의 신호가 남긴 임시 저장본이 남아 있다.
    forceRelease(ownerId).andExpect(status().isNoContent());
    assertThat(json(acquire(aId)).get("draft").get("html").asText()).isEqualTo(HTML_B);
  }

  /** 바뀐 것 없이 「저장」해도 편집이 끝난다(잠금이 풀린다). */
  @Test
  void unchanged_save_still_releases() throws Exception {
    String a = acquireToken(aId);
    saveHtml(aId, a, HTML_V1, version()).andExpect(status().isOk());
    assertThat(lockOf(bId).get("locked").asBoolean()).isFalse();
  }

  /** 취소하면 잠금이 풀리고 임시 저장본도 지운다. */
  @Test
  void cancel_releases_and_discards_draft() throws Exception {
    String a = acquireToken(aId);
    heartbeat(aId, a, HTML_A, version()).andExpect(status().isOk());
    release(aId, a).andExpect(status().isNoContent());

    String b = acquireToken(bId);
    release(bId, b).andExpect(status().isNoContent());
    assertThat(json(acquire(aId)).get("draft").isNull()).isTrue();
  }

  /**
   * 입력이 10분 없으면 잠금이 저절로 풀리고 고치던 내용은 임시 저장본으로 남는다. 그사이 B 가 저장했으면 A 가 다시 「편집」할 때 이어 고칠 내용과 함께 「그사이
   * 저장됨」이 실린다. 만료된 A 의 편집 중 신호는 B 의 잠금을 빼앗지 못하고(mine=false) 임시 저장본도 바꾸지 않는다.
   */
  @Test
  void idle_lock_expires_keeping_draft_and_reports_save_since() throws Exception {
    int base = version();
    String a = acquireToken(aId);
    heartbeat(aId, a, HTML_A, base).andExpect(status().isOk());

    // 9분 뒤에는 아직 잠겨 있다.
    shiftClock(Duration.ofMinutes(9));
    acquire(bId).andExpect(status().isConflict());
    // 10분 1초 뒤 — 풀린 것으로 본다. 만료된 A 의 신호는 다시 쥐지 않는다.
    shiftClock(Duration.ofMinutes(10).plusSeconds(1));
    assertThat(lockOf(bId).get("locked").asBoolean()).isFalse();
    assertThat(json(heartbeat(aId, a, HTML_A, base)).get("mine").asBoolean()).isFalse();
    assertThat(lockOf(bId).get("locked").asBoolean()).isFalse();
    String b = acquireToken(bId);
    JsonNode late = json(heartbeat(aId, a, HTML_A + "<!-- 더 -->", base).andExpect(status().isOk()));
    assertThat(late.get("mine").asBoolean()).isFalse();
    assertThat(late.get("holderName").asText()).isEqualTo(nameOf(bId));
    saveHtml(bId, b, HTML_B, base).andExpect(status().isOk());

    JsonNode resumed = json(acquire(aId).andExpect(status().isOk()));
    JsonNode draft = resumed.get("draft");
    assertThat(draft.get("html").asText()).isEqualTo(HTML_A);
    assertThat(draft.get("baseVersion").asInt()).isEqualTo(base);
    assertThat(draft.get("pageChangedSince").asBoolean()).isTrue();
  }

  /** 편집 중 신호가 마지막 입력 시각을 미뤄 10분 규칙이 다시 시작된다. */
  @Test
  void heartbeat_extends_lock() throws Exception {
    String a = acquireToken(aId);
    shiftClock(Duration.ofMinutes(8));
    assertThat(json(heartbeat(aId, a, HTML_A, version())).get("mine").asBoolean()).isTrue();
    shiftClock(Duration.ofMinutes(16));
    acquire(bId).andExpect(status().isConflict());
  }

  /** 스페이스 소유자는 남의 잠금을 강제로 풀 수 있고, 편집하던 사람의 임시 저장본은 남는다. 편집자·보는 사람은 403. */
  @Test
  void force_release_by_owner_only_keeps_draft() throws Exception {
    String a = acquireToken(aId);
    heartbeat(aId, a, HTML_A, version()).andExpect(status().isOk());

    forceRelease(bId).andExpect(status().isForbidden());
    forceRelease(viewerId).andExpect(status().isForbidden());
    // 보통의 풀기는 남의 잠금을 건드리지 않는다(표지가 없거나 다르다).
    release(bId, null).andExpect(status().isNoContent());
    release(bId, UUID.randomUUID().toString()).andExpect(status().isNoContent());
    assertThat(lockOf(bId).get("locked").asBoolean()).isTrue();

    forceRelease(ownerId).andExpect(status().isNoContent());
    assertThat(lockOf(bId).get("locked").asBoolean()).isFalse();
    release(bId, acquireToken(bId)).andExpect(status().isNoContent());

    JsonNode resumed = json(acquire(aId).andExpect(status().isOk()));
    assertThat(resumed.get("draft").get("html").asText()).isEqualTo(HTML_A);
    assertThat(resumed.get("draft").get("pageChangedSince").asBoolean()).isFalse();
  }

  /** MCP·AI 경로(ai=true)도 누가 편집 중이면 거절하고, 잠금이 없으면 저장한다. */
  @Test
  void ai_save_follows_lock() throws Exception {
    long agentEditor = bId;
    String a = acquireToken(aId);
    int v = version();
    assertThatThrownBy(
            () ->
                htmlPageService.save(
                    agentEditor, pageId, new SaveHtmlPageRequest(null, HTML_B, v), true))
        .isInstanceOf(WikiHtmlLockedException.class)
        .hasMessageContaining(nameOf(aId));

    release(aId, a).andExpect(status().isNoContent());
    assertThat(
            htmlPageService
                .save(agentEditor, pageId, new SaveHtmlPageRequest(null, HTML_B, v), true)
                .html())
        .isEqualTo(HTML_B);
  }

  /**
   * 편집하는 사람 이름으로 도는 AI 저장(표지 없음)도 409 다 — 그 사람의 잠금을 풀거나 임시 저장본을 지우지 않는다(예전엔 사람으로 가려 AI 저장이 편집을 끝내
   * 버렸다).
   */
  @Test
  void ai_save_as_editing_user_is_blocked_and_keeps_session() throws Exception {
    String a = acquireToken(aId);
    int v = version();
    heartbeat(aId, a, HTML_A, v).andExpect(status().isOk());
    assertThatThrownBy(
            () -> htmlPageService.save(aId, pageId, new SaveHtmlPageRequest(null, HTML_B, v), true))
        .isInstanceOf(WikiHtmlLockedException.class);
    // 편집 화면을 거치지 않은 같은 사람의 저장(다시 올리기)도 같다.
    saveHtml(aId, HTML_B, v).andExpect(status().isConflict());

    assertThat(read().get("html").asText()).isEqualTo(HTML_V1);
    JsonNode still = json(heartbeat(aId, a, HTML_A + "<!-- 이어서 -->", v));
    assertThat(still.get("mine").asBoolean()).isTrue();
    forceRelease(ownerId).andExpect(status().isNoContent());
    assertThat(json(acquire(aId)).get("draft").get("html").asText())
        .isEqualTo(HTML_A + "<!-- 이어서 -->");
  }

  /** 되돌리기는 편집 세션이 없는 쓰기다 — 누가 편집 중이면(편집하는 본인이어도) 막히고, 잠금이 없으면 그냥 되돌린다. */
  @Test
  void restore_blocked_while_locked() throws Exception {
    int v1 = version();
    saveHtml(aId, HTML_A, v1).andExpect(status().isOk());
    String a = acquireToken(aId);
    restore(aId, v1).andExpect(status().isConflict());
    assertThat(read().get("html").asText()).isEqualTo(HTML_A);

    release(aId, a).andExpect(status().isNoContent());
    restore(bId, v1).andExpect(status().isOk());
    assertThat(read().get("html").asText()).isEqualTo(HTML_V1);
  }

  /** 보는 사람은 편집을 시작할 수 없고(403), 노트에는 잠금이 없다(409). 5MB 넘는 임시 저장본은 413. */
  @Test
  void viewer_note_and_size_guards() throws Exception {
    acquire(viewerId).andExpect(status().isForbidden());
    long noteId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "노트")).id();
    call(post("/api/v1/wiki/pages/{id}/html-lock", noteId), aId).andExpect(status().isConflict());

    String a = acquireToken(aId);
    heartbeat(aId, a, "a".repeat(WikiHtmlPageService.HTML_MAX_BYTES + 1), version())
        .andExpect(status().isPayloadTooLarge());
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  private String nameOf(long userId) {
    return dsl.select(USER.NAME).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.NAME);
  }

  private void shiftClock(Duration d) {
    doReturn(Instant.now().plus(d)).when(lockClock).now();
  }

  private long human() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  private int version() throws Exception {
    return read().get("version").asInt();
  }

  private JsonNode read() throws Exception {
    return json(call(get("/api/v1/wiki/pages/{id}", pageId), aId).andExpect(status().isOk()));
  }

  private JsonNode lockOf(long userId) throws Exception {
    return json(
        call(get("/api/v1/wiki/pages/{id}/html-lock", pageId), userId).andExpect(status().isOk()));
  }

  private ResultActions acquire(long userId) throws Exception {
    return call(post("/api/v1/wiki/pages/{id}/html-lock", pageId), userId);
  }

  /** 「편집」하고 받은 편집 세션 표지. */
  private String acquireToken(long userId) throws Exception {
    return json(acquire(userId).andExpect(status().isOk())).get("token").asText();
  }

  private ResultActions restore(long userId, int version) throws Exception {
    return call(post("/api/v1/wiki/pages/{id}/revisions/{v}/restore", pageId, version), userId);
  }

  private ResultActions heartbeat(long userId, String token, String html, int baseVersion)
      throws Exception {
    Map<String, Object> body = new HashMap<>();
    body.put("token", token);
    body.put("html", html);
    body.put("baseVersion", baseVersion);
    return call(putJson("/api/v1/wiki/pages/" + pageId + "/html-lock", body), userId);
  }

  private ResultActions release(long userId, String token) throws Exception {
    MockHttpServletRequestBuilder req = delete("/api/v1/wiki/pages/{id}/html-lock", pageId);
    if (token != null) {
      req.param("token", token);
    }
    return call(req, userId);
  }

  private ResultActions forceRelease(long userId) throws Exception {
    return call(delete("/api/v1/wiki/pages/{id}/html-lock?force=true", pageId), userId);
  }

  private ResultActions saveHtml(long userId, String html, int version) throws Exception {
    return saveHtml(userId, null, html, version);
  }

  /** 원본 저장 — token 이 있으면 편집 「저장」, 없으면 다시 올리기와 같다. */
  private ResultActions saveHtml(long userId, String token, String html, int version)
      throws Exception {
    Map<String, Object> body = new HashMap<>();
    body.put("lockToken", token);
    body.put("html", html);
    body.put("version", version);
    return call(putJson("/api/v1/wiki/pages/" + pageId + "/html", body), userId);
  }

  private MockHttpServletRequestBuilder putJson(String path, Map<String, Object> body)
      throws Exception {
    return put(path).contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body));
  }

  private MockHttpServletRequestBuilder postJson(String path, Map<String, Object> body)
      throws Exception {
    return post(path).contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body));
  }

  /** 브라우저 세션처럼 JWT 로 부른다(사람 경로). 요청이 테넌트 컨텍스트를 지우므로 다시 심는다. */
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
