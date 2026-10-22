package com.workplace.issue.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
import com.workplace.issue.service.IssueFieldValueService;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.AlwaysActiveTenantStatusChecker;
import com.workplace.support.PermissionMocks;
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

/** IssueFieldValueController @WebMvcTest — 요청 본문 검증만 본다. JWT/Permission/Service 는 mock. */
@SuppressWarnings("null")
@WebMvcTest(IssueFieldValueController.class)
@Import({
  AlwaysActiveTenantStatusChecker.class,
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class IssueFieldValueControllerTest {

  @Autowired private MockMvc mockMvc;

  @MockitoBean private IssueFieldValueService service;
  @MockitoBean private JwtTokenProvider jwtTokenProvider;
  @MockitoBean private JwtProperties jwtProperties;
  @MockitoBean private PermissionService permissionService;
  @MockitoBean private MembershipRepository membershipRepository;
  @MockitoBean private AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean private UserApiTokenRepository userApiTokenRepository;
  @MockitoBean private UserRepository userRepository;

  @BeforeEach
  void auth() {
    PermissionMocks.mirrorActiveMember(permissionService);
    when(jwtTokenProvider.validateAccessToken("valid-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("valid-token")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("issue:write"));
  }

  /** values 의 null 원소·defId 없는 원소는 400(WP-743 — null 원소는 500 이 났다). */
  @Test
  void values_에_null_원소나_defId_없는_원소가_있으면_400() throws Exception {
    String[][] cases = {
      {"{\"values\":[null]}", "values[0]"},
      {"{\"values\":[{\"value\":\"x\"}]}", "values[0].defId"},
    };
    for (String[] c : cases) {
      mockMvc
          .perform(
              put("/api/v1/projects/WP/issues/1/fields")
                  .header("Authorization", "Bearer valid-token")
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(c[0]))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.errors['" + c[1] + "']").value("값이 필요합니다"));
    }
    verify(service, never()).replace(anyLong(), any(), anyInt(), any());
  }
}
