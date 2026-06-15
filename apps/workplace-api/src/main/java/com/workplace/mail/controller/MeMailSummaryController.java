package com.workplace.mail.controller;

import com.workplace.mail.dto.MailSummaryResponse;
import com.workplace.mail.repository.EmailMessageRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 홈 대시보드 메일 요약 REST — 본인 INBOX 의 안읽음 수 + 최근 안읽은 메일 5건. @AuthenticationPrincipal callerId(=본인) 스코프로,
 * MailInboxController 처럼 별도 권한 없이 본인 소유 계정/메시지만 다룬다. 읽기 전용.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/me/mail-summary")
public class MeMailSummaryController {

  /** 홈 위젯이 한 번에 소비하므로 최근 메일은 최대 5건으로 제한한다. */
  private static final int RECENT_LIMIT = 5;

  private final EmailMessageRepository messageRepository;

  /** 안읽음 수 + 최근 안읽은 메일 N건을 묶어 반환. */
  @GetMapping
  public ResponseEntity<MailSummaryResponse> summary(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(
        new MailSummaryResponse(
            messageRepository.countUnread(callerId),
            messageRepository.listRecentUnread(callerId, RECENT_LIMIT)));
  }
}
