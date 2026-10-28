package com.workplace.mail.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** 메일 초대 응답 요청(WP-986) — {@code POST /mail/messages/{id}/invite-response}. */
public record InviteResponseRequest(
    @NotNull(message = InviteResponseRequest.MESSAGE)
        @Pattern(regexp = "ACCEPTED|TENTATIVE|DECLINED", message = InviteResponseRequest.MESSAGE)
        String response) {

  /** 응답 누락·잘못된 값 공통 안내. */
  static final String MESSAGE = "참석 응답(ACCEPTED·TENTATIVE·DECLINED)을 골라 주세요";
}
