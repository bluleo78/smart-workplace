package com.workplace.drive.controller;

import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveShareLinkService;
import com.workplace.drive.service.DriveShareLinkService.ResolvedTarget;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.global.tenant.TenantContext;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.util.UriUtils;

/** 공유 링크 공개 다운로드(인증 불필요). 토큰 resolve → 컨텍스트 설정 → 기존 다운로드 경로. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/public/drive")
public class PublicDriveShareController {
  private final DriveShareLinkService shareLinks;
  private final DriveFileService fileService;

  /**
   * 공유 토큰으로 파일 다운로드.
   *
   * <p>2-트랜잭션 패턴: ① resolve(SECURITY DEFINER 함수, RLS 무관) → ② 대상 테넌트 컨텍스트 설정 후 별도 tx 다운로드.
   *
   * <p>비밀번호는 X-Share-Password 요청 헤더로 전달 — URL 쿼리 문자열에 포함 시 브라우저 히스토리/Referer 헤더에 노출될 수 있으므로 헤더로 이동.
   * 브라우저는 헤더에 비ASCII(한글 등)를 넣을 수 없어, 웹은 UTF-8 퍼센트 인코딩한 X-Share-Password-Encoded 를 보낸다(WP-528) — 있으면
   * 그것을 풀어 쓰고, 없으면 X-Share-Password 원문을 쓴다(구 클라이언트·외부 호출 호환).
   */
  @GetMapping("/share/{token}/download")
  public ResponseEntity<Resource> download(
      @PathVariable("token") String token,
      @RequestHeader(value = "X-Share-Password", required = false) String rawPassword,
      @RequestHeader(value = "X-Share-Password-Encoded", required = false) String encodedPassword)
      throws IOException {
    String password = encodedPassword != null ? decodePassword(encodedPassword) : rawPassword;
    // 1) 요청자 컨텍스트 스냅샷(INTERNAL 검증용) — JwtAuthenticationFilter 가 인증 시 채워둠.
    Long requesterTenant = TenantContext.get();
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    boolean authenticated =
        auth != null && auth.isAuthenticated() && auth.getPrincipal() instanceof Long;

    // 2) resolve(함수, RLS 무관) + 가드
    ResolvedTarget target =
        shareLinks.resolveForDownload(token, password, requesterTenant, authenticated);

    // 3) 대상 테넌트 컨텍스트 설정 후 별도 트랜잭션으로 다운로드 → finally 정리
    // Resource(FileSystemResource) 는 컨트롤러 반환 후 스트리밍되지만 디스크 read 라 DB 컨텍스트 불요
    try {
      TenantContext.set(target.tenantId());
      FileContentResult c = fileService.downloadViaShareLink(target.driveFileId());
      HttpHeaders headers = new HttpHeaders();
      headers.setContentType(MediaType.parseMediaType(c.mimeType()));
      headers.setContentDisposition(
          ContentDisposition.attachment()
              .filename(c.originalName(), StandardCharsets.UTF_8)
              .build());
      headers.setContentLength(c.size());
      return ResponseEntity.ok().headers(headers).body(c.resource());
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * 퍼센트 인코딩된 비밀번호를 UTF-8 로 푼다. '+' 는 공백으로 바꾸지 않는다(URLDecoder 와 다름 — encodeURIComponent 와 짝). 시퀀스가
   * 깨져 있으면 원문을 그대로 돌려줘 비밀번호 불일치(401)로 끝나게 한다(400 으로 형식 오류를 드러내지 않음).
   */
  private static String decodePassword(String encoded) {
    try {
      return UriUtils.decode(encoded, StandardCharsets.UTF_8);
    } catch (IllegalArgumentException e) {
      return encoded;
    }
  }
}
