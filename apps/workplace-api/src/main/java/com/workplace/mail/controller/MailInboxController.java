package com.workplace.mail.controller;

import com.workplace.mail.dto.AttachmentCacheUsage;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.dto.MailSyncStatus;
import com.workplace.mail.dto.MailUnreadCounts;
import com.workplace.mail.dto.MarkAllReadRequest;
import com.workplace.mail.service.MailAttachmentMeteringService;
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
import org.springframework.web.bind.annotation.RequestBody;
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
  private final MailAttachmentMeteringService meteringService;

  /** 계정의 INBOX 를 증분 동기화(수동 트리거). */
  @PostMapping("/accounts/{accountId}/sync")
  public MailSyncResult sync(@AuthenticationPrincipal Long callerId, @PathVariable long accountId) {
    return syncService.sync(callerId, accountId);
  }

  /** 계정의 메시지 목록(폴더 INBOX/SENT, 최신순, 선택 검색어 query, #466 unread, P2 category/needsReply, limit). */
  @GetMapping("/accounts/{accountId}/messages")
  public List<EmailMessageSummary> messages(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long accountId,
      @RequestParam(required = false, defaultValue = "INBOX") String folder,
      @RequestParam(required = false) String query,
      @RequestParam(required = false, defaultValue = "false") boolean unread,
      @RequestParam(required = false) String category, // P2: 분류 필터(업무/개인/알림/프로모션/뉴스레터)
      @RequestParam(required = false, defaultValue = "false") boolean needsReply, // P2: 회신필요 필터
      @RequestParam(required = false, defaultValue = "0") int limit) {
    return messageService.list(
        callerId, accountId, folder, query, unread, category, needsReply, limit);
  }

  /** P2: 사이드바용 계정단위 회신필요 건수. */
  @GetMapping("/accounts/{accountId}/needs-reply-count")
  public NeedsReplyCount needsReplyCount(
      @AuthenticationPrincipal Long callerId, @PathVariable long accountId) {
    return new NeedsReplyCount(messageService.countNeedsReplyForAccount(callerId, accountId));
  }

  /** WP-186 사이드바용 계정 안 읽은 수(분류 버킷·받은편지함·회신필요) + AI 분류 활성 여부. */
  @GetMapping("/accounts/{accountId}/unread-counts")
  public MailUnreadCounts unreadCounts(
      @AuthenticationPrincipal Long callerId, @PathVariable long accountId) {
    return messageService.unreadCounts(callerId, accountId);
  }

  /** WP-186 모바일 탭 배지 — 모든 활성 계정의 업무 안 읽은 수 합. */
  @GetMapping("/unread-summary")
  public MailUnreadCounts.Summary unreadSummary(@AuthenticationPrincipal Long callerId) {
    return messageService.unreadSummary(callerId);
  }

  /** P2: 사이드바 카운트 응답 DTO. */
  public record NeedsReplyCount(long count) {}

  /**
   * 메시지 단건 상세(본문 + 첨부 메타). 본문 미적재면 OnDemand 로 적재 후 반환.
   *
   * <p>markSeen 기본 true(웹 열람). false 는 AI 조회용으로 읽음 처리를 생략한다(WP-147, 서비스 Javadoc 참조).
   */
  @GetMapping("/messages/{messageId}")
  public EmailMessageDetail message(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long messageId,
      @RequestParam(defaultValue = "true") boolean markSeen) {
    return messageService.get(callerId, messageId, markSeen);
  }

  /** WP-146: 명시적 읽음 처리(MCP mark_mail_read). 본인 메일이 아니면 404, 이미 읽었으면 그대로 200. */
  @PostMapping("/messages/{messageId}/read")
  public void markRead(@AuthenticationPrincipal Long callerId, @PathVariable long messageId) {
    messageService.markRead(callerId, messageId);
  }

  /** WP-187: 안읽음으로 표시. 본인 메일이 아니면 404, 이미 안 읽음이면 그대로 200. */
  @PostMapping("/messages/{messageId}/unread")
  public void markUnread(@AuthenticationPrincipal Long callerId, @PathVariable long messageId) {
    messageService.markUnread(callerId, messageId);
  }

  /** WP-187: 모두 읽음 확인용 — 지금 보기의 안 읽은 메일 수와 기준 시각(asOf). */
  @GetMapping("/accounts/{accountId}/messages/unread-count")
  public MailMessageService.UnreadInView unreadCountInView(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long accountId,
      @RequestParam(required = false) String category,
      @RequestParam(defaultValue = "false") boolean needsReply,
      @RequestParam(required = false) String query) {
    return messageService.unreadCountInView(callerId, accountId, category, needsReply, query);
  }

  /** WP-187: 모두 읽음 — 지금 보기 ∧ asOf 이전 도착 ∧ 안 읽음. */
  @PostMapping("/accounts/{accountId}/messages/mark-all-read")
  public MarkAllReadResponse markAllRead(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long accountId,
      @RequestBody MarkAllReadRequest req) {
    return new MarkAllReadResponse(messageService.markAllRead(callerId, accountId, req));
  }

  /** WP-187 모두 읽음 응답 — 실제로 읽음 처리된 메일 수. */
  public record MarkAllReadResponse(int updated) {}

  /** 계정 동기화 진행 상태(폴링용). */
  @GetMapping("/accounts/{accountId}/sync-status")
  public MailSyncStatus syncStatus(
      @AuthenticationPrincipal Long callerId, @PathVariable long accountId) {
    return messageService.syncStatus(callerId, accountId);
  }

  /** 첨부 캐시 사용량 메터링(물리/논리/blob 수). 쿼터 강제 없이 가시성만 제공. */
  @GetMapping("/attachment-cache/usage")
  public AttachmentCacheUsage attachmentCacheUsage(
      // callerId 는 인증 게이트 전용 — 메터링은 RLS 로 테넌트 전체 집계(사용자 스코프 아님).
      @AuthenticationPrincipal Long callerId) {
    return meteringService.currentTenantUsage();
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
