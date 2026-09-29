package com.workplace.notify.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** 브라우저 PushSubscription.toJSON() 과 같은 모양의 구독 등록 요청. */
public record PushSubscriptionRequest(
    @NotBlank @Size(max = 2048) String endpoint, @NotNull @Valid Keys keys) {

  /** 브라우저 공개키(p256dh)와 인증 비밀(auth) — base64url. */
  public record Keys(
      @NotBlank @Size(max = 200) String p256dh, @NotBlank @Size(max = 100) String auth) {}
}
