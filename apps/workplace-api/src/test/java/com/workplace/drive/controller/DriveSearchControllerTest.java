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
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** DriveSearchController WebMvcTest — q 전달/응답 형태/인증. */
@SuppressWarnings("null")
@WebMvcTest(DriveSearchController.class)
@Import({
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class DriveSearchControllerTest {

  @Autowired private MockMvc mockMvc;

  @MockitoBean private DriveSearchService searchService;
  @MockitoBean private JwtTokenProvider jwtTokenProvider;
  @MockitoBean private JwtProperties jwtProperties;
  @MockitoBean private PermissionService permissionService;

  @MockitoBean private MembershipRepository membershipRepository;
  @MockitoBean private AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean private UserApiTokenRepository userApiTokenRepository;
  @MockitoBean private UserRepository userRepository;

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
            10L, null, 5L, "report.txt", "text/plain", 3L, "TEXT", OffsetDateTime.now(), "프로젝트");
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
