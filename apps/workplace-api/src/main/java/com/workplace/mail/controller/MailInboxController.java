package com.workplace.mail.controller;

import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.service.MailMessageService;
import com.workplace.mail.service.MailSyncService;
import java.util.List;
import lombok.RequiredArgsConstructor;
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

  /** 계정의 INBOX 를 증분 동기화(수동 트리거). */
  @PostMapping("/accounts/{accountId}/sync")
  public MailSyncResult sync(@AuthenticationPrincipal Long callerId, @PathVariable long accountId) {
    return syncService.sync(callerId, accountId);
  }

  /** 계정의 메시지 목록(폴더 INBOX/SENT, 최신순, 선택 검색어 query, limit). */
  @GetMapping("/accounts/{accountId}/messages")
  public List<EmailMessageSummary> messages(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long accountId,
      @RequestParam(required = false, defaultValue = "INBOX") String folder,
      @RequestParam(required = false) String query,
      @RequestParam(required = false, defaultValue = "0") int limit) {
    return messageService.list(callerId, accountId, folder, query, limit);
  }

  /** 메시지 단건 상세(본문 + 첨부 메타). */
  @GetMapping("/messages/{messageId}")
  public EmailMessageDetail message(
      @AuthenticationPrincipal Long callerId, @PathVariable long messageId) {
    return messageService.get(callerId, messageId);
  }
}
