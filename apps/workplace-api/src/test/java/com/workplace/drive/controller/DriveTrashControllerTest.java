package com.workplace.drive.controller;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.drive.dto.DriveTrashItemResponse;
import com.workplace.drive.dto.DriveTrashListResponse;
import com.workplace.drive.service.DriveTrashService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
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

/** DriveTrashController WebMvcTest — 휴지통 REST 계약 검증. */
@SuppressWarnings("null")
@WebMvcTest(DriveTrashController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class DriveTrashControllerTest {

  @Autowired private MockMvc mockMvc;

  @MockitoBean private DriveTrashService trashService;
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

  /** 휴지통 목록 조회 — FILE 항목이 포함된 items 반환. */
  @Test
  void listTrash_returnsItems() throws Exception {
    DriveTrashItemResponse item =
        new DriveTrashItemResponse(
            "FILE",
            42L,
            "report.pdf",
            "/문서",
            OffsetDateTime.now(),
            OffsetDateTime.now().plusDays(30),
            1024L);
    when(trashService.listTrash(eq(1L), eq(7L)))
        .thenReturn(new DriveTrashListResponse(List.of(item)));

    mockMvc
        .perform(get("/api/v1/drive/spaces/7/trash").header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].type").value("FILE"))
        .andExpect(jsonPath("$.items[0].name").value("report.pdf"));
  }

  /** 인증 없으면 401. */
  @Test
  void listTrash_withoutAuth_returns401() throws Exception {
    mockMvc.perform(get("/api/v1/drive/spaces/7/trash")).andExpect(status().isUnauthorized());
  }

  /** 파일 복원 — 204 반환. */
  @Test
  void restoreFile_returns204() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/drive/files/42/restore").header("Authorization", "Bearer test-token"))
        .andExpect(status().isNoContent());
    verify(trashService).restoreFile(1L, 42L);
  }

  /** 폴더 복원 — 204 반환. */
  @Test
  void restoreFolder_returns204() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/drive/folders/10/restore").header("Authorization", "Bearer test-token"))
        .andExpect(status().isNoContent());
    verify(trashService).restoreFolder(1L, 10L);
  }

  /** 파일 영구 삭제 — 204 반환. */
  @Test
  void purgeFile_returns204() throws Exception {
    mockMvc
        .perform(
            delete("/api/v1/drive/files/42/purge").header("Authorization", "Bearer test-token"))
        .andExpect(status().isNoContent());
    verify(trashService).purgeFile(1L, 42L);
  }

  /** 폴더 영구 삭제 — 204 반환. */
  @Test
  void purgeFolder_returns204() throws Exception {
    mockMvc
        .perform(
            delete("/api/v1/drive/folders/10/purge").header("Authorization", "Bearer test-token"))
        .andExpect(status().isNoContent());
    verify(trashService).purgeFolder(1L, 10L);
  }

  /** 휴지통 비우기 — 204 반환. */
  @Test
  void emptyTrash_returns204() throws Exception {
    mockMvc
        .perform(
            delete("/api/v1/drive/spaces/7/trash").header("Authorization", "Bearer test-token"))
        .andExpect(status().isNoContent());
    verify(trashService).emptyTrash(1L, 7L);
  }

  /** anyLong() 은 사용하지 않으므로 억제 경고 제거용 참조. */
  @SuppressWarnings("unused")
  private static void unusedSuppressor() {
    anyLong();
  }
}
