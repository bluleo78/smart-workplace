package com.workplace.notify.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.service.NotificationService;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** NotificationController 라우팅·페이로드·인증 테스트. 서비스는 Mockito. */
@SuppressWarnings("null")
@WebMvcTest(controllers = NotificationController.class)
@Import({
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class NotificationControllerTest {

  @Autowired MockMvc mockMvc;

  @MockitoBean NotificationService service;
  @MockitoBean SseRegistry registry;
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
  void list_returnsCallerScoped() throws Exception {
    var n =
        new NotificationResponse(
            5L,
            "COMMENTED",
            9L,
            "AI",
            "AGENT",
            7L,
            "WP",
            3,
            "제목",
            55L,
            null,
            null,
            null,
            false,
            Instant.now());
    when(service.listRecent(eq(1L), eq(20))).thenReturn(List.of(n));

    mockMvc
        .perform(get("/api/v1/notifications").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(5))
        .andExpect(jsonPath("$[0].actorKind").value("AGENT"))
        .andExpect(jsonPath("$[0].projectKey").value("WP"))
        .andExpect(jsonPath("$[0].issueNumber").value(3));
    verify(service).listRecent(eq(1L), eq(20));
  }

  @Test
  void unreadCount_returnsCountObject() throws Exception {
    when(service.countUnread(1L)).thenReturn(4L);
    mockMvc
        .perform(get("/api/v1/notifications/unread-count").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.count").value(4));
  }

  @Test
  void markRead_returns204_andScopesToCaller() throws Exception {
    mockMvc
        .perform(post("/api/v1/notifications/5/read").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(service).markRead(eq(1L), eq(5L));
  }

  @Test
  void markAllRead_returns204() throws Exception {
    mockMvc
        .perform(post("/api/v1/notifications/read-all").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(service).markAllRead(eq(1L));
  }

  @Test
  void list_unauthenticated_returns401() throws Exception {
    mockMvc.perform(get("/api/v1/notifications")).andExpect(status().isUnauthorized());
  }
}
