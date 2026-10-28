package com.workplace.drive.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveShareLinkService;
import com.workplace.drive.service.DriveShareLinkService.ResolvedTarget;
import com.workplace.file.service.FileUploadService.FileContentResult;
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
    given(shareLinks.resolveForDownload(eq("sl_anon"), isNull(), isNull(), eq(false)))
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
    given(shareLinks.resolveForDownload(eq("sl_pw"), eq("secret123"), any(), anyBoolean()))
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
    verify(shareLinks).resolveForDownload(eq("sl_pw"), pwCaptor.capture(), any(), anyBoolean());
    org.junit.jupiter.api.Assertions.assertEquals("secret123", pwCaptor.getValue());
  }

  /**
   * 한글 등 비ASCII 비밀번호(WP-528) — 브라우저는 헤더에 비ASCII 를 넣을 수 없어 웹은 UTF-8 퍼센트 인코딩한
   * X-Share-Password-Encoded 헤더로 보낸다. 서버가 풀어 원문으로 resolve 에 넘겨야 한다. '+' 는 공백으로 바꾸지 않는다.
   */
  @Test
  void encodedPasswordHeader_isDecodedAsUtf8() throws Exception {
    given(shareLinks.resolveForDownload(eq("sl_ko"), eq("한글 비번+1%"), any(), anyBoolean()))
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

    verify(shareLinks).resolveForDownload(eq("sl_ko"), eq("한글 비번+1%"), any(), anyBoolean());
  }

  /** 인코딩 헤더가 깨져 있으면(잘못된 % 시퀀스) 400 이 아니라 원문 그대로 넘겨 비밀번호 불일치로 처리한다. */
  @Test
  void malformedEncodedPasswordHeader_passesRawValue() throws Exception {
    given(shareLinks.resolveForDownload(eq("sl_bad"), eq("%E0%A"), any(), anyBoolean()))
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

    verify(shareLinks).resolveForDownload(eq("sl_bad"), eq("%E0%A"), any(), anyBoolean());
  }

  /** 비밀번호 헤더가 없을 때 null 이 전달됨을 검증한다. */
  @Test
  void noPasswordHeader_passesNullToResolve() throws Exception {
    // given
    given(shareLinks.resolveForDownload(eq("sl_nopw"), isNull(), isNull(), eq(false)))
        .willReturn(new ResolvedTarget(1L, 10L));

    byte[] content = "x".getBytes();
    given(fileService.downloadViaShareLink(10L))
        .willReturn(
            new FileContentResult(
                new ByteArrayResource(content), "text/plain", "x.txt", content.length));

    // when — 헤더 없이 요청
    mockMvc.perform(get("/api/v1/public/drive/share/sl_nopw/download")).andExpect(status().isOk());

    // then — password 인수가 null
    verify(shareLinks).resolveForDownload(eq("sl_nopw"), isNull(), isNull(), eq(false));
  }
}
