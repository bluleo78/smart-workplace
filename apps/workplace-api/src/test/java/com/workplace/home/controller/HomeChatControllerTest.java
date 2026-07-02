package com.workplace.home.controller;

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
  void chat_시작하면_correlationId_즉시_반환() throws Exception {
    when(chatService.startChat(eq(1L), isNull(), eq("내 할 일"))).thenReturn("corr-1");

    mockMvc
        .perform(
            post("/api/v1/ai/chat")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"내 할 일\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.correlationId").value("corr-1"));
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

  @Test
  void cancel_은_서비스의_cancelChat_에_위임() throws Exception {
    mockMvc
        .perform(delete("/api/v1/ai/chat/corr-1").header("Authorization", "Bearer v"))
        .andExpect(status().isOk());

    verify(chatService).cancelChat("corr-1", 1L);
  }
}
