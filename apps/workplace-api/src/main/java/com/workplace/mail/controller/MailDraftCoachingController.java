package com.workplace.mail.controller;

import com.workplace.mail.dto.MailDraftCoaching;
import com.workplace.mail.dto.MailDraftCoachingRequest;
import com.workplace.mail.service.MailAiService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 초안 코칭 REST — 메시지 비종속(새 메일도 동작)이라 message 스코프 컨트롤러와 분리. accountId 는 본문으로 받고 소유권은 서비스가
 * 검증(@AuthenticationPrincipal callerId 기준).
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
}
