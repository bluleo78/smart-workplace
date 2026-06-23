package com.workplace.mail.controller;

import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.dto.MailSyncStatus;
import com.workplace.mail.service.MailAttachmentService;
import com.workplace.mail.service.MailAttachmentService.AttachmentDownload;
import com.workplace.mail.service.MailMessageService;
import com.workplace.mail.service.MailSyncService;
import java.nio.charset.StandardCharsets;
import java.util.List;
import lombok.RequiredArgsConstructor;
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

/**
 * 받은편지함 동기화·읽기 REST. 모든 엔드포인트는 @AuthenticationPrincipal callerId(=본인) 스코프 — 본인 소유 계정/메시지만 다룬다(아니면
 * 404). 읽기 전용.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/mail")
public class MailInboxController {

  private final MailSyncService syncService;
  private final MailMessageService messageService;
  private final MailAttachmentService attachmentService;

  /** 계정의 INBOX 를 증분 동기화(수동 트리거). */
  @PostMapping("/accounts/{accountId}/sync")
  public MailSyncResult sync(@AuthenticationPrincipal Long callerId, @PathVariable long accountId) {
    return syncService.sync(callerId, accountId);
  }

  /** 계정의 메시지 목록(폴더 INBOX/SENT, 최신순, 선택 검색어 query, #466 unread, limit). */
  @GetMapping("/accounts/{accountId}/messages")
  public List<EmailMessageSummary> messages(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long accountId,
      @RequestParam(required = false, defaultValue = "INBOX") String folder,
      @RequestParam(required = false) String query,
      @RequestParam(required = false, defaultValue = "false") boolean unread,
      @RequestParam(required = false, defaultValue = "0") int limit) {
    return messageService.list(callerId, accountId, folder, query, unread, limit);
  }

  /** 메시지 단건 상세(본문 + 첨부 메타). 본문 미적재면 OnDemand 로 적재 후 반환. */
  @GetMapping("/messages/{messageId}")
  public EmailMessageDetail message(
      @AuthenticationPrincipal Long callerId, @PathVariable long messageId) {
    return messageService.get(callerId, messageId);
  }

  /** 계정 동기화 진행 상태(폴링용). */
  @GetMapping("/accounts/{accountId}/sync-status")
  public MailSyncStatus syncStatus(
      @AuthenticationPrincipal Long callerId, @PathVariable long accountId) {
    return messageService.syncStatus(callerId, accountId);
  }

  /**
   * 첨부 파일 바이너리 다운로드. IMAP 에서 파트를 재조회해 Content-Disposition: attachment 로 반환한다. 소유 검증 포함 — 타인 첨부면
   * 404. 한글 파일명은 RFC 5987(filename*=UTF-8'') 으로 인코딩해 클라이언트가 올바르게 표시하도록 한다.
   */
  @GetMapping("/attachments/{attachmentId}/content")
  public ResponseEntity<byte[]> downloadAttachment(
      @AuthenticationPrincipal Long callerId, @PathVariable long attachmentId) {
    AttachmentDownload result = attachmentService.download(callerId, attachmentId);

    MediaType mediaType;
    try {
      mediaType = MediaType.parseMediaType(result.contentType());
    } catch (Exception e) {
      mediaType = MediaType.APPLICATION_OCTET_STREAM;
    }

    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(mediaType);
    headers.setContentDisposition(
        ContentDisposition.attachment()
            .filename(result.filename(), StandardCharsets.UTF_8)
            .build());
    headers.setContentLength(result.content().length);

    return ResponseEntity.ok().headers(headers).body(result.content());
  }
}
