package com.workplace.drive.controller;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.drive.service.DriveFileService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.util.Optional;
import java.util.Set;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** DriveFileController WebMvcTest — 썸네일 HTTP 계약(없으면 404, 있으면 200 image/png). */
@SuppressWarnings("null")
@WebMvcTest(DriveFileController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class DriveFileControllerTest {

  @Autowired private MockMvc mockMvc;

  @MockitoBean private DriveFileService fileService;
  @MockitoBean private JwtTokenProvider jwtTokenProvider;
  @MockitoBean private JwtProperties jwtProperties;
  @MockitoBean private PermissionService permissionService;
  @MockitoBean private AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean private UserRepository userRepository;

  @BeforeEach
  void setUp() {
    when(jwtTokenProvider.validateAccessToken("test-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("test-token")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of());
  }

  /** 썸네일 없음 → 404. */
  @Test
  void thumbnail_missing_returns404() throws Exception {
    when(fileService.thumbnail(anyLong(), anyLong())).thenReturn(Optional.empty());
    mockMvc
        .perform(
            get("/api/v1/drive/files/1/thumbnail").header("Authorization", "Bearer test-token"))
        .andExpect(status().isNotFound());
  }

  /** 썸네일 있음 → 200 image/png. */
  @Test
  void thumbnail_present_returnsPng() throws Exception {
    byte[] data = "png-bytes".getBytes();
    when(fileService.thumbnail(anyLong(), anyLong()))
        .thenReturn(
            Optional.of(
                new FileContentResult(
                    new ByteArrayResource(data), "image/png", "thumbnail.png", data.length)));
    mockMvc
        .perform(
            get("/api/v1/drive/files/1/thumbnail").header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(header().string("Content-Type", Matchers.containsString("image/png")));
  }

  /** 인증 없으면 401. */
  @Test
  void thumbnail_withoutAuth_returns401() throws Exception {
    mockMvc.perform(get("/api/v1/drive/files/1/thumbnail")).andExpect(status().isUnauthorized());
  }
}
