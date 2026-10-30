package com.workplace.drive.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.drive.dto.ShareInfoResponse;
import com.workplace.drive.exception.DriveShareLinkUnauthorizedException;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveShareLinkService;
import com.workplace.drive.service.DriveShareLinkService.ResolvedTarget;
import com.workplace.drive.service.ShareViewTokens;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.filepreview.service.FilePreviewService;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.PermissionMocks;
import com.workplace.support.WebMvcSliceTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * PublicDriveShareController WebMvcTest — 공개 다운로드 HTTP 계약.
 *
 * <p>주요 검증:
 *
 * <ul>
 *   <li>인증 없이(익명 요청) 다운로드 엔드포인트에 접근 가능 (permitAll 와이어링 확인)
 *   <li>X-Share-Password 헤더 값이 resolveForDownload 에 전달됨 (비밀번호 헤더 계약 확인)
 * </ul>
 */
@SuppressWarnings("null")
class PublicDriveShareControllerTest extends WebMvcSliceTestBase {

  @Autowired private MockMvc mockMvc;

  @Autowired private DriveShareLinkService shareLinks;
  @Autowired private DriveFileService fileService;
  @Autowired private FilePreviewService previewService;

  // SecurityConfig 에서 필요한 빈들 — DriveShareLinkControllerTest 와 동일 세트
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

  /**
   * 익명 요청이 401 로 차단되지 않아야 한다 — permitAll 와이어링 검증.
   *
   * <p>서비스를 stub 해 200 을 반환하게 하고, Security Filter 가 엔드포인트를 차단하지 않는지 확인한다.
   */
  @Test
  void anonymousRequest_isNotBlocked_bySecurityChain() throws Exception {
    // given — resolveForDownload → ResolvedTarget(tenantId=1, driveFileId=42)
    given(shareLinks.resolveForDownload(eq("sl_anon"), isNull(), isNull(), isNull(), eq(false)))
        .willReturn(new ResolvedTarget(1L, 42L));

    // downloadViaShareLink → 실제 파일 스트림 대역 FileContentResult
    byte[] content = "hello".getBytes();
    FileContentResult result =
        new FileContentResult(
            new ByteArrayResource(content), "text/plain", "hello.txt", content.length);
    given(fileService.downloadViaShareLink(42L)).willReturn(result);

    // when — 인증 헤더 없이 GET 요청
    mockMvc
        .perform(get("/api/v1/public/drive/share/sl_anon/download"))
        // then — 401 이 아닌 200 (Security Filter 에서 차단 안 됨)
        .andExpect(status().isOk())
        .andExpect(
            header().string("Content-Type", org.hamcrest.Matchers.containsString("text/plain")));
  }

  /**
   * X-Share-Password 헤더 값이 resolveForDownload 에 전달됨을 검증한다.
   *
   * <p>비밀번호가 URL 쿼리 문자열이 아닌 헤더로 전달되는 새 계약을 확인한다.
   */
  @Test
  void passwordHeader_isPassedToResolveForDownload() throws Exception {
    // given
    given(
            shareLinks.resolveForDownload(
                eq("sl_pw"), eq("secret123"), isNull(), any(), anyBoolean()))
        .willReturn(new ResolvedTarget(1L, 99L));

    byte[] content = "data".getBytes();
    FileContentResult result =
        new FileContentResult(
            new ByteArrayResource(content), "application/octet-stream", "file.bin", content.length);
    given(fileService.downloadViaShareLink(99L)).willReturn(result);

    // when — X-Share-Password 헤더 포함 요청
    mockMvc
        .perform(
            get("/api/v1/public/drive/share/sl_pw/download")
                .header("X-Share-Password", "secret123"))
        .andExpect(status().isOk());

    // then — resolveForDownload 에 비밀번호 "secret123" 이 전달됐는지 검증
    ArgumentCaptor<String> pwCaptor = ArgumentCaptor.forClass(String.class);
    verify(shareLinks)
        .resolveForDownload(eq("sl_pw"), pwCaptor.capture(), isNull(), any(), anyBoolean());
    org.junit.jupiter.api.Assertions.assertEquals("secret123", pwCaptor.getValue());
  }

  /**
   * 한글 등 비ASCII 비밀번호(WP-528) — 브라우저는 헤더에 비ASCII 를 넣을 수 없어 웹은 UTF-8 퍼센트 인코딩한
   * X-Share-Password-Encoded 헤더로 보낸다. 서버가 풀어 원문으로 resolve 에 넘겨야 한다. '+' 는 공백으로 바꾸지 않는다.
   */
  @Test
  void encodedPasswordHeader_isDecodedAsUtf8() throws Exception {
    given(shareLinks.resolveForDownload(eq("sl_ko"), eq("한글 비번+1%"), isNull(), any(), anyBoolean()))
        .willReturn(new ResolvedTarget(1L, 98L));
    byte[] content = "data".getBytes();
    given(fileService.downloadViaShareLink(98L))
        .willReturn(
            new FileContentResult(
                new ByteArrayResource(content), "text/plain", "k.txt", content.length));

    mockMvc
        .perform(
            get("/api/v1/public/drive/share/sl_ko/download")
                .header(
                    "X-Share-Password-Encoded", "%ED%95%9C%EA%B8%80%20%EB%B9%84%EB%B2%88%2B1%25"))
        .andExpect(status().isOk());

    verify(shareLinks)
        .resolveForDownload(eq("sl_ko"), eq("한글 비번+1%"), isNull(), any(), anyBoolean());
  }

