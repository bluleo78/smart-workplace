package com.workplace.mail.controller;

import com.workplace.mail.dto.MailComposeDraft;
import com.workplace.mail.dto.MailComposeDraftRequest;
import com.workplace.mail.dto.MailDraftCoaching;
import com.workplace.mail.dto.MailDraftCoachingRequest;
import com.workplace.mail.service.MailAiService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 초안 코칭·새 메일 AI 초안(compose-draft, WP-576) REST — 메시지 비종속(새 메일도 동작)이라 message 스코프 컨트롤러와 분리. 코칭은
 * accountId 를 본문으로, compose-draft 는 경로로 받고 소유권은 서비스가 검증(@AuthenticationPrincipal callerId 기준).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/mail")
public class MailDraftCoachingController {

  private final MailAiService aiService;

  /** 내 초안 코칭(미영속). */
  @PostMapping("/draft-coaching")
  public MailDraftCoaching coachDraft(
      @AuthenticationPrincipal Long callerId, @RequestBody MailDraftCoachingRequest req) {
    return aiService.coachDraft(callerId, req);
  }

  /** WP-576 새 메일 AI 초안(미영속) — 계정 소유는 서비스가 검증(타 계정 404, AI 꺼짐 503). */
  @PostMapping("/accounts/{accountId}/compose-draft")
  public MailComposeDraft composeDraft(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long accountId,
      @RequestBody @Valid MailComposeDraftRequest req) {
    return aiService.composeDraft(callerId, accountId, req);
  }
}
