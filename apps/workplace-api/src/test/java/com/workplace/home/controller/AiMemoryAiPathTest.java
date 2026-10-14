package com.workplace.home.controller;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.service.HomeSessionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.AiPreferenceService;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-55: AI 대행 경로(Internal 토큰 + X-On-Behalf-Of) — source:'AI'·세션은 대행일 때만, 꺼짐이면 대행 쓰기만 409, 직접 관리는
 * 허용.
 */
@Transactional
class AiMemoryAiPathTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/users/me/ai-memories";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired HomeSessionService sessionService;
  @Autowired AiPreferenceService preferences;

  /** HUMAN + tenant#1 멤버십(대행 인증의 테넌트 해석용). */
  private long user() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  /** ai-agent 처럼 Internal + 대행 헤더로 부른다. 필터가 finally 에서 지운 테스트 스레드 TenantContext 를 되돌린다. */
  private ResultActions internal(long uid, MockHttpServletRequestBuilder rb) throws Exception {
    try {
      return mvc.perform(
          rb.header("Authorization", "Internal test-token")
              .header("X-On-Behalf-Of", String.valueOf(uid))
              .contentType(MediaType.APPLICATION_JSON));
    } finally {
      TenantContext.set(1L);
    }
  }

  private ResultActions browser(long uid, MockHttpServletRequestBuilder rb) throws Exception {
    return mvc.perform(
        rb.with(authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of())))
            .contentType(MediaType.APPLICATION_JSON));
  }

  private String aiBody(String content, UUID sessionId) throws Exception {
    Map<String, Object> m = new HashMap<>();
    m.put("kind", "PREFERENCE");
    m.put("content", content);
    m.put("source", "AI");
    if (sessionId != null) m.put("sessionId", sessionId.toString());
    return om.writeValueAsString(m);
  }

  private long idOf(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString()).get("id").asLong();
  }

  private UUID sessionOf(long memoryId) {
    return dsl.select(AI_MEMORY.SOURCE_SESSION_ID)
        .from(AI_MEMORY)
        .where(AI_MEMORY.ID.eq(memoryId))
        .fetchOne(AI_MEMORY.SOURCE_SESSION_ID);
  }

  @Test
  void 대행_호출은_AI_출처와_본인_대화_세션을_저장한다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    long id =
        idOf(
            internal(uid, post(BASE).content(aiBody("표 대신 짧은 목록으로 보여 준다", sid)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.source").value("AI"))
                .andExpect(jsonPath("$.kind").value("PREFERENCE")));
    assertThat(sessionOf(id)).isEqualTo(sid);
  }

  @Test
  void 남의_대화_세션_id_는_저장하지_않는다() throws Exception {
    long uid = user();
    long other = user();
    UUID otherSid = sessionService.create(other).id();
    long id =
        idOf(
            internal(uid, post(BASE).content(aiBody("짧게 답한다", otherSid)))
                .andExpect(status().isCreated()));
    assertThat(sessionOf(id)).isNull();
  }

  @Test
  void 브라우저_요청의_AI_출처는_무시하고_USER_로_저장한다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    long id =
        idOf(
            browser(uid, post(BASE).content(aiBody("표로 보여 준다", sid)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.source").value("USER")));
    assertThat(sessionOf(id)).isNull();
  }

  @Test
  void 꺼져_있으면_대행_쓰기는_409_이고_직접_관리는_허용된다() throws Exception {
    long uid = user();
    long id =
        idOf(browser(uid, post(BASE).content("{\"kind\":\"CONTEXT\",\"content\":\"백엔드 팀이다\"}")));
    preferences.update(uid, null, false);

    internal(uid, post(BASE).content(aiBody("새 선호", null)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_DISABLED"));
    internal(uid, patch(BASE + "/" + id).content("{\"content\":\"프론트 팀이다\"}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_DISABLED"));
    internal(uid, delete(BASE + "/" + id))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_DISABLED"));

    browser(uid, patch(BASE + "/" + id).content("{\"content\":\"프론트 팀이다\"}"))
        .andExpect(status().isOk());
    browser(uid, post(BASE).content("{\"kind\":\"PREFERENCE\",\"content\":\"짧게\"}"))
        .andExpect(status().isCreated());
    browser(uid, delete(BASE + "/" + id)).andExpect(status().isOk());
  }

  @Test
  void 대행_고치기는_이전_내용을_대행_지우기는_지운_항목을_돌려준다() throws Exception {
    long uid = user();
    long id = idOf(internal(uid, post(BASE).content(aiBody("표로 보여 준다", null))));
    internal(uid, patch(BASE + "/" + id).content("{\"content\":\"짧은 목록으로 보여 준다\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content").value("짧은 목록으로 보여 준다"))
        .andExpect(jsonPath("$.previousContent").value("표로 보여 준다"));
    internal(uid, delete(BASE + "/" + id))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(id))
        .andExpect(jsonPath("$.kind").value("PREFERENCE"))
        .andExpect(jsonPath("$.content").value("짧은 목록으로 보여 준다"))
        .andExpect(jsonPath("$.source").value("AI"));
  }

  /** WP-380: 대행 경로도 같은 기한 검증을 쓴다 — 부호 붙은 큰 연도·빈 문자열은 400(빈 문자열이 기한을 지우지 않는다). */
  @Test
  void 대행_경로도_연도_네_자리_실제_날짜가_아닌_기한은_400() throws Exception {
    long uid = user();
    Map<String, Object> body = new HashMap<>();
    body.put("kind", "PREFERENCE");
    body.put("content", "이번 주는 결제 모듈");
    body.put("source", "AI");
    body.put("expiresOn", "+12026-01-01");
    internal(uid, post(BASE).content(om.writeValueAsString(body)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
    long id = idOf(internal(uid, post(BASE).content(aiBody("표로 보여 준다", null))));
    internal(uid, patch(BASE + "/" + id).content("{\"expiresOn\":\"\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
  }

  /**
   * WP-379: AI 대행 생성은 scope 를 받고, 고치기(scope:null = 공통)는 이전 범위(previousScope)를 돌려준다(결과 줄·되돌리기 근거).
   */
  @Test
  void 대행_경로도_범위를_받고_고치기_응답에_이전_범위를_싣는다() throws Exception {
    long uid = user();
    Map<String, Object> body = new HashMap<>();
    body.put("kind", "PREFERENCE");
    body.put("content", "메일은 세 줄로 요약한다");
    body.put("source", "AI");
    body.put("scope", "MAIL");
    long id =
        idOf(
            internal(uid, post(BASE).content(om.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.scope").value("MAIL")));
    internal(uid, patch(BASE + "/" + id).content("{\"content\":\"메일은 세 줄로 요약한다\",\"scope\":null}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.scope").value(org.hamcrest.Matchers.nullValue()))
        .andExpect(jsonPath("$.previousScope").value("MAIL"));
  }
}
