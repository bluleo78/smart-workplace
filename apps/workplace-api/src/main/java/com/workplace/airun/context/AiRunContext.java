package com.workplace.airun.context;

import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.InternalOnBehalfOf;
import java.time.OffsetDateTime;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

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

  /**
   * 지금 이 스레드의 SecurityContext (없으면 callerId) 로 주체를 정한 맥락 — **요청 스레드**에서 만들어 스레드 풀로 넘긴다(WP-1829 리뷰
   * 반영).
   *
   * <p>왜: 펌프·SSE 처럼 스레드 풀로 도는 작업에는 SecurityContext 가 없어 주체가 AUTO 로 떨어진다. 이전에는 호출부가 user id 로 USER 를
   * 고정해, AI 키(ROLE_AGENT) 로 시작한 처리까지 사람의 일로 기록됐다. 요청 스레드에서 주체를 잡아 범위로 넘기면 AI 키 호출은 AGENT, 사람 호출은
   * USER 로 남는다.
   *
   * <p>principal 이 사용자 id(Long)면 Internal 대행 호출·ROLE_AGENT 권한이면 AGENT, 없으면 USER. 인증이 없거나 principal
   * 이 사용자 id 가 아니면 callerId 로 사람을 남기고, 그것도 없으면 AUTO.
   *
   * @param callerId SecurityContext 로 주체를 못 정했을 때 쓸 사용자 id — 호출부가 이미 사람으로 확정한 곳이면 그 id 로 남긴다(null
   *     이면 AUTO)
   */
  public static AiRunContext actorFromSecurity(Long callerId) {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth == null || !(auth.getPrincipal() instanceof Long userId)) {
      // principal 이 사용자 id 가 아니면 AUTO 로 떨어져 사람이 시작한 처리도 자동 처리로 보였다 — 호출부가 확정한 사람으로 남긴다(WP-1829 리뷰
      // 후속).
      return callerId == null ? auto() : new AiRunContext(null, null, null, "USER", callerId, null);
    }
    // AI 키 인증은 principal 이 사용자 id 지만 ROLE_AGENT 권한이 붙는다 — 사람이 아니라 AGENT 가 한 일로 남긴다.
    // Internal 대행 호출(내부 토큰 + X-On-Behalf-Of)은 권한에 ROLE_AGENT 가 없지만 역시 ai-agent 가 한 일이다(WP-1829 리뷰
    // 후속).
    boolean agent =
        InternalOnBehalfOf.isInternal(auth)
            || auth.getAuthorities().stream()
                .anyMatch(a -> ApiKeyAuthenticationFilter.ROLE_AGENT.equals(a.getAuthority()));
    return new AiRunContext(null, null, null, agent ? "AGENT" : "USER", userId, null);
  }

  /** SecurityContext 만으로 주체를 정한다({@link #actorFromSecurity(Long)} 와 같고 callerId 없음). */
  public static AiRunContext actorFromSecurity() {
    return actorFromSecurity(null);
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
