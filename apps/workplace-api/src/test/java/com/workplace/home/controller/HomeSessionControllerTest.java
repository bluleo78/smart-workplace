package com.workplace.home.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.home.dto.HomeSessionResponse;
import com.workplace.home.service.HomeSessionService;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** HomeSessionController @WebMvcTest — 보안 하네스는 ChatThreadMemberControllerTest 와 동일. */
@SuppressWarnings("null")
@WebMvcTest(HomeSessionController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class HomeSessionControllerTest {

  @Autowired MockMvc mockMvc;
  @MockitoBean HomeSessionService sessionService;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    // 토큰 "v" 를 userId=1L 로 인증
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("project:read"));
  }

  @Test
  void create_201() throws Exception {
    UUID id = UUID.randomUUID();
    when(sessionService.create(1L))
        .thenReturn(new HomeSessionResponse(id, null, Instant.now(), Instant.now()));
    mockMvc
        .perform(post("/api/v1/home/sessions").header("Authorization", "Bearer v"))
        .andExpect(status().isCreated());
    verify(sessionService).create(1L);
  }

  @Test
  void delete_204() throws Exception {
    UUID id = UUID.randomUUID();
    mockMvc
        .perform(delete("/api/v1/home/sessions/" + id).header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(sessionService).delete(eq(1L), eq(id));
  }
}
