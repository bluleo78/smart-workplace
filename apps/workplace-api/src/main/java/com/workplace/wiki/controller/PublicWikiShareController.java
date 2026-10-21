package com.workplace.wiki.controller;

import com.workplace.global.tenant.TenantContext;
import com.workplace.wiki.dto.WikiPublicShareResponse;
import com.workplace.wiki.service.WikiPublicShareService;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 노트 외부(비로그인) 공유 보기 API(WP-579) — 웹 {@code api/wikiPublic.ts} 와 짝. 인증 없이 토큰으로 연다(SecurityConfig
 * permitAll, capability URL). 로그인한 사용자는 이 경로를 쓰지 않는다(웹 입구가 로그인 경로로 보낸다).
 *
 * <p>2-트랜잭션 패턴({@code PublicDriveShareController} 와 같다): ① 서비스가 SECURITY DEFINER 함수로 토큰의 워크스페이스를
 * 찾고(트랜잭션 밖) ② 여기서 그 워크스페이스로 {@link TenantContext} 를 세운 뒤 ③ 서비스의 트랜잭션 메서드를 부른다 — 트랜잭션 시작 때 GUC 가 그
 * 테넌트로 들어간다. 끝나면 컨텍스트를 요청 전 값으로 되돌린다.
 *
 * <p>성공·실패 응답 모두 검색 제외({@code X-Robots-Tag: noindex, nofollow})·캐시 금지({@code Cache-Control:
 * no-store}) — 링크가 곧 권한이라 검색엔진·공용 캐시에 남으면 해제해도 내용이 남는다. 오류 응답에도 실리도록 처리 전에 응답에 직접 단다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/public/wiki/shares")
public class PublicWikiShareController {
  private final WikiPublicShareService service;

  /**
   * 외부 보기 — 볼 수 있는 페이지 트리와 지금 페이지(가린 본문). 만료 전 내부 링크는 401 {@code {loginRequired:true}}, 그 밖의 열 수
   * 없음은 404.
   *
   * @param pageId 공유된 하위 페이지로 이동할 때(없으면 공유한 페이지)
   */
  @GetMapping("/{token}")
  public ResponseEntity<WikiPublicShareResponse> view(
      @PathVariable("token") String token,
      @RequestParam(value = "pageId", required = false) Long pageId,
      HttpServletResponse response) {
    noIndexNoStore(response);
    long tenantId = service.locateTenant(token);
    return ResponseEntity.ok(
        TenantContext.callAs(tenantId, () -> service.view(tenantId, token, pageId)));
  }

  /** 외부 보기 본문 이미지 — 공유 범위 안 페이지에 붙은 첨부만(아니면 404). 본문 &lt;img&gt; 가 직접 부르므로 inline. */
  @GetMapping("/{token}/pages/{pageId}/attachments/{fileId}")
  public ResponseEntity<Resource> attachment(
      @PathVariable("token") String token,
      @PathVariable("pageId") long pageId,
      @PathVariable("fileId") long fileId,
      HttpServletResponse response) {
    noIndexNoStore(response);
    long tenantId = service.locatePublicTenant(token);
    var f = TenantContext.callAs(tenantId, () -> service.attachment(token, pageId, fileId));
    // Resource 는 컨트롤러 반환 뒤 스트리밍되지만 디스크 읽기라 DB·테넌트 컨텍스트가 필요 없다.
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(f.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.inline().filename(f.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(f.sizeBytes());
    return ResponseEntity.ok().headers(headers).body(new FileSystemResource(f.path()));
  }

  private static void noIndexNoStore(HttpServletResponse response) {
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
  }
}
