package com.workplace.drive.controller;

import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.service.DrivePlaybackService;
import com.workplace.drive.service.DrivePlaybackTokens;
import com.workplace.drive.service.DrivePlaybackTokens.Claims;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantStatusChecker;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.InvalidMediaTypeException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * 드라이브 재생 공개 경로(WP-1532, JWT 인증 없음) — 봉인 재생 주소로 영상·오디오를 Range(206)로 내준다. 토큰이 곧 권한이다.
 *
 * <p>{@code <video src>} 는 헤더를 실을 수 없어 토큰을 경로에 둔다. 매 요청: 봉인(변조)·만료 확인 → 테넌트 활성 확인 → TenantContext 를
 * 토큰의 테넌트로 세우고 별도 트랜잭션에서 파일 상태·버전·권한 재확인({@link DrivePlaybackService#open}) → finally 에서 컨텍스트 정리.
 * 실패는 모두 같은 404 다. 감사는 발급 때 한 번만 남기므로 여기서는 남기지 않는다(범위 요청이 영상 하나에 수십 번 온다).
 *
 * <p>범위 처리는 스프링에 맡긴다 — 상태 200 의 {@code ResponseEntity<Resource>}(FileSystemResource) 이면 Range 요청에
 * 206 과 Content-Range 로 그 부분만 보내고 {@code Accept-Ranges: bytes} 를 붙인다. 그래서 Content-Length 를 직접 넣지
 * 않는다(부분 응답 길이와 어긋난다). iOS Safari 는 영상에 206 을 요구한다. HEAD 는 스프링이 같은 GET 으로 처리하며 부수 효과가 없다.
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class PublicDrivePlaybackController {
  private final DrivePlaybackTokens tokens;
  private final DrivePlaybackService playback;
  private final TenantStatusChecker tenantStatusChecker;

  /**
   * 재생 본문.
   *
   * <p>헤더: inline + nosniff(브라우저가 내용을 보고 MIME 을 바꾸지 않게) + {@code Content-Security-Policy:
   * sandbox}(직접 열어도 이 출처 스크립트로 돌지 않게) + {@code Cache-Control: private, no-store}(공유 캐시·디스크에 남기지 않는다
   * — 탐색은 범위 요청으로 다시 받으면 되고, 권한을 잃은 뒤 캐시에서 다시 보이지 않게).
   */
  @GetMapping(DrivePlaybackService.PUBLIC_PATH + "{token}")
  public ResponseEntity<Resource> stream(@PathVariable("token") String token) throws IOException {
    Claims claims =
        tokens
            .verify(token)
            .filter(c -> tenantStatusChecker.isActive(c.tenantId()))
            .orElseThrow(() -> new DriveFileNotFoundException(0L));
    try {
      TenantContext.set(claims.tenantId());
      FileContentResult c = playback.open(claims);
      HttpHeaders headers = new HttpHeaders();
      headers.setContentType(mediaTypeOrNotFound(c.mimeType()));
      headers.setContentDisposition(
          ContentDisposition.inline().filename(c.originalName(), StandardCharsets.UTF_8).build());
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Content-Security-Policy", "sandbox");
      headers.setCacheControl(CacheControl.noStore().cachePrivate());
      // 본문은 반환 뒤 흘려보내지만 디스크 read 라 DB·테넌트 컨텍스트가 필요 없다.
      return ResponseEntity.ok().headers(headers).body(c.resource());
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * 저장된 MIME 을 응답 형식으로 — 형식 목록은 통과했지만 파라미터가 깨진 값(예: {@code video/mp4; a="})이면 같은 404 로 돌리고 서버 로그에만
   * 남긴다. 공개 경로라 500 과 그 사정을 내보내지 않는다.
   */
  private static MediaType mediaTypeOrNotFound(String mime) {
    try {
      return MediaType.parseMediaType(mime);
    } catch (InvalidMediaTypeException e) {
      log.warn("재생 응답 형식 해석 실패 — mime={}", mime);
      throw new DriveFileNotFoundException(0L);
    }
  }
}
