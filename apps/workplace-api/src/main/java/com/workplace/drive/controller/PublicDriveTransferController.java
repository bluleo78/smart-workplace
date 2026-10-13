package com.workplace.drive.controller;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.repository.DriveTransferLinkRepository.TransferLinkRow;
import com.workplace.drive.service.DriveTransferLinkService;
import com.workplace.drive.service.DriveTransferLinkService.ReceivedBody;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.ClientIpExtractor;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

/**
 * 드라이브 전송 링크 공개 엔드포인트(WP-369, 인증 불필요) — GET 다운로드·PUT 업로드. 토큰이 곧 권한(capability URL)이고 한 번만 쓸 수 있다.
 *
 * <p>공유 링크 공개 다운로드({@link PublicDriveShareController})처럼 컨트롤러가 TenantContext 를 직접 설정하고 finally 에서
 * 지운다. 컨트롤러에는 {@code @Transactional} 을 달지 않는다 — 소비(UPDATE)는 트랜잭션 밖에서 바로 커밋되고, 파일 읽기는 컨텍스트 설정 뒤 별도
 * 트랜잭션이어야 테넌트 GUC 가 주입된다. 토큰 원문은 로그에 남기지 않는다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/public/drive/transfer")
public class PublicDriveTransferController {
  private final DriveTransferLinkService transfers;

  /**
   * 다운로드 — 링크를 원자적으로 소비한 뒤(재사용 410) 발급자 권한을 다시 확인하고 첨부(attachment)로 내려보낸다.
   *
   * <p>{@code X-Content-Type-Options: nosniff} 로 브라우저가 내용을 보고 MIME 을 바꿔 렌더링하지 않게 하고, 일회용이라 중간 캐시가
   * 저장하지 않게 {@code no-store} 를 붙인다.
   */
  @GetMapping("/{token}")
  public ResponseEntity<Resource> download(
      @PathVariable("token") String token, HttpServletRequest request) throws IOException {
    TransferLinkRow link = transfers.consume(token, DriveTransferLinkService.KIND_DOWNLOAD);
    // 소비는 이미 커밋됐다. 대상 테넌트 컨텍스트에서 별도 트랜잭션으로 권한 재확인·읽기 → finally 정리.
    // 본문 스트림은 반환 뒤 흘려보내지만 디스크 read 라 DB 컨텍스트가 필요 없다.
    try {
      TenantContext.set(link.tenantId());
      FileContentResult c =
          transfers.openDownloadAsIssuer(
              link, ClientIpExtractor.extract(request), request.getHeader(HttpHeaders.USER_AGENT));
      HttpHeaders headers = new HttpHeaders();
      headers.setContentType(MediaType.parseMediaType(c.mimeType()));
      headers.setContentDisposition(
          ContentDisposition.attachment()
              .filename(c.originalName(), StandardCharsets.UTF_8)
              .build());
      headers.setContentLength(c.size());
      headers.set("X-Content-Type-Options", "nosniff");
      headers.setCacheControl(CacheControl.noStore());
      // 범위 요청(Range)을 무시하고 늘 전체를 보낸다 — Spring 은 Resource 본문에 Accept-Ranges 를 광고하고 Range 가 오면 206
      // 일부만 보내는데, 일회용 링크는 첫 GET 이 소비하므로 다운로드 관리자·이어받기의 범위 탐색(bytes=0-0)이 1바이트만 받고 링크를
      // 태운다. InputStreamResource 는 Spring 의 범위 처리 대상에서 빠진다(Content-Length 는 위에서 명시).
      return ResponseEntity.ok()
          .headers(headers)
          .body(new InputStreamResource(c.resource().getInputStream()));
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * 업로드 — 원시 바이트 본문({@code curl -T 파일 URL})을 링크에 묶인 이름·폴더로 저장한다(같은 이름이면 새 버전). 파일 지정 링크(발급 때 {@code
   * drive_file_id} 를 묶은 링크)는 이름으로 찾지 않고 그 파일 ID 에 새 버전을 더한다. 201 + DriveFileResponse.
   *
   * <p>순서(R2): 토큰·만료·본문 형식·선언 크기 확인 → 원자적 소비(트랜잭션 밖) → TenantContext 설정 → 발급자 EDITOR 재확인 → 본문을 세는
   * 상한으로 임시 파일에 받기(DB 연결·테넌트 lock 없음) → 업로드 공통 핵심(lock → 할당량 → 새 버전 또는 새 파일 → 감사 → 추출 → 알림) →
   * finally 에서 임시 파일·컨텍스트 정리. 테넌트 advisory lock 은 네트워크 전송이 끝난 뒤에만 잡는다.
   */
  @PutMapping("/{token}")
  public ResponseEntity<DriveFileResponse> upload(
      @PathVariable("token") String token, HttpServletRequest request) throws IOException {
    String contentType = request.getContentType();
    TransferLinkRow link =
        transfers.consumeUpload(token, contentType, request.getContentLengthLong());
    try {
      TenantContext.set(link.tenantId());
      transfers.requireIssuerCanUpload(link);
      try (ReceivedBody body = transfers.receiveBody(link, request.getInputStream(), contentType)) {
        DriveFileResponse saved =
            transfers.completeUpload(
                link,
                body,
                ClientIpExtractor.extract(request),
                request.getHeader(HttpHeaders.USER_AGENT));
        return ResponseEntity.status(HttpStatus.CREATED).body(saved);
      }
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * HEAD 는 405 — Spring 은 {@code @GetMapping} 으로 HEAD 를 암묵 처리하는데, 그러면 링크 미리보기(메신저·메일의 URL 확인)가 보내는
   * HEAD 가 일회용 링크를 소비해 버린다. 명시 HEAD 매핑이 암묵 매핑보다 우선한다. 이 경로가 받는 메서드는 GET(다운로드 링크)·PUT(업로드 링크)이다.
   */
  @RequestMapping(value = "/{token}", method = RequestMethod.HEAD)
  public ResponseEntity<Void> head(@PathVariable("token") String token) {
    return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
        .header(HttpHeaders.ALLOW, "GET, PUT")
        .build();
  }
}
