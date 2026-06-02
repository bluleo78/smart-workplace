package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 메시지 작성 요청. body 1~4000 자. parentMessageId 있으면 스레드 답글(없으면 채널 최상위). */
public record CreateMessageRequest(
    @NotBlank @Size(min = 1, max = 4000) String body, Long parentMessageId) {

  /** 스레드가 아닌 일반 메시지용 보조 생성자 — parentMessageId = null. */
  public CreateMessageRequest(String body) {
    this(body, null);
  }
}
