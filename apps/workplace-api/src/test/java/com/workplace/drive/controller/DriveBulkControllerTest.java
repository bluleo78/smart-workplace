package com.workplace.drive.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.drive.service.DriveBulkService;
import com.workplace.drive.service.DriveFolderService;
import com.workplace.drive.service.DriveZipService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.AlwaysActiveTenantStatusChecker;
import com.workplace.support.PermissionMocks;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SuppressWarnings("null")
@WebMvcTest(DriveBulkController.class)
@Import({
  AlwaysActiveTenantStatusChecker.class,
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class DriveBulkControllerTest {

  @Autowired private MockMvc mockMvc;

  @MockitoBean private DriveBulkService bulkService;
  @MockitoBean private DriveZipService zipService;
  @MockitoBean private DriveFolderService folderService;
  @MockitoBean private JwtTokenProvider jwtTokenProvider;
  @MockitoBean private JwtProperties jwtProperties;
  @MockitoBean private PermissionService permissionService;

  /** WP-420: JWT tenant 경로가 기존 getUserPermissions 스텁을 따르게 한다(PermissionMocks 참고). */
  @BeforeEach
  void mirrorActiveMemberPermissions() {
    PermissionMocks.mirrorActiveMember(permissionService);
  }

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

  @Test
  void 벌크삭제_204_그리고_서비스호출() throws Exception {
    mockMvc
        .perform(
            delete("/api/v1/drive/spaces/9/items")
                .header("Authorization", "Bearer test-token")
                .contentType("application/json")
                .content("{\"fileIds\":[1,2],\"folderIds\":[3]}"))
        .andExpect(status().isNoContent());
    verify(bulkService).bulkDelete(1L, 9L, List.of(1L, 2L), List.of(3L));
  }

  @Test
  void 벌크이동_204() throws Exception {
    mockMvc
        .perform(
            patch("/api/v1/drive/spaces/9/items/move")
                .header("Authorization", "Bearer test-token")
                .contentType("application/json")
                .content("{\"fileIds\":[1],\"folderIds\":[],\"targetFolderId\":5}"))
        .andExpect(status().isNoContent());
    verify(bulkService).bulkMove(1L, 9L, List.of(1L), List.of(), 5L);
  }

  @Test
  void ZIP_다운로드_200_application_zip() throws Exception {
    when(zipService.collectEntries(anyLong(), anyLong(), any(), any())).thenReturn(List.of());
    mockMvc
        .perform(
            post("/api/v1/drive/spaces/9/download-zip")
                .header("Authorization", "Bearer test-token")
                .contentType("application/json")
                .content("{\"fileIds\":[1],\"folderIds\":[]}"))
        .andExpect(status().isOk());
  }

  /** 목록의 null 원소는 서비스에 닿기 전 400 으로 거절한다(WP-743 — 언박싱 NPE 로 500 이 났다). */
  @Test
  void 목록에_null_원소가_있으면_400_서비스_미호출() throws Exception {
    String[][] cases = {
      {
        "DELETE",
        "/api/v1/drive/spaces/9/items",
        "{\"fileIds\":[1,null],\"folderIds\":[]}",
        "fileIds[1]"
      },
      {
        "DELETE",
        "/api/v1/drive/spaces/9/items",
        "{\"fileIds\":[],\"folderIds\":[null]}",
        "folderIds[0]"
      },
      {
        "PATCH",
        "/api/v1/drive/spaces/9/items/move",
        "{\"fileIds\":[null],\"folderIds\":[],\"targetFolderId\":null}",
        "fileIds[0]"
      },
      {
        "POST",
        "/api/v1/drive/spaces/9/download-zip",
        "{\"fileIds\":[null],\"folderIds\":[]}",
        "fileIds[0]"
      },
    };
    for (String[] c : cases) {
      mockMvc
          .perform(
              request(HttpMethod.valueOf(c[0]), c[1])
                  .header("Authorization", "Bearer test-token")
                  .contentType("application/json")
                  .content(c[2]))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.errors['" + c[3] + "']").value("값이 필요합니다"));
    }
    verifyNoInteractions(bulkService, zipService);
  }
}
