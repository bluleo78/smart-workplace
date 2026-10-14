package com.workplace.messaging.controller;

import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.service.AttachmentViewService;
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

  private final AttachmentViewService attachmentView;

  public MessageAttachmentController(
      MessageAttachmentService service, AttachmentViewService attachmentView) {
    this.service = service;
    this.attachmentView = attachmentView;
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

  /**
   * 첨부 추출 텍스트 구간 읽기(WP-358) — 이슈 첨부 /text 와 같은 응답({@link ExtractedTextSlice}). limit 상한 32,000자(초과는
   * 클램프). 권한은 /content 와 같다(채널 멤버만).
   */
  @GetMapping("/channels/{id}/messages/{msgId}/attachments/{fileId}/text")
  public ResponseEntity<ExtractedTextSlice> readText(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @PathVariable("msgId") long messageId,
      @PathVariable long fileId,
      @RequestParam(defaultValue = "0") int offset,
      @RequestParam(defaultValue = "32000") int limit) {
    return ResponseEntity.ok(
        service.readText(callerId, channelId, messageId, fileId, offset, limit));
  }

  /** 첨부를 모델 입력용 이미지로 보여 준다(WP-250) — 규칙·권한·트랜잭션(R5)은 {@link AttachmentViewService} 참조. */
  @GetMapping("/channels/{id}/messages/{msgId}/attachments/{fileId}/view")
  public ResponseEntity<byte[]> view(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @PathVariable("msgId") long messageId,
      @PathVariable long fileId,
      @RequestParam(required = false) Integer page) {
    return attachmentView.respond(
        service.resolveViewFileId(callerId, channelId, messageId, fileId), page);
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
