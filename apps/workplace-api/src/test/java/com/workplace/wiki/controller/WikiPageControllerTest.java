package com.workplace.wiki.controller;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.exception.WikiConflictException;
import com.workplace.wiki.service.WikiPageService;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** WikiPageController WebMvcTest — 낙관적 충돌 HTTP 계약(stale 저장 → 409). */
@SuppressWarnings("null")
@WebMvcTest(WikiPageController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class WikiPageControllerTest {

  @Autowired private MockMvc mockMvc;

  @MockitoBean private WikiPageService pageService;
  @MockitoBean private JwtTokenProvider jwtTokenProvider;
  @MockitoBean private JwtProperties jwtProperties;
  @MockitoBean private PermissionService permissionService;

  @MockitoBean private MembershipRepository membershipRepository;
  @MockitoBean private AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean private UserRepository userRepository;

  @BeforeEach
  void setUp() {
    when(jwtTokenProvider.validateAccessToken("test-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("test-token")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of());
  }

  /** stale 버전 저장 → WikiConflictException → 409. */
  @Test
  void save_staleVersion_returns409() throws Exception {
    when(pageService.save(
            anyLong(), anyLong(), org.mockito.ArgumentMatchers.any(SavePageRequest.class)))
        .thenThrow(new WikiConflictException(7L));

    mockMvc
        .perform(
            put("/api/v1/wiki/pages/7")
                .header("Authorization", "Bearer test-token")
                .contentType("application/json")
                .content("{\"title\":\"t\",\"body\":\"b\",\"version\":1,\"snapshot\":false}"))
        .andExpect(status().isConflict());
  }
}