  /** 인코딩 헤더가 깨져 있으면(잘못된 % 시퀀스) 400 이 아니라 원문 그대로 넘겨 비밀번호 불일치로 처리한다. */
  @Test
  void malformedEncodedPasswordHeader_passesRawValue() throws Exception {
    given(shareLinks.resolveForDownload(eq("sl_bad"), eq("%E0%A"), isNull(), any(), anyBoolean()))
        .willReturn(new ResolvedTarget(1L, 97L));
    byte[] content = "d".getBytes();
    given(fileService.downloadViaShareLink(97L))
        .willReturn(
            new FileContentResult(
                new ByteArrayResource(content), "text/plain", "b.txt", content.length));

    mockMvc
        .perform(
            get("/api/v1/public/drive/share/sl_bad/download")
                .header("X-Share-Password-Encoded", "%E0%A"))
        .andExpect(status().isOk());

    verify(shareLinks).resolveForDownload(eq("sl_bad"), eq("%E0%A"), isNull(), any(), anyBoolean());
  }

  /** 비밀번호 헤더가 없을 때 null 이 전달됨을 검증한다. */
  @Test
  void noPasswordHeader_passesNullToResolve() throws Exception {
    // given
    given(shareLinks.resolveForDownload(eq("sl_nopw"), isNull(), isNull(), isNull(), eq(false)))
        .willReturn(new ResolvedTarget(1L, 10L));

    byte[] content = "x".getBytes();
    given(fileService.downloadViaShareLink(10L))
        .willReturn(
            new FileContentResult(
                new ByteArrayResource(content), "text/plain", "x.txt", content.length));

    // when — 헤더 없이 요청
    mockMvc.perform(get("/api/v1/public/drive/share/sl_nopw/download")).andExpect(status().isOk());

    // then — password 인수가 null
    verify(shareLinks).resolveForDownload(eq("sl_nopw"), isNull(), isNull(), isNull(), eq(false));
  }

  // --- WP-1227: 정보·unlock·content·preview·열람 토큰 ---

