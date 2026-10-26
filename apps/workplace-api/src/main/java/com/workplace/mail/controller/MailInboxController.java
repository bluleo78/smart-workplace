package com.workplace.mail.controller;

import com.workplace.fileai.controller.ViewImageResponses;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.filepreview.PreviewResponses;
import com.workplace.mail.dto.AttachmentCacheUsage;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailFolderResponse;
import com.workplace.mail.dto.MailFolderSyncResult;
import com.workplace.mail.dto.MailListCursor;
import com.workplace.mail.dto.MailMoveRequest;
import com.workplace.mail.dto.MailMoveResponse;
import com.workplace.mail.dto.MailOlderResult;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.dto.MailSyncStatus;
import com.workplace.mail.dto.MailUnreadCounts;
import com.workplace.mail.dto.MarkAllReadRequest;
import com.workplace.mail.service.MailAttachmentMeteringService;
import com.workplace.mail.service.MailAttachmentPreviewService;
import com.workplace.mail.service.MailAttachmentService;
import com.workplace.mail.service.MailAttachmentService.AttachmentDownload;
import com.workplace.mail.service.MailAttachmentTextService;
import com.workplace.mail.service.MailAttachmentViewService;
import com.workplace.mail.service.MailMessageService;
import com.workplace.mail.service.MailSyncService;
import com.workplace.mail.service.folder.MailFolderService;
import com.workplace.mail.service.move.MailMoveService;
import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
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
  private final MailAttachmentTextService attachmentTextService;
  private final MailAttachmentViewService attachmentViewService;
  private final MailAttachmentPreviewService attachmentPreviewService;
  private final MailFolderService folderService;
  private final MailMoveService moveService;

  /** 계정의 INBOX 를 증분 동기화(수동 트리거). */
  @PostMapping("/accounts/{accountId}/sync")
  public MailSyncResult sync(@AuthenticationPrincipal Long callerId, @PathVariable long accountId) {
    return syncService.sync(callerId, accountId);
  }

  /**
   * WP-960 계정의 서버 메일함(보관·사용자 폴더) 목록 — 사이드바 트리용. 보관 먼저, 그다음 이름순. 서버에 접속하지 않고 마지막 동기화 때 저장한 목록을 읽는다.
   * 내 계정이 아니면 404.
   */
  @GetMapping("/accounts/{accountId}/folders")
  public List<MailFolderResponse> folders(
      @AuthenticationPrincipal Long callerId, @PathVariable long accountId) {
    return folderService.list(callerId, accountId);
  }

  /**
   * WP-960 서버 메일함 한 개의 메일 가져오기. older=true 면 이미 가져온 기간 앞의 90일을 더 받는다. 보관·사용자 메일함만(받은편지함·보낸편지함·묶음
   * 메일함은 400), 내 계정·계정 메일함이 아니면 404. 같은 메일함을 이미 가져오는 중이면 running=true 로 바로 돌아온다. 네트워크 I/O 동안 DB 연결을
   * 잡지 않게 트랜잭션을 걸지 않는다(서비스가 짧은 트랜잭션으로 나눈다).
   */
  @PostMapping("/accounts/{accountId}/folders/{folderId}/sync")
  public MailFolderSyncResult syncFolder(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long accountId,
      @PathVariable long folderId,
      @RequestParam(defaultValue = "false") boolean older) {
    return folderService.syncFolder(callerId, accountId, folderId, older);
  }

  /**
   * WP-962 메일 옮기기 — 보관·받은편지함·내 메일함으로 옮기기와 삭제(서버 휴지통으로 옮기기, 영구 삭제 아님)를 메일 서버에도 반영한다. 1~100통, 모두 이 계정
   * 메일이어야 한다(아니면 404). 보낸편지함(앱에서 보낸 기록)은 400. 메일별 결과를 돌려주며 실패한 메일은 그대로 남는다. 실행 취소는 웹이 요청을 미루는 방식이라
   * 되돌리기 정보는 없다. 서버 I/O 동안 DB 연결을 잡지 않게 트랜잭션을 걸지 않는다(서비스가 짧은 트랜잭션으로 나눈다).
   */
  @PostMapping("/accounts/{accountId}/messages/move")
  public MailMoveResponse move(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long accountId,
      @Valid @RequestBody MailMoveRequest req) {
    return moveService.move(callerId, accountId, req);
  }

  /**
   * 계정의 메시지 목록(폴더 INBOX/SENT, 최신순, 선택 검색어 query, #466 unread, P2 category/needsReply, limit).
   * WP-965: beforeId(와 beforeAt)가 있으면 그 행 다음 페이지 — 앞 페이지 마지막 행의 id·receivedAt 을 그대로 넘긴다(receivedAt
   * 이 없는 행이면 beforeAt 생략).
   */
  @GetMapping("/accounts/{accountId}/messages")
  public List<EmailMessageSummary> messages(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long accountId,
      @RequestParam(required = false, defaultValue = "INBOX") String folder,
      @RequestParam(required = false) Long folderId, // WP-960: 서버 메일함 id(있으면 folder·분류·회신필요 무시)
      @RequestParam(required = false) String query,
      @RequestParam(required = false, defaultValue = "false") boolean unread,
      @RequestParam(required = false) String category, // P2: 분류 필터(업무/개인/알림/프로모션/뉴스레터)
      @RequestParam(required = false, defaultValue = "false") boolean needsReply, // P2: 회신필요 필터
      @RequestParam(required = false) Instant beforeAt, // WP-965: 다음 페이지 커서 — 마지막 행 수신 시각
      @RequestParam(required = false) Long beforeId, // WP-965: 다음 페이지 커서 — 마지막 행 id
      @RequestParam(required = false, defaultValue = "0") int limit) {
    MailListCursor cursor = beforeId == null ? null : new MailListCursor(beforeAt, beforeId);
    return messageService.list(
        callerId, accountId, folder, folderId, query, unread, category, needsReply, cursor, limit);
  }

  /**
   * WP-965 받은편지함(folder=INBOX)·보낸편지함(folder=SENT)의 이전 메일 더 가져오기 — 목록을 끝까지 내렸을 때 화면이 부른다. 가져온 경계 앞
   * 90일을 서버에서 받고, 그 앞에 더 있는지(hasMore)를 돌려준다. 같은 폴더를 이미 가져오는 중이면 running=true. 서버 I/O 동안 DB 연결을 잡지
   * 않게 트랜잭션을 걸지 않는다(서비스가 짧은 트랜잭션으로 나눈다).
   */
  @PostMapping("/accounts/{accountId}/messages/older")
  public MailOlderResult fetchOlder(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long accountId,
      @RequestParam(defaultValue = "INBOX") String folder) {
    return folderService.fetchOlder(callerId, accountId, folder);
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
   * <p>markSeen 기본 true(구 클라이언트 호환). false 는 읽음 처리를 생략한다 — AI 조회(WP-147)와, 재조회마다 읽음 처리되지 않도록 첫 열람만
   * {@code POST /messages/{id}/read} 로 따로 보내는 웹(WP-214)이 쓴다.
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
      @RequestParam(required = false) String query,
      @RequestParam(required = false) Long folderId) { // WP-960: 서버 메일함 보기
    return messageService.unreadCountInView(
        callerId, accountId, folderId, category, needsReply, query);
  }

  /** WP-187: 모두 읽음 — 지금 보기 ∧ asOf 이전 도착 ∧ 안 읽음. */
  @PostMapping("/accounts/{accountId}/messages/mark-all-read")
  public MarkAllReadResponse markAllRead(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long accountId,
      @RequestParam(required = false) Long folderId, // WP-960: 서버 메일함 보기
      @RequestBody MarkAllReadRequest req) {
    return new MarkAllReadResponse(messageService.markAllRead(callerId, accountId, folderId, req));
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

  /**
   * 첨부 추출 텍스트 구간 읽기(WP-358) — 이슈 첨부 /text 와 같은 응답({@link ExtractedTextSlice}, 단 fileId 는 이
   * attachmentId). 첫 요청에 바이트를 가져와 추출을 요청하므로 PENDING 이 오고, 추출이 끝나면 READY. limit 상한 32,000자(초과는 클램프).
   * 권한은 /content 와 같다(본인 소유 아니면 404).
   */
  @GetMapping("/attachments/{attachmentId}/text")
  public ExtractedTextSlice readAttachmentText(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long attachmentId,
      @RequestParam(defaultValue = "0") int offset,
      @RequestParam(defaultValue = "32000") int limit) {
    return attachmentTextService.readText(callerId, attachmentId, offset, limit);
  }

  /**
   * 첨부를 모델 입력용 이미지로 보기(WP-388) — 다른 source 의 {@code GET .../view}(WP-250)와 같은 응답(PNG/JPEG, PDF 면
   * {@code X-Page-Count}). PDF 는 {@code ?page=N}(1부터), 이미지는 page 없이 부른다. 권한은 /content·/text 와 같다(본인
   * 소유 아니면 404). 요청마다 원본을 받아 그리고 아무것도 저장하지 않는다. 워커 호출 동안 DB 연결을 잡지 않게 트랜잭션을 걸지 않는다(R5 — 서비스가 짧은
   * 트랜잭션으로 나눈다).
   */
  @GetMapping("/attachments/{attachmentId}/view")
  public ResponseEntity<byte[]> viewAttachment(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long attachmentId,
      @RequestParam(required = false) Integer page) {
    return ViewImageResponses.of(attachmentViewService.view(callerId, attachmentId, page));
  }

  /**
   * 첨부 문서 미리보기(서버 변환 PDF, WP-432) — HWP·HWPX·PPTX·PPT·DOC 첨부를 첫 열람 때 PDF 로 변환해 원래 모양 그대로 보여 준다. 응답
   * 계약(200·202·422·404 NOT_APPLICABLE, ETag·304)은 드라이브와 같은 {@link PreviewResponses} 가 맡는다. 본인 소유가
   * 아니거나 없으면 {@code /content} 와 같은 존재 은닉 404(예외 봉투)다. 변환·원본 받기 동안 DB 연결을 잡지 않게 트랜잭션을 걸지 않는다(R5).
   *
   * @param start 시도의 첫 요청(뷰어 열기·[다시 시도])이면 true — 이때만 실패 행을 다시 선점한다. 폴링은 생략
   */
  @GetMapping("/attachments/{attachmentId}/preview")
  public ResponseEntity<?> previewAttachment(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long attachmentId,
      @RequestParam(defaultValue = "false") boolean start) {
    return PreviewResponses.of(attachmentPreviewService.open(callerId, attachmentId, start));
  }
}
