package com.workplace.wiki;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageUpdatedEvent;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiShareAccess;
import com.workplace.wiki.service.WikiSpaceService;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 페이지 「전체 폭」 설정 저장(WP-793) — {@code PUT /wiki/pages/{id}} 의 {@code fullWidth}. 제목처럼 버전 검사 없이 나중
 * 값 우선이고 같은 권한 규칙(EDITOR 이상, 본문 없는 요청은 편집 공유 링크도 가능)이되, 보기 설정이라 본문 version·수정자·수정 시각을 건드리지 않는다.
 *
 * <p>@Transactional: 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다.
 */
@Transactional
@RecordApplicationEvents
class WikiPageFullWidthTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired ApplicationEvents appEvents;

  private long ownerId; // 스페이스 OWNER
  private long editorId; // 스페이스 EDITOR
  private long viewerId; // 스페이스 VIEWER
  private long strangerId; // 같은 워크스페이스, 스페이스 비멤버
  private long spaceId;
  private long pageId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human();
    editorId = human();
    viewerId = human();
    strangerId = human();
    spaceId = spaceService.createTeamSpace(ownerId, "전체폭-" + UUID.randomUUID()).id();
    spaceService.addMember(ownerId, spaceId, editorId, "EDITOR");
    spaceService.addMember(ownerId, spaceId, viewerId, "VIEWER");
    pageId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "제품 로드맵")).id();
  }

  /** 기본은 읽기 폭(false) — 새 페이지·기존 페이지 모두. */
  @Test
  void default_is_false() throws Exception {
    assertThat(read(pageId, editorId).get("fullWidth").asBoolean()).isFalse();
  }

  /** 편집자가 켜면 PUT 응답과 GET 모두 true, 제목·본문·version·수정자·수정 시각은 그대로(보기 설정은 본문 판을 올리지 않는다). */
  @Test
  void editor_sets_full_width_without_touching_content() throws Exception {
    JsonNode before = read(pageId, ownerId);

    JsonNode saved =
        json(call(putFullWidth(pageId, true, null), editorId).andExpect(status().isOk()));
    assertThat(saved.get("fullWidth").asBoolean()).isTrue();

    JsonNode after = read(pageId, viewerId); // 읽는 사람 모두에게 같다
    assertThat(after.get("fullWidth").asBoolean()).isTrue();
    assertThat(after.get("title").asText()).isEqualTo(before.get("title").asText());
    assertThat(after.get("body").asText()).isEqualTo(before.get("body").asText());
    assertThat(after.get("version").asInt()).isEqualTo(before.get("version").asInt());
    assertThat(after.get("updatedAt").asText()).isEqualTo(before.get("updatedAt").asText());
    assertThat(after.path("updatedBy").asLong()).isEqualTo(before.path("updatedBy").asLong());

    // 다시 끌 수 있다.
    call(putFullWidth(pageId, false, null), editorId).andExpect(status().isOk());
    assertThat(read(pageId, ownerId).get("fullWidth").asBoolean()).isFalse();
  }

  /** fullWidth 를 생략한 제목 저장은 기존 설정을 유지한다. 반대로 폭만 바꾸면 제목은 그대로. */
  @Test
  void omitted_full_width_keeps_value() throws Exception {
    call(putFullWidth(pageId, true, null), editorId).andExpect(status().isOk());

    Map<String, Object> titleOnly = new LinkedHashMap<>();
    titleOnly.put("title", "새 제목");
    JsonNode saved =
        json(call(putRaw(pageId, titleOnly, null), editorId).andExpect(status().isOk()));
    assertThat(saved.get("title").asText()).isEqualTo("새 제목");
    assertThat(saved.get("fullWidth").asBoolean()).isTrue();
    assertThat(read(pageId, ownerId).get("fullWidth").asBoolean()).isTrue();

    // 제목과 폭을 한 요청에 — 둘 다 반영.
    Map<String, Object> both = new LinkedHashMap<>();
    both.put("title", "둘 다");
    both.put("fullWidth", false);
    JsonNode bothSaved =
        json(call(putRaw(pageId, both, null), editorId).andExpect(status().isOk()));
    assertThat(bothSaved.get("title").asText()).isEqualTo("둘 다");
    assertThat(bothSaved.get("fullWidth").asBoolean()).isFalse();
  }

  /** 본문과 함께 온 fullWidth 는 무시한다 — 폭은 본문 없는 요청(웹 ⋯ 메뉴)으로만 바꾼다. 본문은 그대로 저장된다. */
  @Test
  void full_width_with_body_is_ignored() throws Exception {
    int version = read(pageId, ownerId).get("version").asInt();
    Map<String, Object> withBody = new LinkedHashMap<>();
    withBody.put("body", "새 본문");
    withBody.put("version", version);
    withBody.put("fullWidth", true);
    JsonNode saved =
        json(call(putRaw(pageId, withBody, null), editorId).andExpect(status().isOk()));
    assertThat(saved.get("body").asText()).isEqualTo("새 본문");
    assertThat(saved.get("fullWidth").asBoolean()).isFalse();
    assertThat(read(pageId, ownerId).get("fullWidth").asBoolean()).isFalse();
  }

  /** 읽기 권한(VIEWER)·비멤버는 바꿀 수 없다 — 값도 그대로. */
  @Test
  void viewer_and_stranger_cannot_change() throws Exception {
    call(putFullWidth(pageId, true, null), viewerId).andExpect(status().isForbidden());
    assertThat(read(pageId, ownerId).get("fullWidth").asBoolean()).isFalse();
    call(putFullWidth(pageId, true, null), strangerId).andExpect(status().is4xxClientError());
    assertThat(read(pageId, ownerId).get("fullWidth").asBoolean()).isFalse();
  }

  /** 편집 공유 링크 토큰이면 비멤버도 저장할 수 있고, 보기 공유 링크 토큰은 거부된다. */
  @Test
  void share_link_edit_allows_view_denies() throws Exception {
    String viewToken = share(pageId, "VIEW");
    call(putFullWidth(pageId, true, viewToken), strangerId).andExpect(status().isForbidden());
    assertThat(read(pageId, ownerId).get("fullWidth").asBoolean()).isFalse();

    String editToken = share(pageId, "EDIT");
    JsonNode saved =
        json(call(putFullWidth(pageId, true, editToken), strangerId).andExpect(status().isOk()));
    assertThat(saved.get("fullWidth").asBoolean()).isTrue();
    assertThat(read(pageId, ownerId).get("fullWidth").asBoolean()).isTrue();

    // 공유 토큰으로 읽는 화면(GET)에도 같은 값이 실린다.
    JsonNode viaShare =
        json(
            callWithShare(get("/api/v1/wiki/pages/{id}", pageId), strangerId, editToken)
                .andExpect(status().isOk()));
    assertThat(viaShare.get("fullWidth").asBoolean()).isTrue();
  }

  /** 바뀔 때만 wiki.page.updated 를 낸다 — 같은 값 재저장은 아무것도 보내지 않는다(제목 저장과 같은 SSE 경로). */
  @Test
  void publishes_updated_event_only_on_change() throws Exception {
    long before = appEvents.stream(WikiPageUpdatedEvent.class).count();
    call(putFullWidth(pageId, true, null), editorId).andExpect(status().isOk());
    assertThat(appEvents.stream(WikiPageUpdatedEvent.class).count()).isEqualTo(before + 1);
    call(putFullWidth(pageId, true, null), editorId).andExpect(status().isOk());
    assertThat(appEvents.stream(WikiPageUpdatedEvent.class).count()).isEqualTo(before + 1);
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  private long human() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  /** 공유 링크(워크스페이스 전체, 해당 페이지만)를 만들고 토큰을 돌려준다. 공유한 사람은 OWNER. */
  private String share(long id, String permission) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", "WORKSPACE");
    body.put("permission", permission);
    body.put("includeChildren", false);
    body.put("userIds", List.of());
    body.put("expiresAt", null);
    body.put("notify", Map.of());
    JsonNode saved =
        json(
            call(
                    put("/api/v1/wiki/pages/" + id + "/share")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(body)),
                    ownerId)
                .andExpect(status().isOk()));
    return saved.get("token").asText();
  }

  private JsonNode read(long id, long userId) throws Exception {
    return json(call(get("/api/v1/wiki/pages/{id}", id), userId).andExpect(status().isOk()));
  }

  /** 프런트와 같은 모양 — title·body 는 null, fullWidth 만. */
  private MockHttpServletRequestBuilder putFullWidth(long id, boolean value, String shareToken) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("title", null);
    body.put("body", null);
    body.put("fullWidth", value);
    return putRaw(id, body, shareToken);
  }

  private MockHttpServletRequestBuilder putRaw(
      long id, Map<String, Object> body, String shareToken) {
    try {
      MockHttpServletRequestBuilder req =
          put("/api/v1/wiki/pages/{id}", id)
              .contentType(MediaType.APPLICATION_JSON)
              .content(om.writeValueAsString(body));
      if (shareToken != null) {
        req.header(WikiShareAccess.HEADER, shareToken);
      }
      return req;
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  private ResultActions callWithShare(MockHttpServletRequestBuilder req, long userId, String token)
      throws Exception {
    req.header(WikiShareAccess.HEADER, token);
    return call(req, userId);
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }
}
