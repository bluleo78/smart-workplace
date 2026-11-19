package com.workplace.mail.controller;

import com.workplace.mail.dto.MailDraftCount;
import com.workplace.mail.dto.MailDraftDetail;
import com.workplace.mail.dto.MailDraftSaveRequest;
import com.workplace.mail.dto.MailDraftSaved;
import com.workplace.mail.dto.MailDraftSummary;
import com.workplace.mail.dto.MailDraftVersion;
import com.workplace.mail.service.MailDraftService;
import com.workplace.mail.service.MailSendQueueService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 메일 임시저장 REST(WP-577). 작성창 자동 저장·다시 열기·버리기. @AuthenticationPrincipal callerId(=본인) 스코프 — 남의
 * 임시저장·계정은 404. 발송은 {@code POST /accounts/{id}/send} 에 draftId 를 실어 보내면 곧바로 보내지 않고 이 임시저장을 보낼
 * 대기열(QUEUED, 10초 뒤)에 올린다(WP-1786) — 그동안 {@code POST /drafts/{id}/cancel-send} 로 되돌릴 수 있고, 때가 되면
 * 스케줄러가 보내 성공 시 임시저장을 지우며 실패하면 FAILED 로 남겨 알림을 보낸다. 대기·발송 중인 임시저장은 수정·삭제가 409 DRAFT_SENDING 이다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/mail/drafts")
public class MailDraftController {

  private final MailDraftService draftService;
  private final MailSendQueueService sendQueueService;

  /** 계정의 임시저장 목록 — 갱신 최신순, 최대 200건. */
  @GetMapping
  public List<MailDraftSummary> list(
      @AuthenticationPrincipal Long callerId, @RequestParam long accountId) {
    return draftService.list(callerId, accountId);
  }

  /** 계정의 임시저장 개수(사이드바 배지). */
  @GetMapping("/count")
  public MailDraftCount count(
      @AuthenticationPrincipal Long callerId, @RequestParam long accountId) {
    return draftService.count(callerId, accountId);
  }

  /** 임시저장 상세 — 작성창을 다시 열 때. */
  @GetMapping("/{id}")
  public MailDraftDetail get(@AuthenticationPrincipal Long callerId, @PathVariable long id) {
    return draftService.get(callerId, id);
  }

  /** 새 임시저장 → 201 + {id, version, updatedAt}. */
  @PostMapping
  public ResponseEntity<MailDraftSaved> create(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody MailDraftSaveRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED).body(draftService.create(callerId, request));
  }

  /** 임시저장 수정(낙관적 잠금) → {version, updatedAt}. 버전이 다르면 409 DRAFT_CONFLICT. */
  @PutMapping("/{id}")
  public MailDraftVersion update(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @Valid @RequestBody MailDraftSaveRequest request) {
    return draftService.update(callerId, id, request);
  }

  /** 임시저장 버리기 → 204. 묶인 업로드 파일도 정리한다. */
  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable long id) {
    draftService.delete(callerId, id);
    return ResponseEntity.noContent().build();
  }

  /**
   * 보내기 되돌리기(WP-1786) — 대기 중이면 풀어 임시보관 상세를 돌려준다. 이미 보내는 중이면 409 ALREADY_SENDING, 없으면 404(웹은 둘 다 「이미
   * 보냈어요」).
   */
  @PostMapping("/{draftId}/cancel-send")
  public MailDraftDetail cancelSend(
      @AuthenticationPrincipal Long callerId, @PathVariable long draftId) {
    return sendQueueService.cancel(callerId, draftId);
  }
}
