package com.workplace.file.controller;

import com.workplace.file.dto.StagedFileResponse;
import com.workplace.file.repository.StagedUploadLinkRepository.StagedLinkRow;
import com.workplace.file.service.StagedUploadService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.BoundedBody;
import com.workplace.global.util.ClientIpExtractor;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

/**
 * 스테이징 업로드 링크 공개 엔드포인트(WP-421, 인증 불필요) — 원시 바이트 PUT. 토큰이 곧 권한(capability URL)이고 한 번만 쓸 수 있다.
 *
 * <p>드라이브 전송 링크({@code PublicDriveTransferController})처럼 컨트롤러가 TenantContext 를 직접 설정하고 finally 에서
 * 지운다. 컨트롤러에는 {@code @Transactional} 을 달지 않는다 — 소비(UPDATE)는 트랜잭션 밖에서 바로 커밋되고, 재확인·저장은 컨텍스트 설정 뒤 별도
 * 트랜잭션이어야 테넌트 GUC 가 주입된다. 리포지토리를 주입하지 않는다. 토큰 원문은 로그에 남기지 않는다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/public/staged-files")
public class PublicStagedUploadController {
  private final StagedUploadService staged;

  /**
   * 업로드 — 원시 바이트 본문({@code curl -T 파일 URL})을 링크에 묶인 이름으로 발급자의 임시 첨부로 저장한다. 201 +
   * StagedFileResponse.
   *
   * <p>순서: 토큰·만료·본문 형식·선언 크기 확인 → 원자적 소비(트랜잭션 밖) → TenantContext 설정 → 발급자 멤버십 재확인 → 본문을 세는 상한으로 임시
   * 파일에 받기(DB 연결 없음) → 저장·FILE INSERT·사용 감사(한 트랜잭션) → finally 에서 임시 파일·컨텍스트 정리.
   */
  @PutMapping("/{token}")
  public ResponseEntity<StagedFileResponse> upload(
      @PathVariable("token") String token, HttpServletRequest request) throws IOException {
    String contentType = request.getContentType();
    StagedLinkRow link = staged.consumeUpload(token, contentType, request.getContentLengthLong());
    try {
      TenantContext.set(link.tenantId());
      staged.requireIssuerActive(link);
      try (BoundedBody.Received body =
          staged.receiveBody(link, request.getInputStream(), contentType)) {
        StagedFileResponse saved =
            staged.completeUpload(
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
   * HEAD 는 405 이고 링크를 소비하지 않는다 — 링크 미리보기(메신저·메일의 URL 확인)가 일회용 링크를 건드리지 않게 명시해 둔다. 이 경로가 받는 메서드는 PUT
   * 뿐이다.
   */
  @RequestMapping(value = "/{token}", method = RequestMethod.HEAD)
  public ResponseEntity<Void> head(@PathVariable("token") String token) {
    return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
        .header(HttpHeaders.ALLOW, "PUT")
        .build();
  }
}
