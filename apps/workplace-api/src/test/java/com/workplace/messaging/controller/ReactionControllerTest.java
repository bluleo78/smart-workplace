package com.workplace.messaging.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
import com.workplace.messaging.dto.ReactorPage;
import com.workplace.messaging.dto.ReactorResponse;
import com.workplace.messaging.service.ReactionService;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.AlwaysActiveTenantStatusChecker;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** ReactionController @WebMvcTest. */
@SuppressWarnings("null")
@WebMvcTest(ReactionController.class)
@Import({
  AlwaysActiveTenantStatusChecker.class,
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class ReactionControllerTest {

  @Autowired MockMvc mockMvc;
  @MockitoBean ReactionService reactionService;
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

  /** GET 반응자 — emoji·cursor·limit 을 그대로 서비스에 넘기고 페이지를 JSON 으로 돌려준다. */
  @Test
  void listReactors_ok() throws Exception {
    when(reactionService.listReactors(1L, 10L, "👍", "c1", 5))
        .thenReturn(new ReactorPage(List.of(new ReactorResponse(2L, "김민수", "HUMAN")), "c2", true));
    mockMvc
        .perform(
            get("/api/v1/messaging/messages/10/reactions/users")
                .param("emoji", "👍")
                .param("cursor", "c1")
                .param("limit", "5")
                .header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].userId").value(2))
        .andExpect(jsonPath("$.items[0].name").value("김민수"))
        .andExpect(jsonPath("$.items[0].kind").value("HUMAN"))
        .andExpect(jsonPath("$.nextCursor").value("c2"))
        .andExpect(jsonPath("$.hasMore").value(true));
  }

  /** limit 미지정이면 기본 20. */
  @Test
  void listReactors_defaultLimit() throws Exception {
    when(reactionService.listReactors(eq(1L), eq(10L), eq("👍"), isNull(), eq(20)))
        .thenReturn(new ReactorPage(List.of(), null, false));
    mockMvc
        .perform(
            get("/api/v1/messaging/messages/10/reactions/users")
                .param("emoji", "👍")
                .header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.hasMore").value(false));
  }

  /** emoji 누락·빈값은 400. */
  @Test
  void listReactors_requiresEmoji() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/messaging/messages/10/reactions/users")
                .header("Authorization", "Bearer v"))
        .andExpect(status().isBadRequest());
    mockMvc
        .perform(
            get("/api/v1/messaging/messages/10/reactions/users")
                .param("emoji", " ")
                .header("Authorization", "Bearer v"))
        .andExpect(status().isBadRequest());
  }
}
