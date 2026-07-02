package com.workplace.drive.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.doNothing;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.drive.dto.CreatedShareLinkResponse;
import com.workplace.drive.dto.ShareLinkResponse;
import com.workplace.drive.service.DriveShareLinkService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
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
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** DriveShareLinkController WebMvcTest — 공유 링크 관리 HTTP 계약(생성/목록/폐기). */
@SuppressWarnings("null")
@WebMvcTest(DriveShareLinkController.class)
@Import({
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class DriveShareLinkControllerTest {

  @Autowired private MockMvc mockMvc;

  @MockitoBean private DriveShareLinkService service;
  @MockitoBean private JwtTokenProvider jwtTokenProvider;
  @MockitoBean private JwtProperties jwtProperties;
  @MockitoBean private PermissionService permissionService;

  @MockitoBean private MembershipRepository membershipRepository;
  @MockitoBean private AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean private UserApiTokenRepository userApiTokenRepository;
  @MockitoBean private UserRepository userRepository;

  @BeforeEach
  void setUp() {
    // JWT 토큰 검증 목 설정 (Bearer 인증 흐름)
    org.mockito.Mockito.when(jwtTokenProvider.validateAccessToken("test-token")).thenReturn(true);
    org.mockito.Mockito.when(jwtTokenProvider.getUserIdFromToken("test-token")).thenReturn(1L);
    org.mockito.Mockito.when(permissionService.getUserPermissions(1L)).thenReturn(Set.of());
  }

  /** callerId=1L 인증 토큰 헬퍼. */
  private Authentication userAuth(long userId) {
    return new UsernamePasswordAuthenticationToken(userId, null, List.of());
  }

  /** 공유 링크 생성 → 201 + 토큰 반환. */
  @Test
  void create_returns201() throws Exception {
    given(service.create(eq(1L), eq(10L), any()))
        .willReturn(new CreatedShareLinkResponse(5L, "sl_x", "EXTERNAL", false, null));

    mockMvc
        .perform(
            post("/api/v1/drive/files/10/share-links")
                .with(authentication(userAuth(1L)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"audience\":\"EXTERNAL\"}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.token").value("sl_x"))
        .andExpect(jsonPath("$.id").value(5));
  }

  /** 링크 목록 → 200 + 배열. */
  @Test
  void list_returns200() throws Exception {
    given(service.list(eq(1L), eq(10L)))
        .willReturn(List.of(new ShareLinkResponse(5L, "EXTERNAL", false, null, false, null, 1L)));

    mockMvc
        .perform(get("/api/v1/drive/files/10/share-links").with(authentication(userAuth(1L))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(5))
        .andExpect(jsonPath("$[0].audience").value("EXTERNAL"));
  }

  /** 링크 폐기 → 204 No Content. */
  @Test
  void revoke_returns204() throws Exception {
    doNothing().when(service).revoke(eq(1L), eq(5L));

    mockMvc
        .perform(delete("/api/v1/drive/share-links/5").with(authentication(userAuth(1L))))
        .andExpect(status().isNoContent());
  }

  /** 인증 없으면 401. */
  @Test
  void create_withoutAuth_returns401() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/drive/files/10/share-links")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"audience\":\"EXTERNAL\"}"))
        .andExpect(status().isUnauthorized());
  }
}
