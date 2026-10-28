package com.workplace.drive.controller;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.drive.dto.DriveFileHit;
import com.workplace.drive.dto.DriveSearchResponse;
import com.workplace.drive.service.DriveSearchService;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.PermissionMocks;
import com.workplace.support.WebMvcSliceTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

/** DriveSearchController WebMvcTest — q 전달/응답 형태/인증. */
@SuppressWarnings("null")
class DriveSearchControllerTest extends WebMvcSliceTestBase {

  @Autowired private MockMvc mockMvc;

  @Autowired private DriveSearchService searchService;
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
  }

  /** q 가 서비스로 전달되고 결과가 직렬화된다. */
  @Test
  void search_returnsHits() throws Exception {
    DriveFileHit hit =
        new DriveFileHit(
            10L,
            null,
            5L,
            "report.txt",
            "text/plain",
            3L,
            "TEXT",
            OffsetDateTime.now(),
            OffsetDateTime.now(),
            "프로젝트");
    when(searchService.search(anyLong(), eq(7L), eq("report")))
        .thenReturn(new DriveSearchResponse(List.of(), List.of(hit)));

    mockMvc
        .perform(
            get("/api/v1/drive/spaces/7/search")
                .param("q", "report")
                .header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.files[0].name").value("report.txt"))
        .andExpect(jsonPath("$.files[0].folderPath").value("프로젝트"));
  }

  /** 인증 없으면 401. */
  @Test
  void search_withoutAuth_returns401() throws Exception {
    mockMvc
        .perform(get("/api/v1/drive/spaces/7/search").param("q", "x"))
        .andExpect(status().isUnauthorized());
  }
}
