package com.workplace.messaging.controller;

import com.workplace.messaging.repository.MessageAttachmentRepository;
import com.workplace.messaging.service.MessageAttachmentService;
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

/** 메시지 첨부 선업로드 + 다운로드. 멤버십은 서비스에서 검증(이슈와 달리 @RequirePermission 미사용 — messaging 관례). */
@RestController
@RequestMapping("/api/v1/messaging")
public class MessageAttachmentController {

  private final MessageAttachmentService service;

  public MessageAttachmentController(MessageAttachmentService service) {
    this.service = service;
  }

  /** 선업로드 → fileId 메타 목록. 이후 메시지 전송 시 fileIds 로 바인딩. */
  @PostMapping(value = "/channels/{id}/attachments", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ResponseEntity<List<MessageAttachmentService.UploadedFile>> upload(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @RequestParam("files") List<MultipartFile> files)
      throws IOException {
    return ResponseEntity.ok(service.upload(callerId, channelId, files));
  }

  /** 다운로드(스트리밍). 채널 멤버만 허용. */
  @GetMapping("/channels/{id}/messages/{msgId}/attachments/{fileId}/content")
  public ResponseEntity<Resource> download(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @PathVariable("msgId") long messageId,
      @PathVariable Long fileId) {
    MessageAttachmentRepository.StoredFileRow f =
        service.download(callerId, channelId, messageId, fileId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(f.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.attachment().filename(f.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(f.sizeBytes());
    return ResponseEntity.ok().headers(headers).body(new FileSystemResource(f.path()));
  }
}
