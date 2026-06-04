package com.workplace.user.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.dto.UserGroupDetail;
import com.workplace.user.dto.UserGroupTreeResponse;
import com.workplace.user.repository.UserRepository;
import com.workplace.user.service.UserGroupService;
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

/** 사용자 그룹 컨트롤러 슬라이스 테스트 — 라우팅·권한 게이팅·검증. */
@SuppressWarnings("null")
@WebMvcTest(controllers = UserGroupController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class UserGroupControllerTest {
  @Autowired MockMvc mockMvc;
  @MockitoBean UserGroupService service;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("contact:read"));
  }

  @Test
  void tree_withReadPermission_returns200() throws Exception {
    when(service.getTree(1L)).thenReturn(new UserGroupTreeResponse(List.of(), List.of()));
    mockMvc
        .perform(get("/api/v1/user-groups").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.shared").isArray());
  }

  @Test
  void tree_withoutReadPermission_returns403() throws Exception {
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of()); // contact:read 없음
    mockMvc
        .perform(get("/api/v1/user-groups").header("Authorization", "Bearer v"))
        .andExpect(status().isForbidden());
  }

  @Test
  void createPersonal_returns201() throws Exception {
    when(service.create(eq(1L), any()))
        .thenReturn(new UserGroupDetail(5L, null, "내 그룹", null, 1L, "PERSONAL", 0, List.of()));
    String body = "{\"name\":\"내 그룹\",\"visibility\":\"PERSONAL\"}";
    mockMvc
        .perform(
            post("/api/v1/user-groups")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.name").value("내 그룹"));
  }

  @Test
  void create_missingName_returns400() throws Exception {
    String body = "{\"visibility\":\"PERSONAL\"}"; // name 누락(@NotBlank)
    mockMvc
        .perform(
            post("/api/v1/user-groups")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest());
  }

  @Test
  void addMember_missingTargetType_returns400() throws Exception {
    String body = "{\"targetId\":3}"; // targetType 누락(@NotNull)
    mockMvc
        .perform(
            post("/api/v1/user-groups/5/members")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest());
  }
}
