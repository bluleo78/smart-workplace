package com.workplace.airun.context;

import java.time.OffsetDateTime;

/**
 * AI 처리 한 건의 맥락 — 무엇(target)을 누가(actor) 언제 일어난 일(sourceAt)로 처리하는지 (WP-1829).
 *
 * <p>API → ai-agent 호출마다 X-AI-Run 헤더로 실어 보내 "AI 처리 기록"의 대상·주체를 채운다. 모든 필드는 선택이다.
 *
 * @param targetType 대상 종류(예: MAIL_MESSAGE)
 * @param targetId 대상 id(문자열)
 * @param targetLabel 사람이 읽는 대상 이름
 * @param actorType 실행 주체 종류(AUTO·USER·AGENT). null 이면 호출 시점에 SecurityContext 로 정한다
 * @param actorId 실행 주체 id
 * @param sourceAt 처리를 불러온 일이 일어난 시각(예: 메일 수신 시각)
 */
public record AiRunContext(
    String targetType,
    String targetId,
    String targetLabel,
    String actorType,
    Long actorId,
    OffsetDateTime sourceAt) {

  /** 요청자(사용자 id)가 직접 한 일 — 대상 없이 주체만 USER 로 정한다. */
  public static AiRunContext user(long id) {
    return new AiRunContext(null, null, null, "USER", id, null);
  }

  /** 백그라운드(AUTO) 주체만 정한 맥락 — 대상·원천 시각 없음. */
  public static AiRunContext auto() {
    return new AiRunContext(null, null, null, "AUTO", null, null);
  }

  /** 아무것도 정하지 않은 빈 맥락. */
  public static AiRunContext empty() {
    return new AiRunContext(null, null, null, null, null, null);
  }
}
