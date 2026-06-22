package com.workplace.home.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.home.service.HomeChatService;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** HomeChatController @WebMvcTest — SSE 응답 확인. composeStream 이 SseEmitter 를 반환하는지 검증한다. */
@SuppressWarnings("null")
@WebMvcTest(HomeChatController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class HomeChatControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;
  @MockitoBean HomeChatService chatService;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;

  @MockitoBean MembershipRepository membershipRepository;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("project:read"));
  }

  @Test
  void compose_정상_SSE응답() throws Exception {
    UUID sid = UUID.randomUUID();
    // composeStream 이 SseEmitter 를 반환하면 컨트롤러는 text/event-stream 으로 응답한다.
    SseEmitter emitter = new SseEmitter();
    emitter.complete(); // 즉시 완료로 MockMvc 가 hang 없이 응답을 받을 수 있도록.
    when(chatService.composeStream(eq(1L), isNull(), eq("내 할 일"))).thenReturn(emitter);

    mockMvc
        .perform(
            post("/api/v1/ai/chat")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"내 할 일\"}"))
        .andExpect(status().isOk())
        .andExpect(content().contentTypeCompatibleWith("text/event-stream"));
  }

  @Test
  void query_공백이면_400() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/ai/chat")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"\"}"))
        .andExpect(status().isBadRequest());
  }
}
