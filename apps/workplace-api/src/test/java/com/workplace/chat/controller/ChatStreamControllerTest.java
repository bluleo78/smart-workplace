package com.workplace.chat.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** ChatStreamController @WebMvcTest — SSE 구독 엔드포인트 테스트. */
@SuppressWarnings("null")
@WebMvcTest(ChatStreamController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class ChatStreamControllerTest {

  @Autowired MockMvc mockMvc;
  @MockitoBean SseRegistry registry;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("project:read"));
  }

  @Test
  void stream_registersEmitterForCaller() throws Exception {
    when(registry.register(1L)).thenReturn(new SseEmitter());
    mockMvc
        .perform(get("/api/v1/chat/stream").header("Authorization", "Bearer v"))
        .andExpect(request().asyncStarted())
        .andExpect(status().isOk());
    verify(registry).register(1L);
  }

  @Test
  void stream_unauthenticated_401() throws Exception {
    mockMvc.perform(get("/api/v1/chat/stream")).andExpect(status().isUnauthorized());
  }
}
