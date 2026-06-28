package com.workplace.mail.controller;

import com.workplace.mail.dto.LinkedIssue;
import com.workplace.mail.dto.MailIssueDraft;
import com.workplace.mail.dto.MailReplyDraft;
import com.workplace.mail.dto.MailSummary;
import com.workplace.mail.dto.PromoteToIssueRequest;
import com.workplace.mail.dto.PromotedIssue;
import com.workplace.mail.service.MailAiService;
import com.workplace.mail.service.MailIssueService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 메일 AI 비서 REST(요약·답장 초안). message 스코프 — @AuthenticationPrincipal callerId 본인 소유만(아니면 404).
 * MailInboxController 의 /api/v1/mail/messages/{messageId} 와 경로가 겹치지 않도록 하위 경로(/summary,
 * /reply-draft)만 처리.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/mail/messages")
public class MailAiController {

  private final MailAiService aiService;
  private final MailIssueService issueService;

  /** 메일 요약(캐시 우선, 없으면 생성·캐시). */
  @GetMapping("/{messageId}/summary")
  public MailSummary summary(@AuthenticationPrincipal Long callerId, @PathVariable long messageId) {
    return aiService.summarize(callerId, messageId);
  }

  /** AI 답장 초안(미영속). */
  @PostMapping("/{messageId}/reply-draft")
  public MailReplyDraft replyDraft(
      @AuthenticationPrincipal Long callerId, @PathVariable long messageId) {
    return aiService.replyDraft(callerId, messageId);
  }

  /** #520 메일→이슈 승격(사용자 권한 생성 + 메일 출처 스탬프). */
  @PostMapping("/{messageId}/issue")
  public PromotedIssue promoteToIssue(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long messageId,
      @RequestBody @Valid PromoteToIssueRequest req) {
    return issueService.promoteToIssue(callerId, messageId, req);
  }

  /** #520 메일→이슈 AI 초안(미영속). */
  @PostMapping("/{messageId}/issue-draft")
  public MailIssueDraft issueDraft(
      @AuthenticationPrincipal Long callerId, @PathVariable long messageId) {
    return issueService.draftIssue(callerId, messageId);
  }

  /** #520 메일에 연결된 이슈 키(배지). */
  @GetMapping("/{messageId}/linked-issue")
  public LinkedIssue linkedIssue(
      @AuthenticationPrincipal Long callerId, @PathVariable long messageId) {
    return issueService.findLinkedIssue(callerId, messageId);
  }
}