  /** 정보 — 통과 응답은 파일 필드 전부(sharedBy·driveOpen 은 null 이어도 키가 있다). */
  @Test
  void info_full_serializesContractFields() throws Exception {
    given(shareLinks.info(eq("sl_i"), eq("vt"), isNull(), isNull()))
        .willReturn(
            ShareInfoResponse.full(
                "a.pdf",
                "application/pdf",
                10L,
                null,
                true,
                new ShareInfoResponse.DriveOpen(3L, null, 7L)));
    mockMvc
        .perform(get("/api/v1/public/drive/share/sl_i").header("X-Share-View-Token", "vt"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.passwordRequired").value(false))
        .andExpect(jsonPath("$.loginRequired").value(false))
        .andExpect(jsonPath("$.name").value("a.pdf"))
        .andExpect(jsonPath("$.mimeType").value("application/pdf"))
        .andExpect(jsonPath("$.sizeBytes").value(10))
        .andExpect(jsonPath("$.sharedBy").isEmpty())
        .andExpect(jsonPath("$.loginAvailable").value(true))
        .andExpect(jsonPath("$.driveOpen.spaceId").value(3))
        .andExpect(jsonPath("$.driveOpen.folderId").isEmpty())
        .andExpect(jsonPath("$.driveOpen.driveFileId").value(7));
  }

  /** 정보 — 비밀번호 단계는 파일 필드 없이 두 플래그만. */
  @Test
  void info_passwordRequired_hasNoFileFields() throws Exception {
    given(shareLinks.info(eq("sl_p"), isNull(), isNull(), isNull()))
        .willReturn(ShareInfoResponse.passwordRequired());
    mockMvc
        .perform(get("/api/v1/public/drive/share/sl_p"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.passwordRequired").value(true))
        .andExpect(jsonPath("$.loginRequired").value(false))
        .andExpect(jsonPath("$.name").doesNotExist())
        .andExpect(jsonPath("$.driveOpen").doesNotExist());
  }

  /** unlock — 본문 비밀번호를 넘기고 {viewToken, expiresAt} 를 돌려준다. */
  @Test
  void unlock_returnsViewToken() throws Exception {
    given(shareLinks.unlock(eq("sl_u"), eq("한글"), isNull(), eq(false)))
        .willReturn(
            new ShareViewTokens.ViewToken("p.s", java.time.Instant.parse("2026-01-01T00:00:00Z")));
    mockMvc
        .perform(
            post("/api/v1/public/drive/share/sl_u/unlock")
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .content("{\"password\":\"한글\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.viewToken").value("p.s"))
        .andExpect(jsonPath("$.expiresAt").value("2026-01-01T00:00:00Z"));
  }

  /** unlock — 틀리면 401. */
  @Test
  void unlock_wrong_is401() throws Exception {
    given(shareLinks.unlock(eq("sl_w"), eq("x"), isNull(), eq(false)))
        .willThrow(new DriveShareLinkUnauthorizedException("비밀번호가 필요하거나 올바르지 않습니다"));
    mockMvc
        .perform(
            post("/api/v1/public/drive/share/sl_w/unlock")
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .content("{\"password\":\"x\"}"))
        .andExpect(status().isUnauthorized());
  }

  /** content — HTML 도 inline 이되 nosniff·CSP sandbox 로 이 출처에서 실행되지 않게 한다. 열람 토큰을 넘긴다. */
  @Test
  void content_inline_withNosniffAndSandbox() throws Exception {
    given(shareLinks.resolveForView(eq("sl_c"), eq("vt"), isNull(), eq(false)))
        .willReturn(new ResolvedTarget(1L, 55L));
    byte[] html = "<script>alert(1)</script>".getBytes();
    given(fileService.downloadViaShareLink(55L))
        .willReturn(
            new FileContentResult(
                new ByteArrayResource(html), "text/html", "보고서.html", html.length));
    mockMvc
        .perform(get("/api/v1/public/drive/share/sl_c/content").header("X-Share-View-Token", "vt"))
        .andExpect(status().isOk())
        .andExpect(header().string("X-Content-Type-Options", "nosniff"))
        .andExpect(header().string("Content-Security-Policy", "sandbox"))
        .andExpect(
            header()
                .string(
                    "Content-Disposition",
                    org.hamcrest.Matchers.allOf(
                        org.hamcrest.Matchers.startsWith("inline"),
                        org.hamcrest.Matchers.containsString("UTF-8''"))));
  }

  /** content — 열람 토큰이 없으면(가드 401) 파일을 읽지 않는다. */
  @Test
  void content_withoutViewToken_is401() throws Exception {
    given(shareLinks.resolveForView(eq("sl_c2"), isNull(), isNull(), eq(false)))
        .willThrow(new DriveShareLinkUnauthorizedException("비밀번호 확인이 필요하거나 열람 시간이 지났습니다"));
    mockMvc
        .perform(get("/api/v1/public/drive/share/sl_c2/content").header("X-Share-Password", "pw"))
        .andExpect(status().isUnauthorized());
    verify(fileService, never()).downloadViaShareLink(any(Long.class));
  }

  /** preview — 가드가 막으면 변환을 열지 않는다. */
  @Test
  void preview_guarded() throws Exception {
    given(shareLinks.resolveForView(eq("sl_v"), isNull(), isNull(), eq(false)))
        .willThrow(new DriveShareLinkUnauthorizedException("x"));
    mockMvc
        .perform(get("/api/v1/public/drive/share/sl_v/preview").param("start", "true"))
        .andExpect(status().isUnauthorized());
    verify(previewService, never()).open(any(Long.class), anyBoolean());
  }

  /** preview — 통과하면 링크 파일의 core id 로 연다. */
  @Test
  void preview_opensCoreFile() throws Exception {
    given(shareLinks.resolveForView(eq("sl_v2"), eq("vt"), isNull(), eq(false)))
        .willReturn(new ResolvedTarget(1L, 66L));
    given(fileService.coreFileIdViaShareLink(66L)).willReturn(660L);
    given(previewService.open(660L, true))
        .willReturn(new com.workplace.filepreview.service.PreviewOutcome.NotApplicable());
    mockMvc
        .perform(
            get("/api/v1/public/drive/share/sl_v2/preview")
                .param("start", "true")
                .header("X-Share-View-Token", "vt"))
        .andExpect(status().isNotFound());
    verify(previewService).open(660L, true);
  }

  /** download — 열람 토큰 헤더를 resolve 에 넘긴다. */
  @Test
  void download_passesViewToken() throws Exception {
    given(shareLinks.resolveForDownload(eq("sl_d"), isNull(), eq("vt"), isNull(), eq(false)))
        .willReturn(new ResolvedTarget(1L, 77L));
    byte[] content = "d".getBytes();
    given(fileService.downloadViaShareLink(77L))
        .willReturn(
            new FileContentResult(
                new ByteArrayResource(content), "text/plain", "d.txt", content.length));
    mockMvc
        .perform(get("/api/v1/public/drive/share/sl_d/download").header("X-Share-View-Token", "vt"))
        .andExpect(status().isOk());
  }
}
