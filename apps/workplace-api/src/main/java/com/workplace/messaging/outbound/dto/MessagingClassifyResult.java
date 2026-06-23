package com.workplace.messaging.outbound.dto;

import java.util.List;

/** ai-agent POST /messaging/classify 응답 DTO. */
public record MessagingClassifyResult(
    /** 어텐션이 필요한 멤버 목록. */
    List<Relevant> relevant) {

  /** 어텐션 대상 멤버 — userId 와 이유. */
  public record Relevant(long userId, String reason) {}
}
