package com.workplace.permission.controller;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.dto.PermissionResponse;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(PermissionController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class PermissionControllerTest {

  @Autowired private MockMvc mockMvc;

  @MockitoBean private PermissionService permissionService;

  @MockitoBean private MembershipRepository membershipRepository;

  @MockitoBean private AgentApiKeyRepository agentApiKeyRepository;

  @MockitoBean private UserRepository userRepository;

  @MockitoBean private JwtTokenProvider jwtTokenProvider;

  @MockitoBean private JwtProperties jwtProperties;

  private void mockAuthentication(String... permissions) {
    when(jwtTokenProvider.validateAccessToken("valid-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("valid-token")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of(permissions));
  }

  @Test
  void getPermissions_withPermission_returnsList() throws Exception {
    mockAuthentication("permission:read");
    List<PermissionResponse> permissions =
        List.of(
            new PermissionResponse(1L, "user:read", "Read users", "user"),
            new PermissionResponse(2L, "user:write", "Write users", "user"));
    when(permissionService.getAllPermissions()).thenReturn(permissions);

    mockMvc
        .perform(get("/api/v1/permissions").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].code").value("user:read"))
        .andExpect(jsonPath("$[1].code").value("user:write"));
  }

  @Test
  void getPermissions_withCategoryFilter_returnsList() throws Exception {
    mockAuthentication("permission:read");
    List<PermissionResponse> permissions =
        List.of(new PermissionResponse(1L, "user:read", "Read users", "user"));
    when(permissionService.getPermissionsByCategory("user")).thenReturn(permissions);

    mockMvc
        .perform(
            get("/api/v1/permissions")
                .param("category", "user")
                .header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].category").value("user"));
  }

  @Test
  void getPermissions_unauthenticated_returnsUnauthorized() throws Exception {
    mockMvc.perform(get("/api/v1/permissions")).andExpect(status().isUnauthorized());
  }
}
