package com.workplace.wiki;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.outbound.WikiAiAgentStreamClient;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 HTML 블록 「AI로 고치기」(WP-1302) — POST /wiki/pages/{id}/ai 의 fix_html 이 지금
 * 소스(selection)·지시(prompt)·고른 요소(targets)를 ai-agent 요청 본문에 그대로 싣고, 소스·지시가 없거나 고른 요소가 상한을 넘으면 에이전트를
 * 부르기 전에 400 으로 거절한다.
 *
 * <p>ai-agent 스트림 클라이언트·비서 해석은 목(ExternalClientMockedTestBase). 펌프는 별도 실행기 스레드에서 돌아 목 호출은 timeout
 * 으로 기다린다. 요청 본문 직렬화(빈 값 생략)는 실제 ObjectMapper 로 확인한다 — 에이전트 zod 는 null 을 받지 않는다.
 *
 * <p>@Transactional: 요청이 테스트 트랜잭션에 합류해 시드를 보고(시작 요청의 페이지 조회·권한 확인은 동기) 끝나면 롤백된다.
 */
@Transactional
class WikiAiFixHtmlTest extends ExternalClientMockedTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiAiAgentStreamClient agent;
  @Autowired AssistantResolver assistantResolver;

  private static final String SOURCE =
      "<h1>3분기 회고</h1>\n<div id=\"chart\"></div>\n<script>draw([1,2,3])</script>";

  private long editorId;
  private long pageId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    editorId = withMembership(TestFixtures.createHuman(dsl));
    long spaceId = spaceService.createTeamSpace(editorId, "AI고치기-" + UUID.randomUUID()).id();
    pageId = pageService.create(editorId, spaceId, new CreatePageRequest(null, "회고")).id();
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(900L, "claude-sonnet-4-6", "NONE", 5, 60_000));
  }

  /** fix_html — 소스·지시·고른 요소가 ai-agent 요청 본문에 실린다(action 은 소문자 와이어). */
  @Test
  void fix_html_sends_selection_prompt_targets_to_agent() throws Exception {
    List<String> targets =
        List.of("선택자: h1:nth-of-type(1) · 태그: h1 · 글자: 3분기 회고", "선택자: #chart · 태그: div");
    start(body("fix_html", "제목을 4분기로 바꿔 줘", SOURCE, targets))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.correlationId").isNotEmpty());

    JsonNode sent = sentBody();
    assertThat(sent.get("action").asText()).isEqualTo("fix_html");
    assertThat(sent.get("selection").asText()).isEqualTo(SOURCE);
    assertThat(sent.get("prompt").asText()).isEqualTo("제목을 4분기로 바꿔 줘");
    assertThat(sent.get("targets")).hasSize(2);
    assertThat(sent.get("targets").get(0).asText()).isEqualTo(targets.get(0));
    assertThat(sent.get("targets").get(1).asText()).isEqualTo(targets.get(1));
  }

  /** 고른 요소가 없으면(빈 목록) targets 필드를 뺀다 — 블록 전체가 대상. */
  @Test
  void fix_html_without_targets_omits_field() throws Exception {
    start(body("fix_html", "색을 파랑으로", SOURCE, List.of())).andExpect(status().isOk());

    JsonNode sent = sentBody();
    assertThat(sent.get("action").asText()).isEqualTo("fix_html");
    assertThat(sent.has("targets")).isFalse();
  }

  /** 고칠 소스(selection)가 없거나 비었으면 400 — 에이전트를 부르지 않는다. */
  @Test
  void fix_html_without_selection_is_400() throws Exception {
    start(body("fix_html", "색을 파랑으로", null, null))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.requiredSelectionPresent").value("고칠 HTML 소스가 필요합니다"));
    start(body("fix_html", "색을 파랑으로", "   ", null)).andExpect(status().isBadRequest());
    verify(agent, after(300).never()).stream(any(), any(), any());
  }

  /** 지시(prompt)가 없으면 400. */
  @Test
  void fix_html_without_prompt_is_400() throws Exception {
    start(body("fix_html", " ", SOURCE, null))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.requiredPromptPresent").value("고칠 내용을 입력해 주세요"));
    verify(agent, after(300).never()).stream(any(), any(), any());
  }

  /** 고른 요소 상한 — 11개, 또는 한 개가 2000자를 넘으면 400. 딱 상한(10개 · 2000자)은 받는다. */
  @Test
  void targets_over_limit_is_400() throws Exception {
    start(body("fix_html", "x", SOURCE, Collections.nCopies(11, "선택자: p")))
        .andExpect(status().isBadRequest());
    start(body("fix_html", "x", SOURCE, List.of("가".repeat(2001))))
        .andExpect(status().isBadRequest());
    verify(agent, after(300).never()).stream(any(), any(), any());

    start(body("fix_html", "x", SOURCE, Collections.nCopies(10, "가".repeat(2000))))
        .andExpect(status().isOk());
    assertThat(sentBody().get("targets")).hasSize(10);
  }

  /** 다른 액션은 소스·지시 없이도 그대로 받는다(새 검증이 기존 액션을 막지 않는다). */
  @Test
  void other_actions_unaffected() throws Exception {
    start(body("continue", null, null, null)).andExpect(status().isOk());
    assertThat(sentBody().get("action").asText()).isEqualTo("continue");
  }

  /** 펌프 스레드가 에이전트에 넘긴 요청 본문 — 실제 직렬화 결과(JSON)로 본다. */
  private JsonNode sentBody() throws Exception {
    ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
    verify(agent, timeout(5_000)).stream(captor.capture(), any(), any());
    return om.readTree(om.writeValueAsString(captor.getValue()));
  }

  private static Map<String, Object> body(
      String action, String prompt, String selection, List<String> targets) {
    Map<String, Object> m = new HashMap<>();
    m.put("action", action);
    m.put("prompt", prompt);
    m.put("selection", selection);
    m.put("targets", targets);
    return m;
  }

  private ResultActions start(Map<String, Object> body) throws Exception {
    ResultActions r =
        mvc.perform(
            post("/api/v1/wiki/pages/{id}/ai", pageId)
                .header(
                    "Authorization",
                    "Bearer " + jwt.generateAccessToken(editorId, "u-" + editorId, 1L))
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body)));
    TenantContext.set(1L);
    return r;
  }
}
