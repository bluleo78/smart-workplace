package com.workplace.chat.controller;

import com.workplace.chat.repository.ChatMessageAttachmentRepository;
import com.workplace.chat.service.ChatMessageAttachmentService;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * 이슈 채팅 스레드 첨부 업로드/다운로드 컨트롤러. messaging 의 MessageAttachmentController 미러 — 경로만 /api/v1/chat 으로 대체.
 * 멤버십 검증은 서비스에서 수행하므로 @RequirePermission 미사용.
 */
@RestController
@RequestMapping("/api/v1/chat")
public class ChatMessageAttachmentController {

  private final ChatMessageAttachmentService service;

  public ChatMessageAttachmentController(ChatMessageAttachmentService service) {
    this.service = service;
  }

  /** 선업로드 → fileId 메타 목록. 이후 메시지 전송 시 fileIds 에 포함해 바인딩. */
  @PostMapping(value = "/threads/{id}/attachments", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ResponseEntity<List<ChatMessageAttachmentService.UploadedFile>> upload(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long threadId,
      @RequestParam("files") List<MultipartFile> files)
      throws IOException {
    return ResponseEntity.ok(service.upload(callerId, threadId, files));
  }

  /** 다운로드(스트리밍). 스레드 멤버만 허용. 교차 스레드 접근 시 4xx 반환. */
  @GetMapping("/threads/{id}/messages/{msgId}/attachments/{fileId}/content")
  public ResponseEntity<Resource> download(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long threadId,
      @PathVariable("msgId") long messageId,
      @PathVariable Long fileId) {
    ChatMessageAttachmentRepository.StoredFileRow f =
        service.download(callerId, threadId, messageId, fileId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(f.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.attachment().filename(f.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(f.sizeBytes());
    return ResponseEntity.ok().headers(headers).body(new FileSystemResource(f.path()));
  }
}
