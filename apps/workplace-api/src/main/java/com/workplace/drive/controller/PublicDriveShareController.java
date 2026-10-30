package com.workplace.drive.controller;

import com.workplace.drive.dto.ShareInfoResponse;
import com.workplace.drive.dto.UnlockShareRequest;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveShareLinkService;
import com.workplace.drive.service.DriveShareLinkService.ResolvedTarget;
import com.workplace.drive.service.ShareViewTokens;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.filepreview.PreviewResponses;
import com.workplace.filepreview.service.FilePreviewService;
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

/**
 * 공유 링크 공개 경로(인증 불필요). 토큰 resolve → 컨텍스트 설정 → 기존 다운로드 경로.
 *
 * <p>WP-1227: 받는 화면이 바로 미리보기하도록 정보(GET {@code /share/{token}})·비밀번호 확인(POST {@code /unlock})·원본
 * inline({@code /content})·변환 PDF({@code /preview}) 를 더했다. 비밀번호 링크는 /unlock 이 준 열람 토큰을 {@value
 * #VIEW_TOKEN_HEADER} 헤더로 실어 이어 받는다. 공개 미리보기·다운로드는 감사를 새로 남기지 않는다(제품 결정).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/public/drive")
public class PublicDriveShareController {
  private final DriveShareLinkService shareLinks;
  private final DriveFileService fileService;
  private final FilePreviewService previewService;

  /** 열람 토큰 헤더(WP-1227). */
  static final String VIEW_TOKEN_HEADER = "X-Share-View-Token";

  /**
   * 공유 링크 정보(WP-1227) — 로그인 안내·비밀번호 카드·미리보기 중 무엇을 보일지. 시도 칸을 쓰지 않고, 속도 제한 비밀번호 버킷에도 넣지 않는다(비밀번호를 받지
   * 않으므로). 순서·필드는 {@link DriveShareLinkService#info} 참조.
   */
  @GetMapping("/share/{token}")
  public ResponseEntity<ShareInfoResponse> info(
      @PathVariable("token") String token,
      @RequestHeader(value = VIEW_TOKEN_HEADER, required = false) String viewToken) {
    return ResponseEntity.ok(
        shareLinks.info(token, viewToken, TenantContext.get(), requesterUserId()));
  }

  /**
   * 비밀번호 확인 → 열람 토큰(WP-1227). 틀리면 401, 잠기면 429(다운로드와 같은 잠금·시도 칸, WP-783). 속도 제한 비밀번호 정책 대상이다
   * (PublicRateLimitFilter).
   */
  @PostMapping("/share/{token}/unlock")
  public ResponseEntity<ShareViewTokens.ViewToken> unlock(
      @PathVariable("token") String token, @RequestBody(required = false) UnlockShareRequest req) {
    String password = req == null ? null : req.password();
    return ResponseEntity.ok(
        shareLinks.unlock(token, password, TenantContext.get(), requesterUserId() != null));
  }

  /**
   * 원본 inline(WP-1227) — 받는 화면 뷰어(이미지·PDF·텍스트 등)용. 비밀번호 링크는 유효한 열람 토큰만 받는다(비밀번호 헤더는 받지 않음, 칸도 안 씀).
   *
   * <p>공개 경로에서 남이 올린 HTML·SVG 를 inline 으로 내주므로, 이 출처의 스크립트로 실행되지 않게 {@code Content-Security-Policy:
   * sandbox} 를 붙이고(직접 열어도 고유 출처 없는 샌드박스) {@code nosniff} 로 MIME 추측 렌더링을 막는다.
   */
  @GetMapping("/share/{token}/content")
  public ResponseEntity<Resource> content(
      @PathVariable("token") String token,
      @RequestHeader(value = VIEW_TOKEN_HEADER, required = false) String viewToken)
      throws IOException {
    ResolvedTarget target =
        shareLinks.resolveForView(token, viewToken, TenantContext.get(), requesterUserId() != null);
    try {
      TenantContext.set(target.tenantId());
      FileContentResult c = fileService.downloadViaShareLink(target.driveFileId());
      HttpHeaders headers = new HttpHeaders();
      headers.setContentType(MediaType.parseMediaType(c.mimeType()));
      headers.setContentDisposition(
          ContentDisposition.inline().filename(c.originalName(), StandardCharsets.UTF_8).build());
      headers.setContentLength(c.size());
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Content-Security-Policy", "sandbox");
      return ResponseEntity.ok().headers(headers).body(c.resource());
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * 변환 PDF 미리보기(WP-1227) — HWP·오피스 문서. 인증 규칙은 /content 와 같고, 응답 계약(200·202·422·404)은 드라이브 미리보기와 같은
   * {@link PreviewResponses} 를 그대로 쓴다.
   *
   * @param start 시도의 첫 요청이면 true — 이때만 실패 행을 다시 선점한다. 폴링은 false
   */
  @GetMapping("/share/{token}/preview")
  public ResponseEntity<?> preview(
      @PathVariable("token") String token,
      @RequestHeader(value = VIEW_TOKEN_HEADER, required = false) String viewToken,
      @RequestParam(defaultValue = "false") boolean start) {
    ResolvedTarget target =
        shareLinks.resolveForView(token, viewToken, TenantContext.get(), requesterUserId() != null);
    try {
      // 변환 서비스는 요청 스레드의 활성 테넌트로 동작한다 — 링크 워크스페이스로 세운다.
      TenantContext.set(target.tenantId());
      long fileId = fileService.coreFileIdViaShareLink(target.driveFileId());
      return PreviewResponses.of(previewService.open(fileId, start));
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * 공유 토큰으로 파일 다운로드.
   *
   * <p>2-트랜잭션 패턴: ① resolve(SECURITY DEFINER 함수, RLS 무관) → ② 대상 테넌트 컨텍스트 설정 후 별도 tx 다운로드.
   *
   * <p>비밀번호는 X-Share-Password 요청 헤더로 전달 — URL 쿼리 문자열에 포함 시 브라우저 히스토리/Referer 헤더에 노출될 수 있으므로 헤더로 이동.
   * 브라우저는 헤더에 비ASCII(한글 등)를 넣을 수 없어, 웹은 UTF-8 퍼센트 인코딩한 X-Share-Password-Encoded 를 보낸다(WP-528) — 있으면
   * 그것을 풀어 쓰고, 없으면 X-Share-Password 원문을 쓴다(구 클라이언트·외부 호출 호환).
   *
   * <p>WP-1227: 유효한 열람 토큰({@value #VIEW_TOKEN_HEADER})이 있으면 비밀번호 검증을 건너뛴다(링크 가드는 그대로).
   */
  @GetMapping("/share/{token}/download")
  public ResponseEntity<Resource> download(
      @PathVariable("token") String token,
      @RequestHeader(value = "X-Share-Password", required = false) String rawPassword,
      @RequestHeader(value = "X-Share-Password-Encoded", required = false) String encodedPassword,
      @RequestHeader(value = VIEW_TOKEN_HEADER, required = false) String viewToken)
      throws IOException {
    String password = encodedPassword != null ? decodePassword(encodedPassword) : rawPassword;
    // 1) 요청자 컨텍스트 스냅샷(INTERNAL 검증용) — JwtAuthenticationFilter 가 인증 시 채워둠.
    Long requesterTenant = TenantContext.get();
    boolean authenticated = requesterUserId() != null;

    // 2) resolve(함수, RLS 무관) + 가드
    ResolvedTarget target =
        shareLinks.resolveForDownload(token, password, viewToken, requesterTenant, authenticated);

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

  /** 로그인 요청자의 사용자 id — JwtAuthenticationFilter 가 유효한 Bearer 일 때 principal(Long)로 채운다. 비로그인 null. */
  private static Long requesterUserId() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    return auth != null && auth.isAuthenticated() && auth.getPrincipal() instanceof Long id
        ? id
        : null;
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
