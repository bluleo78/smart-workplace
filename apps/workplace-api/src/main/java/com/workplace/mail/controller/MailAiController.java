package com.workplace.mail.controller;

import com.workplace.mail.dto.MailReplyDraft;
import com.workplace.mail.dto.MailSummary;
import com.workplace.mail.service.MailAiService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
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
}
