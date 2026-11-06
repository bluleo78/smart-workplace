package com.workplace.file.controller;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.file.dto.FileUploadResponse;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.PermissionMocks;
import com.workplace.support.WebMvcSliceTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

/** FileUploadController WebMvcTest — 파일 업로드/조회 엔드포인트 인증/권한 검증 */
@SuppressWarnings("null")
class FileUploadControllerTest extends WebMvcSliceTestBase {

  @Autowired private MockMvc mockMvc;

  @Autowired private FileUploadService fileUploadService;
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
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("ai:write"));
  }

  private FileUploadResponse sampleResponse() {
    return new FileUploadResponse(1L, "test.csv", "text/csv", 1024L, "DATA", Instant.now());
  }

  /** POST /files — 파일 업로드 성공 시 200 반환 */
  @Test
  void uploadFiles_withPermission_returnsOk() throws Exception {
    MockMultipartFile file =
        new MockMultipartFile("files", "test.csv", "text/csv", "col1,col2\n1,2".getBytes());

    when(fileUploadService.uploadFiles(anyList(), anyLong())).thenReturn(List.of(sampleResponse()));

    mockMvc
        .perform(multipart("/api/v1/files").file(file).header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(1))
        .andExpect(jsonPath("$[0].originalName").value("test.csv"));
  }

  /** POST /files — 인증 없으면 401 */
  @Test
  void uploadFiles_withoutAuth_returnsUnauthorized() throws Exception {
    MockMultipartFile file =
        new MockMultipartFile("files", "test.csv", "text/csv", "data".getBytes());
    mockMvc.perform(multipart("/api/v1/files").file(file)).andExpect(status().isUnauthorized());
  }

  /** GET /files/{id} — 파일 정보 조회 성공 */
  @Test
  void getFileInfo_withPermission_returnsOk() throws Exception {
    when(fileUploadService.getFileInfo(anyLong(), anyLong())).thenReturn(sampleResponse());

    mockMvc
        .perform(get("/api/v1/files/1").header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(1));
  }

  /** GET /files/{id} — 인증 없으면 401 */
  @Test
  void getFileInfo_withoutAuth_returnsUnauthorized() throws Exception {
    mockMvc.perform(get("/api/v1/files/1")).andExpect(status().isUnauthorized());
  }

  /** GET /files/{id}/content — 파일 콘텐츠 스트리밍 다운로드 성공 (OOM 방지: Resource 반환) */
  @Test
  void getFileContent_withAuth_returnsOk() throws Exception {
    byte[] data = "col1,col2\n1,2".getBytes();
    // ByteArrayResource는 테스트용 mock; 실제 서비스는 FileSystemResource를 사용한다
    FileContentResult result =
        new FileContentResult(new ByteArrayResource(data), "text/csv", "test.csv", data.length);
    when(fileUploadService.getFileContent(anyLong(), anyLong())).thenReturn(result);

    mockMvc
        .perform(get("/api/v1/files/1/content").header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(
            header().string("Content-Type", org.hamcrest.Matchers.containsString("text/csv")))
        // WP-1323: 드라이브 원본도 이 경로로 읽을 수 있어 html·svg 가 이 출처로 실행되지 않게 샌드박스.
        .andExpect(header().string("Content-Security-Policy", "sandbox"));
  }

  /** GET /files/{id}/content — WP-1406: html 은 inline 이 아니라 attachment 로 내려 API 출처에서 렌더되지 않게 한다. */
  @Test
  void getFileContent_html_returnsAttachment() throws Exception {
    byte[] data = "<html></html>".getBytes();
    FileContentResult result =
        new FileContentResult(new ByteArrayResource(data), "text/html", "page.html", data.length);
    when(fileUploadService.getFileContent(anyLong(), anyLong())).thenReturn(result);

    mockMvc
        .perform(get("/api/v1/files/1/content").header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(
            header()
                .string("Content-Disposition", org.hamcrest.Matchers.containsString("attachment")));
  }

  /** GET /files/{id}/content — WP-1406: svg 도 이미지 4종 밖이라 attachment 로 내려 준다. */
  @Test
  void getFileContent_svg_returnsAttachment() throws Exception {
    byte[] data = "<svg/>".getBytes();
    FileContentResult result =
        new FileContentResult(
            new ByteArrayResource(data), "image/svg+xml", "icon.svg", data.length);
    when(fileUploadService.getFileContent(anyLong(), anyLong())).thenReturn(result);

    mockMvc
        .perform(get("/api/v1/files/1/content").header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(
            header()
                .string("Content-Disposition", org.hamcrest.Matchers.containsString("attachment")));
  }

  /** GET /files/{id}/content — WP-1406: 이미지 4종(png) 은 기존처럼 inline 으로 내려 준다. */
  @Test
  void getFileContent_image_returnsInline() throws Exception {
    byte[] data = "png-bytes".getBytes();
    FileContentResult result =
        new FileContentResult(new ByteArrayResource(data), "image/png", "shot.png", data.length);
    when(fileUploadService.getFileContent(anyLong(), anyLong())).thenReturn(result);

    mockMvc
        .perform(get("/api/v1/files/1/content").header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(
            header().string("Content-Disposition", org.hamcrest.Matchers.containsString("inline")));
  }
}
