package com.workplace.messaging.controller;

import com.workplace.file.service.FileUploadService;
import com.workplace.fileai.security.FileSecurityCheckService;
import com.workplace.fileai.security.dto.SecurityCheckView;
import com.workplace.filepreview.PreviewResponses;
import com.workplace.filepreview.service.FilePreviewService;
import com.workplace.messaging.service.MessageService;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/**
 * 메시지에 첨부된 드라이브 파일 콘텐츠 다운로드 컨트롤러. 채널 멤버십이 다운로드 인가 기준이므로 별도 @RequirePermission 없이 서비스 내 ensureMember
 * 로 검증.
 */
@RestController
@RequestMapping("/api/v1/messaging/channels/{channelId}/messages/{messageId}/drive-links")
@RequiredArgsConstructor
public class MessageDriveLinkController {

  private final MessageService messageService;

  private final FileSecurityCheckService securityChecks;

  private final FilePreviewService previewService;

  /** 채널 멤버가 메시지에 링크된 드라이브 파일을 다운로드한다. */
  @GetMapping("/{driveFileId}/content")
  public ResponseEntity<Resource> content(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long channelId,
      @PathVariable long messageId,
      @PathVariable long driveFileId)
      throws IOException {
    FileUploadService.FileContentResult f =
        messageService.driveLinkContent(callerId, channelId, messageId, driveFileId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(f.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.attachment().filename(f.originalName(), StandardCharsets.UTF_8).build());
    return ResponseEntity.ok().headers(headers).body(f.resource());
  }

  /**
   * 링크된 드라이브 파일의 문서 미리보기(서버 변환 PDF, WP-1457) — /content 와 같은 채널 읽기 가드·메시지 소속·링크 확인으로 core file id 를
   * 얻는다. 응답 계약은 {@link PreviewResponses}(드라이브와 같음).
   *
   * @param start 시도의 첫 요청이면 true — 이때만 실패 행을 다시 선점한다. 폴링은 생략
   */
  @GetMapping("/{driveFileId}/preview")
  public ResponseEntity<?> preview(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long channelId,
      @PathVariable long messageId,
      @PathVariable long driveFileId,
      @RequestParam(defaultValue = "false") boolean start) {
    long fileId = messageService.driveLinkFileId(callerId, channelId, messageId, driveFileId);
    return PreviewResponses.of(previewService.open(fileId, start));
  }

  /** 링크된 드라이브 파일의 HTML 보안 점검 상태(WP-1262) — /content 와 같은 채널 읽기 가드·메시지 소속·링크 확인. */
  @GetMapping("/{driveFileId}/security-check")
  public SecurityCheckView securityCheck(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long channelId,
      @PathVariable long messageId,
      @PathVariable long driveFileId) {
    return securityChecks.view(
        messageService.driveLinkFileId(callerId, channelId, messageId, driveFileId));
  }

  /** 링크된 드라이브 파일의 HTML 보안 점검 요청(WP-1262) — 가드는 조회와 같다. */
  @PostMapping("/{driveFileId}/security-check")
  public SecurityCheckView requestSecurityCheck(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long channelId,
      @PathVariable long messageId,
      @PathVariable long driveFileId) {
    return securityChecks.request(
        messageService.driveLinkFileId(callerId, channelId, messageId, driveFileId));
  }
}
