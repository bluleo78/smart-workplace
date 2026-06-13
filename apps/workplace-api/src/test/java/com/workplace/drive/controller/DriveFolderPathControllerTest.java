package com.workplace.drive.controller;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.drive.dto.DriveFolderPathSegment;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.service.DriveFolderService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** DriveFolderController — GET /folders/{id}/path 엔드포인트 WebMvcTest. */
@SuppressWarnings("null")
@WebMvcTest(DriveFolderController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class DriveFolderPathControllerTest {

  @Autowired private MockMvc mockMvc;

  @MockitoBean private DriveFolderService folderService;
  @MockitoBean private JwtTokenProvider jwtTokenProvider;
  @MockitoBean private JwtProperties jwtProperties;
  @MockitoBean private PermissionService permissionService;

  @MockitoBean private MembershipRepository membershipRepository;
  @MockitoBean private AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean private UserRepository userRepository;

  /** 인증 토큰 검증 — userId=1 반환. */
  @BeforeEach
  void setUp() {
    when(jwtTokenProvider.validateAccessToken("test-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("test-token")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of());
  }

  /**
   * 인가된 멤버가 중첩 폴더(문서 > 2026)의 path 를 요청하면 루트→대상 순서로 배열을 반환한다. $[0].name == "문서", $[1].name ==
   * "2026".
   */
  @Test
  void path_authorizedMember_returns200WithSegments() throws Exception {
    // 문서(id=10) → 2026(id=11) 깊이 2 구조
    List<DriveFolderPathSegment> segments =
        List.of(new DriveFolderPathSegment(10L, "문서"), new DriveFolderPathSegment(11L, "2026"));
    when(folderService.path(1L, 11L)).thenReturn(segments);

    mockMvc
        .perform(get("/api/v1/drive/folders/11/path").header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].name").value("문서"))
        .andExpect(jsonPath("$[1].name").value("2026"));
  }

  /** 존재하지 않는 폴더 id → 404. DriveFolderNotFoundException 은 GlobalExceptionHandler 가 404 로 매핑한다. */
  @Test
  void path_unknownFolder_returns404() throws Exception {
    when(folderService.path(1L, 999999L)).thenThrow(new DriveFolderNotFoundException(999999L));

    mockMvc
        .perform(
            get("/api/v1/drive/folders/999999/path").header("Authorization", "Bearer test-token"))
        .andExpect(status().isNotFound());
  }

  /** 인증 없으면 401. */
  @Test
  void path_withoutAuth_returns401() throws Exception {
    mockMvc.perform(get("/api/v1/drive/folders/11/path")).andExpect(status().isUnauthorized());
  }
}
