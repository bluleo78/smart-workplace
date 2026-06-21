package com.workplace.chat.controller;

import com.workplace.chat.service.ChatMessageService;
import com.workplace.file.service.FileUploadService;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 이슈 채팅 메시지에 첨부된 드라이브 파일 콘텐츠 다운로드 컨트롤러. messaging 의 MessageDriveLinkController 미러 — 경로만
 * /api/v1/chat 으로 대체. 스레드 멤버십 검증은 서비스 내 ensureMember 에서 수행하므로 @RequirePermission 미사용.
 */
@RestController
@RequestMapping("/api/v1/chat/threads/{threadId}/messages/{messageId}/drive-links")
@RequiredArgsConstructor
public class ChatMessageDriveLinkController {

  private final ChatMessageService messageService;

  /** 스레드 멤버가 메시지에 링크된 드라이브 파일을 다운로드한다. */
  @GetMapping("/{driveFileId}/content")
  public ResponseEntity<Resource> content(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long threadId,
      @PathVariable long messageId,
      @PathVariable long driveFileId)
      throws IOException {
    FileUploadService.FileContentResult f =
        messageService.driveLinkContent(callerId, threadId, messageId, driveFileId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(f.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.attachment().filename(f.originalName(), StandardCharsets.UTF_8).build());
    return ResponseEntity.ok().headers(headers).body(f.resource());
  }
}
