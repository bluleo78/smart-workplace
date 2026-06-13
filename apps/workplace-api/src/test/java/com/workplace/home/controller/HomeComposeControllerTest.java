package com.workplace.home.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;
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
import com.workplace.home.dto.HomeComposeResponse;
import com.workplace.home.service.HomeComposeService;
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

/** HomeComposeController @WebMvcTest — 보안 하네스는 HomeSessionControllerTest 와 동일. */
@SuppressWarnings("null")
@WebMvcTest(HomeComposeController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class HomeComposeControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;
  @MockitoBean HomeComposeService composeService;
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
  void compose_정상_200() throws Exception {
    UUID sid = UUID.randomUUID();
    var widgets = om.readTree("[{\"type\":\"my_tasks\",\"params\":{}}]");
    when(composeService.compose(eq(1L), isNull(), eq("내 할 일")))
        .thenReturn(new HomeComposeResponse(sid, "할 일이에요", widgets));

    mockMvc
        .perform(
            post("/api/v1/home/compose")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"내 할 일\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.sessionId").value(sid.toString()))
        .andExpect(jsonPath("$.message").value("할 일이에요"))
        .andExpect(jsonPath("$.widgets[0].type").value("my_tasks"));
  }

  @Test
  void query_공백이면_400() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/home/compose")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"\"}"))
        .andExpect(status().isBadRequest());
  }
}
