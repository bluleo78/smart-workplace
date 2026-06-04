package com.workplace.mail.controller;

import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.SendResult;
import com.workplace.mail.service.MailComposeService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 메일 작성+발송 REST. 새 메일·답장·전달 공용 단일 엔드포인트. @AuthenticationPrincipal callerId(=본인) 스코프 — 본인 소유 계정으로만
 * 발송(아니면 404).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/mail")
public class MailComposeController {

  private final MailComposeService composeService;

  /** 메일 발송. inReplyToMessageId 가 있으면 답장으로 스레드 상속. */
  @PostMapping("/accounts/{accountId}/send")
  public SendResult send(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long accountId,
      @RequestBody MailSendRequest request) {
    return composeService.send(callerId, accountId, request);
  }
}
