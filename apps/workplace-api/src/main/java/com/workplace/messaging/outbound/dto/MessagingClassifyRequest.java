package com.workplace.messaging.outbound.dto;

import java.util.List;

/** ai-agent POST /messaging/classify 요청 DTO. */
public record MessagingClassifyRequest(
    /** 분류 대상 메시지 목록. */
    List<Msg> messages,
    /** 채널 멤버 목록(어텐션 후보). */
    List<Member> members,
    /** ai-agent 어시스턴트 agentId. */
    long assistantAgentId,
    /** 사용할 모델 ID. */
    String model,
    /** 최대 턴 수. */
    int maxTurns,
    /** 타임아웃(ms). */
    long timeoutMs) {

  /** 개별 메시지 — 작성자 이름과 본문. */
  public record Msg(String authorName, String body) {}

  /** 채널 멤버 — userId 와 표시 이름. */
  public record Member(long userId, String displayName) {}
}
