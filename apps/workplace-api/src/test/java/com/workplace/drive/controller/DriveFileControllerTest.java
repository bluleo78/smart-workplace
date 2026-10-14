package com.workplace.drive.controller;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.exception.DriveDuplicateNameException;
import com.workplace.drive.service.DriveFileService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.AlwaysActiveTenantStatusChecker;
import com.workplace.tenant.repository.MembershipRepository;
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
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** DriveFileController WebMvcTest — 썸네일 HTTP 계약(없으면 404, 있으면 200 image/png). */
@SuppressWarnings("null")
@WebMvcTest(DriveFileController.class)
@Import({
  AlwaysActiveTenantStatusChecker.class,
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class DriveFileControllerTest {

  @Autowired private MockMvc mockMvc;

  @MockitoBean private DriveFileService fileService;
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

  // ── WP-346: 추출 텍스트 구간 읽기 ──

  /** GET /files/{id}/text — 기본 offset=0·limit=32000 으로 서비스에 넘기고 이슈 첨부 /text 와 같은 JSON 을 돌려준다. */
  @Test
  void readText_defaults_returnsSlice() throws Exception {
    when(fileService.readText(1L, 7L, 0, 32000))
        .thenReturn(
            new ExtractedTextSlice(55L, "READY", 0, 3, false, null, "본문입", null, null, null));
    mockMvc
        .perform(get("/api/v1/drive/files/7/text").header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.fileId").value(55))
        .andExpect(jsonPath("$.status").value("READY"))
        .andExpect(jsonPath("$.text").value("본문입"))
        .andExpect(jsonPath("$.totalChars").value(3));
  }

  /** offset·limit 쿼리 파라미터 전달, 추출 전 상태는 본문 없이 status 만. */
  @Test
  void readText_passesRange_andPendingHasNoText() throws Exception {
    when(fileService.readText(1L, 7L, 100, 50))
        .thenReturn(
            new ExtractedTextSlice(55L, "PENDING", 100, null, null, null, null, null, null, null));
    mockMvc
        .perform(
            get("/api/v1/drive/files/7/text?offset=100&limit=50")
                .header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"))
        .andExpect(jsonPath("$.offset").value(100))
        .andExpect(jsonPath("$.text").doesNotExist());
  }

  /** 인증 없으면 401. */
  @Test
  void readText_withoutAuth_returns401() throws Exception {
    mockMvc.perform(get("/api/v1/drive/files/7/text")).andExpect(status().isUnauthorized());
  }

  // ── WP-335: 파일 이름 변경 ──

  /** PATCH /files/{id} → 200 + 바뀐 파일 응답. */
  @Test
  void rename_returnsUpdatedFile() throws Exception {
    when(fileService.rename(eq(1L), eq(7L), eq("회의록.txt"))).thenReturn(fileResponse("회의록.txt"));
    mockMvc
        .perform(
            patch("/api/v1/drive/files/7")
                .header("Authorization", "Bearer test-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"회의록.txt\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("회의록.txt"));
  }

  /** 같은 폴더 동명 → 409. */
  @Test
  void rename_duplicate_returns409() throws Exception {
    when(fileService.rename(anyLong(), anyLong(), org.mockito.ArgumentMatchers.anyString()))
        .thenThrow(new DriveDuplicateNameException("a.txt"));
    mockMvc
        .perform(
            patch("/api/v1/drive/files/7")
                .header("Authorization", "Bearer test-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"a.txt\"}"))
        .andExpect(status().isConflict());
  }

  /** 빈 이름 → 400, 서비스 미호출(금지 문자 검사는 서비스 몫 — DriveFileServiceTest). */
  @Test
  void rename_blankName_returns400() throws Exception {
    mockMvc
        .perform(
            patch("/api/v1/drive/files/7")
                .header("Authorization", "Bearer test-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"  \"}"))
        .andExpect(status().isBadRequest());
    verify(fileService, never())
        .rename(anyLong(), anyLong(), org.mockito.ArgumentMatchers.anyString());
  }

  private static DriveFileResponse fileResponse(String name) {
    java.time.OffsetDateTime now = java.time.OffsetDateTime.now();
    return new DriveFileResponse(
        7L, null, 70L, name, "text/plain", 5L, "DOCUMENT", now, now, 1, true);
  }
}
