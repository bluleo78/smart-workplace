package com.workplace.mail.controller;

import com.workplace.mail.dto.MailUserSettingResponse;
import com.workplace.mail.dto.MailUserSettingUpdateRequest;
import com.workplace.mail.service.MailUserSettingService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 내 메일 사용자 설정 REST(WP-1744). 사람마다 하나이고 본인 것만 다룬다(@AuthenticationPrincipal callerId). 설정 › 메일 계정의
 * 「작성 방식」 카드가 저장하고, 작성창이 새 작성을 열 곳을 정할 때 읽는다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/mail/settings")
public class MailUserSettingController {

  private final MailUserSettingService settingService;

  /** 내 설정. 아직 없으면 기본값(우측 하단 DOCK). */
  @GetMapping
  public MailUserSettingResponse get(@AuthenticationPrincipal Long callerId) {
    return settingService.get(callerId);
  }

  /** 설정 저장 — composeMode 가 없거나 PANE·DOCK·WINDOW 가 아니면 400. */
  @PutMapping
  public MailUserSettingResponse update(
      @AuthenticationPrincipal Long callerId,
      @Valid @RequestBody MailUserSettingUpdateRequest request) {
    return settingService.update(callerId, request);
  }
}
