package com.workplace.home.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
import com.workplace.home.dto.AiScreenContext;
import com.workplace.home.service.HomeChatService;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * HomeChatController @WebMvcTest(#593 편입) — POST 가 correlationId 를 즉시 반환하고, DELETE 가 서비스의
 * cancelChat 에 위임하는지 검증한다.
 */
@SuppressWarnings("null")
@WebMvcTest(HomeChatController.class)
@Import({
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class HomeChatControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;
  @MockitoBean HomeChatService chatService;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;

  @MockitoBean MembershipRepository membershipRepository;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserApiTokenRepository userApiTokenRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("project:read"));
  }

  @Test
  void chat_시작하면_correlationId_즉시_반환() throws Exception {
    when(chatService.startChat(eq(1L), isNull(), eq("내 할 일"), isNull(), eq(List.of())))
        .thenReturn("corr-1");

    mockMvc
        .perform(
            post("/api/v1/ai/chat")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"내 할 일\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.correlationId").value("corr-1"));
  }

  /** WP-54: 화면 컨텍스트가 역직렬화돼 서비스로 전달된다. */
  @Test
  void chat_화면_컨텍스트를_서비스로_전달한다() throws Exception {
    when(chatService.startChat(eq(1L), isNull(), eq("이거 요약"), any(), eq(List.of())))
        .thenReturn("corr-2");
    String body =
        """
        {"query":"이거 요약","screenContext":{"view":"이슈 상세",
          "focus":{"type":"이슈","label":"WP-12 버그","refs":{"issueKey":"WP-12"},
                   "facts":[{"label":"상태","value":"진행 중"}]},
          "scope":{"label":"프로젝트 WP","refs":{"projectKey":"WP"},"count":3,"hasMore":false}}}
        """;
    mockMvc
        .perform(
            post("/api/v1/ai/chat")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk());
    var captor = org.mockito.ArgumentCaptor.forClass(AiScreenContext.class);
    verify(chatService).startChat(eq(1L), isNull(), eq("이거 요약"), captor.capture(), eq(List.of()));
    assertThat(captor.getValue().focus().refs()).containsEntry("issueKey", "WP-12");
    assertThat(captor.getValue().scope().count()).isEqualTo(3);
  }

  /** WP-54: 상한 초과(label 201자)는 400. */
  @Test
  void chat_화면_컨텍스트_상한_초과는_400() throws Exception {
    String longLabel = "x".repeat(201);
    String body =
        "{\"query\":\"q\",\"screenContext\":{\"view\":\"v\",\"scope\":{\"label\":\""
            + longLabel
            + "\"}}}";
    mockMvc
        .perform(
            post("/api/v1/ai/chat")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest());
  }

  /** WP-54: fact value · refs 값이 null 이면 400 — ai-agent zod(string 필수)로 넘어가 실패하지 않게 api 에서 거른다. */
  @Test
  void chat_화면_컨텍스트_null_값은_400() throws Exception {
    for (String ctx :
        new String[] {
          "{\"view\":\"v\",\"scope\":{\"label\":\"l\",\"facts\":[{\"label\":\"상태\",\"value\":null}]}}",
          "{\"view\":\"v\",\"focus\":{\"type\":\"t\",\"label\":\"l\",\"refs\":{\"issueKey\":null}}}"
        }) {
      mockMvc
          .perform(
              post("/api/v1/ai/chat")
                  .header("Authorization", "Bearer v")
                  .contentType(MediaType.APPLICATION_JSON)
                  .content("{\"query\":\"q\",\"screenContext\":" + ctx + "}"))
          .andExpect(status().isBadRequest());
    }
  }

  /** WP-54: refs 6개(상한 5) · view 누락은 400. */
  @Test
  void chat_화면_컨텍스트_refs_초과_view_누락은_400() throws Exception {
    String refs6 = "{\"a\":\"1\",\"b\":\"1\",\"c\":\"1\",\"d\":\"1\",\"e\":\"1\",\"f\":\"1\"}";
    for (String ctx :
        new String[] {
          "{\"view\":\"v\",\"focus\":{\"type\":\"t\",\"label\":\"l\",\"refs\":" + refs6 + "}}",
          "{\"scope\":{\"label\":\"l\"}}"
        }) {
      mockMvc
          .perform(
              post("/api/v1/ai/chat")
                  .header("Authorization", "Bearer v")
                  .contentType(MediaType.APPLICATION_JSON)
                  .content("{\"query\":\"q\",\"screenContext\":" + ctx + "}"))
          .andExpect(status().isBadRequest());
    }
  }

  @Test
  void query_공백이면_400() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/ai/chat")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("메시지를 입력하거나 파일을 첨부해 주세요."));
  }

  /** WP-234: 본문이 비어도 fileIds 가 있으면 서비스로 넘긴다. */
  @Test
  void 첨부만_보내면_fileIds_를_서비스로_전달한다() throws Exception {
    when(chatService.startChat(eq(1L), isNull(), eq(""), isNull(), eq(List.of(7L, 8L))))
        .thenReturn("corr-3");
    mockMvc
        .perform(
            post("/api/v1/ai/chat")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"\",\"fileIds\":[7,8]}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.correlationId").value("corr-3"));
  }

  @Test
  void cancel_은_서비스의_cancelChat_에_위임() throws Exception {
    mockMvc
        .perform(delete("/api/v1/ai/chat/corr-1").header("Authorization", "Bearer v"))
        .andExpect(status().isOk());

    verify(chatService).cancelChat("corr-1", 1L);
  }
}
