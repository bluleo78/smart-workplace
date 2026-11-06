package com.workplace.drive.controller;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.drive.service.DriveQuotaService;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.PermissionMocks;
import com.workplace.support.WebMvcSliceTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

/** DriveQuotaController WebMvcTest — GET /api/v1/drive/quota HTTP 계약. */
class DriveQuotaControllerTest extends WebMvcSliceTestBase {

  @Autowired private MockMvc mockMvc;

  @Autowired private DriveQuotaService quotaService;
  @Autowired private JwtTokenProvider jwtTokenProvider;
  @Autowired private JwtProperties jwtProperties;
  @Autowired private PermissionService permissionService;

  /** WP-420: JWT tenant 경로가 기존 getUserPermissions 스텁을 따르게 한다(PermissionMocks 참고). */
  @BeforeEach
  void mirrorActiveMemberPermissions() {
    PermissionMocks.mirrorActiveMember(permissionService);
  }

  @Autowired private MembershipRepository membershipRepository;
  @Autowired private AgentApiKeyRepository agentApiKeyRepository;
  @Autowired private UserApiTokenRepository userApiTokenRepository;
  @Autowired private UserRepository userRepository;

  @BeforeEach
  void setUp() {
    when(jwtTokenProvider.validateAccessToken("test-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("test-token")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of());
    // 기본 10 GB 한도, 사용 0 으로 스텁
    when(quotaService.view())
        .thenReturn(
            new DriveQuotaService.QuotaView(
                0L, 10737418240L, new DriveQuotaService.Breakdown(0, 0, 0, 0, 0, 0, 0), 0L));
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

  /** 종류별 내역과 메일 첨부 캐시도 함께 내려준다(WP-1391) — 기존 usedBytes·quotaBytes 는 그대로. */
  @Test
  void 쿼터_조회는_종류별_내역과_메일_캐시를_함께_준다() throws Exception {
    when(quotaService.view())
        .thenReturn(
            new DriveQuotaService.QuotaView(
                28L, 100L, new DriveQuotaService.Breakdown(1, 2, 3, 4, 5, 6, 7), 9L));
    mockMvc
        .perform(get("/api/v1/drive/quota").header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.usedBytes").value(28))
        .andExpect(jsonPath("$.quotaBytes").value(100))
        .andExpect(jsonPath("$.breakdown.drive").value(1))
        .andExpect(jsonPath("$.breakdown.trash").value(2))
        .andExpect(jsonPath("$.breakdown.wiki").value(3))
        .andExpect(jsonPath("$.breakdown.issue").value(4))
        .andExpect(jsonPath("$.breakdown.issueChat").value(5))
        .andExpect(jsonPath("$.breakdown.otherAttachments").value(6))
        .andExpect(jsonPath("$.breakdown.unlinked").value(7))
        // 내역은 서비스 레코드를 그대로 쓰므로 계산 메서드(total())가 키로 새지 않는지 고정한다 — 일곱 키뿐.
        .andExpect(jsonPath("$.breakdown.length()").value(7))
        .andExpect(jsonPath("$.breakdown.total").doesNotExist())
        .andExpect(jsonPath("$.mailCacheBytes").value(9));
  }

  /** 미인증 요청은 401. */
  @Test
  void 미인증_요청은_401() throws Exception {
    mockMvc.perform(get("/api/v1/drive/quota")).andExpect(status().isUnauthorized());
  }
}
