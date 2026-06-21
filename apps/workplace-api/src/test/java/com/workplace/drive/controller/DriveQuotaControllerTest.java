package com.workplace.drive.controller;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.drive.service.DriveQuotaService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** DriveQuotaController WebMvcTest — GET /api/v1/drive/quota HTTP 계약. */
@WebMvcTest(DriveQuotaController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class DriveQuotaControllerTest {

  @Autowired private MockMvc mockMvc;

  @MockitoBean private DriveQuotaService quotaService;
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
    // 기본 10 GB 한도, 사용 0 으로 스텁
    when(quotaService.view()).thenReturn(new DriveQuotaService.QuotaView(0L, 10737418240L));
  }

  /** 인증 사용자가 조회하면 사용량/한도 JSON 반환. */
  @Test
  void 쿼터_조회() throws Exception {
    mockMvc
        .perform(get("/api/v1/drive/quota").header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.usedBytes").value(0))
        .andExpect(jsonPath("$.quotaBytes").value(10737418240L));
  }

  /** 미인증 요청은 401. */
  @Test
  void 미인증_요청은_401() throws Exception {
    mockMvc.perform(get("/api/v1/drive/quota")).andExpect(status().isUnauthorized());
  }
}
